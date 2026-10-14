// Flat character images → SVG characters (ms-svg-character).
//  - convert: img2svg in a worker thread (the WASM tracer blocks for seconds). Next to
//    source.png it writes vector.svg, vector_shapes.json, vector_shapes.png (one tile
//    per shape, for Claude to look at) and vector_compare.png (image | SVG | difference).
//  - tag: Claude's part tags (tags.json) → tagged.svg, checked against the untagged SVG.
//  - embed: the tagged SVG goes inline into the composition, inside a host element.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { Worker } from 'node:worker_threads'
import { FLAT_CONVERT, MAX_DIFF_PCT, MAX_SHAPES, type CharacterInfo, type Framing } from '@shared/assetGen'
import { characterTools } from '../paths'
import { readJson, writeJson } from '../util'

interface WorkerResult {
  ok: boolean
  error?: string
  shapes?: number
  badPct?: number
  width?: number
  height?: number
  background?: boolean
}

const infoFile = (folder: string) => join(folder, 'character.json')

export function readCharacter(folder: string): CharacterInfo | null {
  return readJson<CharacterInfo | null>(infoFile(folder), null)
}

/** converts folder/source.png; the quality verdict is saved in character.json too */
export async function convertCharacter(projectDir: string, folder: string, framing: Framing, colors: number = FLAT_CONVERT.colors): Promise<CharacterInfo> {
  const base: CharacterInfo = { status: 'converting', dir: relative(projectDir, folder).split('\\').join('/'), framing, colors }
  const input = join(folder, 'source.png')
  if (!existsSync(input)) return { ...base, status: 'failed', pass: false, message: '변환할 이미지가 없어요.' }
  const r = await new Promise<WorkerResult>((resolve) => {
    const w = new Worker(join(characterTools(), 'worker.cjs'), { workerData: { input, outDir: folder, opts: { ...FLAT_CONVERT, colors } } })
    const limit = setTimeout(() => {
      void w.terminate()
      resolve({ ok: false, error: '변환이 너무 오래 걸려서 멈췄어요.' })
    }, 120_000)
    w.once('message', (m: WorkerResult) => {
      clearTimeout(limit)
      resolve(m)
      void w.terminate()
    })
    w.once('error', (e) => {
      clearTimeout(limit)
      resolve({ ok: false, error: e.message })
    })
  })
  let info: CharacterInfo
  if (!r.ok) info = { ...base, status: 'failed', pass: false, message: `SVG로 바꾸지 못했어요. ${r.error ?? ''}`.trim() }
  else {
    const reasons: string[] = []
    const max = MAX_SHAPES[framing]
    if ((r.shapes ?? 0) > max) reasons.push(`도형이 ${r.shapes}개로 많아요(기준 ${max}개). 그라데이션이나 질감이 섞인 그림일 수 있어요.`)
    if ((r.badPct ?? 100) > MAX_DIFF_PCT) reasons.push(`원본과 ${(r.badPct ?? 0).toFixed(1)}% 달라요(기준 ${MAX_DIFF_PCT}%).`)
    if (!r.background) reasons.push('배경이 단색이 아니어서 배경을 떼어 내지 못했어요.')
    info = { ...base, status: 'done', shapes: r.shapes, badPct: Number((r.badPct ?? 0).toFixed(2)), pass: reasons.length === 0, reasons }
  }
  writeJson(infoFile(folder), info)
  return info
}

// ---- tags --------------------------------------------------------------------------

interface TagLib {
  applyTags(svg: string, tags: unknown): { svg: string; report: string[] }
  prepareTags(svg: string, tags: unknown): Promise<{ tags: unknown; report: string[] }>
  diffRender(a: string, b: string, w: number, h: number): Promise<number>
}
interface CheckLib {
  checkCharacter(svg: string): Promise<{ sheet: Buffer; groups: { id: string; angle: number; cracks: number[]; ghosts: number[]; ok: boolean }[]; eyes: { id: string; rig: boolean }[]; ok: boolean }>
}
let tagLib: TagLib | null = null
const loadTagLib = () => (tagLib ??= createRequire(join(characterTools(), 'tag.cjs'))('./tag.cjs') as TagLib)
let checkLib: CheckLib | null = null
const loadCheckLib = () => (checkLib ??= createRequire(join(characterTools(), 'check.cjs'))('./check.cjs') as CheckLib)

/** applies Claude's tags.json: tagged.svg + how much it differs from vector.svg at rest (≤ 0.1% expected) */
export async function tagCharacter(folder: string, tags: unknown): Promise<{ report: string[]; diffPct: number }> {
  const vector = join(folder, 'vector.svg')
  if (!existsSync(vector)) throw new Error('이 소재에는 vector.svg가 없어요. 캐릭터 스타일로 만든 소재인지 확인하세요.')
  const svg = readFileSync(vector, 'utf8')
  const { applyTags, prepareTags, diffRender } = loadTagLib()
  // helpers that need the drawing (eye rigs) become plain tags first
  const prep = await prepareTags(svg, tags)
  const r = applyTags(svg, prep.tags)
  r.report.push(...prep.report)
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const diffPct = vb ? await diffRender(svg, r.svg, Math.round(+vb[1]), Math.round(+vb[2])) : 0
  writeFileSync(join(folder, 'tags.json'), JSON.stringify(tags, null, 1))
  writeFileSync(join(folder, 'tagged.svg'), r.svg)
  const info = readCharacter(folder)
  if (info) writeJson(infoFile(folder), { ...info, tagged: true })
  return { report: r.report, diffPct: Number(diffPct.toFixed(3)) }
}

/**
 * Turns every moving part to its largest angle (both ways) and looks for gaps and parts left
 * behind at the joints, and whether the eyes use the eye rig. Writes check_sheet.png (Claude
 * Reads it) and returns the numbers.
 */
export async function checkCharacterFolder(folder: string): Promise<{ sheet: string; ok: boolean; groups: { id: string; angle: number; cracks: number[]; ghosts: number[]; ok: boolean }[]; eyes: { id: string; rig: boolean }[] }> {
  const f = join(folder, 'tagged.svg')
  if (!existsSync(f)) throw new Error('tagged.svg가 없어요. 먼저 character_tag로 태그를 적용하세요.')
  const r = await loadCheckLib().checkCharacter(readFileSync(f, 'utf8'))
  writeFileSync(join(folder, 'check_sheet.png'), r.sheet)
  const out = { sheet: 'check_sheet.png', ok: r.ok, groups: r.groups, eyes: r.eyes }
  writeJson(join(folder, 'check.json'), out)
  return out
}

/** the part tree of tagged.svg without path data: ids, labels, pivots (for writing motion) */
export function characterParts(folder: string): { id: string; part: string; label?: string; pivot?: string; depth: number; maxRot?: number; eye?: string }[] {
  const f = join(folder, 'tagged.svg')
  if (!existsSync(f)) return []
  const svg = readFileSync(f, 'utf8')
  const out: { id: string; part: string; label?: string; pivot?: string; depth: number; maxRot?: number; eye?: string }[] = []
  for (const m of svg.matchAll(/<g\b([^>]*\bdata-part="([^"]+)"[^>]*)>/g)) {
    const attrs = m[1]
    const id = attrs.match(/\bid="([^"]+)"/)?.[1] ?? ''
    const maxRot = attrs.match(/data-max-rot="([^"]*)"/)?.[1]
    const eye = attrs.match(/data-eye="([^"]*)"/)?.[1]
    out.push({ id, part: m[2], label: attrs.match(/data-label="([^"]*)"/)?.[1], pivot: attrs.match(/data-pivot="([^"]*)"/)?.[1], depth: m[2].split('/').length - 1, ...(maxRot ? { maxRot: +maxRot } : {}), ...(eye ? { eye } : {}) })
  }
  return out
}

// ---- embed -------------------------------------------------------------------------

const START = (dir: string) => `<!--ms-character:${dir}-->`
const END = '<!--/ms-character-->'

/**
 * Puts the tagged SVG inline inside the host element of composition/index.html
 * (`<div data-ms-id="…" data-ms-character="<asset folder>">`). Running it again
 * replaces what it put there before. extraDefs / extraSvg add expression shapes
 * (inside <defs> / on top of the drawing); viewBox widens the canvas (e.g. 16:9).
 */
export function embedCharacter(projectDir: string, folder: string, hostId: string, opts: { extraDefs?: string; extraSvg?: string; viewBox?: string } = {}): { bytes: number } {
  const tagged = join(folder, 'tagged.svg')
  if (!existsSync(tagged)) throw new Error('tagged.svg가 없어요. 먼저 character_tag로 태그를 적용하세요.')
  const index = join(projectDir, 'composition', 'index.html')
  let html = readFileSync(index, 'utf8')
  const dir = relative(join(projectDir, 'composition'), folder).split('\\').join('/')
  const open = new RegExp(`<([a-z]+)\\b[^>]*\\bdata-ms-id="${hostId.replace(/[^\w-]/g, '')}"[^>]*>`, 'i').exec(html)
  if (!open) throw new Error(`index.html에 data-ms-id="${hostId}" 요소가 없어요. 먼저 그 자리에 빈 요소를 만들어 두세요.`)
  let svg = readFileSync(tagged, 'utf8').replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '')
  if (opts.viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${opts.viewBox}"`)
  // the host decides the size on screen
  svg = svg.replace(/<svg\b([^>]*)>/, (_m, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`)
  if (opts.extraDefs) svg = svg.includes('</defs>') ? svg.replace('</defs>', `${opts.extraDefs}\n</defs>`) : svg.replace(/(<svg\b[^>]*>)/, `$1<defs>${opts.extraDefs}</defs>`)
  if (opts.extraSvg) svg = svg.replace(/<\/svg>\s*$/, `${opts.extraSvg}\n</svg>`)
  const block = `${START(dir)}\n${svg.trim()}\n${END}`
  const s = html.indexOf(START(dir))
  const e = s >= 0 ? html.indexOf(END, s) : -1
  if (s >= 0 && e > s) html = html.slice(0, s) + block + html.slice(e + END.length)
  else {
    const at = open.index + open[0].length
    html = html.slice(0, at) + '\n' + block + '\n' + html.slice(at)
  }
  writeFileSync(index, html)
  return { bytes: Buffer.byteLength(block) }
}
