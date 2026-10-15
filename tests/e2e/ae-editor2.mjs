// Claude ↔ designer without limits, in the editor (clicks, like the designer): Claude's motion
// taken over by dragging its diamond or from the inspector (and handed back), stopwatches on
// effects and colours, loops, wiggle, a number counter, the camera, a character's acting
// controls and parts (picked on the canvas, posed), a flex group set free, X/Y apart, gradient
// and line drawing, and edits Claude's code left without a place (moved or thrown away).
// Works on a copy of the UI sandbox with the test layers of fixtures.mjs.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-editor2.mjs
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'
import { addTestLayers } from './fixtures.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-aeui2-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
addTestLayers(join(proj, 'composition', 'index.html'))
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
async function seek(t) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await ready()
    const r = await win.getByTestId('timeline-bar').boundingBox()
    await win.mouse.click(r.x + Math.max(1, Math.min(r.width - 1, (t / 8) * r.width)), r.y + r.height - 4)
    await win.waitForTimeout(400)
    const shown = await win.getByTestId('timecode').innerText()
    const m = shown.match(/(\d+):(\d+)\.(\d+)/)
    const now = m ? +m[1] * 60 + +m[2] + +m[3] / 100 : -1
    if (Math.abs(now - t) < 0.06) return
  }
}
async function screen(x, y) {
  const box = await win.locator('[data-capture-frame]').boundingBox()
  const k = box.width / W
  return { x: box.x + x * k, y: box.y + y * k }
}
/** picks one layer in the timeline (clicking the only selected layer would clear it, so nothing is selected first) */
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
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '준비'), [pid, st0.overrides])
  await win.reload()
  await openEditor()

  // ---- Claude's motion: rows of its own, a diamond dragged takes it over ----
  await select('phone')
  await win.getByTestId('open-phone').click()
  await win.waitForTimeout(400)
  check('Claude\'s motion of a layer shows as property rows', (await win.locator('[data-claudetrack="phone:y"]').count()) === 1 && (await win.locator('[data-claudetrack="phone:rotation"]').count()) === 1)
  const ys = win.getByTestId('ckey-phone-y')
  const n = await ys.count()
  const bar = await win.getByTestId('timeline-bar').boundingBox()
  const k2 = await ys.nth(1).boundingBox()
  await win.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2)
  await win.mouse.down()
  await win.mouse.move(k2.x + k2.width / 2 + (0.5 / 8) * bar.width, k2.y + k2.height / 2, { steps: 8 })
  await win.mouse.up()
  const took = await waitOv((o) => (o.elements.phone?.own?.y ?? []).some((k) => near(k.t, 1.55, 0.04)))
  check(`dragging a Claude diamond takes the property over and moves the key (${n} diamonds; own y: ${took?.elements.phone.own.y.map((k) => k.t.toFixed(2)).join(' ')})`, !!took, JSON.stringify((await ov()).elements.phone?.own))
  await ready()
  await win.waitForTimeout(800)
  check('…its row is the designer\'s now', (await win.locator('[data-keytrack="phone:own:y"]').count()) === 1)

  // the inspector: take over, hand back
  await select('phone')
  await win.getByTestId('take-rotation').click()
  check('"가져오기" takes a property over', !!(await waitOv((o) => (o.elements.phone?.own?.rotation ?? []).length >= 2)))
  await ready()
  await win.waitForTimeout(800)
  await select('phone')
  await win.getByTestId('release-rotation').click()
  check('"돌려주기" hands it back to Claude', !!(await waitOv((o) => !o.elements.phone?.own?.rotation)))
  await ready()
  await win.waitForTimeout(800)

  // ---- stopwatches on effects and colours, a loop ----
  await select('bg-ring')
  await seek(0)
  await win.getByTestId('stopwatch-brightness').click()
  await seek(2)
  await fillNum(win.locator('[data-keyrow="brightness"] .num input'), 180)
  const br = await waitOv((o) => (o.elements['bg-ring']?.keys?.brightness ?? []).length === 2)
  check(`an effect keyframes (brightness ${br?.elements['bg-ring'].keys.brightness.map((k) => `${k.t}:${k.v}`).join(' → ')})`, !!br && br.elements['bg-ring'].keys.brightness[1].v === 180)
  await ready()
  await win.waitForTimeout(600)
  await select('price')
  await seek(0)
  await win.getByTestId('stopwatch-color').click()
  await seek(2)
  await win.locator('[data-keyrow="color"] input.mono').fill('#ff0000')
  const col = await waitOv((o) => (o.elements.price?.keys?.color ?? []).some((k) => k.v === '#ff0000'))
  check(`a colour keyframes (${col?.elements.price.keys.color.map((k) => `${k.t}:${k.v}`).join(' → ')})`, !!col && col.elements.price.keys.color.length === 2)
  await ready()
  await win.waitForTimeout(600)
  await select('price')
  await win.getByTestId('loop-color').click()
  check('the loop switch: repeat', !!(await waitOv((o) => o.elements.price?.loops?.color === 'cycle')))
  await ready()
  await win.waitForTimeout(600)
  await select('price')
  await win.getByTestId('loop-color').click()
  check('…then back and forth', !!(await waitOv((o) => o.elements.price?.loops?.color === 'pingpong')))
  await ready()
  await win.waitForTimeout(600)

  // ---- wiggle, a number counter, X/Y apart ----
  await select('bg-ring')
  await win.locator('[data-testid="wiggle"] .row', { hasText: '가로' }).locator('.toggle').click()
  check('wiggle on', !!(await waitOv((o) => o.elements['bg-ring']?.wiggle?.x?.freq > 0)))
  await ready()
  await win.waitForTimeout(600)
  await select('price')
  await win.locator('[data-testid="counter"] .toggle').first().click()
  const cnt = await waitOv((o) => !!o.elements.price?.counter)
  check(`a counter from the text's number (${JSON.stringify(cnt?.elements.price.counter)})`, cnt?.elements.price.counter.to === 12900 && cnt.elements.price.counter.comma === true && cnt.elements.price.counter.suffix === '원')
  await ready()
  await win.waitForTimeout(600)
  await select('price')
  await win.getByTestId('sep-xy').click()
  check('X/Y apart: one row each', (await win.locator('[data-keyrow="x"]').count()) === 1 && (await win.locator('[data-keyrow="y"]').count()) === 1)

  // ---- a character: acting controls, parts picked on the canvas, posed ----
  await select('hero')
  await seek(1)
  const look = win.locator('[data-testid="character"] .key-row', { hasText: '시선 좌우' }).locator('input')
  check('the character\'s acting controls show', (await look.count()) === 1)
  await fillNum(look, -0.8)
  const acted = await waitOv((o) => (o.elements.hero?.own?.['--look-x'] ?? []).some((k) => near(k.t, 1, 0.05) && near(k.v, -0.8, 0.001)))
  check(`changing one takes Claude's acting over with a key here (${acted?.elements.hero.own['--look-x'].map((k) => `${k.t}:${k.v}`).join(' ')})`, !!acted)
  await ready()
  await win.waitForTimeout(800)
  // the canvas: a click picks the character, the next one the part under the pointer
  await win.keyboard.press('Escape')
  const head = await screen(1650, 665)
  await win.mouse.click(head.x, head.y)
  await win.waitForTimeout(500)
  const first = await win.getByTestId('layer-name').inputValue()
  await win.mouse.click(head.x, head.y)
  await win.waitForTimeout(500)
  const second = await win.getByTestId('layer-name').inputValue()
  check(`a click picks the character, the next its part (${first} → ${second})`, first === '주인공' && second === '머리')
  await fillNum(win.locator('[data-keyrow="rotate"] .num input'), 30)
  check('a part turns', !!(await waitOv((o) => o.elements['hero::head']?.transform?.rotate === 30)))
  await ready()
  await win.waitForTimeout(800)
  await select('hero')
  await win.getByTestId('part-hero::arm-l').click()
  await win.waitForTimeout(300)
  check('the parts are listed under the character', (await win.getByTestId('layer-name').inputValue()) === '왼팔')

  // ---- the camera ----
  await select('__camera')
  await fillNum(win.locator('[data-keyrow="scaleX+scaleY"] .num input').first(), 120)
  check('the camera zooms', !!(await waitOv((o) => near(o.elements.__camera?.transform?.scaleX ?? 1, 1.2, 0.001))))
  await ready()
  await win.waitForTimeout(800)
  const bodyT = await (await ready()).evaluate(() => getComputedStyle(document.body).transform)
  check(`…the whole picture (${bodyT})`, /matrix\(1\.2, 0, 0, 1\.2/.test(bodyT))

  // ---- a flex group set free ----
  await win.getByTestId('open-hero').click().catch(() => {})
  await select('row-b')
  check('a laid-out layer says it only moves', (await win.getByTestId('flow-hint').count()) === 1)
  await win.getByTestId('free-layout').click()
  const fr = await waitOv((o) => !!o.freeze?.row?.kids?.['row-b'])
  check(`"자유 배치로 바꾸기" sets its group free (${JSON.stringify(fr?.freeze?.row?.kids)})`, !!fr && near(fr.freeze.row.kids['row-b'].l, 100, 0.5))
  await ready()
  await win.waitForTimeout(800)
  await select('row-b')
  check('…and it turns and scales now', (await win.locator('[data-keyrow="rotate"]').count()) === 1 && (await win.getByTestId('flow-hint').count()) === 0)

  // ---- gradient, line drawing ----
  await select('row-a')
  await win.locator('.row', { hasText: '그라디언트' }).locator('.toggle').nth(1).click()
  check('a gradient fill', !!(await waitOv((o) => !!o.elements['row-a']?.style?.gradient)))
  await ready()
  await win.waitForTimeout(600)
  await select('line')
  await win.locator('[data-testid="trim"] .toggle').click()
  check('line drawing on', !!(await waitOv((o) => !!o.elements.line?.trim)))
  await ready()
  await win.waitForTimeout(600)

  // ---- edits without a place: Claude's code moved a motion, removed a layer ----
  const cur = await ov()
  cur.motions['phone#9'] = { sig: 'to:bogus', duration: 1 }
  cur.elements['gone-layer'] = { label: '사라진 것', transform: { x: 10 } }
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '테스트: 붙을 곳 없는 수정'), [pid, cur])
  await win.reload()
  await openEditor()
  await win.waitForTimeout(600)
  check('a banner tells about them', (await win.getByTestId('edits-banner').count()) === 1)
  await win.getByTestId('drop-stale').click()
  check('stale motion edits thrown away', !!(await waitOv((o) => !o.motions['phone#9'])))
  await win.waitForTimeout(800)
  await ready()
  await win.getByTestId('orphans-open').click()
  await win.getByTestId('orphan-move-gone-layer').selectOption('price')
  const moved = await waitOv((o) => !o.elements['gone-layer'] && o.elements.price?.transform?.x === 10)
  check('edits of a removed layer moved onto another one', !!moved)
  await win.screenshot({ path: join(shots, 'ae-editor2-end.png') })
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'ae-editor2-fail.png') }).catch(() => {})
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '))
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
