import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, shell } from 'electron'
import { emptyBrief, normalizeBrief, OUTPUT_PRESETS, type Asset, type AssetKind, type Brief, type OutputPresetId } from '@shared/brief'
import { emptyOverrides, normalizeOverrides, overridesToScript, type Overrides } from '@shared/overrides'
import { applyAudio, applyLength } from './audio'
import type { ProjectMeta, ProjectState, ProjectSummary } from '@shared/project'
import { fontCss } from './fontcss'
import { importPsd } from './psd'
import * as history from './history'
import { probeMedia } from './media'
import { dataDir, projectsDir, runtimeFiles } from './paths'
import { serveFolder } from './preview-server'
import { compositionHasVideo, HYPERFRAMES_JSON, starterComposition } from './template'
import { newId, nowIso, readJson, safeName, uniquePath, writeJson, writeText } from './util'

const open = new Map<string, string>() // projectId -> folder

const f = {
  meta: (dir: string) => join(dir, 'project.json'),
  brief: (dir: string) => join(dir, 'brief.json'),
  overrides: (dir: string) => join(dir, 'overrides.json'),
  chat: (dir: string) => join(dir, 'chat.json'),
  comp: (dir: string) => join(dir, 'composition'),
  index: (dir: string) => join(dir, 'composition', 'index.html'),
}

export const openIds = () => [...open.keys()]

export function pathOf(projectId: string): string {
  const dir = open.get(projectId)
  if (!dir) throw new Error('프로젝트가 열려 있지 않아요. 홈에서 다시 열어 주세요.')
  return dir
}

export const files = f

// ---- recent list ------------------------------------------------------------

const recentPath = () => join(dataDir(), 'recent.json')
function touchRecent(dir: string): void {
  const list = readJson<string[]>(recentPath(), []).filter((p) => p !== dir)
  list.unshift(dir)
  writeJson(recentPath(), list.slice(0, 50))
}

/** a project and all its variations (root first) */
export function familyOf(projectId: string): ProjectSummary[] {
  const me = state(projectId)
  const rootId = me.meta.family?.rootId ?? me.meta.id
  return listProjects()
    .filter((p) => p.id === rootId || p.family?.rootId === rootId)
    .sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.name.localeCompare(b.name, 'ko')))
}

export function listProjects(): ProjectSummary[] {
  const seen = new Set<string>()
  const candidates = [...readJson<string[]>(recentPath(), [])]
  try {
    for (const name of readdirSync(projectsDir())) {
      if (name.endsWith('.msproj')) candidates.push(join(projectsDir(), name))
    }
  } catch {
    /* documents folder unavailable */
  }
  const out: ProjectSummary[] = []
  for (const dir of candidates) {
    if (seen.has(dir) || !existsSync(f.meta(dir))) continue
    seen.add(dir)
    const meta = readJson<ProjectMeta | null>(f.meta(dir), null)
    const brief = readJson<Brief | null>(f.brief(dir), null)
    if (!meta || !brief) continue
    const preset = OUTPUT_PRESETS.find((p) => p.id === brief.output.preset)
    const thumb = join(dir, 'thumbnails', 'latest.jpg')
    out.push({
      id: meta.id,
      name: meta.name,
      path: dir,
      updatedAt: meta.updatedAt,
      ratio: preset?.ratio ?? `${brief.output.width}×${brief.output.height}`,
      duration: brief.output.duration,
      width: brief.output.width,
      height: brief.output.height,
      family: meta.family,
      thumbnail: existsSync(thumb) ? `${serveFolder(dir)}thumbnails/latest.jpg?v=${Math.round(statSync(thumb).mtimeMs)}` : undefined,
      hasVideo: existsSync(f.index(dir)) && compositionHasVideo(readFileSync(f.index(dir), 'utf8')),
    })
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

// ---- managed composition files ---------------------------------------------------

/** copies the app-managed runtime files into composition/ (keeps old projects current) */
function syncManagedFiles(dir: string, overrides: Overrides): void {
  const comp = f.comp(dir)
  mkdirSync(join(comp, 'ms'), { recursive: true })
  mkdirSync(join(comp, 'vendor'), { recursive: true })
  mkdirSync(join(comp, 'assets'), { recursive: true })
  const copyIfChanged = (src: string, dst: string) => {
    const next = readFileSync(src)
    if (!existsSync(dst) || !readFileSync(dst).equals(next)) writeText(dst, next.toString('utf8'))
  }
  copyIfChanged(runtimeFiles.msRuntime(), join(comp, 'ms', 'runtime.js'))
  copyIfChanged(runtimeFiles.gsap(), join(comp, 'vendor', 'gsap.min.js'))
  writeText(join(comp, 'ms', 'overrides.js'), overridesToScript(overrides))
  refreshFontCss(dir, overrides)
  applyAudioEdits(dir, overrides)
}

/** writes the designer's audio edits into composition/index.html (idempotent) */
export function applyAudioEdits(dir: string, overrides?: Overrides): boolean {
  if (!existsSync(f.index(dir))) return false
  const html = readFileSync(f.index(dir), 'utf8')
  const o = overrides ?? normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null))
  const next = applyLength(applyAudio(html, o), o)
  if (next === html) return false
  writeText(f.index(dir), next)
  return true
}

/** regenerates ms/fonts.css from the fonts the composition and overrides use */
export function refreshFontCss(dir: string, overrides?: Overrides): string[] {
  const html = existsSync(f.index(dir)) ? readFileSync(f.index(dir), 'utf8') : ''
  const o = overrides ?? normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null))
  const { css, missing } = fontCss(html, o)
  const target = join(f.comp(dir), 'ms', 'fonts.css')
  if (!existsSync(target) || readFileSync(target, 'utf8') !== css) writeText(target, css)
  return missing
}

// ---- create / open -----------------------------------------------------------------

export async function createProject(input: { name: string; presetId: OutputPresetId; duration: number }): Promise<ProjectState> {
  const name = safeName(input.name, '새 프로젝트')
  const dir = uniquePath((n) => join(projectsDir(), `${name}${n ? ` ${n + 1}` : ''}.msproj`))
  mkdirSync(dir, { recursive: true })
  const meta: ProjectMeta = { id: newId(), name, createdAt: nowIso(), updatedAt: nowIso(), appVersion: app.getVersion() }
  const brief = emptyBrief(name, input.presetId, Math.max(1, Math.min(180, input.duration || 15)))
  const overrides = emptyOverrides()
  writeJson(f.meta(dir), meta)
  writeJson(f.brief(dir), brief)
  writeJson(f.overrides(dir), overrides)
  writeJson(f.chat(dir), [])
  writeText(f.index(dir), starterComposition(brief.output))
  writeJson(join(f.comp(dir), 'hyperframes.json'), HYPERFRAMES_JSON)
  writeJson(join(f.comp(dir), 'meta.json'), { id: meta.id, name })
  for (const sub of ['feedback', 'renders', 'thumbnails', 'references']) mkdirSync(join(dir, sub), { recursive: true })
  syncManagedFiles(dir, overrides)
  await history.initHistory(dir)
  await history.record(dir, { actor: 'app', summary: '프로젝트를 만들었어요' })
  return openProject(dir)
}

export function openProject(dir: string, opts: { remember?: boolean } = {}): ProjectState {
  if (!existsSync(f.meta(dir))) throw new Error('모션스튜디오 프로젝트 폴더가 아니에요.')
  const meta = readJson<ProjectMeta>(f.meta(dir), null as never)
  const brief = readJson<Brief>(f.brief(dir), emptyBrief(meta.name))
  const overrides = normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null))
  syncManagedFiles(dir, overrides)
  open.set(meta.id, dir)
  if (opts.remember !== false) touchRecent(dir)
  return state(meta.id)
}

export function state(projectId: string): ProjectState {
  const dir = pathOf(projectId)
  const html = existsSync(f.index(dir)) ? readFileSync(f.index(dir), 'utf8') : ''
  return {
    meta: readJson<ProjectMeta>(f.meta(dir), null as never),
    path: dir,
    brief: normalizeBrief(readJson<Brief>(f.brief(dir), null as never)),
    overrides: normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null)),
    hasVideo: compositionHasVideo(html),
  }
}

export function touch(projectId: string, patch: Partial<ProjectMeta> = {}): ProjectMeta {
  const dir = pathOf(projectId)
  const meta = { ...readJson<ProjectMeta>(f.meta(dir), null as never), ...patch, updatedAt: nowIso() }
  writeJson(f.meta(dir), meta)
  return meta
}

export function renameProject(projectId: string, name: string): ProjectState {
  touch(projectId, { name: safeName(name, '새 프로젝트') })
  return state(projectId)
}

export async function removeProject(dir: string): Promise<void> {
  for (const [id, p] of open) if (p === dir) open.delete(id)
  writeJson(recentPath(), readJson<string[]>(recentPath(), []).filter((p) => p !== dir))
  await shell.trashItem(dir) // recoverable from Trash / Recycle Bin
}

// ---- brief / overrides --------------------------------------------------------------

export async function saveBrief(projectId: string, brief: Brief): Promise<ProjectState> {
  const dir = pathOf(projectId)
  writeJson(f.brief(dir), brief)
  touch(projectId)
  await history.record(dir, { actor: 'designer', summary: '브리프를 수정했어요' })
  return state(projectId)
}

export async function saveOverrides(projectId: string, overrides: Overrides, summary: string): Promise<ProjectState> {
  const dir = pathOf(projectId)
  writeJson(f.overrides(dir), overrides)
  writeText(join(f.comp(dir), 'ms', 'overrides.js'), overridesToScript(overrides))
  refreshFontCss(dir, overrides)
  applyAudioEdits(dir, overrides)
  touch(projectId)
  await history.record(dir, { actor: 'designer', summary })
  return state(projectId)
}

// ---- assets -----------------------------------------------------------------------------

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'])
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])
export const ASSET_EXTENSIONS = [...IMAGE, ...VIDEO, ...AUDIO, '.psd'].map((e) => e.slice(1))

export const FEEDBACK_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** reference image attached to a chat message or a canvas mark: copied into feedback/refs/ */
export function addFeedbackImage(projectId: string, file: string): string {
  const ext = extname(file).toLowerCase().slice(1)
  if (!FEEDBACK_IMAGE_EXTENSIONS.includes(ext)) throw new Error('PNG, JPG, WebP, GIF 이미지만 첨부할 수 있어요.')
  if (statSync(file).size > 25 * 1024 * 1024) throw new Error('25MB보다 큰 이미지는 첨부할 수 없어요.')
  const dir = join(pathOf(projectId), 'feedback', 'refs')
  mkdirSync(dir, { recursive: true })
  const name = `${Date.now()}-${newId().slice(0, 6)}.${ext === 'jpeg' ? 'jpg' : ext}`
  copyFileSync(file, join(dir, name))
  return `feedback/refs/${name}`
}

function guessKind(name: string, ext: string): AssetKind {
  const n = name.toLowerCase()
  if (VIDEO.has(ext)) return 'video'
  if (AUDIO.has(ext)) return 'bgm'
  if (/logo|로고|ci|bi/.test(n)) return 'logo'
  if (/bg|background|배경/.test(n)) return 'background'
  if (/product|제품|상품|pkg|패키지/.test(n)) return 'product'
  return 'other'
}

export async function importAssets(projectId: string, sources: string[], opts: { psd?: 'flat' | 'layers' } = {}): Promise<Asset[]> {
  const dir = pathOf(projectId)
  const assetsDir = join(f.comp(dir), 'assets')
  mkdirSync(assetsDir, { recursive: true })
  const out: Asset[] = []
  for (const src of sources) {
    const ext = extname(src).toLowerCase()
    if (ext === '.psd') {
      const parts = await importPsd(src, assetsDir, opts.psd ?? 'flat')
      for (const p of parts) {
        const meta = await probeMedia(p.file)
        const layered = opts.psd === 'layers'
        out.push({
          id: newId(),
          file: `assets/${basename(p.file)}`,
          originalName: layered ? `${basename(src)} › ${p.name}` : basename(src),
          kind: guessKind(p.name, '.png'),
          required: !layered,
          timing: { mode: 'any' },
          position: 'any',
          transform: guessKind(p.name, '.png') === 'logo' ? 'none' : 'free',
          note: layered ? `PSD 레이어 · 원본 캔버스 ${p.canvas.width}×${p.canvas.height}에서 위치 x:${p.left}, y:${p.top}, 크기 ${p.width}×${p.height}` : '',
          meta: { ...meta, bytes: statSync(p.file).size },
        })
      }
      continue
    }
    if (!IMAGE.has(ext) && !VIDEO.has(ext) && !AUDIO.has(ext)) continue
    const base = safeName(basename(src, extname(src)), 'asset').replace(/\s+/g, '_')
    const dst = uniquePath((n) => join(assetsDir, `${base}${n ? `_${n + 1}` : ''}${ext}`))
    copyFileSync(src, dst)
    const meta = await probeMedia(dst)
    out.push({
      id: newId(),
      file: `assets/${basename(dst)}`,
      originalName: basename(src),
      kind: guessKind(basename(src), ext),
      required: true,
      timing: { mode: 'any' },
      position: 'any',
      transform: guessKind(basename(src), ext) === 'logo' ? 'none' : 'free',
      note: '',
      meta: { ...meta, bytes: statSync(dst).size },
    })
  }
  return out
}

/** disk use of a project by category (bytes) */
export function diskUsage(projectId: string): Record<'renders' | 'assets' | 'references' | 'history' | 'cache' | 'total', number> {
  const dir = pathOf(projectId)
  const size = (p: string): number => {
    try {
      const st = statSync(p)
      if (!st.isDirectory()) return st.size
      return readdirSync(p).reduce((n, name) => n + size(join(p, name)), 0)
    } catch {
      return 0
    }
  }
  const u = {
    renders: size(join(dir, 'renders')),
    assets: size(join(f.comp(dir), 'assets')),
    references: size(join(dir, 'references')),
    history: size(join(dir, '.history')),
    cache: size(join(dir, '.cache')) + size(join(f.comp(dir), 'snapshots')),
    total: 0,
  }
  u.total = size(dir)
  return u
}

export function clearCache(projectId: string): void {
  const dir = pathOf(projectId)
  rmSync(join(dir, '.cache'), { recursive: true, force: true })
  rmSync(join(f.comp(dir), 'snapshots'), { recursive: true, force: true })
}

export function readChat<T>(projectId: string): T[] {
  return readJson<T[]>(f.chat(pathOf(projectId)), [])
}

export function writeChat<T>(projectId: string, items: T[]): void {
  writeJson(f.chat(pathOf(projectId)), items.slice(-500))
}

export function removeFile(path: string): void {
  rmSync(path, { force: true })
}
