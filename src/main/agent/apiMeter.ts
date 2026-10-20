// What one Claude process spent on the API key: the responses Claude Code wrote to the session's
// transcripts (the conversation and its subagents) while it ran, priced at list price. Each file is
// read from where the last look stopped, so a response counts once; what the transcripts held before
// the process started is history and never counted. An estimate — the bill is in the Console.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { costOfUsage, type UsageRecord } from '@shared/claudeApi'
import { findTranscript } from './transcript'

export class ApiMeter {
  /** file → bytes already read, and the unfinished last line */
  private files = new Map<string, { offset: number; partial: string }>()
  /** responses already counted (one response is written as several lines) */
  private seen = new Set<string>()
  /** $ counted so far */
  total = 0

  /** api: the process runs on the API key (a subscription process counts nothing) */
  constructor(
    private sessionId: string,
    readonly api: boolean,
  ) {}

  /** the transcripts: the conversation and its subagents' */
  private paths(): string[] {
    const main = findTranscript(this.sessionId)
    if (!main) return []
    const subs = join(dirname(main), this.sessionId, 'subagents')
    try {
      return [main, ...(existsSync(subs) ? readdirSync(subs).filter((f) => f.endsWith('.jsonl')).map((f) => join(subs, f)) : [])]
    } catch {
      return [main]
    }
  }

  /** before the process starts: what is in the transcripts now is history */
  begin() {
    for (const f of this.paths()) {
      try {
        this.files.set(f, { offset: statSync(f).size, partial: '' })
      } catch {
        /* gone */
      }
    }
  }

  /** reads what was written since the last look; returns the $ it added */
  read(): number {
    if (!this.api) return 0
    let added = 0
    for (const f of this.paths()) {
      let size = 0
      try {
        size = statSync(f).size
      } catch {
        continue
      }
      // a file that appeared since the start was written by this process
      let st = this.files.get(f) ?? { offset: 0, partial: '' }
      if (size < st.offset) st = { offset: 0, partial: '' }
      if (size === st.offset) {
        this.files.set(f, st)
        continue
      }
      const fd = openSync(f, 'r')
      const buf = Buffer.alloc(size - st.offset)
      try {
        readSync(fd, buf, 0, buf.length, st.offset)
      } finally {
        closeSync(fd)
      }
      const lines = (st.partial + buf.toString('utf8')).split('\n')
      this.files.set(f, { offset: size, partial: lines.pop() ?? '' })
      for (const line of lines) {
        if (!line.includes('"usage"')) continue
        try {
          const r = JSON.parse(line) as { type?: string; requestId?: string; message?: { id?: string; model?: string; usage?: UsageRecord } }
          const u = r.message?.usage
          if (r.type !== 'assistant' || !u || r.message?.model === '<synthetic>') continue
          const id = `${r.message?.id ?? ''}|${r.requestId ?? ''}`
          if (this.seen.has(id)) continue
          this.seen.add(id)
          added += costOfUsage(r.message?.model, u)
        } catch {
          /* a broken line */
        }
      }
    }
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000))
    this.total += added
    return added
  }
}
