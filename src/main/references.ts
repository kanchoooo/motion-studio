// References: files or YouTube links the designer wants Claude to learn from.
// They live in <project>/references/ — outside composition/, the render root —
// so they can never end up in an exported video. Each one is analysed into
// keyframes (scene changes + the designer's ranges) that Claude can look at.
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ReferenceItem } from '@shared/brief'
import { probeMedia } from './media'
import { bin } from './paths'
import { newId, readJson, writeJson } from './util'

const run = promisify(execFile)
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv'])
export const REFERENCE_EXTENSIONS = [...IMAGE, ...VIDEO].map((e) => e.slice(1))

const indexFile = (dir: string) => join(dir, 'references', 'index.json')
export const listReferences = (dir: string) => readJson<ReferenceItem[]>(indexFile(dir), [])

type Notify = () => void

function save(dir: string, items: ReferenceItem[]) {
  writeJson(indexFile(dir), items)
}

function patch(dir: string, id: string, p: Partial<ReferenceItem>, notify: Notify) {
  const items = listReferences(dir)
  const i = items.findIndex((x) => x.id === id)
  if (i < 0) return
  items[i] = { ...items[i], ...p }
  save(dir, items)
  notify()
}

export function updateReference(dir: string, id: string, p: Pick<Partial<ReferenceItem>, 'title' | 'note' | 'ranges'>, notify: Notify) {
  patch(dir, id, p, notify)
  const item = listReferences(dir).find((x) => x.id === id)
  // new ranges deserve their own keyframes
  if (item && p.ranges && item.kind !== 'image' && item.file) void analyze(dir, id, notify)
}

export function removeReference(dir: string, id: string, notify: Notify) {
  save(dir, listReferences(dir).filter((x) => x.id !== id))
  rmSync(join(dir, 'references', id), { recursive: true, force: true })
  notify()
}

export function addReferenceFiles(dir: string, files: string[], notify: Notify): ReferenceItem[] {
  const added: ReferenceItem[] = []
  for (const src of files) {
    const ext = extname(src).toLowerCase()
    if (!IMAGE.has(ext) && !VIDEO.has(ext)) continue
    const id = newId().slice(0, 12)
    const folder = join(dir, 'references', id)
    mkdirSync(folder, { recursive: true })
    copyFileSync(src, join(folder, `source${ext}`))
    added.push({
      id,
      kind: IMAGE.has(ext) ? 'image' : 'video',
      title: src.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
      file: `references/${id}/source${ext}`,
      ranges: [],
      note: '',
      status: 'analyzing',
    })
  }
  save(dir, [...listReferences(dir), ...added])
  notify()
  for (const r of added) void analyze(dir, r.id, notify)
  return added
}

const YT = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|embed\/)|youtu\.be\/)/i

export function addYoutube(dir: string, url: string, notify: Notify): ReferenceItem {
  if (!YT.test(url.trim())) throw new Error('유튜브 주소(youtube.com, youtu.be)를 넣어 주세요.')
  const id = newId().slice(0, 12)
  const folder = join(dir, 'references', id)
  mkdirSync(folder, { recursive: true })
  const item: ReferenceItem = { id, kind: 'youtube', title: '유튜브 영상', url: url.trim(), ranges: [], note: '', status: 'downloading' }
  save(dir, [...listReferences(dir), item])
  notify()
  // analysis copy only: ≤720p, ≤10 minutes, no playlists
  const child = spawn(
    bin.ytdlp(),
    [
      '--no-playlist', '--no-progress', '--no-warnings',
      '--match-filter', 'duration <= 600',
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', bin.ffmpeg(),
      '--write-info-json',
      '-o', join(folder, 'source.%(ext)s'),
      url.trim(),
    ],
    { windowsHide: true },
  )
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  child.on('close', (code) => {
    const file = readdirSync(folder).find((f) => f.startsWith('source.') && !f.endsWith('.json') && !f.endsWith('.part'))
    if (code !== 0 || !file) {
      patch(dir, id, { status: 'error', error: /duration/.test(err) ? '10분이 넘는 영상은 레퍼런스로 쓸 수 없어요.' : '영상을 내려받지 못했어요. 주소와 인터넷 연결을 확인해 주세요.' }, notify)
      return
    }
    let title = '유튜브 영상'
    try {
      title = (JSON.parse(readFileSync(join(folder, 'source.info.json'), 'utf8')) as { title?: string }).title ?? title
    } catch {
      /* no info json */
    }
    patch(dir, id, { file: `references/${id}/${file}`, title, status: 'analyzing' }, notify)
    void analyze(dir, id, notify)
  })
  return item
}

/** scene-change keyframes + dense samples inside the designer's ranges */
export async function analyze(dir: string, id: string, notify: Notify) {
  const item = listReferences(dir).find((x) => x.id === id)
  if (!item?.file) return
  const src = join(dir, item.file)
  const folder = join(dir, 'references', id, 'frames')
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  try {
    const meta = await probeMedia(src)
    if (item.kind === 'image') {
      await run(bin.ffmpeg(), ['-v', 'error', '-y', '-i', src, '-vf', 'scale=960:-2', '-q:v', '3', join(folder, 'f0000.jpg')])
      patch(dir, id, { status: 'ready', meta: { width: meta.width, height: meta.height }, frames: [{ t: 0, file: `references/${id}/frames/f0000.jpg` }] }, notify)
      return
    }
    const duration = meta.duration ?? 0
    // scene changes
    const sc = await run(bin.ffmpeg(), ['-hide_banner', '-i', src, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], { maxBuffer: 32 * 1024 * 1024 }).catch((e) => e as { stderr: string })
    const cuts = [...String(sc.stderr ?? '').matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1]))
    const times = new Set<number>([0.1, ...cuts.map((t) => +Math.min(duration - 0.05, t + 0.15).toFixed(2))])
    if (times.size < 6) for (let i = 1; i < 8; i++) times.add(+((duration * i) / 8).toFixed(2))
    for (const r of item.ranges) {
      const step = Math.max(0.25, (r.to - r.from) / 8)
      for (let t = r.from; t <= r.to + 1e-6; t += step) times.add(+t.toFixed(2))
    }
    const picked = [...times].filter((t) => t >= 0 && t < Math.max(0.2, duration)).sort((a, b) => a - b).slice(0, 32)
    const frames: { t: number; file: string }[] = []
    for (const t of picked) {
      const name = `f${String(Math.round(t * 100)).padStart(6, '0')}.jpg`
      await run(bin.ffmpeg(), ['-v', 'error', '-y', '-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', join(folder, name)])
      if (existsSync(join(folder, name))) frames.push({ t, file: `references/${id}/frames/${name}` })
    }
    patch(dir, id, { status: 'ready', error: undefined, meta: { duration, width: meta.width, height: meta.height }, frames }, notify)
  } catch (e) {
    patch(dir, id, { status: 'error', error: '분석하지 못했어요.' + (e instanceof Error ? ` (${e.message.slice(0, 120)})` : '') }, notify)
  }
}

/** frames of a reference at given seconds, as JPEG files (for Claude) */
export async function referenceFramesAt(dir: string, id: string, times: number[]): Promise<{ t: number; file: string }[]> {
  const item = listReferences(dir).find((x) => x.id === id)
  if (!item?.file) return []
  const out = join(dir, '.cache', 'ref-frames')
  mkdirSync(out, { recursive: true })
  const res: { t: number; file: string }[] = []
  for (const t of times) {
    const f = join(out, `${id}-${Math.round(t * 100)}.jpg`)
    await run(bin.ffmpeg(), ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', join(dir, item.file), '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', f])
    if (existsSync(f)) res.push({ t, file: f })
  }
  return res
}

// ---- near-duplicate guard -----------------------------------------------------------

/** 64-bit difference hash of an image (9x8 grayscale), as a bit string */
export async function dHash(file: string): Promise<string> {
  const { stdout } = (await run(bin.ffmpeg(), ['-v', 'error', '-i', file, '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' })) as unknown as { stdout: Buffer }
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += stdout[y * 9 + x] > stdout[y * 9 + x + 1] ? '1' : '0'
  return bits
}

export const hamming = (a: string, b: string) => [...a].reduce((n, c, i) => n + (c !== b[i] ? 1 : 0), 0)

/**
 * Compares rendered frames of the video with every reference keyframe and
 * reports pairs that are almost identical (≤ 6 of 64 bits differ). Borrowing
 * ideas is fine; this only catches a frame that is essentially a copy.
 */
export async function nearDuplicates(dir: string, videoFrames: { t: number; file: string }[]): Promise<{ t: number; ref: string; refT: number; distance: number }[]> {
  const refs = listReferences(dir).filter((r) => r.status === 'ready' && r.frames?.length)
  if (!refs.length) return []
  const refHashes: { ref: string; refT: number; h: string }[] = []
  for (const r of refs) for (const f of r.frames!) refHashes.push({ ref: r.title, refT: f.t, h: await dHash(join(dir, f.file)) })
  const hits: { t: number; ref: string; refT: number; distance: number }[] = []
  for (const v of videoFrames) {
    const h = await dHash(v.file)
    // flat frames (solid backgrounds) hash alike without being copies
    if (/^0+$|^1+$/.test(h)) continue
    let best: { ref: string; refT: number; distance: number } | null = null
    for (const r of refHashes) {
      const d = hamming(h, r.h)
      if (!best || d < best.distance) best = { ref: r.ref, refT: r.refT, distance: d }
    }
    if (best && best.distance <= 6) hits.push({ t: v.t, ...best })
  }
  return hits
}
