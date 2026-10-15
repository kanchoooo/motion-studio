// Live end-to-end flow of 0.5 against the real Claude Code session (uses the logged-in
// account's usage): a new project → planning in the conversation with a reference video
// attached (its part chosen) → "콘티로 보여줘" → the storyboard card with sketch pictures and
// material slots → a library file assigned to a slot → "제작해줘" in the chat → Claude calls
// start_build, the editor opens and Claude builds the way it would in plain Claude Code (no gates)
// → the editor is view-only until 편집 활성화 → the button: the layers are named without changing
// the picture, and hand edits open.
// The folder-trust question of the new project is answered here (a test sandbox only).
// Run: npm run build && node tests/e2e/live-flow.mjs [--keep]
import { grantAccess, toHome, cleanupOnExit } from './access.mjs'
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-live')
mkdirSync(shots, { recursive: true })
const keep = process.argv.includes('--keep')
const sandbox = process.env.MS_SANDBOX || (keep ? mkdtempSync(join(tmpdir(), 'ms-live-')) : cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-live-'))))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// a reference clip (a ball that eases across, then the frame holds) and a product picture
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const media = join(sandbox, 'media')
mkdirSync(media, { recursive: true })
const refClip = join(media, 'reference.mp4')
// (overlay evaluates x every frame; drawbox would not move)
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xfff6ec:size=720x1280:rate=30:duration=4', '-f', 'lavfi', '-i', 'color=c=0xf7a8c4:size=160x160:rate=30:duration=4', '-filter_complex', "[0][1]overlay=x='if(lt(t,1.2),-200+700*(1-pow(1-t/1.2,3)),500)':y=560", '-pix_fmt', 'yuv420p', refClip])
const product = join(media, 'latte.png')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xf7a8c4:size=900x900', '-vf', "drawbox=x=300:y=200:w=300:h=500:color=0xfff6ec:t=fill", '-frames:v', '1', product])

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata'), MS_NO_UPDATE: '1' },
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 940 }).catch(() => {})
const shot = async (name) => {
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log('shot', name)
}
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
/** waits while Claude works; a permission card (if the run is not on 모두 허용) is allowed and logged */
const waitIdle = async (label, minutes) => {
  await win.waitForTimeout(4000)
  for (let i = 0; i < minutes * 60; i++) {
    const card = win.getByTestId('permission-card').first()
    if (await card.count()) {
      log('permission:', (await card.innerText()).split('\n').slice(0, 3).join(' | '))
      await card.getByRole('button', { name: '허용', exact: true }).click().catch(() => {})
      await win.waitForTimeout(1500)
      continue
    }
    if (!/작업 중/.test(await badge())) break
    if (i % 60 === 0) log(`${label}…`, await badge())
    await win.waitForTimeout(1000)
  }
}
const say = async (text) => {
  const input = win.getByTestId('plan-chat').getByTestId('chat-input')
  await input.fill(text)
  await win.getByTestId('plan-chat').getByTestId('chat-send').click()
}

try {
  await toHome(win)
  await win.getByRole('button', { name: /새 프로젝트/ }).first().click()
  await win.getByTestId('project-name').fill('모션커피 봄 신메뉴')
  await win.getByTestId('create-project').click()
  await win.getByTestId('brief-tab').waitFor({ timeout: 30000 })
  const pid = await win.evaluate(async () => (await window.studio.projects.list()).find((p) => p.name === '모션커피 봄 신메뉴').id)
  const dir = (await win.evaluate((id) => window.studio.projects.state(id), pid)).path
  // 9:16, 8 seconds
  await win.evaluate((id) => window.studio.projects.saveOutput(id, { preset: 'shorts-9x16', width: 1080, height: 1920, duration: 8 }), pid)
  await win.evaluate(([id, f]) => window.studio.projects.addToLibrary(id, [f]), [pid, product])

  log('waiting for trust prompt')
  await win.getByText(/이 프로젝트 폴더를 처음 열었어요/).waitFor({ timeout: 60000 })
  const xterm = win.locator('.xterm-helper-textarea')
  await xterm.focus()
  await win.keyboard.press('ArrowDown')
  await win.waitForTimeout(400)
  await win.keyboard.press('Enter')
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  log('session:', await badge())
  await win.getByRole('button', { name: '터미널 열기/닫기' }).click().catch(() => {})
  // an unattended run: the designer's "모두 허용" (cards are still answered if one shows)
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'all'), pid)

  // ---- planning with a reference video (part chosen) ----
  await app.evaluate(({ ipcMain }, f) => {
    ipcMain.removeHandler('app:pickFiles')
    ipcMain.handle('app:pickFiles', () => [f])
  }, refClip)
  const plan = win.getByTestId('plan-chat')
  await plan.getByTestId('attach-media').click()
  const chip = plan.getByTestId('attach-chip').first()
  await chip.getByTestId('attach-range').waitFor({ timeout: 90000 })
  await chip.getByTestId('attach-range').click()
  await win.getByTestId('range-video').evaluate((v) => (v.currentTime = 0))
  await win.getByRole('button', { name: /여기서 시작/ }).click()
  await win.getByTestId('range-video').evaluate((v) => (v.currentTime = 1.5))
  await win.getByRole('button', { name: /여기서 끝/ }).click()
  await win.getByTestId('range-save').click()
  await say('모션커피 봄 신메뉴 "체리블라썸 라떼" 8초 쇼츠 광고를 만들고 싶어요. 벚꽃 핑크 #F7A8C4, 크림 #FFF6EC. 첨부한 영상의 0~1.5초 모션(공이 빠르게 들어와서 부드럽게 멈추는 느낌)이 좋아요. 소재함에 라떼 사진이 있어요.')
  await waitIdle('planning', 12)
  await shot('01-plan-reply')
  const transcriptPath = () => {
    const sid = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).agentSessionId
    const base = join(process.env.HOME, '.claude', 'projects')
    for (const d of readdirSync(base)) if (existsSync(join(base, d, `${sid}.jsonl`))) return join(base, d, `${sid}.jsonl`)
    return ''
  }
  const tr = () => (transcriptPath() ? readFileSync(transcriptPath(), 'utf8') : '')
  check('Claude looked at the chosen part frame by frame (look_at_reference)', /look_at_reference/.test(tr()))

  // ---- the storyboard ----
  await say('좋아요. 이 방향으로 콘티로 보여줘. 라떼 사진은 소재 칸으로 받을게요.')
  await waitIdle('storyboard', 20)
  const card = plan.getByTestId('storyboard-card').last()
  await card.waitFor({ timeout: 60000 }).catch(() => {})
  check('a storyboard card arrived', (await card.count()) > 0)
  const cur = await win.evaluate((id) => window.studio.agent.storyboard(id), pid)
  const scenes = cur?.storyboard.scenes ?? []
  check(`its scenes have sketch pictures (${scenes.filter((s) => s.frame).length}/${scenes.length})`, scenes.length > 0 && scenes.every((s) => s.frame && existsSync(join(dir, s.frame))))
  const slots = scenes.flatMap((s) => s.materials ?? [])
  log('materials:', JSON.stringify(slots.map((m) => ({ id: m.id, kind: m.kind, label: m.label, file: m.file, start: !!m.startPrompt }))))
  check('the storyboard lists the materials scenes need', slots.length > 0)
  await shot('02-storyboard-card')
  // assign the latte picture to the first image slot that is still empty
  const slot = slots.find((m) => m.kind === 'image' && !m.file)
  const lib = (await win.evaluate((id) => window.studio.projects.state(id), pid)).brief.assets
  if (slot && lib[0]) {
    await win.evaluate(([id, m, f]) => window.studio.agent.assign(id, m, f), [pid, slot.id, lib[0].file])
    check('a library file assigned to a slot', (await win.evaluate((id) => window.studio.agent.storyboard(id), pid)).storyboard.scenes.flatMap((s) => s.materials ?? []).some((m) => m.id === slot.id && m.file === lib[0].file))
  }
  await card.getByTestId('storyboard-open').click().catch(() => {})
  await shot('03-storyboard-panel')

  // ---- "제작해줘" in the conversation → start_build → the editor ----
  check('no 제작 승인 buttons', (await win.getByRole('button', { name: /제작 승인/ }).count()) === 0)
  await say('좋아요, 이대로 제작해줘.')
  const editorShown = () => win.evaluate(() => getComputedStyle(document.querySelector('[data-testid="editor"]').parentElement).visibility === 'visible')
  for (let i = 0; i < 240 && !(await editorShown()); i++) await win.waitForTimeout(1000)
  check('"제작해줘" opens the editor (start_build)', await editorShown())
  check('Claude called start_build', /start_build/.test(tr()))
  check('the storyboard is approved', (await win.evaluate((id) => window.studio.agent.storyboard(id), pid))?.status === 'approved')
  const tBuild = Date.now()
  await waitIdle('building', 60)
  log(`build took ${((Date.now() - tBuild) / 60000).toFixed(1)} min`)
  await shot('04-after-build')
  const html = () => readFileSync(join(dir, 'composition', 'index.html'), 'utf8')
  check('a video was built', !html().includes('data-ms-empty="true"') && html().length > 2000)
  check('the app head lines are in place', /<script src="vendor\/gsap\.min\.js"><\/script>[\s\S]*ms\/overrides\.js[\s\S]*ms\/runtime\.js/.test(html()))
  check('the assigned file is used', !!lib[0] && html().includes(lib[0].file))

  // ---- 보기 모드 → 편집 활성화 ----
  const meta = async () => (await win.evaluate((id) => window.studio.projects.state(id), pid)).meta
  check('a new video starts view-only', (await meta()).editable === false)
  await win.getByTestId('edit-activate-banner').waitFor({ timeout: 30000 })
  await shot('05-view-only')
  await win.getByTestId('edit-activate').click()
  for (let i = 0; i < 25 * 60 && (await meta()).editable !== true; i++) {
    const card = win.getByTestId('permission-card').first()
    if (await card.count()) await card.getByRole('button', { name: '허용', exact: true }).click().catch(() => {})
    await win.waitForTimeout(1000)
  }
  check('편집 활성화 opens hand edits', (await meta()).editable === true)
  await win.waitForTimeout(3000)
  check('the view-only banner is gone', (await win.getByTestId('edit-activate-banner').count()) === 0)
  const named = (html().match(/data-ms-id=/g) || []).length
  check(`the layers are named (${named})`, named >= 3)
  const diff = existsSync(join(dir, '.studio', 'tidy-check')) ? readdirSync(join(dir, '.studio', 'tidy-check')).filter((f) => f.startsWith('diff-')) : []
  log('편집 활성화 diffs:', diff.join(', ') || 'none')
  await win.waitForTimeout(4000)
  await shot('06-editable')
  // the transcript: no gates, the skills when Claude chose them
  const t = tr()
  log('skills used:', [...new Set([...t.matchAll(/"skill":"([^"]+)"/g)].map((m) => m[1]))].join(', ') || 'none')
  log('reviewer used:', /motion-reviewer/.test(t))
  check('no quality-gate messages', !/모션스튜디오 품질 확인|영상을 쓰기 전에 HyperFrames 워크플로를 먼저/.test(t))
} catch (e) {
  console.error('LIVE FLOW FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  failed++
} finally {
  console.log('sandbox:', sandbox)
  await app.close().catch(() => {})
}
log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
