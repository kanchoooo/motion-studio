// After Effects–style editing, the engine (no Claude, no clicks): overrides saved through the
// app are applied by ms-runtime.js in the preview AND in the exported video.
//  keyframes (eased value between keys) · opacity · anchor + rotation · 3D rotation · effects ·
//  mask · in/out points · deleted layer · stacking order · copy of a Claude layer keeps its motion ·
//  text stroke / underline · layers added by hand (text, shape, image, video, adjustment) ·
//  picture replaced · version-1 automatic locks are gone
// Works on a copy of the UI sandbox.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-engine.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-ae-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// media for the layers added by hand: a clip that is red, then green, then blue; two pictures
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=6:r=30',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', join(proj, 'composition', 'assets', 'rgb.mp4')])
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=200x200', '-frames:v', '1', join(proj, 'composition', 'assets', 'yellow.png')])
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=magenta:s=200x200', '-frames:v', '1', join(proj, 'composition', 'assets', 'magenta.png')])

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
/** the preview once its player runs (it is replaced when the project reloads) */
async function ready() {
  for (let i = 0; i < 120; i++) {
    const f = preview()
    const ok = f && (await f.evaluate(() => !!(window.__playerReady && window.__player && window.__MS_RUNTIME__)).catch(() => false))
    if (ok) return f
    await win.waitForTimeout(250)
  }
  throw new Error('preview did not start')
}
/** seeks the preview and reads values inside it */
async function at(t, fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try {
      const f = await ready()
      await f.evaluate((tt) => window.__player.seek(tt), t)
      await win.waitForTimeout(250)
      return await f.evaluate(fn, arg)
    } catch (e) {
      if (attempt >= 3) throw e
      await win.waitForTimeout(800)
    }
  }
}
const wrapVar = (id, name) => `getComputedStyle(document.querySelector('[data-ms-wrap-for="${id}"]')).getPropertyValue('${name}')`

try {
  await toHome(win)
  const st0 = await win.evaluate((p) => window.studio.projects.open(p), proj)
  const pid = st0.meta.id
  check('version-1 automatic locks are gone when the project opens', st0.overrides.version === 2 && !st0.overrides.elements['order-btn-label']?.locked && st0.overrides.elements['order-btn-label']?.text === '바로 주문')

  const ov = structuredClone(st0.overrides)
  const E = (id) => (ov.elements[id] ??= {})
  E('bg').keys = { x: [{ t: 0, v: 0, e: 'linear' }, { t: 2, v: 300 }] }
  E('bg-ring').transform = { opacity: 0.5, rotate: 45, anchorX: 100, anchorY: -50 }
  E('bg-orb-orange').effects = { blur: 12, brightness: 130, shadow: { x: 4, y: 6, blur: 10, color: '#000000' } }
  E('phone').mask = { shape: 'ellipse', x: 0, y: 0, w: 300, h: 300, feather: 20 }
  E('app-title').inPoint = 1.2
  E('app-title').outPoint = 2.0
  E('bg-orb-brown').deleted = true
  E('menu-name').style = { textDecoration: 'underline', textStroke: { width: 3, color: '#ff0000' } }
  E('end-brand').transform = { rotateY: 30 }
  ov.duplicates = [{ id: 'Dcopycard', of: 'menu-card' }]
  E('Dcopycard').label = '메뉴 카드 복사'
  ov.layers = [
    { id: 'Ltext1', kind: 'text', label: '디자이너 텍스트', x: 100, y: 120, w: 700, h: 100, text: '직접 넣은 문구\n두 번째 줄' },
    { id: 'Lshape1', kind: 'shape', label: '빨간 원', shape: 'ellipse', x: 1600, y: 80, w: 200, h: 200 },
    { id: 'Limg1', kind: 'image', label: '노란 그림', src: 'assets/yellow.png', x: 1600, y: 800, w: 200, h: 200, fit: 'fill' },
    { id: 'Lvid1', kind: 'video', label: '색 영상', src: 'assets/rgb.mp4', x: 40, y: 800, w: 320, h: 180, fit: 'fill' },
    { id: 'Ladj1', kind: 'adjustment', label: '흑백 조정', x: 0, y: 0, w: 1920, h: 1080 },
  ]
  E('Lshape1').style = { fill: '#ff0000' }
  E('Ltext1').style = { fontSize: 64, color: '#00ffff' }
  E('Limg1').src = 'assets/magenta.png'
  E('Ladj1').effects = { grayscale: 100 }
  E('Ladj1').inPoint = 5
  E('Ladj1').outPoint = 6
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '엔진 확인'), [pid, ov])
  const html = readFileSync(join(proj, 'composition', 'index.html'), 'utf8')
  check('layers added by hand are written into the managed block', /<!-- ms:layers:start[\s\S]*data-ms-id="Ltext1"[\s\S]*data-ms-id="Lvid1"[\s\S]*<!-- ms:layers:end -->/.test(html))
  check('the block sits inside the root, after Claude\'s layers', html.indexOf('ms:layers:start') > html.indexOf('data-ms-id="end-underline"') && html.indexOf('ms:layers:end') < html.lastIndexOf('</div>'))

  await win.reload()
  await openEditor()
  await win.waitForTimeout(1500)

  // keyframes: x 0 → 300 over 0–2 s (linear)
  const x1 = parseFloat(await at(1, new Function(`return ${wrapVar('bg', '--ms-x')}`)))
  const x3 = parseFloat(await at(3, new Function(`return ${wrapVar('bg', '--ms-x')}`)))
  check(`keyframes animate between keys (x at 1 s = ${x1}, at 3 s = ${x3})`, near(x1, 150, 2) && near(x3, 300, 0.5))

  const ring = await at(2, () => {
    const w = getComputedStyle(document.querySelector('[data-ms-wrap-for="bg-ring"]'))
    return { o: w.opacity, origin: w.transformOrigin, t: w.transform }
  })
  check(`opacity, anchor point and rotation (${JSON.stringify(ring)})`, near(parseFloat(ring.o), 0.5, 0.01) && ring.t !== 'none')
  const orb = await at(2, () => getComputedStyle(document.querySelector('[data-ms-wrap-for="bg-orb-orange"]')).filter)
  check(`effects as a filter (${orb})`, /blur\(12px\)/.test(orb) && /brightness\(1\.3\)/.test(orb) && /drop-shadow/.test(orb))
  const mask = await at(2, () => [getComputedStyle(document.querySelector('[data-ms-id="phone"]')).maskImage, getComputedStyle(document.querySelector('[data-ms-wrap-for="phone"]')).maskImage])
  check('mask as an SVG mask on the layer itself', /data:image\/svg\+xml/.test(mask[0]) && mask[1] === 'none')
  // Claude turns the phone as it leaves (2.72 s +0.6 s, to −10°): the mask turns and moves with it,
  // and the layer's map (what the canvas draws masks through) follows the same turn
  const turned = await at(3.1, () => {
    const el = document.querySelector('[data-ms-id="phone"]')
    const d = window.__MS_RUNTIME__.listElements().find((e) => e.id === 'phone')
    return { gsap: +window.gsap.getProperty(el, 'rotation'), map: (Math.atan2(d.local[1], d.local[0]) * 180) / Math.PI, x: d.local[4], rx: d.rect.x }
  })
  const still = await at(2, () => window.__MS_RUNTIME__.listElements().find((e) => e.id === 'phone').local)
  check(`the mask follows the layer's own motion (turn ${turned.gsap.toFixed(1)}° · map ${turned.map.toFixed(1)}°; moved ${(turned.x - still[4]).toFixed(0)} px)`, turned.gsap < -1 && near(turned.map, turned.gsap, 0.5) && turned.x < still[4] - 50)
  const io = []
  for (const t of [0.5, 1.5, 2.4]) io.push(await at(t, () => getComputedStyle(document.querySelector('[data-ms-wrap-for="app-title"]')).opacity))
  check(`in/out points (${io.join(', ')})`, +io[0] === 0 && +io[1] === 1 && +io[2] === 0)
  const brown = await at(1, () => getComputedStyle(document.querySelector('[data-ms-id="bg-orb-brown"]')).display)
  check('deleted layer is gone', brown === 'none')
  const name = await at(2, () => { const s = getComputedStyle(document.querySelector('[data-ms-id="menu-name"]')); return [s.textDecorationLine, s.webkitTextStrokeWidth] })
  check(`underline and text stroke (${name})`, name[0] === 'underline' && name[1] === '3px')
  const brand = await at(6.5, () => getComputedStyle(document.querySelector('[data-ms-wrap-for="end-brand"]')).transform)
  check(`3D rotation (${brand.slice(0, 40)}…)`, /^matrix3d/.test(brand))

  // copy of a Claude layer: same place and the same motion at every moment (mid-animation too)
  const pair = async (t) => at(t, () => {
    const r = (id) => document.querySelector(`[data-ms-id="${id}"]`).getBoundingClientRect()
    const a = r('menu-card'), b = r('Dcopycard')
    return [a.x, a.y, a.width, b.x, b.y, b.width].map((v) => Math.round(v))
  })
  const p1 = await pair(1.3)
  const p2 = await pair(2.0)
  check(`a copy keeps the original's motion (1.3 s ${p1} · 2.0 s ${p2})`, p1[0] === p1[3] && p1[1] === p1[4] && p1[2] === p1[5] && p2[1] === p2[4] && p1[1] !== p2[1])
  const copyText = await at(2, () => [...document.querySelectorAll('[data-ms-id]')].map((e) => e.getAttribute('data-ms-id')).filter((id) => id.endsWith('@Dcopycard')))
  check(`editable parts inside the copy get their own ids (${copyText.length})`, copyText.includes('menu-name@Dcopycard'))

  // stacking order: put the orange glow on top of its siblings
  const els = await at(2, () => window.__MS_RUNTIME__.listElements())
  const orbEl = els.find((e) => e.id === 'bg-orb-orange')
  const sibs = els.filter((e) => e.stack === orbEl.stack).sort((a, b) => a.rank - b.rank).map((e) => e.id)
  check(`siblings report a stack and a rank (${sibs.slice(0, 5).join(', ')}…)`, sibs.length > 2 && orbEl.rank > 0)
  const st1 = await win.evaluate((id) => window.studio.projects.state(id), pid)
  const ov2 = structuredClone(st1.overrides)
  ov2.order = { [orbEl.stack]: ['bg-orb-orange', ...sibs.filter((x) => x !== 'bg-orb-orange')] }
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '순서'), [pid, ov2])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(1500)
  const after = (await at(2, () => window.__MS_RUNTIME__.listElements())).find((e) => e.id === 'bg-orb-orange')
  check(`stacking order moves a layer to the top of its group (rank ${orbEl.rank} → ${after.rank})`, after.rank === 0)

  // layers added by hand, in the preview
  const added = await at(1.5, () => ['Ltext1', 'Lshape1', 'Limg1', 'Lvid1', 'Ladj1'].map((id) => {
    const el = document.querySelector(`[data-ms-id="${id}"]`)
    return el ? { id, tag: el.tagName, w: Math.round(el.getBoundingClientRect().width), wrapped: el.parentElement.hasAttribute('data-ms-wrap-for'), src: el.getAttribute('src') } : null
  }))
  check(`layers added by hand show and can be edited (${added.map((a) => a && a.id).join(', ')})`, added.every((a) => a && a.wrapped))
  check('a replaced picture shows the new file', added[2]?.src === 'assets/magenta.png')
  const txt = await at(1.5, () => { const el = document.querySelector('[data-ms-id="Ltext1"]'); const s = getComputedStyle(el); return [el.innerText, s.fontSize, s.color] })
  check(`text layer with the designer's style (${txt.join(' | ')})`, txt[0].includes('두 번째 줄') && txt[1] === '64px' && txt[2] === 'rgb(0, 255, 255)')

  // ---- the exported video shows the same ----
  await win.evaluate((id) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: 'ae-engine' }), pid)
  let rec
  for (let i = 0; i < 600 && !rec; i++) {
    await win.waitForTimeout(1000)
    rec = (await win.evaluate((id) => window.studio.renders.list(id), pid)).find((r) => r.fileName.startsWith('ae-engine'))
  }
  check('export finished', !!rec)
  if (rec) {
    const video = join(proj, rec.file)
    const ffprobe = ffmpeg.replace(/ffmpeg$/, 'ffprobe')
    const [vw] = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim().split(',').map(Number)
    const k = vw / 1920
    /** the colour at composition (x, y) at second t of the exported video */
    const pixel = (t, x, y) => {
      const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${Math.round(x * k)}:${Math.round(y * k)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      return [...raw.subarray(0, 3)]
    }
    const red = pixel(1.0, 1700, 180)
    check(`export: shape layer filled red (${red})`, red[0] > 200 && red[1] < 60 && red[2] < 60)
    const clip = [0.5, 1.5, 2.5].map((t) => pixel(t, 200, 890))
    check(`export: the video layer plays (red → green → blue: ${JSON.stringify(clip)})`, clip[0][0] > 180 && clip[1][1] > 180 && clip[2][2] > 180)
    const mag = pixel(1.0, 1700, 900)
    check(`export: replaced picture (${mag})`, mag[0] > 200 && mag[1] < 60 && mag[2] > 200)
    const gray = pixel(5.5, 1700, 180)
    const color = pixel(4.5, 1700, 180)
    check(`export: adjustment layer turns what is below gray only between its in/out (${color} → ${gray})`, color[0] > 200 && color[1] < 60 && Math.abs(gray[0] - gray[1]) < 12 && Math.abs(gray[1] - gray[2]) < 12)
  }
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'ae-engine-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
