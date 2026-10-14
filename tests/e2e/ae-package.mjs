// After Effects package (experimental), checked without After Effects:
//  1. build.jsx is plain ES3 (ExtendScript) — parsed with acorn, ecmaVersion 3
//  2. it runs against a mock of the AE scripting API (same calls, match names) and
//     creates every layer with its keyframes
//  3. frames rebuilt from the package alone (PNGs + keyframes, using AE's transform
//     rule: position · rotation · scale · −anchor) match the composition's own frames
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/ae-package.mjs
import { _electron as electron, chromium } from 'playwright-core'
import * as acorn from 'acorn'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import sharp from 'sharp'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
function chromePath() {
  const base = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')
  for (const v of existsSync(base) ? readdirSync(base) : [])
    for (const d of readdirSync(join(base, v))) {
      const f = join(base, v, d, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
      if (existsSync(f)) return f
    }
  return execFileSync(process.execPath, [join(root, 'node_modules', 'hyperframes', 'dist', 'cli.js'), 'browser', 'path'], { encoding: 'utf8' }).trim()
}

// ---- a mock of the AE scripting calls build.jsx uses ----
function mockAe(folder) {
  const made = { comps: [], layers: [], imports: [], alerts: [] }
  const prop = (name) => {
    const p = { name, value: undefined, keys: null, props: {}, dimensionsSeparated: false }
    p.setValue = (v) => (p.value = v)
    p.setValuesAtTimes = (t, v) => {
      if (!Array.isArray(t) || t.length !== v.length) throw new Error(`${name}: times/values length`)
      p.keys = { t, v }
    }
    p.property = (n) => (p.props[n] ??= n === 'ADBE Text Document' ? textProp() : prop(n))
    return p
  }
  const textProp = () => {
    const p = prop('ADBE Text Document')
    p.value = { resetCharStyle() {}, font: 'ArialMT' }
    const set = p.setValue
    p.setValue = (doc) => set({ ...doc })
    return p
  }
  const layer = (kind, extra) => {
    const L = { kind, ...extra, props: {}, name: '', inPoint: 0, outPoint: 0, startTime: 0, stretch: 100 }
    L.property = (n) => (L.props[n] ??= prop(n))
    L.sourceRectAtTime = () => ({ left: 0, top: -10, width: 100, height: 40 })
    made.layers.push(L)
    return L
  }
  const comp = (name, w, h, par, dur, fps) => {
    const c = { name, w, h, par, dur, fps, openInViewer() {} }
    c.layers = { add: (item) => layer('footage', { item }), addBoxText: (box, text) => layer('text', { box, text }) }
    made.comps.push(c)
    return c
  }
  class File {
    constructor(p) {
      this.fsName = p
      this.parent = { fsName: dirname(p) }
    }
  }
  class ImportOptions {
    constructor(file) {
      this.file = file
    }
  }
  const app = {
    beginUndoGroup() {},
    endUndoGroup() {},
    project: {
      items: { addFolder: (n) => ({ name: n }), addComp: comp },
      importFile: (io) => {
        if (!existsSync(io.file.fsName)) throw new Error(`missing file ${io.file.fsName}`)
        const item = { file: io.file.fsName, sequence: !!io.sequence, mainSource: {} }
        made.imports.push(item)
        return item
      },
    },
  }
  const ctx = { app, File, ImportOptions, $: { fileName: join(folder, 'build.jsx') }, ParagraphJustification: { LEFT_JUSTIFY: 'L', CENTER_JUSTIFY: 'C', RIGHT_JUSTIFY: 'R' }, alert: (m) => made.alerts.push(m) }
  return { ctx, made }
}

// ---- value of a thinned keyframe track at frame f ----
const at = (k, f) => {
  const [t, v] = k
  if (t.length === 1 || f <= t[0]) return v[0]
  for (let j = 1; j < t.length; j++) if (f <= t[j]) return v[j - 1] + ((v[j] - v[j - 1]) * (f - t[j - 1])) / (t[j] - t[j - 1])
  return v[v.length - 1]
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
// why the app went away, if it does (crash reason in its own output)
let mainOut = ''
app.process().stderr.on('data', (d) => (mainOut = (mainOut + d).slice(-4000)))
app.process().on('exit', (code, signal) => console.log(`app exited: ${code} ${signal ?? ''}\n${mainOut.split('\n').filter((l) => !/INFO:CONSOLE|Security Warning|unsafe-eval|electronjs|consult|This warning|Policy set|unnecessary security/.test(l)).slice(-15).join('\n')}`))
let browser
try {
  await toHome(win)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const t0 = Date.now()
  const folder = await win.evaluate((id) => window.studio.renders.exportAe(id, { name: 'ae-check' }), st.meta.id)
  console.log(`package in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${folder}`)
  const data = JSON.parse(readFileSync(join(folder, 'data.json'), 'utf8'))
  const kinds = data.layers.reduce((m, l) => ({ ...m, [l.type]: (m[l.type] ?? 0) + 1 }), {})
  console.log('layers:', JSON.stringify(kinds), 'sounds:', data.sounds.length)
  check('layers: text + pictures, sounds', (kinds.text ?? 0) > 2 && (kinds.footage ?? 0) + (kinds.sequence ?? 0) > 2 && data.sounds.length > 0)

  // 1. ES3
  const jsx = readFileSync(join(folder, 'build.jsx'), 'utf8')
  let es3 = ''
  try {
    acorn.parse(jsx, { ecmaVersion: 3 })
  } catch (e) {
    es3 = e.message
  }
  check('build.jsx is ES3 (ExtendScript)', !es3, es3)
  check('build.jsx is plain ASCII', !/[^\x00-\x7f]/.test(jsx))

  // 2. runs against the AE API mock
  const { ctx, made } = mockAe(folder)
  let ran = ''
  try {
    vm.runInNewContext(jsx, ctx)
  } catch (e) {
    ran = e.message
  }
  check('runs against the AE scripting API', !ran, ran)
  check(`creates every layer (${made.layers.length})`, made.layers.length === data.layers.length + data.sounds.length)
  const txt = made.layers.find((l) => l.kind === 'text')
  const doc = txt?.props['ADBE Text Properties']?.props['ADBE Text Document']?.value
  check('text layers get font, size and colour', !!doc && doc.font && doc.fontSize > 0 && Array.isArray(doc.fillColor), JSON.stringify(doc))
  const moving = made.layers.filter((l) => l.props['ADBE Transform Group']?.props['ADBE Position_0']?.keys || l.props['ADBE Transform Group']?.props['ADBE Opacity']?.keys)
  check(`keyframes on moving layers (${moving.length})`, moving.length > 3)

  // 3. frames rebuilt from the package vs the composition
  browser = await chromium.launch({ executablePath: chromePath(), args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] })
  const page = await browser.newPage({ viewport: { width: data.width, height: data.height } })
  const { src } = await win.evaluate((id) => window.studio.projects.previewUrl(id), st.meta.id)
  await page.goto(`${src}?ms-preview=1`)
  await page.waitForFunction(() => window.__player && window.__playerReady, null, { timeout: 30000 })
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
  const recon = await browser.newPage({ viewport: { width: data.width, height: data.height } })
  const html = (f) => {
    const parts = data.layers
      .filter((l) => f >= l.in && f < l.out)
      .map((l) => {
        const x = at(l.x, f), y = at(l.y, f), sx = at(l.sx, f) / 100, sy = at(l.sy, f) / 100, r = at(l.rot, f), op = at(l.op, f) / 100
        if (l.type === 'text') {
          const align = { left: 'left', center: 'center', right: 'right' }[l.align]
          return `<div style="position:absolute;left:0;top:0;width:${l.box[0]}px;height:${l.box[1]}px;transform-origin:0 0;transform:translate(${x}px,${y}px) rotate(${r}deg) scale(${sx},${sy}) translate(${l.offset[0]}px,${l.offset[1]}px);opacity:${op};font-family:'${l.family}';font-weight:${l.weight};font-size:${l.size}px;letter-spacing:${(l.tracking * l.size) / 1000}px;line-height:${l.leading}px;color:rgb(${l.color.map((c) => Math.round(c * 255)).join(',')});text-align:${align};white-space:pre-wrap">${l.text.replace(/\r/g, '\n').replace(/</g, '&lt;')}</div>`
        }
        const file = l.type === 'sequence' ? l.file.replace('00001', String(f - l.in + 1).padStart(5, '0')) : l.file
        return `<img src="assets/${file}" style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${x}px,${y}px) rotate(${r}deg) scale(${sx},${sy}) translate(${-l.anchor[0]}px,${-l.anchor[1]}px);opacity:${op}">`
      })
    return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${data.width}px;height:${data.height}px;overflow:hidden;background:#000}</style>${parts.join('')}`
  }
  const diffPct = async (a, b) => {
    const A = await sharp(a).removeAlpha().raw().toBuffer()
    const B = await sharp(b).removeAlpha().raw().toBuffer()
    let bad = 0
    for (let i = 0; i < A.length; i += 3) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 36) bad++
    return (bad / (A.length / 3)) * 100
  }
  for (const sec of [1, 2.5, 4, 6.5]) {
    const f = Math.round(sec * data.fps)
    await page.evaluate((t) => {
      window.__player.pause()
      window.__player.seek(t)
    }, f / data.fps)
    await page.waitForTimeout(250)
    const ref = await page.screenshot()
    const file = join(folder, `check-${f}.html`)
    writeFileSync(file, html(f))
    await recon.goto(pathToFileURL(file).href)
    await recon.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))))
    await recon.waitForTimeout(150)
    const got = await recon.screenshot()
    const d = await diffPct(ref, got)
    await sharp(ref).toFile(join(shots, `ae-ref-${f}.png`))
    await sharp(got).toFile(join(shots, `ae-recon-${f}.png`))
    check(`frame ${f} (${sec}s) rebuilt from the package matches (${d.toFixed(2)}% different)`, d < 3)
  }
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await browser?.close().catch(() => {})
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
