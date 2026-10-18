// Export ("내보내기"): render, post-process, thumbnail, gallery index, history link.
import { execFile } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ExportOptions, ExportProgress } from '@shared/api'
import { OUTPUT_PRESETS, type Brief } from '@shared/brief'
import type { RenderRecord } from '@shared/project'
import * as history from './history'
import { lastLines, renderComposition, type HfProgress } from './hyperframes'
import { probeMedia, thumbnailFromVideo } from './media'
import { bin, runtimeFiles } from './paths'
import * as projects from './projects'
import { repairCompositionHead } from './headFix'
import { formatDate, newId, nowIso, readJson, safeName, uniquePath, writeJson } from './util'

const run = promisify(execFile)
const running = new Map<string, AbortController>()
/** the project folder each running export writes into */
const runningDirs = new Map<string, string>()
/** project folders with an export running (a folder must not move under it) */
export const exportingDirs = () => [...runningDirs.values()]

const EXT: Record<ExportOptions['format'], string> = {
  'mp4-h264': '.mp4',
  'mp4-h265': '.mp4',
  'mov-prores4444': '.mov',
  'webm-vp9': '.webm',
  'png-sequence': '',
}

const indexPath = (dir: string) => join(dir, 'renders', 'index.json')
export const listRenders = (dir: string) => readJson<RenderRecord[]>(indexPath(dir), [])

export function defaultFileName(brief: Brief, existing: RenderRecord[]): string {
  const ratio = (OUTPUT_PRESETS.find((p) => p.id === brief.output.preset)?.ratio ?? `${brief.output.width}x${brief.output.height}`).replace(':', 'x')
  const v = String(existing.length + 1).padStart(2, '0')
  const parts = [brief.client, brief.campaign || brief.title.split(' · ')[0], ratio, `${+brief.output.duration.toFixed(2)}s`, `v${v}`, formatDate()].filter((p) => p && p.trim())
  return safeName(parts.join('_')).replace(/\s+/g, '-')
}

const PHASE: Record<string, { phase: ExportProgress['phase']; message: string }> = {
  compile: { phase: 'preparing', message: '영상을 준비하고 있어요' },
  extract_video: { phase: 'preparing', message: '영상 소재를 읽고 있어요' },
  process_audio: { phase: 'preparing', message: '소리를 정리하고 있어요' },
  start_browsers: { phase: 'preparing', message: '렌더 엔진을 켜고 있어요' },
  capture: { phase: 'capturing', message: '프레임을 만들고 있어요' },
  encode: { phase: 'encoding', message: '영상 파일로 묶고 있어요' },
  assemble: { phase: 'finishing', message: '마무리하고 있어요' },
}

export async function startExport(projectId: string, opts: ExportOptions, emit: (p: ExportProgress) => void): Promise<string> {
  const dir = projects.pathOf(projectId)
  // a save folder that is gone (unplugged drive, deleted) is reported before rendering, not after
  if (opts.copyTo && !existsSync(opts.copyTo)) throw new Error(`저장 위치를 찾을 수 없어요: ${opts.copyTo}\n다른 폴더를 골라 주세요.`)
  const renderId = newId()
  const abort = new AbortController()
  running.set(renderId, abort)
  runningDirs.set(renderId, dir)
  const send = (p: Omit<ExportProgress, 'projectId' | 'renderId'>) => emit({ projectId, renderId, ...p })

  void (async () => {
    let out = ''
    try {
      const { brief } = projects.state(projectId)
      const rendersDir = join(dir, 'renders')
      mkdirSync(rendersDir, { recursive: true })
      const name = safeName(opts.fileName || defaultFileName(brief, listRenders(dir))).replace(/\s+/g, '-')
      out = uniquePath((n) => join(rendersDir, `${name}${n ? `-${n + 1}` : ''}${EXT[opts.format]}`))
      send({ phase: 'preparing', percent: 1, message: '영상을 준비하고 있어요' })
      repairCompositionHead(dir, dirname(runtimeFiles.gsap()))
      projects.refreshFontCss(dir)
      projects.applyAudioEdits(dir)
      // save the exact state being exported so the gallery item can be restored later
      const entry =
        (await history.record(dir, { actor: 'app', summary: `내보내기: ${basename(out)}`, versionName: opts.versionName, force: !!opts.versionName })) ??
        null
      const historyId = entry?.id ?? (await history.latest(dir)) ?? ''

      const target = opts.format === 'mp4-h265' ? out.replace(/\.mp4$/, '.h264.tmp.mp4') : out
      const res = await renderComposition(
        join(dir, 'composition'),
        target,
        { format: opts.format, quality: opts.quality, fps: brief.output.fps },
        (p: HfProgress) => {
          const ph = PHASE[p.code] ?? { phase: 'capturing' as const, message: '영상을 만들고 있어요' }
          const detail = p.code === 'capture' && p.total ? ` (${p.done}/${p.total})` : ''
          send({ phase: ph.phase, percent: Math.min(97, Math.max(1, p.pct)), message: ph.message + detail })
        },
        abort.signal,
      )
      if (abort.signal.aborted) {
        rmSync(target, { recursive: true, force: true })
        send({ phase: 'cancelled', percent: 0, message: '내보내기를 취소했어요' })
        return
      }
      if (res.code !== 0 || !existsSync(target)) throw new Error(lastLines(res.stderr || res.stdout, 15))

      if (opts.format === 'mp4-h265') {
        send({ phase: 'encoding', percent: 97, message: 'H.265로 변환하고 있어요' })
        await run(bin.ffmpeg(), ['-v', 'error', '-y', '-i', target, '-c:v', 'libx265', '-crf', '20', '-preset', 'medium', '-tag:v', 'hvc1', '-c:a', 'copy', out])
        rmSync(target, { force: true })
      }
      // same-ratio size variations keep the original composition and are scaled here
      const html = readFileSync(join(dir, 'composition', 'index.html'), 'utf8')
      const root = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0] ?? ''
      const cw = Number(root.match(/data-width="(\d+)"/)?.[1])
      const ch = Number(root.match(/data-height="(\d+)"/)?.[1])
      const { width: tw, height: th } = brief.output
      if (cw && ch && (cw !== tw || ch !== th) && Math.abs(cw / ch - tw / th) < 0.002 && opts.format !== 'png-sequence') {
        send({ phase: 'encoding', percent: 97, message: `${tw}×${th} 크기로 맞추고 있어요` })
        const scaled = out.replace(/(\.[a-z0-9]+)$/, '.scaled.tmp$1')
        const codec: Record<string, string[]> = {
          'mp4-h264': ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p'],
          'mp4-h265': ['-c:v', 'libx265', '-crf', '20', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'],
          'mov-prores4444': ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'],
          'webm-vp9': ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-pix_fmt', 'yuva420p'],
        }
        await run(bin.ffmpeg(), ['-v', 'error', '-y', '-i', out, '-vf', `scale=${tw}:${th}:flags=lanczos`, ...codec[opts.format], '-c:a', 'copy', scaled])
        renameSync(scaled, out)
      }
      if (!brief.output.audio && (opts.format === 'mp4-h264' || opts.format === 'mp4-h265')) {
        const silent = out.replace(/\.mp4$/, '.noaudio.tmp.mp4')
        await run(bin.ffmpeg(), ['-v', 'error', '-y', '-i', out, '-c', 'copy', '-an', silent])
        renameSync(silent, out)
      }

      send({ phase: 'finishing', percent: 98, message: '썸네일을 만들고 있어요' })
      const isSeq = opts.format === 'png-sequence'
      const thumbs = join(dir, 'thumbnails')
      mkdirSync(thumbs, { recursive: true })
      const thumbRel = join('thumbnails', `render-${renderId}.jpg`)
      if (!isSeq) {
        await thumbnailFromVideo(out, join(dir, thumbRel), brief.output.duration * 0.6).catch(() => null)
        if (existsSync(join(dir, thumbRel))) copyFileSync(join(dir, thumbRel), join(thumbs, 'latest.jpg'))
        if (historyId && existsSync(join(dir, thumbRel))) history.setThumbnail(dir, historyId, thumbRel)
      }
      const meta = isSeq ? null : await probeMedia(out)
      const record: RenderRecord = {
        id: renderId,
        file: join('renders', basename(out)),
        fileName: basename(out),
        createdAt: nowIso(),
        historyId,
        format: opts.format,
        width: meta?.width ?? brief.output.width,
        height: meta?.height ?? brief.output.height,
        duration: meta?.duration ?? brief.output.duration,
        bytes: isSeq ? 0 : statSync(out).size,
        thumbnail: isSeq || !existsSync(join(dir, thumbRel)) ? undefined : thumbRel,
        starred: false,
        note: '',
        versionName: opts.versionName,
      }
      writeJson(indexPath(dir), [record, ...listRenders(dir)])
      let savedTo: string | undefined
      if (opts.copyTo) {
        // never overwrite a file already in the designer's folder: "name-2.mp4" instead
        const ext = isSeq ? '' : extname(out)
        const stem = basename(out, ext)
        savedTo = uniquePath((n) => join(opts.copyTo!, `${stem}${n ? `-${n + 1}` : ''}${ext}`))
        if (isSeq) cpSync(out, savedTo, { recursive: true })
        else copyFileSync(out, savedTo)
      }
      projects.touch(projectId)
      send({ phase: 'done', percent: 100, message: '내보내기를 마쳤어요', record, savedTo })
    } catch (e) {
      send({
        phase: 'error',
        percent: 0,
        message: '영상을 내보내지 못했어요',
        detail: e instanceof Error ? e.message : String(e),
      })
    } finally {
      running.delete(renderId)
      runningDirs.delete(renderId)
    }
  })()
  return renderId
}

/** exports a project and all its variations one after another with each one's own settings */
export async function exportAll(projectId: string, quality: ExportOptions['quality'], emit: (p: ExportProgress) => void, busy: (id: string) => boolean = () => false): Promise<number> {
  // variations Claude has not re-laid out yet still hold the original's composition: never export those
  const members = projects.familyOf(projectId).filter((m) => m.hasVideo && (!m.family || m.family.status === 'done') && !busy(m.id))
  void (async () => {
    for (const m of members) {
      projects.openProject(m.path, { remember: false })
      const { brief } = projects.state(m.id)
      await new Promise<void>((resolve) => {
        void startExport(m.id, { format: brief.output.format, quality, fileName: '' }, (p) => {
          emit(p)
          if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') resolve()
        })
      })
    }
  })()
  return members.length
}

export function cancelExport(renderId: string) {
  running.get(renderId)?.abort()
}

export function updateRender(dir: string, renderId: string, patch: Partial<Pick<RenderRecord, 'starred' | 'note'>>): RenderRecord {
  const list = listRenders(dir)
  const i = list.findIndex((r) => r.id === renderId)
  if (i < 0) throw new Error('결과물을 찾을 수 없어요.')
  list[i] = { ...list[i], ...patch }
  writeJson(indexPath(dir), list)
  return list[i]
}

export function removeRender(dir: string, renderId: string): void {
  const list = listRenders(dir)
  const r = list.find((x) => x.id === renderId)
  if (!r) return
  rmSync(join(dir, r.file), { recursive: true, force: true })
  if (r.thumbnail) rmSync(join(dir, r.thumbnail), { force: true })
  writeJson(indexPath(dir), list.filter((x) => x.id !== renderId))
}

/** takes a render off the list without touching its file (결과물 모음: its file went to the Trash) */
export function forgetRender(dir: string, renderId: string): RenderRecord | undefined {
  const list = listRenders(dir)
  const r = list.find((x) => x.id === renderId)
  if (r) writeJson(indexPath(dir), list.filter((x) => x.id !== renderId))
  return r
}

export { safeName }

/** exports still running (the quit warning lists them; quitting cancels them) */
export const runningExports = () => running.size
export function cancelAllExports() {
  for (const a of running.values()) a.abort()
}
