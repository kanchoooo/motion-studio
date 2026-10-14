// The official HyperFrames way inside Motion Studio, with a real Claude session (logged-in
// account, Opus + high): a plain designer request → which skills / subagents / CLI
// commands / blocks Claude used, whether it finished with 편집 준비 (every editable
// element absolute, before/after unchanged), and frames of the result. The project is
// put back from its history afterwards. Permission cards are answered 허용 and logged.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted> [FRESH=1] node tests/e2e/official-flow-live.mjs
// FRESH=1: a new conversation (the project's own conversation is put back afterwards)
import { _electron as electron } from 'playwright-core'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const request = process.env.ASK ?? '지금 영상은 버리고, 콘티 없이 바로 새 8초 광고를 만들어 주세요. 브리프 내용 그대로, 첫 장면은 강렬한 키네틱 타이포로 시작하고 마지막은 로고·문구 엔드카드로 끝내 주세요.'

grantAccess(join(sandbox, 'userdata'))
const projectFile = join(sandbox, 'projects', '앱 주문 런칭.msproj', 'project.json')
const ownSession = JSON.parse(readFileSync(projectFile, 'utf8')).agentSessionId
if (process.env.FRESH) {
  const meta = JSON.parse(readFileSync(projectFile, 'utf8'))
  delete meta.agentSessionId
  writeFileSync(projectFile, JSON.stringify(meta, null, 2))
}
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')

let pid, head
try {
  await toHome(win)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  pid = st.meta.id
  head = (await win.evaluate((id) => window.studio.history.list(id), pid))[0]?.id
  await win.reload()
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  await win.getByPlaceholder(/Claude에게 요청하기/).waitFor({ timeout: 30000 })
  await win.evaluate((id) => window.studio.agent.setModel(id, { model: '', effort: '' }), pid)
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'ask'), pid)
  for (let i = 0; i < 120 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  check('session ready (Opus · high)', /대기 중/.test(await badge()), await badge())

  const input = win.getByPlaceholder(/Claude에게 요청하기/)
  await input.fill(request)
  await input.press('Enter')
  const asked = []
  let quiet = 0
  for (let i = 0; i < 3600; i++) {
    const card = win.getByTestId('permission-card').first()
    if (await card.count()) {
      const t = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 160)
      asked.push(t)
      log('permission asked:', t)
      await card.getByRole('button', { name: '허용', exact: true }).click().catch(() => {})
    }
    const b = await badge()
    if (/대기 중/.test(b)) {
      quiet = quiet || Date.now()
      if (Date.now() - quiet > 10000 && i > 30) break
    } else quiet = 0
    if (i % 120 === 0) log('…', b)
    await win.waitForTimeout(1000)
  }
  log('last reply:\n' + (await win.getByTestId('chat-list').evaluate((el) => el.innerText.slice(-700))))

  // ---- what Claude did (from the Claude Code transcript) ----
  // the conversation may have been started anew while the session got ready
  const session = (await win.evaluate((id) => window.studio.projects.state(id), pid)).meta.agentSessionId
  const projectsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  const file = readdirSync(projectsDir).map((d) => join(projectsDir, d, `${session}.jsonl`)).find((f) => existsSync(f))
  const uses = { skills: [], agents: 0, bash: [], tools: {}, texts: [], denied: [] }
  for (const line of file ? readFileSync(file, 'utf8').split('\n') : []) {
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (new Date(rec.timestamp ?? 0).getTime() < t0) continue
    for (const c of rec.message?.content ?? []) {
      if (c?.type === 'text' && rec.type === 'assistant' && !rec.isSidechain && c.text?.trim()) uses.texts.push(c.text.trim())
      if (c?.type === 'tool_result' && c.is_error) uses.denied.push(String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 100))
      if (c?.type !== 'tool_use') continue
      uses.tools[c.name] = (uses.tools[c.name] ?? 0) + 1
      if (c.name === 'Skill') uses.skills.push(c.input?.skill ?? c.input?.name)
      if (c.name === 'Agent' || c.name === 'Task') uses.agents++
      if (c.name === 'Bash') uses.bash.push(String(c.input?.command ?? '').slice(0, 120))
    }
  }
  log('tools:', JSON.stringify(uses.tools))
  log('skills:', uses.skills.join(', '))
  log('bash:', uses.bash.join(' | '))
  check('used the hyperframes router / workflow skills', uses.skills.some((s) => /hyperframes|motion-graphics|product-launch|general-video/.test(s ?? '')))
  // check_video runs the HyperFrames checks too, so the CLI is reported, not required
  log(`HyperFrames CLI: ${uses.bash.filter((c) => /hyperframes (check|snapshot|catalog|add|lint)/.test(c)).length} commands`)
  check('verified the result (check_video or hyperframes check)', !!uses.tools['mcp__studio__check_video'] || uses.bash.some((c) => /hyperframes (check|lint)/.test(c)))
  log('refused / failed tool calls:', uses.denied.join(' | ') || '(none)')
  const english = uses.texts.filter((t) => !/[가-힣]/.test(t))
  check(`everything Claude wrote to the designer is Korean (${uses.texts.length} notes)`, english.length === 0, english.join(' / ').slice(0, 300))
  check('no shell script edited the composition', !uses.bash.some((c) => /python|sed -i|perl -i|node -e/.test(c)), uses.bash.join(' | ').slice(0, 300))
  check('approval cards are described in Korean', asked.every((t) => /[가-힣]/.test(t.replace(/^.*?명령 실행 · /, '').slice(0, 40))), asked.join(' | '))
  // measure_layout is only needed when something was still laid out by flex / grid
  check('did 편집 준비 (layout_snapshot before / after)', (uses.tools['mcp__studio__layout_snapshot'] ?? 0) >= 2)
  log(`subagents: ${uses.agents}, registry blocks: ${uses.bash.filter((c) => /hyperframes add/.test(c)).length}`)

  // ---- the result ----
  await win.locator('[data-layer]').first().waitFor({ timeout: 60000 }).catch(() => {})
  const frame = win.frames().find((f) => f.url().includes('ms-preview'))
  const els = frame ? await frame.evaluate(() => window.__MS_RUNTIME__.listElements()) : []
  const flow = els.filter((e) => e.transformable === false)
  check(`every editable element is edit-ready (${els.length} elements, ${flow.length} still in flow)`, els.length > 3 && flow.length === 0, flow.map((e) => e.label).join(', '))
  const ruler = win.getByTestId('timeline-bar')
  const box = await ruler.boundingBox()
  for (const k of [0.08, 0.3, 0.55, 0.9]) {
    await ruler.click({ position: { x: box.width * k, y: 12 } })
    await win.waitForTimeout(900)
    await win.locator('[data-capture-frame]').screenshot({ path: join(shots, `official-${Math.round(k * 100)}.png`) })
  }
  log('permissions asked:', asked.length ? asked.join(' | ') : '(none)')
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'official-fail.png') }).catch(() => {})
} finally {
  if (pid && head) await win.evaluate(([id, h]) => window.studio.history.restore(id, h), [pid, head]).then(() => log('project restored')).catch((e) => log('restore failed', e.message))
  await app.close().catch(() => {})
  if (process.env.FRESH && ownSession) {
    const meta = JSON.parse(readFileSync(projectFile, 'utf8'))
    writeFileSync(projectFile, JSON.stringify({ ...meta, agentSessionId: ownSession }, null, 2))
  }
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
