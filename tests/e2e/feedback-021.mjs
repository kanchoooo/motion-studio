// 0.2.1 test feedback, checked in the app (uses the logged-in Claude account):
//  - Artlist sign-in terminal opens from AI 연결 (also without a project) and /mcp lists artlist
//  - a message sent while Claude works shows at once ("전달 대기"), then is delivered
//  - the chat keeps the designer's scroll position while Claude adds messages
//  - an applied brand preset can be removed again
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/feedback-021.mjs
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
const shots = join(root, 'tests', 'e2e', 'shots')
let failed = 0
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const plain = (s) => s.replace(/\x1b\[(\d*)C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\s+/g, '')
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')

try {
  await toHome(win)

  // ---- Artlist sign-in from Home (no project open) ----
  await win.getByRole('button', { name: 'AI 연결' }).click()
  const artlistCard = win.locator('[data-provider="artlist"]')
  if (!(await win.getByTestId('artlist-login').count())) await artlistCard.getByRole('switch').click()
  await win.getByTestId('artlist-login').click()
  await win.getByTestId('artlist-terminal').waitFor()
  let screen = ''
  for (let i = 0; i < 40; i++) {
    screen = plain(await win.evaluate(() => window.studio.terminal.snapshot('__artlist__')))
    if (/Isthisaprojectyoucreated|trustthisfolder/i.test(screen) && !/artlist/i.test(screen.split(/trust/i).pop())) {
      // first time in this folder: the designer answers the trust question in the terminal
      await win.getByTestId('artlist-terminal').locator('.xterm-helper-textarea').focus()
      await win.keyboard.press('ArrowDown')
      await win.waitForTimeout(300)
      await win.keyboard.press('Enter')
      await win.waitForTimeout(1500)
      continue
    }
    if (/artlist/i.test(screen) && /needsauth|Authenticate|connected|✔|△/i.test(screen)) break
    await win.waitForTimeout(500)
  }
  await win.screenshot({ path: join(shots, 'fb-artlist-terminal.png') })
  check('Artlist sign-in terminal shows artlist in /mcp', /artlist/i.test(screen), screen.slice(-300))
  await win.getByRole('button', { name: '완료' }).click()
  await win.keyboard.press('Escape')
  const browsers = await win.evaluate(() => window.studio.ai.browsers())
  log('sign-in browsers:', browsers.map((b) => `${b.name}${b.canPrivate ? '' : ' (no private window)'}`).join(', ') || '(none)')

  // ---- brand preset can be removed again ----
  await win.evaluate(async () => {
    for (const b of await window.studio.brands.list()) if (b.name === '테스트 브랜드') await window.studio.brands.remove(b.id)
    await window.studio.brands.save({ name: '테스트 브랜드', colors: [{ name: '메인', hex: '#FF7A2F' }], fonts: {}, notes: '' })
  })
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click()
  await win.getByRole('button', { name: /톤앤매너/ }).click()
  await win.locator('.card').filter({ hasText: '테스트 브랜드' }).getByRole('button', { name: '적용', exact: true }).click()
  await win.getByText('적용됨: 테스트 브랜드').waitFor()
  await win.locator('.card').filter({ hasText: '테스트 브랜드' }).getByRole('button', { name: '적용됨', exact: true }).click()
  await win.waitForTimeout(500)
  check('applied brand can be removed with a second click', !(await win.getByText('적용됨: 테스트 브랜드').count()))

  // ---- chat while Claude works ----
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  const input = win.getByPlaceholder(/Claude에게 요청하기/)
  await input.fill('영상은 바꾸지 말고, 0.5초·2초·4초·6초 장면을 직접 확인한 다음 각 장면을 두 문장씩 설명해 주세요.')
  await input.press('Enter')
  for (let i = 0; i < 30 && !/작업 중/.test(await badge()); i++) await win.waitForTimeout(500)
  await win.waitForTimeout(2500)
  // unique per run: the conversation keeps earlier runs' lines
  const second = `설명 끝에 가장 좋은 장면 번호도 알려 주세요. (${Date.now() % 100000})`
  await input.fill(second)
  await input.press('Enter')
  await win.getByTestId('queued-label').first().waitFor({ timeout: 8000 }).catch(() => {})
  // (the hidden terminal also contains the line: count the chat only)
  const queuedShown = await win.getByTestId('chat-list').getByText(second).count()
  const label = await win.getByTestId('queued-label').count()
  await win.screenshot({ path: join(shots, 'fb-queued.png') })
  check('message sent while working appears at once with a waiting label', queuedShown === 1 && label >= 1, `shown ${queuedShown}, label ${label}`)

  // scroll up while Claude adds messages: the position is kept
  const list = win.getByTestId('chat-list')
  const box = await list.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.wheel(0, -2000)
  await win.waitForTimeout(500)
  const before = await list.evaluate((el) => el.scrollTop)
  for (let i = 0; i < 20 * 60 && /작업 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  await win.waitForTimeout(2000)
  const after = await list.evaluate((el) => el.scrollTop)
  check('reading position is kept while Claude works', Math.abs(after - before) < 5, `${before} → ${after}`)
  check('"최신 메시지" button offers a jump back', (await win.getByTestId('chat-latest').count()) === 1)
  await win.getByTestId('chat-latest').click().catch(() => {})
  await win.waitForTimeout(800)
  const copies = await win.getByTestId('chat-list').getByText(second).count()
  check('queued message delivered (label gone, shown once)', copies === 1 && (await win.getByTestId('queued-label').count()) === 0, `copies ${copies}`)
  await win.screenshot({ path: join(shots, 'fb-after.png') })
} catch (e) {
  console.error('FAILED:', e.message)
  failed++
  await win.screenshot({ path: join(shots, 'fb-failure.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
