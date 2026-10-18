// Designer edits applied on top of Claude's composition by ms-runtime.js.
import type { KeyProp, WiggleProp } from './props'
import { keysAt } from './props'
export * from './ease'
export * from './props'
// Claude makes the video; the designer edits it like in After Effects: every value here
// is layered over Claude's code (it is never rewritten), layers the designer adds live in
// a managed block of index.html (main/designerLayers.ts), and nothing is locked unless the
// designer locks it.

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
  textDecoration?: 'none' | 'underline' | 'line-through'
  textTransform?: 'none' | 'uppercase'
  /** outline of the letters */
  textStroke?: { width: number; color: string } | null
  /** box fill (background colour) */
  fill?: string
  /** box outline, drawn inside the edge */
  stroke?: { width: number; color: string } | null
  /** corner radius, px */
  radius?: number
  /** a linear gradient fill (wins over fill) */
  gradient?: { a: string; b: string; angle: number } | null
}

export interface ElementTransform {
  /** offset from where Claude placed it, px */
  x?: number
  y?: number
  /** uniform scale (older projects); scaleX / scaleY win when set */
  scale?: number
  scaleX?: number
  scaleY?: number
  /** degrees */
  rotate?: number
  /** 3D rotation, degrees */
  rotateX?: number
  rotateY?: number
  /** pivot (anchor point) offset from the element's centre, px */
  anchorX?: number
  anchorY?: number
  /** 0–1 */
  opacity?: number
}

/** "effects" (After Effects' Effect Controls), on the layer as a whole */
export interface ElementEffects {
  /** CSS mix-blend-mode */
  blend?: string
  /** px */
  blur?: number
  /** percent, 100 = unchanged */
  brightness?: number
  contrast?: number
  saturate?: number
  /** degrees */
  hue?: number
  /** percent, 0 = unchanged */
  grayscale?: number
  sepia?: number
  invert?: number
  shadow?: { x: number; y: number; blur: number; color: string } | null
  glow?: { blur: number; color: string } | null
}

/** a mask on the layer, in the element's own box at rest (px); it moves with the layer */
export interface LayerMask {
  shape: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  radius?: number
  feather?: number
  invert?: boolean
}

/**
 * One keyframe. `t` is output time in seconds (what the timeline shows); `e` is the
 * easing of the segment that starts here: 'linear', 'hold', a GSAP ease name
 * ('power2.out', 'back.out(1.7)'…) or 'cubic-bezier(x1,y1,x2,y2)'. Missing = easy ease.
 */
export interface Keyframe {
  t: number
  /** a number, or a colour (#rrggbb[aa]) for colour properties and some of Claude's values */
  v: number | string
  e?: string
  /** position keys only: the motion path's handles (out of this key, into this key), px from the key */
  c?: { ox: number; oy: number; ix: number; iy: number }
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
  /** set by the designer: neither Claude nor a stray click changes this layer */
  locked?: boolean
  /** the designer's name for the layer */
  label?: string
  /** removed from the video (a Claude layer stays restorable) */
  deleted?: boolean
  /** the layer shows only between these output times (After Effects in/out points) */
  inPoint?: number
  outPoint?: number
  /** replaced picture or clip (composition-relative path) */
  src?: string
  effects?: ElementEffects
  mask?: LayerMask | null
  /** keyframed properties: when a property has keyframes they decide its value */
  keys?: Partial<Record<KeyProp, Keyframe[]>>
  /** after the last keyframe the keys repeat (loopOut cycle) or go back and forth (pingpong); "own:<prop>" for taken-over ones */
  loops?: Partial<Record<KeyProp | `own:${string}`, 'cycle' | 'pingpong'>>
  /** random shaking (After Effects' wiggle): times per second, how far (px, °, %, opacity 0–1) */
  wiggle?: Partial<Record<WiggleProp, { freq: number; amount: number }>>
  /**
   * properties of Claude's motion the designer took over (GSAP property names: y, rotation,
   * --mouth-open, backgroundColor…): absolute keyframes on the element itself; Claude's tweens
   * of these properties no longer play
   */
  own?: Record<string, Keyframe[]>
  /** the text counts from one number to another (prices, percentages) */
  counter?: TextCounter | null
  /** a styled line's parts, in order (each keeps its own style): wins over text */
  textRuns?: string[] | null
  /** words in their own colour / weight (wherever they appear in the text) */
  highlights?: TextHighlight[] | null
  /** the text changes at these output times (After Effects' Source Text keyframes) */
  textKeys?: { t: number; text: string }[] | null
  /** line drawing of the strokes inside the layer (After Effects' Trim Paths), 0–100 */
  trim?: { start: number; end: number } | null
  /** text animator preset (After Effects' text animators): letters or words come in one by one */
  textAnim?: TextAnim | null
  /** follows another layer's motion from this output time on (After Effects' parenting) */
  parent?: { id: string; at: number } | null
  /** moved into another group (stacks, clips and moves with it) */
  moveTo?: string | null
  /** an image layer shapes this one (After Effects' track matte) */
  matte?: { layer: string; mode: 'alpha' | 'alphaInv' | 'luma' | 'lumaInv' } | null
  /** motion blur of the keyframed movement: the share of a frame the shutter is open (0–1) */
  motionBlur?: number | null
  /** a clip played faster / slower or backwards (the app writes the processed clip) */
  videoFx?: { speed?: number; reverse?: boolean } | null
}

export interface TextCounter {
  from: number
  to: number
  /** output time it starts counting */
  start: number
  duration: number
  ease?: string
  decimals: number
  /** thousands separators (12,900) */
  comma: boolean
  prefix?: string
  suffix?: string
}

export interface TextHighlight {
  text: string
  color?: string
  weight?: number
  underline?: boolean
}

export type TextAnimPreset = 'fadeUp' | 'typewriter' | 'pop' | 'slideLeft' | 'blurIn' | 'wave' | 'custom'
export interface TextAnim {
  preset: TextAnimPreset
  /** custom: where each letter comes from (offsets in px, scale, degrees, blur px, opacity, colour) */
  custom?: { x?: number; y?: number; scale?: number; rotate?: number; blur?: number; opacity?: number; color?: string; ease?: string }
  /** custom: which letter goes first */
  order?: 'start' | 'center' | 'end' | 'edges'
  /** output time the first letter starts */
  start: number
  /** seconds each letter (or word) takes */
  duration: number
  /** seconds between letters (or words) */
  stagger: number
  by: 'char' | 'word'
}

export const TEXT_ANIMS: { value: TextAnimPreset; label: string }[] = [
  { value: 'fadeUp', label: '아래에서 올라오기' },
  { value: 'typewriter', label: '타자기' },
  { value: 'pop', label: '톡 튀어나오기' },
  { value: 'slideLeft', label: '옆에서 들어오기' },
  { value: 'blurIn', label: '흐림에서 선명하게' },
  { value: 'wave', label: '물결' },
  { value: 'custom', label: '직접 정하기' },
]

/** designer change to an audio element Claude placed (sfx or bgm) */
export interface AudioEdit {
  /** composition-relative file, e.g. assets/my-whoosh.wav */
  src?: string
  start?: number
  duration?: number
  volume?: number
  muted?: boolean
  /** taken out of the video by the designer (silent and off the lists; it can be brought back) */
  removed?: boolean
  /** volume over time (output seconds, 0–2): music ducking under a voice… */
  volumeKeys?: Keyframe[]
}

/**
 * 구간 지우기: volume keys that take a sound out between a and b (output seconds) with a short fade on
 * each side, keeping the volume it had around the section; keys inside the section go.
 */
export function cutVolumeSection(keys: Keyframe[], base: number, a: number, b: number, fade = 0.12): Keyframe[] {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  const sorted = [...keys].sort((x, y) => x.t - y.t)
  const at = (t: number) => Number(keysAt(sorted, t) ?? base)
  const round = (n: number) => Math.round(n * 1000) / 1000
  const before = at(from - fade)
  const after = at(to + fade)
  const kept = sorted.filter((k) => k.t < from - fade - 1e-4 || k.t > to + fade + 1e-4)
  const cut: Keyframe[] = [
    ...(from - fade > 0 ? [{ t: round(from - fade), v: round(before), e: 'linear' as const }] : []),
    { t: round(Math.max(0, from)), v: 0, e: 'hold' as const },
    { t: round(to), v: 0, e: 'linear' as const },
    { t: round(to + fade), v: round(after), e: 'linear' as const },
  ]
  return [...kept, ...cut].sort((x, y) => x.t - y.t)
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
  /** volume over time (output seconds, 0–2) */
  volumeKeys?: Keyframe[]
}

/**
 * Designer change to one authored motion (a GSAP tween). Keyed by
 * "<data-ms-id>#<n>" (n-th tween created for the element, in code order);
 * `sig` must still match or the change is not applied (Claude rewrote it).
 */
export interface MotionOverride {
  sig: string
  /** where the motion started (authored time) when it was edited: finds it again after Claude rewrites the code */
  at?: number
  /** a staggered motion: seconds between items, where it starts, extra delay per item (index → s) */
  stagger?: { each?: number; from?: 'start' | 'center' | 'end' | 'edges'; offsets?: Record<number, number> }
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

export type DesignerLayerKind = 'text' | 'shape' | 'image' | 'video' | 'solid' | 'adjustment'

/** a layer the designer added (written into a managed block of index.html) */
export interface DesignerLayer {
  id: string
  kind: DesignerLayerKind
  label: string
  /** box on the canvas at rest, px (transform / keyframes move it from here) */
  x: number
  y: number
  w: number
  h: number
  text?: string
  shape?: 'rect' | 'ellipse'
  /** image / video file, composition-relative */
  src?: string
  fit?: 'cover' | 'contain' | 'fill'
  /** video: seconds into the file where playback starts */
  mediaStart?: number
  /** video: its own sound off (the default) */
  muted?: boolean
}

/** a copy of a layer Claude made: the copy keeps its motion */
export interface LayerDuplicate {
  id: string
  /** data-ms-id of the original */
  of: string
}

export interface TimelineMarker {
  id: string
  t: number
  label: string
}

export interface Overrides {
  /** 2: locks are the designer's own (version 1 locked every edited element automatically) */
  version: number
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
  /** layers the designer added */
  layers: DesignerLayer[]
  /** copies of Claude's layers */
  duplicates: LayerDuplicate[]
  /** stacking order the designer chose, per group of siblings (key from the runtime): ids, top first */
  order: Record<string, string[]>
  markers: TimelineMarker[]
  /** ruler guides, composition px */
  guides: { x: number[]; y: number[] }
  /**
   * groups the composition lays out (flex, grid…) set free by the designer: every editable
   * child is placed where it was measured (px in the group), so it can be scaled, turned…
   */
  freeze?: Record<string, FrozenGroup>
}

export interface FrozenGroup {
  size: { w: number; h: number }
  kids: Record<string, { l: number; t: number; w: number; h: number }>
}

/**
 * A whole layer moved in time (the timeline bar): Claude's motion by `authored` seconds of the
 * authored timeline, the designer's own keys, in/out points, timed text, counter, text animator
 * and parent link by `dt` seconds of output time (never before 0).
 */
export function shiftElement(e: ElementOverride, authored: number, dt: number): ElementOverride {
  const mv = (t: number) => +Math.max(0, t + dt).toFixed(4)
  const keysOf = <T extends { t: number }>(ks: T[] | undefined) => ks?.map((k) => ({ ...k, t: mv(k.t) }))
  const out: ElementOverride = { ...e, timing: { ...(e.timing ?? {}), shift: +((e.timing?.shift ?? 0) + authored).toFixed(3) } }
  if (e.keys) out.keys = Object.fromEntries(Object.entries(e.keys).map(([p, ks]) => [p, keysOf(ks)]))
  if (e.own) out.own = Object.fromEntries(Object.entries(e.own).map(([p, ks]) => [p, keysOf(ks) ?? []]))
  if (e.textKeys) out.textKeys = keysOf(e.textKeys)
  if (e.inPoint != null) out.inPoint = mv(e.inPoint)
  if (e.outPoint != null) out.outPoint = mv(e.outPoint)
  if (e.counter) out.counter = { ...e.counter, start: mv(e.counter.start) }
  if (e.textAnim) out.textAnim = { ...e.textAnim, start: mv(e.textAnim.start) }
  if (e.parent) out.parent = { ...e.parent, at: mv(e.parent.at) }
  return out
}

export const OVERRIDES_VERSION = 2

export function emptyOverrides(): Overrides {
  return {
    version: OVERRIDES_VERSION,
    elements: {},
    timeRemap: [],
    keepTotalDuration: true,
    audio: {},
    sfxGroups: {},
    bgm: [],
    motions: {},
    layers: [],
    duplicates: [],
    order: {},
    markers: [],
    guides: { x: [], y: [] },
  }
}

/** fills fields added after a project was created; version 1 locks were automatic, so they go */
export function normalizeOverrides(o: Partial<Overrides> | null | undefined): Overrides {
  const out = { ...emptyOverrides(), ...(o ?? {}) } as Overrides
  if ((o?.version ?? 1) < 2) {
    const elements: Record<string, ElementOverride> = {}
    for (const [id, e] of Object.entries(out.elements ?? {})) {
      const { locked: _auto, ...rest } = e
      elements[id] = rest
    }
    out.elements = elements
  }
  out.version = OVERRIDES_VERSION
  out.guides = { x: out.guides?.x ?? [], y: out.guides?.y ?? [] }
  return out
}

/** Serialises overrides into the script ms-runtime.js reads. */
export function overridesToScript(o: Overrides): string {
  const payload = {
    elements: o.elements,
    timeRemap: o.timeRemap,
    keepTotalDuration: o.keepTotalDuration,
    motions: o.motions,
    duplicates: o.duplicates ?? [],
    order: o.order ?? {},
    freeze: o.freeze ?? {},
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
    !e.hidden &&
    !e.locked &&
    !e.label &&
    !e.deleted &&
    e.inPoint == null &&
    e.outPoint == null &&
    !e.src &&
    !Object.keys(e.effects ?? {}).length &&
    !e.mask &&
    !e.textAnim &&
    !e.counter &&
    !e.textRuns?.length &&
    !e.highlights?.length &&
    !e.textKeys?.length &&
    !e.parent &&
    !e.moveTo &&
    !e.matte &&
    !e.motionBlur &&
    !e.videoFx &&
    !e.trim &&
    !Object.keys(e.wiggle ?? {}).length &&
    !Object.values(e.own ?? {}).some((k) => k?.length) &&
    !Object.values(e.keys ?? {}).some((k) => k?.length)
  )
}
