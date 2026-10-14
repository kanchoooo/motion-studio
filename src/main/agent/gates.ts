// Quality gates. Claude in the app used to load the HyperFrames router and then improvise:
// a storyboard 30 s later, one big write, one passing check, "완성". These gates read the
// session transcript (and its subagents') and send Claude back with what the official
// workflow (and an independent review) still needs:
//  - storyboard: DESIGN.md + STORYBOARD.md written and the core references actually Read
//  - first build write: the cited blueprint / rule bodies Read
//  - end of a turn that changed the video: checked, looked at, and (for a build) reviewed
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

interface ToolUse {
  at: number
  name: string
  input: Record<string, unknown>
  id: string
  /** text of its result (when found) */
  result?: string
}

interface Rec {
  type?: string
  content?: string
  isMeta?: boolean
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  timestamp?: string
  message?: { content?: string | { type?: string; name?: string; id?: string; tool_use_id?: string; input?: Record<string, unknown>; content?: unknown; text?: string }[] }
}

/** the last transcript read (a hook may read the same file a few times in one call) */
let cache: { file: string; size: number; mtime: number; recs: Rec[] } | null = null

function records(file: string): Rec[] {
  if (!existsSync(file)) return []
  const st = statSync(file)
  if (cache && cache.file === file && cache.size === st.size && cache.mtime === st.mtimeMs) return cache.recs
  const out: Rec[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as Rec)
    } catch {
      /* a partly written line */
    }
  }
  cache = { file, size: st.size, mtime: st.mtimeMs, recs: out }
  return out
}

/** the transcripts of a session: the main one and its subagents' */
export function sessionFiles(transcript: string): string[] {
  const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
  let subs: string[] = []
  try {
    subs = readdirSync(dir)
      .filter((n) => n.endsWith('.jsonl'))
      .map((n) => join(dir, n))
  } catch {
    /* no subagents */
  }
  return [transcript, ...subs]
}

const resultText = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text?: unknown }).text ?? '') : '')).join('\n') : '')

function toolUses(recs: Rec[]): ToolUse[] {
  const uses: ToolUse[] = []
  const byId = new Map<string, ToolUse>()
  for (const r of recs) {
    const at = r.timestamp ? Date.parse(r.timestamp) : 0
    const content = Array.isArray(r.message?.content) ? r.message!.content : []
    for (const c of content as { type?: string; name?: string; id?: string; tool_use_id?: string; input?: Record<string, unknown>; content?: unknown }[]) {
      if (c?.type === 'tool_use' && c.name) {
        const u = { at, name: c.name, input: c.input ?? {}, id: c.id ?? '' }
        uses.push(u)
        if (c.id) byId.set(c.id, u)
      } else if (c?.type === 'tool_result' && c.tool_use_id) {
        const u = byId.get(c.tool_use_id)
        if (u) u.result = resultText(c.content)
      }
    }
  }
  return uses
}

/** what the designer last asked (the start of the current turn) */
function turnStart(recs: Rec[]): { at: number; text: string } {
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i]
    // hook feedback, a compaction summary and helper notifications are not the designer asking
    if (r.type !== 'user' || r.isMeta || r.isCompactSummary || r.isVisibleInTranscriptOnly) continue
    const c = r.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) && c.length && c.every((b) => b?.type === 'text' || b?.type === 'image') ? c.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n') : null
    if (text == null || !text.trim() || text.trim().startsWith('<')) continue
    return { at: r.timestamp ? Date.parse(r.timestamp) : 0, text }
  }
  return { at: 0, text: '' }
}

/** identity of the current turn (when the designer's message was written) */
export const turnKey = (transcript: string) => String(turnStart(records(transcript)).at)

/** every Read in the conversation (main session and subagents) */
export function readsIn(transcript: string): string[] {
  return sessionFiles(transcript).flatMap((f) =>
    toolUses(records(f))
      .filter((u) => u.name === 'Read' && typeof u.input.file_path === 'string')
      .map((u) => String(u.input.file_path)),
  )
}

const isEmptyComposition = (compDir: string) => {
  try {
    return /data-ms-empty/.test(readFileSync(join(compDir, 'index.html'), 'utf8'))
  } catch {
    return true
  }
}

/** a reference file of a skill (…/skills/<skill>/<sub>/<name>.md) */
const readOf = (reads: string[], skill: string, name: RegExp) => reads.some((p) => p.replace(/\\/g, '/').includes(`/${skill}/`) && name.test(basename(p)))

/** what is missing before the first storyboard of a new video (empty list = ready) */
export function storyboardMissing(compDir: string, transcript: string | null): string[] {
  if (!isEmptyComposition(compDir)) return []
  const missing: string[] = []
  const reads = transcript ? readsIn(transcript) : []
  if (!readOf(reads, 'hyperframes-creative', /^house-style\.md$/)) missing.push('hyperframes-creative/references/house-style.md 를 Read로 읽기')
  if (!readOf(reads, 'hyperframes-creative', /^video-composition\.md$/)) missing.push('hyperframes-creative/references/video-composition.md 를 Read로 읽기')
  if (!readOf(reads, 'hyperframes-creative', /^typography\.md$/)) missing.push('hyperframes-creative/references/typography.md 를 Read로 읽고 서체 짝을 거기서 고르기')
  if (!readOf(reads, 'hyperframes-animation', /^(blueprints|rules)-index\.md$/)) missing.push('hyperframes-animation/blueprints-index.md 와 rules-index.md 를 Read로 읽기 (장면마다 거기 있는 blueprint id나 rule id를 인용)')
  if (!existsSync(join(compDir, 'DESIGN.md'))) missing.push('composition/DESIGN.md 쓰기: 콘셉트 한 문장, 팔레트(hex), 서체 짝, 주인공 요소, 가장자리 앵커, 배경 처리, 모션 언어')
  if (!existsSync(join(compDir, 'STORYBOARD.md'))) missing.push('composition/STORYBOARD.md 쓰기: 장면마다 "## Frame N" 블록(시간, 비트, 화면 문구, 인용한 blueprint id·rule id, 들어오고 나가는 전환, 소리 표시)')
  return missing
}

/** before the first write of a new video: the cited recipes were read (null = go ahead) */
export function buildWriteMissing(compDir: string, transcript: string | null): string | null {
  if (!isEmptyComposition(compDir) || !existsSync(join(compDir, 'STORYBOARD.md'))) return null
  const reads = transcript ? readsIn(transcript) : []
  const recipe = reads.some((p) => /[\\/]hyperframes-animation[\\/](blueprints|rules)[\\/][^\\/]+\.md$/.test(p))
  return recipe ? null : '영상 파일을 쓰기 전에 STORYBOARD.md가 인용한 모든 blueprint·rule의 본문(hyperframes-animation/blueprints/<id>.md, rules/<id>.md)을 Read로 읽고 장면마다 그대로 따라 만드세요 (general-video §5.4: 모션을 쓰기 전에 레시피 본문 전체를 읽는다). 그다음 다시 쓰세요.'
}

/** composition files (html / css / js) changed after `since` (app-managed folders excluded) */
function changedSince(compDir: string, since: number): number[] {
  const out: number[] = []
  const walk = (d: string, depth: number) => {
    let names: string[] = []
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const n of names) {
      if (depth === 0 && /^(ms|vendor|assets|fonts|snapshots)$/.test(n)) continue
      if (n.startsWith('.') || n === 'node_modules') continue
      const p = join(d, n)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(p, depth + 1)
      } else if (/\.(html?|css|m?js)$/i.test(n) && st.mtimeMs > since) out.push(st.mtimeMs)
    }
  }
  walk(compDir, 0)
  return out
}

const BUILD_ASK = /콘티를 승인|이대로 만들|고도화|퀄리티|처음부터|전체적으로 다시|다시 만들어/
const LIGHT_ASK = /베리에이션이에요|템플릿 "[^"]+"으로 만들었어요/

/**
 * End of a turn: when the video changed, it must have been checked and looked at after the
 * last change, be edit-ready, and (for a build) have had an independent review.
 * Returns what is still missing (null = the turn may end).
 */
export function stopMissing(compDir: string, transcript: string): string[] | null {
  const main = records(transcript)
  const start = turnStart(main)
  // a long or annotated message was handed over as a file: what the designer wrote is in it
  const file = start.text.match(/\[모션스튜디오 메시지\]\s+(feedback\/msg-[\w-]+)\.md/)
  if (file) {
    try {
      start.text = readFileSync(join(compDir, '..', `${file[1]}.md`), 'utf8')
    } catch {
      /* keep the line */
    }
  }
  // the designer reads Korean: the reply that ends the turn must be Korean
  const finalText = [...main].reverse().find((r) => r.type === 'assistant' && Array.isArray(r.message?.content) && r.message!.content.some((b) => b?.type === 'text' && b.text?.trim()))
  const lastWords = finalText && Array.isArray(finalText.message?.content) ? finalText.message!.content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n') : ''
  const english = !!lastWords.trim() && (finalText?.timestamp ? Date.parse(finalText.timestamp) : 0) >= start.at && !/[\uac00-\ud7a3]/.test(lastWords)
  const KOREAN = '방금 마지막 답변이 한국어가 아니었어요. 같은 내용을 자연스러운 한국어로 다시 써서 답하세요(디자이너는 한국어로 읽어요). 앞으로 작업 중 메모도 한국어로만 쓰세요.'
  const changes = changedSince(compDir, start.at)
  if (!changes.length) return english ? [KOREAN] : null
  const last = Math.max(...changes)
  const first = Math.min(...changes)
  const uses = sessionFiles(transcript)
    .flatMap((f) => toolUses(records(f)))
    .filter((u) => u.at >= start.at)
  const after = uses.filter((u) => u.at > last - 500)
  const missing: string[] = []
  const checked = after.some((u) => (u.name === 'Bash' && /hyperframes\s+(check|lint)\b/.test(String(u.input.command ?? ''))) || /check_video$/.test(u.name))
  if (!checked) missing.push('마지막으로 고친 뒤에 `cd composition && hyperframes check`(와 check_video)를 돌리고 나온 문제를 고치세요.')
  const looked = after.some((u) => (u.name === 'Read' && /\.(png|jpe?g|webp)$/i.test(String(u.input.file_path ?? ''))) || /look_at_frames$/.test(u.name))
  if (!looked) missing.push('마지막으로 고친 뒤의 화면을 직접 보세요: `hyperframes snapshot --at <장면마다 핵심 순간>` 후 콘택트 시트를 Read로 열거나, 바뀐 순간을 look_at_frames로. 시니어 모션 디자이너의 눈으로 보고 어색한 곳을 고치세요.')
  const lastCheck = [...uses].reverse().find((u) => /check_video$/.test(u.name))
  if (lastCheck?.result && /ms_not_edit_ready/.test(lastCheck.result)) missing.push('check_video에 아직 ms_not_edit_ready가 있어요: 편집 준비(layout_snapshot before → measure_layout → 절대 위치 → layout_snapshot after)를 끝내고 check_video를 다시 돌리세요.')
  const build = !LIGHT_ASK.test(start.text) && (BUILD_ASK.test(start.text) || uses.some((u) => u.name === 'Write' && /composition[\\/]index\.html$/.test(String(u.input.file_path ?? ''))))
  // waiting for a helper that runs in the background: its result comes back as a new turn, checked then
  const notified = new Set(main.flatMap((r) => (r.type === 'queue-operation' && typeof r.content === 'string' ? [...r.content.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((m) => m[1]) : [])))
  const waiting = uses.some((u) => /Async agent launched|working in the background/i.test(u.result ?? '') && !notified.has(u.result?.match(/agentId:\s*([\w-]+)/)?.[1] ?? ''))
  if (waiting) return null
  if (build) {
    const lastCheckVideo = after.find((u) => /check_video$/.test(u.name))
    if (!lastCheckVideo) missing.push('마지막으로 고친 뒤에 check_video를 돌리고(편집 준비와 브리프도 확인해요) 나온 문제를 고치세요.')
    const reviewed = uses.some((u) => (u.name === 'Agent' || u.name === 'Task') && /motion-reviewer/.test(String(u.input.subagent_type ?? '')) && u.at > first - 500)
    if (!reviewed) missing.push('이번에는 영상을 새로 만들었어요: 독립 검수자(Agent 도구, subagent_type "motion-studio-hyperframes:motion-reviewer")에게 브리프 요약·장면 목록·최신 콘택트 시트 경로를 주고 검수를 맡기세요. [꼭] 항목은 모두, [권장] 항목은 품질이 확실히 오르는 것을 반영한 뒤 다시 검사하고 보세요.')
  }
  if (english) missing.push(KOREAN)
  return missing.length ? missing : null
}
