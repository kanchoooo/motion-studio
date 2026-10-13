// Project history on top of isomorphic-git (no git install needed).
// Every Claude turn, designer edit, brief change, export and restore becomes a
// commit; restoring writes an old tree back and records it as a NEW commit, so
// nothing is ever lost and a restore can itself be undone.
import fs from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import type { HistoryActor, HistoryEntry } from '@shared/project'
import { readJson, writeJson } from './util'

const AUTHOR = { name: '모션스튜디오', email: 'studio@motion-studio.local' }
const ROOTS = ['brief.json', 'overrides.json', 'composition', 'feedback']

export function isTracked(f: string): boolean {
  if (f === 'brief.json' || f === 'overrides.json') return true
  if (f.startsWith('feedback/')) return f.endsWith('.json')
  if (!f.startsWith('composition/')) return false
  // originals are never deleted, renders/snapshots are regenerable
  return !/^composition\/(assets|renders|snapshots|\.thumbnails)\//.test(f) && !f.endsWith('.tmp')
}

const repo = (dir: string) => ({ fs, dir, gitdir: join(dir, '.history') })

interface CommitMeta {
  actor: HistoryActor
  versionName?: string
  restoredFrom?: string
}

interface SideMeta {
  starred: Record<string, boolean>
  thumbnails: Record<string, string>
}
const sidePath = (dir: string) => join(dir, 'history-meta.json')
const readSide = (dir: string) => readJson<SideMeta>(sidePath(dir), { starred: {}, thumbnails: {} })

export async function initHistory(dir: string): Promise<void> {
  if (fs.existsSync(join(dir, '.history'))) return
  await git.init({ ...repo(dir), defaultBranch: 'main' })
}

/** tracked files currently on disk, as posix paths relative to the project */
function trackedWorkdirFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const abs = join(dir, rel)
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(rel ? `${rel}/${name}` : name)
    } else if (isTracked(rel)) out.push(rel)
  }
  for (const r of ROOTS) walk(r)
  return out
}

/**
 * Stages the tracked files by content. isomorphic-git's status trusts file
 * stats, so a same-size rewrite within the same second (Claude and the designer
 * editing back to back) would be missed; re-adding every tracked file hashes
 * the actual contents. Returns how many files differ from HEAD.
 */
async function stageChanges(dir: string): Promise<number> {
  const files = trackedWorkdirFiles(dir)
  for (const filepath of files) await git.add({ ...repo(dir), filepath })
  const head = await headOid(dir)
  if (head) {
    const present = new Set(files)
    for (const filepath of (await git.listFiles({ ...repo(dir), ref: head })).filter(isTracked)) {
      if (!present.has(filepath)) await git.remove({ ...repo(dir), filepath })
    }
  }
  const matrix = await git.statusMatrix({ ...repo(dir), filepaths: ROOTS, filter: isTracked })
  return matrix.filter(([, h, , s]) => (h === 1 && s !== 1) || (h === 0 && s !== 0)).length
}

async function headOid(dir: string): Promise<string | null> {
  try {
    return await git.resolveRef({ ...repo(dir), ref: 'HEAD' })
  } catch {
    return null
  }
}

/** Records the current project state. Returns null when nothing changed (unless forced). */
export async function record(
  dir: string,
  input: { actor: HistoryActor; summary: string; versionName?: string; restoredFrom?: string; force?: boolean },
): Promise<HistoryEntry | null> {
  await initHistory(dir)
  const changed = await stageChanges(dir)
  const head = await headOid(dir)
  if (!changed && head && !input.force) return null
  const meta: CommitMeta = { actor: input.actor, versionName: input.versionName, restoredFrom: input.restoredFrom }
  const message = `${input.summary.split('\n')[0].slice(0, 200)}\n\n${JSON.stringify(meta)}\n`
  const oid = await git.commit({ ...repo(dir), message, author: AUTHOR })
  return {
    id: oid,
    at: new Date().toISOString(),
    actor: input.actor,
    summary: input.summary,
    versionName: input.versionName,
    restoredFrom: input.restoredFrom,
  }
}

function parseMessage(message: string): { summary: string; meta: CommitMeta } {
  const [summary, ...rest] = message.split('\n')
  const body = rest.join('\n').trim()
  try {
    return { summary, meta: JSON.parse(body) as CommitMeta }
  } catch {
    return { summary, meta: { actor: 'app' } }
  }
}

export async function list(dir: string, limit = 300): Promise<HistoryEntry[]> {
  if (!(await headOid(dir))) return []
  const side = readSide(dir)
  const log = await git.log({ ...repo(dir), depth: limit })
  return log.map((c) => {
    const { summary, meta } = parseMessage(c.commit.message)
    return {
      id: c.oid,
      at: new Date(c.commit.author.timestamp * 1000).toISOString(),
      actor: meta.actor,
      summary,
      versionName: meta.versionName,
      restoredFrom: meta.restoredFrom,
      starred: !!side.starred[c.oid],
      thumbnail: side.thumbnails[c.oid],
    }
  })
}

export async function readFileAt(dir: string, oid: string, filepath: string): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ ...repo(dir), oid, filepath })
    return Buffer.from(blob).toString('utf8')
  } catch {
    return null
  }
}

/** Writes the tracked files of `oid` back into the project and records that as a new entry. */
export async function restore(dir: string, oid: string, summary: string): Promise<HistoryEntry | null> {
  // capture anything unsaved first so the restore itself can be undone
  await record(dir, { actor: 'app', summary: '되돌리기 전 자동 저장' })
  const head = await headOid(dir)
  const targetFiles = (await git.listFiles({ ...repo(dir), ref: oid })).filter(isTracked)
  const headFiles = head ? (await git.listFiles({ ...repo(dir), ref: head })).filter(isTracked) : []
  const keep = new Set(targetFiles)
  for (const f of headFiles) {
    if (!keep.has(f)) fs.rmSync(join(dir, f), { force: true })
  }
  for (const f of targetFiles) {
    const { blob } = await git.readBlob({ ...repo(dir), oid, filepath: f })
    const abs = join(dir, f)
    fs.mkdirSync(join(abs, '..'), { recursive: true })
    fs.writeFileSync(abs, Buffer.from(blob))
  }
  return record(dir, { actor: 'designer', summary, restoredFrom: oid, force: true })
}

export type RestoreScope = 'composition' | 'overrides' | 'brief'
const inScope = (f: string, scope: RestoreScope) => (scope === 'composition' ? f.startsWith('composition/') : f === `${scope}.json`)

/** brings back only part of an earlier state (the video, the direct edits or the brief) */
export async function restorePartial(dir: string, oid: string, scope: RestoreScope, summary: string): Promise<HistoryEntry | null> {
  await record(dir, { actor: 'app', summary: '되돌리기 전 자동 저장' })
  const head = await headOid(dir)
  const targetFiles = (await git.listFiles({ ...repo(dir), ref: oid })).filter((f) => isTracked(f) && inScope(f, scope))
  const headFiles = head ? (await git.listFiles({ ...repo(dir), ref: head })).filter((f) => isTracked(f) && inScope(f, scope)) : []
  const keep = new Set(targetFiles)
  for (const f of headFiles) if (!keep.has(f)) fs.rmSync(join(dir, f), { force: true })
  for (const f of targetFiles) {
    const { blob } = await git.readBlob({ ...repo(dir), oid, filepath: f })
    fs.mkdirSync(join(dir, f, '..'), { recursive: true })
    fs.writeFileSync(join(dir, f), Buffer.from(blob))
  }
  return record(dir, { actor: 'designer', summary, restoredFrom: oid, force: true })
}

export function setStar(dir: string, oid: string, starred: boolean): void {
  const side = readSide(dir)
  if (starred) side.starred[oid] = true
  else delete side.starred[oid]
  writeJson(sidePath(dir), side)
}

export function setThumbnail(dir: string, oid: string, relPath: string): void {
  const side = readSide(dir)
  side.thumbnails[oid] = relPath
  writeJson(sidePath(dir), side)
}

export async function latest(dir: string): Promise<string | null> {
  return headOid(dir)
}
