// Finds generated media in an MCP tool result and saves it into the project
// (composition/assets/generated/), so compositions only ever use local files.
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { shortId } from '../util'

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'model/gltf-binary': '.glb',
}
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|svg|avif|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac|glb)$/i
const MAX_BYTES = 600 * 1024 * 1024

export interface SavedMedia {
  /** composition-relative, e.g. assets/generated/magnific-ab12cd-1.png */
  file: string
  kind: 'image' | 'video' | 'audio' | 'other'
  source: string
  bytes: number
}

export const kindOf = (ext: string): SavedMedia['kind'] =>
  /^\.(png|jpe?g|webp|gif|svg|avif)$/i.test(ext) ? 'image' : /^\.(mp4|mov|webm|m4v)$/i.test(ext) ? 'video' : /^\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(ext) ? 'audio' : 'other'

/** every http(s) URL in a JSON-ish value, with the key it was found under */
export function findUrls(value: unknown, key = '', out: { url: string; key: string }[] = []): { url: string; key: string }[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 2_000_000) {
      try {
        return findUrls(JSON.parse(trimmed), key, out)
      } catch {
        /* plain text */
      }
    }
    for (const m of value.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) out.push({ url: m[0].replace(/[.,;]+$/, ''), key })
  } else if (Array.isArray(value)) value.forEach((v) => findUrls(v, key, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) findUrls(v, k, out)
  return out
}

/** URLs that look like generated outputs rather than links to web pages or thumbnails of other things */
export function mediaUrls(value: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { url, key } of findUrls(value)) {
    if (seen.has(url)) continue
    seen.add(url)
    let path = ''
    try {
      path = new URL(url).pathname
    } catch {
      continue
    }
    // thumbnails, posters and links to web pages are not outputs
    if (/thumb|poster|preview_?image|preview_?url|web_?url|logo|avatar|icon|page|docs|help|pricing/i.test(key)) continue
    const keyHint = /(^|_)(url|uri|output|outputs|result|results|file|download|media|image|images|video|videos|audio|asset|src)(s|_url)?$/i.test(key)
    if (MEDIA_EXT.test(path) || keyHint) out.push(url)
  }
  return out
}

async function download(url: string, dir: string, base: string): Promise<SavedMedia | null> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) return null
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  let ext = extname(new URL(url).pathname).toLowerCase()
  if (!MEDIA_EXT.test(ext)) ext = EXT_BY_TYPE[type] ?? ''
  if (!ext || (!type.startsWith('image/') && !type.startsWith('video/') && !type.startsWith('audio/') && !MEDIA_EXT.test(ext) && type !== 'application/octet-stream')) return null
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) return null
  mkdirSync(dir, { recursive: true })
  const name = `${base}${ext === '.jpeg' ? '.jpg' : ext}`
  const abs = join(dir, name)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(abs))
  return { file: `assets/generated/${name}`, kind: kindOf(ext), source: url, bytes: statSync(abs).size }
}

/**
 * Saves the media of a tool result into <compositionDir>/assets/generated.
 * Inline base64 images/audio are written directly; URLs are downloaded.
 */
export async function saveResultMedia(compositionDir: string, prefix: string, result: { content?: object[]; structuredContent?: unknown }, limit = 8): Promise<SavedMedia[]> {
  const dir = join(compositionDir, 'assets', 'generated')
  const tag = `${prefix}-${shortId().slice(0, 6)}`
  const saved: SavedMedia[] = []
  let n = 0
  for (const c of (result.content ?? []) as { type: string; data?: string; mimeType?: string; resource?: { blob?: string; mimeType?: string; uri?: string } }[]) {
    const blob = c.type === 'image' || c.type === 'audio' ? c.data : c.type === 'resource' ? c.resource?.blob : undefined
    const mime = c.mimeType ?? c.resource?.mimeType ?? ''
    if (blob && EXT_BY_TYPE[mime] && saved.length < limit) {
      mkdirSync(dir, { recursive: true })
      const name = `${tag}-${++n}${EXT_BY_TYPE[mime]}`
      writeFileSync(join(dir, name), Buffer.from(blob, 'base64'))
      saved.push({ file: `assets/generated/${name}`, kind: kindOf(EXT_BY_TYPE[mime]), source: 'inline', bytes: statSync(join(dir, name)).size })
    }
  }
  const urls = mediaUrls([result.content, result.structuredContent])
  for (const url of urls) {
    if (saved.length >= limit) break
    try {
      const s = await download(url, dir, `${tag}-${++n}`)
      if (s) saved.push(s)
    } catch {
      /* not a downloadable file */
    }
  }
  return saved
}

/** downloads one URL (e.g. a track Claude found on Artlist) into the project */
export async function importUrl(compositionDir: string, url: string, prefix: string): Promise<SavedMedia> {
  if (!/^https:\/\//.test(url)) throw new Error('https 주소만 가져올 수 있어요.')
  const s = await download(url, join(compositionDir, 'assets', 'generated'), `${prefix}-${shortId().slice(0, 6)}`)
  if (!s) throw new Error('이 주소에서 이미지·영상·소리 파일을 받지 못했어요.')
  return s
}

