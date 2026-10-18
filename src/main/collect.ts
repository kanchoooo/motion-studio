// 결과물 모음 (관제 연동): every export also lands in one folder the console shows and cleans —
// <모음>/<folders…>/<project>/<file> — as an APFS clone (no extra space), else a hard link, else (only
// then) a plain copy, logged. An index tells the console what each file is. Deleting in the console
// (a request file) deletes the export in the app too (its original goes to the Trash), so space is
// really freed. Off unless console.json names the folder (see console.ts); nothing else changes then.
import { appendFileSync, constants, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { shell } from 'electron'
import type { ProjectSummary, RenderRecord } from '@shared/project'
import * as projects from './projects'
import { forgetRender, listRenders } from './renders'
import { nowIso, readJson, safeName, uniquePath } from './util'

export interface CollectItem {
  /** relative to the collection, '/' separated; a folder for a PNG sequence or an AE package */
  path: string
  projectId: string
  /** the render's id, or "ae:<folder>" for an After Effects package */
  renderId: string
  project: string
  /** the project's folder in the projects tree ('' = top) */
  folder: string
  /** the project's own folder inside the collection (relative) */
  dir: string
  createdAt: string
  format: string
  width?: number
  height?: number
  duration?: number
  fps?: number
  /** bytes (a folder: all its files) */
  size: number
  /** its project was deleted in the app: the collection keeps the file */
  orphan?: true
  /** cloning and linking failed: a real copy (twice the space) */
  copied?: true
  /** an AE package saved outside the project: deleting it in the console never touches that folder */
  external?: true
}
interface CollectIndex {
  version: 1
  items: CollectItem[]
}

let root: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let changed: () => void = () => {}

const metaDir = () => join(root!, '.motionstudio')
const indexFile = () => join(metaDir(), 'index.json')
const requestsDir = () => join(metaDir(), 'delete-requests')
const slash = (p: string) => p.split(sep).join('/')
const abs = (rel: string) => join(root!, ...rel.split('/'))
/** the console moves the old Remotion exports here: never ours to touch */
const OLD = '지난 결과물'

function log(line: string) {
  try {
    mkdirSync(metaDir(), { recursive: true })
    appendFileSync(join(metaDir(), 'log.txt'), `${nowIso()} ${line}\n`)
  } catch {
    /* the log is best effort */
  }
}

function readIndex(): CollectIndex {
  const ix = readJson<CollectIndex | null>(indexFile(), null)
  return ix && Array.isArray(ix.items) ? { version: 1, items: ix.items } : { version: 1, items: [] }
}
/** written whole and renamed into place: the console never reads half a file */
function writeIndex(ix: CollectIndex) {
  mkdirSync(metaDir(), { recursive: true })
  const tmp = `${indexFile()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(ix, null, 1))
  renameSync(tmp, indexFile())
}

// one change at a time (exports, deletes and the 10 s round can meet)
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

/** an APFS clone, else a hard link, else a copy (said in the log); folders file by file */
function clone(src: string, dst: string): { copied: boolean } {
  if (statSync(src).isDirectory()) {
    mkdirSync(dst, { recursive: true })
    let copied = false
    for (const name of readdirSync(src)) copied = clone(join(src, name), join(dst, name)).copied || copied
    return { copied }
  }
  mkdirSync(dirname(dst), { recursive: true })
  try {
    copyFileSync(src, dst, constants.COPYFILE_FICLONE_FORCE)
    return { copied: false }
  } catch {
    /* not on APFS (or another volume) */
  }
  try {
    linkSync(src, dst)
    return { copied: false }
  } catch {
    /* another volume */
  }
  copyFileSync(src, dst)
  return { copied: true }
}

function sizeOf(p: string): number {
  if (!existsSync(p)) return 0
  const st = statSync(p)
  if (!st.isDirectory()) return st.size
  return readdirSync(p).reduce((n, name) => n + sizeOf(join(p, name)), 0)
}

/** where a project's exports go: <folders…>/<name>, told apart from another project of the same name */
function projectDir(ix: CollectIndex, p: Pick<ProjectSummary, 'id' | 'name' | 'folder'>): string {
  const mine = ix.items.find((x) => x.projectId === p.id && !x.orphan)
  // a project already in keeps its folder (renames are followed by reconcile, all files at once)
  if (mine) return mine.dir
  const base = [...(p.folder ? p.folder.split('/') : []), safeName(p.name, '프로젝트').normalize('NFC')].join('/')
  for (let n = 0; ; n++) {
    const dir = n ? `${base} (${n + 1})` : base
    if (dir.split('/')[0] === OLD) continue
    const owner = ix.items.find((x) => x.dir === dir && x.projectId !== p.id)
    if (!owner && (!existsSync(abs(dir)) || !ix.items.some((x) => x.dir === dir))) return dir
  }
}

function summaryOf(projectId: string): ProjectSummary | undefined {
  return projects.listProjects().find((p) => p.id === projectId)
}

function fpsOf(projectDir: string): number | undefined {
  return readJson<{ output?: { fps?: number } } | null>(join(projectDir, 'brief.json'), null)?.output?.fps
}

/** adds one export (a render, or an AE package folder) unless it is in already */
function add(ix: CollectIndex, p: ProjectSummary, src: string, item: Omit<CollectItem, 'path' | 'project' | 'folder' | 'dir' | 'size'>): boolean {
  if (!existsSync(src) || ix.items.some((x) => x.projectId === p.id && x.renderId === item.renderId)) return false
  const dir = projectDir(ix, p)
  const name = basename(src)
  const ext = statSync(src).isDirectory() ? '' : extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  const dst = uniquePath((n) => abs(`${dir}/${stem}${n ? `-${n + 1}` : ''}${ext}`))
  const { copied } = clone(src, dst)
  if (copied) log(`copied (not cloned): ${src} → ${dst}`)
  ix.items.push({ ...item, path: slash(relative(root!, dst)), project: p.name, folder: p.folder, dir, size: sizeOf(dst), ...(copied ? { copied: true as const } : {}) })
  return true
}

function addRender(ix: CollectIndex, p: ProjectSummary, r: RenderRecord): boolean {
  return add(ix, p, join(p.path, r.file), { projectId: p.id, renderId: r.id, createdAt: r.createdAt, format: r.format, width: r.width, height: r.height, duration: r.duration, fps: fpsOf(p.path) })
}

function addAe(ix: CollectIndex, p: ProjectSummary, folder: string): boolean {
  const inside = relative(join(p.path, 'renders'), folder)
  const external = !inside || inside.startsWith('..') || inside.includes(sep)
  return add(ix, p, folder, { projectId: p.id, renderId: `ae:${basename(folder)}`, createdAt: existsSync(folder) ? statSync(folder).mtime.toISOString() : nowIso(), format: 'ae-package', fps: fpsOf(p.path), ...(external ? { external: true as const } : {}) })
}

/** AE packages in a project's renders/ (folders "<name>-AE[-n]" with data.json) */
function aeFolders(projectDir: string): string[] {
  const dir = join(projectDir, 'renders')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => /-AE(-\d+)?$/.test(n) && existsSync(join(dir, n, 'data.json')))
    .map((n) => join(dir, n))
}

/** every export of every project that is not in yet (뒤늦은 채움) */
function backfill() {
  const ix = readIndex()
  let added = 0
  for (const p of projects.listProjects()) {
    for (const r of listRenders(p.path)) if (addRender(ix, p, r)) added++
    for (const f of aeFolders(p.path)) if (addAe(ix, p, f)) added++
  }
  if (added) log(`filled in ${added} earlier export(s)`)
  writeIndex(ix)
  changed()
}

/**
 * The collection follows the app: a project renamed or moved (or its folder renamed) moves its
 * collection folder; a deleted project's files stay, marked orphan.
 */
function reconcile() {
  const ix = readIndex()
  const all = projects.listProjects()
  let dirty = false
  for (const id of [...new Set(ix.items.filter((x) => !x.orphan).map((x) => x.projectId))]) {
    const p = all.find((x) => x.id === id)
    const mine = ix.items.filter((x) => x.projectId === id && !x.orphan)
    if (!p) {
      for (const x of mine) x.orphan = true
      dirty = true
      continue
    }
    const from = mine[0].dir
    const to = projectDir({ version: 1, items: ix.items.filter((x) => x.projectId !== id) }, p)
    if (to === from && mine.every((x) => x.project === p.name && x.folder === p.folder)) continue
    if (to !== from) {
      try {
        if (existsSync(abs(from)) && !existsSync(abs(to))) {
          mkdirSync(dirname(abs(to)), { recursive: true })
          renameSync(abs(from), abs(to))
        }
      } catch (e) {
        log(`could not move ${from} → ${to}: ${e instanceof Error ? e.message : e}`)
        continue
      }
    }
    for (const x of mine) {
      if (to !== from && (x.path === from || x.path.startsWith(`${from}/`))) x.path = to + x.path.slice(from.length)
      x.dir = to
      x.project = p.name
      x.folder = p.folder
    }
    dirty = true
  }
  if (dirty) {
    writeIndex(ix)
    changed()
  }
}

/** 관제에서 지우기: the console deleted its copies; the exports go in the app too (originals to the Trash) */
async function processDeleteRequests() {
  if (!existsSync(requestsDir())) return
  for (const name of readdirSync(requestsDir()).filter((n) => n.endsWith('.json'))) {
    const file = join(requestsDir(), name)
    const req = readJson<{ items?: { path?: string; projectId?: string; renderId?: string }[] } | null>(file, null)
    const ix = readIndex()
    for (const it of req?.items ?? []) {
      const entry = ix.items.find((x) => (it.projectId && it.renderId ? x.projectId === it.projectId && x.renderId === it.renderId : x.path === it.path))
      const projectId = entry?.projectId ?? it.projectId
      const renderId = entry?.renderId ?? it.renderId
      const p = projectId ? summaryOf(projectId) : undefined
      if (p && renderId && !entry?.external) {
        try {
          if (renderId.startsWith('ae:')) {
            const folder = join(p.path, 'renders', renderId.slice(3))
            if (existsSync(folder)) await shell.trashItem(folder)
          } else {
            const r = listRenders(p.path).find((x) => x.id === renderId)
            if (r) {
              if (existsSync(join(p.path, r.file))) await shell.trashItem(join(p.path, r.file))
              if (r.thumbnail) rmSync(join(p.path, r.thumbnail), { force: true })
              forgetRender(p.path, renderId)
            }
          }
        } catch (e) {
          log(`could not delete ${p.path} ${renderId}: ${e instanceof Error ? e.message : e}`)
        }
      }
      // the copy too, if the console left it
      const copy = entry?.path ?? it.path
      if (copy && !copy.split('/').includes('..') && copy.split('/')[0] !== OLD) rmSync(abs(copy), { recursive: true, force: true })
      if (entry) ix.items = ix.items.filter((x) => x !== entry)
    }
    writeIndex(ix)
    rmSync(file, { force: true })
    changed()
  }
}

/** the round every 10 s: requests from the console, then the folders follow the app */
async function round() {
  await serial(async () => {
    await processDeleteRequests()
    reconcile()
  }).catch((e) => log(`round failed: ${e instanceof Error ? e.message : e}`))
}

// ---- what the app calls ----

/** turns the collection on (a folder) or off (undefined); on: fills in what exists, then keeps up */
export function setCollectDir(dir: string | undefined, onChanged?: () => void) {
  if (onChanged) changed = onChanged
  if ((dir ?? null) === root) return
  if (timer) clearInterval(timer)
  timer = null
  root = dir ?? null
  if (!root) return
  try {
    mkdirSync(root, { recursive: true })
  } catch (e) {
    log(`cannot use ${root}: ${e instanceof Error ? e.message : e}`)
    root = null
    return
  }
  void serial(backfill).then(round)
  timer = setInterval(() => void round(), 10_000)
}

export const collectDir = () => root

/** an export just finished */
export function onRender(projectId: string, record: RenderRecord) {
  if (!root) return
  void serial(() => {
    const p = summaryOf(projectId)
    if (!p) return
    const ix = readIndex()
    if (addRender(ix, p, record)) {
      writeIndex(ix)
      changed()
    }
  }).catch((e) => log(`could not add ${record.file}: ${e instanceof Error ? e.message : e}`))
}

/** an After Effects package was made */
export function onAePackage(projectId: string, folder: string) {
  if (!root) return
  void serial(() => {
    const p = summaryOf(projectId)
    if (!p) return
    const ix = readIndex()
    if (addAe(ix, p, folder)) {
      writeIndex(ix)
      changed()
    }
  }).catch((e) => log(`could not add ${folder}: ${e instanceof Error ? e.message : e}`))
}

/** an export was deleted in the app: its copy and entry go too */
export function onRenderRemoved(projectId: string, renderId: string) {
  if (!root) return
  void serial(() => {
    const ix = readIndex()
    const entry = ix.items.find((x) => x.projectId === projectId && x.renderId === renderId)
    if (!entry) return
    rmSync(abs(entry.path), { recursive: true, force: true })
    ix.items = ix.items.filter((x) => x !== entry)
    writeIndex(ix)
    changed()
  }).catch(() => undefined)
}

/** a project was renamed, moved or deleted, or a folder renamed: the collection follows soon */
export function onProjectsChanged() {
  if (root) setTimeout(() => void round(), 300)
}

/** the items as the console reads them (tests) */
export function collectIndex(): CollectItem[] {
  return root ? readIndex().items : []
}
export const deleteRequestsDir = () => (root ? requestsDir() : null)

/** one round now, and the moment every queued change is done (tests) */
export const collectRoundNow = () => round()
export const collectIdle = () => chain
