import type { Asset, BrandPreset, Brief, OutputFormat, OutputQuality, ReferenceItem } from './brief'
import type { Overrides } from './overrides'
import type { FeedbackMark, HistoryEntry, ProjectState, ProjectSummary, RenderRecord } from './project'

// ---- chat -------------------------------------------------------------------

export interface StoryboardScene {
  n: number
  from: number
  to: number
  title: string
  description: string
  texts: string[]
  assets: string[]
  motion: string
}

export interface Storyboard {
  title: string
  concept: string
  duration: number
  scenes: StoryboardScene[]
  notes?: string
}

export type ChatItem =
  | { id: string; at: string; role: 'user'; text: string; marks?: FeedbackMark[]; frame?: string; time?: number }
  | { id: string; at: string; role: 'assistant'; text: string; streaming?: boolean }
  | { id: string; at: string; role: 'status'; text: string; done: boolean }
  | { id: string; at: string; role: 'storyboard'; storyboard: Storyboard; status: 'pending' | 'approved' | 'superseded' }
  | { id: string; at: string; role: 'error'; text: string; detail?: string }
  | { id: string; at: string; role: 'notice'; text: string }

export interface UsageInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected' | 'unknown'
  resetsAt?: number
  window?: string
  utilization?: number
}

export interface SessionState {
  status: 'stopped' | 'starting' | 'ready' | 'busy' | 'exited'
  /** something in the terminal needs the designer (folder trust, login, usage limit) */
  attention?: 'trust' | 'login' | 'usage' | null
  sessionId?: string
  remoteName?: string
  remoteUrl?: string
  exitCode?: number
}

export type AgentEvent =
  | { type: 'session'; projectId: string; state: SessionState }
  | { type: 'pty-data'; projectId: string; data: string }
  | { type: 'item'; projectId: string; item: ChatItem }
  | { type: 'item-update'; projectId: string; item: ChatItem }
  | { type: 'composition-changed'; projectId: string }
  | { type: 'history-changed'; projectId: string }
  | { type: 'usage'; usage: UsageInfo }
  /** a variation in the open project's family changed status */
  | { type: 'family-changed'; projectId: string }
  | { type: 'references-changed'; projectId: string }

export interface SendMessageInput {
  projectId: string
  text: string
  marks?: FeedbackMark[]
  /** data URL of the annotated frame (from the canvas) */
  annotatedFrame?: string
  time?: number
}

// ---- audio --------------------------------------------------------------------------

export interface AudioClipInfo {
  id: string
  kind: 'sfx' | 'bgm' | 'other'
  group?: string
  label: string
  src: string
  originalSrc: string
  start: number
  duration?: number
  volume: number
  /** added by the designer in Motion Studio (not by Claude) */
  managed: boolean
}

export interface SfxInfo {
  id: string
  label: string
  use: string
  duration: number
  file: string
}

// ---- variations ---------------------------------------------------------------------

export interface VariationTargetInput {
  preset: Brief['output']['preset']
  width: number
  height: number
  duration: number
  lengthMethod?: 'claude' | 'retime'
}
export interface VariationRequestInput {
  base: { kind: 'current' } | { kind: 'history'; id: string; label: string }
  targets: VariationTargetInput[]
}

// ---- environment -------------------------------------------------------------

export type CheckStatus = 'ok' | 'warn' | 'error' | 'checking'
export interface DoctorItem {
  id: 'claude' | 'workspace' | 'browser' | 'ffmpeg' | 'fonts' | 'disk'
  label: string
  status: CheckStatus
  detail: string
  action?: { id: 'login' | 'install-browser' | 'rescan-fonts' | 'trust-workspace'; label: string }
}
export interface DoctorReport {
  items: DoctorItem[]
  ready: boolean
}

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  arch: string
  projectsDir: string
}

// ---- fonts ----------------------------------------------------------------------

export interface FontFace {
  file: string
  index: number
  style: string
  weight: number
  italic: boolean
  postscript: string
}
export interface FontFamily {
  family: string
  familyKo?: string
  hangul: boolean
  weights: number[]
  faces: FontFace[]
}

// ---- export ----------------------------------------------------------------------

export interface ExportOptions {
  format: OutputFormat
  quality: OutputQuality
  fileName: string
  versionName?: string
  /** also copy to this folder */
  copyTo?: string
}

export interface ExportProgress {
  projectId: string
  renderId: string
  phase: 'preparing' | 'capturing' | 'encoding' | 'finishing' | 'done' | 'error' | 'cancelled'
  percent: number
  message: string
  record?: RenderRecord
  detail?: string
}

// ---- checks ----------------------------------------------------------------------

export interface CheckFinding {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  elementId?: string
  time?: number
}

// ---- preload API ------------------------------------------------------------------

export interface StudioApi {
  app: {
    info(): Promise<AppInfo>
    doctor(): Promise<DoctorReport>
    /** opens Claude Code's own sign-in in a terminal session ("__login__") */
    login(): Promise<SessionState>
    cancelLogin(): Promise<void>
    installBrowser(): Promise<{ ok: boolean; message: string }>
    openExternal(url: string): Promise<void>
    reveal(path: string): Promise<void>
    pickFiles(kind: 'assets' | 'any'): Promise<string[]>
    pickFolder(): Promise<string | null>
    /** opens Claude Code once in the projects folder so the designer can trust it (covers every project) */
    trustWorkspace(): Promise<SessionState>
    /** absolute path of a dropped file (Electron removed File.path) */
    pathForFile(file: File): string
    /** captures a region of the app window as a PNG data URL (for annotated frames) */
    capture(rect: { x: number; y: number; width: number; height: number }): Promise<string>
    setTheme(theme: 'dark' | 'light' | 'system'): Promise<void>
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    create(input: { name: string; presetId: Brief['output']['preset']; duration: number }): Promise<ProjectState>
    open(path: string): Promise<ProjectState>
    /** current state of an already-open project (no side effects) */
    state(projectId: string): Promise<ProjectState>
    rename(projectId: string, name: string): Promise<ProjectState>
    remove(path: string): Promise<void>
    saveBrief(projectId: string, brief: Brief): Promise<ProjectState>
    importAssets(projectId: string, files: string[], opts?: { psd?: 'flat' | 'layers' }): Promise<Asset[]>
    saveOverrides(projectId: string, overrides: Overrides, summary: string): Promise<ProjectState>
    previewUrl(projectId: string): Promise<{ src: string; runtimeSrc: string; base: string }>
    check(projectId: string): Promise<CheckFinding[]>
    reportElements(projectId: string, elements: { id: string; label: string; movable: boolean }[]): Promise<void>
    audio(projectId: string): Promise<AudioClipInfo[]>
    sfxLibrary(): Promise<SfxInfo[]>
    /** copies a built-in sound effect into the project, returns its composition path */
    useSfx(projectId: string, sfxId: string): Promise<string | null>
    fileUrl(projectId: string, rel: string): Promise<string>
    diskUsage(projectId: string): Promise<Record<'renders' | 'assets' | 'references' | 'history' | 'cache' | 'total', number>>
    clearCache(projectId: string): Promise<void>
  }
  agent: {
    /** starts the live Claude Code session (or returns the running one) */
    start(projectId: string): Promise<SessionState>
    restart(projectId: string): Promise<SessionState>
    state(projectId: string): Promise<SessionState>
    send(input: SendMessageInput): Promise<void>
    /** Esc: interrupt the current turn */
    interrupt(projectId: string): Promise<void>
    transcript(projectId: string): Promise<ChatItem[]>
    approveStoryboard(projectId: string, itemId: string): Promise<void>
    onEvent(cb: (e: AgentEvent) => void): () => void
  }
  terminal: {
    /** recent raw output to repaint a freshly mounted terminal */
    snapshot(projectId: string): Promise<string>
    write(projectId: string, data: string): void
    resize(projectId: string, cols: number, rows: number): void
  }
  brands: {
    list(): Promise<BrandPreset[]>
    /** logoSource: a file to copy in as the brand logo */
    save(brand: Omit<BrandPreset, 'id'> & { id?: string }, logoSource?: string): Promise<BrandPreset>
    remove(id: string): Promise<void>
  }
  references: {
    list(projectId: string): Promise<ReferenceItem[]>
    addFiles(projectId: string, files: string[]): Promise<ReferenceItem[]>
    addYoutube(projectId: string, url: string): Promise<ReferenceItem>
    update(projectId: string, id: string, patch: Pick<Partial<ReferenceItem>, 'title' | 'note' | 'ranges'>): Promise<void>
    remove(projectId: string, id: string): Promise<void>
  }
  variations: {
    create(projectId: string, req: VariationRequestInput): Promise<ProjectState[]>
    family(projectId: string): Promise<ProjectSummary[]>
    /** exports every family member with its own brief settings, one after another */
    exportAll(projectId: string, quality: OutputQuality): Promise<number>
  }
  history: {
    list(projectId: string): Promise<HistoryEntry[]>
    restore(projectId: string, entryId: string): Promise<ProjectState>
    /** brings back only the video, the direct edits or the brief of an earlier state */
    restorePartial(projectId: string, entryId: string, scope: 'composition' | 'overrides' | 'brief'): Promise<ProjectState>
    saveVersion(projectId: string, name: string): Promise<HistoryEntry>
    star(projectId: string, entryId: string, starred: boolean): Promise<void>
  }
  renders: {
    list(projectId: string): Promise<RenderRecord[]>
    start(projectId: string, opts: ExportOptions): Promise<string>
    cancel(projectId: string, renderId: string): Promise<void>
    update(projectId: string, renderId: string, patch: Partial<Pick<RenderRecord, 'starred' | 'note'>>): Promise<RenderRecord>
    remove(projectId: string, renderId: string): Promise<void>
    fileUrl(projectId: string, renderId: string): Promise<string>
    onProgress(cb: (p: ExportProgress) => void): () => void
  }
  fonts: {
    list(): Promise<FontFamily[]>
  }
}
