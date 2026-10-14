// Phase 7 asset making, checked in the app (no AI credits: the "generated" image is
// the ms-svg-character example; the prompt helper uses the logged-in Claude account):
//  - a flat character candidate is converted to SVG and shows its quality
//  - "소재에 추가" moves it into composition/assets/gen-…/ as a brief asset
//  - the prompt helper writes a prompt that goes into the prompt box
//  - Claude's generated media card: 소재함에 추가 / 버리기
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/assets-p7.mjs
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// a finished generation, as the service would have left it
const cid = `e2e${Date.now() % 100000}`
const gdir = join(proj, '.studio', 'generations', cid)
mkdirSync(gdir, { recursive: true })
await sharp(join(root, 'tests', 'fixtures', 'character', 'man', 'source.webp')).png().toFile(join(gdir, 'source.png'))
const req = { provider: 'magnific', model: '', style: 'flat-character', framing: 'bust', ratio: '1:1', lang: 'en', prompt: '안경 없는 짧은 머리 남자, 빨간 배경', references: [] }
const listFile = join(proj, '.studio', 'generations', 'candidates.json')
const list = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : []
writeFileSync(listFile, JSON.stringify([{ id: cid, at: new Date().toISOString(), file: `.studio/generations/${cid}/source.png`, request: req, sent: req.prompt }, ...list]))
// media "Claude generated" for the review card
mkdirSync(join(proj, 'composition', 'assets', 'generated'), { recursive: true })
copyFileSync(join(gdir, 'source.png'), join(proj, 'composition', 'assets', 'generated', `${cid}-keep.png`))
copyFileSync(join(gdir, 'source.png'), join(proj, 'composition', 'assets', 'generated', `${cid}-drop.png`))

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
const brief = () => JSON.parse(readFileSync(join(proj, 'brief.json'), 'utf8'))

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor()
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.path === proj).id

  // ---- conversion of the candidate ----
  const info = await win.evaluate(([id, dir]) => window.studio.ai.reconvert(id, dir, 'bust', 14), [pid, `.studio/generations/${cid}`])
  check(`character converted (${info.shapes} shapes, ${info.badPct}%)`, info.status === 'done' && info.pass && info.shapes > 10, JSON.stringify(info))

  // ---- brief > 소재 ----
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click()
  await win.getByRole('button', { name: /^소재/ }).first().click()
  await win.getByTestId('asset-generator').waitFor()
  const card = win.getByTestId('gen-candidate').filter({ hasText: req.prompt }).first()
  await card.waitFor({ timeout: 10000 })
  check('the candidate shows its SVG quality', /SVG 도형 \d+개 · 차이/.test(await card.innerText()), await card.innerText())
  await win.screenshot({ path: join(shots, 'p7-generator.png') })
  const before = brief().assets.length
  await card.getByRole('button', { name: '소재에 추가' }).click()
  let added = null
  for (let i = 0; i < 20 && !added; i++) {
    await win.waitForTimeout(500)
    added = brief().assets.find((a) => a.character && a.file.includes(cid.slice(0, 10)))
  }
  check('kept as a brief asset with its character', !!added && brief().assets.length === before + 1, JSON.stringify(brief().assets.map((a) => a.file)))
  check('its files moved into composition/assets', !!added && existsSync(join(proj, 'composition', added.file.replace('/source.png', ''), 'vector.svg')) && !existsSync(gdir))

  // ---- prompt helper (latest Haiku) ----
  await win.getByTestId('helper-toggle').click()
  await win.getByTestId('helper-input').fill('귀여운 개구장이 초록 모자 소년, 영어로')
  await win.getByTestId('helper-input').press('Enter')
  const use = win.getByTestId('helper-use')
  await use.first().waitFor({ timeout: 150000 }).catch(() => {})
  const helperText = await win.getByTestId('prompt-helper').innerText()
  check('the helper answers with a prompt', (await use.count()) > 0, helperText.slice(-300))
  if (await use.count()) {
    await use.first().click()
    const typed = await win.getByTestId('gen-prompt').inputValue()
    check(`"프롬프트 칸에 넣기" fills the box (${typed.slice(0, 60)}…)`, /cap|hat|boy/i.test(typed))
  }
  await win.screenshot({ path: join(shots, 'p7-helper.png') })

  // ---- Claude's generated media card ----
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await app.evaluate(({}, [id, c]) => globalThis.__msShowGenerated(id, [{ file: `assets/generated/${c}-keep.png`, kind: 'image' }], '테스트 남자'), [pid, cid])
  await app.evaluate(({}, [id, c]) => globalThis.__msShowGenerated(id, [{ file: `assets/generated/${c}-drop.png`, kind: 'image' }], '버릴 이미지'), [pid, cid])
  const cards = win.getByTestId('generated-card')
  await cards.last().waitFor({ timeout: 10000 })
  const keepCard = cards.filter({ hasText: '테스트 남자' }).last()
  const n = brief().assets.length
  await keepCard.getByRole('button', { name: '소재함에 추가' }).click()
  await keepCard.getByText('소재함에 넣었어요').waitFor({ timeout: 10000 }).catch(() => {})
  check('소재함에 추가 puts it into the brief', brief().assets.length === n + 1 && (await keepCard.innerText()).includes('소재함에 넣었어요'))
  const dropCard = cards.filter({ hasText: '버릴 이미지' }).last()
  await dropCard.getByRole('button', { name: '버리기' }).click()
  await dropCard.getByText('버렸어요').waitFor({ timeout: 10000 }).catch(() => {})
  check('버리기 moves the file to the trash', !existsSync(join(proj, 'composition', 'assets', 'generated', `${cid}-drop.png`)) && (await dropCard.innerText()).includes('버렸어요'))
  await dropCard.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(shots, 'p7-generated-card.png') })
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p7-assets-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
