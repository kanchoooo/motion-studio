// Claude ↔ designer without limits, stages 2–3, the engine (no Claude, no clicks): layers the
// app names itself, a styled line edited part by part, highlighted words, text that changes at
// set times, a custom text animator, a curved motion path, CSS animations retimed, a stagger
// respaced, parenting, a layer moved into another group, a mask following the element's own
// motion, a track matte, motion blur, a clip played backwards, a music volume curve — in the
// preview AND in the exported video.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-engine3.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'
import { addMoreTestLayers, addTestLayers } from './fixtures.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-ae3-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const comp = join(proj, 'composition')
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
// pictures and a clip: red 1 s → green 1 s → blue 6 s
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=200x200', '-frames:v', '1', join(comp, 'assets', 'yellow.png')])
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=6:r=30',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-pix_fmt', 'yuv420p', join(comp, 'assets', 'rgb.mp4')])
addTestLayers(join(comp, 'index.html'))
addMoreTestLayers(join(comp, 'index.html'))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

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
const rectOf = (id) => { const r = document.querySelector(`[data-ms-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }

try {
  await toHome(win)
  const st0 = await win.evaluate((p) => window.studio.projects.open(p), proj)
  const pid = st0.meta.id
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '준비'), [pid, st0.overrides])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(1200)

  // ---- before any edit ----
  const els = await inPreview(() => window.__MS_RUNTIME__.listElements())
  const auto = els.filter((e) => e.auto)
  check(`text and a picture Claude left without ids are layers (${auto.map((e) => `${e.id}:${e.type}`).join(', ')})`, auto.some((e) => e.id === 'card2~0' && e.type === 'text') && auto.some((e) => e.id === 'card2~1' && e.type === 'image'))
  const audit = await inPreview(() => window.__MS_RUNTIME__.audit().loose)
  check('…and Claude is still told they had none', audit.some((l) => l.id === 'card2'))
  const styled = els.find((e) => e.id === 'styled')
  check(`a styled line comes in parts (${JSON.stringify(styled?.runs)})`, JSON.stringify(styled?.runs) === JSON.stringify(['할인 ', '50%', ' 행사']))
  const motions = await inPreview(() => window.__MS_RUNTIME__.motions())
  const css = motions.find((m) => m.type === 'css' && m.self === 'pulse')
  check(`a CSS animation is listed with the motions (${css?.key}: ${css?.start}–${css?.end} s)`, !!css && near(css.start, 1, 0.01) && near(css.end, 3, 0.01))
  const stag = motions.find((m) => m.sig === 'fromTo:opacity,rotationX,y' && m.key.startsWith('end-'))
  check(`a staggered motion of Claude's (${stag?.key})`, !!stag)
  const childAt2 = await at(2, rectOf, 'child')
  const tsetBefore = await at(0, rectOf, 't-set')
  const maskAt0 = await at(0, () => document.querySelector('[data-ms-wrap-for="masked"]')?.style.getPropertyValue('mask-image') || getComputedStyle(document.querySelector('[data-ms-wrap-for="masked"]')).maskImage)

  // ---- the edits ----
  const ov = structuredClone(st0.overrides)
  const E = (id) => (ov.elements[id] ??= {})
  E('card2~0').text = '이제 고칠 수 있는 문구'
  E('styled').textRuns = ['세일 ', '70%', ' 진행']
  E('styled').highlights = [{ text: '진행', color: '#00ff00', weight: 800 }]
  E('tt').textKeys = [{ t: 1, text: '둘' }, { t: 2, text: '셋' }]
  E('tanim').textAnim = { preset: 'custom', start: 1, duration: 0.5, stagger: 0.1, by: 'char', custom: { y: 40, opacity: 0, rotate: 20 }, order: 'end' }
  E('curve').keys = { x: [{ t: 0, v: 0, e: 'linear', c: { ox: 0, oy: -200, ix: 0, iy: 0 } }, { t: 1, v: 400, c: { ox: 0, oy: 0, ix: 0, iy: -200 } }], y: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 0 }] }
  ov.motions[css.key] = { sig: css.sig, shift: 1, duration: 1, at: 1 }
  ov.motions[stag.key] = { sig: stag.sig, stagger: { each: 0.2 }, at: 3.6 }
  E('child').parent = { id: 'phone', at: 2 }
  E('t-set').moveTo = 'row'
  E('masked').mask = { shape: 'rect', x: 0, y: 0, w: 50, h: 50, feather: 0 }
  E('mattebox').matte = { layer: 'matteimg', mode: 'alpha' }
  E('blurbox').keys = { x: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 600 }] }
  E('blurbox').motionBlur = 0.5
  ov.layers = [...ov.layers, { id: 'Lrev1', kind: 'video', label: '거꾸로 영상', src: 'assets/rgb.mp4', x: 1500, y: 860, w: 320, h: 180, fit: 'fill' }]
  E('Lrev1').videoFx = { reverse: true }
  ov.audio['sfx-ding-1'] = { ...(ov.audio['sfx-ding-1'] ?? {}), volumeKeys: [{ t: 4.55, v: 1, e: 'linear' }, { t: 5.2, v: 0 }] }
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '엔진 확인 3'), [pid, ov])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(1500)

  // ---- in the preview ----
  const auto0 = await inPreview(() => document.querySelector('[data-ms-id="card2~0"]')?.textContent)
  check(`a layer the app named takes the designer's text (${auto0})`, auto0 === '이제 고칠 수 있는 문구')
  const st = await inPreview(() => { const el = document.querySelector('[data-ms-id="styled"]'); return [el.innerText, getComputedStyle(el.querySelector('b')).color, getComputedStyle(el.querySelector('[data-ms-highlight]')).color, getComputedStyle(el.querySelector('[data-ms-highlight]')).fontWeight] })
  check(`a styled line edited part by part keeps its style; a highlighted word (${st.join(' | ')})`, st[0] === '세일 70% 진행' && st[1] === 'rgb(255, 0, 0)' && st[2] === 'rgb(0, 255, 0)' && st[3] === '800')
  const tt = []
  for (const t of [0.5, 1.5, 2.5]) tt.push(await at(t, () => document.querySelector('[data-ms-id="tt"]').textContent))
  check(`text that changes at set times (${tt.join(' → ')})`, tt.join() === '하나,둘,셋')
  const ta = await at(1.05, () => [...document.querySelectorAll('[data-ms-id="tanim"] .ms-ta')].map((s) => +getComputedStyle(s).opacity))
  check(`a custom text animator, the last letter first (${ta.map((v) => v.toFixed(2)).join(' ')})`, ta.length === 5 && ta[4] > 0 && ta[0] === 0)
  const cy = await at(0.5, () => [parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="curve"]')).getPropertyValue('--ms-x')), parseFloat(getComputedStyle(document.querySelector('[data-ms-wrap-for="curve"]')).getPropertyValue('--ms-y'))])
  check(`a curved motion path (${cy.map((v) => v.toFixed(1)).join(', ')} at 0.5 s)`, near(cy[0], 200, 2) && near(cy[1], -150, 2))
  const pul = await at(2.5, () => +getComputedStyle(document.querySelector('[data-ms-id="pulse"]')).opacity)
  check(`a CSS animation retimed (opacity ${pul.toFixed(2)} at 2.5 s: starts at 2, lasts 1 s)`, near(pul, 0.6, 0.03))
  const chars = await at(3.7, () => [...document.querySelectorAll('[data-ms-id="end-headline"] .ch')].slice(0, 2).map((s) => +getComputedStyle(s).opacity))
  check(`a stagger respaced (first two letters at 3.7 s: ${chars.map((v) => v.toFixed(2)).join(', ')})`, chars[0] > 0 && chars[1] === 0)
  const childAt3 = await at(3.0, rectOf, 'child')
  const phoneAt = [await at(2, rectOf, 'phone'), await at(3.0, rectOf, 'phone')]
  check(`a layer follows its parent (child moved ${(childAt3.x - childAt2.x).toFixed(0)} px while the phone moved ${(phoneAt[1].x - phoneAt[0].x).toFixed(0)} px)`, childAt3.x < childAt2.x - 50)
  const ts = await at(0, () => { const el = document.querySelector('[data-ms-id="t-set"]'); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, inRow: !!el.closest('[data-ms-id="row"]') } })
  check(`a layer moved into another group stays where it was (${ts.inRow ? 'in the row' : 'not moved'}, ${ts.x.toFixed(0)},${ts.y.toFixed(0)} vs ${tsetBefore.x.toFixed(0)},${tsetBefore.y.toFixed(0)})`, ts.inRow && near(ts.x, tsetBefore.x, 1) && near(ts.y, tsetBefore.y, 1))
  const m1 = await at(1, () => document.querySelector('[data-ms-wrap-for="masked"]').style.getPropertyValue('mask-image'))
  const x0 = +(decodeURIComponent(m1).match(/<rect x="([-\d.]+)" y/) || [])[1]
  check(`a mask on a layer masked by its own code follows its motion (rect at x ${x0.toFixed(0)} at 1 s)`, near(x0, 400 + 150, 2), decodeURIComponent(m1).slice(0, 200))
  void maskAt0
  const mat = await inPreview(() => { const s = getComputedStyle(document.querySelector('[data-ms-id="mattebox"]')); return [s.maskImage, s.maskSize, s.maskPosition, getComputedStyle(document.querySelector('[data-ms-wrap-for="matteimg"]')).visibility] })
  check(`a track matte (${mat.slice(1).join(' | ')})`, /url\(/.test(mat[0]) && /100px 100px/.test(mat[1]) && /50px 50px/.test(mat[2]) && mat[3] === 'hidden')
  const mb = await at(0.5, () => document.querySelector('#msmb-blurbox feGaussianBlur')?.getAttribute('stdDeviation'))
  check(`motion blur along the movement (${mb})`, !!mb && near(parseFloat(mb), 5, 0.6) && parseFloat(mb.split(' ')[1]) === 0)
  const vids = readdirSync(join(comp, 'assets', '.ms-video'))
  check(`a clip played backwards is written once (${vids.join(', ')})`, vids.length === 1 && /^Lrev1-/.test(vids[0]))
  const html = readFileSync(join(comp, 'index.html'), 'utf8')
  const ding = html.match(/<audio[^>]*data-ms-id="sfx-ding-1"[^>]*>/)?.[0] ?? ''
  const wav = ding.match(/\ssrc="([^"]+)"/)?.[1] ?? ''
  check(`a sound with a volume curve plays the app's file (${wav})`, /^assets\/\.ms-audio\/sfx-ding-1-/.test(wav) && /data-media-start="0"/.test(ding) && existsSync(join(comp, wav)))
  if (existsSync(join(comp, wav))) {
    // loudest sample in a stretch of the file (ffmpeg's volumedetect writes to stderr)
    const peak = (from, len) => {
      const r = spawnSync(ffmpeg, ['-hide_banner', '-ss', String(from), '-t', String(len), '-i', join(comp, wav), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
      return parseFloat(String(r.stderr).match(/max_volume: (-?[\d.]+)/)?.[1] ?? 'NaN')
    }
    const a = peak(0, 0.15)
    const b = peak(0.6, 0.1)
    check(`…and it fades as the keys say (start ${a} dB, at 0.6 s ${b} dB)`, b < a - 10, `${a} ${b}`)
  }

  // ---- the exported video ----
  await win.evaluate((id) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: 'ae-engine3' }), pid)
  let rec
  for (let i = 0; i < 600 && !rec; i++) {
    await win.waitForTimeout(1000)
    rec = (await win.evaluate((id) => window.studio.renders.list(id), pid)).find((r) => r.fileName.startsWith('ae-engine3'))
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
    const inside = pixel(1, 1100, 200)
    const outside = pixel(1, 1300, 200)
    check(`export: the track matte shows the box only inside the picture (inside ${inside}, outside ${outside})`, inside[0] > 200 && inside[1] < 60 && !(outside[0] > 200 && outside[1] < 60))
    const rev = pixel(0.5, 1660, 950)
    check(`export: the clip plays backwards (blue first: ${rev})`, rev[2] > 180 && rev[0] < 80)
  }
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
