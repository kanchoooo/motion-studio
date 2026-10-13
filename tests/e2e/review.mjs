// Opens an existing project (e.g. the live-flow sandbox) and exercises preview,
// selection, inspector editing, markup, export and history.
// Run: MS_SANDBOX=<dir> node tests/e2e/review.mjs
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-review')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX
if (!sandbox) throw new Error('MS_SANDBOX required')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const steps = (process.env.STEPS || 'preview,edit,mark,export,history').split(',')

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') },
})
const win = await app.firstWindow()
const shot = async (name) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log('shot', name)
}

try {
  await win.getByText('브리프를 정리하고 Claude와 대화하면서 영상을 만들어요.').waitFor({ timeout: 90000 })
  await shot('00-home')
  await win.locator('.card').filter({ has: win.locator('img, span') }).first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 20000 })
  await win.waitForFunction(() => !!document.querySelector('[data-iframe-slot] iframe'), null, { timeout: 30000 })
  await win.waitForTimeout(5000)
  const duration = Number((await win.locator('.mono.small .faint').first().textContent()).replace(/[^\d.:]/g, '').split(':').reduce((a, b) => a * 60 + Number(b), 0)) || 8
  const seekTo = async (t) => {
    const bar = await win.getByTestId('timeline-bar').boundingBox()
    await win.mouse.click(bar.x + (bar.width * t) / duration, bar.y + bar.height / 2)
    await win.waitForTimeout(900)
  }

  if (steps.includes('preview')) {
    await shot('01-editor-loaded')
    for (const t of [1.0, 3.0, 6.5]) {
      await seekTo(t)
      await shot(`02-preview-${t}s`)
    }
  }

  if (steps.includes('edit')) {
    await seekTo(3.0)
    await win.waitForTimeout(600)
    const els = await win.evaluate(() => [...document.querySelectorAll('.el-box')].map((b) => b.getAttribute('title')))
    log('element boxes at 3s:', els.join(', '))
    // pick the first text element from the inspector list
    await win.getByRole('button', { name: '메인 타이틀' }).click()
    await win.waitForTimeout(500)
    await shot('03-inspector-selected')
    const size = win.locator('.num').filter({ has: win.locator('.scrub', { hasText: 'T' }) }).first().locator('input')
    if (await size.count()) {
      const before = await size.inputValue()
      await size.fill(String(Math.round(Number(before) * 1.3)))
      await size.press('Enter')
      log('font size', before, '->', await size.inputValue())
      await win.waitForTimeout(1500)
      await shot('04-after-font-size')
      const ls = win.locator('.num').filter({ has: win.locator('.scrub', { hasText: '자간' }) }).first().locator('input')
      await ls.fill('-6')
      await ls.press('Enter')
      await win.waitForTimeout(1200)
      // drag the title 120px to the right on the canvas
      const box = await win.locator('.el-box[title="메인 타이틀"]').boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.mouse.down()
      await win.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 })
      await win.mouse.up()
      await win.waitForTimeout(1500)
      await shot('04b-after-drag')
    }
  }

  if (steps.includes('mark')) {
    await win.getByTitle(/영역 표시/).click()
    const frame = await win.locator('[data-capture-frame]').boundingBox()
    await win.mouse.move(frame.x + frame.width * 0.3, frame.y + frame.height * 0.3)
    await win.mouse.down()
    await win.mouse.move(frame.x + frame.width * 0.6, frame.y + frame.height * 0.55, { steps: 6 })
    await win.mouse.up()
    await win.getByPlaceholder('1번에 대한 요청 (선택)').fill('이 부분 조금 더 크게')
    await shot('05-markup')
    await win.getByRole('button', { name: '모두 지우기' }).click()
    await win.keyboard.press('Escape')
  }

  if (steps.includes('export')) {
    await win.getByRole('button', { name: /내보내기/ }).first().click()
    await win.getByRole('button', { name: '빠른 확인용' }).click()
    await shot('06-export-dialog')
    await win.getByRole('button', { name: '내보내기 시작' }).click()
    await win.waitForTimeout(4000)
    await shot('07-export-progress')
    await win.getByText(/내보내기를 마쳤어요|영상을 내보내지 못했어요/).waitFor({ timeout: 10 * 60000 })
    await shot('08-export-done')
    await win.getByRole('button', { name: '결과물 보기' }).or(win.locator('.modal footer').getByRole('button', { name: '닫기' })).first().click()
  }

  if (steps.includes('history')) {
    await win.getByRole('button', { name: '이력·결과물' }).click()
    await win.waitForTimeout(1500)
    await shot('09-history')
  }
} catch (e) {
  console.error('REVIEW FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
