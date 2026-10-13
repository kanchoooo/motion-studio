// Reviews references, brand kits, timeline bars, compare, storage and partial restore
// on an existing project. Run: MS_SANDBOX=<dir> node tests/e2e/features.mjs
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-features')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const shot = async (n) => {
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(shots, `${n}.png`) })
  log('shot', n)
}
try {
  await win.getByText('브리프를 정리하고').waitFor({ timeout: 90000 })
  await shot('00-home-family')
  const list = await win.evaluate(() => window.studio.projects.list())
  const original = list.find((p) => !p.family)
  const variation = list.find((p) => p.family?.method === 'retime')
  await win.locator('.card').first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 20000 })
  await win.waitForTimeout(4000)

  // references (file + YouTube) through the API, then the brief page
  const refVideo = join(variation.path, 'renders', readdirSync(join(variation.path, 'renders')).find((f) => f.endsWith('.mp4')))
  const existing = await win.evaluate((id) => window.studio.references.list(id), original.id)
  if (!existing.length) {
    await win.evaluate(([id, f]) => window.studio.references.addFiles(id, [f]), [original.id, refVideo])
    const yt = await win.evaluate((id) => window.studio.references.addYoutube(id, 'https://www.youtube.com/watch?v=jNQXAC9IVRw').then((r) => r.status, (e) => 'ERR ' + e.message), original.id)
    log('youtube add:', yt)
  }
  await win.getByRole('button', { name: '브리프', exact: true }).click()
  await win.getByRole('button', { name: /레퍼런스/ }).click()
  for (let i = 0; i < 120; i++) {
    const refs = await win.evaluate((id) => window.studio.references.list(id), original.id)
    if (refs.every((r) => r.status === 'ready' || r.status === 'error')) {
      log('references:', refs.map((r) => `${r.title} [${r.kind}] ${r.status} frames=${r.frames?.length ?? 0}${r.error ? ' err=' + r.error : ''}`).join(' ; '))
      break
    }
    await win.waitForTimeout(1000)
  }
  await shot('01-references')

  // brand kit
  await win.getByRole('button', { name: /톤앤매너/ }).click()
  await win.waitForTimeout(800)
  await shot('03-brand-applied')

  // timeline element bars
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.waitForTimeout(5000)
  await shot('04-timeline-bars')

  // a second export so there is something to compare
  await win.evaluate((id) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: '' }), original.id)
  for (let i = 0; i < 300; i++) {
    const r = await win.evaluate((id) => window.studio.renders.list(id), original.id)
    if (r.length >= 2) break
    await win.waitForTimeout(1000)
  }
  await win.getByRole('button', { name: '이력·결과물' }).click()
  await win.waitForTimeout(1500)
  await shot('05-history')
  await win.getByRole('button', { name: /나란히 비교/ }).click()
  const thumbs = win.locator('.card [style*="aspect-ratio"]')
  await thumbs.nth(0).click()
  await thumbs.nth(1).click()
  await win.waitForTimeout(1500)
  await shot('06-compare')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(500)
  await win.getByTitle('저장 공간 관리').click()
  await win.waitForTimeout(800)
  await shot('07-storage')
  await win.keyboard.press('Escape')
  await win.getByTitle('일부만 되돌리기').first().click()
  await shot('08-partial-restore-menu')
} catch (e) {
  console.error('FEATURES FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
