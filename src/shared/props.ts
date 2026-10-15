// Every property the designer can set and keyframe (After Effects' stopwatch), in one list:
// the editor builds its rows from it, the runtime animates the CSS variable it names and
// Claude reads it from get_designer_edits. A property's fixed value lives where it always
// did (transform, effects, style, mask…); its keyframes in `keys`.
import type { ElementOverride, Keyframe } from './overrides'
import { EASY_EASE, easeFn } from './ease'

export type PropKind = 'number' | 'color'
/** where the runtime puts the variable: the invisible wrapper (moves, effects) or the element (type, fill) */
export type PropTarget = 'wrap' | 'el'
export type PropGroup = 'transform' | 'effects' | 'text' | 'shape' | 'mask' | 'trim'

export interface PropDef {
  id: string
  label: string
  kind: PropKind
  group: PropGroup
  target: PropTarget
  /** registered CSS variable the runtime animates ('' = drawn by the runtime itself, e.g. masks) */
  cssVar: string
  /** CSS unit of the variable ('' = number) */
  unit: string
  /** value when nothing is set */
  def: number | string
  /** the editor shows value × scale (opacity 0–1 as %) */
  scale?: number
  shownUnit?: string
  min?: number
  max?: number
  step?: number
  precision?: number
}

const P = (id: string, label: string, group: PropGroup, target: PropTarget, cssVar: string, unit: string, def: number | string, extra: Partial<PropDef> = {}): PropDef => ({
  id,
  label,
  kind: typeof def === 'string' ? 'color' : 'number',
  group,
  target,
  cssVar,
  unit,
  def,
  ...extra,
})

export const PROPS = [
  // transform (on the wrapper, composed with Claude's own motion)
  P('x', '가로 위치', 'transform', 'wrap', '--ms-x', 'px', 0, { shownUnit: 'px' }),
  P('y', '세로 위치', 'transform', 'wrap', '--ms-y', 'px', 0, { shownUnit: 'px' }),
  P('scaleX', '가로 크기', 'transform', 'wrap', '--ms-sx', '', 1, { scale: 100, shownUnit: '%', precision: 1 }),
  P('scaleY', '세로 크기', 'transform', 'wrap', '--ms-sy', '', 1, { scale: 100, shownUnit: '%', precision: 1 }),
  P('rotate', '회전', 'transform', 'wrap', '--ms-r', 'deg', 0, { shownUnit: '°', precision: 1 }),
  P('rotateX', '3D 회전 X', 'transform', 'wrap', '--ms-rx', 'deg', 0, { shownUnit: '°' }),
  P('rotateY', '3D 회전 Y', 'transform', 'wrap', '--ms-ry', 'deg', 0, { shownUnit: '°' }),
  P('opacity', '불투명도', 'transform', 'wrap', '--ms-o', '', 1, { scale: 100, shownUnit: '%', min: 0, max: 1 }),
  P('anchorX', '기준점 X', 'transform', 'wrap', '--ms-ax', 'px', 0, { shownUnit: 'px' }),
  P('anchorY', '기준점 Y', 'transform', 'wrap', '--ms-ay', 'px', 0, { shownUnit: 'px' }),
  // effects (a filter on the wrapper)
  P('blur', '흐림', 'effects', 'wrap', '--ms-blur', 'px', 0, { shownUnit: 'px', min: 0, precision: 1 }),
  P('brightness', '밝기', 'effects', 'wrap', '--ms-br', '', 100, { shownUnit: '%', min: 0 }),
  P('contrast', '대비', 'effects', 'wrap', '--ms-ct', '', 100, { shownUnit: '%', min: 0 }),
  P('saturate', '채도', 'effects', 'wrap', '--ms-sa', '', 100, { shownUnit: '%', min: 0 }),
  P('hue', '색조', 'effects', 'wrap', '--ms-hu', 'deg', 0, { shownUnit: '°' }),
  P('grayscale', '흑백', 'effects', 'wrap', '--ms-gs', '', 0, { shownUnit: '%', min: 0, max: 100 }),
  P('sepia', '세피아', 'effects', 'wrap', '--ms-sp', '', 0, { shownUnit: '%', min: 0, max: 100 }),
  P('invert', '반전', 'effects', 'wrap', '--ms-iv', '', 0, { shownUnit: '%', min: 0, max: 100 }),
  P('shadowX', '그림자 X', 'effects', 'wrap', '--ms-shx', 'px', 0, { shownUnit: 'px' }),
  P('shadowY', '그림자 Y', 'effects', 'wrap', '--ms-shy', 'px', 12, { shownUnit: 'px' }),
  P('shadowBlur', '그림자 흐림', 'effects', 'wrap', '--ms-shb', 'px', 24, { shownUnit: 'px', min: 0 }),
  P('shadowColor', '그림자 색', 'effects', 'wrap', '--ms-shc', '', '#00000088'),
  P('glowBlur', '빛 번짐 크기', 'effects', 'wrap', '--ms-glb', 'px', 24, { shownUnit: 'px', min: 0 }),
  P('glowColor', '빛 번짐 색', 'effects', 'wrap', '--ms-glc', '', '#ffffff'),
  // type (on the element, inherited by what is inside it)
  P('color', '글자 색', 'text', 'el', '--ms-tc', '', '#ffffff'),
  P('fontSize', '글자 크기', 'text', 'el', '--ms-fs', 'px', 72, { shownUnit: 'px', min: 1 }),
  P('letterSpacing', '자간', 'text', 'el', '--ms-ls', 'px', 0, { shownUnit: 'px', precision: 1 }),
  P('lineHeight', '행간', 'text', 'el', '--ms-lh', '', 1.2, { precision: 2, step: 0.05 }),
  P('textStrokeWidth', '글자 테두리 두께', 'text', 'el', '--ms-tsw', 'px', 2, { shownUnit: 'px', min: 0, precision: 1 }),
  P('textStrokeColor', '글자 테두리 색', 'text', 'el', '--ms-tsc', '', '#000000'),
  // the box
  P('fill', '채우기', 'shape', 'el', '--ms-fill', '', '#7c5cff'),
  P('strokeWidth', '테두리 두께', 'shape', 'el', '--ms-sw', 'px', 4, { shownUnit: 'px', min: 0 }),
  P('strokeColor', '테두리 색', 'shape', 'el', '--ms-sc', '', '#ffffff'),
  P('radius', '모서리', 'shape', 'el', '--ms-rad', 'px', 0, { shownUnit: 'px', min: 0 }),
  P('gradA', '그라디언트 시작 색', 'shape', 'el', '--ms-ga', '', '#7c5cff'),
  P('gradB', '그라디언트 끝 색', 'shape', 'el', '--ms-gb', '', '#ff5c8a'),
  P('gradAngle', '그라디언트 각도', 'shape', 'el', '--ms-gang', 'deg', 135, { shownUnit: '°' }),
  // the mask (redrawn by the runtime at every frame when keyframed)
  P('maskX', '마스크 X', 'mask', 'el', '', 'px', 0, { shownUnit: 'px' }),
  P('maskY', '마스크 Y', 'mask', 'el', '', 'px', 0, { shownUnit: 'px' }),
  P('maskW', '마스크 폭', 'mask', 'el', '', 'px', 100, { shownUnit: 'px', min: 1 }),
  P('maskH', '마스크 높이', 'mask', 'el', '', 'px', 100, { shownUnit: 'px', min: 1 }),
  P('maskFeather', '마스크 페더', 'mask', 'el', '', 'px', 0, { shownUnit: 'px', min: 0 }),
  // line drawing (After Effects' Trim Paths) of the strokes inside the layer
  P('trimStart', '선 시작', 'trim', 'el', '--ms-ts', '', 0, { shownUnit: '%', min: 0, max: 100 }),
  P('trimEnd', '선 끝', 'trim', 'el', '--ms-te', '', 100, { shownUnit: '%', min: 0, max: 100 }),
] as const satisfies readonly PropDef[]

export type KeyProp = (typeof PROPS)[number]['id']
export const KEY_PROPS: readonly KeyProp[] = PROPS.map((p) => p.id)
export const PROP: Record<KeyProp, PropDef> = Object.fromEntries(PROPS.map((p) => [p.id, p])) as Record<KeyProp, PropDef>
export const isKeyProp = (p: string): p is KeyProp => p in PROP

/** resting value of each property when nothing is set */
export const KEY_DEFAULTS = Object.fromEntries(PROPS.map((p) => [p.id, p.def])) as Record<KeyProp, number | string>

/** the camera: a pseudo-layer whose transform moves the whole picture */
export const CAMERA_ID = '__camera'
/** id of a character part: "<character layer>::<part id>" */
export const PART_SEP = '::'
export const isPartId = (id: string) => id.includes(PART_SEP)

/** properties wiggle (After Effects' wiggle expression) can shake */
export const WIGGLE_PROPS = ['x', 'y', 'rotate', 'scale', 'opacity'] as const
export type WiggleProp = (typeof WIGGLE_PROPS)[number]
export const WIGGLE_LABEL: Record<WiggleProp, string> = { x: '가로', y: '세로', rotate: '회전', scale: '크기', opacity: '깜빡임' }

// ---- fixed values ----------------------------------------------------------------------

/** the fixed (non-keyframed) value of a property, or undefined when the designer never set it */
export function setValue(o: ElementOverride | undefined, p: KeyProp): number | string | undefined {
  if (!o) return undefined
  const t = o.transform ?? {}
  const fx = o.effects ?? {}
  const s = o.style ?? {}
  const m = o.mask
  switch (p) {
    case 'scaleX':
      return t.scaleX ?? t.scale
    case 'scaleY':
      return t.scaleY ?? t.scale
    case 'x':
    case 'y':
    case 'rotate':
    case 'rotateX':
    case 'rotateY':
    case 'opacity':
    case 'anchorX':
    case 'anchorY':
      return t[p]
    case 'blur':
    case 'brightness':
    case 'contrast':
    case 'saturate':
    case 'hue':
    case 'grayscale':
    case 'sepia':
    case 'invert':
      return fx[p]
    case 'shadowX':
      return fx.shadow?.x
    case 'shadowY':
      return fx.shadow?.y
    case 'shadowBlur':
      return fx.shadow?.blur
    case 'shadowColor':
      return fx.shadow?.color
    case 'glowBlur':
      return fx.glow?.blur
    case 'glowColor':
      return fx.glow?.color
    case 'color':
    case 'fontSize':
    case 'letterSpacing':
    case 'lineHeight':
    case 'fill':
    case 'radius':
      return s[p]
    case 'textStrokeWidth':
      return s.textStroke?.width
    case 'textStrokeColor':
      return s.textStroke?.color
    case 'strokeWidth':
      return s.stroke?.width
    case 'strokeColor':
      return s.stroke?.color
    case 'gradA':
      return s.gradient?.a
    case 'gradB':
      return s.gradient?.b
    case 'gradAngle':
      return s.gradient?.angle
    case 'maskX':
      return m?.x
    case 'maskY':
      return m?.y
    case 'maskW':
      return m?.w
    case 'maskH':
      return m?.h
    case 'maskFeather':
      return m?.feather
    case 'trimStart':
      return o.trim?.start
    case 'trimEnd':
      return o.trim?.end
  }
}

/** the fixed value of a property: what the designer set, else the resting value */
export function staticValue(o: ElementOverride | undefined, p: KeyProp): number | string {
  return setValue(o, p) ?? KEY_DEFAULTS[p]
}

/** a patch that sets fixed values (stopwatch off, or a value typed without keyframes) */
export function staticPatch(o: ElementOverride | undefined, values: Partial<Record<KeyProp, number | string>>): ElementOverride {
  const patch: ElementOverride = {}
  const cur = o ?? {}
  const num = (v: number | string | undefined) => (typeof v === 'number' ? v : Number(v))
  for (const [k, v] of Object.entries(values) as [KeyProp, number | string][]) {
    if (v === undefined) continue
    switch (PROP[k].group) {
      case 'transform':
        patch.transform = { ...patch.transform, [k]: num(v) }
        if (k === 'scaleX' || k === 'scaleY') patch.transform.scale = undefined
        break
      case 'effects': {
        const fx = { ...(patch.effects ?? {}) }
        if (k.startsWith('shadow')) {
          const base = fx.shadow ?? cur.effects?.shadow ?? { x: 0, y: 12, blur: 24, color: '#00000088' }
          if (k === 'shadowColor') fx.shadow = { ...base, color: String(v) }
          else fx.shadow = { ...base, [({ shadowX: 'x', shadowY: 'y', shadowBlur: 'blur' } as const)[k as 'shadowX']]: num(v) }
        } else if (k.startsWith('glow')) {
          const base = fx.glow ?? cur.effects?.glow ?? { blur: 24, color: '#ffffff' }
          fx.glow = k === 'glowColor' ? { ...base, color: String(v) } : { ...base, blur: num(v) }
        } else (fx as Record<string, number>)[k] = num(v)
        patch.effects = fx
        break
      }
      case 'text':
      case 'shape': {
        const st = { ...(patch.style ?? {}) }
        if (k === 'textStrokeWidth' || k === 'textStrokeColor') {
          const base = st.textStroke ?? cur.style?.textStroke ?? { width: 2, color: '#000000' }
          st.textStroke = k === 'textStrokeColor' ? { ...base, color: String(v) } : { ...base, width: num(v) }
        } else if (k === 'strokeWidth' || k === 'strokeColor') {
          const base = st.stroke ?? cur.style?.stroke ?? { width: 4, color: '#ffffff' }
          st.stroke = k === 'strokeColor' ? { ...base, color: String(v) } : { ...base, width: num(v) }
        } else if (k === 'gradA' || k === 'gradB' || k === 'gradAngle') {
          const base = st.gradient ?? cur.style?.gradient ?? { a: '#7c5cff', b: '#ff5c8a', angle: 135 }
          st.gradient = { ...base, ...(k === 'gradAngle' ? { angle: num(v) } : { [k === 'gradA' ? 'a' : 'b']: String(v) }) }
        } else (st as Record<string, number | string>)[k] = PROP[k].kind === 'color' ? String(v) : num(v)
        patch.style = st
        break
      }
      case 'mask': {
        const base = patch.mask ?? cur.mask ?? { shape: 'rect' as const, x: 0, y: 0, w: 100, h: 100, feather: 0 }
        const key = ({ maskX: 'x', maskY: 'y', maskW: 'w', maskH: 'h', maskFeather: 'feather' } as const)[k as 'maskX']
        patch.mask = { ...base, [key]: num(v) }
        break
      }
      case 'trim':
        patch.trim = { ...(patch.trim ?? cur.trim ?? { start: 0, end: 100 }), [k === 'trimStart' ? 'start' : 'end']: num(v) }
        break
    }
  }
  return patch
}

/** the override without the fixed value of these properties (back to what the code says) */
export function unsetStatic(o: ElementOverride, props: KeyProp[]): ElementOverride {
  const out: ElementOverride = structuredClone(o)
  for (const p of props) {
    const g = PROP[p].group
    if (g === 'transform') {
      if (out.transform) delete (out.transform as Record<string, unknown>)[p]
      if ((p === 'scaleX' || p === 'scaleY') && out.transform) delete out.transform.scale
    } else if (g === 'effects') {
      if (!out.effects) continue
      if (p.startsWith('shadow')) out.effects.shadow = null
      else if (p.startsWith('glow')) out.effects.glow = null
      else delete (out.effects as Record<string, unknown>)[p]
    } else if (g === 'text' || g === 'shape') {
      if (!out.style) continue
      if (p.startsWith('textStroke')) out.style.textStroke = null
      else if (p === 'strokeWidth' || p === 'strokeColor') out.style.stroke = null
      else if (p.startsWith('grad')) out.style.gradient = null
      else delete (out.style as Record<string, unknown>)[p]
    } else if (g === 'mask') out.mask = null
    else if (g === 'trim') out.trim = null
    if (out.keys) delete out.keys[p]
    if (out.loops) delete out.loops[p]
  }
  return out
}

// ---- colours ------------------------------------------------------------------------------

/** #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() → [r, g, b, a(0–1)] */
export function parseColor(c: string): [number, number, number, number] | null {
  const s = c.trim()
  let m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i)
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [Number(m[1]), Number(m[2]), Number(m[3]), a]
  }
  return null
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
export function formatColor([r, g, b, a]: [number, number, number, number]): string {
  return a >= 0.999 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a * 255)}`
}

/** a colour between two others (k = 0…1); colours it cannot read switch at the end */
export function lerpColor(a: string, b: string, k: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return k < 1 ? a : b
  return formatColor([0, 1, 2, 3].map((i) => ca[i] + (cb[i] - ca[i]) * k) as [number, number, number, number])
}

// ---- keyframes ----------------------------------------------------------------------------

export function sortedKeys(ks: Keyframe[] | undefined): Keyframe[] {
  return (ks ?? []).filter((k) => Number.isFinite(k.t) && (typeof k.v === 'string' || Number.isFinite(k.v))).sort((a, b) => a.t - b.t)
}

/** the value of keyframes at time t (held before the first and after the last; loops repeat them) */
export function keysAt(list: Keyframe[] | undefined, t: number, loop?: 'cycle' | 'pingpong'): number | string | undefined {
  const ks = sortedKeys(list)
  if (!ks.length) return undefined
  const first = ks[0].t
  const last = ks[ks.length - 1].t
  if (loop && t > last && last - first > 1e-6) {
    const period = last - first
    const n = Math.floor((t - first) / period)
    const local = (t - first) - n * period
    t = loop === 'pingpong' && n % 2 === 1 ? last - local : first + local
  }
  if (t <= first) return ks[0].v
  for (let i = 0; i + 1 < ks.length; i++) {
    const a = ks[i]
    const b = ks[i + 1]
    if (t < b.t) {
      if (a.e === 'hold') return a.v
      const k = easeFn(a.e ?? EASY_EASE)((t - a.t) / Math.max(1e-6, b.t - a.t))
      if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * k
      return lerpColor(String(a.v), String(b.v), k)
    }
  }
  return ks[ks.length - 1].v
}

// ---- a curved motion path (After Effects' spatial bezier on position keys) -----------------

/** x and y keyed at the same times, some key with path handles: position moves along curves */
export function isSpatial(o: ElementOverride | undefined): boolean {
  const xs = sortedKeys(o?.keys?.x)
  const ys = sortedKeys(o?.keys?.y)
  return xs.length > 1 && xs.length === ys.length && xs.every((k, i) => Math.abs(k.t - ys[i].t) < 1e-3) && xs.some((k) => !!k.c)
}

/** the position on the curved path at time t (null when the path is not curved) */
export function positionAt(o: ElementOverride | undefined, t: number): { x: number; y: number } | null {
  if (!isSpatial(o)) return null
  const xs = sortedKeys(o!.keys!.x)
  const ys = sortedKeys(o!.keys!.y)
  const loop = o?.loops?.x
  const first = xs[0].t
  const last = xs[xs.length - 1].t
  if (loop && t > last && last - first > 1e-6) {
    const period = last - first
    const n = Math.floor((t - first) / period)
    const local = t - first - n * period
    t = loop === 'pingpong' && n % 2 === 1 ? last - local : first + local
  }
  if (t <= first) return { x: Number(xs[0].v), y: Number(ys[0].v) }
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    if (t < b.t) {
      const P0 = { x: Number(a.v), y: Number(ys[i].v) }
      const P3 = { x: Number(b.v), y: Number(ys[i + 1].v) }
      if (a.e === 'hold') return P0
      const k = easeFn(a.e ?? EASY_EASE)((t - a.t) / Math.max(1e-6, b.t - a.t))
      return bezierPoint(P0, { x: P0.x + (a.c?.ox ?? 0), y: P0.y + (a.c?.oy ?? 0) }, { x: P3.x + (b.c?.ix ?? 0), y: P3.y + (b.c?.iy ?? 0) }, P3, k)
    }
  }
  return { x: Number(xs[xs.length - 1].v), y: Number(ys[ys.length - 1].v) }
}

export function bezierPoint(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, k: number) {
  const u = 1 - k
  const a = u * u * u
  const b = 3 * u * u * k
  const c = 3 * u * k * k
  const d = k * k * k
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

/** smooth handles through every position key (After Effects' auto bezier): a third of the way to the neighbours */
export function autoHandles(xs: Keyframe[], ys: Keyframe[]): Keyframe['c'][] {
  return xs.map((_, i) => {
    const prev = i > 0 ? i - 1 : i
    const next = i < xs.length - 1 ? i + 1 : i
    const tx = (Number(xs[next].v) - Number(xs[prev].v)) / (next - prev || 1)
    const ty = (Number(ys[next].v) - Number(ys[prev].v)) / (next - prev || 1)
    return { ox: tx / 3, oy: ty / 3, ix: -tx / 3, iy: -ty / 3 }
  })
}

/** value of a property at output time t (keyframes win over the fixed value) */
export function valueAt(o: ElementOverride | undefined, p: KeyProp, t: number): number {
  const v = anyValueAt(o, p, t)
  return typeof v === 'number' ? v : Number(v) || 0
}

/** value of a property (number or colour) at output time t */
export function anyValueAt(o: ElementOverride | undefined, p: KeyProp, t: number): number | string {
  if (p === 'x' || p === 'y') {
    const pos = positionAt(o, t)
    if (pos) return pos[p]
  }
  const k = keysAt(o?.keys?.[p], t, o?.loops?.[p])
  return k ?? staticValue(o, p)
}
