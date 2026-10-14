// AI 웹 수집 with real Claude (the logged-in account, print mode, WebSearch / WebFetch only):
//  - progress lines while it searches, then logos / images (downloaded into the project),
//    brand colours and facts / copy with their sources
//  - ✕ throws one away at once; the rest goes into the brief: images → assets, colours →
//    brand colours, facts / copy → brand notes
// The brief is put back afterwards.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> [BRAND=배달의민족] node tests/e2e/web-collect-live.mjs
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
const BRAND = process.env.BRAND ?? '배달의민족'

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 1000 }).catch(() => {})
let pid, briefBefore
try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '브리프' }).click({ timeout: 30000 })
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  pid = p.id
  briefBefore = (await win.evaluate((id) => window.studio.projects.state(id), pid)).brief
  await win.getByRole('button', { name: /^소재/ }).first().click()
  const wc = win.getByTestId('web-collector')
  await wc.scrollIntoViewIfNeeded()
  if ((await win.getByTestId('collect-toggle').getAttribute('aria-expanded')) === 'false') await win.getByTestId('collect-toggle').click()
  await win.getByTestId('collect-brand').fill(BRAND)
  await win.getByTestId('collect-focus').fill('공식 로고, 앱 화면, 브랜드 색과 슬로건 위주')
  await win.getByTestId('collect-run').click()
  log('collecting…')
  let seen = 0
  for (let i = 0; i < 480 && !(await win.getByTestId('collect-run').isVisible().catch(() => false)); i++) {
    const lines = await win.getByTestId('collect-progress').innerText().catch(() => '')
    const n = lines.split('\n').length
    if (n !== seen) {
      seen = n
      log('  ', lines.split('\n').filter(Boolean).slice(-1)[0])
    }
    await win.waitForTimeout(1000)
  }
  const progress = await win.getByTestId('collect-progress').innerText()
  check('progress shows what Claude searched / read', /검색:|읽는 중:/.test(progress), progress.slice(0, 300))
  const r = await win.evaluate((id) => window.studio.ai.collected(id), pid)
  const by = (t) => (r?.items ?? []).filter((x) => x.type === t)
  log('summary:', r?.summary)
  for (const it of r?.items ?? []) log(`  - ${it.type} · ${it.title}${it.hex ? ` ${it.hex}` : ''}${it.text ? ` · ${it.text.slice(0, 60)}` : ''} · ${it.source ?? ''}`)
  check(`found pictures (${by('logo').length} logos, ${by('image').length} images)`, by('logo').length + by('image').length >= 1)
  check('pictures were downloaded into the project', [...by('logo'), ...by('image')].every((x) => x.file && existsSync(join(p.path, x.file))))
  check(`found colours / facts / copy (${by('color').length} / ${by('fact').length} / ${by('copy').length})`, by('fact').length + by('copy').length >= 1)
  check('every item has its source', (r?.items ?? []).every((x) => !!x.source))
  // the sandbox's trust question opens the terminal: close it to see the results
  if (await win.getByText('Quick safety check').isVisible().catch(() => false)) await win.getByTitle('터미널 열기/닫기').click().catch(() => {})
  await win.getByTestId('collect-item').first().scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(shots, 'collect-results.png') })

  // throw one away, keep the rest
  const before = await win.getByTestId('collect-item').count()
  await win.getByTestId('collect-drop').first().click()
  await win.waitForTimeout(500)
  check('✕ throws an item away at once', (await win.getByTestId('collect-item').count()) === before - 1)
  const left = (await win.evaluate((id) => window.studio.ai.collected(id), pid)).items
  const pics = left.filter((x) => x.type === 'logo' || x.type === 'image').length
  await win.getByTestId('collect-keep').click()
  await win.waitForTimeout(2500)
  const after = (await win.evaluate((id) => window.studio.projects.state(id), pid)).brief
  const added = after.assets.filter((a) => !briefBefore.assets.some((b) => b.id === a.id))
  check(`kept pictures became assets (${added.length}/${pics})`, added.length === pics && added.every((a) => existsSync(join(p.path, 'composition', a.file))))
  check('kept colours / notes went into the brand', (after.brand?.colors.length ?? 0) >= left.filter((x) => x.type === 'color').length && left.filter((x) => x.type === 'fact' || x.type === 'copy').every((x) => after.brand?.notes.includes(x.text)))
  check('the list is empty afterwards', (await win.getByTestId('collect-item').count()) === 0)
  await win.screenshot({ path: join(shots, 'collect-kept.png') })
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'collect-fail.png') }).catch(() => {})
} finally {
  // put the brief back (the copied files stay in the sandbox)
  if (pid && briefBefore) await win.evaluate(([id, b]) => window.studio.projects.saveBrief(id, b), [pid, briefBefore]).then(() => log('brief restored')).catch((e) => log('restore failed', e.message))
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
