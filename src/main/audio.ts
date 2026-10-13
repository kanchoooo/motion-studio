// Audio in the composition: parses the <audio> elements Claude placed and
// applies the designer's audio edits (replacements, group replacements, timing,
// volume, extra BGM tracks) directly to index.html, so preview AND render
// (which reads the HTML) hear the same mix. Re-applied after every Claude turn.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BgmTrack, Overrides } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { isDev, appRoot } from './paths'

export interface AudioClip {
  id: string
  kind: 'sfx' | 'bgm' | 'other'
  /** effect family for sound effects (whoosh, pop…) */
  group?: string
  label: string
  src: string
  originalSrc: string
  start: number
  duration?: number
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

export function parseAudio(html: string): AudioClip[] {
  const out: AudioClip[] = []
  for (const m of html.matchAll(/<audio\b[^>]*>/gi)) {
    const tag = m[0]
    const id = attr(tag, 'data-ms-id')
    if (!id) continue
    const type = attr(tag, 'data-ms-type')
    out.push({
      id,
      kind: type === 'sfx' ? 'sfx' : type === 'bgm' ? 'bgm' : 'other',
      group: attr(tag, 'data-ms-sfx'),
      label: attr(tag, 'data-ms-label') ?? id,
      src: attr(tag, 'src') ?? '',
      originalSrc: attr(tag, 'data-ms-original-src') ?? attr(tag, 'src') ?? '',
      start: parseFloat(attr(tag, 'data-start') ?? '0') || 0,
      duration: attr(tag, 'data-duration') ? parseFloat(attr(tag, 'data-duration')!) : undefined,
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
  return html.replace(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i, (tag) => {
    const authoredAttr = attr(tag, 'data-ms-authored-duration')
    const authored = parseFloat(authoredAttr ?? attr(tag, 'data-duration') ?? '0')
    if (!authored) return tag
    const remap = o.timeRemap ?? []
    if (!o.keepTotalDuration && remap.length) {
      const len = makeTimeMap(authored, remap).length
      let t = setRootAttr(tag, 'data-ms-authored-duration', String(+authored.toFixed(4)))
      t = setRootAttr(t, 'data-duration', String(+len.toFixed(4)))
      return t
    }
    if (authoredAttr == null) return tag
    return setRootAttr(setRootAttr(tag, 'data-duration', String(+authored.toFixed(4))), 'data-ms-authored-duration', null)
  })
}

function setRootAttr(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s${name}="[^"]*"`)
  if (value == null) return tag.replace(re, '')
  return re.test(tag) ? tag.replace(re, ` ${name}="${esc(value)}"`) : tag.replace(/\s*>$/, ` ${name}="${esc(value)}">`)
}

/** returns the HTML with every designer audio edit applied (idempotent) */
export function applyAudio(html: string, o: Overrides): string {
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
    const changedSrc = src !== original
    const changedVol = Math.abs(volume - parseFloat(originalVolume)) > 1e-6
    next = setAttr(next, 'src', src)
    next = setAttr(next, 'data-ms-original-src', changedSrc ? original : null)
    next = setAttr(next, 'data-volume', changedVol || attr(tag, 'data-volume') ? String(+volume.toFixed(3)) : null)
    next = setAttr(next, 'data-ms-original-volume', changedVol ? originalVolume : null)
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
    const block = `\n      ${BLOCK_START}\n${tracks.map((t) => `      ${bgmTag(t)}`).join('\n')}\n      ${BLOCK_END}`
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
