// AI 연결: the designer chooses a private (시크릿) or normal (일반) window for
// signing in, the choice is remembered, and "주소만 복사" puts the sign-in
// address on the clipboard without opening any browser.
// node tests/e2e/login-window.mjs   (after npm run build)
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = mkdtempSync(join(tmpdir(), 'ms-login-'))
const shots = join(root, 'tests', 'e2e', 'shots')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const launch = async () => {
  const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 950 }).catch(() => {})
  await toHome(win)
  await win.getByRole('button', { name: 'AI 연결' }).click()
  await win.getByTestId('login-window').waitFor()
  return { app, win }
}
const options = (win) => win.getByTestId('login-browser').locator('option').allTextContents()
const mode = (win) => win.getByTestId('login-window').locator('.seg button.on').textContent()

grantAccess(join(sandbox, 'userdata'))
let { app, win } = await launch()
// the designer's clipboard is put back afterwards
const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
try {
  const browsers = await win.evaluate(() => window.studio.ai.browsers())
  console.log('installed:', browsers.map((b) => b.name).join(', ') || '(none)')
  check('starts with a private window', (await mode(win)) === '시크릿 창', await mode(win))
  const priv = await options(win)
  check('private choices: each browser\'s private window + copy', priv.some((o) => /주소만 복사/.test(o)) && browsers.filter((b) => b.canPrivate).every((b) => priv.some((o) => o.startsWith(`${b.name} ${b.privateName}`))), priv.join(' | '))
  await win.getByTestId('login-window').getByRole('button', { name: '일반 창' }).click()
  const normal = await options(win)
  check('normal choices: default browser + every installed browser', normal[0] === '기본 브라우저' && browsers.every((b) => normal.includes(b.name)), normal.join(' | '))
  check('normal window starts with the default browser', (await win.getByTestId('login-browser').inputValue()) === 'default')
  check('normal window explains the signed-in account is used', await win.getByText('이미 로그인된 계정이 있으면').isVisible())
  await win.screenshot({ path: join(shots, 'login-window-normal.png') })

  // remembered after a restart
  await app.close()
  ;({ app, win } = await launch())
  check('the choice is remembered', (await mode(win)) === '일반 창', await mode(win))

  // private + copy: no browser opens, the address is copied
  await win.getByTestId('login-window').getByRole('button', { name: '시크릿 창' }).click()
  await win.getByTestId('login-browser').selectOption('copy')
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  const card = win.locator('[data-provider="magnific"]')
  await card.getByRole('button', { name: '계정 추가' }).click()
  await card.getByRole('button', { name: '로그인', exact: true }).click()
  await win.getByText('로그인 주소를 복사했어요').waitFor({ timeout: 30000 })
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  check('"주소만 복사" copies the sign-in address', /^https:\/\/.*(authorize|oauth|login)/i.test(copied), copied.slice(0, 80))
  await win.screenshot({ path: join(shots, 'login-window-copied.png') })
  await win.getByRole('button', { name: '취소' }).click()
  await win.getByText('로그인 주소를 복사했어요').waitFor({ state: 'hidden', timeout: 10000 })
  check('cancel ends the sign-in', true)
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'login-window-fail.png') }).catch(() => {})
} finally {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clip).catch(() => {})
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
