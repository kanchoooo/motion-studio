// Phase 7 editor feedback, checked in the app on a project that has a video:
//  - several elements picked with Shift: edited together, one undo step
//  - a picked layer clicked again / Esc clears the selection
//  - the safe-zone guide is off until switched on
//  - dragging the playhead head moves the timecode and the picture while dragging
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/editor-p7.mjs
import { _electron as electron } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const overrides = (p) => JSON.parse(readFileSync(join(p, 'overrides.json'), 'utf8'))

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.locator('[data-layer="app-title"]').waitFor({ timeout: 30000 })
  // a copied sandbox folder is not trusted yet: the terminal opens with the trust question and
  // changes the layout, so the checks start once it is there (the question is left unanswered)
  await win.getByText('Quick safety check').waitFor({ timeout: 20000 }).catch(() => {})
  await win.waitForTimeout(1000)
  const path = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').path
  const before = overrides(path).elements ?? {}

  // ---- guide ----
  const dashed = () => win.locator('[data-capture-frame] div').evaluateAll((els) => els.some((e) => e.style.border.includes('dashed')))
  check('safe-zone guide starts hidden', !(await dashed()))
  await win.getByTestId('guide-toggle').click()
  check('guide button shows it', await dashed())
  await win.getByTestId('guide-toggle').click()
  check('and hides it again', !(await dashed()))

  // ---- multi-select ----
  await win.locator('[data-layer="app-title"]').click()
  await win.locator('[data-layer="menu-name"]').click({ modifiers: ['Shift'] })
  await win.getByTestId('multi-editor').waitFor({ timeout: 5000 })
  check('Shift-click picks two layers', (await win.getByTestId('multi-editor').innerText()).includes('요소 2개 선택'))
  const size = win.getByTestId('multi-editor').locator('input[title="글자 크기"], [title="글자 크기"] input').first()
  await size.click()
  await size.fill('77')
  await size.press('Enter')
  await win.waitForTimeout(1500)
  const after = overrides(path).elements ?? {}
  check('font size went to both', after['app-title']?.style?.fontSize === 77 && after['menu-name']?.style?.fontSize === 77, JSON.stringify([after['app-title']?.style, after['menu-name']?.style]))
  await win.screenshot({ path: join(shots, 'p7-multi.png') })
  await win.keyboard.press('Meta+z')
  await win.waitForTimeout(1500)
  const undone = overrides(path).elements ?? {}
  check('one undo takes both back', undone['app-title']?.style?.fontSize === before['app-title']?.style?.fontSize && undone['menu-name']?.style?.fontSize === before['menu-name']?.style?.fontSize, JSON.stringify([undone['app-title']?.style, undone['menu-name']?.style]))

  // ---- deselect ----
  await win.keyboard.press('Escape')
  check('Esc clears the selection', !(await win.getByTestId('multi-editor').count()) && !(await win.locator('.tl-layer.sel').count()))
  await win.locator('[data-layer="app-title"]').click()
  check('a layer click picks it', (await win.locator('.tl-layer.sel').count()) === 1)
  await win.locator('[data-layer="app-title"]').click()
  check('clicking the picked layer again clears it', (await win.locator('.tl-layer.sel').count()) === 0)

  // ---- playhead scrub ----
  const head = win.getByTestId('playhead').locator('span')
  const ruler = win.getByTestId('timeline-bar')
  const rb = await ruler.boundingBox()
  const hb = await head.boundingBox()
  const code = () => win.locator('.tl .mono.small span').first().innerText()
  const frame = async () => (await win.locator('[data-capture-frame]').screenshot()).toString('base64')
  const t0 = await code()
  const f0 = await frame()
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await win.mouse.down()
  await win.mouse.move(rb.x + rb.width * 0.3, hb.y + hb.height / 2, { steps: 8 })
  await win.waitForTimeout(700)
  const t1 = await code()
  const f1 = await frame()
  await win.mouse.move(rb.x + rb.width * 0.6, hb.y + hb.height / 2, { steps: 8 })
  await win.waitForTimeout(700)
  const t2 = await code()
  const f2 = await frame()
  await win.mouse.up()
  check(`timecode follows the drag (${t0} → ${t1} → ${t2})`, t0 !== t1 && t1 !== t2)
  check('the picture changes while dragging', f0 !== f1 && f1 !== f2)
  // a click on the ruler jumps there too
  await win.mouse.click(rb.x + rb.width * 0.1, rb.y + rb.height / 2)
  await win.waitForTimeout(500)
  check(`a ruler click seeks (${await code()})`, (await code()) !== t2)
  const line = await win.getByTestId('playhead-line').boundingBox()
  check(`the playhead line runs down the tracks (${Math.round(line?.height ?? 0)}px)`, (line?.height ?? 0) > 100)
  await win.screenshot({ path: join(shots, 'p7-playhead.png') })
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p7-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
