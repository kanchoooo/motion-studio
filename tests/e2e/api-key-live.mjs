// 사용자 Claude API 키 with a real key (spends a little of it, and one short reply of the subscription):
//  - a request on the key: answered, its cost shown
//  - the key stops working mid-conversation (the app hands Claude Code a broken key: MS_TEST_BREAK_KEY,
//    the saved key itself is never changed): the same conversation goes on on the subscription and the
//    request is answered there
//  - "다시 API 키로": the next request is on the key again
// The key is entered by the designer in AI 연결 beforehand (it is in <sandbox>/userdata/claude-api.json and
// stays there). The project folder is backed up and put back; the test conversation is a new one.
// MS_SANDBOX=$TMPDIR/ms-p6-F0ERf9 node tests/e2e/api-key-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const userdata = join(sandbox, 'userdata')
if (!existsSync(join(userdata, 'claude-api.json')) || !/"(key|sealed)"/.test(readFileSync(join(userdata, 'claude-api.json'), 'utf8'))) {
  console.log('먼저 이 샌드박스의 앱에서 AI 연결 → Claude API 키에 키를 넣어 주세요.')
  process.exit(2)
}
const keep = mkdtempSync(join(tmpdir(), 'ms-apilive-'))
cpSync(proj, join(keep, 'proj'), { recursive: true })
const meta = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
writeFileSync(join(proj, 'project.json'), JSON.stringify({ ...meta, agentSessionId: undefined }, null, 2))
const breakFlag = join(keep, 'break-key')

grantAccess(userdata)
const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: userdata, MS_NO_UPDATE: '1', MS_TEST_BREAK_KEY: breakFlag },
})
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
let failed = 0
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const until = async (f, ms = 30000) => {
  for (const t = Date.now(); Date.now() - t < ms; ) {
    if (await f().catch(() => false)) return true
    await win.waitForTimeout(500)
  }
  return false
}
let pid = ''
const sessionIds = new Set()
const state = () => win.evaluate((id) => window.studio.agent.state(id), pid)
const ready = (auth, ms = 180000) =>
  until(async () => {
    const s = await state()
    if (s.sessionId) sessionIds.add(s.sessionId)
    return s.status === 'ready' && s.auth === auth
  }, ms)
const chat = () => win.getByTestId('chat-list').innerText()
const send = async (text) => {
  const input = win.getByPlaceholder(/Claude에게 요청하기/)
  await input.fill(text)
  await input.press('Enter')
}
const cost = () => win.evaluate((id) => window.studio.claudeApi.cost(id), pid)

try {
  await toHome(win)
  // a fallback left by an earlier run is not this run's
  await win.evaluate(() => window.studio.claudeApi.retry())
  const st0 = await win.evaluate(() => window.studio.claudeApi.status())
  check('the key entered in AI 연결 is there and used', st0.hasKey && st0.using === 'api', JSON.stringify({ ...st0, hint: undefined }))
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 30000 })
  pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').id
  await win.evaluate((id) => window.studio.agent.start(id), pid)
  check('the session starts on the key', await ready('api'), JSON.stringify(await state()))

  // ---- a request on the key ----
  await send('연결 테스트예요. 영상과 파일은 절대 바꾸지 말고, "확인"이라고 한 단어로만 답해 주세요.')
  check('Claude answers', await until(async () => /확인/.test((await chat()).slice(-80)) && (await state()).status === 'ready', 240000), (await chat()).slice(-200))
  // the key itself may not be usable (no credits on its organization): said plainly, the rest needs a usable key
  const usable = await win.evaluate(() => window.studio.claudeApi.status())
  if (usable.fallback) {
    log('  terminal:', (await win.evaluate((id) => window.studio.terminal.snapshot(id), pid).catch(() => '')).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, ' ').slice(-1500))
    check(`…on the key (the API refused it: ${usable.fallback.reason} · ${usable.fallback.detail ?? ''}; the subscription answered instead)`, false)
    throw new Error('이 키로는 Claude를 쓸 수 없어요: 크레딧이 있는 조직의 키인지 Console에서 확인해 주세요.')
  }
  check('…on the key', (await state()).auth === 'api')
  const c1 = await cost()
  log(`  this request ${c1.turn.toFixed(4)} $, project ${c1.project.toFixed(4)} $, this month ${c1.month.toFixed(4)} $`)
  check('…and the chat shows what it cost', c1.turn > 0 && (await win.getByTestId('api-usage').innerText()).includes('API 키'), JSON.stringify(c1))
  const sid = (await state()).sessionId

  // ---- the key stops working ----
  // the key Claude Code holds is refused from now (a fresh process asks the app for it)
  writeFileSync(breakFlag, '1')
  await win.evaluate((id) => window.studio.agent.restart(id), pid)
  await ready('api')
  await send('두 번째 테스트예요. 영상과 파일은 바꾸지 말고, "두 번째"라고만 답해 주세요.')
  const tBreak = Date.now()
  check('the key is refused: the same conversation moves to the subscription', await ready('subscription', 120000), `${JSON.stringify(await state())} after ${Math.round((Date.now() - tBreak) / 1000)} s`)
  log(`  moved after ${Math.round((Date.now() - tBreak) / 1000)} s`)
  check('…the same conversation', (await state()).sessionId === sid)
  check('…and the request is answered on the subscription', await until(async () => /두 번째/.test((await chat()).slice(-60)) && (await state()).status === 'ready', 240000), (await chat()).slice(-300))
  const st1 = await win.evaluate(() => window.studio.claudeApi.status())
  check('…the app says the key cannot be used', st1.using === 'subscription' && st1.fallback?.reason === 'auth', JSON.stringify(st1.fallback))

  // ---- the key again ----
  rmSync(breakFlag, { force: true })
  await win.evaluate(() => window.studio.claudeApi.retry())
  check('"다시 API 키로": back on the key', await ready('api'), JSON.stringify(await state()))
  await send('세 번째 테스트예요. 영상과 파일은 바꾸지 말고, "세 번째"라고만 답해 주세요.')
  check('the next request is answered on the key', await until(async () => /세 번째/.test((await chat()).slice(-60)) && (await state()).status === 'ready', 240000), (await chat()).slice(-200))
  const c3 = await cost()
  log(`  this request ${c3.turn.toFixed(4)} $, project ${c3.project.toFixed(4)} $, this month ${c3.month.toFixed(4)} $`)
  check('…its cost is counted', c3.turn > 0 && c3.project > c1.project, JSON.stringify(c3))
  check('…still the same conversation', (await state()).sessionId === sid)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'api-key-live.png') }).catch(() => {})
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'api-key-live-fail.png') }).catch(() => {})
} finally {
  await app.evaluate(({ dialog }) => (dialog.showMessageBoxSync = () => 1)).catch(() => {})
  await app.close().catch(() => {})
  rmSync(proj, { recursive: true, force: true })
  cpSync(join(keep, 'proj'), proj, { recursive: true })
  rmSync(keep, { recursive: true, force: true })
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  for (const id of sessionIds) {
    if (id === meta.agentSessionId || !/^[0-9a-f-]{36}$/.test(id)) continue
    for (const d of existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name) : []) {
      rmSync(join(base, d, `${id}.jsonl`), { force: true })
      rmSync(join(base, d, id), { recursive: true, force: true })
    }
  }
}
console.log(failed ? `\n${failed} failed` : '\napi key live: all passed')
process.exit(failed ? 1 : 0)
