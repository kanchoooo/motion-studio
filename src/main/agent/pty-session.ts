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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as pty from 'node-pty'
import type { AgentEvent, ChatItem, CurrentStoryboard, SendMessageInput, SessionState, Storyboard } from '@shared/api'
import type { FeedbackMark } from '@shared/project'
import { AI_PROVIDERS, type AudioCandidateList } from '@shared/ai'
import { CAMERA_ID } from '@shared/overrides'
import { aiSettings } from '../ai/settings'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import * as history from '../history'
import { isDev, appRoot, dataDir, projectsDir, runtimeFiles } from '../paths'
import { previewBase } from '../preview-server'
import * as projects from '../projects'
import { newId, nowIso, writeText } from '../util'
import { setFamilyStatus } from '../variations'
import { refreshThumbnail } from '../thumbnail'
import { mcpTokenFor, setToolHooks } from './mcp-http'
import { endPermissions } from './permissions'
import { sessionPath } from './cliShims'
import { COMPOSITION_CONTRACT, HANDOFF_NOTE, HANDOFF_REQUEST, NAME_NEW_REQUEST, splitRequest, STUDIO_PROMPT, TIDY_REQUEST } from './prompt'
import { listReferences } from '../references'
import { approvalFor, designerLayers, setApproval } from './designerGuard'
import { assignMaterial, carryAssignments, readStoryboard, withMaterialIds, writeStoryboard } from '../storyboard'
import { repairCompositionHead } from '../headFix'
import { auditLayers, auditVerdict, tidyAfter, tidyBefore, type LayerAudit } from '../tidy'
import { compositionHasVideo } from '../template'
import { findTranscript, TranscriptTail } from './transcript'
import { ApiMeter } from './apiMeter'
import { addSpend, authMode, authStatus, markFailed, onAuthChange, sessionAuth } from '../claudeApi'
import { apiFailure, FAILURE_TEXT, type ApiCostInfo, type ApiFailureReason, type ClaudeAuthMode } from '@shared/claudeApi'

type Emit = (e: AgentEvent) => void

export const pluginDir = () => (isDev ? join(appRoot(), 'resources', 'claude-plugin') : join(process.resourcesPath, 'claude-plugin'))

/** project default unless the designer picks another in the chat panel: latest Opus, high effort */
export const DEFAULT_MODEL = 'opus'
export const DEFAULT_EFFORT = 'high'
/** longest a studio tool call may run (AI generation waits included) */
export const STUDIO_TOOL_TIMEOUT_MS = 15 * 60 * 1000
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
// a session on the API key whose requests the API refuses (key removed or wrong): Claude Code retries
// for minutes ("401 invalid x-api-key · Retrying in 3s · attempt 3/10") — the subscription takes over at once
const KEY_REFUSED = /(401|403)(invalidx-api-key|authentication_error|permission_error|InvalidAPIkey)/i
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
  /** what this process runs on: the API key or the subscription (fixed until it restarts) */
  auth: ClaudeAuthMode
  /** the API key's spend of this process */
  meter: ApiMeter
}

/** a project's API spend so far (estimate), in .studio/api-cost.json */
function projectSpend(dir: string, add = 0): number {
  const f = join(dir, '.studio', 'api-cost.json')
  let usd = 0
  try {
    usd = Number((JSON.parse(readFileSync(f, 'utf8')) as { usd?: number }).usd) || 0
  } catch {
    /* none yet */
  }
  if (add > 0) {
    usd += add
    try {
      writeText(f, JSON.stringify({ usd }))
    } catch {
      /* the folder went away */
    }
  }
  return usd
}

/** what Claude is told when the work moves from the API key to the subscription mid-request */
const CONTINUE_DETAIL = (why: string) =>
  `The last request stopped with an API error: the app's API key cannot be used any more (${why}). The app restarted this same conversation on the designer's Claude subscription. Continue the designer's last request from where it stopped. Do not redo work that is already done — check the files first when unsure. If the request was already finished, reply with one short line saying so.`

/**
 * a mark's attached files (a video: its middle still to look at, <file>.jpg); what they are for is in
 * the designer's comment — the ways it can go are spelled out so Claude knows how to do each
 */
function markRefs(refs: string[]): string {
  const list = refs.map((r) => (/\.(mp4|mov|m4v|webm)$/i.test(r) ? `${r} (영상 · 가운데 장면: ${r}.jpg)` : r)).join(', ')
  return `첨부 파일: ${list} — Read 도구로 열어 보고 코멘트(없으면 메시지)대로 쓰세요. 이 자리의 그림·영상을 이 파일로 바꾸라는 뜻이면 use_as_material에 이 경로를 넘겨 소재함에 넣고 그 경로를 쓰세요(영상은 그 자리의 시작·길이에 맞춰, 크기·위치·움직임은 지금 것을 이어받아요). 이 스타일로 바꾸라는 뜻이면 이 부분의 모양(색·모서리·그림자·글꼴 느낌·아이콘 스타일 등)을 이 파일의 스타일로 다시 디자인하고 내용·문구·자리는 그대로 둬요. 어느 쪽인지 분명하지 않으면 원하는 방향의 참고 자료로 보세요.`
}

/** a layer's data-ms-label in the composition (either attribute order) */
export function labelInComposition(dir: string, id: string): string | null {
  try {
    const html = readFileSync(join(dir, 'composition', 'index.html'), 'utf8')
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const tag = html.match(new RegExp(`<[a-z][^>]*\\bdata-ms-id="${safe}"[^>]*>`, 'i'))?.[0]
    return tag?.match(/\bdata-ms-label="([^"]*)"/)?.[1]?.trim() || null
  } catch {
    return null
  }
}

export function markLines(marks: FeedbackMark[]): string {
  return marks
    .map((m) => {
      const where = m.kind === 'range' && m.range ? `${m.range.from.toFixed(1)}~${m.range.to.toFixed(1)}초 구간` : `${m.time.toFixed(2)}초`
      const box = m.rect ? ` 영역(x:${Math.round(m.rect.x)}, y:${Math.round(m.rect.y)}, w:${Math.round(m.rect.w)}, h:${Math.round(m.rect.h)})` : ''
      const els = m.elements.length ? ` 해당 요소: ${m.elements.map((e) => `${e.label}(data-ms-id="${e.id}")`).join(', ')}` : ' 해당 요소 없음(빈 영역)'
      const refs = m.refs?.length ? `\n  ${markRefs(m.refs)}` : ''
      return `- ${m.n}번 표시 [${where}${box}]${els}${m.note ? ` — 코멘트: "${m.note}"` : ''}${refs}`
    })
    .join('\n')
}

/** BRIEF.md written by Motion Studio before 0.5 (it forced the companion flow): removed; Claude's own stays */
export function dropAppBriefDoc(projectDir: string) {
  const file = join(projectDir, 'composition', 'BRIEF.md')
  try {
    if (existsSync(file) && /Written by Motion Studio from the designer's brief/.test(readFileSync(file, 'utf8'))) rmSync(file, { force: true })
  } catch {
    /* unreadable: leave it */
  }
}

export class SessionManager {
  private live = new Map<string, Live>()
  /** variation re-layouts waiting for Claude; up to MAX_ADAPTING run side by side */
  private adaptQueue: { projectId: string; text: string }[] = []
  private adapting = new Set<string>()
  /** projects whose model/effort change waits for the running turn */
  private pendingRestart = new Set<string>()
  /** 편집 활성화 per project: asked (Claude names the layers), fixing (asked once more to restore the look) */
  private tidy = new Map<string, 'asked' | 'fixing'>()
  /** counts the designer's messages per project: a 편집 활성화 started before one of them does not judge its turn */
  private sent = new Map<string, number>()
  /** the message count when 편집 활성화 asked Claude */
  private tidyAt = new Map<string, number>()
  /** after which designer message the app last asked Claude to name new things (asked once per request) */
  private naming = new Map<string, number>()
  /** text layers already asked to be split from their box (not asked again every turn) */
  private askedSplit = new Map<string, Set<string>>()
  /** the last StopFailure hook per project (its error type tells a billing error from others) */
  private stopFailures = new Map<string, { error?: string; text: string; at: number }>()
  /** projects moving from the API key to the subscription right now (their restart is not a failed re-layout) */
  private switching = new Set<string>()

  constructor(private emit: Emit) {
    setToolHooks({
      onStoryboard: (projectId, sb) => this.addStoryboard(projectId, sb),
      onAudioCandidates: (projectId, list) => {
        writeText(join(projects.pathOf(projectId), '.studio', 'audio-candidates.json'), JSON.stringify(list))
        this.emit({ type: 'audio-candidates', projectId, list })
        // …and a card in the chat to listen and pick
        const l = this.live.get(projectId)
        if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'audio', list })
      },
      onGenerated: (projectId, files, label) => this.showGenerated(projectId, files, label),
      onVoices: (projectId, card) => {
        const l = this.live.get(projectId)
        if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'voices', ...card })
      },
      onBuildStart: (projectId) => this.buildStarted(projectId),
      onHandoff: (projectId, markdown) => this.emit({ type: 'handoff-ready', projectId, markdown }),
      onNotice: (projectId, text) => {
        const l = this.live.get(projectId)
        if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'notice', text })
      },
    })
    // the API key was saved, removed, switched off or stopped working (or may be used again):
    // sessions on the other one restart now when idle, else after their turn (--resume keeps the conversation)
    onAuthChange(() => {
      this.emit({ type: 'claude-auth', status: authStatus() })
      const want = authMode()
      for (const [id, l] of [...this.live]) {
        if (id.startsWith('__') || l.auth === want || this.switching.has(id)) continue
        // (a session on the key that stopped at a sign-in screen restarts too)
        const stuck = l.auth === 'api' && l.state.attention === 'login'
        if (l.state.status === 'ready' || (l.state.status === 'starting' && (!l.state.attention || stuck))) this.restart(id)
        else if (l.state.status === 'busy') {
          this.pendingRestart.add(id)
          this.setState(l, { pendingRestart: true })
        }
      }
    })
  }

  /** a turn ended with an API error (StopFailure hook) */
  stopFailure(projectId: string, info: { error?: string; text: string }) {
    this.stopFailures.set(projectId, { ...info, at: Date.now() })
  }

  /** reads the API key's spend of a process since the last look: this computer's month and the project add it */
  private meterRead(l: Live): number {
    const usd = l.meter.read()
    if (usd > 0) {
      addSpend(usd)
      projectSpend(l.dir, usd)
    }
    return usd
  }

  /** the API spend shown in the chat (also when no session runs) */
  apiCost(projectId: string): ApiCostInfo {
    const l = this.live.get(projectId)
    if (l) this.meterRead(l)
    return { projectId, turn: this.lastTurnCost.get(projectId) ?? 0, project: projectSpend(projects.pathOf(projectId)), month: authStatus().month.usd, at: nowIso() }
  }
  private lastTurnCost = new Map<string, number>()

  /** a card in the chat for media Claude generated (the designer keeps, discards or applies it) */
  /** automated tests: a sound candidate card in the chat */
  showAudio(projectId: string, list: AudioCandidateList) {
    const l = this.live.get(projectId)
    if (l) this.addApp(l, { id: newId(), at: nowIso(), role: 'audio', list })
  }

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
    // a revised storyboard keeps what the designer already assigned
    const prev = readStoryboard(l.dir)
    const sb = carryAssignments(withMaterialIds(storyboard), prev?.storyboard)
    for (const it of l.appItems) if (it.role === 'storyboard' && it.status !== 'superseded') this.updateApp(l, { ...it, status: 'superseded' })
    const item: ChatItem = { id: newId(), at: nowIso(), role: 'storyboard', storyboard: sb, status: 'pending' }
    const cur: CurrentStoryboard = { itemId: item.id, status: 'pending', storyboard: sb }
    writeStoryboard(l.dir, cur)
    this.addApp(l, item)
    this.emit({ type: 'storyboard-changed', projectId, current: cur })
  }

  /** the storyboard the designer works with (also when the session is not running) */
  storyboard(projectId: string): CurrentStoryboard | null {
    return readStoryboard(projects.pathOf(projectId))
  }

  /** the designer put a file into (or took it out of) a material slot of the storyboard */
  assign(projectId: string, materialId: string, file: string | null): CurrentStoryboard {
    const dir = projects.pathOf(projectId)
    const cur = assignMaterial(dir, materialId, file)
    const l = this.live.get(projectId)
    const it = l?.appItems.find((x) => x.id === cur.itemId)
    if (l && it?.role === 'storyboard') this.updateApp(l, { ...it, storyboard: cur.storyboard })
    else if (!l) {
      // no session: the chat file still shows the card
      const items = projects.readChat<ChatItem>(projectId)
      const i = items.findIndex((x) => x.id === cur.itemId)
      if (i >= 0 && items[i].role === 'storyboard') {
        items[i] = { ...(items[i] as Extract<ChatItem, { role: 'storyboard' }>), storyboard: cur.storyboard }
        projects.writeChat(projectId, items)
      }
    }
    this.emit({ type: 'storyboard-changed', projectId, current: cur })
    return cur
  }

  /** the designer picked a voice on a voice card: Claude is told, then the card shows the pick */
  async pickVoice(projectId: string, itemId: string, voiceId: string) {
    const l = this.live.get(projectId)
    const it = l?.appItems.find((x) => x.id === itemId)
    if (!l || !it || it.role !== 'voices') throw new Error('이 목소리 카드를 찾을 수 없어요.')
    const v = it.voices.find((x) => x.id === voiceId)
    if (!v) throw new Error('그 목소리를 찾을 수 없어요.')
    await this.send({ projectId, text: `내레이션 목소리는 「${v.name}」으로 할게요.`, detail: `고른 목소리: provider ${v.provider}, id ${v.id}${v.voiceType ? `, voice_type ${v.voiceType}` : ''}${v.source ? `, source ${v.source}` : ''}${v.engine ? `, engine ${v.engine}` : ''}${v.sample ? `, sample ${v.sample}` : ''}` })
    const now = this.live.get(projectId)?.appItems.find((x) => x.id === itemId)
    if (now?.role === 'voices') this.updateApp(this.live.get(projectId)!, { ...now, picked: voiceId })
  }

  /** 프로젝트 공유: Claude writes the handoff memo (save_handoff); the designer reviews it in the share window */
  async requestHandoff(projectId: string) {
    const l = this.live.get(projectId)
    if (!l || l.state.status !== 'ready') throw new Error('Claude가 작업을 마치고 대기 중일 때 요약을 받을 수 있어요.')
    await this.deliver({ projectId, fromApp: true, text: '다른 디자이너에게 넘길 인계 메모를 써 주세요.', detail: HANDOFF_REQUEST })
  }

  /** the designer picked a music / sound-effect candidate on a chat card: Claude is told, then the card shows the pick */
  async pickAudio(projectId: string, itemId: string, candidateId: string) {
    const l = this.live.get(projectId)
    const it = l?.appItems.find((x) => x.id === itemId)
    if (!l || !it || it.role !== 'audio') throw new Error('이 후보 카드를 찾을 수 없어요.')
    const c = it.list.items.find((x) => x.id === candidateId)
    if (!c) throw new Error('그 후보를 찾을 수 없어요.')
    const what = it.list.kind === 'bgm' ? '배경음악' : '효과음'
    const detail = [
      `고른 후보: ${c.title}${c.artist ? ` · ${c.artist}` : ''} (출처 ${c.source}${c.license ? `, 라이선스 ${c.license}` : ''})`,
      c.file ? `듣기용 파일: ${c.file}` : '',
      c.downloadUrl ? `download_url: ${c.downloadUrl}` : '',
      c.previewUrl ? `preview_url: ${c.previewUrl}` : '',
      c.pageUrl ? `page_url: ${c.pageUrl}` : '',
      it.list.kind === 'bgm' ? 'Bring it in (ai_import, or the file) and make it THE background music: give the existing bgm element the new src (keep its data-ms-id) instead of adding a second track. Mark it data-ms-type="bgm" with a Korean data-ms-label.' : 'Bring it in (ai_import, or the file) and place it where it fits the motion: data-ms-id, data-ms-type="sfx", data-ms-sfx (its kind) and a Korean data-ms-label.',
    ]
      .filter(Boolean)
      .join('\n')
    await this.send({ projectId, text: `${what}은 「${c.title}」로 할게요.`, detail })
    const now = this.live.get(projectId)?.appItems.find((x) => x.id === itemId)
    if (now?.role === 'audio') this.updateApp(this.live.get(projectId)!, { ...now, picked: candidateId })
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
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 26, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0, auth: 'subscription' as ClaudeAuthMode, meter: new ApiMeter('', false) }
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
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 28, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0, auth: 'subscription' as ClaudeAuthMode, meter: new ApiMeter('', false) }
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
    const l = { projectId: id, dir: projectsDir(), sessionId: '', term, buffer: '', plain: '', cols: 100, rows: 24, state: { status: 'starting' } as SessionState, tail: { stop() {}, items: [], busy: false } as unknown as TranscriptTail, appItems: [], compositionMtime: 0, auth: 'subscription' as ClaudeAuthMode, meter: new ApiMeter('', false) }
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
    // the app no longer writes BRIEF.md (it forced the official workflow's settled-brief path):
    // the one an older version wrote goes, a BRIEF.md Claude wrote itself stays
    dropAppBriefDoc(dir)
    const promptFile = join(studioDir, 'system-prompt.md')
    // a project someone shared: the session starts from their handoff memo
    const handedOver = !!meta.sharedFrom && existsSync(join(studioDir, 'handoff.md'))
    writeText(promptFile, handedOver ? STUDIO_PROMPT + HANDOFF_NOTE : STUDIO_PROMPT)
    // subagents do not get the appended prompt: they read the composition rules from here
    writeText(join(studioDir, 'motion-studio-rules.md'), `# Motion Studio — composition rules\n\nYou are building a video inside Motion Studio. composition/ is the HyperFrames project, composition/index.html the root. Run the HyperFrames CLI as \`hyperframes <command>\` inside composition/. Do not run init, render, preview, publish or skills update.\n\n${COMPOSITION_CONTRACT}`)
    // Artlist signs in through Claude Code itself (/mcp in the terminal): the app never sees its token
    const artlist = aiSettings().artlist
    const mcpConfig = JSON.stringify({
      mcpServers: {
        // a studio tool answers when it is done (one JSON response): image / video generation can take
        // minutes, and without a per-server timeout Claude Code gives up on a silent call after ~60 s
        studio: { type: 'http', url: `${previewBase()}/mcp/${mcpTokenFor(projectId)}`, timeout: STUDIO_TOOL_TIMEOUT_MS },
        ...(artlist ? { artlist: { type: 'http', url: AI_PROVIDERS.artlist.url } } : {}),
      },
    })
    // the API key first when the designer saved one (claudeApi.ts); otherwise Claude Code's own login
    const auth = sessionAuth(previewBase())
    const settings = JSON.stringify({
      ...auth.settings,
      disableClaudeAiConnectors: true,
      // the next-prompt suggestions of the terminal are never seen in the app: no background request for them
      promptSuggestionEnabled: false,
      permissions: {
        // Read(path) covers every file-reading tool (Glob, Grep), Edit(path) every writing tool
        // the HyperFrames CLI (check, snapshot, add <block> …) runs without asking: it only works inside the project
        // WebSearch: researching strong ads for the category before planning (reading a page still asks)
        allow: ['mcp__studio', ...(artlist ? ['mcp__artlist'] : []), 'Skill', 'Agent', 'WebSearch', 'Read(./**)', 'Edit(./composition/**)', 'Bash(hyperframes:*)', 'Bash(npx hyperframes:*)', 'Bash(npx -y hyperframes:*)', 'Bash(npx --yes hyperframes:*)', 'Bash(cd composition && hyperframes:*)', 'Bash(cd composition && npx hyperframes:*)'],
        // files the app manages: denied in every mode, never even asked
        deny: ['Edit(./composition/ms/**)', 'Edit(./composition/vendor/**)', 'Edit(./composition/assets/**)', 'Edit(./composition/fonts/**)', 'Edit(./brief.json)', 'Edit(./overrides.json)', 'Edit(./references/**)', 'Edit(./project.json)', 'Edit(./.history/**)', 'Edit(./.studio/**)'],
      },
      // anything else (a command, a web page, a file outside the project) is asked through the app:
      // a card in the chat ("물어보기") or allowed at once ("모두 허용")
      hooks: {
        PermissionRequest: [{ matcher: '*', hooks: [{ type: 'http', url: `${previewBase()}/hook/${mcpTokenFor(projectId)}/permission`, timeout: 900 }] }],
        // no quality gates: the reviewer agent (when the designer asks for a review) gets the session's reasoning effort
        // edits of the composition: a layer the designer edited by hand changes only when asked (designerGuard.ts)
        // Bash / Read: the app's API key is never read (permissions.ts readsApiKey)
        PreToolUse: [{ matcher: 'Agent|Edit|MultiEdit|Write|Bash|Read', hooks: [{ type: 'http', url: `${previewBase()}/hook/${mcpTokenFor(projectId)}/pretool`, timeout: 30 }] }],
        // a turn that ended with an API error: its type (billing_error …) tells when the subscription takes over
        StopFailure: [{ matcher: '*', hooks: [{ type: 'http', url: `${previewBase()}/hook/${mcpTokenFor(projectId)}/stop-failure`, timeout: 10 }] }],
      },
      // replies and the notes between tool calls in the designer's language
      language: 'Korean',
    })
    const name = `모션스튜디오 · ${meta.name}`.slice(0, 60)
    const args = [
      ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      // Remote Control needs the claude.ai login: a session on the API key goes without it
      ...(auth.mode === 'subscription' ? ['--remote-control', name] : []),
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
    // MS_LOCAL_TOOLS: where open-source models Claude installs (e.g. a local TTS) live, shared by every project
    const meter = new ApiMeter(sessionId, auth.mode === 'api')
    meter.begin()
    const term = pty.spawn(claudeBinary(), args, { name: 'xterm-256color', cols, rows, cwd: dir, env: claudeEnv({ PATH: sessionPath(), MS_LOCAL_TOOLS: join(dataDir(), 'local-tools'), ...auth.env }), useConpty: true })

    const l: Live = {
      projectId,
      dir,
      sessionId,
      term,
      buffer: '',
      plain: '',
      cols,
      rows,
      state: { status: 'starting', sessionId, remoteName: auth.mode === 'subscription' ? name : undefined, model: meta.agentModel || DEFAULT_MODEL, effort: meta.agentEffort || DEFAULT_EFFORT, auth: auth.mode },
      tail: undefined as unknown as TranscriptTail,
      appItems: projects.readChat<ChatItem>(projectId),
      compositionMtime: this.compMtime(dir),
      auth: auth.mode,
      meter,
    }
    l.tail = new TranscriptTail(sessionId, dir, {
      item: (item) => this.emit({ type: 'item', projectId, item }),
      update: (item) => this.emit({ type: 'item-update', projectId, item }),
      busy: (busy) => this.setState(l, { status: busy ? 'busy' : 'ready' }),
      turnEnd: (lastText, how, error) => void this.onTurnEnd(l, lastText, how, error),
      // (a session on the API key has no Remote Control: an address the transcript kept from before is not shown)
      remoteUrl: (url) => l.auth !== 'api' && l.state.remoteUrl !== url && this.setState(l, { remoteUrl: url }),
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
      this.meterRead(l)
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
      this.endAdaptation(projectId, 'error')
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
    if (l.auth !== 'api' || this.live.get(l.projectId) !== l || l.projectId.startsWith('__') || this.switching.has(l.projectId)) return
    // a session on the API key that Claude Code asks to sign in: the key did not work — the subscription takes over
    if (attention === 'login') markFailed('auth', 'Claude Code가 API 키로 로그인하지 못했어요')
    // …or one retrying a refused key mid-request: the request goes on on the subscription
    else if (KEY_REFUSED.test(text.slice(-1500))) void this.continueOnSubscription(l, 'auth', '401 invalid x-api-key', undefined, true)
  }

  enqueueAdaptations(items: { projectId: string; text: string }[]) {
    this.adaptQueue.push(...items)
    void this.pump()
  }

  private async pump() {
    // several variations are re-laid out at once, each in its own Claude session
    while (this.adapting.size < MAX_ADAPTING && this.adaptQueue.length) void this.runAdaptation(this.adaptQueue.shift()!)
  }

  /** a re-layout ended (done, failed, or its session went away): its slot goes to the next one */
  private endAdaptation(projectId: string, status: 'done' | 'error') {
    const queued = this.adaptQueue.findIndex((q) => q.projectId === projectId)
    if (queued >= 0 && status === 'error') this.adaptQueue.splice(queued, 1)
    if (!this.adapting.delete(projectId) && queued < 0) return
    try {
      setFamilyStatus(projectId, status)
    } catch {
      /* folder gone */
    }
    this.emit({ type: 'family-changed', projectId })
    setTimeout(() => void this.pump(), 500)
  }

  private async runAdaptation(next: { projectId: string; text: string }) {
    this.adapting.add(next.projectId)
    // the designer may be talking with this variation already: its own turn finishes first
    for (let i = 0; i < 900 && this.live.get(next.projectId)?.state.status === 'busy'; i++) await new Promise((r) => setTimeout(r, 2000))
    try {
      setFamilyStatus(next.projectId, 'working')
      this.emit({ type: 'family-changed', projectId: next.projectId })
      await this.send({ projectId: next.projectId, text: next.text, approveAll: true })
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

  private async onTurnEnd(l: Live, lastText: string, how: 'done' | 'stopped' | 'failed' = 'done', error?: string) {
    // what the request cost on the API key
    if (l.auth === 'api') {
      const usd = this.meterRead(l)
      this.lastTurnCost.set(l.projectId, usd)
      this.emit({ type: 'api-cost', cost: { projectId: l.projectId, turn: usd, project: projectSpend(l.dir), month: authStatus().month.usd, at: nowIso() } })
    }
    // the API key cannot go on: the same conversation continues on the subscription
    if (how === 'failed' && l.auth === 'api' && this.live.get(l.projectId) === l) {
      const hook = this.stopFailures.get(l.projectId)
      const fresh = hook && Date.now() - hook.at < 60_000 ? hook : undefined
      const f = apiFailure(`${error ?? ''} ${fresh?.text ?? ''}`, fresh?.error)
      if (f) return this.continueOnSubscription(l, f.reason, error ?? fresh?.text, f.retryAt)
    }
    // a stopped or failed re-layout is not a finished variation
    if (this.adapting.has(l.projectId)) this.endAdaptation(l.projectId, how === 'done' ? 'done' : 'error')
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
      await this.afterTurn(l, lastText, how)
    } catch {
      /* the project folder was moved or deleted: nothing to record */
    }
  }

  /**
   * The API key stopped working mid-request: the subscription takes over (every session on the key
   * restarts), and this conversation goes on from where it stopped — a re-layout keeps its slot.
   */
  private async continueOnSubscription(l: Live, reason: ApiFailureReason, detail?: string, retryAt?: string, say = false) {
    const id = l.projectId
    const adapting = this.adapting.has(id)
    this.switching.add(id)
    // seen in the terminal (the transcript has no failed turn to show it): the chat says it
    if (say) this.addApp(l, { id: newId(), at: nowIso(), role: 'notice', text: `${FAILURE_TEXT[reason]}. Claude 구독으로 바꿔서 이어서 해요.` })
    try {
      markFailed(reason, detail, retryAt)
      // another project's failure may have switched first: this one still runs on the key
      if (this.live.get(id) === l) this.restart(id)
      const now = () => this.live.get(id)
      for (let i = 0; i < 240 && now()?.state.status === 'starting' && !now()?.state.attention; i++) await new Promise((r) => setTimeout(r, 250))
    } finally {
      this.switching.delete(id)
    }
    const cur = this.live.get(id)
    if (!cur || cur.auth === 'api') return
    // automated tests: the message is not sent (it would spend the subscription)
    if (process.env.MS_TEST_HOLD_CONTINUE) {
      this.addApp(cur, { id: newId(), at: nowIso(), role: 'notice', text: '(테스트) 구독으로 이어서 할 메시지를 보내지 않았어요.' })
      if (adapting) this.endAdaptation(id, 'error')
      return
    }
    try {
      await this.deliver({ projectId: id, fromApp: true, approveAll: adapting || undefined, text: '구독으로 바꿨어요. 하던 작업을 이어서 해 주세요.', detail: CONTINUE_DETAIL(FAILURE_TEXT[reason]) })
    } catch (e) {
      if (adapting) this.endAdaptation(id, 'error')
      this.addApp(cur, { id: newId(), at: nowIso(), role: 'error', text: '구독으로 이어서 하지 못했어요. 메시지를 다시 보내 주세요.', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  private async afterTurn(l: Live, lastText: string, how: 'done' | 'stopped' | 'failed' = 'done') {
    projects.pathOf(l.projectId) // throws when the folder is gone (never recreate it)
    // the app's head lines (local GSAP, fonts, designer edits, runtime) — Claude writes plain HyperFrames
    repairCompositionHead(l.dir, dirname(runtimeFiles.gsap()))
    projects.applyAudioEdits(l.dir)
    const m = this.compMtime(l.dir)
    projects.refreshFontCss(l.dir)
    const summary = lastText.split('\n').map((s) => s.replace(/^[-*•\s]+/, '').trim()).find((s) => s.length > 3) ?? 'Claude가 영상을 수정했어요'
    const entry = await history.record(l.dir, { actor: 'claude', summary: summary.slice(0, 120) }).catch(() => null)
    const changed = !!entry || m !== l.compositionMtime
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
    const tidying = this.tidy.has(l.projectId)
    await this.tidyStep(l, how)
    if (!tidying && changed && how === 'done') await this.editAudit(l).catch(() => {})
  }

  /** what activation and every later turn send Claude: the content without names, the texts to split */
  private namingDetail(a: LayerAudit, split: { id: string; label: string }[]) {
    return [
      a.unnamed.count ? `이름이 없는 내용 ${a.unnamed.count}개 (예: ${a.unnamed.samples.map((x) => `"${x}"`).join(', ')})` : '',
      split.length ? `배경이 붙은 글자 ${split.length}개: ${split.map((x) => `${x.id} (「${x.label}」)`).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * After a turn that changed a video the designer edits by hand: is everything still editable?
   * New content without names → Claude is asked once (per designer request) to name it; a video that
   * lost its layers goes back to view-only (편집 활성화 again); locked or edited layers that are gone
   * are said in the chat. Turns of 편집 활성화 itself are checked by tidyStep.
   */
  private async editAudit(l: Live) {
    const id = l.projectId
    const st = projects.state(id)
    if (st.meta.editable !== true || !st.hasVideo || this.live.get(id) !== l) return
    const out = st.brief.output
    // the designer's request this turn answered (read before the page is opened: they may send another meanwhile)
    const at = this.sent.get(id) ?? 0
    const a = await auditLayers(l.dir, { width: out.width, height: out.height })
    // the designer went on (a new request, Claude busy again) while the page was checked: the next turn is checked instead
    if ((this.sent.get(id) ?? 0) !== at || l.state.status !== 'ready' || this.live.get(id) !== l) return
    const notice = (text: string) => this.addApp(l, { id: newId(), at: nowIso(), role: 'notice', text })
    const asked = this.askedSplit.get(id) ?? new Set<string>()
    const v = auditVerdict(a, st.overrides, { askedSplit: asked, askedThisRequest: this.naming.get(id) === at, camera: CAMERA_ID })
    if (v.lost) {
      projects.touch(id, { editable: false })
      projects.notifyChanged(id)
      notice('이번 수정으로 편집할 수 있는 레이어 정보가 사라졌어요. 「편집 활성화」를 다시 누르거나, 작업 이력에서 이전 버전으로 되돌릴 수 있어요.')
      return
    }
    if (v.lockedGone.length) notice(`잠근 레이어 ${v.lockedGone.map((x) => `「${x}」`).join(', ')}가 이번 수정에서 사라졌어요. 작업 이력에서 이전 버전으로 되돌리거나, 편집 화면의 노란 안내에서 다른 레이어에 붙일 수 있어요.`)
    else if (v.gone.length) notice(`직접 수정한 레이어 ${v.gone.length}개가 이번 수정에서 사라졌어요. 편집 화면의 노란 안내에서 다른 레이어에 붙이거나 버릴 수 있어요.`)
    if (v.stillUnnamed) notice(`아직 이름이 없어 손으로 고를 수 없는 요소가 ${v.stillUnnamed}개 있어요. 대화에서 "편집할 수 있게 레이어 이름 붙여 줘"라고 요청할 수 있어요.`)
    if (!v.ask) return
    const split = v.split
    this.naming.set(id, at)
    split.forEach((x) => asked.add(x.id))
    this.askedSplit.set(id, asked)
    await this.deliver({ projectId: id, fromApp: true, text: '새로 만든 부분도 편집할 수 있게 레이어 이름을 붙여 주세요.', detail: `${NAME_NEW_REQUEST}\n\n${this.namingDetail(a, split)}` })
  }

  /** 배경 따로 떼기: Claude splits one text layer from its coloured box (the text keeps its id) */
  async splitLayer(projectId: string, layerId: string): Promise<void> {
    const l = this.live.get(projectId)
    if (!l || l.state.status !== 'ready') throw new Error('Claude가 작업을 마치고 대기 중일 때 눌러 주세요.')
    if (!/^[\w-]+$/.test(layerId)) throw new Error('이 레이어는 나눌 수 없어요.')
    const st = projects.state(projectId)
    const o = st.overrides.elements[layerId]
    // the name the designer sees: their own, else Claude's data-ms-label (never the id)
    const label = o?.label ?? labelInComposition(l.dir, layerId) ?? layerId
    const edited = !!o && Object.keys(o).some((k) => k !== 'label' && k !== 'locked')
    if (o?.locked) throw new Error('잠긴 레이어예요. 자물쇠를 먼저 풀어 주세요.')
    const asked = this.askedSplit.get(projectId) ?? new Set<string>()
    asked.add(layerId)
    this.askedSplit.set(projectId, asked)
    await this.deliver({ projectId, fromApp: true, text: `「${label}」의 글자와 배경을 따로 편집할 수 있게 나눠 주세요.`, detail: splitRequest(layerId, label, edited) })
  }

  /**
   * 편집 활성화 (the designer's button, once Claude has built the video and they want to refine it by
   * hand): content outside named layers → Claude adds names, nothing else; the same moments are
   * photographed before and after and a changed look is sent back once. Then the editor is open.
   * Returns 'ready' when nothing needed naming, 'asked' while Claude names the layers.
   */
  async activateEditing(projectId: string): Promise<'ready' | 'asked'> {
    const l = this.live.get(projectId)
    const dir = projects.pathOf(projectId)
    if (!projects.state(projectId).hasVideo) throw new Error('먼저 영상을 만들어 주세요.')
    if (!l || l.state.status !== 'ready') throw new Error('Claude가 작업을 마치고 대기 중일 때 눌러 주세요.')
    if (this.tidy.has(projectId)) throw new Error('이미 편집할 수 있게 정리하고 있어요.')
    const out = projects.state(projectId).brief.output
    const size = { width: out.width, height: out.height, duration: out.duration }
    const at = this.sent.get(projectId) ?? 0
    const audit = await auditLayers(dir, size)
    const unnamed = audit.unnamed
    if (!unnamed.count && !audit.boxedTexts.length) {
      this.markEditable(l)
      return 'ready'
    }
    this.askedSplit.set(projectId, new Set(audit.boxedTexts.map((x) => x.id)))
    await tidyBefore(dir, size)
    // the designer went on talking meanwhile: their request first
    if ((this.sent.get(projectId) ?? 0) !== at || l.state.status !== 'ready' || this.live.get(projectId) !== l) throw new Error('그사이 Claude가 다른 작업을 시작했어요. 끝나면 다시 눌러 주세요.')
    this.tidy.set(projectId, 'asked')
    this.tidyAt.set(projectId, at)
    try {
      await this.deliver({ projectId, fromApp: true, text: '편집할 수 있게 레이어 이름을 정리해 주세요.', detail: `${TIDY_REQUEST}\n\n${this.namingDetail(audit, audit.boxedTexts)}` })
    } catch (e) {
      this.tidy.delete(projectId)
      throw e
    }
    return 'asked'
  }

  /** the editor opens for hand edits (project.json editable) */
  private markEditable(l: Live) {
    this.tidy.delete(l.projectId)
    this.tidyAt.delete(l.projectId)
    projects.touch(l.projectId, { editable: true })
    projects.notifyChanged(l.projectId)
    this.addApp(l, { id: newId(), at: nowIso(), role: 'notice', text: '이제 손으로 편집할 수 있어요. 레이어를 골라 에펙처럼 다듬어 보세요.' })
  }

  /** the end of a turn that 편집 활성화 started: compare, fix once, then open the editor */
  private async tidyStep(l: Live, how: 'done' | 'stopped' | 'failed') {
    const id = l.projectId
    const state = this.tidy.get(id)
    if (!state || this.live.get(id) !== l) return
    // the designer sent a message after asking: that turn changes the video on purpose — no comparison
    if ((this.sent.get(id) ?? 0) !== this.tidyAt.get(id)) return this.markEditable(l)
    if (how !== 'done') {
      this.tidy.delete(id)
      return
    }
    const out = projects.state(id).brief.output
    const changedAt = await tidyAfter(l.dir, { width: out.width, height: out.height, duration: out.duration }).catch(() => [])
    if (!changedAt.length) return this.markEditable(l)
    if (state === 'asked') {
      this.tidy.set(id, 'fixing')
      const where = changedAt.slice(0, 4).map((c) => `- ${c.t}초: ${c.changedPct}% 달라짐${c.diff ? ` (빨간 곳: ${c.diff})` : ''}`)
      await this.deliver({ projectId: id, fromApp: true, text: '편집 정리 후 화면이 달라진 곳을 원래대로 돌려 주세요.', detail: ['편집 정리 전후로 같은 순간을 비교했더니 화면이 달라졌어요. 이름(data-ms-*)만 붙여야 해요:', ...where, '', '달라진 곳의 원인(새 id 때문에 감싸진 요소 등)을 찾아, 그 요소의 id를 빼거나 붙인 방식을 바꿔 원래 화면대로 돌려 주세요. 한 줄로만 답해요.'].join('\n') }).catch(() => this.markEditable(l))
      return
    }
    this.markEditable(l)
    this.addApp(l, { id: newId(), at: nowIso(), role: 'notice', text: '편집 정리 뒤에 화면이 조금 달라졌어요. 작업 이력에서 정리 전 버전으로 되돌릴 수 있어요.' })
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

  /** a message from the designer: a new request (the app's 편집 정리 may run again after it) */
  async send(input: SendMessageInput): Promise<void> {
    this.sent.set(input.projectId, (this.sent.get(input.projectId) ?? 0) + 1)
    return this.deliver(input)
  }

  private async deliver(input: SendMessageInput): Promise<void> {
    const { projectId } = input
    let l = this.live.get(projectId)
    if (!l || l.state.status === 'exited') {
      this.start(projectId)
      l = this.live.get(projectId)!
    }
    // the key can be used again (its retry time passed) or no longer: an idle session moves first (--resume keeps the conversation)
    if (!projectId.startsWith('__') && l.auth !== authMode() && l.state.status === 'ready' && !this.switching.has(projectId)) {
      this.restart(projectId)
      l = this.live.get(projectId)!
    }
    if (l.state.attention === 'trust') throw new Error('먼저 터미널에서 이 프로젝트 폴더를 신뢰한다고 선택해 주세요.')
    if (l.state.attention === 'login' && l.auth !== 'api') throw new Error('Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.')
    // wait for the input box after a cold start
    for (let i = 0; i < 60 && l.state.status === 'starting' && !l.state.attention; i++) await new Promise((r) => setTimeout(r, 250))
    // never type into a prompt (folder trust, login) or a session that is not up
    const now = this.state(projectId)
    if (now.attention === 'trust') throw new Error('먼저 터미널에서 이 프로젝트 폴더를 신뢰한다고 선택해 주세요.')
    if (now.attention === 'login') throw new Error(now.auth === 'api' ? 'API 키로 연결하지 못해서 Claude 구독으로 바꾸고 있어요. 잠시 뒤 다시 보내 주세요.' : 'Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.')
    if (now.status === 'starting') throw new Error('Claude가 아직 준비 중이에요. 잠시 뒤 다시 보내 주세요.')
    if (now.status === 'exited') throw new Error('Claude가 종료됐어요. 터미널의 "다시 시작"을 누른 뒤 보내 주세요.')
    // which of the designer's own layers this request lets Claude change (designerGuard.ts)
    try {
      const ov = projects.state(projectId).overrides
      const page = existsSync(join(l.dir, 'composition', 'index.html')) ? readFileSync(join(l.dir, 'composition', 'index.html'), 'utf8') : ''
      const lastAsk = this.transcript(projectId).filter((x) => x.role === 'assistant').pop()
      setApproval(projectId, input.approveAll ? { all: true, ids: new Set() } : approvalFor(input, designerLayers(ov, page), lastAsk?.role === 'assistant' ? lastAsk.text : undefined))
    } catch {
      setApproval(projectId, { all: false, ids: new Set() })
    }

    // storyboard materials the designer changed after approval go along with this message
    const sbNow = input.fromApp ? null : readStoryboard(l.dir)
    const sbChanged = sbNow?.changed?.length ? sbNow.changed : null
    const refs = (input.references ?? []).map((r) => ({ ...r, item: listReferences(l!.dir).find((x) => x.id === r.id) })).filter((r) => r.item)
    const oneLine = input.text.replace(/\s*\n\s*/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
    const rich = !!(input.marks?.length || input.annotatedFrame || input.attachments?.length || refs.length || input.detail || sbChanged) || input.text.includes('\n') || oneLine.length > 300
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
        ...(refs.length
          ? [
              '',
              '## 첨부 (참고로 볼지 영상에 쓸지는 대화로 정해요)',
              ...refs.map((r, i) => {
                const it = r.item!
                const what = it.kind === 'image' ? '이미지' : it.kind === 'youtube' ? '유튜브 영상(참고 전용)' : '영상'
                const len = it.meta?.duration ? ` ${it.meta.duration.toFixed(1)}초` : ''
                const range = r.range ? ` · 디자이너가 고른 구간 ${r.range.from.toFixed(1)}~${r.range.to.toFixed(1)}초` : ''
                const how = it.kind === 'image' ? `${it.file} (Read로 보기)` : `get_references / look_at_reference(id "${it.id}")로 보기`
                return `- 첨부 ${i + 1} · ${what} 「${it.title}」${len} (id ${it.id})${range} — ${how}${it.kind !== 'youtube' ? ' · 영상에 쓰려면 use_as_material' : ''}`
              }),
            ]
          : []),
        ...(sbChanged ? ['', '## 디자이너가 바꾼 콘티 소재', ...sbChanged.map((x) => `- ${x}`)] : []),
        ...(input.detail ? ['', input.detail] : []),
      ].join('\n')
      writeText(join(fb, `msg-${stamp}.md`), md)
      // what the chat shows: the designer's words and pictures (attached videos show their first frame)
      const shown = [...(input.attachments ?? []), ...refs.map((r) => r.item!.file ?? r.item!.frames?.[0]?.file).filter((x): x is string => !!x)]
      writeText(join(fb, `msg-${stamp}.json`), JSON.stringify({ text: input.text, marks: input.marks, frame, time: input.time, attachments: shown.length ? shown : undefined, fromApp: input.fromApp || undefined }))
      line = `[모션스튜디오 메시지] feedback/msg-${stamp}.md 파일을 Read 도구로 읽고 그 내용대로 진행해 주세요.`
    }
    if (!line) return
    // a line starting with / ! # would be a Claude Code command, not a message
    if (/^[/!#]/.test(line)) line = ` ${line}`
    // the session may have been restarted while we waited (model change): type into the current one
    const cur = this.live.get(projectId)
    if (!cur || cur.state.status === 'exited') throw new Error('Claude가 다시 연결되는 중이에요. 잠시 뒤 다시 보내 주세요.')
    // spend before this request belongs to the one before (the next turn end reads this one's)
    if (cur.auth === 'api') this.meterRead(cur)
    cur.term.write(line)
    await new Promise((r) => setTimeout(r, ENTER_DELAY))
    cur.term.write('\r')
    // told: the changes are not repeated with the next message (re-read: the designer may have assigned meanwhile)
    if (sbChanged) {
      const now = readStoryboard(l.dir)
      if (now) writeStoryboard(l.dir, { ...now, changed: now.changed?.filter((c) => !sbChanged.includes(c)) })
    }
  }

  /** Claude starts building what the designer approved (start_build): the card shows it, the editor opens */
  private buildStarted(projectId: string) {
    const l = this.live.get(projectId)
    const cur = readStoryboard(projects.pathOf(projectId))
    const item = cur && l?.appItems.find((x) => x.id === cur.itemId)
    if (l && item?.role === 'storyboard') this.updateApp(l, { ...item, status: 'approved' })
    if (cur) this.emit({ type: 'storyboard-changed', projectId, current: cur })
    this.emit({ type: 'build-started', projectId })
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
    // its exit is no longer heard (it is not the current session): a re-layout running here ends now
    // (unless the work only moves from the API key to the subscription and goes on)
    if (this.adapting.has(projectId) && !this.switching.has(projectId)) this.endAdaptation(projectId, 'error')
    if (!l) return
    l.tail.stop()
    this.meterRead(l)
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

