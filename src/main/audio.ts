// Audio in the composition: parses the <audio> elements Claude placed and
// applies the designer's audio edits (replacements, group replacements, timing,
// volume, extra BGM tracks) directly to index.html, so preview AND render
// (which reads the HTML) hear the same mix. Re-applied after every Claude turn.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BgmTrack, Keyframe, Overrides } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { bin, isDev, appRoot } from './paths'

export interface AudioClip {
  id: string
  kind: 'sfx' | 'bgm' | 'voice' | 'other'
  /** effect family for sound effects (whoosh, pop…) */
  group?: string
  label: string
  src: string
  originalSrc: string
  start: number
  duration?: number
  /** where in the file playback starts (seconds) */
  mediaStart?: number
  volume: number
  managed: boolean
}

const BLOCK_START = '<!-- ms:bgm:start (모션스튜디오가 관리하는 배경음악: 수정하지 마세요) -->'
const BLOCK_END = '<!-- ms:bgm:end -->'
const BLOCK_RE = /\n?[ \t]*<!-- ms:bgm:start[^>]*-->[\s\S]*?<!-- ms:bgm:end -->/g

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? m[1] : undefined
}
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function setAttr(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s${name}(="[^"]*")?(?=[\\s>/])`)
  if (value == null) return tag.replace(re, '')
  const next = ` ${name}="${esc(value)}"`
  return re.test(tag) ? tag.replace(re, next) : tag.replace(/^<audio\b/, `<audio${next}`)
}

/** an attribute in either quote style (Claude does not always write double quotes) */
const anyAttr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined
}

/**
 * What a sound is when data-ms-type does not say (music Claude placed without the app's marks, a
 * workflow's id="el-bgm", an imported effect): its id, label, kind and file name, else its length
 * (a long or looping sound is music) — so it still shows in the Sound tab and the timeline
 */
export function audioKind(tag: string): 'bgm' | 'sfx' | 'voice' {
  const type = anyAttr(tag, 'data-ms-type')
  if (type === 'bgm' || type === 'sfx' || type === 'voice') return type
  if (anyAttr(tag, 'data-ms-sfx')) return 'sfx'
  const words = ['data-ms-id', 'id', 'class', 'data-ms-label', 'src'].map((n) => anyAttr(tag, n) ?? '').join(' ')
  if (/voice|narrat|(^|[\s_/.-])(tts|vo)([\s_.-]|$)|내레이션|나레이션|목소리|음성/i.test(words)) return 'voice'
  if (/bgm|music|song|track|soundtrack|배경음|음악|노래/i.test(words) || /\sloop(\s|=|>|$)/i.test(tag)) return 'bgm'
  if (/sfx|whoosh|swoosh|swish|swipe|pop|click|ding|chime|hit|impact|riser|boom|thud|effect|효과/i.test(words)) return 'sfx'
  return parseFloat(anyAttr(tag, 'data-duration') ?? '0') >= 6 ? 'bgm' : 'sfx'
}

const KIND_LABEL = { bgm: '배경음악', voice: '내레이션', sfx: '효과음' } as const

/**
 * Gives every <audio> the marks the Sound tab and the designer's sound edits need (data-ms-id,
 * data-ms-type, data-ms-label) when Claude left them out — attributes only, nothing plays
 * differently. The app's own music block is left alone.
 */
export function markAudio(html: string): string {
  const used = new Set([...html.matchAll(/\sdata-ms-id\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))
  let n = 0
  return html.replace(/<audio\b[^>]*>/gi, (tag) => {
    if (anyAttr(tag, 'data-ms-managed') === 'true') return tag
    const type = anyAttr(tag, 'data-ms-type')
    const hasId = !!anyAttr(tag, 'data-ms-id')
    if (hasId && (type === 'bgm' || type === 'sfx' || type === 'voice') && anyAttr(tag, 'data-ms-label')) return tag
    const kind = audioKind(tag)
    let next = tag
    if (!hasId) {
      const own = anyAttr(tag, 'id')
      let id = own && /^[\w-]+$/.test(own) && !used.has(own) ? own : ''
      while (!id || used.has(id)) id = `${kind}-${++n}`
      used.add(id)
      next = next.replace(/^<audio\b/i, `<audio data-ms-id="${id}"`)
    }
    if (type !== 'bgm' && type !== 'sfx' && type !== 'voice') next = setAttr(next.replace(/\sdata-ms-type\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ''), 'data-ms-type', kind)
    if (!anyAttr(next, 'data-ms-label')) {
      const file = (anyAttr(tag, 'src') ?? '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? ''
      next = setAttr(next, 'data-ms-label', kind === 'sfx' ? (anyAttr(tag, 'data-ms-sfx') ?? (file || KIND_LABEL.sfx)) : KIND_LABEL[kind])
    }
    return next
  })
}

export function parseAudio(html: string): AudioClip[] {
  const out: AudioClip[] = []
  for (const m of html.matchAll(/<audio\b[^>]*>/gi)) {
    const tag = m[0]
    const id = attr(tag, 'data-ms-id')
    if (!id) continue
    out.push({
      id,
      kind: audioKind(tag),
      group: attr(tag, 'data-ms-sfx'),
      label: attr(tag, 'data-ms-label') ?? id,
      src: attr(tag, 'src') ?? '',
      originalSrc: attr(tag, 'data-ms-original-src') ?? attr(tag, 'src') ?? '',
      start: parseFloat(attr(tag, 'data-start') ?? '0') || 0,
      duration: attr(tag, 'data-duration') ? parseFloat(attr(tag, 'data-duration')!) : undefined,
      mediaStart: parseFloat(attr(tag, 'data-media-start') ?? '0') || 0,
      volume: attr(tag, 'data-volume') ? parseFloat(attr(tag, 'data-volume')!) : 1,
      managed: attr(tag, 'data-ms-managed') === 'true',
    })
  }
  return out
}

function bgmTag(t: BgmTrack): string {
  const parts = [
    // the renderer only mixes media that has an id
    `id="${esc(t.id)}"`,
    `data-ms-id="${esc(t.id)}"`,
    'data-ms-type="bgm"',
    `data-ms-label="${esc(t.label)}"`,
    'data-ms-managed="true"',
    `src="${esc(t.src)}"`,
    `data-start="${Math.max(0, t.start).toFixed(3)}"`,
    `data-duration="${Math.max(0.1, t.end - t.start).toFixed(3)}"`,
    `data-media-start="${Math.max(0, t.mediaStart).toFixed(3)}"`,
    `data-volume="${Math.max(0, Math.min(2, t.volume)).toFixed(2)}"`,
    t.fadeIn > 0 ? `data-fade-in="${t.fadeIn.toFixed(2)}"` : '',
    t.fadeOut > 0 ? `data-fade-out="${t.fadeOut.toFixed(2)}"` : '',
    t.loop ? 'loop' : '',
  ].filter(Boolean)
  return `<audio ${parts.join(' ')}></audio>`
}

/**
 * Section speed that changes the total length must be visible statically: the
 * renderer takes the video length from the root's data-duration. Keeps the
 * authored length in data-ms-authored-duration (idempotent, reversible).
 */
export function applyLength(html: string, o: Overrides): string {
  const authored = authoredLength(html)
  const remap = o.timeRemap ?? []
  const out = html.replace(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i, (tag) => {
    const authoredAttr = attr(tag, 'data-ms-authored-duration')
    if (!authored) return tag
    // "총 길이 유지" keeps the length unless slowed sections make it longer (the end must not be cut)
    const len = remap.length ? makeTimeMap(authored, remap).length : authored
    const final = o.keepTotalDuration ? Math.max(authored, len) : len
    if (Math.abs(final - authored) > 1e-4) {
      let t = setRootAttr(tag, 'data-ms-authored-duration', String(+authored.toFixed(4)))
      t = setRootAttr(t, 'data-duration', String(+final.toFixed(4)))
      return t
    }
    if (authoredAttr == null) return tag
    return setRootAttr(setRootAttr(tag, 'data-duration', String(+authored.toFixed(4))), 'data-ms-authored-duration', null)
  })
  return applyMediaTiming(out, o, authored)
}

function authoredLength(html: string): number {
  const tag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0] ?? ''
  return parseFloat(attr(tag, 'data-ms-authored-duration') ?? attr(tag, 'data-duration') ?? '0') || 0
}

/**
 * Section speed for media the renderer reads from the static HTML: sound effects
 * and narration move with the picture, video clips inside one sped-up section
 * play faster. Authored values are kept in data-ms-authored-* (idempotent;
 * ms-runtime.js maps from them too, so the preview matches the export).
 */
export function applyMediaTiming(html: string, o: Overrides, authoredD = authoredLength(html)): string {
  const remap = (o.timeRemap ?? []).filter((s) => s.to > s.from && s.speed > 0)
  const M = remap.length && authoredD ? makeTimeMap(authoredD, remap) : null
  const finalLen = M ? (o.keepTotalDuration ? Math.max(authoredD, M.length) : M.length) : authoredD
  return html.replace(/<(audio|video)\b[^>]*>/gi, (tag, kind: string) => {
    if (attr(tag, 'data-start') == null) return tag
    // the designer's own clips are placed in output time already
    if (/\sdata-ms-designer="/.test(tag)) return tag
    if (kind.toLowerCase() === 'audio' && !['sfx', 'voice'].includes(attr(tag, 'data-ms-type') ?? '')) return tag
    const s0 = parseFloat(attr(tag, 'data-ms-authored-start') ?? attr(tag, 'data-start') ?? '0') || 0
    // a video layer the designer moved in time (timeline bar): the renderer reads its start from here
    const id = attr(tag, 'data-ms-id')
    const ls = kind.toLowerCase() === 'video' && id ? +(o.elements?.[id]?.timing?.shift ?? 0) || 0 : 0
    const sb = Math.max(0, s0 + ls)
    const dRaw = attr(tag, 'data-ms-authored-dur') ?? attr(tag, 'data-duration')
    const d0 = dRaw == null ? NaN : parseFloat(dRaw)
    // authored playback rate ("none" = the attribute was not there)
    const r0 = attr(tag, 'data-ms-authored-rate') ?? attr(tag, 'data-playback-rate') ?? 'none'
    let t = tag
    if (!M) {
      if (ls) {
        // moved, no section speed: the moved start, the authored one kept aside
        t = setAttrAny(t, 'data-ms-authored-start', String(s0))
        t = setAttrAny(t, 'data-start', sb.toFixed(4))
        if (Number.isFinite(d0)) t = setAttrAny(setAttrAny(t, 'data-ms-authored-dur', String(d0)), 'data-duration', String(d0))
        return setAttrAny(t, 'data-ms-shift-baked', String(ls))
      }
      // no section speed: back to what Claude wrote
      if (attr(tag, 'data-ms-authored-start') == null) return tag
      t = setAttrAny(t, 'data-start', String(s0))
      if (Number.isFinite(d0)) t = setAttrAny(t, 'data-duration', String(d0))
      if (attr(tag, 'data-ms-authored-rate') != null) t = setAttrAny(t, 'data-playback-rate', r0 === 'none' ? null : r0)
      for (const n of ['data-ms-authored-start', 'data-ms-authored-dur', 'data-ms-authored-rate', 'data-ms-shift-baked']) t = setAttrAny(t, n, null)
      return t
    }
    const ns = M.toOutput(sb)
    t = setAttrAny(t, 'data-ms-authored-start', String(s0))
    t = setAttrAny(t, 'data-start', ns.toFixed(4))
    t = setAttrAny(t, 'data-ms-shift-baked', ls ? String(ls) : null)
    if (Number.isFinite(d0)) {
      const end = sb + d0 >= authoredD - 1e-3 ? finalLen : M.toOutput(sb + d0)
      t = setAttrAny(t, 'data-ms-authored-dur', String(d0))
      t = setAttrAny(t, 'data-duration', Math.max(0, end - ns).toFixed(4))
      if (kind.toLowerCase() === 'video') {
        const seg = M.segs.find((g) => sb >= g.a - 1e-6 && sb + d0 <= g.b + 1e-6)
        t = setAttrAny(t, 'data-ms-authored-rate', r0)
        const rate = (r0 === 'none' ? 1 : parseFloat(r0) || 1) * (seg ? seg.k : 1)
        t = setAttrAny(t, 'data-playback-rate', Math.abs(rate - 1) < 1e-6 && r0 === 'none' ? null : String(+rate.toFixed(4)))
      }
    }
    return t
  })
}

/** sets / removes an attribute on any opening tag */
function setAttrAny(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s${name}="[^"]*"`)
  if (value == null) return tag.replace(re, '')
  return re.test(tag) ? tag.replace(re, ` ${name}="${esc(value)}"`) : tag.replace(/\s*\/?>$/, (m) => ` ${name}="${esc(value)}"${m.trim()}`)
}

function setRootAttr(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s${name}="[^"]*"`)
  if (value == null) return tag.replace(re, '')
  return re.test(tag) ? tag.replace(re, ` ${name}="${esc(value)}"`) : tag.replace(/\s*>$/, ` ${name}="${esc(value)}">`)
}

// ---- volume over time (keyframes): the app writes the sound with its volume curve ----

/** the ffmpeg volume expression of keyframes (clip-local seconds; linear between keys, hold where asked) */
export function volumeExpr(keys: { t: number; v: number | string; e?: string }[]): string {
  const ks = keys.filter((k) => Number.isFinite(k.t) && Number.isFinite(Number(k.v))).sort((a, b) => a.t - b.t)
  if (!ks.length) return '1'
  const f = (n: number) => String(+n.toFixed(4))
  let expr = f(Number(ks[ks.length - 1].v))
  for (let i = ks.length - 2; i >= 0; i--) {
    const a = ks[i]
    const b = ks[i + 1]
    const va = Number(a.v)
    const vb = Number(b.v)
    const seg = a.e === 'hold' || b.t - a.t < 1e-4 ? f(va) : `${f(va)}+(${f(vb - va)})*(t-${f(a.t)})/${f(b.t - a.t)}`
    expr = `if(lt(t,${f(b.t)}),${seg},${expr})`
  }
  return `if(lt(t,${f(ks[0].t)}),${f(Number(ks[0].v))},${expr})`
}

/**
 * Clips with a volume curve: the sound from where the clip starts, for as long as it plays,
 * with the curve applied (assets/.ms-audio/<id>-<hash>.wav, made once per change). The page
 * and the export both play that file, at full volume.
 */
export function audioEnvelopes(dir: string, html: string, o: Overrides): Record<string, string> {
  const out: Record<string, string> = {}
  const make = (id: string, src: string, mediaStart: number, start: number, duration: number, keys: Keyframe[]) => {
    if (!src || !(duration > 0) || /^[a-z]+:/i.test(src)) return
    const local = keys.map((k) => ({ ...k, t: k.t - start }))
    const hash = createHash('sha1').update(JSON.stringify([src, mediaStart, duration, local])).digest('hex').slice(0, 10)
    const rel = `assets/.ms-audio/${id.replace(/[^\w-]/g, '_')}-${hash}.wav`
    const abs = join(dir, 'composition', rel)
    if (!existsSync(abs)) {
      const input = join(dir, 'composition', src)
      if (!existsSync(input)) return
      mkdirSync(dirname(abs), { recursive: true })
      try {
        execFileSync(bin.ffmpeg(), ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, mediaStart)), '-t', String(duration), '-i', input, '-af', `volume='${volumeExpr(local)}':eval=frame`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', abs], { timeout: 60_000 })
      } catch {
        return
      }
    }
    out[id] = rel
  }
  const D = parseFloat(html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0].match(/\sdata-duration="([^"]*)"/)?.[1] ?? '0') || 0
  for (const m of html.matchAll(/<audio\b[^>]*>/gi)) {
    const tag = m[0]
    const id = attr(tag, 'data-ms-id')
    const e = id ? o.audio?.[id] : undefined
    if (!id || !e?.volumeKeys?.length || attr(tag, 'data-ms-managed') === 'true') continue
    const group = attr(tag, 'data-ms-sfx')
    const g = group ? o.sfxGroups?.[group] : undefined
    const src = e.src ?? g?.src ?? attr(tag, 'data-ms-original-src') ?? attr(tag, 'src') ?? ''
    const start = e.start ?? (parseFloat(attr(tag, 'data-start') ?? '0') || 0)
    const duration = e.duration ?? (parseFloat(attr(tag, 'data-duration') ?? '') || Math.max(0, D - start))
    const mediaStart = parseFloat(attr(tag, 'data-ms-original-media-start') ?? attr(tag, 'data-media-start') ?? '0') || 0
    make(id, src, mediaStart, start, duration, e.volumeKeys)
  }
  for (const t of o.bgm ?? []) if (t.volumeKeys?.length) make(t.id, t.src, t.mediaStart, t.start, t.end - t.start, t.volumeKeys)
  return out
}

/** returns the HTML with every designer audio edit applied (idempotent) */
export function applyAudio(html: string, o: Overrides, env: Record<string, string> = {}): string {
  // 1. edits to Claude-placed audio (group replacement first, then per-element edits)
  let out = html.replace(/<audio\b[^>]*>/gi, (tag) => {
    const id = attr(tag, 'data-ms-id')
    if (!id || attr(tag, 'data-ms-managed') === 'true') return tag
    const original = attr(tag, 'data-ms-original-src') ?? attr(tag, 'src') ?? ''
    const originalVolume = attr(tag, 'data-ms-original-volume') ?? attr(tag, 'data-volume') ?? '1'
    const group = attr(tag, 'data-ms-sfx')
    const g = group ? o.sfxGroups?.[group] : undefined
    const e = o.audio?.[id]
    const src = e?.src ?? g?.src ?? original
    let volume = e?.volume ?? g?.volume ?? parseFloat(originalVolume)
    if (e?.muted) volume = 0
    let next = tag
    // a volume curve: the app's file has it (from the clip's start, at full volume)
    const curve = env[id]
    const originalMs = attr(tag, 'data-ms-original-media-start') ?? attr(tag, 'data-media-start')
    if (curve) volume = e?.muted ? 0 : 1
    const playSrc = curve ?? src
    const changedSrc = playSrc !== original
    const changedVol = Math.abs(volume - parseFloat(originalVolume)) > 1e-6
    next = setAttr(next, 'src', playSrc)
    next = setAttr(next, 'data-ms-original-src', changedSrc ? original : null)
    next = setAttr(next, 'data-volume', changedVol || attr(tag, 'data-volume') ? String(+volume.toFixed(3)) : null)
    next = setAttr(next, 'data-ms-original-volume', changedVol ? originalVolume : null)
    if (curve) {
      next = setAttr(next, 'data-ms-original-media-start', originalMs ?? '0')
      next = setAttr(next, 'data-media-start', '0')
    } else if (attr(tag, 'data-ms-original-media-start') != null) {
      next = setAttr(next, 'data-media-start', attr(tag, 'data-ms-original-media-start')!)
      next = setAttr(next, 'data-ms-original-media-start', null)
    }
    // the renderer only discovers (and mixes) media elements that have an id
    if (!attr(next, 'id')) next = setAttr(next, 'id', id)
    if (e?.start != null) next = setAttr(next, 'data-start', e.start.toFixed(3))
    if (e?.duration != null) next = setAttr(next, 'data-duration', e.duration.toFixed(3))
    return next
  })
  // 2. designer BGM tracks in a managed block right inside the root element
  out = out.replace(BLOCK_RE, '')
  const tracks = (o.bgm ?? []).filter((t) => t.src && t.end > t.start)
  if (tracks.length) {
    const block = `\n      ${BLOCK_START}\n${tracks.map((t) => `      ${bgmTag(env[t.id] ? { ...t, src: env[t.id], mediaStart: 0, volume: 1, loop: false } : t)}`).join('\n')}\n      ${BLOCK_END}`
    out = out.replace(/(<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>)/i, `$1${block}`)
  }
  return out
}

// ---- built-in sound effect library ------------------------------------------------

export interface SfxEntry {
  id: string
  label: string
  use: string
  duration: number
  file: string
}

export const sfxDir = () => (isDev ? join(appRoot(), 'resources', 'sfx') : join(process.resourcesPath, 'sfx'))

export function sfxLibrary(): SfxEntry[] {
  try {
    return JSON.parse(readFileSync(join(sfxDir(), 'library.json'), 'utf8')) as SfxEntry[]
  } catch {
    return []
  }
}

/** copies a built-in effect into the project; returns the composition-relative path */
export function useBuiltinSfx(projectDir: string, id: string): string | null {
  const entry = sfxLibrary().find((s) => s.id === id)
  if (!entry) return null
  const dir = join(projectDir, 'composition', 'assets', 'sfx')
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, entry.file)
  if (!existsSync(dst)) copyFileSync(join(sfxDir(), entry.file), dst)
  return `assets/sfx/${entry.file}`
}
