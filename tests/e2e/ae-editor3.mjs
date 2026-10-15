// Claude ↔ designer without limits, stages 2–3, in the editor (clicks): a layer the app named,
// a styled line edited part by part, a highlighted word, text at set times, a custom text
// animator, a curved motion path (switch, handle on the canvas), the value graph, a stagger
// respaced, a CSS animation in the motion list, parenting / group / matte / motion blur, a clip
// faster, a sound's volume keyframes.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-editor3.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, launchApp, toHome } from './access.mjs'
import { addMoreTestLayers, addTestLayers } from './fixtures.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-aeui3-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const comp = join(proj, 'composition')
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=200x200', '-frames:v', '1', join(comp, 'assets', 'yellow.png')])
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=3:r=30', '-pix_fmt', 'yuv420p', join(comp, 'assets', 'red.mp4')])
addTestLayers(join(comp, 'index.html'))
addMoreTestLayers(join(comp, 'index.html'))
const W = 1920
let failed = 0
const t0 = Date.now()
const check = (name, ok, detail = '') => {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

grantAccess(join(sandbox, 'userdata'))
const app = await launchApp({ cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1700, height: 1150 }).catch(() => {})
const errors = []
win.on('pageerror', (e) => errors.push(e.message))

let pid
const ov = async () => (await win.evaluate((id) => window.studio.projects.state(id), pid)).overrides
async function waitOv(pred, ms = 8000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const last = await ov()
    try {
      if (pred(last)) return last
    } catch {
      /* not yet */
    }
    await win.waitForTimeout(150)
  }
  return null
}
const preview = () => win.frames().find((f) => f.url().includes('ms-preview'))
async function ready() {
  for (let i = 0; i < 160; i++) {
    const f = preview()
    const ok = f && (await f.evaluate(() => !!(window.__playerReady && window.__player && window.__MS_RUNTIME__)).catch(() => false))
    if (ok && (await win.locator('[data-layer]').count())) return f
    await win.waitForTimeout(250)
  }
  throw new Error('preview did not start')
}
const settle = async () => {
  await ready()
  await win.waitForTimeout(700)
}
async function seek(t) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await ready()
    const r = await win.getByTestId('timeline-bar').boundingBox()
    await win.mouse.click(r.x + Math.max(1, Math.min(r.width - 1, (t / 8) * r.width)), r.y + r.height - 4)
    await win.waitForTimeout(400)
    const shown = await win.getByTestId('timecode').innerText()
    const m = shown.match(/(\d+):(\d+)\.(\d+)/)
    if (m && Math.abs(+m[1] * 60 + +m[2] + +m[3] / 100 - t) < 0.06) return
  }
}
async function screen(x, y) {
  const box = await win.locator('[data-capture-frame]').boundingBox()
  const k = box.width / W
  return { x: box.x + x * k, y: box.y + y * k }
}
const select = async (id) => {
  await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await win.keyboard.press('Escape')
  for (let i = 0; i < 3; i++) {
    await win.locator(`[data-layer="${id}"] .ellipsis`).first().click()
    await win.waitForTimeout(350)
    if (await win.locator(`[data-layer="${id}"].sel`).count()) return
  }
}
const fillNum = async (loc, v) => {
  await loc.fill(String(v))
  await loc.press('Enter')
}
async function openEditor() {
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ has: win.locator('.ellipsis', { hasText: /^앱 주문 런칭$/ }) }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  await ready()
  await win.waitForTimeout(1000)
}

try {
  await toHome(win)
  const st0 = await win.evaluate((p) => window.studio.projects.open(p), proj)
  pid = st0.meta.id
  const o0 = structuredClone(st0.overrides)
  o0.layers = [...o0.layers, { id: 'Lclip1', kind: 'video', label: '빨간 영상', src: 'assets/red.mp4', x: 1500, y: 860, w: 320, h: 180, fit: 'fill' }]
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '준비'), [pid, o0])
  await win.reload()
  await openEditor()

  // ---- a layer the app named, a styled line, a highlighted word ----
  check('a text Claude left without an id is a layer of the timeline', (await win.locator('[data-layer="card2~0"]').count()) === 1)
  await select('card2~0')
  await win.getByTestId('layer-text').fill('고친 문구')
  await win.getByTestId('layer-text').press('Meta+Enter')
  check('…and its text can be changed', !!(await waitOv((o) => o.elements['card2~0']?.text === '고친 문구')))
  await settle()
  await select('styled')
  await win.getByTestId('text-run-1').fill('70%')
  await win.getByTestId('text-run-1').press('Enter')
  check('a styled line edited part by part', !!(await waitOv((o) => JSON.stringify(o.elements.styled?.textRuns) === JSON.stringify(['할인 ', '70%', ' 행사']))))
  await settle()
  await select('styled')
  await win.getByTestId('highlight-word').fill('행사')
  await win.getByTestId('highlight-add').click()
  check('a highlighted word', !!(await waitOv((o) => o.elements.styled?.highlights?.[0]?.text === '행사')))
  await settle()

  // ---- text at set times, a custom animator ----
  await select('tt')
  await seek(1)
  await win.getByTestId('timed-text-add').click()
  check('the text changes from here', !!(await waitOv((o) => near(o.elements.tt?.textKeys?.[0]?.t ?? -1, 1, 0.05))))
  await settle()
  await select('tanim')
  await win.getByTestId('text-anim-preset').selectOption('custom')
  await waitOv((o) => o.elements.tanim?.textAnim?.preset === 'custom')
  await settle()
  await select('tanim')
  await fillNum(win.locator('[data-testid="text-anim-custom"] .num input').nth(1), 80)
  check('a custom text animator (Y 80 px)', !!(await waitOv((o) => o.elements.tanim?.textAnim?.custom?.y === 80)))
  await settle()

  // ---- a curved motion path: the switch, a handle on the canvas; the value graph ----
  await select('curve')
  await seek(0)
  await win.getByTestId('stopwatch-x').click()
  await waitOv((o) => (o.elements.curve?.keys?.x ?? []).length === 1)
  await settle()
  await seek(1)
  await select('curve')
  await fillNum(win.locator('[data-keyrow="x+y"] .num input').first(), 400)
  await waitOv((o) => (o.elements.curve?.keys?.x ?? []).length === 2 && (o.elements.curve?.keys?.y ?? []).length === 2)
  await settle()
  await select('curve')
  await win.locator('.seg button', { hasText: '곡선' }).click()
  const curved = await waitOv((o) => (o.elements.curve?.keys?.x ?? []).every((k) => !!k.c))
  check('the motion path curved through its keys', !!curved)
  await settle()
  await select('curve')
  await seek(0.5)
  const hnd = win.getByTestId('path-handle-o').first()
  const hb = await hnd.boundingBox()
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await win.mouse.down()
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 60, { steps: 6 })
  await win.mouse.up()
  const bent = await waitOv((o) => (o.elements.curve?.keys?.x?.[0]?.c?.oy ?? 0) < -50)
  check(`a path handle bends it (out handle ${JSON.stringify(bent?.elements.curve.keys.x[0].c)})`, !!bent)
  await settle()
  await select('curve')
  await win.getByTestId('open-curve').click()
  await win.waitForTimeout(300)
  await win.getByTestId('graph-curve-x').click()
  check('the value graph opens', (await win.getByTestId('value-graph-curve').count()) === 1)
  const gk = await win.locator('[data-testid="value-graph-curve"] circle').nth(1).boundingBox()
  await win.mouse.move(gk.x + gk.width / 2, gk.y + gk.height / 2)
  await win.mouse.down()
  await win.mouse.move(gk.x + gk.width / 2, gk.y + gk.height / 2 + 40, { steps: 6 })
  await win.mouse.up()
  const lowered = await waitOv((o) => { const k = o.elements.curve?.keys?.x?.[1]; return k && k.v < 390 })
  check(`dragging a key down in the graph lowers its value (${lowered?.elements.curve.keys.x[1].v})`, !!lowered)
  await settle()

  // ---- Claude's motions: a stagger respaced, a CSS animation listed ----
  await select('end-headline')
  await win.locator('.seg button', { hasText: 'Claude 모션' }).first().click()
  await win.getByTestId('motion-end-headline#1').click()
  await fillNum(win.locator('[data-testid="stagger"] .num input').first(), 0.2)
  check('a stagger respaced', !!(await waitOv((o) => Object.values(o.motions).some((m) => m.stagger?.each === 0.2))))
  await settle()
  await select('pulse')
  await win.locator('.seg button', { hasText: 'Claude 모션' }).first().click()
  check('a CSS animation is in the motion list', (await win.getByTestId('motion-pulse@msTestPulse#1').count()) === 1)
  await win.locator('.seg button', { hasText: '레이어' }).first().click()

  // ---- linking and compositing ----
  await select('child')
  await win.getByTestId('link-parent').selectOption('phone')
  check('a parent', !!(await waitOv((o) => o.elements.child?.parent?.id === 'phone')))
  await settle()
  await select('child')
  await win.getByTestId('link-group').selectOption('row')
  check('into another group', !!(await waitOv((o) => o.elements.child?.moveTo === 'row')))
  await settle()
  await select('mattebox')
  await win.getByTestId('link-matte').selectOption('matteimg')
  check('a track matte', !!(await waitOv((o) => o.elements.mattebox?.matte?.layer === 'matteimg')))
  await settle()
  await select('blurbox')
  await win.locator('[data-testid="link"] .row', { hasText: '모션 블러' }).locator('.toggle').click()
  check('motion blur on', !!(await waitOv((o) => (o.elements.blurbox?.motionBlur ?? 0) > 0)))
  await settle()
  await select('Lclip1')
  await fillNum(win.locator('[data-testid="link"] .num input').first(), 2)
  check('a clip twice as fast', !!(await waitOv((o) => o.elements.Lclip1?.videoFx?.speed === 2)))
  await settle()

  // ---- a sound's volume keyframes ----
  await win.locator('.seg button', { hasText: '사운드' }).first().click()
  await win.locator('button', { hasText: '띵 · 브랜드 마무리' }).first().click().catch(() => {})
  if (!(await win.getByTestId('volume-key-add').count())) {
    // the effect sits in its group list: open it
    await win.locator('[title*="띵"]').first().dispatchEvent('pointerdown')
    await win.waitForTimeout(300)
  }
  await seek(4.6)
  await win.getByTestId('volume-key-add').click()
  check('a volume keyframe at the playhead', !!(await waitOv((o) => (o.audio['sfx-ding-1']?.volumeKeys ?? []).length === 1)))
  await win.screenshot({ path: join(shots, 'ae-editor3-end.png') })
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'ae-editor3-fail.png') }).catch(() => {})
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '))
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
