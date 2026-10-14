// 브리프 › 톤앤매너·스타일 (no Claude calls): pick a tempo (its numbers show), pick styles
// (the first is 주, the second 보조, a third is refused until one is removed), and both are
// saved to brief.json and written into composition/BRIEF.md for Claude.
// Works on a copy of the sandbox.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/brief-direction.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = mkdtempSync(join(tmpdir(), 'ms-p12-'))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const shots = join(root, 'tests', 'e2e', 'shots')
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {})
const brief = () => JSON.parse(readFileSync(join(proj, 'brief.json'), 'utf8'))
const saved = async (test) => {
  for (let i = 0; i < 20; i++) {
    if (test(brief())) return true
    await win.waitForTimeout(250)
  }
  return false
}
try {
  await toHome(win)
  await win.evaluate((path) => window.studio.projects.open(path), proj)
  await win.reload()
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click({ timeout: 30000 })
  await win.getByRole('button', { name: '톤앤매너·스타일' }).click()

  const tempo = win.getByTestId('brief-tempo')
  check('tempo starts with Claude에게 맡기기', (await tempo.locator('button.on').innerText()) === 'Claude에게 맡기기')
  await tempo.getByRole('button', { name: '빠름', exact: true }).click()
  check('the tempo shows its numbers', await win.getByText('장면 1~1.5초 · 박자에 맞춘 경쾌한 컷 · 박자 120~128 BPM').isVisible())
  check('tempo saved', await saved((b) => b.tempo === 'fast'))

  await win.getByTestId('style-kinetic-type').click()
  await win.getByTestId('style-soft').click()
  check('first style is 주, second 보조', (await win.getByTestId('style-kinetic-type').innerText()).includes('주') && (await win.getByTestId('style-soft').innerText()).includes('보조'))
  await win.getByTestId('style-premium').click()
  check('a third style is refused with a note', (await win.locator('.style-chip.on').count()) === 2 && (await win.getByText('스타일은 2개까지 고를 수 있어요').count()) > 0)
  check('styles saved in order', await saved((b) => JSON.stringify(b.styles) === '["kinetic-type","soft"]'))
  await win.getByTestId('brief-styles').screenshot({ path: join(shots, 'p12-brief-styles.png') })
  await win.screenshot({ path: join(shots, 'p12-brief-direction.png') })

  await win.getByTestId('style-kinetic-type').click()
  check('removing the main style makes the other one lead', (await saved((b) => JSON.stringify(b.styles) === '["soft"]')) && !(await win.getByTestId('style-soft').innerText()).includes('보조'))
  await win.getByTestId('style-product').click()
  await saved((b) => b.styles?.length === 2)
  const md = readFileSync(join(proj, 'composition', 'BRIEF.md'), 'utf8')
  check('BRIEF.md tells Claude the tempo and styles', /템포\(디자이너가 고름\): 빠름 \(fast\)/.test(md) && /스타일\(디자이너가 고름, 감성·소프트\(주\) \+ 실사 제품 중심\)/.test(md) && /MAIN 감성·소프트/.test(md) && /ACCENT 실사 제품 중심/.test(md), md.slice(md.indexOf('## Customizations'), md.indexOf('## Notes')))

  await tempo.getByRole('button', { name: 'Claude에게 맡기기' }).click()
  check('back to Claude에게 맡기기 clears the tempo', await saved((b) => b.tempo === undefined))
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p12-brief-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
