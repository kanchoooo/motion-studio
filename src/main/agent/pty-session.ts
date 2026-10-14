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
import { AI_PROVIDERS } from '@shared/ai'
import { aiSettings } from '../ai/settings'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import * as history from '../history'
import { isDev, appRoot, projectsDir } from '../paths'
import { previewBase } from '../preview-server'
import * as projects from '../projects'
import { newId, nowIso, writeText } from '../util'
import { setFamilyStatus } from '../variations'
import { refreshThumbnail } from '../thumbnail'
import { mcpTokenFor, setToolHooks } from './mcp-http'
import { endPermissions } from './permissions'
import { sessionPath } from './cliShims'
import { COMPOSITION_CONTRACT, STUDIO_PROMPT } from './prompt'
import { findTranscript, TranscriptTail } from './transcript'

type Emit = (e: AgentEvent) => void

export const pluginDir = () => (isDev ? join(appRoot(), 'resources', 'claude-plugin') : join(process.resourcesPath, 'claude-plugin'))

/** project default unless the designer picks another in the chat panel: latest Opus, high effort */
export const DEFAULT_MODEL = 'opus'
export const DEFAULT_EFFORT = 'high'
/** variation re-layouts running at the same time (each is a Claude session of its own) */
export const MAX_ADAPTING = 4

const REPLAY = 512 * 1024
const ENTER_DELAY = 800
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?/g
// The TUI draws gaps with cursor moves, so matching is done on whitespace-free text.
const ATTENTION: { id: NonNullable<SessionState['attention']>; re: RegExp }[] = [
  { id: 'trust', re: /trustthisfolder|Isthisaprojectyoucreated/i },
  { id: 'login', re: /Selectloginmethod|Pleaserun\/login|InvalidAPIkey|OAuthtokenhasexpired|notloggedin/i },
  { id: 'usage', re: /You'vehityour|You'vereachedyour|You'reoutofusage|usagelimitreached/i },
]
// the welcome banner, or the input box footer (always drawn in our acceptEdits sessions): after --resume
// of a long conversation the banner scrolls far up, the footer is redrawn at the bottom
const BANNER = /ClaudeCodev\d|don'taskon|shift\+tabtocycle/
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
      const refs = m.refs?.length ? `\n  참고 이미지(원하는 방향): ${m.refs.join(', ')} — Read 도구로 열어 보세요.` : ''
      return `- ${m.n}번 표시 [${where}${box}]${els}${m.note ? ` — 코멘트: "${m.note}"` : ''}${refs}`
    })
    .join('\n')
}

export class SessionManager {
  private live = new Map<string, Live>()
  /** variation re-layouts waiting for Claude; up to MAX_ADAPTING run side by side */
  private adaptQueue: { projectId: string; text: string }[] = []
  private adapting = new Set<string>()
  /** projects whose model/effort change waits for the running turn */
  private pendingRestart = new Set<string>()

  constructor(private emit: Emit) {
    setToolHooks({
      onStoryboard: (projectId, sb) => this.addStoryboard(projectId, sb),
      onAudioCandidates: (projectId, list) => {
        writeText(join(projects.pathOf(projectId), '.studio', 'audio-candidates.json'), JSON.stringify(list))
        this.emit({ type: 'audio-candidates', projectId, list })
      },
      onGenerated: (projectId, files, label) => this.showGenerated(projectId, files, label),
    })
  }

  /** a card in the chat for media Claude generated (the designer keeps, discards or applies it) */
  showGenerated(projectId: string, files: { file: string; kind: string }[], label?: string) {
    const l = this.live.get(projectId)
    if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'generated', files, label, status: 'pending' })
  }

  /** the designer kept, discarded or applied what Claude generated */
  resolveGenerated(projectId: string, itemId: string, status: 'kept' | 'discarded' | 'applied', note?: string) {
    const l = this.live.get(projectId)
    const it = l?.appItems.find((x) => x.id === itemId)
    if (!l || !it || it.role !== 'generated') throw new Error('이 소재 카드를 찾을 수 없어요.')
    this.updateApp(l, { ...it, status, note })
    return it
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
   * Artlist does not let apps register for sign-in, so Claude Code itself signs in
   * (its /mcp screen). This helper runs Claude Code with only the Artlist server
   * in the projects folder and opens /mcp; the designer picks artlist →
   * Authenticate in the terminal shown by the app. The token stays with Claude
   * Code (keyed by server name + URL), so every project session reuses it.
   */
  startArtlistLogin(): SessionState {
    const id = '__artlist__'
    this.kill(id)
    const mcp = JSON.stringify({ mcpServers: { artlist: { type: 'http', url: AI_PROVIDERS.artlist.url } } })
    const term = pty.spawn(claudeBinary(), ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcp, '--tools', ''], {
      name: 'xterm-256color',
      cols: 100,
      rows: 28,
      cwd: projectsDir(),
      env: claudeEnv(),
      useConpty: true,
    })
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 28, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0 }
    this.live.set(id, l)
    let opened = false
    term.onData((d) => {
      l.buffer = (l.buffer + d).slice(-REPLAY)
      l.plain = (l.plain + toPlain(d)).slice(-6000)
      this.emit({ type: 'pty-data', projectId: id, data: d })
      this.detect(l)
      // once the input box is up (folder trusted), open the MCP screen
      if (l.state.status === 'ready' && !opened) {
        opened = true
        setTimeout(async () => {
          term.write('/mcp')
          await new Promise((r) => setTimeout(r, ENTER_DELAY))
          term.write('\r')
        }, 600)
      }
    })
    term.onExit(({ exitCode }) => this.setState(l, { status: 'exited', exitCode }))
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
      if (id === keepProjectId || id.startsWith('__') || this.adapting.has(id)) continue
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
    // a conversation exists once its first message was written; a session that was started
    // but never used (e.g. the model was changed before the first request) starts anew
    const resume = !!meta.agentSessionId && !!findTranscript(meta.agentSessionId)
    const sessionId = meta.agentSessionId ?? randomUUID()
    if (!resume) projects.touch(projectId, { agentSessionId: sessionId })

    const studioDir = join(dir, '.studio')
    mkdirSync(studioDir, { recursive: true })
    const promptFile = join(studioDir, 'system-prompt.md')
    writeText(promptFile, STUDIO_PROMPT)
    // subagents do not get the appended prompt: they read the composition rules from here
    writeText(join(studioDir, 'motion-studio-rules.md'), `# Motion Studio — composition rules\n\nYou are building a video inside Motion Studio. composition/ is the HyperFrames project, composition/index.html the root. Run the HyperFrames CLI as \`hyperframes <command>\` inside composition/. Do not run init, render, preview, publish or skills update.\n\n${COMPOSITION_CONTRACT}`)
    // Artlist signs in through Claude Code itself (/mcp in the terminal): the app never sees its token
    const artlist = aiSettings().artlist
    const mcpConfig = JSON.stringify({
      mcpServers: {
        studio: { type: 'http', url: `${previewBase()}/mcp/${mcpTokenFor(projectId)}` },
        ...(artlist ? { artlist: { type: 'http', url: AI_PROVIDERS.artlist.url } } : {}),
      },
    })
    const settings = JSON.stringify({
      disableClaudeAiConnectors: true,
      permissions: {
        // Read(path) covers every file-reading tool (Glob, Grep), Edit(path) every writing tool
        // the HyperFrames CLI (check, snapshot, add <block> …) runs without asking: it only works inside the project
        allow: ['mcp__studio', ...(artlist ? ['mcp__artlist'] : []), 'Skill', 'Agent', 'Read(./**)', 'Edit(./composition/**)', 'Bash(hyperframes:*)', 'Bash(npx hyperframes:*)', 'Bash(npx -y hyperframes:*)', 'Bash(npx --yes hyperframes:*)', 'Bash(cd composition && hyperframes:*)', 'Bash(cd composition && npx hyperframes:*)'],
        // files the app manages: denied in every mode, never even asked
        deny: ['Edit(./composition/ms/**)', 'Edit(./composition/vendor/**)', 'Edit(./composition/assets/**)', 'Edit(./composition/fonts/**)', 'Edit(./brief.json)', 'Edit(./overrides.json)', 'Edit(./references/**)', 'Edit(./project.json)', 'Edit(./.history/**)', 'Edit(./.studio/**)'],
      },
      // anything else (a command, a web page, a file outside the project) is asked through the app:
      // a card in the chat ("물어보기") or allowed at once ("모두 허용")
      hooks: {
        PermissionRequest: [{ matcher: '*', hooks: [{ type: 'http', url: `${previewBase()}/hook/${mcpTokenFor(projectId)}/permission`, timeout: 900 }] }],
        // the first composition write of a conversation waits until the HyperFrames workflow skill was read
        PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'http', url: `${previewBase()}/hook/${mcpTokenFor(projectId)}/pretool`, timeout: 30 }] }],
      },
      // replies and the notes between tool calls in the designer's language
      language: 'Korean',
    })
    const name = `모션스튜디오 · ${meta.name}`.slice(0, 60)
    const args = [
      ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      '--remote-control', name,
      '--name', meta.name,
      '--setting-sources', '',
      '--settings', settings,
      '--strict-mcp-config', '--mcp-config', mcpConfig,
      // acceptEdits: edits inside the project need no question (the deny rules above still hold);
      // its footer ("shift+tab to cycle") also tells us the input box is drawn
      '--permission-mode', 'acceptEdits',
      // Agent: the HyperFrames workflows hand planning / building / repairs to subagents
      '--tools', 'Read,Write,Edit,Glob,Grep,Skill,Agent,Bash,WebFetch,WebSearch',
      '--plugin-dir', pluginDir(),
      '--add-dir', pluginDir(),
      '--append-system-prompt-file', promptFile,
      // render the studio rules fresh each request so app updates reach existing conversations
      '--system-prompt-snapshot', 'off',
      // session-only model/effort: never touches the designer's own Claude Code defaults
      '--model', meta.agentModel || DEFAULT_MODEL,
      '--effort', meta.agentEffort || DEFAULT_EFFORT,
    ]
    const kept = this.sizes.get(projectId)
    this.sizes.delete(projectId)
    const cols = existing?.cols ?? kept?.cols ?? 110
    const rows = existing?.rows ?? kept?.rows ?? 34
    // PATH: `hyperframes` / `npx hyperframes` reach the CLI inside the app (no Node needed on this computer)
    const term = pty.spawn(claudeBinary(), args, { name: 'xterm-256color', cols, rows, cwd: dir, env: claudeEnv({ PATH: sessionPath() }), useConpty: true })

    const l: Live = {
      projectId,
      dir,
      sessionId,
      term,
      buffer: '',
      plain: '',
      cols,
      rows,
      state: { status: 'starting', sessionId, remoteName: name, model: meta.agentModel || DEFAULT_MODEL, effort: meta.agentEffort || DEFAULT_EFFORT },
      tail: undefined as unknown as TranscriptTail,
      appItems: projects.readChat<ChatItem>(projectId),
      compositionMtime: this.compMtime(dir),
    }
    l.tail = new TranscriptTail(sessionId, dir, {
      item: (item) => this.emit({ type: 'item', projectId, item }),
      update: (item) => this.emit({ type: 'item-update', projectId, item }),
      busy: (busy) => this.setState(l, { status: busy ? 'busy' : 'ready' }),
      turnEnd: (lastText, how) => void this.onTurnEnd(l, lastText, how),
      remoteUrl: (url) => l.state.remoteUrl !== url && this.setState(l, { remoteUrl: url }),
    })
    this.live.set(projectId, l)
    this.setState(l, l.state)

    // after a restart the killed process may still print or exit: only the current one counts
    const current = () => this.live.get(projectId) === l
    term.onData((d) => {
      if (!current()) return
      l.buffer = (l.buffer + d).slice(-REPLAY)
      l.plain = (l.plain + toPlain(d)).slice(-6000)
      this.emit({ type: 'pty-data', projectId, data: d })
      this.detect(l)
    })
    term.onExit(({ exitCode }) => {
      l.tail.stop()
      if (!current()) return
      endPermissions(projectId)
      this.pendingRestart.delete(projectId) // a fresh start picks the new model/effort anyway
      // a resume that Claude Code could not find (only while it was still starting)
      const failedResume = resume && l.state.status === 'starting' && /No conversation found/i.test(l.plain)
      if (failedResume) projects.touch(projectId, { agentSessionId: undefined })
      this.setState(l, { status: 'exited', exitCode, attention: failedResume ? null : l.state.attention })
      // nothing to resume: start a new conversation right away instead of showing "종료됨"
      if (failedResume) setTimeout(() => current() && this.start(projectId), 300)
      // a variation re-layout that was running here will not finish
      if (this.adapting.has(projectId)) {
        this.adapting.delete(projectId)
        try {
          setFamilyStatus(projectId, 'error')
        } catch {
          /* folder gone */
        }
        this.emit({ type: 'family-changed', projectId })
        setTimeout(() => void this.pump(), 500)
      }
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
    // several variations are re-laid out at once, each in its own Claude session
    while (this.adapting.size < MAX_ADAPTING && this.adaptQueue.length) void this.runAdaptation(this.adaptQueue.shift()!)
  }

  private async runAdaptation(next: { projectId: string; text: string }) {
    this.adapting.add(next.projectId)
    try {
      setFamilyStatus(next.projectId, 'working')
      this.emit({ type: 'family-changed', projectId: next.projectId })
      await this.send({ projectId: next.projectId, text: next.text })
    } catch (e) {
      try {
        setFamilyStatus(next.projectId, 'error')
      } catch {
        /* the variation was deleted */
      }
      this.emit({ type: 'family-changed', projectId: next.projectId })
      const l = this.live.get(next.projectId)
      if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'error', text: '베리에이션을 시작하지 못했어요.', detail: e instanceof Error ? e.message : String(e) })
      this.adapting.delete(next.projectId)
      void this.pump()
    }
  }

  /**
   * Model / reasoning effort for this project. Claude Code's own /model and /effort
   * pickers save the choice as the user's global default, so the session is
   * restarted with --model/--effort instead (--resume keeps the conversation).
   */
  setModel(projectId: string, opts: { model: string; effort: string }): SessionState {
    projects.touch(projectId, { agentModel: opts.model || undefined, agentEffort: (opts.effort || undefined) as never })
    const l = this.live.get(projectId)
    if (!l) return this.state(projectId)
    if (l.state.status === 'busy' || this.adapting.has(projectId)) {
      this.pendingRestart.add(projectId)
      this.setState(l, { pendingRestart: true })
      return l.state
    }
    return this.restart(projectId)
  }

  private async onTurnEnd(l: Live, lastText: string, how: 'done' | 'stopped' | 'failed' = 'done') {
    if (this.adapting.has(l.projectId)) {
      this.adapting.delete(l.projectId)
      try {
        // a stopped or failed re-layout is not a finished variation
        setFamilyStatus(l.projectId, how === 'done' ? 'done' : 'error')
      } catch {
        /* folder gone */
      }
      this.emit({ type: 'family-changed', projectId: l.projectId })
      setTimeout(() => void this.pump(), 500)
    }
    if (this.pendingRestart.has(l.projectId)) {
      // a message queued during the turn starts right away: restart only once the session is really idle
      setTimeout(() => {
        const cur = this.live.get(l.projectId)
        if (cur !== l || !this.pendingRestart.has(l.projectId)) return
        if (l.state.status === 'busy') return // the next turn's end tries again
        this.pendingRestart.delete(l.projectId)
        this.restart(l.projectId)
      }, 1500)
    }
    try {
      await this.afterTurn(l, lastText)
    } catch {
      /* the project folder was moved or deleted: nothing to record */
    }
  }

  private async afterTurn(l: Live, lastText: string) {
    projects.pathOf(l.projectId) // throws when the folder is gone (never recreate it)
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
      // project card + this history entry get a picture of the new video
      const out = projects.state(l.projectId).brief.output
      const rel = entry ? `thumbnails/turn-${entry.id.slice(0, 12)}.jpg` : undefined
      refreshThumbnail(l.dir, { width: out.width, height: out.height, duration: out.duration }, {
        historyRel: rel,
        onDone: (ok) => {
          if (!ok || !entry || !rel) return
          history.setThumbnail(l.dir, entry.id, rel)
          this.emit({ type: 'history-changed', projectId: l.projectId })
        },
      })
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

  /** types a slash command into the terminal (e.g. /mcp for Artlist sign-in); the designer finishes it there */
  async typeCommand(projectId: string, command: string) {
    let l = this.live.get(projectId)
    if (!l || l.state.status === 'exited') {
      this.start(projectId)
      l = this.live.get(projectId)!
    }
    for (let i = 0; i < 60 && l.state.status === 'starting'; i++) await new Promise((r) => setTimeout(r, 250))
    l.term.write(command)
    await new Promise((r) => setTimeout(r, ENTER_DELAY))
    l.term.write('\r')
  }

  /** restarts idle sessions so a new MCP setup (e.g. Artlist on/off) takes effect */
  restartIdle() {
    // a snapshot: restart() re-inserts the entry, and a live Map iteration would visit it again (endless restarts)
    for (const [id, l] of [...this.live]) {
      if (id.startsWith('__')) continue
      if (l.state.status === 'ready' || (l.state.status === 'starting' && l.state.attention !== 'trust')) this.restart(id)
      else if (l.state.status === 'busy') this.pendingRestart.add(id)
    }
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
    for (let i = 0; i < 60 && l.state.status === 'starting' && !l.state.attention; i++) await new Promise((r) => setTimeout(r, 250))
    // never type into a prompt (folder trust, login) or a session that is not up
    const now = this.state(projectId)
    if (now.attention === 'trust') throw new Error('먼저 터미널에서 이 프로젝트 폴더를 신뢰한다고 선택해 주세요.')
    if (now.attention === 'login') throw new Error('Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.')
    if (now.status === 'starting') throw new Error('Claude가 아직 준비 중이에요. 잠시 뒤 다시 보내 주세요.')
    if (now.status === 'exited') throw new Error('Claude가 종료됐어요. 터미널의 "다시 시작"을 누른 뒤 보내 주세요.')

    const oneLine = input.text.replace(/\s*\n\s*/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
    const rich = !!(input.marks?.length || input.annotatedFrame || input.attachments?.length) || input.text.includes('\n') || oneLine.length > 300
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
        ...(input.attachments?.length
          ? ['', '## 참고 이미지 (디자이너가 원하는 방향)', ...input.attachments.map((a) => `- ${a}`), '', 'Read 도구로 하나씩 열어 보고 분위기·구성·색·타이포를 참고하세요. 그대로 복사하지는 마세요.']
          : []),
      ].join('\n')
      writeText(join(fb, `msg-${stamp}.md`), md)
      writeText(join(fb, `msg-${stamp}.json`), JSON.stringify({ text: input.text, marks: input.marks, frame, time: input.time, attachments: input.attachments }))
      line = `[모션스튜디오 메시지] feedback/msg-${stamp}.md 파일을 Read 도구로 읽고 그 내용대로 진행해 주세요.`
    }
    if (!line) return
    // a line starting with / ! # would be a Claude Code command, not a message
    if (/^[/!#]/.test(line)) line = ` ${line}`
    // the session may have been restarted while we waited (model change): type into the current one
    const cur = this.live.get(projectId)
    if (!cur || cur.state.status === 'exited') throw new Error('Claude가 다시 연결되는 중이에요. 잠시 뒤 다시 보내 주세요.')
    cur.term.write(line)
    await new Promise((r) => setTimeout(r, ENTER_DELAY))
    cur.term.write('\r')
  }

  async approveStoryboard(projectId: string, itemId: string) {
    // approved only once Claude actually got the message
    await this.send({ projectId, text: '콘티를 승인했어요. 이대로 영상을 만들어 주세요.' })
    const l = this.live.get(projectId)
    const item = l?.appItems.find((x) => x.id === itemId)
    if (l && item?.role === 'storyboard') this.updateApp(l, { ...item, status: 'approved' })
  }

  /** a variation still waiting or being re-laid out in this run */
  isAdapting(projectId: string): boolean {
    return this.adapting.has(projectId) || this.adaptQueue.some((q) => q.projectId === projectId)
  }

  restart(projectId: string): SessionState {
    // keep the terminal size: kill() forgets the session, start() would fall back to 110×34
    const size = this.live.get(projectId)
    this.kill(projectId)
    if (size) this.sizes.set(projectId, { cols: size.cols, rows: size.rows })
    return this.start(projectId)
  }

  /** terminal size to reuse across a restart */
  private sizes = new Map<string, { cols: number; rows: number }>()

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

