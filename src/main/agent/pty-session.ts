// Live, interactive Claude Code session per project, running the unmodified
// Claude Code binary in a pseudo-terminal with the user's own Claude login.
// Remote Control is on by default so the same conversation can continue from
// claude.ai/code or the Claude mobile app.
//
// Lessons carried over from the 관제센터 web console (~/easyticket/scripts/web_console):
//  - Remote Control only works as a launch flag (--remote-control <name>), not by typing /remote-control.
//  - Type the text, then send Enter separately ~0.8s later; text+"\r" in one write is treated as a paste.
//  - Only one claude process per session id (two writers corrupt the transcript).
//  - Resize only when cols/rows actually change (each resize makes the TUI redraw).
//  - Folder-trust and similar prompts are never auto-answered: the terminal is shown to the user.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as pty from 'node-pty'
import type { AgentEvent, ChatItem, SendMessageInput, SessionState, Storyboard } from '@shared/api'
import type { FeedbackMark } from '@shared/project'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import * as history from '../history'
import { isDev, appRoot, projectsDir } from '../paths'
import { previewBase } from '../preview-server'
import * as projects from '../projects'
import { newId, nowIso, writeText } from '../util'
import { setFamilyStatus } from '../variations'
import { mcpTokenFor, setToolHooks } from './mcp-http'
import { STUDIO_PROMPT } from './prompt'
import { TranscriptTail } from './transcript'

type Emit = (e: AgentEvent) => void

export const pluginDir = () => (isDev ? join(appRoot(), 'resources', 'claude-plugin') : join(process.resourcesPath, 'claude-plugin'))

const REPLAY = 512 * 1024
const ENTER_DELAY = 800
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?/g
// The TUI draws gaps with cursor moves, so matching is done on whitespace-free text.
const ATTENTION: { id: NonNullable<SessionState['attention']>; re: RegExp }[] = [
  { id: 'trust', re: /trustthisfolder|Isthisaprojectyoucreated/i },
  { id: 'login', re: /Selectloginmethod|Pleaserun\/login|InvalidAPIkey|OAuthtokenhasexpired|notloggedin/i },
  { id: 'usage', re: /You'vehityour|You'vereachedyour|You'reoutofusage|usagelimitreached/i },
]
const BANNER = /ClaudeCodev\d/
const toPlain = (d: string) => d.replace(/\x1b\[(\d*)C/g, (_m, n) => ' '.repeat(Math.min(200, Number(n) || 1))).replace(ANSI, '')

interface Live {
  projectId: string
  dir: string
  sessionId: string
  term: pty.IPty
  buffer: string
  plain: string
  cols: number
  rows: number
  state: SessionState
  tail: TranscriptTail
  appItems: ChatItem[]
  compositionMtime: number
}

function markLines(marks: FeedbackMark[]): string {
  return marks
    .map((m) => {
      const where = m.kind === 'range' && m.range ? `${m.range.from.toFixed(1)}~${m.range.to.toFixed(1)}초 구간` : `${m.time.toFixed(2)}초`
      const box = m.rect ? ` 영역(x:${Math.round(m.rect.x)}, y:${Math.round(m.rect.y)}, w:${Math.round(m.rect.w)}, h:${Math.round(m.rect.h)})` : ''
      const els = m.elements.length ? ` 해당 요소: ${m.elements.map((e) => `${e.label}(data-ms-id="${e.id}")`).join(', ')}` : ' 해당 요소 없음(빈 영역)'
      return `- ${m.n}번 표시 [${where}${box}]${els}${m.note ? ` — 코멘트: "${m.note}"` : ''}`
    })
    .join('\n')
}

export class SessionManager {
  private live = new Map<string, Live>()
  /** variation re-layouts waiting for Claude, processed one at a time */
  private adaptQueue: { projectId: string; text: string }[] = []
  private adapting: string | null = null

  constructor(private emit: Emit) {
    setToolHooks({ onStoryboard: (projectId, sb) => this.addStoryboard(projectId, sb) })
  }

  state(projectId: string): SessionState {
    return this.live.get(projectId)?.state ?? { status: 'stopped' }
  }

  transcript(projectId: string): ChatItem[] {
    const l = this.live.get(projectId)
    const app = l?.appItems ?? projects.readChat<ChatItem>(projectId)
    const fromLog = l?.tail.items ?? []
    return [...fromLog, ...app].sort((a, b) => a.at.localeCompare(b.at))
  }

  snapshot(projectId: string): string {
    return this.live.get(projectId)?.buffer ?? ''
  }

  private setState(l: Live, patch: Partial<SessionState>) {
    l.state = { ...l.state, ...patch }
    this.emit({ type: 'session', projectId: l.projectId, state: l.state })
  }

  private addApp(l: Live, item: ChatItem) {
    l.appItems.push(item)
    projects.writeChat(l.projectId, l.appItems)
    this.emit({ type: 'item', projectId: l.projectId, item })
  }

  private updateApp(l: Live, item: ChatItem) {
    const i = l.appItems.findIndex((x) => x.id === item.id)
    if (i >= 0) l.appItems[i] = item
    projects.writeChat(l.projectId, l.appItems)
    this.emit({ type: 'item-update', projectId: l.projectId, item })
  }

  private addStoryboard(projectId: string, storyboard: Storyboard) {
    const l = this.live.get(projectId)
    if (!l) return
    for (const it of l.appItems) if (it.role === 'storyboard' && it.status === 'pending') this.updateApp(l, { ...it, status: 'superseded' })
    this.addApp(l, { id: newId(), at: nowIso(), role: 'storyboard', storyboard, status: 'pending' })
  }

  /**
   * Runs Claude Code once in the projects folder so the designer can answer the
   * folder-trust prompt there; trusting it covers every project and variation.
   * Never answers the prompt itself. Uses the pseudo project id "__workspace__".
   */
  startWorkspaceTrust(): SessionState {
    const id = '__workspace__'
    this.kill(id)
    const term = pty.spawn(claudeBinary(), ['--setting-sources', '', '--strict-mcp-config', '--tools', ''], {
      name: 'xterm-256color',
      cols: 100,
      rows: 26,
      cwd: projectsDir(),
      env: claudeEnv(),
      useConpty: true,
    })
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 26, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0 }
    this.live.set(id, l)
    term.onData((d) => {
      l.buffer = (l.buffer + d).slice(-REPLAY)
      l.plain = (l.plain + toPlain(d)).slice(-6000)
      this.emit({ type: 'pty-data', projectId: id, data: d })
      this.detect(l)
      // trusted: the normal banner is up — this helper session has done its job
      if (l.state.status === 'ready') setTimeout(() => this.kill(id), 800)
    })
    term.onExit(() => this.setState(l, { status: 'exited' }))
    this.setState(l, l.state)
    return l.state
  }

  /**
   * Runs Anthropic's own sign-in (`claude auth login`) in a real terminal the
   * designer can see and type into (browser link, pasted code). Credentials go
   * straight from Claude Code to the keychain; the app never sees them.
   */
  startLogin(): SessionState {
    const id = '__login__'
    this.kill(id)
    const term = pty.spawn(claudeBinary(), ['auth', 'login', '--claudeai'], { name: 'xterm-256color', cols: 100, rows: 24, cwd: projectsDir(), env: claudeEnv(), useConpty: true })
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 24, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0 }
    this.live.set(id, l)
    term.onData((d) => {
      l.buffer = (l.buffer + d).slice(-REPLAY)
      this.emit({ type: 'pty-data', projectId: id, data: d })
    })
    term.onExit(({ exitCode }) => this.setState(l, { status: 'exited', exitCode }))
    this.setState(l, l.state)
    return l.state
  }

  /** keeps few Claude processes alive: idle sessions of other projects are closed (fewer token refreshes racing) */
  pruneIdle(keepProjectId: string) {
    for (const [id, l] of this.live) {
      if (id === keepProjectId || id.startsWith('__') || id === this.adapting) continue
      if (this.adaptQueue.some((q) => q.projectId === id)) continue
      if (l.state.status === 'ready' || l.state.status === 'exited') this.kill(id)
    }
  }

  /** starts (or returns) the live session for a project */
  start(projectId: string): SessionState {
    const existing = this.live.get(projectId)
    if (existing && existing.state.status !== 'exited') return existing.state
    const dir = projects.pathOf(projectId)
    const meta = projects.state(projectId).meta
    const resume = !!meta.agentSessionId
    const sessionId = meta.agentSessionId ?? randomUUID()
    if (!resume) projects.touch(projectId, { agentSessionId: sessionId })

    const studioDir = join(dir, '.studio')
    mkdirSync(studioDir, { recursive: true })
    const promptFile = join(studioDir, 'system-prompt.md')
    writeText(promptFile, STUDIO_PROMPT)
    const mcpConfig = JSON.stringify({ mcpServers: { studio: { type: 'http', url: `${previewBase()}/mcp/${mcpTokenFor(projectId)}` } } })
    const settings = JSON.stringify({
      disableClaudeAiConnectors: true,
      permissions: {
        // Read(path) covers every file-reading tool (Glob, Grep), Edit(path) every writing tool
        allow: ['mcp__studio', 'Skill', 'Read(./**)', 'Edit(./composition/**)'],
        deny: ['Edit(./composition/ms/**)', 'Edit(./composition/vendor/**)', 'Edit(./composition/assets/**)', 'Edit(./brief.json)', 'Edit(./overrides.json)', 'Edit(./references/**)'],
      },
    })
    const name = `모션스튜디오 · ${meta.name}`.slice(0, 60)
    const args = [
      ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      '--remote-control', name,
      '--name', meta.name,
      '--setting-sources', '',
      '--settings', settings,
      '--strict-mcp-config', '--mcp-config', mcpConfig,
      '--permission-mode', 'dontAsk',
      '--tools', 'Read,Write,Edit,Glob,Grep,Skill',
      '--plugin-dir', pluginDir(),
      '--add-dir', pluginDir(),
      '--append-system-prompt-file', promptFile,
      // render the studio rules fresh each request so app updates reach existing conversations
      '--system-prompt-snapshot', 'off',
    ]
    const cols = existing?.cols ?? 110
    const rows = existing?.rows ?? 34
    const term = pty.spawn(claudeBinary(), args, { name: 'xterm-256color', cols, rows, cwd: dir, env: claudeEnv(), useConpty: true })

    const l: Live = {
      projectId,
      dir,
      sessionId,
      term,
      buffer: '',
      plain: '',
      cols,
      rows,
      state: { status: 'starting', sessionId, remoteName: name },
      tail: undefined as unknown as TranscriptTail,
      appItems: projects.readChat<ChatItem>(projectId),
      compositionMtime: this.compMtime(dir),
    }
    l.tail = new TranscriptTail(sessionId, dir, {
      item: (item) => this.emit({ type: 'item', projectId, item }),
      update: (item) => this.emit({ type: 'item-update', projectId, item }),
      busy: (busy) => this.setState(l, { status: busy ? 'busy' : 'ready' }),
      turnEnd: (lastText) => void this.onTurnEnd(l, lastText),
      remoteUrl: (url) => l.state.remoteUrl !== url && this.setState(l, { remoteUrl: url }),
    })
    this.live.set(projectId, l)
    this.setState(l, l.state)

    term.onData((d) => {
      l.buffer = (l.buffer + d).slice(-REPLAY)
      l.plain = (l.plain + toPlain(d)).slice(-6000)
      this.emit({ type: 'pty-data', projectId, data: d })
      this.detect(l)
    })
    term.onExit(({ exitCode }) => {
      l.tail.stop()
      const failedResume = resume && /No conversation found|not found/i.test(l.plain)
      if (failedResume) projects.touch(projectId, { agentSessionId: undefined })
      this.setState(l, { status: 'exited', exitCode, attention: failedResume ? null : l.state.attention })
    })
    l.tail.start()
    return l.state
  }

  private compMtime(dir: string): number {
    const f = join(dir, 'composition', 'index.html')
    try {
      return existsSync(f) ? statSync(f).mtimeMs : 0
    } catch {
      return 0
    }
  }

  private detect(l: Live) {
    const text = l.plain.slice(-3000).replace(/\s+/g, '')
    let attention: SessionState['attention'] = null
    let at = -1
    for (const a of ATTENTION) {
      const m = text.search(a.re)
      if (m >= 0 && m > at) {
        attention = a.id
        at = m
      }
    }
    // a prompt is resolved once the normal banner/input box is drawn after it
    const banner = text.search(BANNER)
    if (attention === 'trust' && banner > at) attention = null
    if (l.state.status === 'starting' && banner >= 0 && attention !== 'trust') {
      this.setState(l, { status: 'ready', attention })
      return
    }
    if (attention !== (l.state.attention ?? null)) this.setState(l, { attention })
  }

  enqueueAdaptations(items: { projectId: string; text: string }[]) {
    this.adaptQueue.push(...items)
    void this.pump()
  }

  private async pump() {
    if (this.adapting || !this.adaptQueue.length) return
    const next = this.adaptQueue.shift()!
    this.adapting = next.projectId
    setFamilyStatus(next.projectId, 'working')
    this.emit({ type: 'family-changed', projectId: next.projectId })
    try {
      await this.send({ projectId: next.projectId, text: next.text })
    } catch (e) {
      setFamilyStatus(next.projectId, 'error')
      this.emit({ type: 'family-changed', projectId: next.projectId })
      const l = this.live.get(next.projectId)
      if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'error', text: '베리에이션을 시작하지 못했어요.', detail: e instanceof Error ? e.message : String(e) })
      this.adapting = null
      void this.pump()
    }
  }

  private async onTurnEnd(l: Live, lastText: string) {
    if (this.adapting === l.projectId) {
      setFamilyStatus(l.projectId, 'done')
      this.emit({ type: 'family-changed', projectId: l.projectId })
      this.adapting = null
      setTimeout(() => void this.pump(), 500)
    }
    projects.applyAudioEdits(l.dir)
    const m = this.compMtime(l.dir)
    projects.refreshFontCss(l.dir)
    const summary = lastText.split('\n').map((s) => s.replace(/^[-*•\s]+/, '').trim()).find((s) => s.length > 3) ?? 'Claude가 영상을 수정했어요'
    const entry = await history.record(l.dir, { actor: 'claude', summary: summary.slice(0, 120) }).catch(() => null)
    if (entry || m !== l.compositionMtime) {
      l.compositionMtime = m
      projects.touch(l.projectId)
      this.emit({ type: 'composition-changed', projectId: l.projectId })
      this.emit({ type: 'history-changed', projectId: l.projectId })
    }
  }

  /** composition files changed on disk mid-turn: let the preview follow live */
  pollComposition(projectId: string): boolean {
    const l = this.live.get(projectId)
    if (!l) return false
    const m = this.compMtime(l.dir)
    if (m === l.compositionMtime) return false
    l.compositionMtime = m
    return true
  }

  write(projectId: string, data: string) {
    this.live.get(projectId)?.term.write(data)
  }

  resize(projectId: string, cols: number, rows: number) {
    const l = this.live.get(projectId)
    if (!l || cols < 20 || rows < 5 || (cols === l.cols && rows === l.rows)) return
    l.cols = cols
    l.rows = rows
    try {
      l.term.resize(cols, rows)
    } catch {
      /* process gone */
    }
  }

  interrupt(projectId: string) {
    this.write(projectId, '\x1b')
  }

  async send(input: SendMessageInput): Promise<void> {
    const { projectId } = input
    let l = this.live.get(projectId)
    if (!l || l.state.status === 'exited') {
      this.start(projectId)
      l = this.live.get(projectId)!
    }
    if (l.state.attention === 'trust') throw new Error('먼저 터미널에서 이 프로젝트 폴더를 신뢰한다고 선택해 주세요.')
    if (l.state.attention === 'login') throw new Error('Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.')
    // wait for the input box after a cold start
    for (let i = 0; i < 60 && l.state.status === 'starting'; i++) await new Promise((r) => setTimeout(r, 250))

    const oneLine = input.text.replace(/\s*\n\s*/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
    const rich = !!(input.marks?.length || input.annotatedFrame) || input.text.includes('\n') || oneLine.length > 300
    let line = oneLine
    if (rich) {
      const stamp = `${Date.now()}`
      const fb = join(l.dir, 'feedback')
      mkdirSync(fb, { recursive: true })
      let frame: string | undefined
      if (input.annotatedFrame?.startsWith('data:image/')) {
        frame = `feedback/frame-${stamp}.png`
        writeFileSync(join(l.dir, frame), Buffer.from(input.annotatedFrame.split(',')[1], 'base64'))
      }
      const md = [
        '# 디자이너 메시지',
        '',
        input.text,
        ...(input.marks?.length
          ? ['', `## 화면 표시 피드백${input.time != null ? ` (${input.time.toFixed(2)}초 화면)` : ''}`, markLines(input.marks), '', '좌표는 영상 원본 픽셀 기준입니다.']
          : []),
        ...(frame ? ['', `표시가 그려진 화면: ${frame} — Read 도구로 열어서 직접 확인하세요.`] : []),
      ].join('\n')
      writeText(join(fb, `msg-${stamp}.md`), md)
      writeText(join(fb, `msg-${stamp}.json`), JSON.stringify({ text: input.text, marks: input.marks, frame, time: input.time }))
      line = `[모션스튜디오 메시지] feedback/msg-${stamp}.md 파일을 Read 도구로 읽고 그 내용대로 진행해 주세요.`
    }
    if (!line) return
    l.term.write(line)
    await new Promise((r) => setTimeout(r, ENTER_DELAY))
    l.term.write('\r')
  }

  async approveStoryboard(projectId: string, itemId: string) {
    const l = this.live.get(projectId)
    const item = l?.appItems.find((x) => x.id === itemId)
    if (l && item?.role === 'storyboard') this.updateApp(l, { ...item, status: 'approved' })
    await this.send({ projectId, text: '콘티를 승인했어요. 이대로 영상을 만들어 주세요.' })
  }

  restart(projectId: string): SessionState {
    this.kill(projectId)
    return this.start(projectId)
  }

  kill(projectId: string) {
    const l = this.live.get(projectId)
    if (!l) return
    l.tail.stop()
    try {
      l.term.kill()
    } catch {
      /* already gone */
    }
    this.live.delete(projectId)
  }

  killAll() {
    for (const id of [...this.live.keys()]) this.kill(id)
  }

  busyProjects(): string[] {
    return [...this.live.values()].filter((l) => l.state.status === 'busy').map((l) => l.projectId)
  }
}

