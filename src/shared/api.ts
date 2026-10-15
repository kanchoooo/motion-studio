import type { Asset, Brief, OutputFormat, OutputQuality, ReferenceItem } from './brief'
import type { CharacterInfo, Framing, GenCandidate, GenRequest, VideoGenRequest } from './assetGen'
import type { AiAccountInfo, AiLoginEvent, AiModelInfo, AiModelList, AiSettings, AiVoiceInfo, AudioCandidate, AudioCandidateList, LoginBrowser, LoginWindow, CodexStatus } from './ai'
import type { Overrides } from './overrides'
import type { FeedbackMark, HistoryEntry, ProjectState, ProjectSummary, RenderRecord } from './project'

// ---- chat -------------------------------------------------------------------

/** something a scene needs (an image, a video clip); the designer assigns a file to it */
export interface StoryMaterial {
  /** unique in the storyboard ("s2-m1") */
  id: string
  kind: 'image' | 'video'
  /** what it is, in Korean ("제품 클로즈업") */
  label: string
  /** image: the image prompt · video: the motion prompt */
  prompt?: string
  /** video clips that matter: prompts for the first and the last frame image */
  startPrompt?: string
  endPrompt?: string
  /** the file the designer assigned (composition-relative, e.g. assets/x.png) */
  file?: string
}

export interface StoryboardScene {
  n: number
  from: number
  to: number
  title: string
  description: string
  texts: string[]
  assets: string[]
  motion: string
  /** the sketch of this scene photographed from storyboard.html (project-relative png) */
  frame?: string
  materials?: StoryMaterial[]
}

export interface Storyboard {
  title: string
  concept: string
  duration: number
  scenes: StoryboardScene[]
  notes?: string
}

/** the storyboard the designer works with (storyboard.json, written by the app) */
export interface CurrentStoryboard {
  itemId: string
  status: 'pending' | 'approved'
  storyboard: Storyboard
  /** assignments changed after approval (told to Claude with the next message) */
  changed?: string[]
}

export type ChatItem =
  | { id: string; at: string; role: 'user'; text: string; marks?: FeedbackMark[]; frame?: string; time?: number; attachments?: string[]; /** sent while Claude was working: delivered when it reaches a stopping point */ queued?: boolean; /** the app's own request to Claude (편집 정리), not the designer's words */ fromApp?: boolean }
  | { id: string; at: string; role: 'assistant'; text: string; streaming?: boolean }
  | { id: string; at: string; role: 'status'; text: string; done: boolean }
  | { id: string; at: string; role: 'storyboard'; storyboard: Storyboard; status: 'pending' | 'approved' | 'superseded' }
  | { id: string; at: string; role: 'error'; text: string; detail?: string }
  | { id: string; at: string; role: 'notice'; text: string }
  /** voices Claude suggests for a narration: the designer listens and picks one */
  | { id: string; at: string; role: 'voices'; label?: string; script?: string; voices: AiVoiceInfo[]; picked?: string }
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
  /** the brief's library or output spec changed in the main process (e.g. Claude took in an attachment) */
  | { type: 'project-changed'; projectId: string }
  /** Claude started building what the designer approved in the conversation (start_build): the editor opens */
  | { type: 'build-started'; projectId: string }
  /** the storyboard (콘티) or its assignments changed */
  | { type: 'storyboard-changed'; projectId: string; current: CurrentStoryboard | null }
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
  /** images / videos / YouTube links attached in the chat (references/<id>), with the part the designer chose */
  references?: { id: string; range?: { from: number; to: number } }[]
  /** for Claude only (written into the message file, not shown in the chat) */
  detail?: string
  /** the app asks (편집 정리): shown as the app's note, not as the designer's words */
  fromApp?: boolean
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
  /** where in the file playback starts (seconds) */
  mediaStart?: number
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
  /** what else the designer wants in this variation (Claude does it) */
  note?: string
}
export interface VariationRequestInput {
  base: { kind: 'current' } | { kind: 'history'; id: string; label: string }
  targets: VariationTargetInput[]
}

// ---- templates ---------------------------------------------------------------------

/** a fill-in slot of a template: an editable element of the finished video */
export interface TemplateSlot {
  /** data-ms-id of the element */
  id: string
  kind: 'text' | 'image' | 'video' | 'voice'
  /** what the designer calls it ("메인 문구", "제품 사진") */
  label: string
  /** the text, or the composition-relative file (assets/…) in the original */
  original: string
  /** a note for whoever fills it in ("10자 안팎", "투명 배경 PNG") */
  hint?: string
  /** how a narration was recorded (the same voice is used for a new script) */
  voice?: { provider: string; tool: string; args: Record<string, unknown>; label?: string }
}

export interface TemplateInfo {
  id: string
  name: string
  createdAt: string
  /** the project it was made from */
  sourceName: string
  /** the folder it was made in (shown there first) */
  folder?: string
  output: { preset: Brief['output']['preset']; width: number; height: number; duration: number }
  slots: TemplateSlot[]
  /** cover picture, relative to url */
  cover?: string
  path: string
  /** file URL of the template folder (cover, composition/…) */
  url: string
}

/** new values per slot id: text, a picked file (absolute path), or a new narration script */
export type TemplateValues = Record<string, { text?: string; file?: string; script?: string }>

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
    pickFiles(kind: 'assets' | 'images' | 'media' | 'any'): Promise<string[]>
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
    create(input: { name: string; presetId: Brief['output']['preset']; duration: number; folder?: string }): Promise<ProjectState>
    /** moves a project into a folder ('' = top); returns its new path */
    move(path: string, folder: string): Promise<string>
    /** the video uses another file in place of an asset (composition-relative paths); returns how many places changed */
    replaceAssetFile(projectId: string, from: string, to: string): Promise<number>
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
    /** the asset library (소재함), merged into brief.json in the main process */
    addToLibrary(projectId: string, files: string[], opts?: { psd?: 'flat' | 'layers' }): Promise<ProjectState>
    addAssets(projectId: string, assets: Asset[]): Promise<ProjectState>
    removeAsset(projectId: string, assetId: string): Promise<ProjectState>
    replaceAsset(projectId: string, oldId: string, asset: Asset): Promise<ProjectState>
    /** changes only the output spec of the brief */
    saveOutput(projectId: string, patch: Partial<Brief['output']>): Promise<ProjectState>
    diskUsage(projectId: string): Promise<Record<'renders' | 'assets' | 'references' | 'history' | 'cache' | 'total', number>>
    clearCache(projectId: string): Promise<void>
  }
  templates: {
    list(): Promise<TemplateInfo[]>
    /** the slots a finished project could offer (project folder path; the project need not be open) */
    detect(projectPath: string): Promise<{ slots: TemplateSlot[]; url: string }>
    create(projectPath: string, input: { name: string; slots: TemplateSlot[]; folder?: string }): Promise<TemplateInfo>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
    /** a new project from a template; returns its path (narration scripts / a layout check go to Claude) */
    createProject(input: { templateId: string; name: string; folder: string; values: TemplateValues; check: boolean }): Promise<string>
    /** the slots of an open project made from a template, with their current values */
    slots(projectId: string): Promise<{ name: string; slots: TemplateSlot[]; current: Record<string, string> } | null>
    /** changes slots of an open project made from a template */
    apply(projectId: string, values: TemplateValues, check: boolean): Promise<ProjectState>
  }
  /** project folders inside the projects folder (relative paths like "직방/숏츠") */
  folders: {
    list(): Promise<string[]>
    create(parent: string, name: string): Promise<string>
    rename(path: string, name: string): Promise<string>
    /** to the Trash; only an empty folder (no projects inside) */
    remove(path: string): Promise<void>
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
    storyboard(projectId: string): Promise<CurrentStoryboard | null>
    /** puts a library file (composition-relative) into a storyboard material slot; null empties it */
    assign(projectId: string, materialId: string, file: string | null): Promise<CurrentStoryboard>
    /** files from the computer into a slot (they join the library) */
    assignFiles(projectId: string, materialId: string, files: string[]): Promise<CurrentStoryboard>
    /** the designer picked a voice on a voice card (Claude is told) */
    pickVoice(projectId: string, itemId: string, voiceId: string): Promise<void>
    /** 편집 활성화: makes the video editable by hand ('asked': Claude is naming the layers now) */
    activateEditing(projectId: string): Promise<'ready' | 'asked'>
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
    /** before export: frames almost identical to a reference, imported media with source / license */
    preflight(projectId: string): Promise<{ copies: { t: number; ref: string; refT: number }[]; imports: { file: string; label?: string; source?: string; license?: string; provider: string }[] }>
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
    /** a clip from a video model, optionally between a first and a last frame */
    generateVideo(projectId: string, req: VideoGenRequest): Promise<GenCandidate>
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
  /** '이미지' | '영상' */
  media?: string
  model: string
  /** 종류 (인물·캐릭터, 사물·제품, …) */
  kind?: string
  lang: string
  style: string
  framing: string
  prompt: string
  /** reference images picked for the generation (absolute paths, filled in by the main process) */
  references?: string[]
  /** opened from a storyboard material: the scene and what it needs, and the video's aspect */
  scene?: string
}

export interface HelperReply {
  text: string
  prompt?: string
  memo?: string
}
