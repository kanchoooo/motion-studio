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
  message?: {
    id?: string
    role?: string
    stop_reason?: string | null
    content?: string | { type: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: Record<string, unknown> }[]
  }
}

export interface TranscriptEvents {
  item(item: ChatItem): void
  update(item: ChatItem): void
  busy(busy: boolean): void
  turnEnd(lastText: string): void
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
    this.timer = setInterval(() => this.poll(false), 600)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get busy() {
    return this.busyNow
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

  private consume(r: Rec, initial: boolean) {
    if (r.type === 'bridge-session' && r.bridgeSessionId) {
      this.ev.remoteUrl(`https://claude.ai/code/session_${r.bridgeSessionId.replace(/^cse_/, '')}`)
      return
    }
    const at = r.timestamp ?? new Date().toISOString()
    if (r.type === 'user' && !r.isMeta) {
      const c = r.message?.content
      if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
        for (const b of c) {
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
        this.closeStatuses(initial)
        this.setBusy(false)
        this.emitItem({ id: r.uuid ?? at, at, role: 'notice', text: '작업을 멈췄어요.' }, initial)
        return
      }
      const m = t.match(MESSAGE_FILE_RE)
      let item: ChatItem = { id: r.uuid ?? at, at, role: 'user', text: t }
      if (m) {
        const side = join(this.projectDir, `${m[1]}.json`)
        try {
          const data = JSON.parse(readFileSync(side, 'utf8')) as { text: string; marks?: never[]; frame?: string; time?: number }
          item = { id: r.uuid ?? at, at, role: 'user', text: data.text, marks: data.marks, frame: data.frame, time: data.time }
        } catch {
          item = { id: r.uuid ?? at, at, role: 'user', text: '(첨부된 메시지)' }
        }
      }
      this.emitItem(item, initial)
      if (!initial) this.setBusy(true)
      return
    }
    if (r.type === 'assistant' && r.message) {
      const content = Array.isArray(r.message.content) ? r.message.content : []
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) {
          this.lastText = b.text
          this.emitItem({ id: `${r.uuid}-t`, at, role: 'assistant', text: b.text }, initial)
        } else if (b.type === 'tool_use' && b.id) {
          const label = STUDIO_TOOL_LABELS[b.name ?? ''] ?? '작업하고 있어요'
          const item: Extract<ChatItem, { role: 'status' }> = { id: b.id, at, role: 'status', text: label, done: initial }
          this.status.set(b.id, item)
          this.emitItem(item, initial)
        }
      }
      if (!initial && r.message.stop_reason !== 'end_turn') this.setBusy(true)
      if (r.message.stop_reason === 'end_turn') {
        this.closeStatuses(initial)
        if (!initial) {
          this.setBusy(false)
          this.ev.turnEnd(this.lastText)
        }
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
