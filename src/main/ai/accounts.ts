// Saved accounts for the AI services the app connects to itself (Higgsfield,
// Magnific). Several accounts per service (company / personal); one is active.
//
// Tokens live in one file in the app data folder, readable only by the user
// (0600). On Windows the token part is additionally encrypted with DPAPI
// (safeStorage). The macOS keychain is deliberately not used: keychain prompts
// and locked keychains broke Claude Code's own login before. Claude's tokens are
// never touched by this file.
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AiAccountInfo, AiConnectProvider } from '@shared/ai'
import { dataDir } from '../paths'
import { newId, nowIso, readJson, writeJson } from '../util'

export interface StoredAccount {
  id: string
  provider: AiConnectProvider
  label: string
  email?: string
  name?: string
  createdAt: string
  /** client registered for this account (dynamic client registration) */
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  /** epoch ms when the tokens were saved (expires_in is relative to it) */
  savedAt?: number
  /** refresh failed: the designer has to sign in again */
  needsLogin?: boolean
}

interface StoreFile {
  version: 1
  active: Partial<Record<AiConnectProvider, string>>
  accounts: StoredAccount[]
  /** Windows: accounts' secrets sealed with DPAPI */
  sealed?: string
}

const file = () => join(dataDir(), 'connections.json')
const useDpapi = () => process.platform === 'win32' && safeStorage.isEncryptionAvailable()

function load(): StoreFile {
  const raw = readJson<StoreFile>(file(), { version: 1, active: {}, accounts: [] })
  if (raw.sealed && useDpapi()) {
    try {
      const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))) as Record<string, Pick<StoredAccount, 'client' | 'tokens'>>
      raw.accounts = raw.accounts.map((a) => ({ ...a, ...secrets[a.id] }))
    } catch {
      raw.accounts = raw.accounts.map((a) => ({ ...a, tokens: undefined, needsLogin: true }))
    }
  }
  delete raw.sealed
  return raw
}

function save(s: StoreFile) {
  let out: StoreFile = s
  if (useDpapi()) {
    const secrets: Record<string, Pick<StoredAccount, 'client' | 'tokens'>> = {}
    for (const a of s.accounts) secrets[a.id] = { client: a.client, tokens: a.tokens }
    out = {
      ...s,
      accounts: s.accounts.map(({ client: _c, tokens: _t, ...rest }) => rest),
      sealed: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64'),
    }
  }
  writeJson(file(), out)
  try {
    if (existsSync(file())) chmodSync(file(), 0o600)
  } catch {
    /* Windows: ACLs already limit the profile folder */
  }
}

export function listAccounts(): StoredAccount[] {
  return load().accounts
}

export function getAccount(id: string): StoredAccount | undefined {
  return load().accounts.find((a) => a.id === id)
}

export function activeAccount(provider: AiConnectProvider): StoredAccount | undefined {
  const s = load()
  const id = s.active[provider]
  return s.accounts.find((a) => a.id === id) ?? s.accounts.find((a) => a.provider === provider)
}

export function setActive(provider: AiConnectProvider, id: string) {
  const s = load()
  if (!s.accounts.some((a) => a.id === id && a.provider === provider)) throw new Error('계정을 찾을 수 없어요.')
  s.active[provider] = id
  save(s)
}

export function upsertAccount(a: Partial<StoredAccount> & { provider: AiConnectProvider }): StoredAccount {
  const s = load()
  const i = a.id ? s.accounts.findIndex((x) => x.id === a.id) : -1
  const next: StoredAccount = i >= 0 ? { ...s.accounts[i], ...a } as StoredAccount : { id: newId(), label: '계정', createdAt: nowIso(), ...a } as StoredAccount
  if (i >= 0) s.accounts[i] = next
  else s.accounts.push(next)
  if (!s.active[next.provider]) s.active[next.provider] = next.id
  save(s)
  return next
}

export function patchAccount(id: string, patch: Partial<StoredAccount>) {
  const s = load()
  const i = s.accounts.findIndex((x) => x.id === id)
  if (i < 0) return
  s.accounts[i] = { ...s.accounts[i], ...patch }
  save(s)
}

export function removeAccount(id: string) {
  const s = load()
  const gone = s.accounts.find((a) => a.id === id)
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (gone && s.active[gone.provider] === id) {
    const next = s.accounts.find((a) => a.provider === gone.provider)
    if (next) s.active[gone.provider] = next.id
    else delete s.active[gone.provider]
  }
  save(s)
}

/** what the renderer may see: never tokens */
export function publicInfo(): AiAccountInfo[] {
  const s = load()
  return s.accounts.map((a) => ({
    id: a.id,
    provider: a.provider,
    label: a.label,
    email: a.email,
    name: a.name,
    createdAt: a.createdAt,
    active: (s.active[a.provider] ?? s.accounts.find((x) => x.provider === a.provider)?.id) === a.id,
    needsLogin: !!a.needsLogin || !a.tokens,
  }))
}
