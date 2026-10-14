// The reviewer agent follows the reasoning effort set in the chat panel, with a real
// Claude session: the session is set to 보통 (medium) and Claude is told to dispatch
// motion-reviewer at "low"; the reviewer's own transcript must show medium (the app's
// PreToolUse hook puts the session effort into the dispatch).
// The folder-trust question is never answered by a test, so the sandbox's trusted project
// ("앱 주문 런칭") is used: it is backed up and put back afterwards.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted> node tests/e2e/reviewer-effort-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const NAME = '앱 주문 런칭'
const trusted = join(sandbox, 'projects', `${NAME}.msproj`)
const backup = join(sandbox, `backup-effort-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`)
cpSync(trusted, backup, { recursive: true })

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
const state = (id) => win.evaluate((pid) => window.studio.agent.state(pid), id)
const until = async (label, done, minutes) => {
  for (let i = 0; i < minutes * 30; i++) {
    if (await done()) return true
    if (i % 30 === 0) log('…', label)
    await win.waitForTimeout(2000)
  }
  return false
}

try {
  await toHome(win)
  const pid = (await win.evaluate((path) => window.studio.projects.open(path), trusted)).meta.id
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'all'), pid)
  await win.evaluate((id) => window.studio.agent.start(id), pid)
  await until('session', async () => (await state(pid)).status === 'ready', 3)
  await win.evaluate((id) => window.studio.agent.setModel(id, { model: '', effort: 'medium' }), pid)
  await win.waitForTimeout(3000)
  await until('restart', async () => (await state(pid)).status === 'ready', 3)
  const st = await state(pid)
  check('session restarted at 보통 (medium)', st.effort === 'medium', JSON.stringify(st))

  const sentAt = Date.now()
  await win.evaluate(
    (id) =>
      window.studio.agent.send({
        projectId: id,
        text: '테스트예요. 영상은 고치지 말고, Agent 도구로 motion-studio-hyperframes:motion-reviewer 에이전트를 effort 파라미터를 "low"로 지정해서 한 번만 불러 주세요. 에이전트에게는 "composition/index.html을 열어 장면 수만 한 줄로 답해 줘"라고만 시키고, 결과를 한 줄로 알려 주세요.',
      }),
    pid,
  )
  const session = () => state(pid).then((s) => s.sessionId)
  const projectsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  const reviewerEfforts = async () => {
    const id = await session()
    const main = readdirSync(projectsDir).map((d) => join(projectsDir, d, `${id}.jsonl`)).find((f) => existsSync(f))
    const sub = main && join(main.replace(/\.jsonl$/, ''), 'subagents')
    if (!sub || !existsSync(sub)) return []
    const out = []
    for (const n of readdirSync(sub).filter((f) => f.endsWith('.meta.json'))) {
      const meta = JSON.parse(readFileSync(join(sub, n), 'utf8'))
      const log = join(sub, n.replace(/\.meta\.json$/, '.jsonl'))
      if (!/motion-reviewer/.test(meta.agentType) || !existsSync(log) || Date.parse(JSON.parse(readFileSync(log, 'utf8').split('\n')[0]).timestamp) < sentAt) continue
      for (const line of readFileSync(log, 'utf8').split('\n')) {
        try {
          const rec = JSON.parse(line)
          if (rec.type === 'assistant' && rec.effort) out.push(rec.effort)
        } catch {
          /* partial line */
        }
      }
    }
    return out
  }
  const ran = await until('reviewer', async () => (await reviewerEfforts()).length > 0 && (await state(pid)).status === 'ready', 15)
  const efforts = [...new Set(await reviewerEfforts())]
  check('the reviewer ran', ran)
  check(`the reviewer ran at the session effort, not the one Claude asked for (${efforts.join(', ')})`, efforts.length === 1 && efforts[0] === 'medium', efforts.join(', '))
} catch (e) {
  failed++
  log('✗', e.message)
} finally {
  await app.close().catch(() => {})
  rmSync(trusted, { recursive: true, force: true })
  cpSync(backup, trusted, { recursive: true })
  rmSync(backup, { recursive: true, force: true })
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
