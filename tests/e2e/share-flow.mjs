// 프로젝트 공유, in the app (no Claude: the memo is typed):
//  - 공유 → the window says what goes in and what never does; the memo is required
//  - the file has the video, materials, brief, storyboard, hand edits and the memo — not the
//    designer's messages (feedback/), the version history, the exported videos or the chat
//  - Home → 공유 파일 열기: a new project next to the original (its own id, no conversation), opened,
//    with a notice in the chat; its Claude session is told to read the memo first
// The sandbox is copied; the copy is removed afterwards.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/share-flow.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-share-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
// something private to leave behind: a message of the designer's, and an exported video
mkdirSync(join(proj, 'feedback'), { recursive: true })
writeFileSync(join(proj, 'feedback', 'msg-private.md'), '# 디자이너 메시지\n\n광고주 담당자 연락처 010-0000-0000')
mkdirSync(join(proj, 'renders'), { recursive: true })
writeFileSync(join(proj, 'renders', 'final-test.mp4'), 'video')
const file = join(sandbox, '앱 주문 런칭.msshare')
const MEMO = '# 인계 메모\n\n- 목표: 모션커피 오더 앱 출시 8초 광고\n- 스타일: 주황 #FF7A2F, 둥근 카드\n- 남은 일: 엔드 카드 문구 다듬기'
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByTestId('share-open').click()
  const modal = win.locator('.modal').filter({ hasText: '프로젝트 공유' })
  await modal.waitFor()
  const text = await modal.innerText()
  check('공유: says the conversation, messages, history and exports stay here', /대화 기록과 보낸 메시지 원문, 작업 이력, 내보낸 영상은 넣지 않아요/.test(text))
  check('…the memo is needed before a file is made', await win.getByTestId('share-make').isDisabled())
  await win.getByTestId('share-memo').fill(MEMO)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f })
  }, file)
  await win.getByTestId('share-make').click()
  await win.getByTestId('share-made').waitFor({ timeout: 60000 })
  check('the share file is made', existsSync(file))
  const names = execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(i.filename for i in zipfile.ZipFile(sys.argv[1]).infolist()))', file], { encoding: 'utf8' }).split('\n')
  check('…with the video, materials, brief, edits and the memo', ['composition/index.html', 'brief.json', 'overrides.json', '.studio/handoff.md', 'project.json'].every((n) => names.includes(n)) && names.some((n) => n.startsWith('composition/assets/')), names.slice(0, 20).join(' '))
  check('…and none of the messages, history, exports or chat', !names.some((n) => /^(feedback|\.history|renders)\//.test(n) || n === 'chat.json' || n === 'history-meta.json'), names.filter((n) => /^(feedback|\.history|renders)\/|chat\.json/.test(n)).join(' '))
  const memo = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read(".studio/handoff.md").decode())', file], { encoding: 'utf8' })
  check('…the memo as the designer wrote it', memo.includes('엔드 카드 문구 다듬기'))
  const shared = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("project.json").decode())', file], { encoding: 'utf8' }))
  check('…its project.json without the conversation or permissions', !shared.agentSessionId && !shared.agentPermission && !shared.id, JSON.stringify(shared))
  await win.locator('.modal').getByRole('button', { name: '닫기' }).last().click()

  // ---- the other designer: Home → 공유 파일 열기 ----
  await win.locator('button[title="홈으로"]').first().click()
  await win.getByTestId('open-share').waitFor({ timeout: 15000 })
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, file)
  await win.getByTestId('open-share').click()
  const copy = join(sandbox, 'projects', '앱 주문 런칭 2.msproj')
  check('공유 파일 열기: a new project next to the original', await (async () => {
    for (let i = 0; i < 60 && !existsSync(join(copy, 'project.json')); i++) await win.waitForTimeout(500)
    return existsSync(join(copy, 'project.json'))
  })())
  await win.getByText('공유받은 프로젝트예요').first().waitFor({ timeout: 20000 }).catch(() => {})
  const meta = JSON.parse(readFileSync(join(copy, 'project.json'), 'utf8'))
  const orig = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
  check('…its own id, no conversation, marked as shared', meta.id !== orig.id && !meta.agentSessionId?.startsWith(orig.agentSessionId ?? '-') && !!meta.sharedFrom, JSON.stringify(meta))
  check('…opened, with a notice in the chat', (await win.getByText('공유받은 프로젝트예요').count()) > 0)
  check('…no messages or exports of the sender', !existsSync(join(copy, 'feedback', 'msg-private.md')) && !existsSync(join(copy, 'renders', 'final-test.mp4')))
  const prompt = join(copy, '.studio', 'system-prompt.md')
  for (let i = 0; i < 40 && !existsSync(prompt); i++) await win.waitForTimeout(500)
  check('…its Claude session is told to read the memo first', existsSync(prompt) && readFileSync(prompt, 'utf8').includes('.studio/handoff.md'))
  check('…the original stays as it was', existsSync(join(proj, 'feedback', 'msg-private.md')) && JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8')).id === orig.id)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'share-received.png') })
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'share-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} failed` : '\nshare flow: all passed')
process.exit(failed ? 1 : 0)
