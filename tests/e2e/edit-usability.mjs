// Editing usability (beta.5), in the app with a copy of the "앱 주문 런칭" project and a few test
// layers on top of it:
//  - the layer list stays at the top of the 레이어 panel; search by name / text / kind; kinds filter;
//    a plain colour box inside a group is a layer of its own
//  - a click on the canvas picks the layer seen at that moment (not one faded out on top of it);
//    ⌥-click goes one layer down; the grey area around the frame clears the selection
//  - right-click lists the layers at that spot and adds guides; the pointed layer is named on hover
//  - ⌘↓ picks the next layer; scaling snaps to a guide
//  - a timeline bar drag snaps to another layer's start and takes the layer's keys and in point along
//  - a text with its own box offers 배경 따로 떼기
//  - editing checks: a click in and out of a number field saves nothing; ⇧⌘D's second half shows;
//    ⌘A leaves the camera out; shortcuts work with the Korean keyboard on
//  - the 영역 / 핀 tools are in the chat box only (a hint on the canvas while marking); pins take images and videos (a video gets a still for
//    Claude); what they are for is written in the pin's comment, as before (no picker)
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/edit-usability.mjs
// (the sandbox is copied; the copy is removed afterwards)
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = process.env.MS_SANDBOX
const sandbox = mkdtempSync(join(tmpdir(), 'ms-ux-'))
cpSync(join(base, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(base, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const shots = join(root, 'tests', 'e2e', 'shots')

// ---- test layers on top of everything, and the designer's own keys on one of them ----
const comp = join(proj, 'composition', 'index.html')
let html = readFileSync(comp, 'utf8')
const layers = `
      <div data-ms-id="ux-a" data-ms-type="shape" data-ms-label="겹침 아래" style="position:absolute;left:1600px;top:700px;width:220px;height:140px;background:#3366ff"></div>
      <div data-ms-id="ux-b" data-ms-type="shape" data-ms-label="겹침 위" style="position:absolute;left:1600px;top:700px;width:220px;height:140px;background:#ff3366"></div>
      <div data-ms-id="ux-badge" data-ms-type="text" data-ms-label="배지 글자" style="position:absolute;left:1620px;top:900px;background:#ffcc00;color:#000;padding:6px 14px;border-radius:20px;font-size:32px">NEW</div>
      <div data-ms-id="ux-card" data-ms-type="group" data-ms-label="UX 카드" style="position:absolute;left:1300px;top:900px;width:240px;height:120px">
        <div style="position:absolute;inset:0;background:#22aa66;border-radius:16px"></div>
        <span style="position:relative;font-size:28px;color:#fff">카드 문구</span>
      </div>`
const rootTag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
const endOfRoot = html.lastIndexOf('</div>', html.indexOf('<script>', rootTag.index))
html = html.slice(0, endOfRoot) + layers + '\n    ' + html.slice(endOfRoot)
html = html.replace(
  'window.__timelines["main"] = tl;',
  `tl.set('[data-ms-id="ux-b"]', { autoAlpha: 0 }, 0);
      tl.to('[data-ms-id="ux-b"]', { autoAlpha: 1, duration: 0.2 }, 4);
      tl.from('[data-ms-id="ux-a"]', { x: -40, duration: 1, ease: 'none' }, 1);
      window.__timelines["main"] = tl;`,
)
writeFileSync(comp, html)
const ovFile = join(proj, 'overrides.json')
const ov0 = JSON.parse(readFileSync(ovFile, 'utf8'))
ov0.elements = { ...(ov0.elements ?? {}), 'ux-a': { keys: { opacity: [{ t: 1.5, v: 1 }, { t: 2.5, v: 0.5 }] }, inPoint: 0.5 } }
ov0.guides = { x: [], y: [] }
writeFileSync(ovFile, JSON.stringify(ov0, null, 2))
const overrides = () => JSON.parse(readFileSync(ovFile, 'utf8'))
// a picture and a clip to put on pins (made with the app's own ffmpeg)
const ffmpeg = join(root, 'resources', 'bin', `darwin-${process.arch}`, 'ffmpeg')
const pinImage = join(sandbox, 'look.png')
const pinVideo = join(sandbox, 'clip.mp4')
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180', '-frames:v', '1', pinImage])
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=30', '-pix_fmt', 'yuv420p', pinVideo])

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const picked = async () => (await win.locator('[data-testid="layer-row"].sel').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row')))) ?? []
/** a composition point on the screen */
const at = async (x, y) => {
  const f = await win.locator('[data-capture-frame]').boundingBox()
  return { x: f.x + (x * f.width) / 1920, y: f.y + (y * f.height) / 1080 }
}
const settle = (ms = 600) => win.waitForTimeout(ms)
const until = async (f, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await f()) return true
    await win.waitForTimeout(150)
  }
  return false
}

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.locator('[data-layer="ux-a"]').waitFor({ timeout: 30000 })
  await settle(1500)

  // ---- the layer list ----
  const list = win.getByTestId('layer-list')
  check('the layer list is shown with nothing picked', await list.isVisible())
  const all = await win.getByTestId('layer-row').count()
  await win.getByTestId('layer-search').fill('겹침')
  const found = await win.getByTestId('layer-row').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row')))
  check('search by name', JSON.stringify(found.sort()) === JSON.stringify(['ux-a', 'ux-b']), JSON.stringify(found))
  await win.getByTestId('layer-search').fill('카드 문구')
  check('search by the text a layer shows', (await win.getByTestId('layer-row').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row')))).some((id) => id.startsWith('ux-card~')))
  await win.getByTestId('layer-search').fill('상자')
  check('a plain colour box in a group is a layer ("상자")', (await win.getByTestId('layer-row').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-row')))).includes('ux-card~0'))
  await win.getByTestId('layer-search').fill('')
  await win.getByTestId('layer-kind-text').click()
  const texts = await win.getByTestId('layer-row').count()
  check('the 글자 filter narrows the list', texts > 0 && texts < all, `${texts}/${all}`)
  await win.getByTestId('layer-kind-all').click()

  // a pick from the list: the list stays, the layer's settings come under it
  await win.locator('[data-testid="layer-row"][data-row="ux-badge"] button.row').click()
  await settle()
  check('the list stays while a layer is picked', (await list.isVisible()) && (await picked()).includes('ux-badge'))
  check('a text with its own box offers 배경 따로 떼기', await win.getByTestId('split-box').isVisible())
  await win.getByTestId('split-box-run').click()
  check('…which needs Claude to be ready (said, nothing breaks)', await until(async () => (await win.locator('.toast').allInnerTexts()).some((t) => t.includes('대기 중일 때'))))

  // ---- clicking the canvas: what is seen now ----
  await win.keyboard.press('Escape')
  await win.keyboard.press('Home')
  // 2 s: the lower one shows (its in point is 0.5 s), the upper one only from 4 s
  for (let i = 0; i < 6; i++) await win.keyboard.press('Shift+PageDown')
  await settle(900)
  // off-centre: the centre of a picked layer is its anchor point handle
  let p = await at(1650, 730)
  await win.mouse.click(p.x, p.y)
  await settle()
  check('the visible layer is picked, not the faded-out one on top', JSON.stringify(await picked()) === JSON.stringify(['ux-a']), JSON.stringify(await picked()))
  await win.keyboard.press('End')
  await settle(1200)
  await win.mouse.click(p.x, p.y)
  await settle()
  check('once the top one shows, it is picked', JSON.stringify(await picked()) === JSON.stringify(['ux-b']), JSON.stringify(await picked()))
  await win.keyboard.down('Alt')
  await win.mouse.click(p.x, p.y)
  await win.keyboard.up('Alt')
  await settle()
  check('⌥-click picks the layer under it', JSON.stringify(await picked()) === JSON.stringify(['ux-a']), JSON.stringify(await picked()))

  // hover names the layer
  const b = await at(1660, 925)
  await win.mouse.move(b.x, b.y)
  check('pointing at a layer names it', await until(async () => (await win.getByTestId('hover-label').count()) > 0 && (await win.getByTestId('hover-label').innerText()).includes('배지')))

  // ---- right-click: the layers here, guides ----
  await win.mouse.click(p.x, p.y, { button: 'right' })
  await win.getByTestId('here-layer').first().waitFor({ timeout: 5000 })
  const here = await win.getByTestId('here-layer').allInnerTexts()
  check('right-click lists the layers at that spot, top first', here.length >= 2 && here[0].includes('겹침 위'), JSON.stringify(here))
  await win.getByTestId('add-guide-y').click()
  check('a horizontal guide from the menu', await until(async () => (await win.getByTestId('canvas-guide').count()) === 1))
  check('…saved with the project', await until(() => overrides().guides?.y?.length === 1, 5000), JSON.stringify(overrides().guides))
  const g = await at(1880, 300)
  await win.mouse.click(g.x, g.y, { button: 'right' })
  await win.getByTestId('add-guide-x').click()
  await until(async () => (await win.getByTestId('canvas-guide').count()) === 2)

  // ---- the grey area around the frame clears the selection ----
  await win.keyboard.press('Meta+Minus')
  await win.keyboard.press('Meta+Minus')
  await settle()
  const host = await win.getByTestId('canvas-letterbox').boundingBox()
  await win.mouse.click(host.x + 10, host.y + host.height - 12)
  await settle()
  check('a click around the frame clears the selection', (await picked()).length === 0, JSON.stringify(await picked()))
  await win.keyboard.press('Meta+0')
  await settle()

  // ---- ⌘↓: the next layer ----
  await win.locator('[data-testid="layer-row"][data-row="ux-a"] button.row').click()
  await win.keyboard.press('Meta+ArrowDown')
  await settle()
  const next = await picked()
  check('⌘↓ picks the next layer', next.length === 1 && next[0] !== 'ux-a', JSON.stringify(next))

  // ---- scaling snaps to a guide ----
  await win.locator('[data-testid="layer-row"][data-row="ux-badge"] button.row').click()
  await settle()
  const e = await win.getByTestId('handle-e').boundingBox()
  const target = await at(1878, 925)
  await win.mouse.move(e.x + e.width / 2, e.y + e.height / 2)
  await win.mouse.down()
  await win.mouse.move(target.x - 20, e.y + e.height / 2, { steps: 4 })
  await win.mouse.move(target.x, e.y + e.height / 2, { steps: 4 })
  const snapped = (await win.locator('.snap-line.x').count()) > 0
  await win.mouse.up()
  check('scaling by a handle snaps to a guide', snapped)
  await settle(1000)

  // ---- the timeline bar: snaps to another layer's start, takes its keys along ----
  await win.keyboard.press('Escape')
  const bar = await win.getByTestId('bar-ux-a').boundingBox()
  const pxPerSec = bar.width // ux-a's motion lasts 1 s
  const y = bar.y + bar.height / 2
  await win.mouse.move(bar.x + 6, y)
  await win.mouse.down()
  await win.mouse.move(bar.x + 6 + pxPerSec * 1.5, y, { steps: 5 })
  await win.mouse.move(bar.x + 6 + pxPerSec * 2.95, y, { steps: 5 })
  const tip = (await win.getByTestId('layer-drag-tip').count()) ? await win.getByTestId('layer-drag-tip').innerText() : ''
  const line = (await win.getByTestId('timeline-snap').count()) > 0
  await win.mouse.up()
  check('dragging a bar shows where it lands and snaps (to the other layer at 4 s)', line && tip.includes('붙음'), tip)
  check('…saved: the layer moved by 3 s', await until(() => Math.abs((overrides().elements['ux-a']?.timing?.shift ?? 0) - 3) < 1e-6, 5000), JSON.stringify(overrides().elements['ux-a']))
  const ua = overrides().elements['ux-a']
  check("…with the designer's keys and in point", JSON.stringify(ua.keys?.opacity?.map((k) => k.t)) === JSON.stringify([4.5, 5.5]) && ua.inPoint === 3.5, JSON.stringify(ua))
  await settle(2500)
  const moved = await win.getByTestId('bar-ux-a').boundingBox()
  check('the bar is drawn where it was dropped after the reload', Math.abs(moved.x - (bar.x + pxPerSec * 3)) < 3, `${moved.x} vs ${bar.x + pxPerSec * 3}`)

  // ---- editing checks ----
  await win.locator('[data-testid="layer-row"][data-row="ux-badge"] button.row').click()
  await settle()
  const before = JSON.stringify(overrides().elements['ux-badge'] ?? {})
  const field = win.locator('[data-keyrow="x+y"] .num input').first()
  await field.click()
  await win.mouse.click(host.x + 10, host.y + host.height - 12)
  await settle(1200)
  check('a click in and out of a number field changes nothing', JSON.stringify(overrides().elements['ux-badge'] ?? {}) === before, `${before} → ${JSON.stringify(overrides().elements['ux-badge'])}`)
  // ⇧⌘D at 3 s: the layer ends there, its copy goes on from there to where it ended
  await win.locator('[data-testid="layer-row"][data-row="ux-badge"] button.row').click()
  await win.keyboard.press('Home')
  for (let i = 0; i < 9; i++) await win.keyboard.press('Shift+PageDown')
  await settle(600)
  await win.keyboard.press('Meta+Shift+D')
  const split = await until(() => Object.keys(overrides().elements).some((k) => k.startsWith('D') && overrides().elements[k].inPoint != null), 5000)
  const ovNow = overrides()
  const copy = Object.entries(ovNow.elements).find(([k, v]) => k.startsWith('D') && v.inPoint != null)
  const cut = ovNow.elements['ux-badge']?.outPoint
  check("⇧⌘D: the second half goes on from the cut (not cut off at once)", split && cut > 0 && copy && copy[1].inPoint === cut && copy[1].outPoint == null, JSON.stringify([ovNow.elements['ux-badge'], copy]))
  await win.keyboard.press('Meta+z')
  await win.keyboard.press('Meta+z')
  await settle(1500)
  // ⌘A: every layer on screen, not the camera
  // (after the undo the preview opens again: its layers first)
  await until(async () => (await win.getByTestId('layer-row').count()) > 10, 10000)
  await settle(1500)
  await win.keyboard.press('Escape')
  await win.keyboard.press('Meta+a')
  await settle()
  const all2 = await picked()
  check('⌘A picks the layers, not the camera', all2.length > 3 && !all2.includes('__camera'), JSON.stringify(all2.slice(0, 5)))
  await win.keyboard.press('Escape')

  // ---- 지금 보이는 것만: the timeline lists the layers seen at the playhead ----
  const rowsNow = async () => win.locator('[data-testid="timeline"] [data-layer]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-layer')))
  await win.keyboard.press('Home')
  await settle(1200)
  const allRows = (await rowsNow()).length
  const filter = async (id) => {
    await win.getByTestId('timeline-filter').click()
    await win.getByTestId(id).click()
    await settle(400)
  }
  await filter('timeline-only-now')
  let now = await rowsNow()
  check('지금 보이는 것만 at 0 s: the badge, not the layers still hidden (ux-b until 4 s, ux-a from 3.5 s)', now.includes('ux-badge') && !now.includes('ux-b') && !now.includes('ux-a') && now.length < allRows, JSON.stringify(now))
  await win.keyboard.press('End')
  await settle(1500)
  now = await rowsNow()
  check('…at the end the layer shown from 4 s is listed', now.includes('ux-b'), JSON.stringify(now))
  await filter('timeline-only-now')
  check('…and off again, all layers', (await rowsNow()).length >= allRows)
  // 소리만: the sound lanes, no picture layers
  const lanes = async () => win.locator('[data-testid="timeline"] .tl-sfx-wave, [data-testid="timeline"] [data-audio-lane]').count()
  await filter('timeline-only-sound')
  check('소리만: no picture layers, the sound lanes stay', (await rowsNow()).length === 0 && (await lanes()) > 0, JSON.stringify({ rows: (await rowsNow()).length, lanes: await lanes() }))
  check('…the filter button says what is shown', (await win.getByTestId('timeline-filter').innerText()).includes('소리만'))
  await filter('timeline-show-all')
  check('모두 보기 brings every layer back', (await rowsNow()).length >= allRows)

  // ---- 기준점 가운데로: the pivot back to the middle, the layer stays put ----
  await win.keyboard.press('Home')
  await settle(800)
  await win.locator('[data-testid="layer-row"][data-row="ux-badge"] button.row').click()
  await settle()
  const typeIn = async (sel, v) => {
    const f = win.locator(sel).first()
    await f.click()
    await f.fill(String(v))
    await f.press('Enter')
    await settle(500)
  }
  await typeIn('[data-keyrow="rotate"] .num input', 30)
  await typeIn('[data-keyrow="anchorX+anchorY"] .num input', 40)
  const badgeBox = async () => (await win.frames().find((f) => f.url().includes('ms-preview')).evaluate(() => { const r = document.querySelector('[data-ms-id="ux-badge"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
  await settle(800)
  const b0 = await badgeBox()
  check('the anchor is off the middle to start with', overrides().elements['ux-badge']?.transform?.anchorX === 40, JSON.stringify(overrides().elements['ux-badge']))
  await win.getByTestId('anchor-center').click()
  await until(() => (overrides().elements['ux-badge']?.transform?.anchorX ?? 0) === 0, 4000)
  await settle(1200)
  const b1 = await badgeBox()
  const t1 = overrides().elements['ux-badge']?.transform ?? {}
  check('기준점 가운데로: anchor 0,0', (t1.anchorX ?? 0) === 0 && (t1.anchorY ?? 0) === 0, JSON.stringify(t1))
  check('…the layer does not move on screen (turned 30°)', Math.abs(b0.x - b1.x) < 1.5 && Math.abs(b0.y - b1.y) < 1.5 && Math.abs(b0.w - b1.w) < 1.5, JSON.stringify([b0, b1]))
  await win.keyboard.press('Meta+z')
  check('…one undo puts the anchor back', await until(() => overrides().elements['ux-badge']?.transform?.anchorX === 40, 4000), JSON.stringify(overrides().elements['ux-badge']?.transform))
  await win.keyboard.press('Escape')

  // ---- dragging inside the selection box moves the layer (also from its middle, where the anchor is) ----
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').id
  const versions = async () => (await win.evaluate((id) => window.studio.history.list(id), pid)).length
  const cardX = () => overrides().elements['ux-card']?.transform?.x ?? 0
  const cardBox = async () => (await win.frames().find((f) => f.url().includes('ms-preview')).evaluate(() => { const r = document.querySelector('[data-ms-id="ux-card"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
  await win.locator('[data-testid="layer-row"][data-row="ux-card"] button.row').click()
  await settle(800)
  await win.waitForTimeout(1500) // the last save is done
  const v0 = await versions()
  const x0 = cardX()
  let cb = await cardBox()
  let from = await at(cb.x + cb.w / 2, cb.y + cb.h / 2)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(from.x + 20, from.y + 10, { steps: 4 })
  // a rest in the middle of the drag (longer than the old 0.6 s grouping and the 0.7 s save)
  await win.waitForTimeout(1100)
  await win.mouse.move(from.x + 50, from.y + 25, { steps: 4 })
  await win.mouse.up()
  check('a drag from the middle of the picked layer moves it (not its anchor)', await until(() => Math.abs(cardX() - x0) > 20, 4000) && (overrides().elements['ux-card']?.transform?.anchorX ?? 0) === 0, JSON.stringify(overrides().elements['ux-card']))
  await win.waitForTimeout(2500)
  check('…one history version for the whole drag, rest included', (await versions()) - v0 === 1, `${v0} → ${await versions()}`)
  await win.keyboard.press('Meta+z')
  check('…one undo puts it all back', await until(() => Math.abs(cardX() - x0) < 0.01, 4000), `${x0} vs ${cardX()}`)
  await settle(1500)
  // turned 45°: its box has empty corners — a press there still drags it
  await typeIn('[data-keyrow="rotate"] .num input', 45)
  await settle(1200)
  cb = await cardBox()
  // the empty triangle at the box's top-left corner, clear of the corner's scale handle
  from = await at(cb.x + cb.w * 0.12, cb.y + cb.h * 0.12)
  const x1 = cardX()
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(from.x + 40, from.y, { steps: 5 })
  await win.mouse.up()
  check('a press in an empty corner of a turned layer\'s box drags it', await until(() => Math.abs(cardX() - x1) > 15, 4000) && JSON.stringify(await picked()) === JSON.stringify(['ux-card']), `${x1} → ${cardX()} ${JSON.stringify(await picked())}`)
  // a click inside it without moving changes nothing
  await settle(1500)
  const before2 = JSON.stringify(overrides().elements['ux-card'])
  const v1 = await versions()
  cb = await cardBox()
  from = await at(cb.x + cb.w / 2, cb.y + cb.h / 2)
  await win.mouse.click(from.x, from.y)
  await settle(1500)
  check('a click inside the picked layer changes nothing and saves nothing', JSON.stringify(overrides().elements['ux-card']) === before2 && (await versions()) === v1)
  // (the click picked the top layer there — the card's own text, as a click always did): the card again
  await win.locator('[data-testid="layer-row"][data-row="ux-card"] button.row').click()
  await settle(800)
  // ⌥ + drag on the anchor point moves the anchor
  const ah = await win.getByTestId('handle-anchor').boundingBox()
  await win.keyboard.down('Alt')
  await win.mouse.move(ah.x + ah.width / 2, ah.y + ah.height / 2)
  await win.mouse.down()
  await win.mouse.move(ah.x + ah.width / 2 + 30, ah.y + ah.height / 2 + 10, { steps: 4 })
  await win.mouse.up()
  await win.keyboard.up('Alt')
  check('⌥ + drag on the anchor point moves the anchor', await until(() => Math.abs(overrides().elements['ux-card']?.transform?.anchorX ?? 0) > 5, 4000), JSON.stringify(overrides().elements['ux-card']?.transform))
  await settle(1200)
  // a number scrubbed with a rest in the middle: one undo step
  const yBefore = overrides().elements['ux-card']?.transform?.y ?? 0
  await win.locator('[data-keyrow="x+y"] .scrub').nth(1).scrollIntoViewIfNeeded()
  await settle(300)
  const scrub = await win.locator('[data-keyrow="x+y"] .scrub').nth(1).boundingBox()
  await win.mouse.move(scrub.x + scrub.width / 2, scrub.y + scrub.height / 2)
  await win.mouse.down()
  await win.mouse.move(scrub.x + scrub.width / 2 + 20, scrub.y + scrub.height / 2, { steps: 4 })
  await win.waitForTimeout(1100)
  await win.mouse.move(scrub.x + scrub.width / 2 + 50, scrub.y + scrub.height / 2, { steps: 4 })
  await win.mouse.up()
  check('scrubbing a number changes it', await until(() => Math.abs((overrides().elements['ux-card']?.transform?.y ?? 0) - yBefore) > 10, 4000), JSON.stringify({ scrub, yBefore, t: overrides().elements['ux-card']?.transform, picked: await picked() }))
  await win.keyboard.press('Meta+z')
  check('…and one undo takes the whole scrub back', await until(() => Math.abs((overrides().elements['ux-card']?.transform?.y ?? 0) - yBefore) < 0.01, 4000), `${yBefore} vs ${overrides().elements['ux-card']?.transform?.y}`)
  await win.keyboard.press('Escape')

  // ---- after a pause the playhead stays: states that come late (posted before the pause) are dropped ----
  await win.keyboard.press('Home')
  await settle(600)
  await win.keyboard.press('Space')
  await win.waitForTimeout(1200)
  await win.keyboard.press('Space')
  await win.waitForTimeout(600)
  const tc = async () => (await win.getByTestId('timecode').innerText()).split('/')[0].trim()
  const paused = await tc()
  // the preview posts a state from before the pause (an old command number), as one that piled up would be
  await win.frames().find((f) => f.url().includes('ms-preview')).evaluate(() => parent.postMessage({ ms: 'state', time: 6.5, duration: 8, playing: true, seq: 0 }, '*'))
  await win.waitForTimeout(800)
  check('a late state from before the pause does not move the playhead', (await tc()) === paused && paused !== '00:00.00', `${paused} → ${await tc()}`)
  check('…and the transport still shows paused', (await win.locator('[title="재생/정지 (Space)"] svg').getAttribute('class'))?.includes('play') ?? true)
  // with the Korean keyboard on, P is "ㅔ": the key still means 핀
  await win.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅔ', code: 'KeyP', bubbles: true })))
  check('shortcuts work with the Korean keyboard on (ㅔ → 핀)', await until(async () => (await win.getByTestId('tool-pin').getAttribute('class'))?.includes('on')))
  await win.keyboard.press('Escape')

  // ---- pins with files ----
  // the 영역 / 핀 buttons are in the chat box only; the canvas shows a hint only while marking
  check('no 수정 요청 pill on the canvas', (await win.getByTestId('canvas-mark-tools').count()) === 0 && (await win.getByTestId('mark-hint').count()) === 0)
  check('the 영역 / 핀 tools are in the chat box, labelled', (await win.getByTestId('tool-pin').count()) === 1 && (await win.getByTestId('tool-pin').innerText()).includes('핀') && (await win.getByTestId('tool-box').innerText()).includes('영역'))
  await win.getByTestId('tool-pin').click()
  check('…while marking, the canvas says what to do', await until(async () => (await win.getByTestId('mark-hint').count()) === 1))
  for (const [x, y] of [[400, 300], [900, 500]]) {
    const q = await at(x, y)
    await win.mouse.click(q.x, q.y)
  }
  check('two pins, each with its own row', await until(async () => (await win.locator('[data-mark-row]').count()) === 2))
  // the file dialog answers with a picture and a clip
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  }, [pinImage, pinVideo])
  await win.getByTestId('mark-attach-1').click()
  const row1 = win.locator('[data-mark-row="1"]')
  check('a pin takes a picture and a video', await until(async () => (await row1.locator('img').count()) + (await row1.locator('video').count()) === 2))
  const refs = readdirSync(join(proj, 'feedback', 'refs'))
  check('…copied into the project, the video with a still for Claude', refs.some((f) => f.endsWith('.png')) && refs.some((f) => f.endsWith('.mp4')) && refs.some((f) => f.endsWith('.mp4.jpg')), JSON.stringify(refs))
  // what they are for is written in the pin's comment, as before (no picker)
  check('…no purpose picker; the comment asks what to do with them', (await row1.getByTestId('mark-use-1').count()) === 0 && /붙인 파일로/.test((await win.getByTestId('mark-note-1').getAttribute('placeholder')) ?? ''))
  await win.getByTestId('mark-note-1').fill('이 사진으로 바꿔 줘')
  check('…and the comment is kept with the files', (await win.getByTestId('mark-note-1').inputValue()) === '이 사진으로 바꿔 줘')
  check('the second pin has its own files (none yet)', (await win.locator('[data-mark-row="2"]').locator('img, video').count()) === 0)
  await win.keyboard.press('Escape')
  await win.screenshot({ path: join(shots, 'edit-usability.png') })
} catch (err) {
  failed++
  console.log('✗', err.message)
  await win.screenshot({ path: join(shots, 'edit-usability-fail.png') }).catch(() => {})
}
await app.close()
rmSync(sandbox, { recursive: true, force: true })
if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nedit usability: all passed')
