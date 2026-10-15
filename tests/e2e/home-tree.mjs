// Phase 11 home screen (no Claude calls):
//  - folder tree: new folder, a folder inside it, move a project with the card menu and by
//    dragging its card onto a folder (the folder moves on disk), 새 프로젝트 in a folder
//  - 베리에이션 만들기 from the home screen: original picked from the folder, rows added one by
//    one with ratio / size / length / extra request; instant (same-ratio) rows are made next to
//    the original; a row with a request is marked as Claude's
//  - 템플릿 만들기 → 템플릿으로 새 프로젝트: the picked text and image slots change, the motion
//    (composition) stays; 템플릿 칸 changes them again inside the project
//  - 결과물 player fits the window for a vertical video; the chat list never squashes a card;
//    a new project opens on the planning chat
// Works on a copy of the sandbox.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/home-tree.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-p11-')))
cpSync(process.env.MS_SANDBOX, sandbox, { recursive: true })
const shots = join(root, 'tests', 'e2e', 'shots')
const projects = join(sandbox, 'projects')
const source = '앱 주문 런칭'

// a vertical export for the 결과물 player check
const proj = join(projects, `${source}.msproj`)
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2', '-pix_fmt', 'yuv420p', join(proj, 'renders', 'vertical-check.mp4')])
const index = JSON.parse(readFileSync(join(proj, 'renders', 'index.json'), 'utf8'))
writeFileSync(join(proj, 'renders', 'index.json'), JSON.stringify([{ ...index[0], id: 'vertical-check', file: 'renders/vertical-check.mp4', fileName: 'vertical-check.mp4', width: 1080, height: 1920, duration: 2, thumbnail: undefined }, ...index]))
// a picture for the template's image slot
const newImage = join(sandbox, 'new-picture.png')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xff3366:size=640x640', '-frames:v', '1', newImage])
// the sandbox video is all shapes: give it a photo element so a template has an image slot
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x33aaff:size=400x400', '-frames:v', '1', join(proj, 'composition', 'assets', 'photo.png')])
const compFile = join(proj, 'composition', 'index.html')
const comp = readFileSync(compFile, 'utf8')
if (!comp.includes('data-ms-id="test-photo"')) {
  // right inside the root: not in a block the app manages (the BGM block is rewritten on open)
  const rootTag = comp.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
  const at = rootTag.index + rootTag[0].length
  writeFileSync(compFile, `${comp.slice(0, at)}\n      <img id="test-photo" data-ms-id="test-photo" data-ms-label="테스트 사진" data-ms-type="image" src="assets/photo.png" style="position:absolute;left:60px;top:60px;width:200px;height:200px" />${comp.slice(at)}`)
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: projects, MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const list = () => win.evaluate(() => window.studio.projects.list())
const nameModal = async (text, confirm) => {
  await win.locator('.scrim input').first().fill(text)
  await win.locator('.scrim').getByRole('button', { name: confirm, exact: true }).click()
  await win.locator('.scrim').waitFor({ state: 'detached', timeout: 10000 })
}
const home = async () => {
  await win.getByTitle('홈으로').click()
  await win.getByTestId('folder-tree').waitFor()
}

try {
  await toHome(win)
  await win.getByTestId('tree-root').click()

  // ---- folders ----
  await win.getByTestId('new-folder').click()
  await nameModal('직방 브랜드 광고', '만들기')
  check('a new folder is made and opened', existsSync(join(projects, '직방 브랜드 광고')) && (await win.getByTestId('breadcrumb').innerText()).includes('직방 브랜드 광고'))
  await win.getByTestId('new-folder').click()
  await nameModal('숏츠', '만들기')
  check('a folder inside the folder', existsSync(join(projects, '직방 브랜드 광고', '숏츠')) && (await win.getByTestId('tree-folder').count()) === 2)

  // move with the card menu
  await win.getByTestId('tree-root').click()
  const card = win.getByTestId('project-card').filter({ hasText: source }).first()
  await card.getByTitle('더보기').click()
  await win.getByText('다른 폴더로 옮기기').click()
  await win.getByTestId('move-folders').locator('[data-folder="직방 브랜드 광고"]').click()
  await win.getByTestId('move-confirm').click()
  await win.waitForTimeout(800)
  const moved = (await list()).find((p) => p.name === source)
  check('moved into the folder (on disk too)', moved?.folder === '직방 브랜드 광고' && existsSync(join(projects, '직방 브랜드 광고', `${source}.msproj`, 'project.json')), JSON.stringify(moved?.folder))
  check('the folder card counts it', (await win.getByTestId('folder-card').filter({ hasText: '직방 브랜드 광고' }).innerText()).includes('프로젝트 1개'))

  // a blank project in the folder
  await win.getByTestId('tree-folder').filter({ hasText: '직방 브랜드 광고' }).first().click()
  await win.getByTestId('new-project').click()
  await win.getByTestId('project-name').fill('빈 시안')
  check('the new project defaults to this folder', (await win.getByTestId('project-folder').inputValue()) === '직방 브랜드 광고')
  await win.getByTestId('create-project').click()
  await win.getByTitle('홈으로').waitFor({ timeout: 20000 })
  check('created inside the folder', existsSync(join(projects, '직방 브랜드 광고', '빈 시안.msproj', 'project.json')))
  // a new project opens on the planning chat; the editor's empty chat points there
  check('a new project opens on the planning chat', await win.getByTestId('plan-empty').isVisible())
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  check('the editor chat points to the brief tab', await win.getByTestId('go-plan').isVisible())
  await home()

  // drag a card onto a folder in the tree
  await win.getByTestId('project-card').filter({ hasText: '빈 시안' }).dragTo(win.getByTestId('tree-folder').filter({ hasText: '숏츠' }))
  await win.waitForTimeout(800)
  check('dragging a card onto a folder moves it', existsSync(join(projects, '직방 브랜드 광고', '숏츠', '빈 시안.msproj', 'project.json')))
  await win.screenshot({ path: join(shots, 'p11-home-tree.png') })

  // ---- variations from the home screen ----
  await win.getByTestId('tree-folder').filter({ hasText: '직방 브랜드 광고' }).first().click()
  await win.getByTestId('new-variation').click()
  const vm = win.locator('.scrim')
  await win.getByTestId('variation-row').first().waitFor({ timeout: 15000 })
  check('the original is picked from the folder', (await win.getByTestId('variation-source').locator('option:checked').innerText()).includes(source))
  // row 1: same ratio, smaller (instant); row 2: same ratio, another size + a request (Claude)
  await win.getByTestId('variation-preset').nth(0).selectOption('custom')
  const row1 = win.getByTestId('variation-row').nth(0)
  await row1.locator('input').nth(0).fill('1280')
  await row1.locator('input').nth(0).press('Enter')
  await row1.locator('input').nth(1).fill('720')
  await row1.locator('input').nth(1).press('Enter')
  check('same ratio, other size = instant', (await row1.innerText()).includes('크기만 변환'), await row1.innerText())
  await win.getByTestId('variation-add').click()
  const row2 = win.getByTestId('variation-row').nth(1)
  await win.getByTestId('variation-preset').nth(1).selectOption('custom')
  await row2.locator('input').nth(0).fill('960')
  await row2.locator('input').nth(0).press('Enter')
  await row2.locator('input').nth(1).fill('540')
  await row2.locator('input').nth(1).press('Enter')
  await row2.getByTestId('variation-note').fill('마지막 문구를 더 크게')
  check('a request makes it Claude’s', (await row2.innerText()).includes('Claude가 다시 구성'))
  await vm.screenshot({ path: join(shots, 'p11-variation-modal.png') })
  // keep the run free of Claude: drop the request again
  await row2.getByTestId('variation-note').fill('')
  await win.getByTestId('variation-run').click()
  await vm.waitFor({ state: 'detached', timeout: 20000 })
  await win.waitForTimeout(1000)
  const fam = (await list()).filter((p) => p.family && p.name.startsWith(source))
  check(`two variations made next to the original (${fam.length})`, fam.length === 2 && fam.every((p) => p.folder === '직방 브랜드 광고'), JSON.stringify(fam.map((p) => [p.name, p.folder])))
  check('they show on the original card', (await win.getByTestId('project-card').filter({ hasText: source }).getByTestId('variation-badge').count()) === 2)

  // ---- template ----
  await win.getByTestId('new-template').click()
  await win.getByTestId('template-slot').first().waitFor({ timeout: 15000 })
  check('the template source is the folder’s finished project', (await win.getByTestId('template-source').locator('option:checked').innerText()).includes(source))
  const slots = win.getByTestId('template-slot')
  const n = await slots.count()
  const kinds = await slots.locator('.badge').allInnerTexts()
  check(`slots found (${n}: ${[...new Set(kinds)].join(', ')})`, n >= 2 && kinds.includes('글자') && kinds.includes('이미지'))
  // keep the first text and the first image only
  await win.locator('.scrim').getByRole('button', { name: '없음', exact: true }).click()
  const firstText = slots.filter({ has: win.locator('.badge', { hasText: '글자' }) }).first()
  const firstImage = slots.filter({ has: win.locator('.badge', { hasText: '이미지' }) }).first()
  await firstText.locator('input[type=checkbox]').check()
  await firstImage.locator('input[type=checkbox]').check()
  await firstText.locator('input.input').first().fill('메인 문구')
  await firstImage.locator('input.input').first().fill('대표 이미지')
  await win.getByTestId('template-name').fill('앱 런칭 템플릿')
  await win.screenshot({ path: join(shots, 'p11-template-create.png') })
  await win.getByTestId('template-save').click()
  await win.getByTestId('tree-template').first().waitFor({ timeout: 10000 })
  const tpl = (await win.evaluate(() => window.studio.templates.list()))[0]
  check('template saved with 2 slots', tpl?.name === '앱 런칭 템플릿' && tpl.slots.length === 2, JSON.stringify(tpl?.slots.map((s) => s.label)))

  // a new project from it: new copy + new picture
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, newImage)
  await win.getByTestId('tree-template').first().click()
  await win.getByTestId('slot-form').waitFor()
  await win.getByTestId('slot-text').first().fill('새 캠페인 문구')
  await win.getByTestId('slot-pick').first().click()
  await win.getByText('new-picture.png').waitFor({ timeout: 5000 })
  await win.getByTestId('project-name').fill('템플릿 시안')
  await win.locator('.scrim').screenshot({ path: join(shots, 'p11-template-use.png') })
  await win.getByTestId('create-project').click()
  await win.getByTitle('홈으로').waitFor({ timeout: 20000 })
  const made = join(projects, '직방 브랜드 광고', '템플릿 시안.msproj')
  const ov = JSON.parse(readFileSync(join(made, 'overrides.json'), 'utf8'))
  const textSlot = tpl.slots.find((s) => s.kind === 'text')
  const imageSlot = tpl.slots.find((s) => s.kind === 'image')
  check('the text slot is a designer edit with the new copy', ov.elements?.[textSlot.id]?.text === '새 캠페인 문구', JSON.stringify(ov.elements?.[textSlot.id]))
  const html = readFileSync(join(made, 'composition', 'index.html'), 'utf8')
  const srcHtml = readFileSync(join(projects, '직방 브랜드 광고', `${source}.msproj`, 'composition', 'index.html'), 'utf8')
  check('the image slot points at the new picture', /assets\/tpl-new-picture\.png/.test(html) && existsSync(join(made, 'composition', 'assets', 'tpl-new-picture.png')))
  check('everything else (the motion) is the same', html.replace(/assets\/tpl-new-picture\.png/, imageSlot.original) === srcHtml)
  const pm = JSON.parse(readFileSync(join(made, 'project.json'), 'utf8'))
  check('the project knows its template', pm.template?.name === '앱 런칭 템플릿')
  // the preview shows the new copy
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const frame = win.frameLocator('iframe').first()
  await frame.locator(`[data-ms-id="${textSlot.id}"]`).first().waitFor({ timeout: 30000 })
  await win.waitForTimeout(1500)
  check('the preview shows the new copy', (await frame.locator(`[data-ms-id="${textSlot.id}"]`).first().innerText()).replace(/\s+/g, '') === '새캠페인문구')
  // 템플릿 칸: change the copy again inside the project
  await win.getByTestId('template-slots-open').click()
  await win.getByTestId('slot-text').first().fill('한 번 더 바꾼 문구')
  await win.getByTestId('slots-apply').click()
  await win.locator('.scrim').waitFor({ state: 'detached', timeout: 10000 })
  const ov2 = JSON.parse(readFileSync(join(made, 'overrides.json'), 'utf8'))
  check('템플릿 칸 changes the slot again', ov2.elements?.[textSlot.id]?.text === '한 번 더 바꾼 문구')
  await home()

  // ---- results player fits a vertical video ----
  await win.getByTestId('tree-folder').filter({ hasText: '직방 브랜드 광고' }).first().click()
  await win.getByTestId('project-card').filter({ hasText: source }).click()
  await win.locator('.drag .seg').getByRole('button', { name: '결과물' }).click()
  await win.locator('.card').filter({ hasText: 'vertical-check.mp4' }).first().locator('div').first().click()
  const player = win.getByTestId('result-player')
  await player.waitFor()
  await win.waitForTimeout(800)
  const box = await player.boundingBox()
  const vp = win.viewportSize()
  check(`the vertical result fits the window (${Math.round(box.height)}px of ${vp.height}px)`, box.y >= 0 && box.y + box.height <= vp.height, JSON.stringify(box))
  await win.screenshot({ path: join(shots, 'p11-results-vertical.png') })
  await win.keyboard.press('Escape')

  // ---- the chat list never squashes its rows ----
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const shrink = await win.evaluate(() => [...document.querySelectorAll('.chat-list > *')].map((e) => getComputedStyle(e).flexShrink))
  check('chat rows keep their height', shrink.length > 0 && shrink.every((s) => s === '0'), shrink.join(','))
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p11-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(`sandbox: ${sandbox}`)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
