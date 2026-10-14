// Finds the editable elements of a composition (data-ms-id + data-ms-type) in its HTML
// without a browser, for templates: the text of a text element, the file of an image,
// clip or narration, and rewrites those files in place. Claude's markup is regular
// (closed tags, quoted attributes), so a tag walk is enough; script / style bodies are
// skipped so strings inside them are never taken for tags.

export type SlotKind = 'text' | 'image' | 'video' | 'voice'

export interface FoundElement {
  id: string
  type: string
  label: string
  tag: string
  /** index of '<' of the opening tag, and just after its '>' */
  open: [number, number]
  /** inner HTML range (empty for void elements) */
  inner: [number, number]
  attrs: Record<string, string>
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->/g
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** every element that has data-ms-id, in document order */
export function findElements(html: string): FoundElement[] {
  const out: FoundElement[] = []
  const stack: { tag: string; el?: FoundElement }[] = []
  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(html))) {
    if (m[0].startsWith('<!--')) continue
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (closing) {
      // close up to the matching tag (tolerates a stray unclosed child)
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue
        for (let j = stack.length - 1; j >= i; j--) {
          const el = stack[j].el
          if (el && el.inner[1] < 0) el.inner[1] = j === i ? m.index : m.index
        }
        stack.length = i
        break
      }
      continue
    }
    const attrs = parseAttrs(m[3] ?? '')
    const end = m.index + m[0].length
    const el: FoundElement | undefined = attrs['data-ms-id']
      ? { id: attrs['data-ms-id'], type: (attrs['data-ms-type'] ?? '').toLowerCase(), label: attrs['data-ms-label'] ?? '', tag, open: [m.index, end], inner: [end, -1], attrs }
      : undefined
    if (el) out.push(el)
    if (tag === 'script' || tag === 'style') {
      const close = html.toLowerCase().indexOf(`</${tag}`, end)
      TAG.lastIndex = close < 0 ? html.length : close
      if (el) el.inner[1] = close < 0 ? html.length : close
      continue
    }
    if (VOID.has(tag) || m[4] === '/') {
      if (el) el.inner[1] = end
      continue
    }
    stack.push({ tag, el })
  }
  for (const e of out) if (e.inner[1] < 0) e.inner[1] = html.length
  return out
}

/** visible text of an element's inner HTML (line breaks kept as \n) */
export function textOf(innerHtml: string): string {
  return decode(
    innerHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim()
}

/** the media file an element shows: its own src, else the first <img>/<video>/<source> inside */
export function mediaOf(html: string, el: FoundElement): { src: string; at: [number, number] } | null {
  const own = el.attrs.src
  if (own) return { src: own, at: el.open }
  const inner = html.slice(el.inner[0], el.inner[1])
  const m = inner.match(/<(img|video|audio|source)\b[^>]*\ssrc\s*=\s*("[^"]*"|'[^']*')[^>]*>/i)
  if (!m || m.index == null) return null
  return { src: m[2].slice(1, -1), at: [el.inner[0] + m.index, el.inner[0] + m.index + m[0].length] }
}

/** the slot kind of an element, or null when it is not something a template can swap */
export function slotKind(el: FoundElement): SlotKind | null {
  if (el.type === 'text') return 'text'
  if (el.type === 'voice' || (el.tag === 'audio' && /voice|narration|내레이션/i.test(`${el.id} ${el.label}`))) return 'voice'
  if (el.type === 'video' || el.tag === 'video') return 'video'
  if (el.type === 'image' || el.tag === 'img') return 'image'
  return null
}

/** sets one attribute in the opening tag found at [start, end) */
export function setAttr(html: string, at: [number, number], name: string, value: string): string {
  const tag = html.slice(at[0], at[1])
  const esc = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i')
  const next = re.test(tag) ? tag.replace(re, `$1"${esc}"`) : tag.replace(/\s*(\/?)>$/, ` ${name}="${esc}"$1>`)
  return html.slice(0, at[0]) + next + html.slice(at[1])
}
