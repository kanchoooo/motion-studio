import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, shell } from 'electron'
import { emptyBrief, normalizeBrief, OUTPUT_PRESETS, type Asset, type AssetKind, type Brief, type OutputPresetId } from '@shared/brief'
import { emptyOverrides, normalizeOverrides, overridesToScript, type Overrides } from '@shared/overrides'
import { mergeOverrides } from '@shared/overridesMerge'
import { applyAudio, audioEnvelopes, applyLength, markAudio } from './audio'
import { videoEffects, withProcessedClips } from './videoFx'
import { applyLayers } from './designerLayers'
import type { ProjectMeta, ProjectState, ProjectSummary } from '@shared/project'
import { fontCss, linkedFontFaces, withFontBlock } from './fontcss'
import { importPsd } from './psd'
import * as history from './history'
import { probeMedia, thumbnailFromVideo } from './media'
import { candidateFolder, candidateTarget, discardCandidate } from './ai/generate'
import type { GenCandidate } from '@shared/assetGen'
import { dataDir, runtimeFiles } from './paths'
import { folderOf, folderPath, isInside, moveDir, moveTarget, scan } from './folders'
import { serveFolder } from './preview-server'
import { compositionHasVideo, HYPERFRAMES_JSON, starterComposition } from './template'
import { repairCompositionHead } from './headFix'
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
  // moved, renamed or deleted in Finder while open: never recreate an empty copy at the old place
  if (!existsSync(f.meta(dir))) throw new Error('프로젝트 폴더를 찾을 수 없어요. 옮기거나 이름을 바꿨다면 홈에서 다시 열어 주세요.')
  return dir
}

/** ids of open projects stored in a folder (to stop their sessions before it goes away) */
export const idsAt = (dir: string) => [...open.entries()].filter(([, d]) => d === dir).map(([id]) => id)

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
  // projects in the projects folder and its folders, and ones opened from elsewhere
  // (the projects folder first; a recent entry elsewhere with an id already listed is a stale copy and is skipped,
  // while a Finder duplicate inside the projects folder still shows: it gets its own id when opened)
  const scanned = scan().projects
  const candidates = [...scanned, ...readJson<string[]>(recentPath(), [])]
  const ids = new Set<string>()
  const out: ProjectSummary[] = []
  for (const [i, dir] of candidates.entries()) {
    if (seen.has(dir) || !existsSync(f.meta(dir))) continue
    seen.add(dir)
    const meta = readJson<ProjectMeta | null>(f.meta(dir), null)
    const brief = readJson<Brief | null>(f.brief(dir), null)
    if (!meta || !brief || (i >= scanned.length && ids.has(meta.id))) continue
    ids.add(meta.id)
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
      folder: folderOf(dir),
      template: meta.template,
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
  // the app's head lines (Claude writes plain HyperFrames; older projects keep theirs)
  repairCompositionHead(dir, dirname(runtimeFiles.gsap()))
  mkdirSync(join(comp, 'ms'), { recursive: true })
  mkdirSync(join(comp, 'vendor'), { recursive: true })
  mkdirSync(join(comp, 'assets'), { recursive: true })
  const copyIfChanged = (src: string, dst: string) => {
    const next = readFileSync(src)
    if (!existsSync(dst) || !readFileSync(dst).equals(next)) writeText(dst, next.toString('utf8'))
  }
  copyIfChanged(runtimeFiles.msRuntime(), join(comp, 'ms', 'runtime.js'))
  copyIfChanged(runtimeFiles.svgrig(), join(comp, 'ms', 'svgrig.js'))
  copyIfChanged(runtimeFiles.gsap(), join(comp, 'vendor', 'gsap.min.js'))
  const html = existsSync(f.index(dir)) ? readFileSync(f.index(dir), 'utf8') : ''
  writeText(join(comp, 'ms', 'overrides.js'), overridesToScript(withProcessedClips(overrides, videoEffects(dir, overrides, html))))
  refreshFontCss(dir, overrides)
  applyAudioEdits(dir, overrides)
}

/** writes the designer's audio edits and added layers into composition/index.html (idempotent) */
export function applyAudioEdits(dir: string, overrides?: Overrides): boolean {
  if (!existsSync(f.index(dir))) return false
  const html = readFileSync(f.index(dir), 'utf8')
  const o = overrides ?? normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null))
  // sounds Claude placed without the app's marks get them first (the Sound tab lists marked ones)
  const marked = markAudio(html)
  const next = applyLayers(applyLength(applyAudio(marked, o, audioEnvelopes(dir, marked, o)), o), o, videoEffects(dir, o, marked))
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
  // the same faces in the page itself, so a render uses them too (fontcss.ts withFontBlock)
  if (html) {
    const next = withFontBlock(html, linkedFontFaces(f.comp(dir), html))
    if (next) writeText(f.index(dir), next)
  }
  return missing
}

// ---- create / open -----------------------------------------------------------------

export async function createProject(input: { name: string; presetId: OutputPresetId; duration: number; folder?: string }): Promise<ProjectState> {
  const name = safeName(input.name, '새 프로젝트')
  const base = folderPath(input.folder ?? '')
  mkdirSync(base, { recursive: true })
  const dir = uniquePath((n) => join(base, `${name}${n ? ` ${n + 1}` : ''}.msproj`))
  mkdirSync(dir, { recursive: true })
  // 0.5: a new video is refined in the conversation first; hand edits open with 편집 활성화
  const meta: ProjectMeta = { id: newId(), name, createdAt: nowIso(), updatedAt: nowIso(), appVersion: app.getVersion(), editable: false }
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
  let meta = readJson<ProjectMeta | null>(f.meta(dir), null)
  if (!meta) throw new Error('프로젝트 정보(project.json)를 읽을 수 없어요.')
  // a folder duplicated in Finder carries the original's id and Claude conversation: give it its own
  const other = open.get(meta.id)
  if ((other && other !== dir && existsSync(f.meta(other))) || listProjects().some((p) => p.id === meta!.id && p.path !== dir && existsSync(p.path))) {
    const firstSeen = listProjects().find((p) => p.id === meta!.id)?.path
    if (other ? other !== dir : firstSeen !== dir) {
      meta = { ...meta, id: newId(), agentSessionId: undefined, family: undefined, updatedAt: nowIso() }
      writeJson(f.meta(dir), meta)
    }
  }
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
    brief: normalizeBrief(readJson<Brief | null>(f.brief(dir), null) ?? emptyBrief(readJson<ProjectMeta | null>(f.meta(dir), null)?.name ?? '')),
    overrides: normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null)),
    hasVideo: compositionHasVideo(html),
  }
}

export function touch(projectId: string, patch: Partial<ProjectMeta> = {}): ProjectMeta {
  const dir = pathOf(projectId)
  const old = readJson<ProjectMeta | null>(f.meta(dir), null)
  if (!old) throw new Error('프로젝트 정보(project.json)를 읽을 수 없어요.')
  const meta = { ...old, ...patch, updatedAt: nowIso() }
  writeJson(f.meta(dir), meta)
  return meta
}

export function renameProject(projectId: string, name: string): ProjectState {
  touch(projectId, { name: safeName(name, '새 프로젝트') })
  return state(projectId)
}

/** renames a project from the home list (it may not be open); the folder keeps its name */
export function renameAt(dir: string, name: string): void {
  const meta = readJson<ProjectMeta | null>(f.meta(dir), null)
  if (!meta) throw new Error('프로젝트 정보(project.json)를 읽을 수 없어요.')
  writeJson(f.meta(dir), { ...meta, name: safeName(name, '새 프로젝트'), updatedAt: nowIso() })
}

/** projects under `dir` stop being open (their folder moves; they are opened again from the new place) */
export function forgetInside(dir: string): void {
  for (const [id, p] of [...open]) if (isInside(p, dir)) open.delete(id)
}

/** recent-list entries follow a moved project or folder */
export function movedOnDisk(from: string, to: string): void {
  writeJson(
    recentPath(),
    readJson<string[]>(recentPath(), []).map((p) => (isInside(p, from) ? to + p.slice(from.length) : p)),
  )
}

/** moves a project into another folder ('' = the top); returns its new path */
export async function moveProject(dir: string, folder: string): Promise<string> {
  if (!existsSync(f.meta(dir))) throw new Error('프로젝트 폴더를 찾을 수 없어요.')
  if (folderOf(dir) === folder) return dir
  const to = moveTarget(dir, folder)
  await moveDir(dir, to)
  // only once it really moved: the open entry and the recent list follow
  forgetInside(dir)
  movedOnDisk(dir, to)
  return to
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

/**
 * `base`: the edits the editor's copy started from. When the file changed since (Claude, a restore…),
 * the copy is merged in rather than written over that change (overridesMerge.ts).
 */
export async function saveOverrides(projectId: string, overrides: Overrides, summary: string, actor: 'designer' | 'claude' = 'designer', base?: Overrides): Promise<ProjectState> {
  const dir = pathOf(projectId)
  overrides = normalizeOverrides(overrides)
  if (base) {
    const disk = normalizeOverrides(readJson<Overrides | null>(f.overrides(dir), null))
    const from = normalizeOverrides(structuredClone(base))
    if (JSON.stringify(disk) !== JSON.stringify(from)) overrides = normalizeOverrides(mergeOverrides(from, overrides, disk))
  }
  writeJson(f.overrides(dir), overrides)
  // Claude's clips with a speed change show the processed file (videoFx.ts)
  const html = existsSync(f.index(dir)) ? readFileSync(f.index(dir), 'utf8') : ''
  writeText(join(f.comp(dir), 'ms', 'overrides.js'), overridesToScript(withProcessedClips(overrides, videoEffects(dir, overrides, html))))
  refreshFontCss(dir, overrides)
  applyAudioEdits(dir, overrides)
  touch(projectId)
  await history.record(dir, { actor, summary })
  return state(projectId)
}

// ---- assets -----------------------------------------------------------------------------

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'])
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg'])
export const ASSET_EXTENSIONS = [...IMAGE, ...VIDEO, ...AUDIO, '.psd'].map((e) => e.slice(1))

export const FEEDBACK_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const FEEDBACK_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm']

/** reference image attached to a chat message or a canvas mark: copied into feedback/refs/ */
/**
 * An image or video attached to a message or to one mark: copied into feedback/refs/. A video gets a
 * still of its middle next to it (<name>.jpg) so Claude can look at it.
 */
export async function addFeedbackImage(projectId: string, file: string): Promise<string> {
  const ext = extname(file).toLowerCase().slice(1)
  const video = FEEDBACK_VIDEO_EXTENSIONS.includes(ext)
  if (!FEEDBACK_IMAGE_EXTENSIONS.includes(ext) && !video) throw new Error('이미지(PNG·JPG·WebP·GIF)나 영상(MP4·MOV·WebM)만 첨부할 수 있어요.')
  if (statSync(file).size > (video ? 300 : 25) * 1024 * 1024) throw new Error(video ? '300MB보다 큰 영상은 첨부할 수 없어요.' : '25MB보다 큰 이미지는 첨부할 수 없어요.')
  const dir = join(pathOf(projectId), 'feedback', 'refs')
  mkdirSync(dir, { recursive: true })
  const name = `${Date.now()}-${newId().slice(0, 6)}.${ext === 'jpeg' ? 'jpg' : ext}`
  copyFileSync(file, join(dir, name))
  if (video) {
    const meta = await probeMedia(join(dir, name)).catch(() => null)
    await thumbnailFromVideo(join(dir, name), join(dir, `${name}.jpg`), (meta?.duration ?? 1) / 2, 640).catch(() => {})
  }
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
          required: false,
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
      required: false,
      timing: { mode: 'any' },
      position: 'any',
      transform: guessKind(basename(src), ext) === 'logo' ? 'none' : 'free',
      note: '',
      meta: { ...meta, bytes: statSync(dst).size },
    })
  }
  return out
}

// ---- the asset library (소재함): changed here, merged into the brief on disk ----

/** the screen hears about library / output changes made here (also by Claude's tools) */
let briefListener: ((projectId: string) => void) | null = null
export const onBriefChanged = (fn: (projectId: string) => void) => (briefListener = fn)
/** the project's state changed outside the screen (e.g. 편집 활성화 finished): the screen reloads it */
export const notifyChanged = (projectId: string) => briefListener?.(projectId)

function mutateBrief(projectId: string, fn: (b: Brief) => Brief): ProjectState {
  const dir = pathOf(projectId)
  const cur = normalizeBrief(readJson<Brief | null>(f.brief(dir), null) ?? emptyBrief(''))
  writeJson(f.brief(dir), fn(cur))
  touch(projectId)
  briefListener?.(projectId)
  return state(projectId)
}

/** files from the computer (or an attachment) into the library */
export async function addToLibrary(projectId: string, files: string[], opts: { psd?: 'flat' | 'layers' } = {}): Promise<{ added: Asset[]; state: ProjectState }> {
  const added = await importAssets(projectId, files, opts)
  return { added, state: mutateBrief(projectId, (b) => ({ ...b, assets: [...b.assets, ...added] })) }
}

/** assets made elsewhere (a kept AI candidate) */
export function addAssets(projectId: string, assets: Asset[]): ProjectState {
  return mutateBrief(projectId, (b) => ({ ...b, assets: [...b.assets, ...assets.filter((a) => !b.assets.some((x) => x.file === a.file))] }))
}

export function removeAsset(projectId: string, assetId: string): ProjectState {
  return mutateBrief(projectId, (b) => ({ ...b, assets: b.assets.filter((a) => a.id !== assetId) }))
}

/** a revised asset takes an old one's place in the library */
export function replaceAsset(projectId: string, oldId: string, asset: Asset): ProjectState {
  return mutateBrief(projectId, (b) => ({ ...b, assets: b.assets.map((a) => (a.id === oldId ? asset : a)) }))
}

/** the output spec (size, length, fps, export settings) without touching the rest of the brief */
export function saveOutput(projectId: string, patch: Partial<Brief['output']>): ProjectState {
  return mutateBrief(projectId, (b) => ({ ...b, output: { ...b.output, ...patch } }))
}

/**
 * A generated image the designer keeps: its folder (image, and for characters the
 * SVG files) moves into composition/assets/gen-<id>/. Returns the asset; the brief
 * screen adds it with its own (debounced) save, so nothing it holds is overwritten.
 */
export async function keepCandidate(projectId: string, candidate: GenCandidate): Promise<Asset> {
  const dir = pathOf(projectId)
  const rel = candidateTarget(candidate.id)
  const to = join(f.comp(dir), rel)
  const from = candidateFolder(dir, candidate.id)
  const main = candidate.video ? 'video.mp4' : 'source.png'
  if (!existsSync(join(from, main))) throw new Error(candidate.video ? '만든 영상을 찾을 수 없어요. 다시 만들어 주세요.' : '만든 이미지를 찾을 수 없어요. 다시 만들어 주세요.')
  cpSync(from, to, { recursive: true })
  const character = candidate.character ? { ...candidate.character, dir: `composition/${rel}` } : undefined
  if (character) writeJson(join(to, 'character.json'), character)
  const meta = await probeMedia(join(to, main))
  const r = candidate.request
  const KIND_ASSET: Record<string, Asset['kind']> = { character: 'person', object: 'product', background: 'background' }
  const asset: Asset = {
    id: newId(),
    file: `${rel}/${main}`,
    originalName: `AI · ${r.prompt.replace(/\s+/g, ' ').slice(0, 40) || (candidate.video ? '만든 영상' : '만든 이미지')}`,
    kind: candidate.video ? 'video' : r.style === 'flat-character' ? 'person' : (KIND_ASSET[r.kind ?? ''] ?? 'other'),
    required: false,
    timing: { mode: 'any' },
    position: 'any',
    transform: 'free',
    note: '',
    meta: { ...meta, bytes: statSync(join(to, main)).size },
    generated: { provider: r.provider, model: r.modelLabel ?? r.model, prompt: r.prompt, style: r.style, framing: r.framing, request: candidate.video ? undefined : r, video: candidate.video?.request },
    character,
  }
  discardCandidate(dir, candidate.id)
  return asset
}

/** the composition (every .html / .css it has) uses `to` wherever it used the asset file `from`; returns the count */
export function replaceAssetFile(projectId: string, from: string, to: string): number {
  const dir = pathOf(projectId)
  const ok = (p: string) => /^assets\/[^"'<>\\]+$/.test(p) && !p.includes('..')
  if (!ok(from) || !ok(to) || !existsSync(join(f.comp(dir), to))) throw new Error('바꿀 소재 파일이 올바르지 않아요.')
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(["'(=\\s])(\\./)?${esc}(?=["')\\s?#])`, 'g')
  let count = 0
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (depth === 0 && /^(ms|vendor|assets|fonts|snapshots)$/.test(name)) continue
      if (statSync(p).isDirectory()) {
        if (depth < 2 && !name.startsWith('.')) walk(p, depth + 1)
        continue
      }
      if (!/\.(html?|css)$/i.test(name)) continue
      const text = readFileSync(p, 'utf8')
      let n = 0
      const next = text.replace(re, (_m, pre: string, dot: string | undefined) => {
        n++
        return `${pre}${dot ?? ''}${to}`
      })
      if (n) {
        writeText(p, next)
        count += n
      }
    }
  }
  walk(f.comp(dir), 0)
  return count
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

