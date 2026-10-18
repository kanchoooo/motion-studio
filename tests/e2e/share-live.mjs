// 프로젝트 공유 with real Claude sessions (the logged-in account, the app's default model):
//  - the sender's Claude writes the handoff memo (save_handoff) into the share window — Korean, the
//    project's goal, decisions and what is left; none of the designer's messages quoted
//  - the file is made and opened as a new project; its new Claude session (no conversation) reads
//    the memo first and picks up the project from it
// The folder-trust question is never answered by a test: the receiving project is put in the trusted
// folder's place for the second half. Everything is backed up first and put back afterwards.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted (ms-p6-…)> node tests/e2e/share-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
if (!sandbox) throw new Error('MS_SANDBOX=<sandbox with the trusted "앱 주문 런칭" project> required')
const NAME = '앱 주문 런칭'
const proj = join(sandbox, 'projects', `${NAME}.msproj`)
const received = join(sandbox, 'projects', `${NAME} 2.msproj`)
const backup = join(sandbox, `backup-share-live-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`)
const file = join(backup, `${NAME}.msshare`)
const shots = join(root, 'tests', 'e2e', 'shots-live')
mkdirSync(shots, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

cpSync(proj, join(backup, 'project'), { recursive: true })
cpSync(join(sandbox, 'userdata'), join(backup, 'userdata'), { recursive: true })
function restore() {
  for (const d of [proj, received]) rmSync(d, { recursive: true, force: true })
  cpSync(join(backup, 'project'), proj, { recursive: true })
  rmSync(join(sandbox, 'userdata'), { recursive: true, force: true })
  cpSync(join(backup, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
  rmSync(backup, { recursive: true, force: true })
}
const meta = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
delete meta.agentModel
delete meta.agentEffort
writeFileSync(join(proj, 'project.json'), JSON.stringify(meta, null, 2))

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
async function closeApp() {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  }).catch(() => {})
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20000))])
  if (!closed) app.process().kill('SIGKILL')
}
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    try {
      app.process().kill('SIGKILL')
    } catch {
      /* gone */
    }
    restore()
    process.exit(1)
  })
const state = (pid) => win.evaluate((id) => window.studio.agent.state(id), pid)
const chat = (pid) => win.evaluate((id) => window.studio.agent.transcript(id), pid)
async function ready(pid, minutes = 3) {
  for (let i = 0; i < minutes * 60; i++) {
    const s = await state(pid)
    if (s.attention === 'trust') throw new Error('not a trusted folder (a test never answers that question)')
    if (s.status === 'ready') return true
    await win.waitForTimeout(1000)
  }
  return false
}
async function waitTurns(pid, label, minutes) {
  for (let i = 0; i < 90 && (await state(pid)).status !== 'busy'; i++) await win.waitForTimeout(1000)
  let quiet = 0
  for (let i = 0; i < minutes * 60; i++) {
    const s = await state(pid)
    if (s.attention === 'usage' || s.attention === 'login' || s.attention === 'trust') throw new Error(`Claude needs the designer (${s.attention})`)
    quiet = s.status === 'ready' ? quiet + 1 : 0
    if (quiet >= 20) return true
    if (i % 60 === 0) log('…', label, s.status)
    await win.waitForTimeout(1000)
  }
  return false
}
const pidOf = async (name) => (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === name)?.id

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: NAME }).first().click()
  const pid = await pidOf(NAME)
  check('sender: session ready', await ready(pid))
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'all'), pid)

  // ---- the sender's Claude writes the memo ----
  await win.getByTestId('share-open').click()
  await win.getByTestId('share-ask').click()
  let memo = ''
  for (let i = 0; i < 600 && !memo; i++) {
    const v = await win.getByTestId('share-memo').inputValue()
    if (v.length > 120) memo = v
    else await win.waitForTimeout(1000)
  }
  log('memo:', memo.replace(/\s+/g, ' ').slice(0, 600))
  check('Claude writes the handoff memo into the share window', memo.length > 300 && /[가-힣]/.test(memo), memo.slice(0, 200))
  check('…covering the goal, the style and what is left', /목표/.test(memo) && /(스타일|색|폰트|글꼴)/.test(memo) && /(남은|할 일|다음)/.test(memo))
  check('…saved for the share (.studio/handoff.md)', existsSync(join(proj, '.studio', 'handoff.md')))
  await win.screenshot({ path: join(shots, 'share-live-memo.png') })
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f })
  }, file)
  await win.getByTestId('share-make').click()
  await win.getByTestId('share-made').waitFor({ timeout: 120000 })
  check('the share file is made', existsSync(file))
  await win.locator('.modal').getByRole('button', { name: '닫기' }).last().click()

  // ---- the other designer: the file opened as a new project in the trusted folder's place ----
  await win.locator('button[title="홈으로"]').first().click()
  await win.getByTestId('open-share').waitFor()
  const st = await win.evaluate((f) => window.studio.projects.importShare(f), file)
  check('the file opens as a new project', !!st && existsSync(join(received, 'project.json')), JSON.stringify(st?.path))
  await closeApp()
  // (the received project takes the trusted folder's place: the trust question never comes up)
  renameSync(proj, `${proj}.sender`)
  renameSync(received, proj)
  const app2 = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
  const win2 = await app2.firstWindow()
  try {
    await win2.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
    await toHome(win2)
    // the top of the projects folder, then the received project's card (named "… 2": the sender's was there too)
    await win2.getByTestId('tree-root').click()
    const rname = (await win2.evaluate(() => window.studio.projects.list())).find((x) => x.path.endsWith(`${NAME}.msproj`))?.name
    await win2.getByTestId('project-card').filter({ has: win2.locator('.ellipsis', { hasText: new RegExp(`^${rname}$`) }) }).first().click()
    await win2.locator('.drag .seg').waitFor({ timeout: 30000 })
    // (by its folder name: /var and /private/var are the same folder on a Mac)
    const rpid = (await win2.evaluate(() => window.studio.projects.list())).find((x) => x.path.endsWith(`${NAME}.msproj`))?.id
    if (!rpid) throw new Error('the received project is not listed')
    for (let i = 0; i < 120 && (await win2.evaluate((id) => window.studio.agent.state(id), rpid)).status !== 'ready'; i++) await win2.waitForTimeout(1000)
    const rmeta = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
    check('receiver: a new conversation (not the sender’s)', rmeta.agentSessionId !== meta.agentSessionId && !!rmeta.sharedFrom, JSON.stringify(rmeta))
    await win2.evaluate((id) => window.studio.agent.setPermission(id, 'all'), rpid)
    const askAt = Date.now()
    const input = win2.getByPlaceholder(/Claude에게 요청하기|만들고 싶은 영상을/)
    await input.fill('안녕하세요, 이 프로젝트를 이어서 맡게 됐어요. 영상은 고치지 말고, 지금 어떤 상태인지와 다음에 할 일을 짧게 알려 주세요.')
    await input.press('Enter')
    let quiet = 0
    for (let i = 0; i < 90 && (await win2.evaluate((id) => window.studio.agent.state(id), rpid)).status !== 'busy'; i++) await win2.waitForTimeout(1000)
    for (let i = 0; i < 600 && quiet < 20; i++) {
      quiet = (await win2.evaluate((id) => window.studio.agent.state(id), rpid)).status === 'ready' ? quiet + 1 : 0
      await win2.waitForTimeout(1000)
    }
    const items = await win2.evaluate((id) => window.studio.agent.transcript(id), rpid)
    const reply = items.filter((x) => x.role === 'assistant' && Date.parse(x.at) >= askAt).map((x) => x.text).join('\n')
    log('receiver Claude:', reply.replace(/\s+/g, ' ').slice(0, 700))
    // the receiver's Claude opened the memo
    const sid = rmeta.agentSessionId
    const dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
    const tf = readdirSync(dir).map((d) => join(dir, d, `${sid}.jsonl`)).find((f) => existsSync(f))
    const readMemo = !!tf && readFileSync(tf, 'utf8').includes('handoff.md')
    check('the receiving Claude reads the handoff memo', readMemo)
    // the reply carries what the memo says (a few of its own words), from a session that never saw the conversation
    const words = [...new Set((memo.match(/[가-힣A-Za-z]{2,}/g) ?? []).filter((w) => w.length >= 3))].slice(0, 80)
    const shared = words.filter((w) => reply.includes(w))
    check('…and picks the project up from it (its reply uses the memo’s facts)', reply.length > 40 && shared.length >= 3, JSON.stringify(shared.slice(0, 10)))
    await win2.screenshot({ path: join(shots, 'share-live-received.png') })
  } finally {
    await app2.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1
    }).catch(() => {})
    await Promise.race([app2.close().catch(() => {}), new Promise((r) => setTimeout(r, 20000))])
    rmSync(proj, { recursive: true, force: true })
    renameSync(`${proj}.sender`, proj)
  }
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'share-live-fail.png') }).catch(() => {})
} finally {
  await closeApp()
  if (existsSync(`${proj}.sender`)) {
    rmSync(proj, { recursive: true, force: true })
    renameSync(`${proj}.sender`, proj)
  }
  restore()
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
