// After Effects–style editing in the editor, by hand (clicks, drags and keys; no Claude):
//  lock (only the designer locks; a locked layer lets clicks through) · add layers · text ·
//  position / stopwatch / keyframes (inspector, timeline diamonds: drag, ease, J/K, delete) ·
//  canvas (move with snapping, scale / rotate / anchor handles, marquee, align, nudge, zoom,
//  rulers and guides, motion path) · duplicate / delete / restore / order / split / trim /
//  in-out handles / rename / solo / hide · effects · mask (drawn on the canvas) · text style ·
//  fill · markers · work area · timecode · copy / paste · undo
// Works on a copy of the UI sandbox.
// MS_SANDBOX=<sandbox with "앱 주문 런칭" (1920×1080, 8 s)> node tests/e2e/ae-editor.mjs
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-aeui-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const W = 1920
const H = 1080
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
const state = () => win.evaluate((id) => window.studio.projects.state(id), pid)
const ov = async () => (await state()).overrides
/** waits until the saved overrides satisfy pred (edits are saved a moment later) */
async function waitOv(pred, ms = 6000) {
  const until = Date.now() + ms
  let last
  while (Date.now() < until) {
    last = await ov()
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
/** reads inside the preview (retrying while it reloads) */
async function inPreview(fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await ready()).evaluate(fn, arg)
    } catch (e) {
      if (attempt >= 4) throw e
      await win.waitForTimeout(700)
    }
  }
}
/** the playhead to t: a click on the timeline ruler, like the designer does */
async function seek(t) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await ready()
    // a click on the ruler, its very start included (the name column's grip stays out of it)
    const r = await win.getByTestId('timeline-bar').boundingBox()
    await win.mouse.click(r.x + Math.max(1, Math.min(r.width - 1, (t / 8) * r.width)), r.y + r.height - 4)
    await win.waitForTimeout(400)
    const shown = await win.getByTestId('timecode').innerText()
    const m = shown.match(/(\d+):(\d+)\.(\d+)/)
    const now = m ? +m[1] * 60 + +m[2] + +m[3] / 100 : -1
    if (Math.abs(now - t) < 0.06) return
    console.log(`   (seek ${t}: the playhead shows ${shown}, again)`)
  }
}
/** composition point → screen point on the canvas */
async function screen(x, y) {
  const box = await win.locator('[data-capture-frame]').boundingBox()
  const k = box.width / W
  return { x: box.x + x * k, y: box.y + y * k, k }
}
/** picks one layer in the timeline (a click on the only selected layer would clear it, so clear first) */
const select = async (id) => {
  await win.locator('[data-testid="timeline"]').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await win.keyboard.press('Escape')
  await win.locator(`[data-layer="${id}"] .ellipsis`).first().click()
  await win.waitForTimeout(300)
}
const layerIds = async () => (await ov()).layers.map((l) => l.id)

try {
  await toHome(win)
  const st0 = await win.evaluate((p) => window.studio.projects.open(p), proj)
  pid = st0.meta.id
  await win.reload()
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ has: win.locator('.ellipsis', { hasText: /^앱 주문 런칭$/ }) }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  // the trust question of this copied folder is not answered: the terminal panel goes away
  await win.locator('button[title="터미널 닫기"]').first().click({ timeout: 5000 }).catch(() => {})
  await ready()
  await win.waitForTimeout(1000)

  // ---- lock: only the designer locks ----
  await select('order-btn-label')
  check('a hand edit is not locked by itself (no lock notice)', !(await win.getByTestId('layer-locked').count()))
  await win.getByTestId('lock-bg-ring').click()
  check('the lock toggle locks a layer', !!(await waitOv((o) => o.elements['bg-ring']?.locked === true)))
  await seek(2)
  const ring = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((e) => e.id === 'bg-ring')
  const pr = await screen(ring.rect.x + ring.rect.w / 2, ring.rect.y + 6)
  await win.keyboard.press('Escape')
  await win.mouse.click(pr.x, pr.y)
  await win.waitForTimeout(300)
  const picked = await win.getByTestId('layer-name').inputValue().catch(() => '')
  check(`a locked layer lets a click through (picked: "${picked}")`, picked !== '배경 원형 라인')
  await win.getByTestId('lock-bg-ring').click()
  check('unlocked again', !!(await waitOv((o) => !o.elements['bg-ring']?.locked)))

  // ---- add a text layer, write its text ----
  await win.keyboard.press('Escape')
  await win.getByTestId('tl-add-layer').click()
  await win.locator('.menu button', { hasText: '텍스트' }).click()
  const withText = await waitOv((o) => o.layers.some((l) => l.kind === 'text'))
  const textId = withText?.layers.find((l) => l.kind === 'text')?.id
  check(`"+ 레이어 › 텍스트" adds a text layer (${textId})`, !!textId)
  await ready()
  await win.waitForTimeout(800)
  await select(textId)
  await win.getByTestId('layer-text').fill('에펙 테스트 문구')
  await win.getByTestId('layer-text').press('Meta+Enter')
  check('its text is saved', !!(await waitOv((o) => o.layers.find((l) => l.id === textId)?.text === '에펙 테스트 문구')))
  check('…and written into the managed block', readFileSync(join(proj, 'composition', 'index.html'), 'utf8').includes('에펙 테스트 문구'))
  await ready()
  await win.waitForTimeout(600)

  // ---- position: fixed value, then keyframes ----
  await select(textId)
  const posX = win.locator('[data-keyrow="x+y"] .num input').first()
  await posX.fill('100')
  await posX.press('Enter')
  check('a position typed in the inspector is a fixed value', !!(await waitOv((o) => o.elements[textId]?.transform?.x === 100)))
  // the very start of the time ruler is the ruler's (the name column's grip used to sit over it)
  await seek(1)
  const bar0 = await win.getByTestId('timeline-bar').boundingBox()
  await win.mouse.click(bar0.x + 1, bar0.y + bar0.height - 4)
  await win.waitForTimeout(400)
  check(`a click at the ruler's very start goes to 0 s (${await win.getByTestId('timecode').innerText()})`, /00:00\.00/.test(await win.getByTestId('timecode').innerText()))
  await seek(0)
  await win.getByTestId('stopwatch-x').click()
  const sw = await waitOv((o) => o.elements[textId]?.keys?.x?.length === 1 && o.elements[textId].keys.x[0].t === 0 && o.elements[textId].keys.x[0].v === 100)
  check('stopwatch: a first keyframe at the playhead', !!sw, JSON.stringify((await ov()).elements[textId]) + ' time=' + (await win.getByTestId('timecode').innerText()))
  await win.screenshot({ path: join(shots, 'ae-editor-stopwatch.png') })
  await ready()
  await seek(2)
  await select(textId)
  const posX2 = win.locator('[data-keyrow="x+y"] .num input').first()
  await posX2.fill('500')
  await posX2.press('Enter')
  const k2 = await waitOv((o) => o.elements[textId]?.keys?.x?.length === 2)
  check(`changing a keyframed value adds a key at the playhead (${JSON.stringify(k2?.elements[textId]?.keys?.x)})`, !!k2 && near(k2.elements[textId].keys.x[1].t, 2, 0.02) && k2.elements[textId].keys.x[1].v === 500)
  await ready()
  const mid = await inPreview((id) => { window.__player.seek(1); return parseFloat(getComputedStyle(document.querySelector(`[data-ms-wrap-for="${id}"]`)).getPropertyValue('--ms-x')) }, textId)
  check(`the layer animates between its keys (x at 1 s = ${mid})`, mid > 150 && mid < 450)

  // ---- timeline keyframes: expand (U), drag, ease, J/K, delete ----
  await select(textId)
  await win.keyboard.press('u')
  await win.waitForTimeout(300)
  const diamonds = win.getByTestId(`key-${textId}-x`)
  check(`U shows the keyframe row with its diamonds (${await diamonds.count()})`, (await diamonds.count()) === 2)
  const second = diamonds.nth(1)
  const b2 = await second.boundingBox()
  const ruler = await win.getByTestId('timeline-bar').boundingBox()
  const perSec = ruler.width / 8
  await win.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2)
  await win.mouse.down()
  await win.mouse.move(b2.x + b2.width / 2 + perSec * 0.5, b2.y + b2.height / 2, { steps: 6 })
  await win.mouse.up()
  const moved = await waitOv((o) => near(o.elements[textId]?.keys?.x?.[1]?.t ?? 0, 2.5, 0.08))
  check(`dragging a diamond moves the key (${moved?.elements[textId]?.keys?.x?.map((k) => k.t.toFixed(2))})`, !!moved, `now ${JSON.stringify((await ov()).elements[textId]?.keys?.x)} · diamond at ${JSON.stringify(b2)} · ruler ${JSON.stringify(ruler)} · picked ${await win.locator('.tl-key.sel').count()}`)
  await ready()
  await win.waitForTimeout(400)
  if (!(await win.getByTestId(`key-${textId}-x`).count())) {
    await select(textId)
    await win.keyboard.press('u')
  }
  await win.getByTestId(`key-${textId}-x`).first().click({ button: 'right' })
  await win.locator('.menu button', { hasText: '직선' }).click()
  check('right-click › 직선 sets the ease of a key', !!(await waitOv((o) => o.elements[textId]?.keys?.x?.[0]?.e === 'linear')))
  await ready()
  await select(textId)
  await seek(0)
  await win.keyboard.press('k')
  await win.waitForTimeout(300)
  const tk = await win.getByTestId('timecode').innerText()
  check(`K jumps to the next keyframe (${tk})`, /00:02\.5|2\.5/.test(tk))
  const jFocus = await win.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)
  await win.keyboard.press('j')
  await win.waitForTimeout(300)
  void jFocus
  check(`J jumps back (${await win.getByTestId('timecode').innerText()})`, /00:00\.00/.test(await win.getByTestId('timecode').innerText()))
  /** the layer's keyframe rows, unfolded */
  const unfold = async (id) => {
    if (await win.getByTestId(`key-${id}-x`).count()) return
    await select(id)
    await win.keyboard.press('u')
    await win.waitForTimeout(300)
  }
  await unfold(textId)
  await win.getByTestId(`key-${textId}-x`).nth(1).click()
  await win.keyboard.press('Delete')
  check('Delete removes the selected keyframe', !!(await waitOv((o) => o.elements[textId]?.keys?.x?.length === 1)))
  await ready()

  // ---- canvas: move with snapping, handles, anchor, nudge ----
  // a rectangle to work with, from the inspector's "레이어 추가"
  await win.keyboard.press('Escape')
  await win.locator('[data-testid="timeline"]').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await win.keyboard.press('Escape')
  await win.getByTestId('add-layer-rect').click()
  const withRect = await waitOv((o) => o.layers.some((l) => l.kind === 'shape'))
  const rectId = withRect?.layers.find((l) => l.kind === 'shape')?.id
  check(`the inspector's "사각형" adds a rectangle (${rectId})`, !!rectId)
  await ready()
  await win.waitForTimeout(700)
  await seek(4)
  const box0 = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((e) => e.id === rectId)
  // drag it so its left edge lands 3 px from the canvas centre: it snaps onto the centre line
  const from = await screen(box0.rect.x + 20, box0.rect.y + 20)
  const target = await screen(W / 2 + 3 + 20, box0.rect.y + 20 + 40)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(target.x, target.y, { steps: 12 })
  const snapLines = await win.locator('.snap-line').count()
  await win.mouse.up()
  const afterMove = await waitOv((o) => o.elements[rectId]?.transform?.x != null)
  let box1
  for (let i = 0; i < 20; i++) {
    box1 = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((e) => e.id === rectId)
    if (Math.abs(box1.rect.x - box0.rect.x) > 1) break
    await win.waitForTimeout(150)
  }
  check(`dragging on the canvas moves the layer and snaps its edge to the centre line (left ${box1.rect.x.toFixed(1)}, snap lines ${snapLines})`, !!afterMove && near(box1.rect.x, W / 2, 1) && snapLines > 0)
  await select(rectId)
  const x0 = (await ov()).elements[rectId].transform.x
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('Shift+ArrowRight')
  check('arrow keys nudge (1 px, Shift 10 px)', !!(await waitOv((o) => o.elements[rectId].transform.x === x0 + 12)))
  // corner handle: bigger, same proportions
  const se = await win.getByTestId('handle-se').boundingBox()
  await win.mouse.move(se.x + se.width / 2, se.y + se.height / 2)
  await win.mouse.down()
  await win.mouse.move(se.x + 60, se.y + 40, { steps: 8 })
  await win.mouse.up()
  const scaled = await waitOv((o) => (o.elements[rectId].transform.scaleX ?? 1) > 1.05)
  const sc = scaled?.elements[rectId].transform
  check(`a corner handle scales proportionally (${sc?.scaleX} × ${sc?.scaleY})`, !!sc && near(sc.scaleX, sc.scaleY, 0.002))
  // edge handle with one axis
  const e = await win.getByTestId('handle-e').boundingBox()
  await win.mouse.move(e.x + e.width / 2, e.y + e.height / 2)
  await win.mouse.down()
  await win.mouse.move(e.x + 50, e.y + e.height / 2, { steps: 6 })
  await win.mouse.up()
  const wide = await waitOv((o) => o.elements[rectId].transform.scaleX > o.elements[rectId].transform.scaleY + 0.03)
  check(`a side handle scales one axis (${wide?.elements[rectId].transform.scaleX?.toFixed(2)} × ${wide?.elements[rectId].transform.scaleY?.toFixed(2)})`, !!wide)
  // rotation knob, Shift snaps to 15°
  const rot = await win.getByTestId('handle-rot').boundingBox()
  const pivot = await win.getByTestId('handle-anchor').boundingBox()
  await win.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2)
  await win.mouse.down()
  await win.keyboard.down('Shift')
  await win.mouse.move(pivot.x + 200, pivot.y + pivot.height / 2, { steps: 10 })
  await win.mouse.up()
  await win.keyboard.up('Shift')
  const rotated = await waitOv((o) => Math.abs(o.elements[rectId].transform.rotate ?? 0) > 1)
  const rv = rotated?.elements[rectId].transform.rotate
  check(`the rotation knob rotates, Shift in 15° steps (${rv}°)`, rv != null && Math.abs(rv % 15) < 0.01)
  // anchor point: the pivot moves, the layer stays put (measured once the turn shows in the preview)
  let before
  for (let i = 0; i < 30; i++) {
    before = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((x) => x.id === rectId).rect
    if (before.h > before.w) break
    await win.waitForTimeout(150)
  }
  const anc = await win.getByTestId('handle-anchor').boundingBox()
  await win.mouse.move(anc.x + anc.width / 2, anc.y + anc.height / 2)
  await win.mouse.down()
  await win.mouse.move(anc.x + anc.width / 2 + 40, anc.y + anc.height / 2 + 25, { steps: 6 })
  await win.mouse.up()
  const anchored = await waitOv((o) => (o.elements[rectId].transform.anchorX ?? 0) !== 0)
  await win.waitForTimeout(600)
  const afterA = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((x) => x.id === rectId).rect
  check(`dragging the anchor point moves the pivot, not the layer (anchor ${anchored?.elements[rectId].transform.anchorX}, ${anchored?.elements[rectId].transform.anchorY}; box moved ${(afterA.x - before.x).toFixed(1)}, ${(afterA.y - before.y).toFixed(1)})`, !!anchored && near(afterA.x, before.x, 2) && near(afterA.y, before.y, 2))
  await win.screenshot({ path: join(shots, 'ae-editor-handles.png') })

  // ---- marquee on the background, align ----
  await win.keyboard.press('Escape')
  await win.getByTestId('add-layer-ellipse').click()
  const withEllipse = await waitOv((o) => o.layers.filter((l) => l.kind === 'shape').length === 2)
  const ellId = withEllipse?.layers.filter((l) => l.kind === 'shape')[1]?.id
  await ready()
  await win.waitForTimeout(800)
  await win.keyboard.press('Escape')
  await seek(4)
  const els = await inPreview(() => window.__MS_RUNTIME__.listElements())
  const rA = els.find((x) => x.id === rectId).rect
  const rB = els.find((x) => x.id === ellId).rect
  const m0 = await screen(Math.min(rA.x, rB.x) - 30, Math.min(rA.y, rB.y) - 30)
  const m1 = await screen(Math.max(rA.x + rA.w, rB.x + rB.w) + 30, Math.max(rA.y + rA.h, rB.y + rB.h) + 30)
  await win.mouse.move(m0.x, m0.y)
  await win.mouse.down()
  await win.mouse.move(m1.x, m1.y, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const multi = await win.getByTestId('multi-editor').count()
  const pickedText = multi ? await win.getByTestId('multi-editor').innerText() : ''
  check(`dragging on the background draws a marquee that picks the layers inside (${pickedText.split('\n')[0]})`, multi > 0 && pickedText.includes('사각형 1') && pickedText.includes('원 1'))
  await win.getByTestId('align-top').click()
  await win.waitForTimeout(900)
  const aligned = await inPreview(([a, b]) => { const l = window.__MS_RUNTIME__.listElements(); return [l.find((x) => x.id === a).rect.y, l.find((x) => x.id === b).rect.y] }, [rectId, ellId])
  check(`align top lines the picked layers up (${aligned.map((v) => v.toFixed(1))})`, near(aligned[0], aligned[1], 1))

  // ---- duplicate / delete / restore / order / split / trim / in-out handle / rename / solo / hide ----
  await select(ellId)
  await win.keyboard.press('Meta+d')
  const dupMine = await waitOv((o) => o.layers.filter((l) => l.kind === 'shape').length === 3)
  check('⌘D copies a layer added by hand', !!dupMine)
  await ready()
  await select('end-brand')
  await win.keyboard.press('Meta+d')
  const dupClaude = await waitOv((o) => o.duplicates.some((d) => d.of === 'end-brand'))
  const copyId = dupClaude?.duplicates.find((d) => d.of === 'end-brand')?.id
  check(`⌘D copies Claude's layer (${copyId})`, !!copyId)
  await ready()
  await seek(6.5)
  const brandPair = await inPreview((c) => { const r = (id) => document.querySelector(`[data-ms-id="${id}"]`).getBoundingClientRect(); const a = r('end-brand'), b = r(c); return [Math.round(a.x), Math.round(b.x), Math.round(a.y), Math.round(b.y)] }, copyId)
  check(`the copy sits on the original with its motion (${brandPair})`, brandPair[0] === brandPair[1] && brandPair[2] === brandPair[3])
  await select('end-kicker')
  await win.keyboard.press('Delete')
  check('Delete on a Claude layer deletes it (restorable)', !!(await waitOv((o) => o.elements['end-kicker']?.deleted === true)))
  await ready()
  await win.locator('[data-layer="end-kicker"]').click({ button: 'right' })
  await win.locator('.menu button', { hasText: '되살리기' }).click()
  check('right-click › 되살리기 brings it back', !!(await waitOv((o) => !o.elements['end-kicker']?.deleted)))
  await ready()
  const rank0 = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((x) => x.id === 'end-ring').rank
  await select('end-ring')
  await win.keyboard.press('Meta+Shift+BracketRight')
  const ordered = await waitOv((o) => Object.values(o.order).some((ids) => ids[0] === 'end-ring'))
  await ready()
  await win.waitForTimeout(500)
  const rank1 = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((x) => x.id === 'end-ring').rank
  check(`⇧⌘] brings a layer to the front of its group (rank ${rank0} → ${rank1})`, !!ordered && rank1 === 0)
  await seek(5)
  await select('end-orb')
  await win.keyboard.press('Meta+Shift+d')
  const split = await waitOv((o) => o.elements['end-orb']?.outPoint != null && o.duplicates.some((d) => d.of === 'end-orb'))
  const splitCopy = split?.duplicates.find((d) => d.of === 'end-orb')?.id
  check(`⇧⌘D splits at the playhead (out ${split?.elements['end-orb']?.outPoint}, copy in ${split?.elements[splitCopy]?.inPoint})`, !!split && near(split.elements['end-orb'].outPoint, 5, 0.05) && near(split.elements[splitCopy].inPoint, 5, 0.05))
  await ready()
  await seek(1)
  await select('app-title')
  await win.keyboard.press('Alt+BracketLeft')
  check('⌥[ puts the in point at the playhead', !!(await waitOv((o) => near(o.elements['app-title']?.inPoint ?? -1, 1, 0.05))))
  await ready()
  // drag the out handle of the background glow to 6 s
  const outGrip = win.getByTestId('out-bg-orb-orange')
  await win.locator('[data-layer="bg-orb-orange"]').hover()
  const og = await outGrip.boundingBox()
  const rl = await win.getByTestId('timeline-bar').boundingBox()
  await win.mouse.move(og.x + og.width / 2, og.y + og.height / 2)
  await win.mouse.down()
  await win.mouse.move(rl.x + (6 / 8) * rl.width, og.y + og.height / 2, { steps: 8 })
  await win.mouse.up()
  check('dragging the out handle trims the layer', !!(await waitOv((o) => near(o.elements['bg-orb-orange']?.outPoint ?? 99, 6, 0.1))))
  await ready()
  await win.locator(`[data-layer="${rectId}"] .ellipsis`).dblclick()
  await win.getByTestId('layer-rename').fill('보라 상자')
  await win.getByTestId('layer-rename').press('Enter')
  check('double-click renames a layer', !!(await waitOv((o) => o.elements[rectId]?.label === '보라 상자')))
  await ready()
  await win.getByTestId(`solo-${rectId}`).click()
  await win.waitForTimeout(500)
  const soloOff = await inPreview((id) => [...document.querySelectorAll('[data-ms-solo-off]')].length > 5 && !document.querySelector(`[data-ms-wrap-for="${id}"]`).hasAttribute('data-ms-solo-off'), rectId)
  check('solo shows only that layer (nothing saved)', soloOff && !(await ov()).elements[rectId]?.solo)
  await win.getByTestId(`solo-${rectId}`).click()

  // ---- effects, mask (drawn on the canvas), text style, fill ----
  await select(rectId)
  const blur = win.locator('[data-keyrow="blur"] .num input')
  await blur.fill('6')
  await blur.press('Enter')
  check('blur in the effects', !!(await waitOv((o) => o.elements[rectId]?.effects?.blur === 6)))
  await win.locator('.row', { hasText: '그림자' }).locator('.toggle').first().click()
  check('drop shadow on', !!(await waitOv((o) => !!o.elements[rectId]?.effects?.shadow)))
  let filt = ''
  for (let i = 0; i < 20 && !/drop-shadow/.test(filt); i++) {
    await win.waitForTimeout(200)
    filt = await inPreview((id) => getComputedStyle(document.querySelector(`[data-ms-wrap-for="${id}"]`)).filter, rectId)
  }
  check(`effects show live (${filt})`, /blur\(6px\)/.test(filt) && /drop-shadow/.test(filt))
  await win.locator('.seg button', { hasText: '타원' }).click()
  check('mask: ellipse', !!(await waitOv((o) => o.elements[rectId]?.mask?.shape === 'ellipse')))
  const mask0 = JSON.stringify((await ov()).elements[rectId].mask)
  await win.getByTestId('mask-draw').click()
  // inside the canvas (the turned, enlarged box reaches past its top)
  const c0 = { x: W / 2 + 10, y: H / 2 + 10 }
  const c1 = { x: W / 2 + 110, y: H / 2 + 90 }
  const d0 = await screen(c0.x, c0.y)
  const d1 = await screen(c1.x, c1.y)
  await win.mouse.move(d0.x, d0.y)
  await win.mouse.down()
  await win.mouse.move(d1.x, d1.y, { steps: 6 })
  const live = await win.getByTestId('mask-live').count()
  await win.mouse.up()
  const drawn = await waitOv((o) => !!o.elements[rectId]?.mask && JSON.stringify(o.elements[rectId].mask) !== mask0)
  // the layer is turned and scaled: the mask is kept in its own coordinates, so its corners land
  // back on the two dragged corners through the layer's map
  const dm = drawn?.elements[rectId]?.mask
  const loc = (await inPreview(() => window.__MS_RUNTIME__.listElements())).find((x) => x.id === rectId).local
  const P = (x, y) => ({ x: loc[0] * x + loc[2] * y + loc[4], y: loc[1] * x + loc[3] * y + loc[5] })
  const corners = dm ? [P(dm.x, dm.y), P(dm.x + dm.w, dm.y), P(dm.x, dm.y + dm.h), P(dm.x + dm.w, dm.y + dm.h)] : []
  const lands = (q) => corners.some((c) => near(c.x, q.x, 4) && near(c.y, q.y, 4))
  const turn = Math.round((Math.atan2(loc[1], loc[0]) * 180) / Math.PI)
  check(`a mask drawn on a turned layer (${turn}°) is kept in the layer's own coordinates (${JSON.stringify(dm)}; corners ${corners.map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(' ')})`, !!dm && turn !== 0 && lands(c0) && lands(c1) && live === 1)
  check('the picked layer shows its mask outline, turned with it', (await win.getByTestId('mask-outline').count()) === 1)
  const where = await inPreview((id) => [getComputedStyle(document.querySelector(`[data-ms-id="${id}"]`)).maskImage, getComputedStyle(document.querySelector(`[data-ms-wrap-for="${id}"]`)).maskImage], rectId)
  check('the mask sits on the layer itself', /svg/.test(where[0]) && where[1] === 'none')
  await select(textId)
  await win.locator('button[title="기울임"]').click()
  await win.locator('button[title="밑줄"]').click()
  await win.locator('.row', { hasText: '글자 테두리' }).locator('.toggle').first().click()
  check('text: italic, underline and stroke', !!(await waitOv((o) => { const t = o.elements[textId]?.style; return t?.fontStyle === 'italic' && t?.textDecoration === 'underline' && !!t?.textStroke })))
  await select('end-panel')
  await win.locator('.row', { hasText: '채우기' }).locator('.toggle').first().click()
  check("fill on Claude's shape", !!(await waitOv((o) => !!o.elements['end-panel']?.style?.fill)))

  // ---- text animator: letters come up one by one ----
  await seek(1)
  await select(textId)
  await win.getByTestId('text-anim-preset').selectOption('fadeUp')
  const ta = await waitOv((o) => o.elements[textId]?.textAnim?.preset === 'fadeUp')
  check(`a text animator preset (${JSON.stringify(ta?.elements[textId]?.textAnim)})`, !!ta && near(ta.elements[textId].textAnim.start, 1, 0.05))
  await ready()
  const letters = async (t) => inPreview(([id, tt]) => {
    window.__player.seek(tt)
    const spans = [...document.querySelectorAll(`[data-ms-id="${id}"] .ms-ta`)]
    return { n: spans.length, first: +getComputedStyle(spans[0]).opacity, last: +getComputedStyle(spans[spans.length - 1]).opacity }
  }, [textId, t])
  const l0 = await letters(0.5)
  const l1 = await letters(1.15)
  const l2 = await letters(4)
  check(`letters appear one after another (before ${l0.first}/${l0.last} · during ${l1.first.toFixed(2)}/${l1.last} · after ${l2.first}/${l2.last}, ${l2.n} letters)`, l0.n > 5 && l0.first === 0 && l1.first > 0 && l1.last === 0 && l2.first === 1 && l2.last === 1)

  // ---- speed curve of a keyframe ----
  await unfold(textId)
  await win.getByTestId(`key-${textId}-x`).first().click({ button: 'right' })
  await win.locator('.menu button', { hasText: '곡선 직접 조절' }).click()
  const h1 = await win.getByTestId('curve-h1').boundingBox()
  await win.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2)
  await win.mouse.down()
  await win.mouse.move(h1.x + 60, h1.y - 120, { steps: 6 })
  await win.mouse.up()
  await win.getByTestId('curve-apply').click()
  const curved = await waitOv((o) => /^cubic-bezier\(/.test(o.elements[textId]?.keys?.x?.[0]?.e ?? '') && o.elements[textId].keys.x[0].e !== 'cubic-bezier(0.33,0,0.67,1)')
  check(`the speed curve sets a custom ease (${curved?.elements[textId]?.keys?.x?.[0]?.e})`, !!curved)

  // ---- audio waveforms: background music, narration and sound effects show their sound ----
  const waves = await win.evaluate(async () => {
    const read = () => {
      const c = [...document.querySelectorAll('[data-testid="waveform"]')]
      const drawn = c.filter((x) => +(x.dataset.loudest ?? 0) > 0.01)
      // painted pixels of the first one
      let ink = 0
      if (c[0]?.width) {
        const px = c[0].getContext('2d').getImageData(0, 0, c[0].width, c[0].height).data
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++
      }
      return { n: c.length, drawn: drawn.length, ink, srcs: [...new Set(c.map((x) => x.dataset.src.split('/').pop()))] }
    }
    for (let i = 0; i < 60; i++) {
      const r = read()
      if (r.n && r.drawn === r.n) return r
      await new Promise((res) => setTimeout(res, 250))
    }
    return read()
  })
  check(`audio clips show their waveform (${waves.drawn}/${waves.n} drawn, ${waves.ink} px of ink: ${waves.srcs.join(', ')})`, waves.n > 0 && waves.drawn === waves.n && waves.ink > 20)

  // ---- markers, work area, timecode, zoom, rulers & guides, motion path ----
  await seek(3)
  await win.getByTestId('add-marker').click()
  const mk = await waitOv((o) => o.markers.length === 1)
  check('a marker at the playhead', !!mk && near(mk.markers[0].t, 3, 0.05))
  await win.getByTestId('marker').locator('span').dblclick()
  await win.getByTestId('marker-rename').fill('엔드 시작')
  await win.getByTestId('marker-rename').press('Enter')
  check('a marker renamed', !!(await waitOv((o) => o.markers[0]?.label === '엔드 시작')))
  await win.keyboard.press('Escape')
  await seek(2)
  await win.keyboard.press('b')
  await seek(4)
  await win.keyboard.press('n')
  check('B / N set the work area', (await win.getByTestId('work-area').getAttribute('class')).includes('active'))
  await win.getByTestId('timecode').click()
  check(`the time shows as frames (${await win.getByTestId('timecode').innerText()})`, /\d\d:\d\d:\d\d:\d\d/.test(await win.getByTestId('timecode').innerText()))
  await win.getByTestId('timecode').click()
  const z0 = await win.getByTestId('canvas-zoom').innerText()
  await win.keyboard.press('Meta+Equal')
  await win.waitForTimeout(200)
  const z1 = await win.getByTestId('canvas-zoom').innerText()
  await win.keyboard.press('Meta+0')
  check(`⌘= zooms the canvas, ⌘0 fits (${z0} → ${z1} → ${await win.getByTestId('canvas-zoom').innerText()})`, parseInt(z1) > parseInt(z0) && (await win.getByTestId('canvas-zoom').innerText()) === z0)
  await win.getByTestId('rulers-toggle').click()
  await win.waitForTimeout(300)
  const rx = await win.getByTestId('ruler-x').boundingBox()
  const fr = await win.locator('[data-capture-frame]').boundingBox()
  await win.mouse.move(fr.x + fr.width / 2, rx.y + rx.height / 2)
  await win.mouse.down()
  await win.mouse.move(fr.x + fr.width / 2, fr.y + fr.height * 0.3, { steps: 6 })
  await win.mouse.up()
  check('dragging out of the ruler makes a guide', !!(await waitOv((o) => o.guides.y.length === 1)))
  await win.getByTestId('rulers-toggle').click()
  await select(textId)
  await seek(0.5)
  check('keyframed position shows its motion path on the canvas', (await win.getByTestId('motion-path').count()) === 1)

  // ---- copy / paste, undo ----
  const before3 = (await ov()).layers.length
  await select(textId)
  await win.keyboard.press('Meta+c')
  await win.keyboard.press('Meta+v')
  check('⌘C ⌘V pastes a copy', !!(await waitOv((o) => o.layers.length === before3 + 1)))
  await ready()
  await win.waitForTimeout(800)
  const focus = await win.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)
  await win.keyboard.press('Meta+z')
  check('⌘Z takes it back', !!(await waitOv((o) => o.layers.length === before3)), `focus ${focus}; layers ${(await ov()).layers.length} (before paste ${before3})`)
  await ready()
  await win.screenshot({ path: join(shots, 'ae-editor-end.png') })
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'ae-editor-fail.png') }).catch(() => {})
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '))
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
