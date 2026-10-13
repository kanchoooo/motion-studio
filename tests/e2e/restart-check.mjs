// restart of a running project session (model change / Artlist toggle) must spawn again
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((p) => p.name === '앱 주문 런칭').id
  for (const step of (process.env.STEPS || 'restart,settings-on,settings-off').split(',')) {
    const r = await win.evaluate(async ([step, pid]) => {
      try {
        if (step === 'restart') return JSON.stringify(await window.studio.agent.restart(pid))
        return JSON.stringify(await window.studio.ai.saveSettings({ artlist: step === 'settings-on' }))
      } catch (e) {
        return 'ERR ' + e.message
      }
    }, [step, pid])
    console.log(step, r.slice(0, 160))
    await win.waitForTimeout(Number(process.env.GAP || 0))
    for (let i = 0; i < 40 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(500)
    console.log('  badge', await badge())
  }
} finally {
  await app.close().catch(() => {})
}
