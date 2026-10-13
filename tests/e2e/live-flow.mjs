// Live end-to-end flow against the real Claude Code session (uses the logged-in
// account's usage). Run: npm run build && node tests/e2e/live-flow.mjs [--keep]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-live')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX || mkdtempSync(join(tmpdir(), 'ms-live-'))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') },
})
const win = await app.firstWindow()
const shot = async (name) => {
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log('shot', name)
}
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')

try {
  await win.getByText('브리프를 정리하고 Claude와 대화하면서 영상을 만들어요.').waitFor({ timeout: 90000 })
  await win.getByRole('button', { name: /새 프로젝트/ }).first().click()
  await win.getByPlaceholder('예: 봄 시즌 신제품 15초').fill('모션커피 봄 신메뉴')
  await win.getByRole('button', { name: '만들기', exact: true }).click()
  await win.getByText('출력 사양').first().waitFor({ timeout: 20000 })
  // short 8s spot to keep the live run fast
  const dur = win.locator('.num').filter({ hasText: '초' }).first().locator('input')
  await dur.fill('8')
  await dur.press('Enter')
  await win.getByRole('button', { name: /필수 문구/ }).click()
  await win.getByRole('button', { name: /문구 추가/ }).click()
  await win.getByPlaceholder('예: 봄 신상품 최대 20% 할인').fill('봄 한정 체리블ossom 라떼')
  await win.getByPlaceholder('예: 봄 신상품 최대 20% 할인').fill('봄 한정 체리블라썸 라떼')
  await win.getByRole('button', { name: /문구 추가/ }).click()
  await win.getByPlaceholder('예: 봄 신상품 최대 20% 할인').nth(1).fill('※ 매장별 판매 시기가 다를 수 있습니다')
  await win.getByRole('switch').nth(1).click() // lock the disclaimer
  await win.getByRole('button', { name: /톤앤매너/ }).click()
  await win.getByPlaceholder('예: 모션커피').fill('모션커피')
  await win.locator('textarea').first().fill('밝고 산뜻한 봄 분위기. 벚꽃 핑크 #F7A8C4 와 크림 #FFF6EC. 짧고 굵은 카피, 경쾌한 리듬.')
  await win.waitForTimeout(1500)
  await win.getByRole('button', { name: '편집으로 가기' }).click()
  await win.getByText('Claude와 대화').waitFor()

  log('waiting for trust prompt')
  await win.getByText(/이 프로젝트 폴더를 처음 열었어요/).waitFor({ timeout: 60000 })
  await shot('01-trust-banner')
  const xterm = win.locator('.xterm-helper-textarea')
  await xterm.focus()
  await win.keyboard.press('ArrowDown')
  await win.waitForTimeout(400)
  await win.keyboard.press('Enter')
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  log('session:', await badge())
  await shot('02-session-ready')

  await win.getByPlaceholder(/Claude에게 요청하기/).fill('브리프대로 콘티 먼저 보여줘')
  await win.getByPlaceholder(/Claude에게 요청하기/).press('Enter')
  log('waiting for storyboard')
  await win.getByRole('button', { name: '이대로 만들기' }).waitFor({ timeout: 6 * 60000 })
  await shot('03-storyboard')
  await win.getByRole('button', { name: '이대로 만들기' }).click()
  await win.waitForTimeout(5000)
  log('building… badge:', await badge())
  for (let i = 0; i < 30 * 60 && /작업 중/.test(await badge()); i++) {
    if (i % 60 === 0) log('still working…', await badge())
    await win.waitForTimeout(1000)
  }
  log('done:', await badge())
  await win.waitForTimeout(4000)
  await shot('04-after-build')
  const projDir = (await win.evaluate(() => window.studio.projects.list())).at(0)?.path
  log('project:', projDir)
  if (projDir && existsSync(join(projDir, 'composition', 'index.html'))) {
    const html = readFileSync(join(projDir, 'composition', 'index.html'), 'utf8')
    log('composition bytes', html.length, 'ms-ids', (html.match(/data-ms-id=/g) || []).length, 'empty?', html.includes('data-ms-empty="true"'))
  }
} catch (e) {
  console.error('LIVE FLOW FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  process.exitCode = 1
} finally {
  console.log('sandbox:', sandbox)
  await app.close().catch(() => {})
}
