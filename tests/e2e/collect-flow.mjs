// 결과물 모음 (관제 연동) in the app:
//  - without console.json nothing is collected (the app as before)
//  - with it: every earlier export is filled in (renders and AE packages), a new export follows as it
//    finishes, a delete request from the console deletes the export in the app (original to the
//    Trash), and a delete in the app takes the copy away
// The sandbox is copied; the copy is removed afterwards. (One small test video goes to the Trash.)
// 관제용 판 only: build it first with MS_CONSOLE=1 npx electron-vite build
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/collect-flow.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
if (!existsSync(join(root, 'out', 'renderer', 'web.html'))) {
  console.log('관제용 판 빌드가 아니에요: MS_CONSOLE=1 npx electron-vite build 뒤에 실행해 주세요')
  process.exit(1)
}
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-col-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const collection = join(sandbox, '모션스튜디오 결과물')
const ix = () => (existsSync(join(collection, '.motionstudio', 'index.json')) ? JSON.parse(readFileSync(join(collection, '.motionstudio', 'index.json'), 'utf8')).items : [])
const renders = () => JSON.parse(readFileSync(join(proj, 'renders', 'index.json'), 'utf8'))
const aeCount = readdirSync(join(proj, 'renders')).filter((n) => /-AE(-\d+)?$/.test(n) && existsSync(join(proj, 'renders', n, 'data.json'))).length
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const launch = () => electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const until = async (win, f, ms = 30000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await f()) return true
    await win.waitForTimeout(300)
  }
  return false
}
grantAccess(join(sandbox, 'userdata'))

// ---- 1. no console.json: nothing happens ----
let app = await launch()
let win = await app.firstWindow()
try {
  await toHome(win)
  await win.waitForTimeout(3000)
  check('without console.json nothing is collected', !existsSync(collection))
} finally {
  await app.close().catch(() => {})
}

// ---- 2. the console turned it on ----
writeFileSync(join(sandbox, 'userdata', 'console.json'), JSON.stringify({ collectDir: collection }))
app = await launch()
win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
try {
  await toHome(win)
  const want = renders().length + aeCount
  check(`every earlier export is filled in (${want}: renders and AE packages)`, await until(win, () => ix().length === want, 60000), `${ix().length} / ${want}`)
  const items = ix()
  const first = items.find((x) => x.format === 'mp4-h264')
  check('…under <project>/<file>, a clone (no copy)', !!first && first.path.startsWith('앱 주문 런칭/') && existsSync(join(collection, first.path)) && !items.some((x) => x.copied), JSON.stringify(first))
  check('…an AE package is a folder entry', items.some((x) => x.format === 'ae-package' && existsSync(join(collection, x.path, 'data.json'))))

  // a delete request from the console
  const r0 = renders()[0]
  const entry = items.find((x) => x.renderId === r0.id)
  mkdirSync(join(collection, '.motionstudio', 'delete-requests'), { recursive: true })
  writeFileSync(join(collection, '.motionstudio', 'delete-requests', 'e2e.json'), JSON.stringify({ items: [{ path: entry.path, projectId: entry.projectId, renderId: entry.renderId }], requestedAt: new Date().toISOString() }))
  check('a delete in the console deletes the export in the app (within 10 s)', await until(win, () => !renders().some((r) => r.id === r0.id) && !existsSync(join(proj, r0.file)) && !ix().some((x) => x.renderId === r0.id), 20000))
  check('…and the request is done', !existsSync(join(collection, '.motionstudio', 'delete-requests', 'e2e.json')))

  // a new export lands in the collection as it finishes
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').id
  await win.evaluate((id) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: 'collect-check' }), pid)
  check('a new export lands in the collection', await until(win, () => ix().some((x) => x.path.endsWith('collect-check.mp4') && existsSync(join(collection, x.path))), 240000), JSON.stringify(ix().slice(0, 2)))
  // a delete in the app takes the copy away
  const made = renders().find((r) => r.file.endsWith('collect-check.mp4'))
  await win.evaluate(([id, rid]) => window.studio.renders.remove(id, rid), [pid, made.id])
  check('a delete in the app takes its copy away', await until(win, () => !ix().some((x) => x.renderId === made.id) && !existsSync(join(collection, '앱 주문 런칭', 'collect-check.mp4')), 10000))
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} failed` : '\ncollect flow: all passed')
process.exit(failed ? 1 : 0)
