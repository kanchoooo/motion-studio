// References: files or YouTube links the designer wants Claude to learn from.
// They live in <project>/references/ — outside composition/, the render root —
// so they can never end up in an exported video. Each one is analysed into
// keyframes (scene changes + the designer's ranges) that Claude can look at.
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ReferenceItem } from '@shared/brief'
import sharp from 'sharp'
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

/** YouTube downloads in progress, by reference id (stopped when the reference is removed) */
const downloads = new Map<string, ReturnType<typeof spawn>>()

export function removeReference(dir: string, id: string, notify: Notify) {
  downloads.get(id)?.kill()
  downloads.delete(id)
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
      // YouTube's JS challenges need a JavaScript runtime (without one formats go missing and
      // downloads fail): the app's own Electron runs as Node for it — nothing to install
      '--js-runtimes', `node:${process.execPath}`,
      '--match-filter', 'duration <= 600',
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', bin.ffmpeg(),
      '--write-info-json',
      '-o', join(folder, 'source.%(ext)s'),
      url.trim(),
    ],
    { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  )
  downloads.set(id, child)
  // what it says (a skipped long video is said on stdout, errors on stderr); read so the pipe never fills
  let err = ''
  child.stderr.on('data', (d) => (err = (err + d).slice(-20_000)))
  child.stdout.on('data', (d) => (err = (err + d).slice(-20_000)))
  child.on('error', () => {
    downloads.delete(id)
    patch(dir, id, { status: 'error', error: '영상을 내려받지 못했어요. 주소와 인터넷 연결을 확인해 주세요.' }, notify)
  })
  child.on('close', (code) => {
    downloads.delete(id)
    // removed while downloading: nothing left to update
    if (!existsSync(folder) || !listReferences(dir).some((x) => x.id === id)) return
    const file = readdirSync(folder).find((f) => f.startsWith('source.') && !f.endsWith('.json') && !f.endsWith('.part'))
    if (code !== 0 || !file) {
      patch(dir, id, { status: 'error', error: youtubeError(err) }, notify)
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

/** why yt-dlp could not download, said for the designer (its own words follow when nothing matches) */
export function youtubeError(stderr: string): string {
  const said = stderr.split(/\r?\n/).filter((l) => /^ERROR:/.test(l.trim())).pop()?.replace(/^\s*ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '').trim() ?? ''
  const all = `${said}\n${stderr}`
  if (/does not pass filter|duration/i.test(all) && /600|filter/i.test(all)) return '10분이 넘는 영상은 레퍼런스로 쓸 수 없어요.'
  if (/not a bot|confirm you.re not|sign in to confirm/i.test(all)) return '유튜브가 자동 접속으로 보고 막았어요. 잠시 뒤 다시 시도하거나, 영상을 내려받아 파일로 첨부해 주세요.'
  if (/private video/i.test(all)) return '비공개 영상이라 내려받을 수 없어요.'
  if (/age|inappropriate|confirm your age/i.test(said)) return '연령 제한 영상이라 로그인 없이 내려받을 수 없어요. 파일로 첨부해 주세요.'
  if (/members.only|join this channel/i.test(all)) return '채널 멤버십 전용 영상이라 내려받을 수 없어요.'
  if (/live event|is live|premieres/i.test(all)) return '라이브·최초 공개 중인 영상은 끝난 뒤에 받을 수 있어요.'
  if (/unavailable|removed|does not exist|not available in your country/i.test(all)) return '볼 수 없는 영상이에요(삭제됐거나 지역 제한). 주소를 확인해 주세요.'
  if (/getaddrinfo|timed out|connection|network|unable to download webpage/i.test(all)) return '영상을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.'
  return `영상을 내려받지 못했어요.${said ? ` (${said.slice(0, 160)})` : ' 주소와 인터넷 연결을 확인해 주세요.'}`
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
    // an overview of the whole video (1 s apart; longer videos wider) — Claude asks the designer which
    // part matters and looks at that part frame by frame with rangeSheets (look_at_reference)
    const step = overviewStep(duration)
    const { sheets, motion } = await makeSheets(src, join(dir, 'references', id), 'sheets', `references/${id}/sheets`, { from: 0, to: duration, step })
    patch(dir, id, { status: 'ready', error: undefined, meta: { duration, width: meta.width, height: meta.height }, frames, sheets, sheetStep: step, motion, cuts: cuts.map((t) => +t.toFixed(2)) }, notify)
  } catch (e) {
    patch(dir, id, { status: 'error', error: '분석하지 못했어요.' + (e instanceof Error ? ` (${e.message.slice(0, 120)})` : '') }, notify)
  }
}

const PER_SHEET = 20
const COLS = 5

/** seconds between overview frames: 1 s up to two minutes, then wider (≤ 120 frames, 6 sheets) */
export const overviewStep = (duration: number) => Math.max(1, Math.ceil(duration / 120))

/**
 * Sheets of frames between from and to, one every `step` seconds: 20 per sheet (5×4) with the
 * second written under each frame, plus how much of the picture changed per step (0–100), so the
 * moves and the still moments are easy to find.
 */
async function makeSheets(src: string, base: string, sub: string, relBase: string, o: { from: number; to: number; step: number }): Promise<{ sheets: { from: number; to: number; file: string }[]; motion: number[] }> {
  const seq = join(base, `${sub}-seq`)
  const out = join(base, sub)
  rmSync(seq, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
  mkdirSync(seq, { recursive: true })
  mkdirSync(out, { recursive: true })
  const span = ['-ss', String(o.from), '-t', String(Math.max(0.05, o.to - o.from))]
  await run(bin.ffmpeg(), ['-v', 'error', '-y', ...span, '-i', src, '-vf', `fps=${1 / o.step},scale=320:-2`, '-q:v', '5', join(seq, 'f%05d.jpg')], { maxBuffer: 16 * 1024 * 1024 })
  const files = readdirSync(seq).filter((f) => f.endsWith('.jpg')).sort()
  // change per step, from small grey thumbnails (32×18)
  const raw = (await run(bin.ffmpeg(), ['-v', 'error', ...span, '-i', src, '-vf', `fps=${1 / o.step},scale=32:18,format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })) as unknown as { stdout: Buffer }
  const px = 32 * 18
  const motion: number[] = []
  for (let k = 1; k * px + px <= raw.stdout.length; k++) {
    let d = 0
    for (let i = 0; i < px; i++) d += Math.abs(raw.stdout[k * px + i] - raw.stdout[(k - 1) * px + i])
    motion.push(+((d / px / 255) * 100).toFixed(1))
  }
  const sheets: { from: number; to: number; file: string }[] = []
  if (!files.length) return { sheets, motion }
  const first = await sharp(join(seq, files[0])).metadata()
  const w = first.width ?? 320
  const h = first.height ?? 180
  const label = 22
  const at = (k: number) => +(o.from + k * o.step).toFixed(2)
  for (let s = 0; s * PER_SHEET < files.length; s++) {
    const part = files.slice(s * PER_SHEET, (s + 1) * PER_SHEET)
    const rows = Math.ceil(part.length / COLS)
    const tiles = part.map((f, i) => {
      const t = at(s * PER_SHEET + i).toFixed(o.step < 1 ? 1 : 0)
      const x = (i % COLS) * (w + 4)
      const y = Math.floor(i / COLS) * (h + label + 4)
      return [
        { input: join(seq, f), left: x, top: y },
        { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${label}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#ffd166">${t}s</text></svg>`), left: x, top: y + h },
      ]
    })
    const name = `sheet_${String(s + 1).padStart(3, '0')}.jpg`
    await sharp({ create: { width: COLS * (w + 4) - 4, height: rows * (h + label + 4) - 4, channels: 3, background: '#222' } })
      .composite(tiles.flat())
      .jpeg({ quality: 78 })
      .toFile(join(out, name))
    sheets.push({ from: at(s * PER_SHEET), to: +Math.min(o.to, at((s + 1) * PER_SHEET - 1)).toFixed(2), file: `${relBase}/${name}` })
  }
  rmSync(seq, { recursive: true, force: true })
  return { sheets, motion }
}

/** most frames one look_at_reference call turns into sheets (10 sheets) */
export const MAX_RANGE_FRAMES = 200

/**
 * A part of a reference frame by frame (e.g. every 0.1 s to read a motion), made when Claude asks
 * and kept for the next time. Returns the sheets (project-relative jpgs) and the change per step.
 */
export async function rangeSheets(dir: string, id: string, from: number, to: number, step = 0.1): Promise<{ from: number; to: number; step: number; sheets: { from: number; to: number; file: string }[]; motion: number[]; clipped: boolean }> {
  const item = listReferences(dir).find((x) => x.id === id)
  if (!item?.file) throw new Error('그 첨부를 찾지 못했어요.')
  if (item.kind === 'image') throw new Error('이미지는 그대로 Read로 보면 돼요.')
  if (item.status !== 'ready') throw new Error('아직 분석 중이에요. 잠시 뒤 다시 보세요.')
  const duration = item.meta?.duration ?? to
  step = Math.min(5, Math.max(0.04, step))
  from = Math.max(0, Math.min(from, duration))
  to = Math.max(from + step, Math.min(to, duration))
  let clipped = false
  if ((to - from) / step > MAX_RANGE_FRAMES) {
    to = +(from + MAX_RANGE_FRAMES * step).toFixed(2)
    clipped = true
  }
  const sub = `range-${Math.round(from * 100)}-${Math.round(to * 100)}-${Math.round(step * 100)}`
  const base = join(dir, 'references', id)
  const cache = join(base, `${sub}.json`)
  if (existsSync(cache)) {
    const kept = JSON.parse(readFileSync(cache, 'utf8')) as { sheets: { from: number; to: number; file: string }[]; motion: number[] }
    if (kept.sheets.every((x) => existsSync(join(dir, x.file)))) return { from, to, step, ...kept, clipped }
  }
  const made = await makeSheets(join(dir, item.file), base, sub, `references/${id}/${sub}`, { from, to, step })
  writeFileSync(cache, JSON.stringify(made))
  return { from, to, step, ...made, clipped }
}

/** the file of an attachment the designer wants in the video (YouTube stays reference-only) */
export function referenceSource(dir: string, id: string): { path: string; item: ReferenceItem } {
  const item = listReferences(dir).find((x) => x.id === id)
  if (!item) throw new Error('그 첨부를 찾지 못했어요.')
  if (item.kind === 'youtube') throw new Error('유튜브 영상은 참고용으로만 쓸 수 있어요(저작권). 비슷한 소재를 만들거나 디자이너에게 원본 파일을 받아 주세요.')
  if (!item.file || !existsSync(join(dir, item.file))) throw new Error('첨부 파일이 아직 준비되지 않았어요.')
  return { path: join(dir, item.file), item }
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
