// 수정해서 다시 만들기 with Codex (this computer's Codex login, two images of its quota):
//  - a candidate card: 다시 만들기 → what to change → a new candidate made FROM that image
//    (the previous image goes along as a reference; the prompt ends with the change request)
//  - a kept AI asset: 수정해서 다시 만들기 on the asset → the generator opens with it → a revised
//    candidate that can take the asset's place (기존 소재와 바꾸기)
// Works on a copy of the sandbox.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project and Codex image candidates> node tests/e2e/revise-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = mkdtempSync(join(tmpdir(), 'ms-rev-'))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const shots = join(root, 'tests', 'e2e', 'shots')
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const candidates = () => JSON.parse(readFileSync(join(proj, '.studio', 'generations', 'candidates.json'), 'utf8'))

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 1000 }).catch(() => {})
async function waitNew(gen, before, what) {
  log(`making ${what} with Codex…`)
  for (let i = 0; i < 300 && (await gen.getByTestId('gen-candidate').count()) === before; i++) await win.waitForTimeout(1000)
  return (await gen.getByTestId('gen-candidate').count()) > before
}

try {
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click({ timeout: 30000 })
  await win.getByRole('button', { name: /^소재/ }).first().click()
  const gen = win.getByTestId('asset-generator')
  await gen.getByTestId('gen-toggle').click()
  // a Codex candidate that is not a flat character (no SVG conversion wait)
  const list = candidates()
  const pick = list.findIndex((c) => !c.video && c.request.provider === 'codex' && c.request.style !== 'flat-character')
  check('a Codex image candidate to revise is there', pick >= 0)
  const card = gen.getByTestId('gen-candidate').nth(pick)
  await card.scrollIntoViewIfNeeded()

  // ---- revise a candidate ----
  await card.getByTestId('candidate-revise').click()
  await card.getByTestId('revise-note').fill('배경을 연한 하늘색으로 바꿔 주세요')
  await win.screenshot({ path: join(shots, 'p11-revise-form.png') })
  const before = await gen.getByTestId('gen-candidate').count()
  await card.getByTestId('revise-run').click()
  check('the revised candidate arrived', await waitNew(gen, before, 'the revision'))
  const made = candidates()[0]
  check('it remembers the change and the image it came from', made.request.revision?.at(-1) === '배경을 연한 하늘색으로 바꿔 주세요' && made.request.revisedFrom === list[pick].file, JSON.stringify(made.request))
  check('the change request went to the model with the previous image', /수정 요청: 첨부한 이미지는|REVISION: The attached image|修改要求：附带的图片/.test(made.sent) && made.sent.includes('연한 하늘색'), made.sent.slice(-300))
  check('the card says what was changed', (await gen.getByTestId('candidate-revision').first().innerText()).includes('연한 하늘색'))
  await gen.getByTestId('gen-candidate').first().screenshot({ path: join(shots, 'p11-revised-candidate.png') })

  // ---- keep it, then revise the kept asset ----
  await gen.getByTestId('gen-candidate').first().getByRole('button', { name: /소재에 추가/ }).click()
  await win.waitForTimeout(2500) // the brief saves after a moment
  const assetBtn = win.getByTestId('asset-revise').last()
  await assetBtn.scrollIntoViewIfNeeded()
  check('a kept AI asset offers 수정해서 다시 만들기', await assetBtn.isVisible())
  await assetBtn.click()
  const box = win.getByTestId('revise-asset')
  await box.waitFor()
  check('the generator opens with that asset', (await box.innerText()).includes('고칠 소재'))
  await box.getByTestId('revise-note').fill('컵에 작은 벚꽃 무늬를 넣어 주세요')
  const before2 = await gen.getByTestId('gen-candidate').count()
  await box.getByTestId('revise-run').click()
  check('the asset revision arrived', await waitNew(gen, before2, 'the asset revision'))
  const swap = gen.getByTestId('gen-candidate').first().getByTestId('candidate-replace')
  check('it can take the asset’s place', await swap.isVisible())
  const brief = await win.evaluate(() => window.studio.projects.list().then(async (l) => (await window.studio.projects.state(l.find((p) => p.name === '앱 주문 런칭').id)).brief))
  const oldCount = brief.assets.length
  await swap.click()
  await win.waitForTimeout(2500)
  const after = await win.evaluate(() => window.studio.projects.list().then(async (l) => (await window.studio.projects.state(l.find((p) => p.name === '앱 주문 런칭').id)).brief))
  const replaced = after.assets.at(-1)
  check('기존 소재와 바꾸기 replaced the asset (same count, the newer file)', after.assets.length === oldCount && replaced.generated?.request?.revision?.length === 2, JSON.stringify(replaced?.generated?.request?.revision))
  await win.screenshot({ path: join(shots, 'p11-revise-asset.png') })
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p11-revise-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
