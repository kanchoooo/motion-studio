// 관제용 판 only (tools.ts reaches this behind __MS_CONSOLE__, so the regular builds never contain it):
// how the Instagram Reels of the console's account performed, read from the console on this Mac, for
// Claude to plan new reels from what worked. The console writes where to ask into console.json:
//   "insta": { "url": "http://127.0.0.1:7800/…", "token": "…" }   (read-only; nothing is sent back)
import { existsSync, readFileSync } from 'node:fs'
import { consoleFile } from './console'

export interface ReelsReport {
  at?: string
  account?: Record<string, unknown>
  reels: Record<string, unknown>[]
}

function source(): { url: string; token?: string } | null {
  try {
    if (!existsSync(consoleFile())) return null
    const raw = JSON.parse(readFileSync(consoleFile(), 'utf8')) as { insta?: { url?: unknown; token?: unknown } }
    const url = typeof raw.insta?.url === 'string' ? raw.insta.url : ''
    // the console runs on this Mac: only a local address is asked
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) return null
    return { url, token: typeof raw.insta?.token === 'string' ? raw.insta.token : undefined }
  } catch {
    return null
  }
}

export const reelsConfigured = () => !!source()

let cache: { at: number; key: string; data: ReelsReport } | null = null

/** the latest reels with their numbers (cached five minutes) */
export async function reelsPerformance(limit = 20): Promise<ReelsReport> {
  const src = source()
  if (!src) throw new Error('관제에서 인스타 릴스 연결이 설정되지 않았어요.')
  const key = `${src.url}|${limit}`
  if (cache && cache.key === key && Date.now() - cache.at < 5 * 60_000) return cache.data
  const u = new URL(src.url)
  u.searchParams.set('limit', String(limit))
  const res = await fetch(u, { headers: src.token ? { 'X-Console-Token': src.token } : {}, signal: AbortSignal.timeout(20_000) }).catch(() => null)
  if (!res) throw new Error('관제에 연결하지 못했어요. 관제가 켜져 있는지 확인해 주세요.')
  if (!res.ok) throw new Error(`관제가 릴스 성과를 주지 못했어요 (응답 ${res.status}).`)
  const body = (await res.json()) as Partial<ReelsReport>
  const data: ReelsReport = { at: body.at, account: body.account, reels: Array.isArray(body.reels) ? body.reels.slice(0, limit) : [] }
  cache = { at: Date.now(), key, data }
  return data
}
