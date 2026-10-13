// Sign-in (OAuth 2.1: dynamic client registration + PKCE + loopback redirect)
// and MCP client connections to Higgsfield / Magnific with the active account.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { app, shell } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { AI_PROVIDERS, type AiConnectProvider, type AiLoginEvent } from '@shared/ai'
import { activeAccount, getAccount, listAccounts, patchAccount, publicInfo, upsertAccount, type StoredAccount } from './accounts'

const CALLBACK = '/oauth/callback'

function metadata(redirect: string): OAuthClientMetadata {
  return {
    client_name: '모션스튜디오 (Motion Studio)',
    redirect_uris: [redirect],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

/** OAuth provider backed by the account store (used for normal calls: refresh only, no browser) */
function storedProvider(accountId: string): OAuthClientProvider {
  let verifier = ''
  return {
    get redirectUrl() {
      return `http://127.0.0.1${CALLBACK}`
    },
    get clientMetadata() {
      return metadata(`http://127.0.0.1${CALLBACK}`)
    },
    clientInformation: () => getAccount(accountId)?.client,
    saveClientInformation: (client: OAuthClientInformationMixed) => patchAccount(accountId, { client }),
    tokens: () => getAccount(accountId)?.tokens,
    saveTokens: (tokens: OAuthTokens) => patchAccount(accountId, { tokens: { ...getAccount(accountId)?.tokens, ...tokens }, savedAt: Date.now(), needsLogin: false }),
    redirectToAuthorization: () => {
      // refresh failed: the designer signs in again from the connections screen
      patchAccount(accountId, { needsLogin: true })
      throw new NeedsLoginError(getAccount(accountId)?.provider ?? 'higgsfield')
    },
    saveCodeVerifier: (v: string) => {
      verifier = v
    },
    codeVerifier: () => verifier,
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'tokens') patchAccount(accountId, { tokens: undefined, needsLogin: true })
      if (scope === 'all' || scope === 'client') patchAccount(accountId, { client: undefined })
    },
  }
}

export class NeedsLoginError extends Error {
  constructor(public provider: AiConnectProvider) {
    super(`${AI_PROVIDERS[provider].name} 로그인이 필요해요. 'AI 연결'에서 다시 로그인해 주세요.`)
  }
}

export class NotConnectedError extends Error {
  constructor(public provider: AiConnectProvider) {
    super(`${AI_PROVIDERS[provider].name}에 연결된 계정이 없어요. 'AI 연결'에서 로그인해 주세요.`)
  }
}

// ---- sign-in ---------------------------------------------------------------------

let pendingLogin: { cancel(): void } | null = null

/** "id_token" is only read for the account's display name/e-mail (not trusted for anything else) */
function identity(tokens: OAuthTokens & { id_token?: string }): { email?: string; name?: string } {
  const jwt = tokens.id_token ?? (tokens.access_token?.split('.').length === 3 ? tokens.access_token : undefined)
  if (!jwt) return {}
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    return { email: s(p.email) ?? s(p.preferred_username), name: s(p.name) ?? s(p.given_name) }
  } catch {
    return {}
  }
}

/**
 * Opens the service's sign-in page in the browser and waits for the redirect.
 * `relogin` signs an existing account in again; otherwise a new account is added.
 */
export async function login(provider: AiConnectProvider, opts: { label: string; relogin?: string }, emit: (e: AiLoginEvent) => void): Promise<void> {
  pendingLogin?.cancel()
  const meta = AI_PROVIDERS[provider]
  let server: Server | null = null
  let finish: ((code: string) => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const codeP = new Promise<string>((res, rej) => {
    finish = res
    fail = rej
  })
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== CALLBACK) {
      res.writeHead(404).end()
      return
    }
    const code = u.searchParams.get('code')
    const err = u.searchParams.get('error_description') ?? u.searchParams.get('error')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><meta charset="utf-8"><title>모션스튜디오</title><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;color:#333">` +
        `<div style="text-align:center"><h2>${code ? `${meta.name} 로그인 완료` : '로그인하지 못했어요'}</h2><p>${code ? '이 창을 닫고 모션스튜디오로 돌아가 주세요.' : String(err ?? '').replace(/[<>&]/g, '')}</p></div>`,
    )
    if (code) finish?.(code)
    else fail?.(new Error(err ?? '로그인이 취소됐어요.'))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK}`
  const timer = setTimeout(() => fail?.(new Error('로그인 시간이 지났어요. 다시 시도해 주세요.')), 10 * 60_000)
  pendingLogin = { cancel: () => fail?.(new Error('cancelled')) }

  const draft: Partial<StoredAccount> = {}
  let verifier = ''
  const another = !opts.relogin && listAccounts().some((a) => a.provider === provider)
  const flow: OAuthClientProvider = {
    get redirectUrl() {
      return redirect
    },
    get clientMetadata() {
      return metadata(redirect)
    },
    clientInformation: () => draft.client,
    saveClientInformation: (c) => {
      draft.client = c
    },
    tokens: () => undefined,
    saveTokens: (t) => {
      draft.tokens = t
    },
    redirectToAuthorization: async (url) => {
      // a second account: ask the service to show its sign-in page instead of reusing the browser session
      if (another || opts.relogin) url.searchParams.set('prompt', 'login')
      await shell.openExternal(url.toString())
    },
    saveCodeVerifier: (v) => {
      verifier = v
    },
    codeVerifier: () => verifier,
  }
  try {
    emit({ provider, status: 'waiting' })
    const first = await auth(flow, { serverUrl: meta.url })
    if (first !== 'AUTHORIZED') {
      const code = await codeP
      const second = await auth(flow, { serverUrl: meta.url, authorizationCode: code })
      if (second !== 'AUTHORIZED' || !draft.tokens) throw new Error('토큰을 받지 못했어요.')
    }
    const who = identity(draft.tokens as OAuthTokens & { id_token?: string })
    const saved = upsertAccount({
      ...(opts.relogin ? { id: opts.relogin } : {}),
      provider,
      label: opts.label || (opts.relogin ? getAccount(opts.relogin)?.label : undefined) || '계정',
      client: draft.client,
      tokens: draft.tokens,
      savedAt: Date.now(),
      needsLogin: false,
      ...who,
    })
    dropClient(saved.id)
    emit({ provider, status: 'done', account: publicInfo().find((a) => a.id === saved.id) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emit({ provider, status: msg === 'cancelled' ? 'cancelled' : 'error', message: msg === 'cancelled' ? undefined : msg })
  } finally {
    clearTimeout(timer)
    server.close()
    pendingLogin = null
  }
}

export function cancelLogin() {
  pendingLogin?.cancel()
}

// ---- MCP clients ----------------------------------------------------------------------

interface Conn {
  accountId: string
  client: Client
  tools?: { at: number; list: Awaited<ReturnType<Client['listTools']>>['tools'] }
}
const conns = new Map<AiConnectProvider, Conn>()

function dropClient(accountId: string) {
  for (const [p, c] of conns) {
    if (c.accountId === accountId) {
      void c.client.close().catch(() => {})
      conns.delete(p)
    }
  }
}

export function resetConnections() {
  for (const c of conns.values()) void c.client.close().catch(() => {})
  conns.clear()
}

async function connection(provider: AiConnectProvider): Promise<Conn> {
  const acc = activeAccount(provider)
  if (!acc) throw new NotConnectedError(provider)
  if (!acc.tokens) throw new NeedsLoginError(provider)
  const cur = conns.get(provider)
  if (cur && cur.accountId === acc.id) return cur
  if (cur) {
    void cur.client.close().catch(() => {})
    conns.delete(provider)
  }
  const transport = new StreamableHTTPClientTransport(new URL(AI_PROVIDERS[provider].url), { authProvider: storedProvider(acc.id) })
  const client = new Client({ name: 'motion-studio', version: app.getVersion() })
  try {
    await client.connect(transport)
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof NeedsLoginError) {
      patchAccount(acc.id, { needsLogin: true })
      throw new NeedsLoginError(provider)
    }
    throw e
  }
  const conn: Conn = { accountId: acc.id, client }
  conns.set(provider, conn)
  return conn
}

export type ToolInfo = Awaited<ReturnType<Client['listTools']>>['tools'][number]

export async function listTools(provider: AiConnectProvider, fresh = false): Promise<ToolInfo[]> {
  const c = await connection(provider)
  if (!fresh && c.tools && Date.now() - c.tools.at < 10 * 60_000) return c.tools.list
  const list: ToolInfo[] = []
  let cursor: string | undefined
  do {
    const r = await c.client.listTools(cursor ? { cursor } : undefined)
    list.push(...r.tools)
    cursor = r.nextCursor
  } while (cursor)
  c.tools = { at: Date.now(), list }
  return list
}

export interface ToolResult {
  content?: { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; blob?: string; text?: string; mimeType?: string } }[]
  structuredContent?: unknown
  isError?: boolean
}

export async function callTool(provider: AiConnectProvider, name: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<ToolResult> {
  const run = async () =>
    (await (await connection(provider)).client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, resetTimeoutOnProgress: true, maxTotalTimeout: 20 * 60_000 })) as ToolResult
  try {
    return await run()
  } catch (e) {
    if (e instanceof NeedsLoginError || e instanceof UnauthorizedError) {
      const acc = activeAccount(provider)
      if (acc) patchAccount(acc.id, { needsLogin: true })
      throw new NeedsLoginError(provider)
    }
    // a dropped session: reconnect once
    if (/session|closed|ECONNRESET|socket|fetch failed/i.test(String(e))) {
      conns.delete(provider)
      return await run()
    }
    throw e
  }
}

export function connectedProviders(): AiConnectProvider[] {
  return (['higgsfield', 'magnific'] as const).filter((p) => {
    const a = activeAccount(p)
    return !!a?.tokens && !a.needsLogin
  })
}
