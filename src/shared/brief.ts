// Brief: everything the designer configures before/while talking to Claude.
import type { CharacterInfo, Framing, GenStyle } from './assetGen'

export type OutputPresetId = 'youtube-16x9' | 'shorts-9x16' | 'feed-4x5' | 'square-1x1' | 'custom'
export type OutputFormat = 'mp4-h264' | 'mp4-h265' | 'mov-prores4444' | 'webm-vp9' | 'png-sequence'
export type OutputQuality = 'draft' | 'standard' | 'high'
export type SafeZoneId = 'none' | 'youtube' | 'shorts' | 'reels' | 'tiktok'

export interface OutputSpec {
  preset: OutputPresetId
  width: number
  height: number
  fps: number
  duration: number
  format: OutputFormat
  /** auto = Claude designs the background (colour, gradient, texture, generated image…) */
  background: 'color' | 'transparent' | 'auto'
  backgroundColor: string
  quality: OutputQuality
  audio: boolean
  safeZone: SafeZoneId
  maxSizeMB?: number
}

export type TimingMode = 'exact' | 'section' | 'any'
export type Section = 'start' | 'middle' | 'end'
export interface TimingSpec {
  mode: TimingMode
  at?: number
  section?: Section
}

export type PositionHint = 'top' | 'middle' | 'bottom' | 'left' | 'right' | 'center' | 'any'

export interface RequiredText {
  id: string
  text: string
  /** must appear verbatim (legal copy, disclaimers) */
  locked: boolean
  timing: TimingSpec
  /** seconds the text must stay readable */
  minDuration: number
  position: PositionHint
  style: {
    mode: 'auto' | 'custom'
    fontFamily?: string
    fontWeight?: number
    fontSize?: number
    color?: string
  }
  note: string
}

export type AssetKind = 'logo' | 'product' | 'background' | 'person' | 'video' | 'bgm' | 'other'
export type AssetTransform = 'free' | 'crop-only' | 'none'

export interface AssetMeta {
  width?: number
  height?: number
  duration?: number
  bytes: number
  mime: string
}

export interface Asset {
  id: string
  /** made in 소재 > AI로 만들기 */
  generated?: { provider: string; model: string; prompt: string; style: GenStyle; framing: Framing }
  /** flat character style: its SVG conversion (and Claude's part tags) */
  character?: CharacterInfo
  /** path relative to composition/, e.g. "assets/logo.png" */
  file: string
  originalName: string
  kind: AssetKind
  required: boolean
  timing: TimingSpec
  position: PositionHint
  transform: AssetTransform
  note: string
  meta: AssetMeta
}

export interface ReferenceItem {
  id: string
  kind: 'video' | 'image' | 'youtube'
  title: string
  /** source page for YouTube references */
  url?: string
  /** project-relative file (references/<id>/source.*) — outside the render root by design */
  file?: string
  /** parts to look at; empty = Claude finds the kick points itself */
  ranges: { from: number; to: number }[]
  note: string
  status: 'pending' | 'downloading' | 'analyzing' | 'ready' | 'error'
  error?: string
  meta?: { duration?: number; width?: number; height?: number }
  /** keyframes found by scene detection (project-relative jpgs, with seconds) */
  frames?: { t: number; file: string }[]
  /** the whole video every 0.1 s: sheets of 20 frames (2 s each) for studying motion */
  sheets?: { from: number; to: number; file: string }[]
  /** how much the picture changes from one 0.1 s frame to the next (0–100), for finding the moves */
  motion?: number[]
  /** scene cuts in seconds */
  cuts?: number[]
}

/** reusable brand kit (stored app-wide, applied to a brief) */
export interface BrandPreset {
  id: string
  name: string
  colors: { name: string; hex: string }[]
  fonts: { headline?: string; body?: string }
  /** absolute path of the stored logo file (app data folder) */
  logo?: string
  notes: string
}

// ---- storyboard (optional, for designers who planned the scenes) ----

export interface StoryText {
  id: string
  text: string
  /** must appear verbatim */
  locked: boolean
}

export interface StoryImage {
  id: string
  /** file = attached by the designer, describe = described in words (Claude finds or generates it) */
  mode: 'file' | 'describe'
  /** composition-relative asset path, e.g. "assets/scene-1.png" */
  file?: string
  originalName?: string
  required: boolean
  description: string
  /** generation model for a described image; null/undefined = brief default */
  model?: AiModelRef | null
}

export interface StoryScene {
  id: string
  title: string
  /** seconds; undefined = Claude decides */
  duration?: number
  /** what happens: layout, motion, transitions, mood */
  description: string
  texts: StoryText[]
  images: StoryImage[]
}

// ---- AI generation (Higgsfield, Magnific) and sound libraries (Artlist) ----

export type AiProviderId = 'higgsfield' | 'magnific' | 'artlist' | 'codex'

export interface AiModelRef {
  provider: AiProviderId
  /** provider's model id */
  model: string
  label?: string
}

export interface AiBrief {
  /** default model for generated images; null = Claude picks */
  image: AiModelRef | null
  /** default model for generated video clips; null = Claude picks */
  video: AiModelRef | null
  narration: {
    enabled: boolean
    provider?: AiProviderId
    voiceId?: string
    voiceName?: string
    /** Higgsfield voice_type / Magnific source that goes with the id */
    voiceType?: string
    /** '' = Claude writes the script */
    script: string
    note: string
  }
  /** let Claude look for BGM / sound effects on Artlist */
  artlist: boolean
}

export function defaultAi(): AiBrief {
  return { image: null, video: null, narration: { enabled: false, script: '', note: '' }, artlist: false }
}

export interface Brief {
  version: 1
  title: string
  client: string
  campaign: string
  output: OutputSpec
  texts: RequiredText[]
  assets: Asset[]
  references: ReferenceItem[]
  /** free-form tone & manner notes */
  tone: string
  /** brand kit applied to this brief (structured for Claude) */
  brand?: Omit<BrandPreset, 'logo'>
  /** optional scene-by-scene plan */
  storyboard: StoryScene[]
  ai: AiBrief
}

export interface OutputPreset {
  id: OutputPresetId
  label: string
  ratio: string
  width: number
  height: number
  safeZone: SafeZoneId
}

export const OUTPUT_PRESETS: OutputPreset[] = [
  { id: 'youtube-16x9', label: '가로형 (유튜브·TV)', ratio: '16:9', width: 1920, height: 1080, safeZone: 'youtube' },
  { id: 'shorts-9x16', label: '세로형 (쇼츠·릴스)', ratio: '9:16', width: 1080, height: 1920, safeZone: 'shorts' },
  { id: 'feed-4x5', label: '피드형 (인스타그램)', ratio: '4:5', width: 1080, height: 1350, safeZone: 'none' },
  { id: 'square-1x1', label: '정사각형', ratio: '1:1', width: 1080, height: 1080, safeZone: 'none' },
]

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  'mp4-h264': 'MP4 (H.264) — 가장 호환성이 좋아요',
  'mp4-h265': 'MP4 (H.265) — 용량이 작아요',
  'mov-prores4444': 'MOV (ProRes 4444) — 투명 배경, 편집용',
  'webm-vp9': 'WebM (VP9) — 투명 배경, 웹용',
  'png-sequence': 'PNG 시퀀스 — 애프터이펙트 합성용',
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  logo: '로고',
  product: '제품',
  background: '배경',
  person: '인물',
  video: '영상',
  bgm: '배경음악',
  other: '기타',
}

export const SECTION_LABELS: Record<Section, string> = { start: '앞부분', middle: '중간', end: '끝부분' }

/** broadcast/ad delivery usually uses NTSC rates (29.97); the renderer needs them as exact rationals */
export const FPS_OPTIONS: { value: number; label: string; hint?: string; arg: string }[] = [
  { value: 23.976, label: '23.976', hint: '영화 느낌', arg: '24000/1001' },
  { value: 24, label: '24', arg: '24' },
  { value: 25, label: '25', hint: 'PAL', arg: '25' },
  { value: 29.97, label: '29.97', hint: '방송·광고 표준', arg: '30000/1001' },
  { value: 30, label: '30', arg: '30' },
  { value: 59.94, label: '59.94', hint: '부드러운 고프레임', arg: '60000/1001' },
  { value: 60, label: '60', arg: '60' },
]

/** value for the renderer's -f flag (exact NTSC rationals) */
export function fpsArg(fps: number): string {
  return FPS_OPTIONS.find((f) => Math.abs(f.value - fps) < 0.01)?.arg ?? String(Math.round(fps))
}

/** HyperFrames' data-fps only accepts integers: 29.97 → 30 (the render uses the exact rate) */
export const fpsAttr = (fps: number) => Math.round(fps)

export function defaultOutput(presetId: OutputPresetId = 'youtube-16x9', duration = 15): OutputSpec {
  const p = OUTPUT_PRESETS.find((x) => x.id === presetId) ?? OUTPUT_PRESETS[0]
  return {
    preset: p.id,
    width: p.width,
    height: p.height,
    fps: 29.97,
    duration,
    format: 'mp4-h264',
    background: 'auto',
    backgroundColor: '#000000',
    quality: 'standard',
    audio: true,
    safeZone: p.safeZone,
  }
}

export function emptyBrief(title: string, presetId?: OutputPresetId, duration?: number): Brief {
  return {
    version: 1,
    title,
    client: '',
    campaign: '',
    output: defaultOutput(presetId, duration),
    texts: [],
    assets: [],
    references: [],
    tone: '',
    storyboard: [],
    ai: defaultAi(),
  }
}

/** fills fields added after a project was created */
export function normalizeBrief(b: Partial<Brief> & { title?: string }): Brief {
  const base = emptyBrief(b.title ?? '')
  const ai = { ...defaultAi(), ...(b.ai ?? {}) }
  ai.narration = { ...defaultAi().narration, ...(b.ai?.narration ?? {}) }
  return { ...base, ...b, output: { ...base.output, ...(b.output ?? {}) }, storyboard: b.storyboard ?? [], ai } as Brief
}

export function newScene(id: string): StoryScene {
  return { id, title: '', description: '', texts: [], images: [] }
}

export function newRequiredText(id: string): RequiredText {
  return {
    id,
    text: '',
    locked: false,
    timing: { mode: 'any' },
    minDuration: 1.5,
    position: 'any',
    style: { mode: 'auto' },
    note: '',
  }
}

export function describeTiming(t: TimingSpec): string {
  if (t.mode === 'exact') return `${(t.at ?? 0).toFixed(1)}초`
  if (t.mode === 'section') return SECTION_LABELS[t.section ?? 'start']
  return '무관'
}
