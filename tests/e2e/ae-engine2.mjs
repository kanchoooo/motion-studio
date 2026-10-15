// Claude ↔ designer without limits, the engine (no Claude, no clicks): every property keyframes
// (effects, colours, type size, anchor, mask, line drawing), loops, wiggle, a number counter, the
// camera, Claude's motion taken over as keyframes (sampled from the timeline; set and keyframes
// tweens recorded), a character's parts and acting parameters, a flex group set free, a motion
// edit found again after Claude's code moved it — in the preview AND in the exported video.
// Works on a copy of the UI sandbox with a few test layers added to the composition.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-engine2.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'
import { addTestLayers } from './fixtures.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-ae2-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

addTestLayers(join(proj, 'composition', 'index.html'))

grantAccess(join(sandbox, 'userdata'))
const app = await launchApp({ cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})

async function openEditor() {
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ has: win.locator('.ellipsis', { hasText: /^앱 주문 런칭$/ }) }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  await win.locator('[data-layer]').first().waitFor({ timeout: 60000 })
  await win.waitForTimeout(800)
}
const preview = () => win.frames().find((f) => f.url().includes('ms-preview'))
async function ready() {
  for (let i = 0; i < 120; i++) {
    const f = preview()
    const ok = f && (await f.evaluate(() => !!(window.__playerReady && window.__player && window.__MS_RUNTIME__)).catch(() => false))
    if (ok) return f
    await win.waitForTimeout(250)
  }
  throw new Error('preview did not start')
}
async function at(t, fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try {
      const f = await ready()
      await f.evaluate((tt) => window.__player.seek(tt), t)
      await win.waitForTimeout(200)
      return await f.evaluate(fn, arg)
    } catch (e) {
      if (attempt >= 3) throw e
      await win.waitForTimeout(800)
    }
  }
}
const inPreview = async (fn, arg) => (await ready()).evaluate(fn, arg)

try {
  await toHome(win)
  const st0 = await win.evaluate((p) => window.studio.projects.open(p), proj)
  const pid = st0.meta.id
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '준비'), [pid, st0.overrides])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(1200)

  // ---- what the runtime sees before any edit ----
  const els = await inPreview(() => window.__MS_RUNTIME__.listElements())
  const parts = els.filter((e) => e.type === 'part')
  check(`a character's tagged parts are layers (${parts.map((p) => `${p.label}@${p.unit.toFixed(2)}`).join(', ')})`, ['hero::body', 'hero::arm-l', 'hero::head'].every((id) => parts.some((p) => p.id === id && p.parent === 'hero')) && near(parts[0].unit, 1.5, 0.01))
  const hero = els.find((e) => e.id === 'hero')
  check(`its acting parameters are listed (${(hero.rig || []).map((r) => r.name)})`, (hero.rig || []).some((r) => r.name === 'look-x') && hero.rig.some((r) => r.name === 'lid'))
  const tracks = await inPreview(() => window.__MS_RUNTIME__.tracks('hero', ['--look-x']))
  const lk = tracks['--look-x'] || []
  check(`Claude's acting comes out as keyframes (${JSON.stringify(lk)})`, lk.some((k) => near(k.t, 0.5, 0.01) && near(k.v, 0, 0.01)) && lk.some((k) => near(k.t, 1.5, 0.01) && near(k.v, 1, 0.01)))
  const ph = await inPreview(() => window.__MS_RUNTIME__.tracks('phone'))
  const live = await at(0.4, () => +window.gsap.getProperty(document.querySelector('[data-ms-id="phone"]'), 'y'))
  check(`the phone's motion sampled as keys (y: ${(ph.y || []).map((k) => `${k.t}:${Math.round(k.v)}`).join(' ')}; live at 0.4 s ${Math.round(live)})`, (ph.y || []).length >= 3 && (ph.rotation || []).length >= 3 && ph.y.some((k) => near(k.t, 0.05, 0.01) && near(k.v, 900, 1)))
  const motions = await inPreview(() => window.__MS_RUNTIME__.motions())
  check(`set and keyframes tweens are recorded (${motions.filter((m) => m.self === 't-set' || m.self === 't-kf').map((m) => `${m.key}:${m.type}`).join(', ')})`, motions.some((m) => m.self === 't-set' && m.type === 'set') && motions.some((m) => m.self === 't-kf' && m.type === 'keyframes' && m.props.some((p) => p.name === 'x') && m.props.some((p) => p.name === 'y')))
  const flow = await inPreview(() => window.__MS_RUNTIME__.measureFlow('row'))
  check(`a flex group's children are measured (${JSON.stringify(flow.kids)})`, near(flow.kids['row-a']?.l ?? -1, 0, 0.5) && near(flow.kids['row-b']?.l ?? -1, 100, 0.5) && near(flow.kids['row-b']?.w ?? 0, 120, 0.5))
  check('…and until then they only move', els.find((e) => e.id === 'row-b')?.transformable === false)

  // ---- the designer edits ----
  const setKey = motions.find((m) => m.self === 't-set' && m.type === 'fromTo')
  const ov = structuredClone(st0.overrides)
  const E = (id) => (ov.elements[id] ??= {})
  E('bg-ring').keys = { brightness: [{ t: 0, v: 100, e: 'linear' }, { t: 2, v: 200 }], anchorX: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 100 }] }
  E('price').keys = { color: [{ t: 0, v: '#000000', e: 'linear' }, { t: 2, v: '#ffffff' }], fontSize: [{ t: 0, v: 40, e: 'linear' }, { t: 2, v: 80 }] }
  E('price').counter = { from: 0, to: 12900, start: 1, duration: 2, ease: 'linear', decimals: 0, comma: true, suffix: '원' }
  E('t-set').keys = { y: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 100 }] }
  E('t-set').loops = { y: 'cycle' }
  E('t-set').own = { opacity: [{ t: 0, v: 1, e: 'linear' }] }
  E('t-kf').keys = { y: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 100 }] }
  E('t-kf').loops = { y: 'pingpong' }
  E('bg-orb-orange').wiggle = { x: { freq: 2, amount: 30 } }
  E('__camera').transform = { scaleX: 1.1, scaleY: 1.1 }
  E('__camera').keys = { rotate: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 10 }] }
  E('phone').mask = { shape: 'rect', x: 0, y: 0, w: 100, h: 100, feather: 0 }
  E('phone').keys = { maskW: [{ t: 0, v: 100, e: 'linear' }, { t: 2, v: 300 }] }
  E('line').trim = { start: 0, end: 100 }
  E('line').keys = { trimEnd: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 100 }] }
  E('row-a').style = { gradient: { a: '#ff0000', b: '#0000ff', angle: 90 } }
  E('row-b').transform = { rotate: 20 }
  E('hero').own = { '--look-x': [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: -1 }] }
  E('hero::arm-l').transform = { rotate: 40 }
  E('hero::head').keys = { x: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 20 }] }
  ov.freeze = { row: { size: flow.size, kids: flow.kids } }
  // an edit of the set/fromTo tween saved under a key Claude's code no longer has (the code moved)
  ov.motions[`t-set#7`] = { sig: setKey.sig, at: 2, duration: 0.5 }
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '엔진 확인 2'), [pid, ov])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(1500)

  // ---- in the preview ----
  const fx = await at(1, () => getComputedStyle(document.querySelector('[data-ms-wrap-for="bg-ring"]')).filter)
  check(`effects keyframe (brightness 100 → 200 % over 2 s, at 1 s: ${fx})`, /brightness\(1\.5\)/.test(fx))
  const anchor = await at(1, () => getComputedStyle(document.querySelector('[data-ms-wrap-for="bg-ring"]')).getPropertyValue('--ms-ax'))
  check(`the anchor point keyframes (${anchor})`, near(parseFloat(anchor), 50, 0.5))
  const price = await at(1, () => { const el = document.querySelector('[data-ms-id="price"]'); const s = getComputedStyle(el); return [s.color, s.fontSize] })
  check(`text colour and size keyframes (at 1 s: ${price.join(' | ')})`, price[0] === 'rgb(128, 128, 128)' && price[1] === '60px')
  const count = await at(2, () => document.querySelector('[data-ms-id="price"]').textContent)
  check(`a counter with commas (${count} at 2 s)`, count === '6,450원')
  const before = await at(0.5, () => document.querySelector('[data-ms-id="price"]').textContent)
  const after = await at(3.5, () => document.querySelector('[data-ms-id="price"]').textContent)
  check(`the counter holds before and after (${before} … ${after})`, before === '0원' && after === '12,900원')
  const cyc = await at(1.5, () => parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="t-set"]')).getPropertyValue('--ms-y')))
  const pp = await at(1.2, () => parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="t-kf"]')).getPropertyValue('--ms-y')))
  check(`loops: cycle (${cyc} at 1.5 s) and pingpong (${pp} at 1.2 s)`, near(cyc, 50, 0.5) && near(pp, 80, 0.5))
  const wig = []
  for (const t of [0.3, 0.9, 1.6, 2.4]) wig.push(await at(t, () => parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="bg-orb-orange"]')).getPropertyValue('--ms-wx'))))
  check(`wiggle shakes within its amount (${wig.map((v) => v.toFixed(1)).join(', ')})`, wig.every((v) => Math.abs(v) <= 30.01) && new Set(wig.map((v) => v.toFixed(2))).size >= 3)
  const cam = await at(1, () => { const m = new DOMMatrix(getComputedStyle(document.body).transform); return [Math.hypot(m.a, m.b), (Math.atan2(m.b, m.a) * 180) / Math.PI] })
  check(`the camera zooms and turns the whole picture (scale ${cam[0].toFixed(3)}, ${cam[1].toFixed(2)}°)`, near(cam[0], 1.1, 0.002) && near(cam[1], 5, 0.05))
  const mask = await at(1, () => document.querySelector('[data-ms-id="phone"]').style.getPropertyValue('mask-image'))
  check('a keyframed mask is redrawn (200 px wide at 1 s)', /width%3D%22200%22/.test(mask), mask.slice(0, 120))
  const dash = await at(1, () => getComputedStyle(document.querySelector('[data-ms-id="line"] path')).strokeDasharray)
  check(`line drawing (trim end 0 → 100, at 1 s: ${dash})`, near(parseFloat(dash.replace(/^calc\(/, '')), 50, 0.5))
  const grad = await inPreview(() => getComputedStyle(document.querySelector('[data-ms-id="row-a"]')).backgroundImage)
  check(`a gradient fill (${grad})`, /linear-gradient\(90deg, rgb\(255, 0, 0\), rgb\(0, 0, 255\)\)/.test(grad))
  const own = []
  for (const t of [0.5, 1, 2]) own.push(await at(t, () => parseFloat(document.querySelector('[data-ms-id="hero"]').style.getPropertyValue('--look-x'))))
  check(`a character's parameter taken over plays the designer's keys, not Claude's (${own.join(', ')})`, near(own[0], -0.25, 0.02) && near(own[1], -0.5, 0.02) && near(own[2], -1, 0.02))
  const headT = await at(1, () => document.querySelector('#head').getAttribute('transform'))
  check(`the character draws it (${headT})`, /translate\(-10 0\)/.test(headT))
  const arm = await at(1, () => { const w = document.querySelector('[data-ms-wrap-for="hero::arm-l"]'); const s = getComputedStyle(w); return [s.transform, s.transformOrigin] })
  check(`a part turns about its pivot (${arm.join(' | ')})`, /matrix\(0\.766/.test(arm[0]) && /72px 120px/.test(arm[1]))
  const headX = await at(1, () => parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="hero::head"]')).getPropertyValue('--ms-x')))
  check(`a part keyframes (${headX})`, near(headX, 10, 0.2))
  const freeze = await inPreview(() => { const b = document.querySelector('[data-ms-id="row-b"]'); const s = getComputedStyle(b); return [s.position, s.left, !!b.closest('[data-ms-wrap-for="row-b"]')] })
  check(`a group set free: its children placed absolutely and wrapped (${freeze.join(', ')})`, freeze[0] === 'absolute' && freeze[1] === '100px' && freeze[2])
  const rowB = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((e) => e.id === 'row-b')
  check('…so they scale and turn now', rowB?.transformable === true)
  const opac = await at(1.5, () => getComputedStyle(document.querySelector('[data-ms-id="t-set"]')).opacity)
  check(`Claude's set of a property the designer took over is ignored (opacity ${opac})`, opac === '1')
  const moved = (await inPreview(() => window.__MS_RUNTIME__.motions())).find((m) => m.self === 't-set' && m.type === 'fromTo')
  const stale = await inPreview(() => window.__MS_RUNTIME__.audit().stale)
  check(`a motion edit is found again after the code moved (${moved?.editKey}: ${moved?.duration} s, stale ${JSON.stringify(stale)})`, moved?.editKey === 't-set#7' && near(moved.duration, 0.5, 0.001) && !stale.includes('t-set#7'))
  const xEnd = await at(2.6, () => +window.gsap.getProperty(document.querySelector('[data-ms-id="t-set"]'), 'x'))
  check(`…and plays with it (x ${xEnd} at 2.6 s: done after 0.5 s)`, near(xEnd, 300, 0.5))

  // ---- the exported video ----
  await win.evaluate((id) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: 'ae-engine2' }), pid)
  let rec
  for (let i = 0; i < 600 && !rec; i++) {
    await win.waitForTimeout(1000)
    rec = (await win.evaluate((id) => window.studio.renders.list(id), pid)).find((r) => r.fileName.startsWith('ae-engine2'))
  }
  check('export finished', !!rec)
  if (rec) {
    const video = join(proj, rec.file)
    const ffprobe = ffmpeg.replace(/ffmpeg$/, 'ffprobe')
    const [vw] = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim().split(',').map(Number)
    const k = vw / 1920
    const pixel = (t, x, y) => {
      const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${Math.round(x * k)}:${Math.round(y * k)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      return [...raw.subarray(0, 3)]
    }
    // where a composition point lands through the camera at t (scale 1.1, turning 5°/s about the middle)
    const cam = (t, x, y) => {
      const a = ((Math.min(t, 2) * 5) * Math.PI) / 180
      const dx = (x - 960) * 1.1
      const dy = (y - 540) * 1.1
      return [960 + dx * Math.cos(a) - dy * Math.sin(a), 540 + dx * Math.sin(a) + dy * Math.cos(a)]
    }
    const g0 = pixel(1, ...cam(1, 104, 320))
    const g1 = pixel(1, ...cam(1, 176, 320))
    check(`export: gradient through the camera (left ${g0}, right ${g1})`, g0[0] > 180 && g0[2] < 90 && g1[2] > 180 && g1[0] < 90)
    const on = pixel(1, ...cam(1, 150, 150))
    const off = pixel(1, ...cam(1, 450, 150))
    check(`export: the line is half drawn at 1 s (start ${on}, end ${off})`, on[1] > 180 && on[0] < 100 && !(off[1] > 180 && off[0] < 100))
  }
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
