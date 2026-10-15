// 0.5 브리프 = planning in conversation (no Claude calls: the new projects folder is not
// trusted, so the session waits at the folder-trust prompt):
//  - a new project opens on the planning chat; on the left 출력 사양 (popup: ratio, size,
//    length, fps — saved), 스토리보드 and 소재; the editor's empty chat points back here
//  - a storyboard Claude showed (sketch frames + materials) appears as a chat card and in the
//    스토리보드 panel; a library tile dragged onto a slot and a file from the computer are
//    assigned; 만들기 opens the 소재 panel with Claude's prompts (an image prompt; a clip with
//    start / end frame prompts → the three steps), the prompt helper is beside it
//  - the 스토리보드 / 소재 panels open on the left of the chat; there is no 제작 승인 button (the designer
//    says "제작해줘" in the chat; Claude calls start_build and the editor opens)
//  - attachments: a video from the computer is analysed (overview), its part can be chosen;
//    a YouTube address typed into the message becomes an attachment
// node tests/e2e/brief-plan.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-plan-')))
const shots = join(root, 'tests', 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const projects = join(sandbox, 'projects')
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const media = join(sandbox, 'media')
mkdirSync(media, { recursive: true })
const png = (name, color, size = '1080x1920') => {
  const f = join(media, name)
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=${size}`, '-frames:v', '1', f])
  return f
}
const cup = png('cup.png', '0x44bb99', '800x800')
const logo = png('logo.png', '0xff7733', '600x300')
const clip = join(media, 'reference.mp4')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=5', '-pix_fmt', 'yuv420p', clip])

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: projects, MS_USER_DATA: join(sandbox, 'userdata'), MS_NO_UPDATE: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 940 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const shot = (name) => win.screenshot({ path: join(shots, `plan-${name}.png`) })
const state = () => win.evaluate(() => window.studio.projects.state(window.__pid))

try {
  await toHome(win)
  // ---- a new project opens on the planning chat ----
  await win.getByRole('button', { name: /새 프로젝트/ }).first().click()
  await win.getByTestId('project-name').fill('대화 기획')
  await win.getByTestId('create-project').click()
  await win.getByTestId('brief-tab').waitFor({ timeout: 30000 })
  check('a new project opens on the planning chat', await win.getByTestId('plan-empty').isVisible())
  const pid = await win.evaluate(async () => {
    const list = await window.studio.projects.list()
    const p = list.find((x) => x.name === '대화 기획')
    const st = await window.studio.projects.open(p.path)
    window.__pid = st.meta.id
    return st.meta.id
  })
  const dir = (await state()).path
  for (const id of ['output', 'storyboard', 'assets']) check(`left menu: ${id}`, await win.getByTestId(`brief-nav-${id}`).isVisible())
  check('the old brief sections are gone', (await win.getByRole('button', { name: /필수 문구|톤앤매너|AI 생성·음성|레퍼런스/ }).count()) === 0)
  await shot('01-new')

  // ---- 출력 사양 ----
  await win.getByTestId('brief-nav-output').click()
  await win.getByTestId('output-popup').waitFor()
  await win.getByTestId('preset-square-1x1').click()
  await win.waitForTimeout(900)
  let o = (await state()).brief.output
  check('출력 사양: a ratio preset is saved', o.width === 1080 && o.height === 1080, JSON.stringify(o))
  check('출력 사양 holds only ratio, size, length, fps', (await win.getByTestId('output-popup').getByText(/파일 형식|품질|배경|세이프존|소리/).count()) === 0)
  await shot('02-output')
  await win.getByTestId('output-popup').getByText('출력 사양', { exact: true }).click()
  await win.keyboard.press('Escape')
  await win.getByTestId('output-popup').waitFor({ state: 'detached' })
  // back to vertical for the storyboard below
  await win.evaluate((id) => window.studio.projects.saveOutput(id, { preset: 'shorts-9x16', width: 1080, height: 1920 }), pid)

  // ---- the editor's empty chat points back to the brief ----
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  check('editor: no "브리프대로 콘티 먼저 보여줘" button', (await win.getByRole('button', { name: /브리프대로 콘티/ }).count()) === 0)
  check('editor: the empty chat points to the brief tab', await win.getByTestId('go-plan').isVisible())
  await win.getByTestId('go-plan').click()
  await win.getByTestId('brief-tab').waitFor()

  // ---- a storyboard as Claude would show it (frames photographed, materials) ----
  const frames = [png('f1.png', '0x223344'), png('f2.png', '0x334455')]
  const rel = join('.studio', 'storyboard', 'e2e')
  mkdirSync(join(dir, rel), { recursive: true })
  frames.forEach((f, i) => writeFileSync(join(dir, rel, `frame-0${i + 1}.png`), readFileSync(f)))
  const storyboard = {
    title: '봄 신메뉴',
    concept: '창가의 봄빛 아래 민트 텀블러가 깨어나요.',
    duration: 15,
    scenes: [
      { n: 1, from: 0, to: 6, title: '오프닝', description: '아침 주방, 텀블러 클로즈업', texts: ['봄이 왔어요'], assets: [], motion: '천천히 다가가기', frame: `${rel}/frame-01.png`, materials: [{ id: 's1-m1', kind: 'image', label: '텀블러 클로즈업', prompt: 'a mint tumbler on a sunny kitchen table, soft morning light' }, { id: 's1-m2', kind: 'image', label: '브랜드 로고' }] },
      { n: 2, from: 6, to: 15, title: '엔딩', description: '손에 든 텀블러, 로고', texts: ['지금 만나요'], assets: [], motion: '컷 전환', frame: `${rel}/frame-02.png`, materials: [{ id: 's2-m1', kind: 'video', label: '들어 올리는 영상', prompt: 'a hand lifts the tumbler toward the camera', startPrompt: 'a mint tumbler on a kitchen table', endPrompt: 'the tumbler held close to the camera' }] },
    ],
  }
  writeFileSync(join(dir, 'storyboard.json'), JSON.stringify({ itemId: 'sb-e2e', status: 'pending', storyboard }))
  const chat = JSON.parse(readFileSync(join(dir, 'chat.json'), 'utf8'))
  writeFileSync(join(dir, 'chat.json'), JSON.stringify([...chat, { id: 'sb-e2e', at: new Date().toISOString(), role: 'storyboard', storyboard, status: 'pending' }]))
  // the running session read chat.json when it started: start it again (still waiting for trust)
  await win.evaluate((id) => window.studio.agent.restart(id), pid)
  await win.reload()
  await toHome(win)
  await win.getByTestId('project-card').filter({ hasText: '대화 기획' }).click()
  await win.getByTestId('brief-tab').waitFor({ timeout: 30000 })
  await win.evaluate((id) => (window.__pid = id), pid)
  const card = win.getByTestId('plan-chat').getByTestId('storyboard-card')
  await card.waitFor({ timeout: 20000 })
  check('storyboard card: the sketch of every scene', (await card.getByTestId('storyboard-frames').locator('img').count()) === 2)
  check('storyboard card: materials listed', (await card.getByText(/텀블러 클로즈업/).count()) > 0)
  await shot('03-card')

  // ---- the storyboard panel: assign by dragging a library tile and from the computer ----
  await win.evaluate(([id, f]) => window.studio.projects.addToLibrary(id, [f]), [pid, cup])
  await card.getByTestId('storyboard-open').click()
  const panel = win.getByTestId('brief-panel-storyboard')
  await panel.waitFor()
  check('panel: scenes with their sketch', (await panel.getByTestId('scene-frame').count()) === 2)
  await panel.getByTestId('strip-asset').first().waitFor({ timeout: 10000 })
  await panel.getByTestId('strip-asset').first().dragTo(panel.getByTestId('slot-s1-m1'))
  await panel.getByTestId('slot-s1-m1').locator('img').waitFor({ timeout: 10000 }).catch(() => {})
  let cur = await win.evaluate((id) => window.studio.agent.storyboard(id), pid)
  check('a library tile dropped on a slot is assigned', /^assets\/cup/.test(cur.storyboard.scenes[0].materials[0].file ?? ''), JSON.stringify(cur.storyboard.scenes[0].materials[0]))
  cur = await win.evaluate(([id, f]) => window.studio.agent.assignFiles(id, 's1-m2', [f]), [pid, logo])
  await win.waitForTimeout(500)
  check('a file from the computer goes into the slot and the library', /^assets\/logo/.test(cur.storyboard.scenes[0].materials[1].file ?? '') && (await state()).brief.assets.length === 2)
  check('the card follows the assignments', (await card.getByText(/소재 넣기 \(2\/3\)/).count()) === 1)
  await shot('04-panel')

  // ---- 만들기: the generator opens with Claude's prompts ----
  await panel.getByTestId('slot-s2-m1').getByTestId('slot-make').click()
  const assets = win.getByTestId('brief-panel-assets')
  await assets.waitFor()
  await assets.getByTestId('gen-intent').waitFor()
  check('clip with frame prompts → the three steps', await assets.getByTestId('frame-steps').isVisible())
  check('start frame prompt filled in', (await assets.getByTestId('start-prompt').inputValue()) === 'a mint tumbler on a kitchen table')
  check('end frame prompt filled in', (await assets.getByTestId('end-prompt').inputValue()) === 'the tumbler held close to the camera')
  check('motion prompt filled in', (await assets.getByTestId('video-prompt').inputValue()) === 'a hand lifts the tumbler toward the camera')
  check('the prompt helper is there', await assets.getByTestId('prompt-helper').isVisible())
  await shot('05-make-clip')
  // an image slot: its prompt, no style in front
  await win.evaluate((id) => window.studio.agent.assign(id, 's1-m1', null), pid)
  await win.getByTestId('brief-nav-storyboard').click()
  await panel.getByTestId('slot-s1-m1').getByTestId('slot-make').click()
  await assets.getByTestId('gen-intent').waitFor()
  check('image slot → its prompt', (await assets.getByTestId('gen-prompt').inputValue()) === 'a mint tumbler on a sunny kitchen table, soft morning light')
  check('image slot → no style sentence in front', (await assets.getByTestId('gen-style').inputValue()) === 'none')

  // ---- panels on the left of the chat, no approve buttons ----
  const chatBox = await win.getByTestId('plan-chat').boundingBox()
  const panelBox = await win.getByTestId('brief-panel-assets').boundingBox()
  check('the 소재 panel opens on the left of the chat', panelBox.x + panelBox.width <= chatBox.x + 1, JSON.stringify([panelBox, chatBox]))
  await win.getByTestId('brief-nav-storyboard').click()
  const sbBox = await win.getByTestId('brief-panel-storyboard').boundingBox()
  check('the 스토리보드 panel opens on the left of the chat', sbBox.x + sbBox.width <= (await win.getByTestId('plan-chat').boundingBox()).x + 1)
  check('no 제작 승인 buttons (approval happens in the conversation)', (await win.getByRole('button', { name: /제작 승인/ }).count()) === 0)
  check('the card says to approve by talking', (await card.getByText(/제작해줘/).count()) > 0)
  await shot('06-panels-left')

  // ---- attachments in the chat ----
  await app.evaluate(({ ipcMain }, f) => {
    ipcMain.removeHandler('app:pickFiles')
    ipcMain.handle('app:pickFiles', () => [f])
  }, clip)
  const plan = win.getByTestId('plan-chat')
  await plan.getByTestId('attach-media').click()
  const chip = plan.getByTestId('attach-chip').first()
  await chip.waitFor()
  check('an attached video shows while it is analysed', (await plan.getByTestId('chat-send').isDisabled()) || (await chip.getByText(/분석 중|영상/).count()) > 0)
  await chip.getByTestId('attach-range').waitFor({ timeout: 60000 })
  const ref = (await win.evaluate((id) => window.studio.references.list(id), pid)).find((r) => r.kind === 'video')
  check('the video got an overview (1 s apart)', ref?.status === 'ready' && ref.sheetStep === 1 && ref.sheets?.length === 1, JSON.stringify(ref?.sheets))
  await chip.getByTestId('attach-range').click()
  await win.getByTestId('range-video').waitFor()
  await win.getByTestId('range-video').evaluate((v) => (v.currentTime = 1))
  await win.getByRole('button', { name: /여기서 시작/ }).click()
  await win.getByTestId('range-video').evaluate((v) => (v.currentTime = 3))
  await win.getByRole('button', { name: /여기서 끝/ }).click()
  await win.getByTestId('range-save').click()
  check('the chosen part shows on the attachment', (await chip.getByText(/1\.0~3\.0초/).count()) === 1)
  check('…and is kept on the attachment', JSON.stringify((await win.evaluate((id) => window.studio.references.list(id), pid)).find((r) => r.kind === 'video').ranges) === JSON.stringify([{ from: 1, to: 3 }]))
  await shot('07-attach')
  await plan.getByTestId('chat-input').fill('이 느낌 좋아요 https://www.youtube.com/watch?v=xxxxxxxxxxx')
  await plan.getByTestId('attach-chip').nth(1).waitFor({ timeout: 10000 })
  check('a YouTube address becomes an attachment', (await win.evaluate((id) => window.studio.references.list(id), pid)).some((r) => r.kind === 'youtube'))
  await shot('08-youtube')

  // ---- before export: nothing to warn about yet ----
  const pre = await win.evaluate((id) => window.studio.renders.preflight(id), pid)
  check('preflight runs (no imports, no copies)', Array.isArray(pre.copies) && pre.imports.length === 0)
  check('no BRIEF.md written by the app', !existsSync(join(dir, 'composition', 'BRIEF.md')))
} catch (e) {
  console.error('FAILED:', e.message)
  await shot('zz-failure').catch(() => {})
  failed++
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
