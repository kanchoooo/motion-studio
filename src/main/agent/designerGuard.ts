// 직접 고친 레이어 보호: a layer the designer edited by hand (or added) is theirs. Claude changes it
// — its code or the designer's values — only when the designer's request is about it, or when the
// designer agreed after Claude asked. The app enforces it on Claude's edit tools and on file edits
// that reach those layers; the prompt tells Claude to ask first.
import type { FeedbackMark } from '@shared/project'
import type { Overrides } from '@shared/overrides'

export interface Approval {
  /** every layer (the app's own requests, or the designer said so) */
  all: boolean
  ids: Set<string>
}

const approvals = new Map<string, Approval>()
export const approvalOf = (projectId: string): Approval => approvals.get(projectId) ?? { all: false, ids: new Set() }
export const setApproval = (projectId: string, a: Approval) => approvals.set(projectId, a)

/** the designer's layers: edited by hand (more than a name or a lock) or added by them → their name */
export function designerLayers(ov: Overrides, html: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, e] of Object.entries(ov.elements ?? {})) {
    if (id.includes('::') || id === '__camera') continue
    if (!Object.keys(e).some((k) => k !== 'label' && k !== 'locked')) continue
    out.set(id, e.label ?? labelIn(html, id) ?? id)
  }
  for (const l of ov.layers ?? []) out.set(l.id, l.label ?? l.id)
  return out
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function labelIn(html: string, id: string): string | undefined {
  const tag = startTag(html, id)
  return tag?.match(/\bdata-ms-label="([^"]*)"/)?.[1]
}
function startTag(html: string, id: string): string | undefined {
  return html.match(new RegExp(`<[a-zA-Z][\\w-]*\\b[^>]*\\bdata-ms-id="${escRe(id)}"[^>]*>`))?.[0]
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
/** where an element's markup is in the page (start tag to its end tag) */
export function elementSpan(html: string, id: string): { from: number; to: number } | null {
  const m = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bdata-ms-id="${escRe(id)}"[^>]*>`).exec(html)
  if (!m) return null
  const name = m[1].toLowerCase()
  const from = m.index
  if (VOID.has(name) || m[0].endsWith('/>')) return { from, to: from + m[0].length }
  const re = new RegExp(`<(/?)${escRe(name)}\\b[^>]*>`, 'gi')
  re.lastIndex = from + m[0].length
  let depth = 1
  for (let t = re.exec(html); t; t = re.exec(html)) {
    if (t[0].endsWith('/>')) continue
    depth += t[1] ? -1 : 1
    if (!depth) return { from, to: t.index + t[0].length }
  }
  return { from, to: html.length }
}

/** how code names the layer: data-ms-id, its id attribute */
function namesOf(html: string, id: string): string[] {
  const out = [`data-ms-id="${id}"`, `data-ms-id='${id}'`]
  const own = startTag(html, id)?.match(/\bid="([^"]+)"/)?.[1]
  if (own) out.push(`#${own}`, `getElementById('${own}')`, `getElementById("${own}")`)
  return out
}

/** the code around each place that names the layer: its statement (a tween, a style line), or a CSS rule's body */
function mentions(text: string, names: string[]): string {
  const out: string[] = []
  const back = (i: number) => Math.max(text.lastIndexOf(';', i), text.lastIndexOf('\n', i), text.lastIndexOf('}', i)) + 1
  const ahead = (i: number) => {
    const ends = [text.indexOf(';', i), text.indexOf('\n', i)].filter((x) => x >= 0)
    return ends.length ? Math.min(...ends) : text.length
  }
  for (const n of names) {
    for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + n.length)) {
      const from = back(i)
      let to = ahead(i + n.length)
      const part = text.slice(from, to)
      // a rule left open ("#t2 {" or "#t1 { top: 1px"): its whole body
      if ((part.match(/{/g) ?? []).length > (part.match(/}/g) ?? []).length) {
        const close = text.indexOf('}', to)
        if (close >= 0) to = close + 1
      }
      out.push(text.slice(from, to))
    }
  }
  return out.join('\n')
}

/** the designer's layers whose markup, or code naming them, differs between two versions of the page */
export function touchedLayers(before: string, after: string, layers: Map<string, string>): string[] {
  const out: string[] = []
  for (const id of layers.keys()) {
    const a = elementSpan(before, id)
    const b = elementSpan(after, id)
    if (!a && !b) continue
    const markup = (t: string, sp: { from: number; to: number } | null) => (sp ? t.slice(sp.from, sp.to) : '')
    const names = [...new Set([...namesOf(before, id), ...namesOf(after, id)])]
    if (markup(before, a) !== markup(after, b) || mentions(before, names) !== mentions(after, names)) out.push(id)
  }
  return out
}

/** the page after an Edit / MultiEdit / Write tool call (null when it would not apply) */
export function pageAfter(tool: string, input: Record<string, unknown>, before: string): string | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (tool === 'Write') return str(input.content)
  const edits = tool === 'MultiEdit' && Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input]
  let page = before
  for (const e of edits) {
    const old = str(e.old_string)
    if (!old || !page.includes(old)) return null
    page = e.replace_all === true ? page.split(old).join(str(e.new_string)) : page.replace(old, () => str(e.new_string))
  }
  return page
}

const YES = /^(네|넵|예|응|웅|좋아|좋습니다|좋아요|그래|그렇게|ㅇㅇ|ok|오케이|바꿔|고쳐|진행|맞아|부탁|해\s*주세요|해줘)/i
const NO = /아니|말고|하지\s*마|건드리지|그대로\s*(두|둬)|싫/
const ALL = /(직접|손으로)\s*(고친|수정한|바꾼)\s*(것|거|레이어|부분)?\s*(도|까지)|수정한\s*(것|거)\s*도|손댄\s*(것|거|부분)\s*도/

/**
 * What a request lets Claude change among the designer's layers: the ones it marks or names, all of
 * them when the designer says so, and — for a short "yes" after Claude asked — the ones Claude named.
 */
export function approvalFor(input: { text: string; marks?: FeedbackMark[]; fromApp?: boolean }, layers: Map<string, string>, lastAsk?: string): Approval {
  if (input.fromApp) return { all: true, ids: new Set() }
  const text = input.text ?? ''
  if (ALL.test(text) && !NO.test(text)) return { all: true, ids: new Set() }
  const ids = new Set<string>()
  for (const m of input.marks ?? []) for (const e of m.elements ?? []) ids.add(e.id)
  const names = (id: string, label: string) => [id, label, ...(label.includes('·') ? [label.split('·').pop()!.trim()] : [])].filter((n) => n.length >= 2)
  for (const [id, label] of layers) if (names(id, label).some((n) => text.includes(n))) ids.add(id)
  const short = text.trim().length <= 40
  if (lastAsk && short && YES.test(text.trim()) && !NO.test(text)) {
    for (const [id, label] of layers) if (names(id, label).some((n) => lastAsk.includes(n))) ids.add(id)
  }
  return { all: false, ids }
}

/** what Claude is told when it reaches a designer's layer it was not asked about */
export function askFirst(names: string[]): string {
  return `These are layers the designer edited by hand: ${names.map((n) => `「${n}」`).join(', ')}. The designer's own edits are theirs — do not change these layers (their code, position, size, timing or the designer's values) unless the designer asked for it in this request. Leave them as they are and do the rest. If you really think one of them must change (something looks broken), ask the designer first in Korean, naming the layer and saying why, and wait for their answer.`
}
