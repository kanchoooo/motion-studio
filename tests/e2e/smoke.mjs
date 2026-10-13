// End-to-end smoke test: launches the built app, walks the main designer flow
// and saves screenshots to tests/e2e/shots/. Run: npm run build && node tests/e2e/smoke.mjs
import { _electron as electron, chromium } from 'playwright-core'
import { grantAccess } from './access.mjs'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const sandbox = mkdtempSync(join(tmpdir(), 'ms-e2e-'))
const keep = process.argv.includes('--keep')
const only = process.argv.find((a) => a.startsWith('--until='))?.split('=')[1]

// MS_APP_EXEC=<packaged app binary> runs the same flow against an installed build.
// Release builds turn off Node's --inspect (fuse), so they are driven over the
// Chromium debugging port instead of Playwright's Electron launcher.
const exec = process.env.MS_APP_EXEC
const env = { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') }
const app = exec ? await attachPackaged(exec) : await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env })
const win = await app.firstWindow()

async function attachPackaged(file) {
  const proc = spawn(file, ['--remote-debugging-port=0'], { cwd: sandbox, env, stdio: ['ignore', 'ignore', 'pipe'] })
  const ws = await new Promise((resolve, reject) => {
    let err = ''
    const timer = setTimeout(() => reject(new Error('app did not open a debugging port')), 60000)
    proc.stderr.on('data', (d) => {
      err += d
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`app exited (${code})`)) })
  })
  const browser = await chromium.connectOverCDP(ws)
  return {
    async firstWindow() {
      for (;;) {
        const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools:'))
        if (page) return page
        await new Promise((r) => setTimeout(r, 200))
      }
    },
    async close() {
      await browser.close().catch(() => {})
      proc.kill('SIGTERM')
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)))
    },
  }
}
await win.setViewportSize({ width: 1480, height: 920 }).catch(() => {})
const shot = async (name) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  console.log('shot', name)
}
const step = (name) => console.log(`\n== ${name}`)

try {
  step('lock')
  await win.getByTestId('lock-screen').waitFor({ timeout: 20000 })
  await shot('00-lock')
  await win.getByLabel('암호').fill('틀린암호')
  await win.getByLabel('암호').press('Enter')
  await win.getByText('암호가 맞지 않아요').waitFor({ timeout: 10000 })
  await shot('00b-lock-wrong')
  if (process.env.MS_ACCESS_PASSWORD) {
    await win.getByLabel('암호').fill(process.env.MS_ACCESS_PASSWORD)
    await win.getByLabel('암호').press('Enter')
  } else {
    grantAccess(join(sandbox, 'userdata'))
    await win.reload()
  }

  step('doctor')
  await win.getByText('작업 환경을 확인할게요').waitFor({ timeout: 15000 })
  await shot('01-doctor')
  // a ready environment jumps straight to Home; otherwise press 시작하기
  const home = win.getByText('브리프를 정리하고 Claude와 대화하면서 영상을 만들어요.')
  const startBtn = win.getByRole('button', { name: '시작하기' })
  await Promise.race([home.waitFor({ timeout: 90000 }), startBtn.and(win.locator(':enabled')).waitFor({ timeout: 90000 })])
  await shot('01b-doctor-ready')
  // the smoke run keeps the per-project trust prompt path (the workspace step is optional)
  if (!(await home.isVisible())) await startBtn.click()

  step('home')
  await win.getByText('프로젝트', { exact: true }).first().waitFor()
  await shot('02-home-empty')
  await win.getByRole('button', { name: /새 프로젝트/ }).first().click()
  await win.getByPlaceholder('예: 봄 시즌 신제품 15초').fill('E2E 봄 프로모션')
  await shot('03-new-project')
  await win.getByRole('button', { name: '만들기', exact: true }).click()

  step('brief')
  await win.getByText('출력 사양').first().waitFor({ timeout: 20000 })
  await shot('04-brief-output')
  await win.getByRole('button', { name: /필수 문구/ }).click()
  await win.getByRole('button', { name: /문구 추가/ }).click()
  await win.getByPlaceholder('예: 봄 신상품 최대 20% 할인').fill('봄 신상품 최대 20% 할인')
  await shot('05-brief-texts')
  await win.getByRole('button', { name: /톤앤매너/ }).click()
  await win.getByPlaceholder('예: 모션커피').fill('모션커피')
  await shot('06-brief-tone')
  // storyboard (optional): one scene with a locked line and a described image
  await win.getByRole('button', { name: /스토리보드/ }).click()
  await win.getByRole('button', { name: /씬 추가/ }).click()
  await win.getByPlaceholder('씬 제목 (예: 오프닝 · 제품 등장)').fill('오프닝')
  await win.getByRole('button', { name: /문구 추가/ }).click()
  await win.getByPlaceholder('예: 봄을 담은 한 잔').fill('봄을 담은 한 잔')
  await win.getByRole('button', { name: /이미지 추가/ }).click()
  await win.getByPlaceholder(/벚꽃잎이 흩날리는/).fill('벚꽃이 흩날리는 카페 창가')
  await shot('06b-brief-storyboard')
  await win.getByRole('button', { name: /AI 생성·음성/ }).click()
  await win.getByTestId('ai-section').waitFor()
  await shot('06c-brief-ai')
  await win.waitForTimeout(1200) // autosave
  if (only === 'brief') throw new Error('stop')

  step('editor')
  await win.getByRole('button', { name: '편집으로 가기' }).click()
  await win.getByText('Claude와 대화').waitFor()
  await win.waitForTimeout(6000)
  await shot('07-editor-empty')
  // the folder-trust prompt opens the terminal by itself on a new project
  await win.getByText(/이 프로젝트 폴더를 처음 열었어요/).waitFor({ timeout: 60000 })
  await win.waitForTimeout(1000)
  await shot('08-terminal')
  const state = await win.evaluate(() => document.querySelector('.badge')?.textContent)
  console.log('session badge:', state)
  // new projects: latest Opus with high effort
  const { execFileSync } = await import('node:child_process')
  const args = execFileSync('ps', ['-axo', 'command']).toString().split('\n').find((l) => /^\S*claude-agent-sdk\S*\/claude /.test(l.trim()) && l.includes('E2E 봄 프로모션')) ?? ''
  if (!/--model opus/.test(args) || !/--effort high/.test(args)) throw new Error(`session should default to opus/high: ${args.slice(0, 200)}`)
  console.log('session model: opus / high')

  step('panels')
  // history folds out of the editor's right edge; chat folds to the left
  await win.getByTestId('history-toggle').click()
  await win.getByTestId('history-panel').waitFor()
  await win.getByText('프로젝트를 만들었어요').first().waitFor({ timeout: 10000 })
  const before = await win.getByTestId('chat-panel').evaluate((el) => el.getBoundingClientRect().width)
  const bar = win.locator('.splitter-x').first()
  const box = await bar.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + 200)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 })
  await win.mouse.up()
  const after = await win.getByTestId('chat-panel').evaluate((el) => el.getBoundingClientRect().width)
  console.log('chat width', before, '→', after)
  if (Math.abs(after - before - 120) > 4) throw new Error(`chat panel did not resize (${before} → ${after})`)
  await shot('09-history-panel')
  await win.getByRole('button', { name: 'AI 연결' }).click()
  await win.getByText('이미지·영상·음성 생성 서비스에 로그인하면').waitFor()
  await shot('09b-ai-connections')
  await win.keyboard.press('Escape')

  step('results')
  await win.getByRole('button', { name: '결과물', exact: true }).click()
  await win.getByText('아직 내보낸 영상이 없어요').waitFor()
  await shot('10-results')
} catch (e) {
  if (e.message !== 'stop') {
    console.error('E2E FAILED:', e.message)
    await shot('zz-failure').catch(() => {})
    process.exitCode = 1
  }
} finally {
  await app.close().catch(() => {})
  if (!keep) rmSync(sandbox, { recursive: true, force: true })
  else console.log('sandbox kept at', sandbox)
}
