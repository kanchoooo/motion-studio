// Claude's permission questions go through the app (uses the logged-in Claude account):
//  - "물어보기": a web page read shows a card in the chat; allowing it lets Claude finish
//  - "모두 허용": a shell command runs without a card
// MS_SANDBOX=<sandbox with the trusted "앱 주문 런칭" project> node tests/e2e/permission-live.mjs
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
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
let failed = 0
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
const waitIdle = async (sec) => {
  for (let i = 0; i < sec && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
}
const lastReply = () => win.getByTestId('chat-list').evaluate((el) => el.innerText.slice(-600))

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').id
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'ask'), pid)
  await waitIdle(90)
  check('session ready', /대기 중/.test(await badge()), await badge())
  const input = win.getByPlaceholder(/Claude에게 요청하기/)

  // ---- ask: a card, then allowed ----
  await input.fill('영상은 절대 바꾸지 마세요. 웹 페이지 읽기 도구(WebFetch)로 https://example.com 을 한 번 읽고, 그 페이지 제목만 한 줄로 알려 주세요.')
  await input.press('Enter')
  const card = win.getByTestId('permission-card')
  await card.first().waitFor({ timeout: 180000 }).catch(() => {})
  const shown = await card.count()
  check('a permission card appears in the chat', shown > 0)
  if (shown) {
    log('card:', (await card.first().innerText()).replace(/\s+/g, ' ').slice(0, 160))
    await win.screenshot({ path: join(shots, 'p7-permission.png') })
    await card.first().getByRole('button', { name: '허용', exact: true }).click()
    await card.first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    check('the card goes away once answered', (await card.count()) === 0)
  }
  await waitIdle(240)
  const r1 = await lastReply()
  check('Claude finished with the allowed page', /Example Domain/i.test(r1), r1.slice(-200))

  // ---- all: no card ----
  await win.getByTestId('permission-picker').locator('select').selectOption('all')
  await win.waitForTimeout(800)
  const mark = `ms-check-${Date.now() % 100000}`
  await input.fill(`영상은 절대 바꾸지 마세요. 명령 실행 도구(Bash)로 echo ${mark} 를 한 번 실행하고, 나온 글자를 그대로 한 줄로 알려 주세요.`)
  await input.press('Enter')
  let sawCard = false
  for (let i = 0; i < 240; i++) {
    if (await card.count()) sawCard = true
    if (i > 5 && /대기 중/.test(await badge())) break
    await win.waitForTimeout(1000)
  }
  const r2 = await lastReply()
  check('"모두 허용" runs it without a card', !sawCard && r2.includes(mark), r2.slice(-200))
  await win.getByTestId('permission-picker').locator('select').selectOption('ask')
  await win.waitForTimeout(500)
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p7-permission-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
