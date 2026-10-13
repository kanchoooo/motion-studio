// The chat list scrolls (wheel) and keeps the designer's position while reading
// older messages. MS_SANDBOX=<sandbox with a project that has a long chat>
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  await win.waitForTimeout(3000)
  const list = win.getByTestId('chat-list')
  const m = await list.evaluate((el) => ({ ch: el.clientHeight, sh: el.scrollHeight, top: el.scrollTop, ov: getComputedStyle(el).overflowY, h: el.parentElement.getBoundingClientRect().height }))
  console.log('chat list', JSON.stringify(m))
  check('chat list is taller than its box (needs scrolling)', m.sh > m.ch + 50, JSON.stringify(m))
  const box = await list.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.wheel(0, -600)
  await win.waitForTimeout(400)
  const up = await list.evaluate((el) => el.scrollTop)
  check('wheel scrolls up', up < m.top - 100, `${m.top} → ${up}`)
  await win.waitForTimeout(2500)
  const still = await list.evaluate((el) => el.scrollTop)
  check('position is kept while reading', Math.abs(still - up) < 5, `${up} → ${still}`)
} catch (e) {
  console.error('FAILED:', e.message)
  failed++
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
