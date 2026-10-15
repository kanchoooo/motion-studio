// Follows Claude Code's session transcript (~/.claude/projects/<slug>/<sid>.jsonl)
// and turns it into designer-facing chat items. Because the transcript is the
// source of truth, messages typed in the terminal or sent from a phone via
// Remote Control show up in the chat too.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatItem } from '@shared/api'
import { STUDIO_TOOL_LABELS } from './tools'

type Rec = {
  type?: string
  uuid?: string
  timestamp?: string
  isMeta?: boolean
  promptId?: string
  toolUseResult?: unknown
  bridgeSessionId?: string
  /** Claude Code writes a synthetic assistant line when the API call failed (overloaded, usage limit…) */
  isApiErrorMessage?: boolean
  /** the summary a compaction leaves (not something the designer typed) */
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  /** queue-operation records: a message typed while Claude was working */
  operation?: string
  content?: unknown
  attachment?: { type?: string; prompt?: unknown; origin?: { kind?: string } }
  message?: {
    id?: string
    role?: string
    stop_reason?: string | null
    content?: string | { type: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: Record<string, unknown>; content?: unknown }[]
  }
}

export interface TranscriptEvents {
  item(item: ChatItem): void
  update(item: ChatItem): void
  busy(busy: boolean): void
  /** how the turn ended: done (Claude finished), stopped (designer pressed 멈추기), failed (API error) */
  turnEnd(lastText: string, how: 'done' | 'stopped' | 'failed'): void
  remoteUrl(url: string): void
}

/** "[모션스튜디오 메시지] feedback/msg-123.md ..." → feedback/msg-123 */
export const MESSAGE_FILE_RE = /\[모션스튜디오 메시지\]\s+(feedback\/msg-[\w-]+)\.md/

export function claudeProjectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
}

export function findTranscript(sessionId: string): string | null {
  const root = claudeProjectsDir()
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  for (const d of dirs) {
    const f = join(root, d, `${sessionId}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

const HANGUL = /[\uac00-\ud7a3]/

export class TranscriptTail {
  private file: string | null = null
  private offset = 0
  private partial = ''
  private timer: NodeJS.Timeout | null = null
  private status = new Map<string, Extract<ChatItem, { role: 'status' }>>()
  private lastText = ''
  private busyNow = false
  readonly items: ChatItem[] = []

  constructor(
    private sessionId: string,
    private projectDir: string,
    private ev: TranscriptEvents,
  ) {}

  start() {
    this.poll(true)
    // helpers started by an earlier run of Claude Code are gone with that process
    this.background.clear()
    this.timer = setInterval(() => this.poll(false), 600)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.cancelEnd()
    if (this.bgTimer) clearTimeout(this.bgTimer)
  }

  get busy() {
    return this.busyNow
  }

  /** a turn end waits a moment: a Stop hook may send Claude back to work (the turn goes on) */
  private endTimer: NodeJS.Timeout | null = null
  private heldAt = 0

  private endHow: 'done' | 'failed' = 'done'

  private endSoon(how: 'done' | 'failed') {
    this.cancelEnd()
    this.endHow = how
    this.endTimer = setTimeout(() => this.finishTurn(), how === 'failed' ? 0 : 2500)
  }

  /** background work Claude started (run_in_background agents / commands) that has not reported back yet */
  private background = new Set<string>()
  private doneTasks = new Set<string>()
  private bgTimer: NodeJS.Timeout | null = null

  private finishTurn() {
    this.endTimer = null
    // the stop gate said "go on" before this end showed up in the transcript: this end is not the end
    if (this.heldAt && Date.now() - this.heldAt < 20_000) {
      this.heldAt = 0
      return
    }
    // Claude ended its turn to wait for a helper running in the background: it goes on when that reports back
    // (a helper that never reports back does not keep the project busy for good)
    if (this.background.size) {
      if (!this.bgTimer)
        this.bgTimer = setTimeout(() => {
          this.bgTimer = null
          this.background.clear()
          if (!this.endTimer) this.finishTurn()
        }, 45 * 60_000)
      return
    }
    this.setBusy(false)
    this.ev.turnEnd(this.lastText, this.endHow)
  }

  private cancelEnd() {
    if (this.endTimer) clearTimeout(this.endTimer)
    this.endTimer = null
  }

  /** the stop gate sent Claude back: this turn's end (already seen, or about to be) is not the end */
  hold() {
    if (this.endTimer) this.cancelEnd()
    // the end record has not been read yet; when the turn already ended, the next end is a real one
    else if (this.busyNow) this.heldAt = Date.now()
    this.setBusy(true)
  }

  private setBusy(b: boolean) {
    if (b === this.busyNow) return
    this.busyNow = b
    this.ev.busy(b)
  }

  private poll(initial: boolean) {
    if (!this.file) this.file = findTranscript(this.sessionId)
    if (!this.file) return
    let size = 0
    try {
      size = statSync(this.file).size
    } catch {
      return
    }
    if (size < this.offset) {
      this.offset = 0
      this.partial = ''
    }
    if (size === this.offset) return
    const fd = openSync(this.file, 'r')
    const buf = Buffer.alloc(size - this.offset)
    readSync(fd, buf, 0, buf.length, this.offset)
    closeSync(fd)
    this.offset = size
    const text = this.partial + buf.toString('utf8')
    const lines = text.split('\n')
    this.partial = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.consume(JSON.parse(line) as Rec, initial)
      } catch {
        /* skip malformed */
      }
    }
  }

  private emitItem(item: ChatItem, initial: boolean) {
    this.items.push(item)
    if (!initial) this.ev.item(item)
  }

  private userText(r: Rec): string | null {
    const c = r.message?.content
    let t: string | null = null
    if (typeof c === 'string') t = c
    else if (Array.isArray(c) && c.every((b) => b.type === 'text' || b.type === 'image')) t = c.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
    if (t == null) return null
    t = t.trim()
    // slash-command echoes, local command output, hook/system injections
    if (!t || t.startsWith('<') || t.startsWith('Caveat:')) return null
    return t
  }

  /** messages typed while Claude was busy, by text, until Claude takes them */
  private queued = new Map<string, ChatItem>()
  /** delivered queued messages (text → time): a later copy of the same line is not shown twice */
  private delivered = new Map<string, number>()

  /** marks a queued message as delivered; true if it was shown already */
  private takeQueued(text: string, initial: boolean, at = Date.now()): boolean {
    const item = this.queued.get(text)
    if (!item) {
      // a second copy of a delivered line (Claude Code repeats some records) is skipped once
      const t = this.delivered.get(text)
      if (t == null || Math.abs(at - t) > 10 * 60_000) return false
      this.delivered.delete(text)
      return true
    }
    this.delivered.set(text, at)
    this.queued.delete(text)
    const done = { ...item, queued: false } as ChatItem
    const i = this.items.findIndex((x) => x.id === item.id)
    if (i >= 0) this.items[i] = done
    if (!initial) this.ev.update(done)
    return true
  }

  /** a user line, resolving app messages ([모션스튜디오 메시지] feedback/msg-….md) to what the designer typed */
  private userItem(id: string, at: string, t: string): ChatItem {
    const m = t.match(MESSAGE_FILE_RE)
    if (!m) return { id, at, role: 'user', text: t }
    try {
      const data = JSON.parse(readFileSync(join(this.projectDir, `${m[1]}.json`), 'utf8')) as { text: string; marks?: never[]; frame?: string; time?: number; attachments?: string[]; fromApp?: boolean }
      return { id, at, role: 'user', text: data.text, marks: data.marks, frame: data.frame, time: data.time, attachments: data.attachments, fromApp: data.fromApp }
    } catch {
      return { id, at, role: 'user', text: '(첨부된 메시지)' }
    }
  }

  private consume(r: Rec, initial: boolean) {
    if (r.type === 'bridge-session' && r.bridgeSessionId) {
      this.ev.remoteUrl(`https://claude.ai/code/session_${r.bridgeSessionId.replace(/^cse_/, '')}`)
      return
    }
    const at = r.timestamp ?? new Date().toISOString()
    // anything after a turn end means the turn went on (a Stop hook sent Claude back)
    if (!initial && this.endTimer && (r.type === 'assistant' || (r.type === 'user' && r.isMeta))) {
      this.cancelEnd()
      this.heldAt = 0
    }
    if (!initial && this.bgTimer && r.type === 'assistant') {
      clearTimeout(this.bgTimer)
      this.bgTimer = null
    }
    if (r.type === 'user' && (r.isCompactSummary || r.isVisibleInTranscriptOnly)) {
      this.emitItem({ id: r.uuid ?? at, at, role: 'notice', text: '대화가 길어져서 앞부분을 요약했어요. 작업은 그대로 이어져요.' }, initial)
      return
    }
    if (r.type === 'user' && !r.isMeta) {
      const c = r.message?.content
      if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
        for (const b of c) {
          // a helper started in the background (subagents are by default) answers with its id: the work goes
          // on after this turn ends, until its notification comes back
          if (b.type === 'tool_result') {
            const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
            if (/Async agent launched|working in the background|running in background/i.test(txt)) {
              const id = txt.match(/agentId:\s*([\w-]+)/)?.[1] ?? txt.match(/with ID:\s*([\w-]+)/)?.[1]
              if (id && !this.doneTasks.has(id)) this.background.add(id)
            }
          }
          const s = b.tool_use_id ? this.status.get(b.tool_use_id) : undefined
          if (s && !s.done) {
            s.done = true
            if (!initial) this.ev.update({ ...s })
          }
        }
        return
      }
      const t = this.userText(r)
      if (t == null) return
      if (/^\[Request interrupted by user/.test(t)) {
        this.cancelEnd()
        this.heldAt = 0
        this.background.clear()
        this.closeStatuses(initial)
        this.emitItem({ id: r.uuid ?? at, at, role: 'notice', text: '작업을 멈췄어요.' }, initial)
        if (!initial) {
          this.setBusy(false)
          // a stopped turn still ends: history, pending model change and the variation queue move on
          this.ev.turnEnd(this.lastText, 'stopped')
        }
        return
      }
      // a new message right after a turn end (one queued while Claude worked): that turn is over
      if (this.endTimer) {
        clearTimeout(this.endTimer)
        this.finishTurn()
      }
      this.heldAt = 0
      // the designer's next message: nothing from the previous turn is still awaited
      this.background.clear()
      // already shown when it was queued
      if (!this.takeQueued(t, initial, Date.parse(at))) this.emitItem(this.userItem(r.uuid ?? at, at, t), initial)
      if (!initial) this.setBusy(true)
      return
    }
    // a helper that ran in the background reported back
    if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string' && r.content.trimStart().startsWith('<task-notification>')) {
      const id = r.content.match(/<task-id>([^<]+)<\/task-id>/)?.[1]
      if (id && /<status>(completed|failed|killed|stopped|error)/.test(r.content)) {
        this.doneTasks.add(id)
        this.background.delete(id)
      }
      return
    }
    // a message typed while Claude was working: shown at once, marked as waiting
    if (r.type === 'queue-operation' && r.operation === 'enqueue' && typeof r.content === 'string') {
      const t = r.content.trim()
      if (!t || t.startsWith('<')) return
      const item = { ...this.userItem(`q-${at}`, at, t), queued: true } as ChatItem
      this.queued.set(t, item)
      this.emitItem(item, initial)
      return
    }
    // …and handed to Claude in the middle of its turn
    if (r.type === 'attachment' && r.attachment?.type === 'queued_command' && r.attachment.origin?.kind === 'human' && typeof r.attachment.prompt === 'string') {
      const t = r.attachment.prompt.trim()
      if (!t || t.startsWith('<')) return
      if (!this.takeQueued(t, initial, Date.parse(at))) {
        this.delivered.set(t, Date.parse(at))
        this.emitItem(this.userItem(`a-${r.uuid ?? at}`, at, t), initial)
      }
      return
    }
    if (r.type === 'assistant' && r.message) {
      const content = Array.isArray(r.message.content) ? r.message.content : []
      // API failures (overloaded, usage limit, network) end the turn too, or the app would wait forever
      const failed = !!r.isApiErrorMessage
      // synthetic lines without an error ("No response requested." after a stop) are not shown
      const synthetic = (r.message as { model?: string }).model === '<synthetic>'
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim() && !failed && !synthetic) {
          // a short note that slipped out in English is shown as a plain progress line (the designer reads Korean);
          // a final reply is always shown
          if (!HANGUL.test(b.text) && b.text.length < 400 && r.message.stop_reason !== 'end_turn') {
            this.emitItem({ id: `${r.uuid}-t`, at, role: 'status', text: '작업을 다듬고 있어요', done: true }, initial)
            continue
          }
          this.lastText = b.text
          this.emitItem({ id: `${r.uuid}-t`, at, role: 'assistant', text: b.text }, initial)
        } else if (b.type === 'tool_use' && b.id) {
          // a helper stopped on purpose never reports back
          if (/^(TaskStop|KillShell|KillBash)$/.test(b.name ?? '')) {
            const id = b.input?.task_id ?? b.input?.shell_id ?? b.input?.bash_id ?? b.input?.id
            if (typeof id === 'string') this.background.delete(id)
          }
          const label = STUDIO_TOOL_LABELS[b.name ?? ''] ?? (b.name?.startsWith('mcp__artlist') ? '아트리스트에서 찾고 있어요' : '작업하고 있어요')
          const item: Extract<ChatItem, { role: 'status' }> = { id: b.id, at, role: 'status', text: label, done: initial }
          this.status.set(b.id, item)
          this.emitItem(item, initial)
        }
      }
      const ended = r.message.stop_reason === 'end_turn' || r.message.stop_reason === 'refusal' || failed
      if (failed) {
        const said = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
        const limit = /limit|usage|quota/i.test(said)
        this.emitItem({ id: `${r.uuid}-e`, at, role: 'error', text: limit ? 'Claude 사용량 한도에 도달했어요. 터미널에 표시된 시간 이후에 다시 보내 주세요.' : 'Claude가 응답하지 못했어요. 잠시 뒤 다시 보내 주세요.', detail: said.slice(0, 400) || undefined }, initial)
      }
      if (!initial && !ended) this.setBusy(true)
      if (ended) {
        this.closeStatuses(initial)
        if (!initial) this.endSoon(failed ? 'failed' : 'done')
      }
    }
  }

  private closeStatuses(initial: boolean) {
    for (const s of this.status.values()) {
      if (!s.done) {
        s.done = true
        if (!initial) this.ev.update({ ...s })
      }
    }
  }
}
