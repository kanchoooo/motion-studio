// 사용자 Claude API 키 (e.g. API credits from a promotion): Claude sessions run on the key first, and
// when it stops working (credits gone, the Console's spend limit, a removed key) the work goes on with
// the Claude subscription — Claude Code's own login, which the app never touches.
//
// How the key reaches Claude Code: the session's settings carry an apiKeyHelper command that asks the
// app for it (a per-run secret in the address). It is never put in the environment (Claude's commands
// would inherit it) and Claude Code shows no "use this API key?" question for a helper. Sessions on the
// subscription get no helper at all (a helper outranks the login).
//
// Stored like the other service tokens (ai/accounts.ts): one file in the app data folder readable only
// by the user, DPAPI-sealed on Windows; the macOS keychain is deliberately not used.
import { chmodSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { ApiFailureReason, ClaudeAuthMode, ClaudeAuthStatus } from '@shared/claudeApi'
import { dataDir } from './paths'
import { nowIso, readJson, writeJson } from './util'

interface StoreFile {
  version: 1
  key?: string
  /** Windows: the key sealed with DPAPI */
  sealed?: string
  hint?: string
  savedAt?: string
  enabled: boolean
  fallback?: { at: string; reason: ApiFailureReason; detail?: string; retryAt?: string }
  balance?: { usd: number; at: string }
}

interface Ledger {
  /** 'YYYY-MM' → $ */
  months: Record<string, number>
  /** spent since the balance was entered */
  sinceBalance: number
}

const file = () => join(dataDir(), 'claude-api.json')
const ledgerFile = () => join(dataDir(), 'claude-api-usage.json')
const useDpapi = () => process.platform === 'win32' && safeStorage.isEncryptionAvailable()
/** tests point the key check and the sessions at a stand-in server (never set in a real install) */
export const apiBase = () => process.env.MS_TEST_ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

function load(): StoreFile {
  const raw = readJson<StoreFile>(file(), { version: 1, enabled: true })
  if (raw.sealed && useDpapi()) {
    try {
      raw.key = safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))
    } catch {
      raw.key = undefined
    }
  }
  delete raw.sealed
  return { ...raw, enabled: raw.enabled !== false }
}

function save(s: StoreFile) {
  const out: StoreFile = { ...s }
  if (s.key && useDpapi()) {
    out.sealed = safeStorage.encryptString(s.key).toString('base64')
    delete out.key
  }
  writeJson(file(), out)
  try {
    if (existsSync(file())) chmodSync(file(), 0o600)
  } catch {
    /* Windows: ACLs already limit the profile folder */
  }
}

const listeners = new Set<() => void>()
/** the mode or the key changed: sessions on the other one restart (pty-session) */
export function onAuthChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const changed = () => listeners.forEach((cb) => cb())

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function ledger(): Ledger {
  const l = readJson<Partial<Ledger>>(ledgerFile(), {})
  return { months: l.months ?? {}, sinceBalance: l.sinceBalance ?? 0 }
}

/** API spend on this computer (estimate): added as the meters read the transcripts */
export function addSpend(usd: number) {
  if (!(usd > 0)) return
  const l = ledger()
  const k = monthKey()
  l.months[k] = (l.months[k] ?? 0) + usd
  l.sinceBalance += usd
  writeJson(ledgerFile(), l)
}

/** a fallback whose retry time passed no longer holds */
function activeFallback(s: StoreFile, now = Date.now()) {
  const f = s.fallback
  if (!f) return undefined
  if (f.retryAt && Date.parse(f.retryAt) <= now) return undefined
  return f
}

export function apiKey(): string | null {
  return load().key ?? null
}

/** what new Claude sessions use */
export function authMode(): ClaudeAuthMode {
  const s = load()
  return s.key && s.enabled && !activeFallback(s) ? 'api' : 'subscription'
}

export function authStatus(): ClaudeAuthStatus {
  const s = load()
  const l = ledger()
  const k = monthKey()
  return {
    hasKey: !!s.key,
    hint: s.key ? s.hint : undefined,
    savedAt: s.key ? s.savedAt : undefined,
    enabled: s.enabled,
    using: authMode(),
    fallback: s.key ? activeFallback(s) : undefined,
    month: { key: k, usd: l.months[k] ?? 0 },
    balance: s.balance ? { ...s.balance, spentSince: l.sinceBalance } : undefined,
  }
}

/** the key looks like a Console API key (sk-ant-api03-…) */
export const keyShape = (k: string) => /^sk-ant-[a-z]+\d*-[\w-]{20,}$/i.test(k)

/** asks the API whether the key works (lists models: no tokens, nothing charged) */
export async function checkKey(key: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Anthropic에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
  if (res.ok) return
  if (res.status === 401) throw new Error('키가 맞지 않아요. Console에서 만든 키를 그대로 붙여넣어 주세요.')
  if (res.status === 403) throw new Error('이 키로는 Claude를 쓸 수 없어요 (권한이 없는 키).')
  throw new Error(`키를 확인하지 못했어요 (응답 ${res.status}). 잠시 뒤 다시 해 주세요.`)
}

export async function saveKey(raw: string): Promise<ClaudeAuthStatus> {
  const key = String(raw ?? '').trim()
  if (!keyShape(key)) throw new Error('API 키 모양이 아니에요. Console의 API Keys에서 만든 "sk-ant-…"로 시작하는 키를 붙여넣어 주세요.')
  await checkKey(key)
  const s = load()
  save({ ...s, key, hint: key.slice(-4), savedAt: nowIso(), enabled: true, fallback: undefined })
  changed()
  return authStatus()
}

export function removeKey(): ClaudeAuthStatus {
  const s = load()
  save({ version: 1, enabled: s.enabled, balance: s.balance })
  changed()
  return authStatus()
}

export function setEnabled(enabled: boolean): ClaudeAuthStatus {
  save({ ...load(), enabled: !!enabled })
  changed()
  return authStatus()
}

/** the designer wants the key back (credits added, the limit raised): new requests use it again */
export function retryApi(): ClaudeAuthStatus {
  save({ ...load(), fallback: undefined })
  changed()
  return authStatus()
}

/** the balance the designer read in the Console (null clears it); what this computer spends from now is taken off */
export function setBalance(usd: number | null): ClaudeAuthStatus {
  const s = load()
  save({ ...s, balance: usd == null || !(usd >= 0) ? undefined : { usd: Math.round(usd * 100) / 100, at: nowIso() } })
  writeJson(ledgerFile(), { ...ledger(), sinceBalance: 0 })
  return authStatus()
}

/** the key stopped working: the subscription takes over (true when this changed the mode) */
export function markFailed(reason: ApiFailureReason, detail?: string, retryAt?: string): boolean {
  const s = load()
  if (!s.key || activeFallback(s)) return false
  save({ ...s, fallback: { at: nowIso(), reason, detail: detail?.slice(0, 300), retryAt } })
  changed()
  return true
}

// ---- the session's apiKeyHelper ----

const secret = randomBytes(24).toString('hex')

/** the key for the helper's request (only while sessions are meant to use it) */
export function keyForHelper(token: string): string | null {
  if (token !== secret || authMode() !== 'api') return null
  const key = apiKey()
  // live tests: a key the API refuses, from the moment the test makes this file (the real key is never changed)
  const broken = process.env.MS_TEST_BREAK_KEY
  if (key && broken && existsSync(broken)) return `${key.slice(0, -6)}000000`
  return key
}

/** settings and environment for a Claude session started now */
export function sessionAuth(base: string): { mode: ClaudeAuthMode; settings: { apiKeyHelper?: string }; env: Record<string, string> } {
  const mode = authMode()
  if (mode !== 'api') return { mode, settings: {}, env: {} }
  // curl is on every Mac and on Windows 10 and later (cmd runs curl.exe)
  const env: Record<string, string> = {}
  if (process.env.MS_TEST_ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.MS_TEST_ANTHROPIC_BASE_URL
  // live tests that break the key mid-session: Claude Code asks the helper again at once instead of after 5 minutes
  if (process.env.MS_TEST_BREAK_KEY) env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '1000'
  return { mode, settings: { apiKeyHelper: `curl -fsS ${base}/claude-key/${secret}` }, env }
}

/** the address part a Bash command must not read (permissions.ts) */
export const HELPER_PATH = '/claude-key/'
