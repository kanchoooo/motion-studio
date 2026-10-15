// Phase 7 home + export feedback, checked in the app:
//  - a project with a video but no picture gets one in the background
//  - renaming from the project card menu
//  - exporting into a chosen folder never overwrites a file already there,
//    and a folder that is gone is reported before rendering starts
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/home-export-p7.mjs
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
// start without a card picture
rmSync(join(proj, 'thumbnails', 'latest.jpg'), { force: true })
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const meta = () => JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
const original = meta().name

try {
  await toHome(win)
  const card = win.locator('.card').filter({ hasText: original }).first()
  await card.locator('img').waitFor({ timeout: 40000 }).catch(() => {})
  check('the card gets a picture in the background', (await card.locator('img').count()) === 1 && existsSync(join(proj, 'thumbnails', 'latest.jpg')))
  await win.screenshot({ path: join(shots, 'p7-home.png') })

  // ---- rename ----
  await card.getByTitle('더보기').click()
  await win.getByText('이름 바꾸기').click()
  const input = win.locator('.scrim input').first()
  await input.fill('앱 주문 런칭 (이름 바꿈)')
  await win.getByRole('button', { name: '바꾸기', exact: true }).click()
  await win.locator('.card').filter({ hasText: '앱 주문 런칭 (이름 바꿈)' }).first().waitFor({ timeout: 5000 })
  check('renamed from the card menu', meta().name === '앱 주문 런칭 (이름 바꿈)', meta().name)

  // ---- export into a folder ----
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.path === proj)
  await win.evaluate((path) => window.studio.projects.open(path), proj)
  const gone = join(tmpdir(), `ms-missing-${Date.now()}`)
  const early = await win.evaluate(([id, dir]) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: 'x', copyTo: dir }).then(() => 'started', (e) => e.message), [p.id, gone])
  check('a missing folder is reported before rendering', /저장 위치를 찾을 수 없어요/.test(early), early)
  const out = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-out-')))
  const name = `folder-check-${Date.now()}`
  writeFileSync(join(out, `${name}.mp4`), 'designer file')
  const done = await win.evaluate(
    ([id, dir, fileName]) =>
      new Promise((resolve) => {
        const off = window.studio.renders.onProgress((e) => {
          if (e.phase === 'done' || e.phase === 'error') {
            off()
            resolve(e)
          }
        })
        void window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName, copyTo: dir })
      }),
    [p.id, out, name],
  )
  const files = readdirSync(out).sort()
  check('the designer\'s file is kept', readFileSync(join(out, `${name}.mp4`), 'utf8') === 'designer file')
  check(`the export is saved next to it under a new name (${files.join(', ')})`, done.phase === 'done' && done.savedTo === join(out, `${name}-2.mp4`) && existsSync(done.savedTo), JSON.stringify({ phase: done.phase, savedTo: done.savedTo, detail: done.detail }))
  // put the name back for other tests
  await win.evaluate(([path, n]) => window.studio.projects.renameAt(path, n), [proj, original])
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p7-home-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
