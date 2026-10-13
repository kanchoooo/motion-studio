// Korean typing in the first-launch access field. On macOS, Chromium limits a
// field it treats as a password (type=password or -webkit-text-security) to
// Roman input sources, so Korean could not be typed (0.2.0). The field must stay
// a plain text input; dots are drawn over transparent text.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sb = mkdtempSync(join(tmpdir(), 'ms-ime-'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_USER_DATA: join(sb, 'ud'), MS_PROJECTS_DIR: join(sb, 'pj') } })
const win = await app.firstWindow()
await win.getByTestId('lock-screen').waitFor()
const cdp = await win.context().newCDPSession(win)
const field = win.getByTestId('access-input')

async function compose(label) {
  await field.fill('')
  await field.click()
  // 김 typed with a Korean IME: ㄱ → 기 → 김, then committed
  for (const t of ['ㄱ', '기', '김']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.insertText', { text: '김' })
  await win.waitForTimeout(200)
  const info = await field.evaluate((el) => ({ value: el.value, type: el.type, masked: getComputedStyle(el).getPropertyValue('-webkit-text-security') }))
  console.log(label, JSON.stringify(info))
  // anything password-like makes macOS switch to Roman-only input sources
  if (info.type !== 'text' || (info.masked && info.masked !== 'none')) {
    console.error('the access field must be a plain text input (no password type, no -webkit-text-security)')
    process.exit(1)
  }
  return info.value
}

const now = await compose('access field:')
const shown = await win.locator('[aria-hidden]').filter({ hasText: '●' }).first().textContent()
await app.close()
if (now !== '김') {
  console.error('Korean composition failed in the access field')
  process.exit(1)
}
console.log('dots over the text:', shown)
console.log('access field: Korean input ok')
