// 프로젝트 공유: a project packed into one file (.msshare, a zip) for another designer to continue on
// their computer (Mac or Windows). It carries the video, its materials, brief, storyboard, the hand
// edits and the handoff memo — never the conversation: Claude's transcript is not in the project, and
// the designer's own messages (feedback/) and the version history that keeps them stay here. On the
// other side it becomes a new project whose Claude session starts by reading the memo.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type WriteStream } from 'node:fs'
import { once } from 'node:events'
import { dirname, join, normalize, sep } from 'node:path'
import { app } from 'electron'
import { strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import type { ProjectMeta } from '@shared/project'
import * as history from './history'
import { folderPath } from './folders'
import { newId, nowIso, readJson, safeName, uniquePath, writeJson } from './util'

export const SHARE_EXT = 'msshare'
/** the memo the next Claude session reads first (Claude may read .studio/, not edit it) */
export const HANDOFF_FILE = join('.studio', 'handoff.md')
const MANIFEST = 'msshare.json'
const FORMAT = 1

export interface ShareOptions {
  /** the designer's attachments (images, videos, YouTube links with their notes) */
  references: boolean
  /** AI images / clips made but not chosen yet */
  candidates: boolean
  /** the handoff memo, as the designer approved it */
  memo: string
}

/** what goes into a share, project-relative with '/' (never feedback/, .history, renders, chat, caches) */
export function shareFiles(dir: string, opts: Pick<ShareOptions, 'references' | 'candidates'>): string[] {
  const out: string[] = []
  const walk = (rel: string, skip: (rel: string) => boolean) => {
    const abs = join(dir, ...rel.split('/'))
    if (!existsSync(abs) || skip(rel)) return
    if (statSync(abs).isDirectory()) for (const name of readdirSync(abs)) walk(`${rel}/${name}`, skip)
    else out.push(rel)
  }
  const none = () => false
  for (const file of ['brief.json', 'overrides.json', 'storyboard.json']) walk(file, none)
  // the composition, without what is this machine's (HyperFrames' own state holds absolute paths) or
  // rebuilt from it (snapshots, check frames), and listening copies of sound candidates
  walk('composition', (rel) => /^composition\/(\.hyperframes|snapshots|\.cache)(\/|$)/.test(rel) || /^composition\/assets\/candidates(\/|$)/.test(rel) || /(^|\/)\.DS_Store$/.test(rel))
  // where the materials came from (licences), the storyboard's sketches, a template's slots
  walk('.studio/generated.json', none)
  walk('.studio/storyboard', none)
  walk('.studio/template.json', none)
  if (opts.candidates) walk('.studio/generations', none)
  if (opts.references) walk('references', none)
  walk('thumbnails/latest.jpg', none)
  return out
}

/** project.json as it travels: no conversation, no permissions or model choices of this designer */
function sharedMeta(meta: ProjectMeta): Partial<ProjectMeta> {
  return { name: meta.name, createdAt: meta.createdAt, updatedAt: meta.updatedAt, appVersion: meta.appVersion, editable: meta.editable, template: meta.template }
}

// already compressed: stored as they are (faster, no gain)
const STORED = /\.(mp4|mov|m4v|webm|mp3|m4a|aac|ogg|wav|flac|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|zip|gz)$/i

/** writes the share file; returns how many files and bytes went in */
export async function exportShare(dir: string, dest: string, opts: ShareOptions): Promise<{ files: number; bytes: number }> {
  const meta = readJson<ProjectMeta | null>(join(dir, 'project.json'), null)
  if (!meta) throw new Error('프로젝트 정보(project.json)를 읽을 수 없어요.')
  const files = shareFiles(dir, opts)
  const tmp = `${dest}.part`
  const out = createWriteStream(tmp)
  let bytes = 0
  let failed: Error | null = null
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) failed = err
    else {
      bytes += chunk.length
      out.write(chunk)
      if (final) out.end()
    }
  })
  const drain = async (s: WriteStream) => {
    if (s.writableNeedDrain) await once(s, 'drain')
  }
  try {
    const small = (name: string, text: string) => {
      const e = new ZipDeflate(name, { level: 6 })
      zip.add(e)
      e.push(strToU8(text), true)
    }
    small(MANIFEST, JSON.stringify({ format: FORMAT, app: app.getVersion(), name: meta.name, at: nowIso(), files: files.length }, null, 2))
    small('project.json', JSON.stringify(sharedMeta(meta), null, 2))
    small(HANDOFF_FILE.split(sep).join('/'), opts.memo.trim() + '\n')
    for (const rel of files) {
      const entry = STORED.test(rel) ? new ZipPassThrough(rel) : new ZipDeflate(rel, { level: 6 })
      zip.add(entry)
      for await (const chunk of createReadStream(join(dir, ...rel.split('/')))) {
        entry.push(chunk as Uint8Array)
        if (failed) throw failed
        await drain(out)
      }
      entry.push(new Uint8Array(0), true)
    }
    zip.end()
    await done
    if (failed) throw failed
    rmSync(dest, { force: true })
    renameSync(tmp, dest)
    return { files: files.length + 3, bytes }
  } catch (e) {
    out.destroy()
    rmSync(tmp, { force: true })
    throw e
  }
}

/** a name from the file, made safe and kept inside the target folder (no "../", no absolute paths) */
function safeTarget(root: string, name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.some((p) => p === '..' || /^[a-zA-Z]:$/.test(p))) return null
  const target = normalize(join(root, ...parts.map((p) => p.normalize('NFC'))))
  return target.startsWith(root + sep) ? target : null
}

/**
 * Unpacks a share file into a new project folder (in `folder` of the projects tree): a new id, no
 * conversation, a fresh version history, marked as shared so its first Claude session reads the memo.
 * Returns the project folder.
 */
export async function importShare(file: string, folder = ''): Promise<string> {
  const base = folderPath(folder)
  mkdirSync(base, { recursive: true })
  // unpacked into a hidden folder first (the projects list skips it), renamed when complete
  const tmp = join(base, `.import-${newId().slice(0, 8)}`)
  mkdirSync(tmp, { recursive: true })
  try {
    const writes: Promise<void>[] = []
    let bad: Error | null = null
    const uz = new Unzip((f) => {
      const target = safeTarget(tmp, f.name)
      if (!target || f.name.endsWith('/')) return
      mkdirSync(dirname(target), { recursive: true })
      const ws = createWriteStream(target)
      writes.push(
        new Promise((resolve, reject) => {
          ws.on('finish', resolve)
          ws.on('error', reject)
        }),
      )
      f.ondata = (err, data, final) => {
        if (err) bad = err
        else ws.write(data)
        if (final || err) ws.end()
      }
      f.start()
    })
    uz.register(UnzipInflate)
    for await (const chunk of createReadStream(file)) {
      uz.push(chunk as Uint8Array)
      if (bad) throw bad
    }
    uz.push(new Uint8Array(0), true)
    await Promise.all(writes)
    if (bad) throw bad
    const manifest = readJson<{ format?: number; name?: string } | null>(join(tmp, MANIFEST), null)
    if (!manifest || !existsSync(join(tmp, 'project.json')) || !existsSync(join(tmp, 'composition', 'index.html'))) throw new Error('모션스튜디오 공유 파일이 아니거나 손상됐어요.')
    if ((manifest.format ?? 0) > FORMAT) throw new Error('더 새 버전의 모션스튜디오에서 만든 공유 파일이에요. 앱을 업데이트한 뒤 열어 주세요.')
    rmSync(join(tmp, MANIFEST), { force: true })
    const name = safeName(manifest.name ?? '공유받은 프로젝트', '공유받은 프로젝트')
    let taken = 0
    const dir = uniquePath((n) => ((taken = n), join(base, `${name}${n ? ` ${n + 1}` : ''}.msproj`)))
    renameSync(tmp, dir)
    // one with the same name is already here: the copy is told apart by its name too ("… 2")
    const shownName = taken ? `${name} ${taken + 1}` : name
    const shared = readJson<Partial<ProjectMeta>>(join(dir, 'project.json'), {})
    const meta: ProjectMeta = {
      ...shared,
      id: newId(),
      name: shownName,
      createdAt: shared.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      appVersion: app.getVersion(),
      sharedFrom: { at: nowIso(), appVersion: shared.appVersion ?? '' },
    }
    writeJson(join(dir, 'project.json'), meta)
    if (existsSync(join(dir, 'composition', 'meta.json'))) writeJson(join(dir, 'composition', 'meta.json'), { id: meta.id, name: shownName })
    // the chat starts with a word about where the project came from (the old conversation does not come along)
    writeJson(join(dir, 'chat.json'), [{ id: newId(), at: nowIso(), role: 'notice', text: '공유받은 프로젝트예요. 첫 메시지를 보내면 Claude가 인계 메모를 먼저 읽고 이어서 작업해요. 이전 대화 기록은 넘어오지 않아요.' }])
    for (const sub of ['feedback', 'renders', 'thumbnails', 'references']) mkdirSync(join(dir, sub), { recursive: true })
    await history.initHistory(dir)
    await history.record(dir, { actor: 'app', summary: '공유받은 프로젝트를 열었어요' })
    return dir
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}
