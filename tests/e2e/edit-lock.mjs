// While Claude works the editor can be looked at but not changed:
//  - the banner over the canvas says Claude is still working
//  - selecting and playing still work; dragging on the canvas moves nothing
//  - the inspector's controls are disabled, undo is off, ⌘Z changes nothing
//  - when the turn ends, editing works again
// The "Claude is working" state is sent to the window the way the session manager sends it.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/edit-lock.mjs
import { _electron as electron } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const overrides = (p) => JSON.parse(readFileSync(join(p, 'overrides.json'), 'utf8'))
const setStatus = (projectId, status) =>
  app.evaluate(({ BrowserWindow }, [id, st]) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('agent:event', { type: 'session', projectId: id, state: { status: st } })), [projectId, status])

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.locator('[data-layer="app-title"]').waitFor({ timeout: 30000 })
  await win.getByText('Quick safety check').waitFor({ timeout: 20000 }).catch(() => {})
  await win.waitForTimeout(1000)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const before = JSON.stringify(overrides(p.path).elements?.['app-title'] ?? {})

  await setStatus(p.id, 'busy')
  await win.getByTestId('edit-lock').waitFor({ timeout: 5000 })
  check('banner says Claude is still working', (await win.getByTestId('edit-lock').innerText()).includes('아직 Claude가 작업 중'))

  // selecting still works
  await win.locator('[data-layer="app-title"]').click()
  // the layer's settings (the layer list above them stays usable)
  const editor = win.locator('fieldset.lock-fieldset').last()
  await editor.waitFor({ timeout: 5000 })
  check('a layer can still be picked', (await editor.count()) === 1)
  check('its controls are disabled', await editor.evaluate((f) => f.disabled))
  check('the inspector says why', await win.getByTestId('inspector-locked').isVisible())

  // dragging the element on the canvas moves nothing (at 2 s the title is on screen: a click picks what is seen)
  for (let i = 0; i < 6; i++) await win.keyboard.press('Shift+PageDown')
  await win.waitForTimeout(800)
  const box = await win.locator('[data-capture-frame]').boundingBox()
  const el = await win.evaluate(() => {
    const f = [...document.querySelectorAll('iframe')].find((x) => x.src.includes('ms-preview'))
    const r = f?.contentDocument?.querySelector('[data-ms-id="app-title"]')?.getBoundingClientRect()
    const root = f?.contentDocument?.querySelector('[data-composition-id]')
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: +root.getAttribute('data-width'), h: +root.getAttribute('data-height') } : null
  })
  // composition px → screen (the composition's own size)
  const cx = box.x + (el ? el.x * (box.width / el.w) : box.width / 2)
  const cy = box.y + (el ? el.y * (box.height / el.h) : box.height / 2)
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  await win.mouse.move(cx + 60, cy + 40, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  check('the banner flashes on an edit attempt', await win.getByTestId('edit-lock').evaluate((b) => b.classList.contains('flash')))
  await win.screenshot({ path: join(shots, 'edit-lock.png') })
  await win.keyboard.press('Meta+z')
  await win.waitForTimeout(1500)
  check('nothing was saved while Claude worked', JSON.stringify(overrides(p.path).elements?.['app-title'] ?? {}) === before, JSON.stringify(overrides(p.path).elements?.['app-title']))

  // the turn ends: editing is back
  await setStatus(p.id, 'ready')
  await win.getByTestId('edit-lock').waitFor({ state: 'detached', timeout: 5000 })
  check('banner goes away when Claude is done', (await win.getByTestId('edit-lock').count()) === 0)
  check('controls are enabled again', !(await editor.evaluate((f) => f.disabled)))
  // the drag above may have picked whatever was under the pointer: pick the title again
  await win.keyboard.press('Escape')
  await win.locator('[data-layer="app-title"]').click()
  await win.waitForTimeout(300)
  const size = editor.locator('[title="글자 크기"] input, input[title="글자 크기"]').first()
  await size.click()
  await size.fill('81')
  await size.press('Enter')
  await win.waitForTimeout(1500)
  check('an edit after the turn is saved', overrides(p.path).elements?.['app-title']?.style?.fontSize === 81, JSON.stringify(overrides(p.path).elements?.['app-title']))
  await win.keyboard.press('Escape')
  await win.keyboard.press('Meta+z')
  await win.waitForTimeout(1500)
  check('and can be undone', JSON.stringify(overrides(p.path).elements?.['app-title'] ?? {}) === before, JSON.stringify(overrides(p.path).elements?.['app-title']))
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'edit-lock-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
