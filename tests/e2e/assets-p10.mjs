// 소재 tab, Phase 10 (no AI calls):
//  - AI로 만들기: every look in the style list with its hint, the kinds, the flat character
//    only as 인물·캐릭터
//  - 영상: video models need a Higgsfield / Magnific account (said so when there is none);
//    an image candidate becomes the start / end frame from its card; the frames can be swapped
//  - AI 웹 수집 is there, folded, with the brief's client as the brand
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project and some image candidates> node tests/e2e/assets-p10.mjs
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 1000 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click({ timeout: 30000 })
  await win.getByRole('button', { name: /^소재/ }).first().click()
  const gen = win.getByTestId('asset-generator')
  await gen.waitFor()
  check('AI로 만들기 starts folded', (await win.getByTestId('gen-toggle').getAttribute('aria-expanded')) === 'false')
  await win.getByTestId('gen-toggle').click()

  // ---- looks and kinds ----
  const style = gen.getByTestId('gen-style')
  const options = await style.locator('option').allTextContents()
  check(`style list has every look (${options.length})`, options.length >= 15 && ['클레이', '3D 렌더', '수채화', '실사 사진', '픽셀 아트', '카툰'].every((o) => options.includes(o)), options.join(', '))
  await style.selectOption({ label: '클레이' })
  check('a look shows its hint', (await gen.innerText()).includes('찰흙으로 빚은'))
  const kinds = gen.getByTestId('gen-kind').locator('button')
  check('six kinds', (await kinds.count()) === 6, String(await kinds.count()))
  await gen.getByTestId('gen-kind').getByRole('button', { name: '배경' }).click()
  check('배경 shows its note and no framing', (await gen.innerText()).includes('글자·요소 올릴 자리') && !(await gen.innerText()).includes('흉상'))
  await gen.getByTestId('gen-kind').getByRole('button', { name: '인물·캐릭터' }).click()
  check('인물·캐릭터 shows framing', (await gen.innerText()).includes('흉상'))
  await style.selectOption({ label: '플랫 캐릭터 · SVG로 연기' })
  check('flat character: only 인물·캐릭터', await gen.getByTestId('gen-kind').getByRole('button', { name: '배경' }).isDisabled())
  await win.screenshot({ path: join(shots, 'p10-image.png') })

  // ---- an image candidate → start / end frame ----
  const cards = gen.getByTestId('gen-candidate')
  const n = await cards.count()
  check(`image candidates are there (${n})`, n >= 2)
  await cards.nth(0).getByTestId('as-start-frame').click()
  check('영상 opens with that start frame', (await gen.getByTestId('frame-start').locator('img').count()) === 1)
  check('without a video account it says what to connect', await gen.getByTestId('video-needs-account').isVisible())
  await cards.nth(1).getByTestId('as-end-frame').click()
  const src = async (id) => gen.getByTestId(id).locator('img').first().getAttribute('src')
  const [s1, e1] = [await src('frame-start'), await src('frame-end')]
  check('the second becomes the end frame', !!e1 && e1 !== s1)
  await gen.getByTitle('시작·끝 바꾸기').click()
  check('start and end swap', (await src('frame-start')) === e1 && (await src('frame-end')) === s1)
  await gen.getByTestId('frame-end').getByRole('button', { name: /끝 프레임/ }).click()
  check('a frame can be picked from the list', (await gen.getByTestId('frame-end-choices').locator('button').count()) >= n)
  await gen.getByTestId('frame-end-choices').locator('button').last().click()
  check('the picked image is the end frame', (await src('frame-end')) !== s1)
  check('video length and ratio choices', (await gen.innerText()).includes('5초') && (await gen.innerText()).includes('9:16'))
  await gen.getByTestId('frame-start').scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(shots, 'p10-video.png') })

  // ---- web collection ----
  const wc = win.getByTestId('web-collector')
  await wc.scrollIntoViewIfNeeded()
  check('AI 웹 수집 is there', await wc.isVisible())
  if ((await win.getByTestId('collect-toggle').getAttribute('aria-expanded')) === 'false') await win.getByTestId('collect-toggle').click()
  const brief = await win.evaluate(() => window.studio.projects.list())
  check('brand starts as the brief client', (await win.getByTestId('collect-brand').inputValue()).length > 0, await win.getByTestId('collect-brand').inputValue())
  await win.screenshot({ path: join(shots, 'p10-collect.png') })
  void brief
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p10-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
