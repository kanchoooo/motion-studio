import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// 사용자 Claude API 키: prices, the failures that hand the work to the subscription, the key's storage,
// the session's helper, what a session spent
const data = mkdtempSync(join(tmpdir(), 'ms-claudeapi-'))
const config = mkdtempSync(join(tmpdir(), 'ms-claudecfg-'))
process.env.CLAUDE_CONFIG_DIR = config
afterAll(() => {
  rmSync(data, { recursive: true, force: true })
  rmSync(config, { recursive: true, force: true })
})
vi.mock('electron', () => ({
  app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => data, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))
const { apiFailure, costOfUsage, usd } = await import('../../src/shared/claudeApi')
const api = await import('../../src/main/claudeApi')
const { ApiMeter } = await import('../../src/main/agent/apiMeter')
const { readsApiKey } = await import('../../src/main/agent/permissions')

describe('prices', () => {
  it('prices a response like Claude Code does (Opus 5.5, 5-minute writes)', () => {
    // the stand-in API's numbers: Claude Code reported $0.026 for them
    expect(costOfUsage('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0 } })).toBeCloseTo(0.026, 9)
  })
  it('1-hour writes, other models, long Haiku prompts, fast mode and web searches', () => {
    expect(costOfUsage('claude-opus-5-5', { cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } })).toBeCloseTo(8)
    expect(costOfUsage('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12)
    expect(costOfUsage('claude-opus-4-1', { output_tokens: 1_000_000 })).toBeCloseTo(75)
    expect(costOfUsage('claude-opus-4-8', { output_tokens: 1_000_000 })).toBeCloseTo(25)
    expect(costOfUsage('claude-haiku-5-5', { input_tokens: 50_000 })).toBeCloseTo(0.005)
    expect(costOfUsage('claude-haiku-5-5', { input_tokens: 200_000 })).toBeCloseTo(0.1)
    expect(costOfUsage('claude-opus-5-5', { output_tokens: 1_000_000, speed: 'fast' })).toBeCloseTo(40)
    expect(costOfUsage('claude-opus-5-5', { server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(0.03)
    // a model the table does not know is priced like the current Opus
    expect(costOfUsage('claude-something-9', { output_tokens: 1_000_000 })).toBeCloseTo(20)
    expect(usd(0.026)).toBe('$0.026')
    expect(usd(12.4)).toBe('$12.40')
  })
})

describe('when the subscription takes over', () => {
  it('credits, the Console spend limit, a dead key, too many requests', () => {
    expect(apiFailure('Credit balance is too low')?.reason).toBe('credit')
    expect(apiFailure('API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}')?.reason).toBe('credit')
    expect(apiFailure('', 'billing_error')?.reason).toBe('credit')
    const lim = apiFailure('You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.')
    expect(lim).toEqual({ reason: 'limit', retryAt: '2026-11-01T00:00:00.000Z' })
    expect(apiFailure('Invalid API key · Fix external API key')?.reason).toBe('auth')
    expect(apiFailure('', 'authentication_failed')?.reason).toBe('auth')
    expect(apiFailure('Your apiKeyHelper script is failing')?.reason).toBe('auth')
    const rate = apiFailure('API Error: 429 rate_limit_error', undefined, Date.parse('2026-10-20T00:00:00Z'))
    expect(rate).toEqual({ reason: 'rate', retryAt: '2026-10-20T00:15:00.000Z' })
  })
  it("the subscription's own limits and errors that switching would not fix are not the key's", () => {
    expect(apiFailure("You've hit your session limit · resets 3:45pm")).toBeNull()
    expect(apiFailure("You've hit your monthly spend limit")).toBeNull()
    expect(apiFailure('API Error: 529 Overloaded')).toBeNull()
    expect(apiFailure('', 'server_error')).toBeNull()
  })
})

describe('the key on this computer', () => {
  const key = `sk-ant-api03-${'k'.repeat(40)}wxyz`
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => new Response('{}', { status: init.headers['x-api-key'] === key ? 200 : 401 })))
  })
  it('refuses a wrong shape or a key the API does not know; keeps a good one readable only by the user', async () => {
    await expect(api.saveKey('hello')).rejects.toThrow('API 키 모양이 아니에요')
    await expect(api.saveKey(`sk-ant-api03-${'z'.repeat(40)}`)).rejects.toThrow('키가 맞지 않아요')
    const st = await api.saveKey(`  ${key}\n`)
    expect(st).toMatchObject({ hasKey: true, hint: 'wxyz', enabled: true, using: 'api' })
    expect(JSON.stringify(st)).not.toContain(key)
    if (process.platform !== 'win32') expect(statSync(join(data, 'claude-api.json')).mode % 0o1000).toBe(0o600)
  })
  it('the session gets a helper (never the key itself); the helper address answers only with the run secret', () => {
    const s = api.sessionAuth('http://127.0.0.1:1234')
    expect(s.mode).toBe('api')
    expect(s.settings.apiKeyHelper).toMatch(/^curl -fsS http:\/\/127\.0\.0\.1:1234\/claude-key\/[a-f0-9]{48}$/)
    expect(JSON.stringify(s)).not.toContain(key)
    const secret = s.settings.apiKeyHelper!.split('/').pop()!
    expect(api.keyForHelper(secret)).toBe(key)
    expect(api.keyForHelper('0'.repeat(48))).toBeNull()
  })
  it('a failure moves to the subscription (once) until the designer tries again or the retry time passes', () => {
    const seen: number[] = []
    const off = api.onAuthChange(() => seen.push(1))
    expect(api.markFailed('credit', 'Credit balance is too low')).toBe(true)
    expect(api.markFailed('credit')).toBe(false)
    expect(api.authMode()).toBe('subscription')
    expect(api.sessionAuth('http://x').settings).toEqual({})
    const secret = 'a'.repeat(48)
    expect(api.keyForHelper(secret)).toBeNull()
    expect(api.authStatus().fallback?.reason).toBe('credit')
    api.retryApi()
    expect(api.authMode()).toBe('api')
    // a limit with a time: the key comes back by itself
    api.markFailed('limit', '', new Date(Date.now() - 1000).toISOString())
    expect(api.authMode()).toBe('api')
    api.setEnabled(false)
    expect(api.authMode()).toBe('subscription')
    api.setEnabled(true)
    off()
    expect(seen.length).toBeGreaterThanOrEqual(4)
  })
  it('spend adds up per month; an entered balance is reduced by what this computer spends', () => {
    api.setBalance(50)
    api.addSpend(1.25)
    api.addSpend(0.75)
    const st = api.authStatus()
    expect(st.month.usd).toBeCloseTo(2)
    expect(st.balance).toMatchObject({ usd: 50, spentSince: 2 })
  })
  it('removing the key leaves no key behind', () => {
    api.removeKey()
    expect(api.authMode()).toBe('subscription')
    expect(readFileSync(join(data, 'claude-api.json'), 'utf8')).not.toContain('sk-ant')
  })
})

describe('what a session spent', () => {
  const slug = join(config, 'projects', '-p')
  mkdirSync(slug, { recursive: true })
  const sid = '11111111-2222-3333-4444-555555555555'
  const main = join(slug, `${sid}.jsonl`)
  const line = (id: string, model = 'claude-opus-5-5', out = 1_000_000) => JSON.stringify({ type: 'assistant', requestId: `r-${id}`, message: { id, model, usage: { output_tokens: out } } }) + '\n'
  it('counts what the process wrote once (a response is several lines), not the history before it', () => {
    writeFileSync(main, line('old'))
    const m = new ApiMeter(sid, true)
    m.begin()
    appendFileSync(main, line('a') + line('a') + JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
    expect(m.read()).toBeCloseTo(20)
    expect(m.read()).toBe(0)
    // a subagent's transcript that appears later is this process's too
    mkdirSync(join(slug, sid, 'subagents'), { recursive: true })
    writeFileSync(join(slug, sid, 'subagents', 'agent-x.jsonl'), line('b', 'claude-sonnet-5-5'))
    // a line written in two pieces is counted once it is whole
    appendFileSync(main, line('c').slice(0, 30))
    expect(m.read()).toBeCloseTo(10)
    appendFileSync(main, line('c').slice(30))
    expect(m.read()).toBeCloseTo(20)
    expect(m.total).toBeCloseTo(50)
  })
  it('a process on the subscription counts nothing', () => {
    const m = new ApiMeter(sid, false)
    m.begin()
    appendFileSync(main, line('d'))
    expect(m.read()).toBe(0)
  })
})

describe('the key is never read by Claude', () => {
  it("commands and reads that reach the helper address or the key's file", () => {
    expect(readsApiKey('Bash', { command: 'curl -s http://127.0.0.1:5555/claude-key/abc' })).toBe(true)
    expect(readsApiKey('Bash', { command: 'cat ~/Library/Application\\ Support/MotionStudio/claude-api.json' })).toBe(true)
    expect(readsApiKey('Read', { file_path: '/Users/x/Library/Application Support/MotionStudio/claude-api.json' })).toBe(true)
    expect(readsApiKey('Bash', { command: 'hyperframes check' })).toBe(false)
    expect(readsApiKey('Read', { file_path: 'composition/index.html' })).toBe(false)
  })
})
