// Parser for the compact, YAML-like text Magnific's MCP tools return
// ("Token-Oriented Object Notation"):
//   models[41]:
//     - slug: auto
//       name: Auto
//       aspectRatios[3]: "1:1","16:9","9:16"
//       agentRecommendation:
//         tier: sota
//   instruction: "…"
// Only what the catalogues use: nested objects by indentation, "- " list items,
// inline arrays "key[n]: a,b" and quoted / plain scalars.

type Value = string | number | boolean | null | Value[] | { [k: string]: Value }

interface Line {
  indent: number
  text: string
}

function scalar(raw: string): Value {
  const s = raw.trim()
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '') return s === '' ? '' : null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

/** a,b,"c,d" → ["a","b","c,d"] */
function splitInline(raw: string): Value[] {
  const out: Value[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"' && raw[i - 1] !== '\\') quoted = !quoted
    if (ch === ',' && !quoted) {
      out.push(scalar(cur))
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(scalar(cur))
  return out
}

const KEY = /^([A-Za-z_][\w.-]*)(\[\d+\])?:\s?(.*)$/

function parseBlock(lines: Line[], start: number, indent: number): [Value, number] {
  // a block is either a list ("- " items) or an object (key: value lines)
  if (lines[start]?.text.startsWith('- ')) {
    const list: Value[] = []
    let i = start
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      // the item's first key sits after "- "; its other keys are indented by 2 more
      const first: Line = { indent: indent + 2, text: lines[i].text.slice(2) }
      const rest: Line[] = [first]
      let j = i + 1
      while (j < lines.length && lines[j].indent > indent) rest.push(lines[j++])
      const [item] = KEY.test(first.text) ? parseBlock(rest, 0, indent + 2) : [scalar(first.text)]
      list.push(item)
      i = j
    }
    return [list, i]
  }
  const obj: Record<string, Value> = {}
  let i = start
  while (i < lines.length && lines[i].indent === indent) {
    const m = lines[i].text.match(KEY)
    if (!m) {
      i++
      continue
    }
    const [, key, arr, rest] = m
    i++
    if (rest.trim()) obj[key] = arr ? splitInline(rest) : scalar(rest)
    else if (i < lines.length && lines[i].indent > indent) {
      const [v, next] = parseBlock(lines, i, lines[i].indent)
      obj[key] = v
      i = next
    } else obj[key] = arr ? [] : null
  }
  return [obj, i]
}

export function parseToon(text: string): Record<string, Value> | null {
  const lines: Line[] = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }))
  if (!lines.length || !KEY.test(lines[0].text)) return null
  const [v] = parseBlock(lines, 0, lines[0].indent)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Value>) : null
}
