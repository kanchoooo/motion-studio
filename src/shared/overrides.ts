// Designer edits applied on top of Claude's composition by ms-runtime.js.

export interface ElementStyle {
  fontFamily?: string
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  /** px */
  fontSize?: number
  /** px */
  letterSpacing?: number
  /** unitless multiplier */
  lineHeight?: number
  color?: string
  textAlign?: 'left' | 'center' | 'right'
}

export interface ElementTransform {
  x?: number
  y?: number
  scale?: number
  rotate?: number
}

export interface ElementOverride {
  text?: string
  style?: ElementStyle
  transform?: ElementTransform
  /** shift every tween of this element by N seconds */
  timing?: { shift?: number }
  /** 1 = authored speed */
  animSpeed?: number
  hidden?: boolean
  /** locked values are never changed by Claude */
  locked?: boolean
}

/** designer change to an audio element Claude placed (sfx or bgm) */
export interface AudioEdit {
  /** composition-relative file, e.g. assets/my-whoosh.wav */
  src?: string
  start?: number
  duration?: number
  volume?: number
  muted?: boolean
}

/** background music the designer added (several allowed) */
export interface BgmTrack {
  id: string
  label: string
  src: string
  /** where it plays on the video timeline (seconds) */
  start: number
  end: number
  /** where playback starts inside the music file */
  mediaStart: number
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
}

/**
 * Designer change to one authored motion (a GSAP tween). Keyed by
 * "<data-ms-id>#<n>" (n-th tween created for the element, in code order);
 * `sig` must still match or the change is not applied (Claude rewrote it).
 */
export interface MotionOverride {
  sig: string
  /** seconds to move the motion by on the authored timeline */
  shift?: number
  duration?: number
  ease?: string
  /** changed values: "to.y", "from.opacity", ... */
  values?: Record<string, number | string>
  /** removed: the element keeps its resting state */
  disabled?: boolean
}

export interface TimeRemapSection {
  from: number
  to: number
  speed: number
}

export interface Overrides {
  version: 1
  elements: Record<string, ElementOverride>
  timeRemap: TimeRemapSection[]
  keepTotalDuration: boolean
  /** per-element audio edits, keyed by data-ms-id */
  audio: Record<string, AudioEdit>
  /** replace every sound effect of one kind at once (key = data-ms-sfx, e.g. "whoosh") */
  sfxGroups: Record<string, { src: string; volume?: number }>
  /** designer-added background music tracks */
  bgm: BgmTrack[]
  /** per-motion edits (start, length, easing, values) */
  motions: Record<string, MotionOverride>
}

export function emptyOverrides(): Overrides {
  return { version: 1, elements: {}, timeRemap: [], keepTotalDuration: true, audio: {}, sfxGroups: {}, bgm: [], motions: {} }
}

/** fills fields added after a project was created */
export function normalizeOverrides(o: Partial<Overrides> | null | undefined): Overrides {
  return { ...emptyOverrides(), ...(o ?? {}) } as Overrides
}

/** Serialises overrides into the script ms-runtime.js reads. */
export function overridesToScript(o: Overrides): string {
  const payload = {
    elements: o.elements,
    timeRemap: o.timeRemap,
    keepTotalDuration: o.keepTotalDuration,
    motions: o.motions,
  }
  // JSON is a valid JS expression; escape "</" so the payload can never close a <script> tag
  return `window.__MS_OVERRIDES__ = ${JSON.stringify(payload).replace(/<\//g, '<\\/')};\n`
}

export function isEmptyOverride(e: ElementOverride): boolean {
  return (
    e.text == null &&
    !Object.keys(e.style ?? {}).length &&
    !Object.keys(e.transform ?? {}).length &&
    !e.timing?.shift &&
    (e.animSpeed == null || e.animSpeed === 1) &&
    !e.hidden
  )
}
