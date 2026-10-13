// Sound flow on an existing project: Claude adds sound effects, the designer
// swaps a whole effect group and adds two BGM tracks with sections.
// Run: MS_SANDBOX=<dir> node tests/e2e/sound.mjs
import { grantAccess, toHome } from './access.mjs'
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-sound')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const shot = async (n) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${n}.png`) })
  log('shot', n)
}
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
try {
  await toHome(win)
  await win.locator('.card').first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 20000 })
  for (let i = 0; i < 40 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  log('session', await badge())
  if (!process.env.SKIP_CLAUDE) {
    await win.getByPlaceholder(/Claude에게 요청하기/).fill('기본 효과음을 넣어줘. 장면 전환마다 휙, 타이틀 글자 등장에 팝, 엔드카드 로고에 띵. 소리는 과하지 않게.')
    await win.getByPlaceholder(/Claude에게 요청하기/).press('Enter')
    await win.waitForTimeout(5000)
    for (let i = 0; i < 15 * 60 && /작업 중/.test(await badge()); i++) {
      if (i % 60 === 0) log('working…')
      await win.waitForTimeout(1000)
    }
    log('done', await badge())
    await win.waitForTimeout(5000)
  }
  await win.getByRole('button', { name: '사운드', exact: true }).click()
  await shot('01-sound-panel')
  const proj = (await win.evaluate(() => window.studio.projects.list()))[0]
  const html = readFileSync(join(proj.path, 'composition', 'index.html'), 'utf8')
  log('sfx in html:', (html.match(/data-ms-type="sfx"/g) || []).length, 'groups:', [...new Set([...html.matchAll(/data-ms-sfx="([^"]+)"/g)].map((m) => m[1]))].join(','))

  // designer: swap every whoosh at once with the built-in swipe
  const whoosh = win.locator('.card').filter({ hasText: /휙 ×/ }).first()
  if (await whoosh.count()) {
    await whoosh.getByRole('button', { name: /모두 바꾸기/ }).click()
    await win.getByRole('button', { name: '기본 효과음: 스와이프' }).click()
    await win.waitForTimeout(3000)
    await shot('02-group-replaced')
  }
  // designer: two BGM tracks with different sections (file import via the API, the dialog can't be automated)
  const pid = proj.id
  const [a] = await win.evaluate(async ([pid, f]) => window.studio.projects.importAssets(pid, [f]), [pid, join(sandbox, 'test-bgm.mp3')])
  const st = await win.evaluate((pid) => window.studio.projects.state(pid), pid)
  const ov = { ...st.overrides, bgm: [
    { id: 'bgm-main', label: '메인 BGM', src: a.file, start: 0, end: 5.2, mediaStart: 2, volume: 0.6, fadeIn: 0.3, fadeOut: 0.8, loop: false },
    { id: 'bgm-end', label: '엔딩 BGM', src: a.file, start: 5.2, end: 8, mediaStart: 10, volume: 0.8, fadeIn: 0.2, fadeOut: 1, loop: false },
  ] }
  await win.evaluate(([pid, ov]) => window.studio.projects.saveOverrides(pid, ov, '배경음악 2곡 추가 (테스트)'), [pid, ov])
  await win.getByRole('button', { name: '홈으로' }).click().catch(() => {})
  await win.locator('.card').first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 20000 })
  await win.waitForTimeout(6000)
  await win.getByRole('button', { name: '사운드', exact: true }).click()
  await shot('03-bgm-tracks')
  const html2 = readFileSync(join(proj.path, 'composition', 'index.html'), 'utf8')
  log('managed bgm:', (html2.match(/data-ms-managed="true"/g) || []).length, 'replaced whoosh:', (html2.match(/data-ms-original-src="assets\/sfx\/whoosh.wav"/g) || []).length)
} catch (e) {
  console.error('SOUND FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
