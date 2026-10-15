// The Claude plan's limits, as Claude Code itself reports them: `claude -p /usage` with the
// designer's own login (the same reading the 관제센터 dashboard uses). The app never touches
// Claude credentials; it only reads the lines Claude Code prints.
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeUsage } from '@shared/ai'
import { claudeEnv } from './claude-env'
import { claudeBinary } from './doctor'
import { dataDir } from './paths'

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "Oct 15 at 11:39pm (Asia/Seoul)" → "10/15 오후 11:39" */
export function koreanReset(s: string): string {
  const m = s.match(/([A-Za-z]{3})\w*\s+(\d{1,2})(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i)
  if (!m) return s.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const date = `${MONTHS[m[1].toLowerCase()] ?? m[1]}/${m[2]}`
  if (!m[3]) return date
  return `${date} ${m[5].toLowerCase() === 'pm' ? '오후' : '오전'} ${m[3]}:${m[4] ?? '00'}`
}

/** the lines of `/usage` → numbers */
export function parseUsage(text: string): Omit<ClaudeUsage, 'at'> {
  const out: Omit<ClaudeUsage, 'at'> = { models: [] }
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^Current (session|week)(?: \(([^)]+)\))?:\s*(\d+)%[^·]*(?:·\s*resets\s+(.+))?$/i)
    if (!m) continue
    const v = { pct: Number(m[3]), resets: m[4] ? koreanReset(m[4]) : undefined }
    if (/session/i.test(m[1])) out.session = v
    else if (!m[2] || /all models/i.test(m[2])) out.week = v
    else out.models.push({ name: m[2], ...v })
  }
  return out
}

let cache: ClaudeUsage | null = null
let running: Promise<ClaudeUsage | null> | null = null

/** the plan's limits (cached for three minutes; force asks again) */
export function claudeUsage(force = false): Promise<ClaudeUsage | null> {
  if (!force && cache && Date.now() - cache.at < 3 * 60_000) return Promise.resolve(cache)
  if (running) return running
  const cwd = join(dataDir(), 'usage')
  mkdirSync(cwd, { recursive: true })
  running = new Promise<ClaudeUsage | null>((resolve) => {
    execFile(claudeBinary(), ['-p', '/usage', '--setting-sources', '', '--strict-mcp-config', '--tools', ''], { cwd, env: claudeEnv(), timeout: 120_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const parsed = parseUsage(String(stdout ?? ''))
      if (err && !parsed.session && !parsed.week) return resolve(cache)
      cache = { ...parsed, at: Date.now() }
      resolve(cache)
    })
  }).finally(() => (running = null))
  return running
}
