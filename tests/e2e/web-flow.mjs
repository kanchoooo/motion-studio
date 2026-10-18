// 관제용 웹 연결 in the app:
//  - without console.json: no server, no endpoint file; --hidden is ignored (the window shows)
//  - console.json turns it on and off while the app runs (the endpoint file comes and goes)
//  - started hidden: no window; the server answers only with the token; the app's page with its CSP;
//    the same handlers; sign-ins and Mac dialogs refused; uploads and downloads stay inside their
//    folders; the preview only (sandboxed, never the MCP); status, show, quit (busy → not quit)
//  - in a browser through a relay like the console's (under a sub path, token added): the screens,
//    a project in the editor with its preview (fonts, sound, the runtime), editing saved, events,
//    a file picked and uploaded, a download; the app quits → "다시 연결 중" → back → the page reloads
// The sandbox is copied; the copy is removed afterwards.
// 관제용 판 only: build it first with MS_CONSOLE=1 npx electron-vite build
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/web-flow.mjs
import { _electron as electron, chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
if (!existsSync(join(root, 'out', 'renderer', 'web.html'))) {
  console.log('관제용 판 빌드가 아니에요: MS_CONSOLE=1 npx electron-vite build 뒤에 실행해 주세요')
  process.exit(1)
}
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-web-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const ud = join(sandbox, 'userdata')
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const endpointFile = join(ud, 'web-endpoint.json')
const consoleFile = join(ud, 'console.json')
for (const f of [endpointFile, consoleFile]) rmSync(f, { force: true })
const ffmpeg = join(root, 'resources', 'bin', `darwin-${process.arch}`, 'ffmpeg')
const picture = join(sandbox, '참고 사진.png')
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180', '-frames:v', '1', picture])

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (f, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await f()) return true
    await sleep(250)
  }
  return false
}
const launch = (args = []) =>
  electron.launch({ args: [join(root, 'out', 'main', 'index.js'), ...args], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: ud, MS_NO_UPDATE: '1' } })
/** quits without the "작업 중" question (a hidden app cannot show it), killed if it does not go */
async function closeApp(a) {
  if (!a) return
  await a.evaluate(({ dialog }) => (dialog.showMessageBoxSync = () => 1)).catch(() => {})
  await Promise.race([a.close().catch(() => {}), sleep(20000)])
  try {
    a.process().kill('SIGKILL')
  } catch {
    /* gone */
  }
}
const ep = () => (existsSync(endpointFile) ? JSON.parse(readFileSync(endpointFile, 'utf8')) : null)
/** a request straight to the app's web server (token added unless told otherwise) */
function raw(path, { method = 'GET', token, type, body } = {}) {
  const e = ep()
  return new Promise((resolve, reject) => {
    const headers = {}
    if (token !== null) headers['x-ms-token'] = token ?? e.token
    if (type) headers['content-type'] = type
    const req = request({ host: '127.0.0.1', port: e.port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.setTimeout(60000, () => req.destroy(new Error(`no answer: ${method} ${path}`)))
    req.end(body)
  })
}
const invoke = async (channel, ...args) => JSON.parse((await raw('/api/invoke', { method: 'POST', type: 'application/json', body: JSON.stringify({ channel, args }) })).body.toString())
grantAccess(ud)

// ---- 1. no console.json: nothing (and --hidden does not hide) ----
let app = await launch(['--hidden'])
let win = await app.firstWindow()
try {
  await toHome(win)
  await sleep(2500)
  check('without console.json there is no web server (no endpoint file)', !ep())
  check('…and --hidden is ignored: the window shows', await win.isVisible('body'))
  // the console turns it on while the app runs, and off again
  writeFileSync(consoleFile, JSON.stringify({ web: true }))
  check('console.json {"web": true} starts it while the app runs', await until(() => !!ep(), 15000))
  const e = ep()
  check('…the endpoint file: port, token, pid, version, user-only', e && e.port > 0 && /^[a-f0-9]{64}$/.test(e.token) && e.pid > 0 && !!e.version && e.hidden === false && (statSync(endpointFile).mode & 0o777) === 0o600, JSON.stringify({ ...e, token: undefined }))
  rmSync(consoleFile)
  check('…and removing it stops it (the endpoint file goes)', await until(() => !ep(), 15000))
} finally {
  await closeApp(app)
}

// ---- 2. hidden, the server ----
writeFileSync(consoleFile, JSON.stringify({ web: true }))
app = await launch(['--hidden'])
// the browser: this Mac's Chrome (or Playwright's own Chromium)
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
let relay
const webErrors = []
try {
  check('started hidden by the console: the endpoint comes up', await until(() => !!ep(), 30000))
  await sleep(1500)
  check('…with no window', app.windows().length === 0, String(app.windows().length))
  check('…and says hidden', ep()?.hidden === true)
  check('no token → 403', (await raw('/', { token: null })).status === 403)
  check('a wrong token → 403', (await raw('/api/status', { token: 'x'.repeat(64) })).status === 403)
  const page = await raw('/')
  check("the app's page, with a CSP like the window's", page.status === 200 && /default-src 'self'/.test(page.headers['content-security-policy'] ?? '') && page.body.toString().includes('./assets/'), JSON.stringify(page.headers))
  const js = page.body.toString().match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1]
  check('…and its files', (await raw(`/${js}`)).status === 200)
  const st = JSON.parse((await raw('/api/status')).body)
  check('status: version, pid, hidden, nothing busy', st.version && st.pid === ep().pid && st.hidden === true && Array.isArray(st.busy) && st.exporting === 0, JSON.stringify(st))
  const list = await invoke('projects:list')
  check('invoke: the same handlers as the window', list.ok && list.result.some((p) => p.name === '앱 주문 런칭'))
  check('…no-store on the API', (await raw('/api/invoke', { method: 'POST', type: 'application/json', body: '{"channel":"folders:list","args":[]}' })).headers['cache-control'] === 'no-store')
  check('sign-ins are refused ("맥에서")', /맥에서/.test((await invoke('ai:login', 'higgsfield', 'x')).error ?? ''))
  check("Mac dialogs are refused (a browser picks its own files)", (await invoke('app:pickFiles', 'any')).ok === false)
  check('a form post (text/plain) is refused', (await raw('/api/invoke', { method: 'POST', type: 'text/plain', body: '{"channel":"projects:list","args":[]}' })).status === 415)
  check('an unknown channel is refused', (await invoke('app:nope')).ok === false)
  // uploads and downloads
  const up = JSON.parse((await raw(`/api/upload?name=${encodeURIComponent('../../밖으로.txt')}`, { method: 'POST', type: 'application/octet-stream', body: 'hello' })).body)
  check('an upload lands in web-uploads under its own name only', up.ok && up.path.startsWith(join(ud, 'web-uploads')) && up.path.endsWith('/밖으로.txt') && readFileSync(up.path, 'utf8') === 'hello', JSON.stringify(up))
  const back = await raw(`/api/file?path=${encodeURIComponent(up.path)}`)
  check('…and downloads again (attachment)', back.status === 200 && back.body.toString() === 'hello' && /attachment/.test(back.headers['content-disposition'] ?? ''))
  check('a file outside the projects / collection / uploads is not given', (await raw(`/api/file?path=${encodeURIComponent(consoleFile)}`)).status === 404 && (await raw('/api/file?path=%2Fetc%2Fhosts')).status === 404)
  const r0 = JSON.parse(readFileSync(join(proj, 'renders', 'index.json'), 'utf8'))[0]
  const video = await raw(`/api/file?path=${encodeURIComponent(join(proj, r0.file))}`)
  check('an export downloads whole', video.status === 200 && video.body.length === statSync(join(proj, r0.file)).size)
  const ranged = await raw(`/api/file?path=${encodeURIComponent(join(proj, r0.file))}`, {})
  check('…(with ranges offered)', ranged.headers['accept-ranges'] === 'bytes')
  const ae = readdirSync(join(proj, 'renders')).find((n) => /-AE(-\d+)?$/.test(n))
  if (ae) {
    const zip = await raw(`/api/file?path=${encodeURIComponent(join(proj, 'renders', ae))}`)
    check('a folder (AE package) downloads as a zip', zip.status === 200 && zip.body.subarray(0, 2).toString() === 'PK' && /\.zip/.test(decodeURIComponent(zip.headers['content-disposition'] ?? '')))
  }
  // the preview
  const pid = list.result.find((p) => p.name === '앱 주문 런칭').id
  await invoke('projects:open', join(sandbox, 'projects', '앱 주문 런칭.msproj'))
  const pv = await invoke('projects:previewUrl', pid)
  check('preview URLs come relative (./preview/…)', pv.ok && pv.result.src.startsWith('./preview/p/'), JSON.stringify(pv.result))
  const pdir = pv.result.src.slice(1).replace(/index\.html$/, '')
  const html = await raw(`${pdir}index.html?ms-preview=1`)
  check('the preview page is sandboxed, open to its own fetches (fonts)', html.status === 200 && html.headers['content-security-policy'] === 'sandbox allow-scripts' && html.headers['access-control-allow-origin'] === '*', JSON.stringify(html.headers))
  check('…its runtime is found under /preview/', html.body.toString().includes('<script src="../../__ms/hf-runtime.js"></script>') && (await raw('/preview/__ms/hf-runtime.js')).status === 200)
  const font = await raw(`${pdir}ms/fonts.css`)
  check('…and its files', font.status === 200)
  check('the MCP and the hooks are never reached through it', (await raw('/preview/mcp/x')).status === 404 && (await raw('/preview/hook/x')).status === 404 && (await raw(`${pdir}../../mcp/x`)).status === 404 && (await raw(`${pdir}..%2F..%2Fmcp%2Fx`)).status !== 200)
  check('send (terminal) answers', JSON.parse((await raw('/api/send', { method: 'POST', type: 'application/json', body: JSON.stringify({ channel: 'terminal:resize', args: [pid, 100, 30] }) })).body).ok === true)

  // ---- 3. in a browser, through a relay like the console's ----
  const PRE = '/api/console/studio/ms'
  const fwdReq = ['content-type', 'content-length', 'range', 'accept', 'accept-language', 'if-none-match', 'if-modified-since', 'if-range', 'last-event-id', 'cache-control']
  const fwdRes = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'content-security-policy', 'access-control-allow-origin']
  const pick = (h, keys) => Object.fromEntries(keys.filter((k) => h[k] !== undefined).map((k) => [k, h[k]]))
  const offline = (res, sub) => {
    if (sub.startsWith('/api/')) res.writeHead(503, { 'content-type': 'application/json' }).end('{"ok":false,"offline":true}')
    else res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' }).end('<p>꺼져 있어요</p>')
  }
  relay = createServer((req, res) => {
    if (req.url === PRE) return void res.writeHead(307, { location: `${PRE}/` }).end()
    if (!req.url.startsWith(`${PRE}/`)) return void res.writeHead(404).end()
    const sub = req.url.slice(PRE.length)
    const e = ep()
    if (!e) return offline(res, sub)
    const up = request({ host: '127.0.0.1', port: e.port, method: req.method, path: sub, headers: { ...pick(req.headers, fwdReq), 'x-ms-token': e.token, 'accept-encoding': 'identity' } }, (ur) => {
      res.writeHead(ur.statusCode, pick(ur.headers, fwdRes))
      ur.pipe(res)
    })
    up.on('error', () => (res.headersSent ? res.destroy() : offline(res, sub)))
    req.pipe(up)
  })
  await new Promise((r) => relay.listen(0, '127.0.0.1', r))
  const home = `http://127.0.0.1:${relay.address().port}${PRE}`
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const web = await ctx.newPage()
  const errors = webErrors
  web.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  web.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
  web.on('pageerror', (e) => errors.push(e.message))
  await web.goto(home)
  await toHome(web)
  check('the screens open in a browser (under the relay path)', await web.getByTestId('folder-tree').isVisible())
  check('…as the web version', await web.evaluate(() => window.studio.internal.web === true))
  await web.evaluate(() => {
    window.__events = []
    window.studio.agent.onEvent((e) => window.__events.push(e.type))
  })
  await web.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await web.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await web.locator('[data-capture-frame]').waitFor({ timeout: 30000 })
  const frame = await until(async () => web.frames().find((f) => f.url().includes('/preview/p/') && f.url().includes('ms-preview')), 30000).then(() => web.frames().find((f) => f.url().includes('ms-preview')))
  check('the preview loads through the relay', !!frame)
  check('…its runtime starts (the timeline knows the length)', await until(async () => !!(await frame.evaluate(() => !!window.__player && window.__player.getDuration() > 0).catch(() => false)), 30000))
  const fonts = await frame.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].map((f) => `${f.family}:${f.status}`)
  })
  check('…its fonts load (sandboxed origin, CORS)', fonts.length > 0 && !fonts.some((f) => f.endsWith(':error')), JSON.stringify(fonts))
  check('…and is sandboxed (an origin of its own)', await frame.evaluate(() => window.origin === 'null'))
  const sounds = await until(async () => (await frame.evaluate(() => [...document.querySelectorAll('audio')].every((a) => a.readyState >= 1)).catch(() => false)), 20000)
  check('…its sounds load', sounds)
  await web.locator('[data-capture-frame]').click()
  await web.keyboard.press('Space')
  await sleep(1500)
  const playing = await frame.evaluate(() => ({ t: window.__player.getTime(), audio: [...document.querySelectorAll('audio')].some((a) => !a.paused) }))
  await web.keyboard.press('Space')
  check('…it plays, with sound', playing.t > 0.3 && playing.audio, JSON.stringify(playing))
  check('events reach the browser (the session, the project)', (await web.evaluate(() => window.__events.length)) > 0)
  // editing: a layer picked in the list and nudged; the change is saved in the project
  const ovBefore = readFileSync(join(proj, 'overrides.json'), 'utf8')
  const row = web.locator('[data-testid="layer-row"] button.row').first()
  await row.click()
  await sleep(400)
  await web.locator('[data-capture-frame]').hover()
  for (let i = 0; i < 5; i++) await web.keyboard.press('Shift+ArrowRight')
  check('editing in the browser is saved in the project', await until(() => readFileSync(join(proj, 'overrides.json'), 'utf8') !== ovBefore, 10000))
  // a file picked in the browser: uploaded, then the app takes it as usual
  const chooser = web.waitForEvent('filechooser')
  await web.getByTestId('attach-media').click()
  await (await chooser).setFiles(picture)
  const refs = () => (existsSync(join(proj, 'references', 'index.json')) ? JSON.parse(readFileSync(join(proj, 'references', 'index.json'), 'utf8')) : [])
  check('a file picked in the browser is uploaded and attached', await until(() => refs().some((r) => /참고 사진/.test(JSON.stringify(r))), 20000), JSON.stringify(refs()).slice(0, 300))
  // a download (결과물 → 내려받기)
  const dl = web.waitForEvent('download')
  await web.evaluate((p) => window.studio.app.reveal(p), join(proj, r0.file))
  const file = await (await dl).path()
  check('내려받기 gives the export itself', statSync(file).size === statSync(join(proj, r0.file)).size)
  check('no errors in the page (CSP, scripts)', !errors.some((t) => /Content Security Policy|Refused|Uncaught/i.test(t)), errors.slice(0, 5).join(' | '))

  // ---- status, show, quit ----
  const render = await invoke('renders:start', pid, { format: 'mp4-h264', quality: 'draft', fileName: 'web-busy' })
  await until(async () => JSON.parse((await raw('/api/status')).body).exporting > 0, 5000)
  const busyQuit = JSON.parse((await raw('/api/quit', { method: 'POST', type: 'application/json', body: '{"force":false}' })).body)
  check('quit while exporting: not quit, says why', busyQuit.ok === false && busyQuit.exporting > 0, JSON.stringify(busyQuit))
  await invoke('renders:cancel', pid, render.result)
  await until(async () => JSON.parse((await raw('/api/status')).body).exporting === 0, 15000)
  const shown = app.waitForEvent('window', { timeout: 15000 }).catch(() => null)
  await raw('/api/show', { method: 'POST', type: 'application/json', body: '{}' })
  check('show: the window opens on the Mac', !!(await shown))
  check('…and the endpoint says not hidden', await until(() => ep()?.hidden === false, 5000))
  // (the open project's Claude session may count as work: the console asks the user, then forces)
  const q0 = JSON.parse((await raw('/api/quit', { method: 'POST', type: 'application/json', body: '{"force":false}' })).body)
  const q = q0.ok ? q0 : JSON.parse((await raw('/api/quit', { method: 'POST', type: 'application/json', body: '{"force":true}' })).body)
  check(`quit (${q0.ok ? 'nothing ran' : `asked first: ${JSON.stringify(q0)}`})`, q.ok === true)
  check('…the app quits and its endpoint file goes', await until(() => !ep(), 15000))
  check('the browser says it is reconnecting', await until(async () => web.locator('#ms-web-lost').isVisible(), 20000))
  // the console starts it again (hidden): the page comes back by itself
  const sse = []
  web.on('response', (r) => r.url().includes('/api/events') && sse.push(r.status()))
  let reloaded = false
  web.on('framenavigated', (f) => f === web.mainFrame() && (reloaded = true))
  await closeApp(app)
  app = await launch(['--hidden'])
  check('…and the page reloads once the app is back', await until(() => reloaded, 60000), `events answered: ${sse.join(',')}`)
  await toHome(web)
  check('…to the screens again', (await web.getByTestId('folder-tree').isVisible()) && !(await web.locator('#ms-web-lost').isVisible().catch(() => false)))
} catch (e) {
  failed++
  console.log('✗', e.message)
  if (process.env.MS_WEB_DEBUG) {
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: process.env.MS_WEB_DEBUG }).catch(() => {})
    console.log(webErrors.join('\n'))
  }
} finally {
  await browser.close().catch(() => {})
  relay?.close()
  await closeApp(app)
}
console.log(failed ? `\n${failed} failed` : '\nweb flow: all passed')
process.exit(failed ? 1 : 0)
