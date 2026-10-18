// Claude asks before doing something outside its standing permissions (running a
// command, reading a web page, writing outside the project): Claude Code's
// PermissionRequest hook POSTs here (an HTTP hook on 127.0.0.1) and waits. In
// "물어보기" mode the designer answers on a card in the chat; in "모두 허용" mode the
// app allows at once. Files the app manages stay denied by the session's deny
// rules in both modes (those never reach this hook).
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import type { AgentPermission, PermissionAsk } from '@shared/api'
import type { Overrides } from '@shared/overrides'
import { approvalOf, askFirst, designerLayers, pageAfter, touchedLayers } from './designerGuard'

export type PermissionAnswer = 'allow' | 'always' | 'deny'

export interface PermissionHooks {
  projectFor(token: string): string | undefined
  mode(projectId: string): AgentPermission
  dirOf(projectId: string): string
  /** a new question for the designer (shown as a card) or one that went away */
  changed(projectId: string, asks: PermissionAsk[], added?: PermissionAsk): void
  /** reasoning effort the running session was started with (the chat panel's setting) */
  effortOf?(projectId: string): string | undefined
}

interface Waiting {
  ask: PermissionAsk
  key: string
  resolve(answer: PermissionAnswer, reason?: string): void
}

/** answer before Claude Code's own hook timeout (900 s): it would then ask in the hidden terminal */
const ANSWER_WITHIN = 14 * 60_000

let hooks: PermissionHooks | null = null
const waiting = new Map<string, Waiting>() // ask id → waiting request
/** "이 대화에서 계속 허용": per project, until the session ends */
const always = new Map<string, Set<string>>()

export function setPermissionHooks(h: PermissionHooks) {
  hooks = h
}

const short = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** what Claude wants to do, in the designer's words */
export function describe(tool: string, input: Record<string, unknown>, dir: string): { title: string; detail: string; key: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const rel = (p: string) => {
    if (!p) return ''
    const r = isAbsolute(p) ? relative(dir, p) : p
    return r.startsWith('..') ? p : r || '.'
  }
  switch (tool) {
    case 'Bash': {
      const cmd = str('command').trim()
      const first = cmd.split(/\s+/)[0] ?? ''
      return { title: str('description') ? `명령 실행 · ${str('description')}` : '명령 실행', detail: short(cmd), key: `Bash:${first}` }
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { title: '파일 쓰기', detail: rel(str('file_path') || str('notebook_path')), key: 'Edit' }
    case 'Read':
    case 'Glob':
    case 'Grep':
      return { title: '파일 읽기', detail: rel(str('file_path') || str('path') || str('pattern')), key: 'Read' }
    case 'WebFetch': {
      let host = ''
      try {
        host = new URL(str('url')).hostname
      } catch {
        /* not a URL */
      }
      return { title: '웹 페이지 읽기', detail: str('url'), key: `WebFetch:${host}` }
    }
    case 'WebSearch':
      return { title: '웹 검색', detail: str('query'), key: 'WebSearch' }
    default:
      if (tool.startsWith('mcp__')) return { title: '외부 도구 사용', detail: `${tool.replace(/^mcp__/, '').replace('__', ' · ')}\n${short(JSON.stringify(input), 300)}`, key: tool }
      return { title: tool, detail: short(JSON.stringify(input), 400), key: tool }
  }
}

function reply(res: ServerResponse, answer: PermissionAnswer, message?: string) {
  const decision = answer === 'deny' ? { behavior: 'deny', message: message ?? '디자이너가 허용하지 않았어요. 다른 방법을 찾거나, 왜 필요한지 설명하고 물어보세요.' } : { behavior: 'allow' }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export const askingFor = (projectId: string) => [...waiting.values()].filter((w) => w.ask.projectId === projectId).map((w) => w.ask)

const HANGUL = /[\uac00-\ud7a3]/

// `hyperframes check 2>&1 | grep … | head` — Claude reads a long report through filters. The
// session allows `hyperframes …` alone; a pipeline of it into read-only filters is allowed here
// instead of asking the designer. Anything that could run or write something else still asks.
const HF_READ = new Set(['check', 'lint', 'validate', 'inspect', 'keyframes', 'snapshot', 'catalog', 'add', 'info', 'compositions', 'timeline', 'beats', 'docs'])
const FILTERS = new Set(['grep', 'egrep', 'fgrep', 'head', 'tail', 'wc', 'cut', 'tr', 'sort'])

/** shell words of one simple command (quotes removed) */
function shellWords(seg: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  let any = false
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) {
      if (c === q) q = null
      // in double quotes a backslash escapes only $ ` " \ (as in bash): "C:\Users\…" keeps its backslashes
      else if (q === '"' && c === '\\' && /[$`"\\]/.test(seg[i + 1] ?? '')) cur += seg[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      any = true
    } else if (c === '\\' && i + 1 < seg.length) {
      cur += seg[++i]
      any = true
    } else if (/\s/.test(c)) {
      if (cur || any) out.push(cur)
      cur = ''
      any = false
    } else cur += c
  }
  if (cur || any) out.push(cur)
  return out
}

/** true for `[cd <project or composition> &&] hyperframes <read command> … | <read-only filter> …` */
export function hyperframesReadPipeline(cmd: string, projectDir: string): boolean {
  const segs: string[] = []
  const ops: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      if (c === q) q = null
      else if (q === '"' && (c === '`' || (c === '$' && cmd[i + 1] === '('))) return false
      else if (q === '"' && c === '\\' && /[$`"\\]/.test(cmd[i + 1] ?? '')) {
        cur += c + cmd[i + 1]
        i++
        continue
      }
      cur += c
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === '\\') {
      cur += c + (cmd[i + 1] ?? '')
      i++
    } else if (c === '`' || c === ';' || c === '\n' || c === '<' || (c === '$' && cmd[i + 1] === '(')) return false
    else if (c === '>') {
      // only stderr into stdout or nowhere
      const rest = cmd.slice(i)
      if (!cur.endsWith('2')) return false
      const m = rest.match(/^>(&1|\/dev\/null)(?=\s|$|\|)/)
      if (!m) return false
      cur = cur.slice(0, -1)
      i += m[0].length - 1
    } else if (c === '&') {
      if (cmd[i + 1] !== '&') return false
      segs.push(cur)
      ops.push('&&')
      cur = ''
      i++
    } else if (c === '|') {
      if (cmd[i + 1] === '|' || cmd[i + 1] === '&') return false
      segs.push(cur)
      ops.push('|')
      cur = ''
    } else cur += c
  }
  if (q) return false
  segs.push(cur)
  const words = segs.map(shellWords)
  if (words.some((w) => !w.length)) return false
  let at = 0
  if (ops[0] === '&&') {
    const [cd, target, ...more] = words[0]
    if (cd !== 'cd' || !target || more.length) return false
    const real = (p: string) => {
      try {
        return realpathSync(p)
      } catch {
        return p
      }
    }
    const to = real(resolvePath(projectDir, target))
    if (to !== real(projectDir) && to !== real(join(projectDir, 'composition'))) return false
    at = 1
  }
  if (ops.slice(at).some((o) => o !== '|') || at >= words.length) return false
  const [first, ...filters] = words.slice(at)
  let k = 0
  if (first[0] === 'npx') {
    k = 1
    if (first[k] === '-y' || first[k] === '--yes') k++
  }
  if (!/^hyperframes(@[\w.-]+)?$/.test(first[k] ?? '') || !HF_READ.has(first[k + 1] ?? '')) return false
  return filters.every((f) => (FILTERS.has(f[0]) && !(f[0] === 'sort' && f.some((a) => a === '-o' || a.startsWith('--output')))) || sedPrintsRange(f))
}

/** `sed -n '/^Layout/,/^Snapshots/p'` or `sed -n 10,40p`: prints lines, nothing else */
function sedPrintsRange(f: string[]): boolean {
  if (f[0] !== 'sed') return false
  const opts = f.slice(1).filter((a) => a.startsWith('-'))
  const scripts = f.slice(1).filter((a) => !a.startsWith('-'))
  const addr = String.raw`(\d+|\$|\/(?:[^\/\\]|\\.)*\/)`
  return opts.length > 0 && opts.every((o) => o === '-n' || o === '-E' || o === '-nE' || o === '-En') && scripts.length === 1 && new RegExp(`^${addr}(,${addr})?p$`).test(scripts[0])
}

/** /hook/<token>/… — true when the request was ours */
export async function handleHook(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (/\/pretool$/.test(path)) return handlePreTool(req, res, path)
  return handlePermission(req, res, path)
}

const REVIEWER = /(^|:)motion-reviewer$/
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * PreToolUse: the reviewer thinks as hard as the session (Agent); an edit of a page that reaches a
 * layer the designer edited by hand is sent back unless the designer asked for it (Edit, Write)
 */
async function handlePreTool(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/hook\/([a-f0-9]+)\/pretool$/)
  const projectId = m ? hooks?.projectFor(m[1]) : undefined
  const body = await readJson(req)
  const pass = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  const input = (body.tool_input && typeof body.tool_input === 'object' ? body.tool_input : {}) as Record<string, unknown>
  if (hooks && projectId && (body.tool_name === 'Edit' || body.tool_name === 'MultiEdit' || body.tool_name === 'Write')) {
    const why = designerLayerEdit(projectId, String(body.tool_name), input)
    if (why) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }))
    else pass()
    return true
  }
  if (!hooks || !projectId || body.tool_name !== 'Agent') return (pass(), true)
  // its own definition has no effort, and an effort Claude picked for it is replaced with the one set in the chat panel
  const effort = hooks.effortOf?.(projectId)
  if (!REVIEWER.test(String(input.subagent_type ?? '')) || !effort || !EFFORTS.includes(effort) || input.effort === effort) return (pass(), true)
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...input, effort } } }))
  return true
}

/** an edit of a composition page that changes a layer the designer edited, unasked: what Claude is told (else null) */
function designerLayerEdit(projectId: string, tool: string, input: Record<string, unknown>): string | null {
  try {
    const ok = approvalOf(projectId)
    if (ok.all) return null
    const dir = hooks!.dirOf(projectId)
    const file = typeof input.file_path === 'string' ? resolvePath(dir, input.file_path) : ''
    const rel = relative(join(dir, 'composition'), file)
    if (!file || rel.startsWith('..') || isAbsolute(rel) || !/\.html$/i.test(file) || !existsSync(file)) return null
    const before = readFileSync(file, 'utf8')
    const after = pageAfter(tool, input, before)
    if (after == null) return null
    const ov = JSON.parse(readFileSync(join(dir, 'overrides.json'), 'utf8')) as Overrides
    const theirs = designerLayers(ov, before)
    const touched = touchedLayers(before, after, theirs).filter((id) => !ok.ids.has(id))
    return touched.length ? askFirst(touched.map((id) => theirs.get(id)!)) : null
  } catch {
    return null
  }
}

/** /hook/<token>/permission — true when the request was ours */
export async function handlePermission(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/hook\/([a-f0-9]+)\/permission$/)
  if (!m) return false
  const projectId = hooks?.projectFor(m[1])
  if (!hooks || !projectId || req.method !== 'POST') {
    res.writeHead(404).end()
    return true
  }
  const body = await readJson(req)
  const tool = typeof body.tool_name === 'string' ? body.tool_name : '?'
  const input = (body.tool_input && typeof body.tool_input === 'object' ? body.tool_input : {}) as Record<string, unknown>
  let dir = ''
  try {
    dir = hooks.dirOf(projectId)
  } catch {
    reply(res, 'deny', '프로젝트가 닫혀 있어요.')
    return true
  }
  const { title, detail, key } = describe(tool, input, dir)
  // sent back to Claude before the designer is even asked (in both modes)
  if (tool === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : ''
    if (hyperframesReadPipeline(cmd, dir)) {
      reply(res, 'allow')
      return true
    }
    if (!HANGUL.test(typeof input.description === 'string' ? input.description : '')) {
      reply(res, 'deny', '디자이너는 이 명령을 허락 카드로 봐요. 명령은 그대로 두고 설명(description)만 짧은 한국어로 바꿔서 다시 실행하세요 (예: "배경 음악 박자 분석"). 이 안내는 디자이너에게 말하지 마세요.')
      return true
    }
  }
  if (hooks.mode(projectId) === 'all' || always.get(projectId)?.has(key)) {
    reply(res, 'allow')
    return true
  }
  const ask: PermissionAsk = { id: randomUUID(), projectId, tool, title, detail, at: new Date().toISOString() }
  const answer = await new Promise<{ a: PermissionAnswer; why?: string }>((resolve) => {
    const timer = setTimeout(() => settle('deny', '디자이너가 한동안 답하지 않아서 거절했어요. 필요하면 다시 물어보세요.'), ANSWER_WITHIN)
    const settle = (a: PermissionAnswer, why?: string) => {
      clearTimeout(timer)
      if (!waiting.delete(ask.id)) return
      hooks?.changed(projectId, askingFor(projectId))
      resolve({ a, why })
    }
    waiting.set(ask.id, { ask, key, resolve: settle })
    // Claude Code gave up (session restarted or interrupted): take the card away
    res.on('close', () => {
      if (!res.writableEnded) settle('deny')
    })
    hooks!.changed(projectId, askingFor(projectId), ask)
  })
  if (answer.a === 'always') {
    if (!always.has(projectId)) always.set(projectId, new Set())
    always.get(projectId)!.add(key)
  }
  if (!res.writableEnded && !res.destroyed) reply(res, answer.a, answer.why)
  return true
}

export function answerPermission(projectId: string, id: string, answer: PermissionAnswer) {
  const w = waiting.get(id)
  if (w && w.ask.projectId === projectId) w.resolve(answer)
}

/** the session ended: open questions are denied, "계속 허용" is forgotten */
export function endPermissions(projectId: string) {
  for (const w of [...waiting.values()]) if (w.ask.projectId === projectId) w.resolve('deny', '대화가 다시 시작됐어요.')
  always.delete(projectId)
}
