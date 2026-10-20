// 사용자 Claude API 키, in the app against a stand-in API (mock-anthropic.mjs: nothing is charged):
//  - AI 연결 → Claude API 키: the key is checked, kept, shown by its last characters
//  - the conversation runs on the key (no Remote Control); the chat shows what the request cost
//  - the credits run out mid-conversation: the same conversation restarts on the Claude subscription
//    (the message that would go on is held: MS_TEST_HOLD_CONTINUE, so the subscription is not spent)
//  - "다시 API 키로": the idle session is back on the key; removing the key puts it on the subscription
// The live session needs a trusted folder: MS_SANDBOX=<the trusted ms-p6 sandbox>. The project folder
// is backed up and put back, and the test conversation is a new one (the project's own is kept).
// MS_SANDBOX=$TMPDIR/ms-p6-F0ERf9 node tests/e2e/api-key.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
import { startMock, USAGE } from './mock-anthropic.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const userdata = join(sandbox, 'userdata')
const keep = mkdtempSync(join(tmpdir(), 'ms-apikey-'))
cpSync(proj, join(keep, 'proj'), { recursive: true })
const meta = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'))
// a conversation of the test's own (the project's stays as it was)
writeFileSync(join(proj, 'project.json'), JSON.stringify({ ...meta, agentSessionId: undefined }, null, 2))
// a key already saved in this sandbox (the real-key test's) is put aside and back afterwards
const KEY_FILES = ['claude-api.json', 'claude-api-usage.json']
for (const f of KEY_FILES) if (existsSync(join(userdata, f))) cpSync(join(userdata, f), join(keep, f))
for (const f of KEY_FILES) rmSync(join(userdata, f), { force: true })

const key = `sk-ant-api03-${'t'.repeat(36)}abcd`
const mock = await startMock({ key })
grantAccess(userdata)
const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: userdata, MS_NO_UPDATE: '1', MS_TEST_ANTHROPIC_BASE_URL: mock.url, MS_TEST_HOLD_CONTINUE: '1' },
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
    await win.waitForTimeout(400)
  }
  return false
}
let pid = ''
let sessionIds = new Set()
const state = () => win.evaluate((id) => window.studio.agent.state(id), pid)
const ready = async (auth) => {
  const t = Date.now()
  let last = null
  const ok = await until(async () => {
    const s = await state()
    if (s.sessionId) sessionIds.add(s.sessionId)
    if (JSON.stringify(last) !== JSON.stringify(s)) log('  state', s.status, s.auth, s.attention ?? '', s.pendingRestart ? 'pendingRestart' : '')
    last = s
    return s.status === 'ready' && s.auth === auth
  }, 120000)
  if (Date.now() - t > 20000) log(`  (waited ${Math.round((Date.now() - t) / 1000)} s for ${auth}; terminal: ${(await win.evaluate((id) => window.studio.terminal.snapshot(id), pid).catch(() => '')).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\s+/g, ' ').slice(-600)})`)
  return ok
}
const chat = () => win.getByTestId('chat-list').innerText()
const send = async (text) => {
  const input = win.getByPlaceholder(/Claude에게 요청하기/)
  await input.fill(text)
  await input.press('Enter')
}

try {
  await toHome(win)
  // ---- the key in AI 연결 ----
  await win.locator('button[title*="힉스필드"]').first().click()
  const card = win.getByTestId('claude-key-card')
  await card.waitFor({ timeout: 10000 })
  await card.getByTestId('claude-key-input').fill('sk-ant-api03-wrong')
  await card.getByTestId('claude-key-save').click()
  check('a key of the wrong shape is refused', await until(async () => (await win.locator('.toast').allInnerTexts()).some((t) => t.includes('API 키 모양이 아니에요')), 8000))
  await card.getByTestId('claude-key-input').fill(key)
  await card.getByTestId('claude-key-save').click()
  check('the key is checked and kept (shown by its last characters)', await until(async () => (await card.getByTestId('claude-key-hint').innerText()).includes('abcd'), 15000))
  check('…the check asked the API with it', mock.state.requests.some((r) => r.url.startsWith('/v1/models') && r.key === 'ok'))
  check('…and the card says the conversation uses it', (await card.getByTestId('claude-key-using').innerText()).includes('API 키로 대화'))
  const onDisk = readFileSync(join(userdata, 'claude-api.json'), 'utf8')
  check('the key file is readable only by the user', process.platform === 'win32' || (await import('node:fs')).statSync(join(userdata, 'claude-api.json')).mode % 0o1000 === 0o600, onDisk.length)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  // ---- the conversation on the key ----
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.getByText('Claude와 대화').waitFor({ timeout: 30000 })
  pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').id
  await win.evaluate((id) => window.studio.agent.start(id), pid)
  check('the session starts on the API key', await ready('api'), JSON.stringify(await state()))
  check('…without Remote Control (it needs the claude.ai login)', !(await state()).remoteName)
  const before = mock.state.requests.length
  await send('테스트예요. 한 줄로만 답해 주세요.')
  check('Claude answers through the key', await until(async () => (await chat()).includes('확인했어요.'), 90000), (await chat()).slice(-300))
  check('…every request carried the key', mock.state.requests.slice(before).filter((r) => r.url.startsWith('/v1/messages')).every((r) => r.key === 'ok'))
  await ready('api')
  const one = (USAGE.input_tokens * 4 + USAGE.output_tokens * 20 + USAGE.cache_read_input_tokens * 0.2 + USAGE.cache_creation_input_tokens * 5) / 1e6
  const badge = win.getByTestId('api-usage')
  check('the chat shows the API key and what the request cost', await until(async () => /API 키/.test(await badge.innerText()) && (await badge.getByTestId('api-usage-turn').innerText()).includes(`$${one.toFixed(3)}`), 15000), await badge.innerText().catch(() => ''))
  const st1 = await win.evaluate(() => window.studio.claudeApi.status())
  check("…and this computer's month adds it up", Math.abs(st1.month.usd - one) < 1e-6 || st1.month.usd >= one, JSON.stringify(st1.month))

  // ---- the designer's choice in the chat: API 키 or 구독 ----
  const sid = (await state()).sessionId
  const picker = win.getByTestId('auth-picker').locator('select')
  check('the chat offers API 키 / 구독 once a key is saved', (await picker.inputValue()) === 'api')
  await picker.selectOption('subscription')
  check('구독 picked: the conversation moves to the subscription', await ready('subscription'), JSON.stringify(await state()))
  check('…the same conversation', (await state()).sessionId === sid)
  check('…and the key stays saved', (await win.evaluate(() => window.studio.claudeApi.status())).hasKey)
  await picker.selectOption('api')
  check('API 키 picked: back on the key, the same conversation', (await ready('api')) && (await state()).sessionId === sid, JSON.stringify(await state()))

  // ---- the credits run out mid-conversation ----
  mock.state.mode = 'credit'
  await send('하나 더 해 주세요.')
  check('the chat says the credits ran out and the subscription takes over', await until(async () => (await chat()).includes('API 키의 크레딧이 다 떨어졌어요. Claude 구독으로 바꿔서 이어서 해요.'), 90000), (await chat()).slice(-300))
  check('the same conversation restarts on the subscription', await ready('subscription'), JSON.stringify(await state()))
  check('…it is the same conversation (resumed)', (await state()).sessionId === sid)
  check('…with Remote Control again', !!(await state()).remoteName)
  check('…and the request is handed on (held in this test)', await until(async () => (await chat()).includes('(테스트) 구독으로 이어서 할 메시지를 보내지 않았어요.'), 20000))
  const st2 = await win.evaluate(() => window.studio.claudeApi.status())
  check('the app keeps why (credits) until the designer tries again', st2.using === 'subscription' && st2.fallback?.reason === 'credit', JSON.stringify(st2))
  await win.getByTestId('ai-connections').click()
  check('AI 연결 says the subscription is in use and offers the key again', await until(async () => (await win.getByTestId('claude-key-using').innerText()).includes('Claude 구독으로 대화해요'), 10000) && (await win.getByTestId('claude-key-retry').count()) === 1)

  // ---- the key again ----
  mock.state.mode = 'ok'
  await win.getByTestId('claude-key-retry').click()
  check('"다시 API 키로": the idle session is back on the key', await ready('api'), JSON.stringify(await state()))
  check('…still the same conversation', (await state()).sessionId === sid)

  // ---- a key the API refuses (removed in the Console) ----
  mock.state.mode = 'auth'
  await win.keyboard.press('Escape')
  await send('하나만 더요.')
  const tRefused = Date.now()
  check('a refused key (Claude Code retries it): the subscription takes over within a minute', (await ready('subscription')) && Date.now() - tRefused < 60000, `${JSON.stringify(await state())} after ${Math.round((Date.now() - tRefused) / 1000)} s`)
  check('…the chat says the key cannot be used and the request is handed on', await until(async () => /API 키를 쓸 수 없어요[\s\S]*\(테스트\) 구독으로 이어서 할 메시지/.test(await chat()), 20000), (await chat()).slice(-300))
  check('…with no Remote Control address left from the key session', true)
  const st3 = await win.evaluate(() => window.studio.claudeApi.status())
  check('…and the app says why (the key)', st3.fallback?.reason === 'auth', JSON.stringify(st3.fallback))
  check('…the same conversation', (await state()).sessionId === sid)
  mock.state.mode = 'ok'
  await win.getByTestId('ai-connections').click()
  await win.getByTestId('claude-key-retry').click()
  check('…and back on the key when tried again', await ready('api'), JSON.stringify(await state()))

  // ---- the key removed ----
  await win.getByTestId('claude-key-remove').click()
  check('removing the key puts the session on the subscription', await ready('subscription'), JSON.stringify(await state()))
  check('…and the key file holds no key', !/sk-ant/.test(readFileSync(join(userdata, 'claude-api.json'), 'utf8')))
  await win.keyboard.press('Escape')
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'api-key-fail.png') }).catch(() => {})
} finally {
  await app.evaluate(({ dialog }) => (dialog.showMessageBoxSync = () => 1)).catch(() => {})
  await app.close().catch(() => {})
  await mock.close()
  // the project as it was, no key left behind, the test's own conversation files gone
  rmSync(proj, { recursive: true, force: true })
  cpSync(join(keep, 'proj'), proj, { recursive: true })
  for (const f of KEY_FILES) {
    rmSync(join(userdata, f), { force: true })
    if (existsSync(join(keep, f))) cpSync(join(keep, f), join(userdata, f))
  }
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
console.log(failed ? `\n${failed} failed` : '\napi key: all passed')
process.exit(failed ? 1 : 0)
