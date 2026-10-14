// Phase 11 quality flow with a real Claude session (logged-in account, Opus · xhigh):
// a NEW project with a brief → 브리프대로 콘티 먼저 보여줘 (+ a direction) → the storyboard
// card → 이대로 만들기 → the build. Then, from the Claude Code transcript (and its
// subagents): the mandatory references were Read, DESIGN.md / STORYBOARD.md were written,
// the cited recipes were Read before the first write, the video was checked and its
// contact sheets looked at, the independent reviewer ran, 편집 준비 was done, every note
// was Korean, and how often the app's gates sent Claude back. Frames of the result are saved.
// Permission cards are answered 허용 and logged.
// The folder-trust question is never answered by a test, so the sandbox's trusted project
// ("앱 주문 런칭") is used: it is backed up, emptied (a new conversation, a blank composition,
// this test's brief) and put back afterwards; the result is copied next to the backup.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted> node tests/e2e/quality-flow-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const NAME = '앱 주문 런칭'
const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
const trusted = join(sandbox, 'projects', `${NAME}.msproj`)
const backup = join(sandbox, `backup-${stamp}`)
const resultCopy = join(sandbox, `quality-result-${stamp}`)
cpSync(trusted, backup, { recursive: true })

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
const asked = []
/** answers permission cards while waiting; returns when `done()` holds */
async function waitFor(label, done, minutes) {
  for (let i = 0; i < minutes * 60; i++) {
    const card = win.getByTestId('permission-card').first()
    if (await card.count()) {
      const t = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 160)
      asked.push(t)
      log('permission asked:', t)
      await card.getByRole('button', { name: '허용', exact: true }).click().catch(() => {})
    }
    if (await done()) return true
    if (i % 120 === 0) log('…', label, await badge())
    await win.waitForTimeout(1000)
  }
  return false
}

let pid, dir
try {
  await toHome(win)
  // a blank composition and brief from a throwaway project (never opened: its folder is not trusted)
  const blank = await win.evaluate(() => window.studio.projects.create({ name: '빈 틀', presetId: 'shorts-9x16', duration: 12 }))
  const listed = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.path === trusted)
  const st = await win.evaluate((path) => window.studio.projects.open(path), trusted)
  pid = st.meta.id
  dir = trusted
  cpSync(join(blank.path, 'composition', 'index.html'), join(dir, 'composition', 'index.html'))
  for (const f of ['DESIGN.md', 'STORYBOARD.md', 'compositions']) rmSync(join(dir, 'composition', f), { recursive: true, force: true })
  rmSync(blank.path, { recursive: true, force: true })
  const meta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  delete meta.agentSessionId
  writeFileSync(join(dir, 'project.json'), JSON.stringify(meta, null, 2))
  writeFileSync(join(dir, 'chat.json'), '[]')
  void listed
  const brief = {
    ...blank.brief,
    title: NAME,
    client: '모션커피',
    campaign: '봄 신메뉴 · 벚꽃 크림 라떼',
    tone: '산뜻하고 경쾌하게. 벚꽃 분홍과 크림색, 20~30대 직장인이 출근길에 보고 사고 싶어지게. 고급스럽지만 너무 무겁지 않게.',
    texts: [
      { id: 't1', text: '벚꽃 크림 라떼', locked: true, timing: { mode: 'any' }, minDuration: 1.5, position: 'any', style: { mode: 'auto' }, note: '' },
      { id: 't2', text: '3월 한정 · 앱 주문 시 1+1', locked: true, timing: { mode: 'section', section: 'end' }, minDuration: 1.5, position: 'any', style: { mode: 'auto' }, note: '' },
    ],
  }
  await win.evaluate(([id, b]) => window.studio.projects.saveBrief(id, b), [pid, brief])
  await win.reload()
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ hasText: NAME }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'ask'), pid)
  check('BRIEF.md written for the official workflow', /workflow: general-video\nflow: companion\nstoryboard: yes/.test(readFileSync(join(dir, 'composition', 'BRIEF.md'), 'utf8')))
  await waitFor('session', async () => /대기 중/.test(await badge()), 3)
  check('session ready (Opus · 매우 높음)', /대기 중/.test(await badge()) && /xhigh/.test(JSON.stringify(await win.evaluate((id) => window.studio.agent.state(id), pid))), await badge())

  // ---- the storyboard ----
  await win.getByTestId('first-direction').fill('첫 1초에 라떼 잔과 벚꽃 꽃잎이 크게 터지듯 등장하고, 문구는 박자에 맞춰 툭툭 끊어서 보여 줘.')
  await win.getByTestId('quick-first').click()
  const sbAt = Date.now()
  const gotStoryboard = await waitFor('storyboard', async () => (await win.locator('.card').filter({ hasText: '이대로 만들기' }).count()) > 0, 40)
  check(`storyboard card shown (${Math.round((Date.now() - sbAt) / 60000)} min)`, gotStoryboard)
  check('DESIGN.md and STORYBOARD.md were written first', existsSync(join(dir, 'composition', 'DESIGN.md')) && existsSync(join(dir, 'composition', 'STORYBOARD.md')))
  await win.getByTestId('chat-list').screenshot({ path: join(shots, 'p11-quality-storyboard.png') }).catch(() => {})
  await waitFor('turn end', async () => /대기 중/.test(await badge()), 5)

  // ---- the build ----
  await win.locator('.card').filter({ hasText: '이대로 만들기' }).getByRole('button', { name: /이대로 만들기/ }).click()
  const buildAt = Date.now()
  let idle = 0
  const built = await waitFor(
    'build',
    async () => {
      if (!/대기 중/.test(await badge())) return (idle = 0), false
      idle = idle || Date.now()
      return Date.now() - idle > 20000 && Date.now() - buildAt > 60000
    },
    120,
  )
  check(`build finished (${Math.round((Date.now() - buildAt) / 60000)} min)`, built)
  log('last reply:\n' + (await win.getByTestId('chat-list').evaluate((el) => el.innerText.slice(-900))))

  // ---- what Claude did ----
  const session = (await win.evaluate((id) => window.studio.projects.state(id), pid)).meta.agentSessionId
  const projectsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  const main = readdirSync(projectsDir).map((d) => join(projectsDir, d, `${session}.jsonl`)).find((f) => existsSync(f))
  const subDir = main && join(main.replace(/\.jsonl$/, ''), 'subagents')
  const files = [main, ...(subDir && existsSync(subDir) ? readdirSync(subDir).map((n) => join(subDir, n)) : [])].filter(Boolean)
  const u = { skills: [], reads: [], bash: [], tools: {}, texts: [], agents: [], gateBacks: 0, refused: [] }
  for (const [fi, file] of files.entries()) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      if (rec.type === 'user' && rec.isMeta && /quality gate/.test(JSON.stringify(rec.message?.content ?? ''))) u.gateBacks++
      for (const c of rec.message?.content ?? []) {
        if (c?.type === 'text' && rec.type === 'assistant' && fi === 0 && c.text?.trim()) u.texts.push(c.text.trim())
        if (c?.type === 'tool_result' && c.is_error) u.refused.push(String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 120))
        if (c?.type !== 'tool_use') continue
        u.tools[c.name] = (u.tools[c.name] ?? 0) + 1
        if (c.name === 'Skill') u.skills.push(c.input?.skill)
        if (c.name === 'Read') u.reads.push(String(c.input?.file_path ?? ''))
        if (c.name === 'Bash') u.bash.push(String(c.input?.command ?? '').slice(0, 140))
        if (c.name === 'Agent' || c.name === 'Task') u.agents.push(c.input?.subagent_type ?? 'general')
      }
    }
  }
  log('tools:', JSON.stringify(u.tools))
  log('skills:', u.skills.join(', '))
  log('subagents:', u.agents.join(', ') || '(none)')
  log('hyperframes CLI:', u.bash.filter((c) => /hyperframes/.test(c)).join(' | '))
  log('refused / failed:', u.refused.join(' | ') || '(none)')
  const read = (re) => u.reads.some((p) => re.test(p))
  check('Read the mandatory references (house-style, video-composition, typography, blueprints/rules index)', read(/house-style\.md$/) && read(/video-composition\.md$/) && read(/typography\.md$/) && read(/(blueprints|rules)-index\.md$/))
  check('Read cited blueprint / rule bodies', read(/hyperframes-animation\/(blueprints|rules)\/[^/]+\.md$/))
  check('searched the registry (hyperframes catalog)', u.bash.some((c) => /hyperframes catalog/.test(c)))
  check('checked with hyperframes check', u.bash.some((c) => /hyperframes (check|lint)/.test(c)))
  check('looked at snapshot contact sheets', u.reads.some((p) => /snapshots?\/.*\.(jpe?g|png)$/.test(p)) || !!u.tools['mcp__studio__look_at_frames'])
  check('the independent reviewer ran', u.agents.some((a) => /motion-reviewer/.test(a)))
  check('did 편집 준비 (layout_snapshot before / after)', (u.tools['mcp__studio__layout_snapshot'] ?? 0) >= 2)
  const english = u.texts.filter((t) => !/[가-힣]/.test(t))
  check(`every note to the designer is Korean (${u.texts.length})`, english.length === 0, english.join(' / ').slice(0, 300))
  log(`the app's gates sent Claude back ${u.gateBacks} time(s)`)

  // ---- the result ----
  await win.locator('[data-layer]').first().waitFor({ timeout: 60000 }).catch(() => {})
  const frame = win.frames().find((f) => f.url().includes('ms-preview'))
  const els = frame ? await frame.evaluate(() => window.__MS_RUNTIME__.listElements()) : []
  const flow = els.filter((e) => e.transformable === false)
  check(`every editable element is edit-ready (${els.length} elements)`, els.length > 3 && flow.length === 0, flow.map((e) => e.label).join(', '))
  const ruler = win.getByTestId('timeline-bar')
  const box = await ruler.boundingBox()
  for (const k of [0.02, 0.2, 0.4, 0.6, 0.8, 0.97]) {
    await ruler.click({ position: { x: box.width * k, y: 12 } })
    await win.waitForTimeout(900)
    await win.locator('[data-capture-frame]').screenshot({ path: join(shots, `p11-quality-${Math.round(k * 100)}.png`) })
  }
  log('permissions asked:', asked.length ? asked.join(' | ') : '(none)')
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p11-quality-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
  // keep the result, put the sandbox project back
  if (dir) cpSync(dir, resultCopy, { recursive: true })
  rmSync(trusted, { recursive: true, force: true })
  cpSync(backup, trusted, { recursive: true })
}
log(`result: ${resultCopy}`)
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
