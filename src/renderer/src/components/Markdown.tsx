import type { ReactNode } from 'react'

/** tiny, safe markdown for chat replies: paragraphs, bullets, numbers, headings, tables, **bold**, `code` */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    out.push(tok.startsWith('**') ? <b key={`${key}-${i++}`}>{tok.slice(2, -2)}</b> : <span key={`${key}-${i++}`} className="md-code">{tok.slice(1, -1)}</span>)
    last = m.index! + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={blocks.length} className="md-list">
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    )
    list = null
  }
  let table: string[][] | null = null
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const flushTable = () => {
    if (!table) return
    const [head, ...rows] = table
    const k = blocks.length
    blocks.push(
      <div key={k} className="md-table-wrap">
        <table className="md-table">
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i}>{inline(c, `${k}-h${i}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {head.map((_, ci) => (
                  <td key={ci}>{inline(r[ci] ?? '', `${k}-${ri}-${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    )
    table = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    // a table: "| a | b |" rows, the "|---|---|" line after the header is skipped
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush()
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && /-/.test(line)) continue
      ;(table ??= []).push(cells(line))
      continue
    }
    flushTable()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || num) {
      const ordered = !!num
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? num)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const h = line.match(/^#{1,4}\s+(.*)$/)
    blocks.push(
      <p key={blocks.length} className={h ? 'md-h' : 'md-p'}>
        {inline(h ? h[1] : line, String(blocks.length))}
      </p>,
    )
  }
  flush()
  flushTable()
  return <div className="md">{blocks}</div>
}
