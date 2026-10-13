// Variations end-to-end on an existing project: workspace trust, a Claude
// re-layout (9:16), a speed-matched length (6s) and a scaled size (1280x720).
// Run: MS_SANDBOX=<dir> node tests/e2e/variations.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-variations')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX
const ffprobe = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffprobe')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const shot = async (n) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${n}.png`) })
  log('shot', n)
}
const probe = (f) => execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'compact', f], { encoding: 'utf8' }).trim().replace(/\n/g, ' | ')
const family = () => win.evaluate(async () => {
  const list = await window.studio.projects.list()
  return list.map((p) => ({ id: p.id, name: p.name, path: p.path, w: p.width, h: p.height, d: p.duration, fam: p.family }))
})
const openByName = async (re) => {
  await win.locator('button').filter({ hasText: re }).first().click()
}
const exportDraft = async () => {
  await win.getByRole('button', { name: /^내보내기$|%$/ }).first().click()
  await win.getByRole('button', { name: '빠른 확인용' }).click()
  await win.getByRole('button', { name: '내보내기 시작' }).click()
  await win.getByText(/내보내기를 마쳤어요|영상을 내보내지 못했어요/).waitFor({ timeout: 10 * 60000 })
  await win.locator('.modal footer').getByRole('button').last().click()
}
const latestRender = (dir) => {
  const files = readdirSync(join(dir, 'renders')).filter((f) => f.endsWith('.mp4'))
  return join(dir, 'renders', files.sort().at(-1))
}

try {
  // 1) one-time workspace trust from the environment check
  await win.getByText('작업 환경을 확인할게요').waitFor({ timeout: 20000 })
  const trustBtn = win.getByRole('button', { name: '작업 폴더 허용하기' })
  await Promise.race([trustBtn.waitFor({ timeout: 60000 }), win.getByText('브리프를 정리하고').waitFor({ timeout: 60000 })])
  if (await trustBtn.isVisible()) {
    await shot('01-doctor-trust-needed')
    await trustBtn.click()
    await win.getByText('작업 폴더 허용', { exact: true }).waitFor()
    await win.waitForTimeout(7000)
    await shot('02-trust-terminal')
    await win.locator('.modal .xterm-helper-textarea').focus()
    await win.keyboard.press('ArrowDown')
    await win.waitForTimeout(400)
    await win.keyboard.press('Enter')
    await win.locator('.modal').waitFor({ state: 'detached', timeout: 30000 })
    await win.waitForTimeout(2000)
    await shot('03-doctor-trusted')
    // a fully ready environment moves on to Home by itself
    const home = win.getByText('브리프를 정리하고')
    if (!(await home.isVisible())) await win.getByRole('button', { name: '시작하기' }).click({ timeout: 30000 })
  }
  await win.getByText('브리프를 정리하고').waitFor({ timeout: 60000 })

  // 2) open the original and create three variations
  await win.locator('.card').first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 20000 })
  await win.waitForTimeout(3000)
  const make = async (fn, name) => {
    await win.getByRole('button', { name: '베리에이션', exact: true }).click()
    await win.getByText('베리에이션 만들기', { exact: true }).waitFor()
    await fn()
    await shot(name)
    await win.locator('.modal footer').getByRole('button', { name: /베리에이션 \d+개 만들기/ }).click()
    await win.locator('.modal').waitFor({ state: 'detached', timeout: 60000 })
  }
  await make(async () => {
    await win.locator('.modal .card').filter({ hasText: '9:16' }).first().click()
  }, '04-modal-9x16')
  await make(async () => {
    await win.locator('.modal').getByRole('button', { name: '8초 (원본)' }).click()
    await win.locator('.modal').getByRole('button', { name: '6초', exact: true }).click()
    await win.locator('.modal').getByRole('button', { name: '속도만 맞추기 (즉시)' }).click()
  }, '05-modal-retime-6s')
  await make(async () => {
    await win.locator('.modal').getByRole('button', { name: '추가' }).first().click() // custom 1280x720 default
  }, '06-modal-scale-720p')
  let fam = await family()
  log('family:', fam.map((f) => `${f.name} [${f.w}x${f.h} ${f.d}s] ${f.fam ? f.fam.method + '/' + f.fam.status : 'root'}`).join(' ; '))

  // 3) wait for Claude's 9:16 re-layout
  for (let i = 0; i < 20 * 60; i++) {
    fam = await family()
    const v = fam.find((f) => f.fam?.method === 'claude')
    if (v && (v.fam.status === 'done' || v.fam.status === 'error')) break
    if (i % 60 === 0) log('waiting for 9:16…', v?.fam?.status)
    await win.waitForTimeout(1000)
  }
  const v916 = fam.find((f) => f.fam?.method === 'claude')
  log('9:16 status', v916.fam.status)
  const html = readFileSync(join(v916.path, 'composition', 'index.html'), 'utf8')
  log('9:16 root:', html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0].replace(/\s+/g, ' ').slice(0, 200))
  await win.locator('button').filter({ hasText: /^.*원본|·/ }).first().click() // open family menu (title)
  await win.waitForTimeout(500)
  await shot('07-family-menu')
  await openByName(/9:16 · 8초/)
  await win.waitForTimeout(8000)
  await shot('08-variation-9x16')

  // 4) speed-matched 6s → export and probe
  const vRetime = fam.find((f) => f.fam?.method === 'retime')
  await win.locator('button').filter({ hasText: /9:16 · 8초/ }).first().click()
  await openByName(/16:9 · 6초/)
  await win.waitForTimeout(6000)
  await shot('09-variation-retime')
  await exportDraft()
  log('retime render:', probe(latestRender(vRetime.path)))

  // 5) scaled 1280x720 → export and probe
  const vScale = fam.find((f) => f.fam?.method === 'scale')
  await win.locator('button').filter({ hasText: /16:9 · 6초/ }).first().click()
  await openByName(/1280×720|16:9 · 8초/)
  await win.waitForTimeout(6000)
  await exportDraft()
  log('scale render:', probe(latestRender(vScale.path)))
} catch (e) {
  console.error('VARIATIONS FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
