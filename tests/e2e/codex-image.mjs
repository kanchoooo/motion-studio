// Codex CLI as an image model (uses this computer's Codex login and one image of its quota):
//  - status: installed, signed in, limits (no model call)
//  - "GPT 이미지 (Codex)" in the image model list, with its quota line
//  - AI 연결 shows the Codex card
//  - 소재 > AI로 만들기 with Codex: a flat character image arrives and is converted to SVG
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/codex-image.mjs
import { _electron as electron } from 'playwright-core'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 1000 }).catch(() => {})
try {
  await toHome(win)
  const st = await win.evaluate(() => window.studio.ai.codexStatus(true))
  log('codex:', JSON.stringify(st))
  check('Codex is found, signed in and usable', st.installed && st.loggedIn && st.usable, st.reason)

  // AI 연결 card
  await win.getByRole('button', { name: 'AI 연결' }).click()
  const card = win.locator('[data-provider="codex"]')
  await card.getByText('사용할 수 있어요').waitFor({ timeout: 30000 }).catch(() => {})
  check('AI 연결 shows the Codex card with its limits', (await card.innerText()).includes('사용할 수 있어요') && /% 사용/.test(await card.innerText()), await card.innerText())
  await win.screenshot({ path: join(shots, 'codex-connections.png') })
  await win.keyboard.press('Escape')

  // brief > 소재 > AI로 만들기
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click({ timeout: 30000 })
  await win.getByRole('button', { name: /^소재/ }).first().click()
  const gen = win.getByTestId('asset-generator')
  await gen.waitFor()
  await gen.getByTestId('gen-toggle').click() // folded by default
  const select = gen.locator('select').first()
  await select.locator('option', { hasText: 'GPT 이미지 (Codex)' }).waitFor({ state: 'attached', timeout: 30000 })
  check('"GPT 이미지 (Codex)" is in the image model list', (await select.locator('option', { hasText: 'GPT 이미지 (Codex)' }).count()) === 1)
  await select.selectOption({ label: 'GPT 이미지 (Codex)' })
  await gen.getByTestId('codex-line').waitFor({ timeout: 30000 })
  check('its quota line shows', /Codex · .*사용/.test(await gen.getByTestId('codex-line').innerText()), await gen.getByTestId('codex-line').innerText())
  await gen.getByRole('button', { name: '흉상' }).click()
  const before = await gen.getByTestId('gen-candidate').count()
  await gen.getByTestId('gen-prompt').fill('밝은 하늘색 후드티를 입은 단발머리 20대 여성, 동그란 얼굴, 연한 민트색 배경')
  await win.screenshot({ path: join(shots, 'codex-generator.png') })
  await gen.getByTestId('gen-run').click()
  log('making the image with Codex…')
  for (let i = 0; i < 480 && (await gen.getByTestId('gen-candidate').count()) === before; i++) {
    if (i % 30 === 0 && i) log('… still making')
    await win.waitForTimeout(1000)
  }
  const n = await gen.getByTestId('gen-candidate').count()
  check('the Codex image arrives as a candidate', n === before + 1)
  const list = await win.evaluate(() => window.studio.projects.list())
  const pid = list.find((x) => x.name === '앱 주문 런칭').id
  const c = (await win.evaluate((id) => window.studio.ai.candidates(id), pid))[0]
  log('candidate:', JSON.stringify({ provider: c?.request.provider, character: c?.character }))
  check('it is a Codex PNG in the project', c?.request.provider === 'codex' && existsSync(join(list.find((x) => x.id === pid).path, c.file)))
  check(`converted to SVG (${c?.character?.shapes} shapes, ${c?.character?.badPct}%)`, c?.character?.status === 'done' && c.character.shapes > 5)
  await gen.getByTestId('gen-candidate').first().scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(shots, 'codex-candidate.png') })
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'codex-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
