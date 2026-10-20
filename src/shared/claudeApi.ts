// 사용자 Claude API 키: what the app and the chat show, the list prices the cost estimate uses, and
// the API failures after which the work goes on with the Claude subscription (Claude Code login).

export type ClaudeAuthMode = 'api' | 'subscription'
/** credit: prepaid credits ran out · limit: the spend limit set in the Console · auth: the key no longer works · rate: too many requests */
export type ApiFailureReason = 'credit' | 'limit' | 'auth' | 'rate'

export interface ClaudeAuthStatus {
  hasKey: boolean
  /** the key's last characters (to tell keys apart; the key itself never leaves the main process) */
  hint?: string
  savedAt?: string
  /** use the API key first; the subscription takes over when it stops working */
  enabled: boolean
  /** what Claude sessions started now use */
  using: ClaudeAuthMode
  /** the API key stopped working: the subscription is used (until retryAt, or until the designer tries again) */
  fallback?: { at: string; reason: ApiFailureReason; detail?: string; retryAt?: string }
  /** this computer's API spend this month (estimate at list price) */
  month: { key: string; usd: number }
  /** a balance the designer read in the Console, and what this computer spent since */
  balance?: { usd: number; at: string; spentSince: number }
}

/** the API spend shown in the chat (estimates at list price) */
export interface ApiCostInfo {
  projectId: string
  /** the last finished request */
  turn: number
  /** this project so far */
  project: number
  /** this computer, this month */
  month: number
  at: string
}

/** list prices in $ per million tokens: input, output, cache read, cache write (5 min), cache write (1 h) */
type Price = [number, number, number, number, number]
const PRICES: [RegExp, Price][] = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25, 12.5, 20]],
  [/fable|mythos/, [10, 50, 1, 12.5, 20]],
  [/opus-5-5/, [4, 20, 0.2, 5, 8]],
  [/opus-5/, [5, 25, 0.5, 6.25, 10]],
  [/opus-4-[5-9]/, [5, 25, 0.5, 6.25, 10]],
  [/opus-4|opus-3/, [15, 75, 1.5, 18.75, 30]],
  [/sonnet-5/, [2, 10, 0.2, 2.5, 4]],
  [/sonnet/, [3, 15, 0.3, 3.75, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.125, 0.2]],
  [/haiku-4/, [1, 5, 0.1, 1.25, 2]],
  [/haiku/, [0.8, 4, 0.08, 1, 1.6]],
]
/** a model the table does not know yet is priced like the current Opus (the app's default model) */
const UNKNOWN: Price = [4, 20, 0.2, 5, 8]
/** Haiku 5.5 above 100K prompt tokens */
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 0.625, 1]
const WEB_SEARCH = 0.01

export interface UsageRecord {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  server_tool_use?: { web_search_requests?: number }
  speed?: string
}

/** one API response's cost in $ (list price) */
export function costOfUsage(model: string | undefined, u: UsageRecord): number {
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0)
  const input = n(u.input_tokens)
  const read = n(u.cache_read_input_tokens)
  const w1 = n(u.cache_creation?.ephemeral_1h_input_tokens)
  // older records only have the total written: counted as 5-minute writes (the API key's default)
  const w5 = u.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens)
  const m = model ?? ''
  let p = PRICES.find(([re]) => re.test(m))?.[1] ?? UNKNOWN
  if (/haiku-5-5/.test(m) && input + read + w5 + w1 > 100_000) p = HAIKU_LONG
  const tokens = (input * p[0] + n(u.output_tokens) * p[1] + read * p[2] + w5 * p[3] + w1 * p[4]) / 1e6
  return tokens * (u.speed === 'fast' ? 2 : 1) + n(u.server_tool_use?.web_search_requests) * WEB_SEARCH
}

/**
 * An API error that means the key cannot go on (and the subscription should take over). error: the
 * StopFailure hook's error type when known. Errors that are the same on both (overloaded, a server
 * error, a too-long request) are not one: switching would not help.
 */
export function apiFailure(text: string, error?: string, now = Date.now()): { reason: ApiFailureReason; retryAt?: string } | null {
  const t = text ?? ''
  if (error === 'billing_error' || /credit balance|purchase credits|insufficient[_ ]credits?/i.test(t)) return { reason: 'credit' }
  // "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."
  // (only the API's own wording: the subscription's "monthly spend limit" for usage credits is not the key's)
  if (/API usage limits?|regain access on/i.test(t)) {
    const d = t.match(/regain access on (\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{1,2}:\d{2}))?/i)
    const at = d ? Date.parse(`${d[1]}T${(d[2] ?? '00:00').padStart(5, '0')}:00Z`) : NaN
    return { reason: 'limit', retryAt: isFinite(at) ? new Date(at).toISOString() : undefined }
  }
  if (error === 'authentication_failed' || /invalid x-api-key|authentication_error|invalid api key|permission_error|api key (is |has been )?(disabled|revoked)|apiKeyHelper/i.test(t)) return { reason: 'auth' }
  if (error === 'rate_limit' || /rate_limit_error|rate limit|\b429\b/i.test(t)) return { reason: 'rate', retryAt: new Date(now + 15 * 60_000).toISOString() }
  return null
}

/** what the chat says when the work moves to the subscription */
export const FAILURE_TEXT: Record<ApiFailureReason, string> = {
  credit: 'API 키의 크레딧이 다 떨어졌어요',
  limit: 'API 키가 Console에서 정한 사용 한도에 닿았어요',
  auth: 'API 키를 쓸 수 없어요 (지워졌거나 바뀐 키)',
  rate: 'API 키 요청이 한꺼번에 너무 많아 잠시 막혔어요',
}

/** "$0.84", "$12.40", small amounts with more digits */
export function usd(v: number): string {
  if (!isFinite(v) || v <= 0) return '$0'
  return v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`
}
