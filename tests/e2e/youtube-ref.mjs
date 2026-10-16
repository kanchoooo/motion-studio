// A YouTube address as a reference, really downloaded (needs the internet, no account):
//  - yt-dlp solves YouTube's JS challenges with the app's own Electron as its Node (nothing to
//    install), downloads ≤720p and the frames are taken
//  - a video that cannot be had says why (not "check your connection")
// The sandbox is copied; the copy is removed afterwards.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/youtube-ref.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-yt-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
let failed = 0
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
try {
  await win.waitForFunction(() => !!window.studio, null, { timeout: 30000 })
  const pid = (await win.evaluate((path) => window.studio.projects.open(path), proj)).meta.id
  const settle = async (id) => {
    for (let i = 0; i < 240; i++) {
      const r = (await win.evaluate((p) => window.studio.references.list(p), pid)).find((x) => x.id === id)
      if (r && (r.status === 'ready' || r.status === 'error')) return r
      await win.waitForTimeout(1000)
    }
    return null
  }
  // a short public video, and a Shorts address
  for (const url of ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://www.youtube.com/shorts/tPEE9ZwTmy0']) {
    const added = await win.evaluate(([p, u]) => window.studio.references.addYoutube(p, u), [pid, url])
    const r = await settle(added.id)
    log(url, '→', r?.status, r?.title ?? '', r?.error ?? '')
    check(`downloaded and analysed: ${url}`, r?.status === 'ready' && !!r.file && existsSync(join(proj, r.file)) && (r.frames?.length ?? 0) > 0, JSON.stringify(r))
    if (r?.file) {
      const info = join(proj, 'references', r.id, 'source.info.json')
      check('…at most 720p', !existsSync(info) || (JSON.parse(readFileSync(info, 'utf8')).height ?? 0) <= 720)
    }
  }
  // a video that does not exist: the reason, not the connection hint
  const gone = await win.evaluate(([p, u]) => window.studio.references.addYoutube(p, u), [pid, 'https://www.youtube.com/watch?v=aaaaaaaaaaa'])
  const g = await settle(gone.id)
  log('missing video →', g?.status, g?.error)
  check('a video that cannot be had says why', g?.status === 'error' && !!g.error && !/인터넷 연결을 확인/.test(g.error), JSON.stringify(g))
} catch (e) {
  failed++
  log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
