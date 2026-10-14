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
  if (!readOf(reads, 'hyperframes-creative', /^house-style\.md$/)) missing.push('Read hyperframes-creative/references/house-style.md')
  if (!readOf(reads, 'hyperframes-creative', /^video-composition\.md$/)) missing.push('Read hyperframes-creative/references/video-composition.md')
  if (!readOf(reads, 'hyperframes-creative', /^typography\.md$/)) missing.push('Read hyperframes-creative/references/typography.md (choose the font pairing from it)')
  if (!readOf(reads, 'hyperframes-animation', /^(blueprints|rules)-index\.md$/)) missing.push('Read hyperframes-animation/blueprints-index.md and rules-index.md (every scene cites a blueprint id or rule ids from them)')
  if (!existsSync(join(compDir, 'DESIGN.md'))) missing.push('Write composition/DESIGN.md: concept angle (one sentence), palette with hex, font pairing, focal element, edge anchors, background treatment, motion language')
  if (!existsSync(join(compDir, 'STORYBOARD.md'))) missing.push('Write composition/STORYBOARD.md: one "## Frame N" block per scene with time range, beat, on-screen copy, the cited blueprint id / rule ids, transition in and out, sound marks')
  return missing
}

/** before the first write of a new video: the cited recipes were read (null = go ahead) */
export function buildWriteMissing(compDir: string, transcript: string | null): string | null {
  if (!isEmptyComposition(compDir) || !existsSync(join(compDir, 'STORYBOARD.md'))) return null
  const reads = transcript ? readsIn(transcript) : []
  const recipe = reads.some((p) => /[\\/]hyperframes-animation[\\/](blueprints|rules)[\\/][^\\/]+\.md$/.test(p))
  return recipe ? null : 'Before writing the composition, Read the full body of every blueprint and rule your STORYBOARD.md cites (hyperframes-animation/blueprints/<id>.md, rules/<id>.md) and build each scene from it — general-video §5.4: "read the full recipe body before writing motion". Then write again.'
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
  const changes = changedSince(compDir, start.at)
  if (!changes.length) return null
  const last = Math.max(...changes)
  const first = Math.min(...changes)
  const uses = sessionFiles(transcript)
    .flatMap((f) => toolUses(records(f)))
    .filter((u) => u.at >= start.at)
  const after = uses.filter((u) => u.at > last - 500)
  const missing: string[] = []
  const checked = after.some((u) => (u.name === 'Bash' && /hyperframes\s+(check|lint)\b/.test(String(u.input.command ?? ''))) || /check_video$/.test(u.name))
  if (!checked) missing.push('Run `cd composition && hyperframes check` (and check_video) after your last change and fix what it reports.')
  const looked = after.some((u) => (u.name === 'Read' && /\.(png|jpe?g|webp)$/i.test(String(u.input.file_path ?? ''))) || /look_at_frames$/.test(u.name))
  if (!looked) missing.push('Look at the result after your last change: `hyperframes snapshot --at <each scene\'s key moments>` and Read the contact sheet, or look_at_frames on the changed moments. Judge it as a senior motion designer and fix what looks wrong.')
  const lastCheck = [...uses].reverse().find((u) => /check_video$/.test(u.name))
  if (lastCheck?.result && /ms_not_edit_ready/.test(lastCheck.result)) missing.push('check_video still reports ms_not_edit_ready: finish 편집 준비 (layout_snapshot before → measure_layout → absolute placement → layout_snapshot after) and run check_video again.')
  const build = !LIGHT_ASK.test(start.text) && (BUILD_ASK.test(start.text) || uses.some((u) => u.name === 'Write' && /composition[\\/]index\.html$/.test(String(u.input.file_path ?? ''))))
  // waiting for a helper that runs in the background: its result comes back as a new turn, checked then
  const notified = new Set(main.flatMap((r) => (r.type === 'queue-operation' && typeof r.content === 'string' ? [...r.content.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((m) => m[1]) : [])))
  const waiting = uses.some((u) => /Async agent launched|working in the background/i.test(u.result ?? '') && !notified.has(u.result?.match(/agentId:\s*([\w-]+)/)?.[1] ?? ''))
  if (waiting) return null
  if (build) {
    const lastCheckVideo = after.find((u) => /check_video$/.test(u.name))
    if (!lastCheckVideo) missing.push('Run check_video after your last change (it also checks 편집 준비 and the brief) and fix what it reports.')
    const reviewed = uses.some((u) => (u.name === 'Agent' || u.name === 'Task') && /motion-reviewer/.test(String(u.input.subagent_type ?? '')) && u.at > first - 500)
    if (!reviewed) missing.push('This was a build: dispatch the independent reviewer — Agent tool, subagent_type "motion-studio-hyperframes:motion-reviewer" — with the brief summary, the scene list and the latest contact sheet paths. Apply every [꼭] item (and the [권장] items that clearly raise quality), then check and look again.')
  }
  return missing.length ? missing : null
}
