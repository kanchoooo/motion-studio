// The Claude session's `hyperframes` / `npx hyperframes` reach the CLI inside the app,
// even with a bare PATH (no Node on the computer).
// MS_SANDBOX=<sandbox with "앱 주문 런칭"> node tests/e2e/cli-shims.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`)
  if (!ok) failed++
}
try {
  await toHome(win)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  const bin = join(sandbox, 'userdata', 'cli')
  for (let i = 0; i < 40 && !existsSync(join(bin, 'npx')); i++) await new Promise((r) => setTimeout(r, 250))
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: process.env.HOME }
  const v1 = execFileSync('/bin/sh', ['-c', 'hyperframes --version'], { env, encoding: 'utf8' }).trim()
  const v2 = execFileSync('/bin/sh', ['-c', 'npx -y hyperframes@latest --version'], { env, encoding: 'utf8' }).trim()
  check(`hyperframes → ${v1}`, /0\.8\.157/.test(v1))
  check(`npx -y hyperframes@latest → ${v2}`, /0\.8\.157/.test(v2))
  const lint = execFileSync('/bin/sh', ['-c', 'cd composition && hyperframes lint --json'], { env, cwd: p.path, encoding: 'utf8' })
  check('hyperframes lint runs inside composition/', lint.includes('{'), lint.slice(0, 200))
  let other = ''
  try {
    execFileSync('/bin/sh', ['-c', 'npx cowsay hi'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    other = String(e.stderr)
  }
  check('npx for anything else explains there is no npx', /npx is not installed/.test(other), other)
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
