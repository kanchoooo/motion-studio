// Codex CLI as an image model: when the designer has Codex installed, signed in
// (ChatGPT) and has quota left, its built-in image_gen tool (GPT Image) can make
// images. Status comes from `codex app-server` (JSON-RPC: initialize → initialized
// → account/read + account/rateLimits/read), which calls no model and spends
// nothing; generation runs `codex exec` read-only and takes the picture from
// $CODEX_HOME/generated_images/<thread id>/. (Same reading as the 관제센터 dashboard.)
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { CodexStatus } from '@shared/ai'
import { killTree, spawnCommand } from '../spawn-cmd'

const home = homedir()
const codexHome = () => process.env.CODEX_HOME || join(home, '.codex')

let envCache: NodeJS.ProcessEnv | null = null
/**
 * The environment Codex needs. `codex` is usually an npm script (#!/usr/bin/env
 * node), and an app opened from the Finder gets a bare PATH without node: the
 * login shell's PATH and the usual install folders are added.
 */
async function codexEnv(): Promise<NodeJS.ProcessEnv> {
  if (envCache) return envCache
  const extra = [join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.volta', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']
  let shellPath = ''
  if (process.platform !== 'win32') {
    shellPath = await new Promise<string>((resolve) =>
      execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'printf %s "$PATH"'], { timeout: 8000 }, (err, out) => resolve(err ? '' : String(out))),
    )
  } else if (process.env.APPDATA) extra.push(join(process.env.APPDATA, 'npm'))
  const parts = [...shellPath.split(delimiter), ...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean)
  envCache = { ...process.env, PATH: [...new Set(parts)].join(delimiter) }
  return envCache
}

let binCache: string | null | undefined
/** the codex command, or null when it is not installed */
export async function codexBinary(): Promise<string | null> {
  if (binCache !== undefined) return binCache
  const env = await codexEnv()
  const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex']
  for (const dir of (env.PATH ?? '').split(delimiter))
    for (const n of names) {
      const p = join(dir, n)
      if (existsSync(p)) return (binCache = p)
    }
  return (binCache = null)
}

/** spawns codex (a .cmd on Windows goes through cmd.exe with its arguments kept whole) */
async function run(args: string[], opts: { cwd?: string } = {}) {
  const bin = await codexBinary()
  if (!bin) throw new Error('Codex CLI가 설치돼 있지 않아요.')
  return spawnCommand(bin, args, { cwd: opts.cwd, env: await codexEnv() })
}

/** asks `codex app-server` (no model call): account and rate limits */
async function appServer(timeoutMs = 25_000): Promise<{ account?: Record<string, unknown>; limits?: Record<string, unknown>; error?: string }> {
  const pr = await run(['app-server'])
  return new Promise((resolve) => {
    const out: { account?: Record<string, unknown>; limits?: Record<string, unknown>; error?: string } = {}
    let buf = ''
    const done = () => {
      clearTimeout(timer)
      try {
        killTree(pr)
      } catch {
        /* gone */
      }
      resolve(out)
    }
    const timer = setTimeout(() => {
      out.error ??= `Codex가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았어요.`
      done()
    }, timeoutMs)
    pr.on('error', (e) => {
      out.error = e.message
      done()
    })
    pr.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg: { id?: number; result?: Record<string, unknown>; error?: { message?: string } }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 2) msg.error ? (out.error = msg.error.message ?? '계정 정보를 읽지 못했어요.') : (out.account = msg.result)
        if (msg.id === 3) msg.error ? (out.error = msg.error.message ?? '한도를 읽지 못했어요.') : (out.limits = msg.result)
        if (out.error || (out.account && out.limits)) done()
      }
    })
    const send = (o: unknown) => pr.stdin.write(JSON.stringify(o) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'motion-studio', version: '1.0' } } })
    send({ jsonrpc: '2.0', method: 'initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'account/read', params: {} })
    send({ jsonrpc: '2.0', id: 3, method: 'account/rateLimits/read', params: {} })
  })
}

const windowLabel = (mins: number) => (mins === 10080 ? '주간' : mins >= 1440 ? `${Math.round(mins / 1440)}일` : mins >= 60 ? `${Math.round(mins / 60)}시간` : `${mins}분`)

let statusCache: { at: number; value: CodexStatus } | null = null

/** installed? signed in? quota left? (cached for a minute; force = ask again) */
export async function codexStatus(force = false): Promise<CodexStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value
  const base: CodexStatus = { installed: false, loggedIn: false, usable: false, limits: [], checkedAt: new Date().toISOString() }
  const bin = await codexBinary()
  let value: CodexStatus
  if (!bin) value = { ...base, reason: 'Codex CLI가 설치돼 있지 않아요.' }
  else {
    const r = await appServer().catch((e: Error) => ({ error: e.message }) as { error: string; account?: undefined; limits?: undefined })
    const acc = (r.account?.account ?? null) as { type?: string; email?: string; planType?: string } | null
    const rl = (r.limits?.rateLimits ?? {}) as Record<string, { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } | string | boolean | null>
    const limits: CodexStatus['limits'] = []
    for (const k of ['primary', 'secondary'] as const) {
      const b = rl[k] as { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } | null
      if (b && typeof b.usedPercent === 'number') limits.push({ label: windowLabel(b.windowDurationMins ?? 0), usedPercent: b.usedPercent, resetsAt: b.resetsAt ? new Date(b.resetsAt * 1000).toISOString() : undefined })
    }
    const loggedIn = !!acc && !/401|unauthori[sz]ed|token_expired|not logged/i.test(r.error ?? '')
    const reached = !!(rl.rateLimitReachedType || rl.spendControlReached) || r.limits?.ordinaryUsageAllowed === false || limits.some((l) => l.usedPercent >= 100)
    // Codex could not reach ChatGPT (it reads the account over the network): not a sign-in problem
    const offline = !acc && /timed? ?out|timeout|network|connect|dns|unreachable|답하지 않았어요/i.test(r.error ?? '')
    const reason = !loggedIn
      ? /401|unauthori[sz]ed|token_expired/i.test(r.error ?? '')
        ? 'Codex 로그인이 만료됐어요. 터미널에서 codex login을 한 번 해 주세요.'
        : offline
          ? `Codex가 ChatGPT 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤 다시 시도해 주세요.${r.error ? ` (${r.error.slice(0, 120)})` : ''}`
          : `Codex에 로그인돼 있지 않아요. 터미널에서 codex login을 해 주세요.${r.error ? ` (${r.error.slice(0, 120)})` : ''}`
      : reached
        ? `Codex 사용 한도에 닿았어요.${limits.find((l) => l.usedPercent >= 100)?.resetsAt ? ` ${new Date(limits.find((l) => l.usedPercent >= 100)!.resetsAt!).toLocaleString('ko-KR')}에 풀려요.` : ''}`
        : acc?.type && acc.type !== 'chatgpt'
          ? 'Codex 이미지 만들기는 ChatGPT 계정으로 로그인했을 때 써요.'
          : undefined
    value = { ...base, installed: true, path: bin, loggedIn, email: acc?.email, plan: acc?.planType, limits, usable: loggedIn && !reason, reason }
  }
  statusCache = { at: Date.now(), value }
  return value
}

const SIZE: Record<string, string> = { '1:1': '1024x1024 (square)', '3:4': '1024x1536 (portrait)', '4:3': '1536x1024 (landscape)', '9:16': '1024x1536 (tall portrait)', '16:9': '1536x1024 (wide landscape)' }

/**
 * One image from Codex's built-in image_gen (GPT Image). The prompt goes in as
 * written; reference images are attached (-i). Returns the PNG it saved.
 */
export async function codexImage(opts: { prompt: string; ratio: string; references: string[]; workDir: string; onLine?: (s: string) => void }): Promise<string> {
  const st = await codexStatus(true)
  if (!st.usable) throw new Error(st.reason ?? 'Codex를 쓸 수 없어요.')
  mkdirSync(opts.workDir, { recursive: true })
  const ask = [
    'Make exactly ONE image with your built-in image generation tool (image_gen), then stop.',
    'Do not run shell commands, do not read skills or files, do not write files, do not ask questions.',
    `Size / aspect ratio: ${SIZE[opts.ratio] ?? opts.ratio}.`,
    opts.references.length ? 'Use the attached image(s) only as references (style, character, composition) as the prompt says.' : '',
    'Use this prompt exactly as written (it may be in Korean, Chinese or English):',
    '<<<PROMPT',
    opts.prompt,
    'PROMPT>>>',
  ]
    .filter(Boolean)
    .join('\n')
  const args = ['exec', '--skip-git-repo-check', '-C', opts.workDir, '-s', 'read-only', '--enable', 'image_generation', '-c', 'model_reasoning_effort="low"', '--json', ...opts.references.flatMap((r) => ['-i', r]), '-']
  const pr = await run(args, { cwd: opts.workDir })
  pr.stdin.end(ask)
  let thread = ''
  let failure = ''
  let buf = ''
  pr.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      try {
        const e = JSON.parse(line) as { type?: string; thread_id?: string; message?: string; error?: { message?: string }; item?: { type?: string; text?: string } }
        if (e.type === 'thread.started' && e.thread_id) thread = e.thread_id
        if (e.type === 'error' || e.type === 'turn.failed') failure = e.message ?? e.error?.message ?? failure
        if (e.item?.type === 'agent_message' && e.item.text) opts.onLine?.(e.item.text)
      } catch {
        /* not an event */
      }
    }
  })
  let stderr = ''
  pr.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString('utf8')).slice(-2000)))
  const code = await new Promise<number | null>((resolve) => {
    const limit = setTimeout(() => killTree(pr), 6 * 60_000)
    pr.on('close', (c) => {
      clearTimeout(limit)
      resolve(c)
    })
  })
  const dir = thread ? join(codexHome(), 'generated_images', thread) : ''
  const images = dir && existsSync(dir) ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : []
  if (images.length) return images[0]
  statusCache = null
  const why = failure || stderr.split('\n').filter((l) => /error|limit|rate|unauthor/i.test(l)).slice(-1)[0] || ''
  if (/rate.?limit|usage limit|quota|429/i.test(why)) throw new Error('Codex 사용 한도에 닿아서 이미지를 만들지 못했어요.')
  if (/401|unauthori[sz]ed|login/i.test(why)) throw new Error('Codex 로그인이 필요해요. 터미널에서 codex login을 해 주세요.')
  throw new Error(`Codex가 이미지를 만들지 못했어요${code ? ` (종료 코드 ${code})` : ''}. ${why.slice(0, 200)}`.trim())
}
