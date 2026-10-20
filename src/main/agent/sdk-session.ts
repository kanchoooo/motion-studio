// API 키 대화: the same Claude Code, run through the Claude Agent SDK. The API key's promotion credits
// cover the Agent SDK and the API, not the Claude Code terminal, so a session on the key runs here; the
// subscription keeps the terminal (pty-session.ts). Both write the same transcript, so a conversation
// moves between them by its session id.
//
// To pty-session this looks like the pseudo-terminal: write() types (a message goes at Enter, Escape
// stops the turn), onData() is a plain log for the terminal panel (its first line is the banner the
// session waits for), onExit() when the process ends. The chat itself still comes from the transcript.
import { readFileSync } from 'node:fs'
import { query, type EffortLevel, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

type Listener<T> = (e: T) => void
type Disposable = { dispose(): void }

/** what pty-session uses of a terminal (node-pty's IPty, or this) */
export interface Term {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: Listener<string>): Disposable
  onExit(cb: Listener<{ exitCode: number; signal?: number }>): Disposable
}

export interface SdkTermOptions {
  binary: string
  cwd: string
  sessionId: string
  resume: boolean
  name: string
  settings: Record<string, unknown>
  mcpConfig: string
  model: string
  effort: string
  tools: string[]
  pluginDir: string
  promptFile: string
  env: Record<string, string>
}

/** an API error Claude Code retries (a refused key keeps failing for minutes): pty-session moves the work on at once */
export interface ApiRetry {
  status: number | null
  error: string
  attempt: number
  max: number
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export class SdkTerm implements Term {
  private q: Query
  private dataCbs = new Set<Listener<string>>()
  private exitCbs = new Set<Listener<{ exitCode: number; signal?: number }>>()
  private retryCbs = new Set<Listener<ApiRetry>>()
  /** messages waiting for the process to take them */
  private queue: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private closed = false
  private line = ''
  /** what was printed before anyone listened (the banner can come first) */
  private early: string[] = []

  constructor(private o: SdkTermOptions) {
    const self = this
    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (!self.closed) {
        const next = self.queue.shift()
        if (next) {
          yield next
          continue
        }
        await new Promise<void>((r) => (self.wake = r))
        self.wake = null
      }
    }
    this.q = query({
      prompt: input(),
      options: {
        pathToClaudeCodeExecutable: o.binary,
        cwd: o.cwd,
        ...(o.resume ? { resume: o.sessionId } : { sessionId: o.sessionId }),
        settingSources: [],
        settings: o.settings as never,
        permissionMode: 'acceptEdits',
        tools: o.tools,
        plugins: [{ type: 'local', path: o.pluginDir }],
        additionalDirectories: [o.pluginDir],
        // Claude Code's own system prompt, the studio rules after it, rendered fresh each request (as in the terminal)
        systemPrompt: { type: 'preset', preset: 'claude_code', append: readFileSync(o.promptFile, 'utf8'), snapshot: false },
        model: o.model,
        ...(EFFORTS.includes(o.effort) ? { effort: o.effort as EffortLevel } : {}),
        promptSuggestions: false,
        env: { ...o.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'motion-studio' },
        // the studio server's per-call timeout is not part of the SDK's server type: the same flag as the terminal
        extraArgs: { 'mcp-config': o.mcpConfig, 'strict-mcp-config': null, name: o.name },
        stderr: () => {},
      },
    })
    void this.q
      .initializationResult()
      // the session is up: the banner pty-session waits for ("Claude Code v…")
      .then(() => this.print('Claude Code v2 (Agent SDK) · API 키로 대화해요\r\n'))
      .catch(() => {})
    void this.pump()
  }

  private async pump() {
    let code = 0
    try {
      for await (const m of this.q) this.show(m)
    } catch (e) {
      code = 1
      if (!this.closed) this.print(`⎿ ${e instanceof Error ? e.message : String(e)}\r\n`)
    }
    this.closed = true
    this.wake?.()
    for (const cb of this.exitCbs) cb({ exitCode: code })
  }

  /** what the terminal panel shows of a message */
  private show(m: SDKMessage) {
    if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) this.print(`⏺ ${b.text.trim().slice(0, 1200).replace(/\n/g, '\r\n  ')}\r\n`)
        else if (b.type === 'tool_use') this.print(`⏺ ${b.name}\r\n`)
      }
      if (m.error) this.print(`⎿ ${m.error}\r\n`)
    } else if (m.type === 'result') {
      this.print(`✻ ${m.subtype === 'success' ? '끝' : m.subtype} · 지금까지 $${m.total_cost_usd.toFixed(4)}\r\n`)
    } else if (m.type === 'system' && m.subtype === 'api_retry') {
      this.print(`⎿ API ${m.error_status ?? ''} ${m.error} · 다시 시도 ${m.attempt}/${m.max_retries}\r\n`)
      for (const cb of this.retryCbs) cb({ status: m.error_status, error: m.error, attempt: m.attempt, max: m.max_retries })
    } else if (m.type === 'system' && m.subtype === 'init') {
      this.print(`Claude Code v${m.claude_code_version} · ${m.model} · ${m.apiKeySource}\r\n`)
    }
  }

  private print(s: string) {
    if (!this.dataCbs.size) {
      this.early.push(s)
      return
    }
    for (const cb of this.dataCbs) cb(s)
  }

  /** typed text: a message goes at Enter; Escape / Ctrl-C stop the turn; Backspace takes a letter back */
  write(data: string) {
    if (this.closed) return
    for (const ch of data) {
      if (ch === '\x1b' || ch === '\x03') {
        this.line = ''
        void this.q.interrupt().catch(() => {})
      } else if (ch === '\r' || ch === '\n') {
        const text = this.line.trim()
        this.line = ''
        if (text) this.send(text)
      } else if (ch === '\x7f' || ch === '\b') this.line = this.line.slice(0, -1)
      else if (ch >= ' ') this.line += ch
    }
  }

  private send(text: string) {
    this.print(`❯ ${text}\r\n`)
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, origin: { kind: 'human' } } as SDKUserMessage)
    this.wake?.()
  }

  resize() {}

  kill() {
    if (this.closed) return
    this.closed = true
    this.wake?.()
    try {
      this.q.close()
    } catch {
      /* already gone */
    }
  }

  onData(cb: Listener<string>): Disposable {
    this.dataCbs.add(cb)
    for (const s of this.early.splice(0)) cb(s)
    return { dispose: () => this.dataCbs.delete(cb) }
  }

  onExit(cb: Listener<{ exitCode: number; signal?: number }>): Disposable {
    this.exitCbs.add(cb)
    return { dispose: () => this.exitCbs.delete(cb) }
  }

  /** Claude Code retries an API error (pty-session reads a refused key from it) */
  onApiRetry(cb: Listener<ApiRetry>): Disposable {
    this.retryCbs.add(cb)
    return { dispose: () => this.retryCbs.delete(cb) }
  }
}
