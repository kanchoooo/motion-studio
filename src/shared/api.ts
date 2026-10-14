import type { Asset, BrandPreset, Brief, OutputFormat, OutputQuality, ReferenceItem } from './brief'
import type { CharacterInfo, Framing, GenCandidate, GenRequest } from './assetGen'
import type { AiAccountInfo, AiLoginEvent, AiModelInfo, AiModelList, AiSettings, AiVoiceInfo, AudioCandidate, AudioCandidateList, LoginBrowser, LoginWindow, CodexStatus } from './ai'
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
  | { id: string; at: string; role: 'user'; text: string; marks?: FeedbackMark[]; frame?: string; time?: number; attachments?: string[]; /** sent while Claude was working: delivered when it reaches a stopping point */ queued?: boolean }
  | { id: string; at: string; role: 'assistant'; text: string; streaming?: boolean }
  | { id: string; at: string; role: 'status'; text: string; done: boolean }
  | { id: string; at: string; role: 'storyboard'; storyboard: Storyboard; status: 'pending' | 'approved' | 'superseded' }
  | { id: string; at: string; role: 'error'; text: string; detail?: string }
  | { id: string; at: string; role: 'notice'; text: string }
  /** images / video clips Claude generated, waiting for the designer: keep in assets, discard, or apply */
  | { id: string; at: string; role: 'generated'; files: { file: string; kind: string }[]; label?: string; status: 'pending' | 'kept' | 'discarded' | 'applied'; note?: string }

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
  /** model/effort the running process was started with */
  model?: string
  effort?: string
  /** a model/effort change waits for the current turn to finish */
  pendingRestart?: boolean
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
  /** Claude found music / sound effects for the designer to audition */
  | { type: 'audio-candidates'; projectId: string; list: AudioCandidateList }
  /** Claude is waiting for the designer's permission (asks: every open question; added: the new one) */
  | { type: 'permissions'; projectId: string; asks: PermissionAsk[]; added?: PermissionAsk }

/** "물어보기": Claude asks in the chat before acting outside its standing permissions; "모두 허용": the app allows */
export type AgentPermission = 'ask' | 'all'

export interface PermissionAsk {
  id: string
  projectId: string
  tool: string
  /** e.g. "명령 실행 · 이미지 크기 확인" */
  title: string
  /** the command, file or address */
  detail: string
  at: string
}

export interface SendMessageInput {
  projectId: string
  text: string
  marks?: FeedbackMark[]
  /** data URL of the annotated frame (from the canvas) */
  annotatedFrame?: string
  time?: number
  /** reference images for the whole message (project-relative, see projects.addFeedbackImage) */
  attachments?: string[]
}

export type AgentModel = '' | 'fable' | 'opus' | 'sonnet' | 'haiku'
export type AgentEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// ---- audio --------------------------------------------------------------------------

export interface AudioClipInfo {
  id: string
  /** voice = narration (TTS) */
  kind: 'sfx' | 'bgm' | 'voice' | 'other'
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

export interface UpdateCheck {
  status: 'skipped' | 'none' | 'available' | 'error'
  current: string
  latest?: string
  notes?: string
  message?: string
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

export interface AeProgress {
  projectId: string
  phase: 'measuring' | 'capturing' | 'writing' | 'done' | 'error'
  percent: number
  message: string
  folder?: string
}

export interface ExportProgress {
  projectId: string
  renderId: string
  phase: 'preparing' | 'capturing' | 'encoding' | 'finishing' | 'done' | 'error' | 'cancelled'
  percent: number
  message: string
  record?: RenderRecord
  /** the copy in the folder the designer chose */
  savedTo?: string
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
    /** newer version on GitHub releases? (skipped in development) */
    checkUpdate(): Promise<UpdateCheck>
    /** downloads it; progress through onUpdateProgress */
    downloadUpdate(): Promise<void>
    onUpdateProgress(cb: (percent: number) => void): () => void
    /** quits, installs and restarts */
    installUpdate(): Promise<void>
    /** the access password was entered on this computer before */
    hasAccess(): Promise<boolean>
    unlock(password: string): Promise<boolean>
    info(): Promise<AppInfo>
    doctor(): Promise<DoctorReport>
    /** opens Claude Code's own sign-in in a terminal session ("__login__") */
    login(): Promise<SessionState>
    cancelLogin(): Promise<void>
    installBrowser(): Promise<{ ok: boolean; message: string }>
    openExternal(url: string): Promise<void>
    reveal(path: string): Promise<void>
    pickFiles(kind: 'assets' | 'images' | 'any'): Promise<string[]>
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
    /** web fonts the project downloaded (composition/fonts/) */
    webFonts(projectId: string): Promise<{ family: string; weights: number[] }[]>
    /** renames a project from the home list (open or not) */
    renameAt(path: string, name: string): Promise<void>
    /** project list pictures were made in the background */
    onChanged(cb: () => void): () => void
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
    /** copies a reference image for chat/mark feedback into the project, returns its project-relative path */
    addFeedbackImage(projectId: string, file: string): Promise<string>
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
    /** switches model / reasoning effort (restarts the session with --resume; waits for a running turn) */
    setModel(projectId: string, opts: { model: AgentModel; effort: AgentEffort }): Promise<SessionState>
    /** permission mode for this project (takes effect at once, no restart) */
    setPermission(projectId: string, mode: AgentPermission): Promise<void>
    /** questions Claude is waiting on */
    permissions(projectId: string): Promise<PermissionAsk[]>
    /** always: allow this kind of action for the rest of the conversation */
    answerPermission(projectId: string, askId: string, answer: 'allow' | 'always' | 'deny'): Promise<void>
    /**
     * what Claude generated: 'keep' adds it to the brief's assets, 'discard' moves the
     * files to the trash, 'applied' just marks the card (the chat message tells Claude where)
     */
    resolveGenerated(projectId: string, itemId: string, action: 'keep' | 'discard' | 'applied', note?: string): Promise<void>
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
    /** After Effects package (experimental): a folder with build.jsx + assets; returns the folder */
    exportAe(projectId: string, opts: { name: string; copyTo?: string }): Promise<string>
    onAeProgress(cb: (p: AeProgress) => void): () => void
  }
  fonts: {
    list(): Promise<FontFamily[]>
  }
  ai: {
    accounts(): Promise<AiAccountInfo[]>
    /** opens the service's sign-in in the browser; progress arrives through onLogin */
    /** window: private (incognito) or normal window of the chosen browser */
    login(provider: AiAccountInfo['provider'], label: string, opts?: { relogin?: string; window?: LoginWindow }): Promise<void>
    cancelLogin(): Promise<void>
    onLogin(cb: (e: AiLoginEvent) => void): () => void
    setActive(provider: AiAccountInfo['provider'], accountId: string): Promise<AiAccountInfo[]>
    rename(accountId: string, label: string): Promise<AiAccountInfo[]>
    remove(accountId: string): Promise<AiAccountInfo[]>
    models(provider: AiAccountInfo['provider'], kind: AiModelInfo['kind']): Promise<AiModelList>
    /** the whole voice catalogue of the active account (searching and filtering happen in the app) */
    voices(provider: AiAccountInfo['provider']): Promise<AiVoiceInfo[]>
    /** a short sample of a voice without a free preview (uses the service's credits, cached on disk); returns a playable URL */
    ttsSample(voice: AiVoiceInfo, text: string): Promise<string>
    /** installed browsers the sign-in page can open in */
    browsers(): Promise<LoginBrowser[]>
    settings(): Promise<AiSettings>
    saveSettings(patch: Partial<AiSettings>): Promise<AiSettings>
    /** media made or imported by AI tools in this project */
    generated(projectId: string): Promise<{ file: string; kind: string; provider: string; tool: string; label?: string; at: string }[]>
    audioCandidates(projectId: string): Promise<AudioCandidateList | null>
    /** asks Claude to search music / sound effects (Artlist) and show candidates */
    searchAudio(projectId: string, input: { query: string; kind: 'bgm' | 'sfx' }): Promise<void>
    /** downloads a candidate into the project; returns its composition path */
    useAudioCandidate(projectId: string, item: AudioCandidate): Promise<string>
    /** opens Claude Code's MCP screen with Artlist in a terminal ("__artlist__") for sign-in */
    artlistLogin(): Promise<SessionState>
    /** closes that terminal; idle project sessions reconnect so they pick up the sign-in */
    artlistLoginDone(): Promise<void>
    /** 소재 > AI로 만들기: one image (characters are converted to SVG before it returns) */
    generate(projectId: string, req: GenRequest): Promise<GenCandidate>
    candidates(projectId: string): Promise<GenCandidate[]>
    discardCandidate(projectId: string, candidateId: string): Promise<GenCandidate[]>
    /** the candidate's files move into composition/assets/gen-…/; the returned asset is for the brief */
    keepCandidate(projectId: string, candidateId: string): Promise<Asset>
    /** converts a character image again (dir: project-relative folder), e.g. with fewer colours */
    reconvert(projectId: string, dir: string, framing: Framing, colors: number): Promise<CharacterInfo>
    /** Codex CLI as an image model: installed, signed in, quota left (force = ask Codex again) */
    codexStatus(force?: boolean): Promise<CodexStatus>
    /** one turn of the prompt helper chat (latest Haiku); sessionId: a UUID per chat */
    askHelper(sessionId: string, message: string, ctx: HelperContext): Promise<HelperReply>
  }
}

export interface HelperContext {
  model: string
  lang: string
  style: string
  framing: string
  prompt: string
  /** reference images picked for the generation (absolute paths, filled in by the main process) */
  references?: string[]
}

export interface HelperReply {
  text: string
  prompt?: string
  memo?: string
}
