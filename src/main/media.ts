import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import type { AssetMeta } from '@shared/brief'
import { bin } from './paths'

const run = promisify(execFile)

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
}

export const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

function svgSize(path: string): { width?: number; height?: number } {
  const head = readFileSync(path, 'utf8').slice(0, 4000)
  const tag = head.match(/<svg[^>]*>/i)?.[0] ?? ''
  const num = (a: string) => {
    const m = tag.match(new RegExp(`${a}="([\\d.]+)(px)?"`, 'i'))
    return m ? parseFloat(m[1]) : undefined
  }
  let width = num('width')
  let height = num('height')
  const vb = tag.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/i)
  if ((!width || !height) && vb) {
    width = parseFloat(vb[1])
    height = parseFloat(vb[2])
  }
  return { width, height }
}

export async function probeMedia(path: string): Promise<Omit<AssetMeta, 'bytes'>> {
  const mime = mimeOf(path)
  if (mime === 'image/svg+xml') return { mime, ...svgSize(path) }
  try {
    const { stdout } = await run(bin.ffprobe(), [
      '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path,
    ])
    const info = JSON.parse(stdout) as { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } }
    const v = info.streams?.find((s) => s.codec_type === 'video')
    const duration = info.format?.duration ? parseFloat(info.format.duration) : undefined
    const still = mime.startsWith('image/')
    return { mime, width: v?.width, height: v?.height, duration: still ? undefined : duration }
  } catch {
    return { mime }
  }
}

/** grabs one frame as a JPEG thumbnail */
export async function thumbnailFromVideo(video: string, out: string, at: number, width = 480): Promise<void> {
  await run(bin.ffmpeg(), ['-v', 'error', '-y', '-ss', String(Math.max(0, at)), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out])
}
