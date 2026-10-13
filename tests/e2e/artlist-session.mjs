// Turning Artlist on must put it into the project's Claude session (MCP config
// + permission) and /mcp must list it. Needs a sandbox whose project folder is
// trusted: MS_SANDBOX=<live test sandbox> node tests/e2e/artlist-session.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
if (!sandbox) throw new Error('MS_SANDBOX=<sandbox with a trusted project> required')
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
// only this test's session (the designer's own app may be running too)
const claudeArgs = () => execFileSync('ps', ['-axo', 'command']).toString().split('\n').filter((l) => /^\S*claude-agent-sdk\S*\/claude /.test(l.trim()) && l.includes('--name 앱 주문 런칭'))
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
try {
  await toHome(win)
  await win.evaluate(() => window.studio.ai.saveSettings({ artlist: false }))
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  const before = claudeArgs()
  check('session starts without Artlist when it is off', before.length === 1 && !before[0].includes('mcp.artlist.io'), before.join('\n').slice(0, 200))
  await win.evaluate(() => window.studio.ai.saveSettings({ artlist: true }))
  await win.waitForTimeout(3000)
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  const after = claudeArgs()
  check('turning Artlist on restarts the session with Artlist', after.length === 1 && after[0].includes('mcp.artlist.io') && after[0].includes('mcp__artlist'), after.join('\n').slice(0, 300))
  await win.evaluate(() => window.studio.ai.saveSettings({ artlist: false }))
} catch (e) {
  console.error('FAILED:', e.message)
  failed++
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
