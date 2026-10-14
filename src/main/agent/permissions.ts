// Claude asks before doing something outside its standing permissions (running a
// command, reading a web page, writing outside the project): Claude Code's
// PermissionRequest hook POSTs here (an HTTP hook on 127.0.0.1) and waits. In
// "물어보기" mode the designer answers on a card in the chat; in "모두 허용" mode the
// app allows at once. Files the app manages stay denied by the session's deny
// rules in both modes (those never reach this hook).
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative } from 'node:path'
import type { AgentPermission, PermissionAsk } from '@shared/api'

export type PermissionAnswer = 'allow' | 'always' | 'deny'

export interface PermissionHooks {
  projectFor(token: string): string | undefined
  mode(projectId: string): AgentPermission
  dirOf(projectId: string): string
  /** a new question for the designer (shown as a card) or one that went away */
  changed(projectId: string, asks: PermissionAsk[], added?: PermissionAsk): void
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
