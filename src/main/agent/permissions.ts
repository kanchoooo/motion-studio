// Claude asks before doing something outside its standing permissions (running a
// command, reading a web page, writing outside the project): Claude Code's
// PermissionRequest hook POSTs here (an HTTP hook on 127.0.0.1) and waits. In
// "물어보기" mode the designer answers on a card in the chat; in "모두 허용" mode the
// app allows at once. Files the app manages stay denied by the session's deny
// rules in both modes (those never reach this hook).
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import type { AgentPermission, PermissionAsk } from '@shared/api'
import { findTranscript } from './transcript'
import { buildWriteMissing, stopMissing, turnKey } from './gates'

export type PermissionAnswer = 'allow' | 'always' | 'deny'

export interface PermissionHooks {
  projectFor(token: string): string | undefined
  mode(projectId: string): AgentPermission
  dirOf(projectId: string): string
  /** a new question for the designer (shown as a card) or one that went away */
  changed(projectId: string, asks: PermissionAsk[], added?: PermissionAsk): void
  /** the stop gate sent Claude back: the turn goes on */
  stopBlocked?(projectId: string): void
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

/** a shell command that writes an .html / .css / .js file (the composition) instead of using Edit / Write */
export function scriptEditsComposition(cmd: string): boolean {
  if (/\bsed\b[^|;&]*\s-i|\bperl\b[^|;&]*\s-p?i\b/.test(cmd)) return true
  if (/(>>?|\btee\b(\s+-a)?)\s*["']?[^\s"'|;&>]*\.(html?|css|m?js)\b/.test(cmd)) return true
  const writes = /\.write_text\(|\.write\(|writeFileSync\(|writeFile\(|open\([^)]*,\s*["'][wa]\+?["']/.test(cmd)
  return writes && /\.(html?|css|m?js)\b/.test(cmd)
}

/** /hook/<token>/… — true when the request was ours */
export async function handleHook(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (/\/pretool$/.test(path)) return handlePreTool(req, res, path)
  if (/\/stop$/.test(path)) return handleStop(req, res, path)
  return handlePermission(req, res, path)
}

/** turns sent back by the stop gate (session + turn start → count): at most twice per turn */
const stopBlocks = new Map<string, number>()
const MAX_STOP_BLOCKS = 2

/**
 * Stop hook: a turn that changed the video ends only after it was checked, looked at and
 * (for a build) reviewed. Otherwise Claude is sent back once or twice with what is missing.
 */
async function handleStop(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/hook\/([a-f0-9]+)\/stop$/)
  const projectId = m ? hooks?.projectFor(m[1]) : undefined
  const body = await readJson(req)
  const pass = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  if (!hooks || !projectId) {
    pass()
    return true
  }
  try {
    const session = typeof body.session_id === 'string' ? body.session_id : ''
    const transcript = (session && findTranscript(session)) || (typeof body.transcript_path === 'string' ? body.transcript_path : '')
    if (!transcript) return (pass(), true)
    const missing = stopMissing(join(hooks.dirOf(projectId), 'composition'), transcript)
    const key = `${session}:${turnKey(transcript)}`
    const n = stopBlocks.get(key) ?? 0
    if (stopBlocks.size > 200) stopBlocks.clear()
    if (!missing || n >= MAX_STOP_BLOCKS) return (pass(), true)
    stopBlocks.set(key, n + 1)
    hooks.stopBlocked?.(projectId)
    const reason = [
      'Motion Studio quality gate — the video changed in this turn, so it is not finished yet:',
      ...missing.map((x, i) => `${i + 1}. ${x}`),
      'Keep working (short Korean notes between steps). Do not mention this gate to the designer; reply only when the work is really done.',
    ].join('\n')
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ decision: 'block', reason }))
  } catch {
    pass()
  }
  return true
}

// The HyperFrames workflows only help when Claude reads them. Before the first write
// to the composition in a conversation, the router (or a workflow skill) must have been
// loaded with the Skill tool; otherwise the write is sent back with what to do.
const SKILL_RE = /(^|:)(hyperframes|motion-graphics|product-launch-video|general-video|music-to-video|faceless-explainer)$/
const skillsRead = new Set<string>()

export function readSkills(transcript: string): boolean {
  if (!existsSync(transcript)) return false
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.includes('"Skill"')) continue
    try {
      for (const c of (JSON.parse(line) as { message?: { content?: unknown } }).message?.content as { type?: string; name?: string; input?: { skill?: string } }[] ?? []) {
        if (c?.type === 'tool_use' && c.name === 'Skill' && SKILL_RE.test(String(c.input?.skill ?? ''))) return true
      }
    } catch {
      /* a partly written line */
    }
  }
  return false
}

// in Korean: Claude answers in the language of what it just read
const SKILL_FIRST =
  '영상을 쓰기 전에 HyperFrames 워크플로를 먼저 읽어야 해요: Skill 도구로 "motion-studio-hyperframes:hyperframes"(라우터)를 부르고, 라우터가 가리키는 워크플로 스킬(광고 영상이면 보통 motion-graphics나 product-launch-video)도 불러서 그대로 따르세요. 대화마다 한 번은 꼭 해야 하고, 작은 수정도 마찬가지예요. 그다음 이 수정을 다시 하세요. 이 안내는 디자이너에게 말하지 말고 한국어로 계속 작업하세요.'

async function handlePreTool(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/hook\/([a-f0-9]+)\/pretool$/)
  const projectId = m ? hooks?.projectFor(m[1]) : undefined
  const body = await readJson(req)
  const pass = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  if (!hooks || !projectId) {
    pass()
    return true
  }
  const input = (body.tool_input && typeof body.tool_input === 'object' ? body.tool_input : {}) as Record<string, unknown>
  const file = typeof input.file_path === 'string' ? input.file_path : ''
  let inside = false
  try {
    const dir = hooks.dirOf(projectId)
    // the same folder can be named two ways (/var → /private/var on macOS): compare real paths
    const real = (p: string) => {
      try {
        return realpathSync(p)
      } catch {
        return join(realpathSync(dirname(p)), basename(p))
      }
    }
    const rel = relative(real(join(dir, 'composition')), real(resolvePath(dir, file)))
    inside = !!file && !rel.startsWith('..') && !isAbsolute(rel) && /\.(html?|css|m?js)$/i.test(rel) && !/^(ms|vendor|assets|fonts)[\\/]/.test(rel)
  } catch {
    inside = false
  }
  const session = typeof body.session_id === 'string' ? body.session_id : ''
  if (!inside) {
    pass()
    return true
  }
  const transcript = (session && findTranscript(session)) || (typeof body.transcript_path === 'string' ? body.transcript_path : '')
  const deny = (reason: string) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
  if (!skillsRead.has(session)) {
    if (!transcript || !readSkills(transcript)) return (deny(SKILL_FIRST), true)
    skillsRead.add(session)
  }
  // the first write of a new video: the recipes the storyboard cites were read
  const recipes = buildWriteMissing(join(hooks.dirOf(projectId), 'composition'), transcript || null)
  if (recipes) return (deny(`${recipes} 이 안내는 디자이너에게 말하지 말고 한국어 메모로 계속 작업하세요.`), true)
  pass()
  return true
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
    if (scriptEditsComposition(cmd)) {
      reply(res, 'deny', '영상 파일은 셸 스크립트(python, node, sed -i, perl -i, > 리다이렉션, tee)가 아니라 Edit / Write 도구로만 고쳐 주세요. 디자이너가 명령마다 직접 허락해야 해요. 비슷한 수정이 많으면 Edit를 여러 번 쓰거나 Write로 파일을 한 번에 다시 쓰세요. 이 안내는 디자이너에게 말하지 말고 그대로 이어서 작업하세요.')
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
