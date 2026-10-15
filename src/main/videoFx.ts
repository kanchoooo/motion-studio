// A clip played faster / slower or backwards (ElementOverride.videoFx): the app writes the
// processed clip once per change (assets/.ms-video/<id>-<hash>.mp4) and the layer shows that
// file, so the preview and the export are the same frames.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Overrides } from '@shared/overrides'
import { bin } from './paths'

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]

/** the clip a layer shows now (a layer the designer added, a replaced clip, or Claude's own) */
function clipOf(html: string, o: Overrides, id: string): string | null {
  const layer = o.layers.find((l) => l.id === id)
  if (layer) return layer.kind === 'video' ? layer.src ?? null : null
  if (o.elements[id]?.src) return o.elements[id].src!
  const at = html.search(new RegExp(`<[a-z]+\\b[^>]*data-ms-id="${id.replace(/[^\w~@:-]/g, '')}"`, 'i'))
  if (at < 0) return null
  const video = html.slice(at, at + 4000).match(/<video\b[^>]*>/i)?.[0]
  return video ? attr(video, 'src') ?? null : null
}

/** atempo works between 0.5× and 2× per step: longer changes are chained */
function atempo(speed: number): string {
  const steps: string[] = []
  let left = speed
  while (left > 2) {
    steps.push('atempo=2')
    left /= 2
  }
  while (left < 0.5) {
    steps.push('atempo=0.5')
    left /= 0.5
  }
  steps.push(`atempo=${+left.toFixed(4)}`)
  return steps.join(',')
}

/** id → composition-relative processed clip, for every layer with a speed change or played backwards */
export function videoEffects(dir: string, o: Overrides, html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, e] of Object.entries(o.elements)) {
    const fx = e.videoFx
    const speed = Math.max(0.1, Math.min(8, Number(fx?.speed ?? 1)))
    if (!fx || (Math.abs(speed - 1) < 1e-3 && !fx.reverse)) continue
    const src = clipOf(html, o, id)
    if (!src || /^[a-z]+:/i.test(src) || src.split('/').includes('..')) continue
    const input = join(dir, 'composition', src)
    if (!existsSync(input)) continue
    const st = statSync(input)
    const hash = createHash('sha1').update(JSON.stringify([src, st.size, st.mtimeMs, speed, !!fx.reverse])).digest('hex').slice(0, 10)
    const rel = `assets/.ms-video/${id.replace(/[^\w-]/g, '_')}-${hash}.mp4`
    const abs = join(dir, 'composition', rel)
    if (!existsSync(abs)) {
      mkdirSync(dirname(abs), { recursive: true })
      const v = [`setpts=PTS/${speed}`, ...(fx.reverse ? ['reverse'] : [])].join(',')
      const a = [atempo(speed), ...(fx.reverse ? ['areverse'] : [])].join(',')
      try {
        execFileSync(bin.ffmpeg(), ['-y', '-loglevel', 'error', '-i', input, '-vf', v, '-af', a, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', abs], { timeout: 180_000 })
      } catch {
        // a clip without sound: the picture alone
        try {
          execFileSync(bin.ffmpeg(), ['-y', '-loglevel', 'error', '-i', input, '-vf', v, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', abs], { timeout: 180_000 })
        } catch {
          continue
        }
      }
    }
    out[id] = rel
  }
  return out
}

/** the overrides the runtime reads: Claude's clips with a speed change show the processed file */
export function withProcessedClips(o: Overrides, fx: Record<string, string>): Overrides {
  if (!Object.keys(fx).length) return o
  const elements = { ...o.elements }
  for (const [id, rel] of Object.entries(fx)) if (!o.layers.some((l) => l.id === id)) elements[id] = { ...elements[id], src: rel }
  return { ...o, elements }
}
