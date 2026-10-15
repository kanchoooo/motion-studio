// Editing actions shared by the inspector, the canvas, the timeline and the shortcuts:
// After Effects–style (a keyframed property gets a key at the playhead, anything else a
// fixed value), layer operations (add, duplicate, delete, lock, order, split, trim) and
// arranging (nudge, align, distribute, copy / paste).
import {
  anyValueAt,
  KEY_PROPS,
  PROP,
  setValue,
  sortedKeys,
  staticPatch,
  valueAt,
  type DesignerLayer,
  type DesignerLayerKind,
  type ElementOverride,
  type KeyProp,
} from '@shared/overrides'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { newLayerId, rgbToHex, useOverrides } from './overrides'
import { claudeTracks, type RuntimeElement } from './player'
import { isOwn, keyedTracks, ownProp, ownTrack, trackKeys, type Track } from './tracks'

const fps = () => useStore.getState().project?.brief.output.fps ?? 30
/** a time on the frame grid (keyframes sit on frames, like in After Effects) */
export const snapT = (t: number) => Math.round(Math.max(0, t) * fps()) / fps()

export const ov = (id: string): ElementOverride | undefined => useOverrides.getState().value?.elements[id]
export const isKeyed = (id: string, p: Track) => trackKeys(ov(id), p).length > 0
export const valueNow = (id: string, p: KeyProp, t = useEditor.getState().time) => valueAt(withBase(id, p), p, t)
export const isLocked = (id: string) => !!ov(id)?.locked

const el = (id: string) => useEditor.getState().elements.find((e) => e.id === id)
export const labelOf = (id: string) => ov(id)?.label ?? el(id)?.label ?? id

/**
 * What a property shows when the designer never set it: Claude's own type and box (read from
 * the preview), else the property's resting value.
 */
export function baseValue(id: string, p: KeyProp): number | string {
  const set = setValue(ov(id), p)
  if (set != null) return set
  const e = el(id)
  if (e) {
    const st = e.style
    if (p === 'color' && st.color) return rgbToHex(st.color)
    if (p === 'fontSize' && st.fontSize) return st.fontSize
    if (p === 'letterSpacing') return st.letterSpacing
    if (p === 'lineHeight' && st.lineHeight) return +st.lineHeight.toFixed(2)
    if (p === 'fill' && st.background && !/rgba\(0, 0, 0, 0\)|transparent/.test(st.background)) return rgbToHex(st.background)
    if (p === 'radius') return st.radius
  }
  return PROP[p].def
}
/** the override with a property's base value filled in (for reading values between keys) */
function withBase(id: string, p: KeyProp): ElementOverride | undefined {
  const o = ov(id)
  if (setValue(o, p) != null || trackKeys(o, p).length) return o
  return { ...(o ?? {}), ...staticPatch(o, { [p]: baseValue(id, p) }) }
}
/** a property's value now (number or colour) */
export const anyNow = (id: string, p: KeyProp, t = useEditor.getState().time) => anyValueAt(withBase(id, p), p, t)

/**
 * Sets values on a layer: keyframed properties get a key at the playhead, the others a fixed
 * value. Several layers at once share one undo step.
 */
export function setProps(items: { id: string; values: Partial<Record<KeyProp, number | string>> }[], summaryKeys: string[]) {
  const st = useOverrides.getState()
  const t = snapT(useEditor.getState().time)
  const statics: { id: string; label: string; patch: ElementOverride }[] = []
  for (const { id, values } of items) {
    if (isLocked(id)) continue
    const keyed = (Object.keys(values) as KeyProp[]).filter((p) => isKeyed(id, p))
    const fixed = (Object.keys(values) as KeyProp[]).filter((p) => !isKeyed(id, p))
    if (keyed.length) st.setKey(id, labelOf(id), keyed, t, keyed.map((p) => values[p]!))
    if (fixed.length) statics.push({ id, label: labelOf(id), patch: staticPatch(ov(id), Object.fromEntries(fixed.map((p) => [p, values[p]]))) })
  }
  if (statics.length) st.patchElements(statics, summaryKeys)
}

/** stopwatch on a group of properties (position = x+y, scale = scaleX+scaleY…) */
export function toggleStopwatch(id: string, props: KeyProp[]) {
  const on = !props.some((p) => isKeyed(id, p))
  const t = snapT(useEditor.getState().time)
  useOverrides.getState().setStopwatch(id, labelOf(id), props, on, t, props.map((p) => anyNow(id, p, t)))
}

/** adds a key with the current value at the playhead, or removes the key that is there */
export function toggleKeyHere(id: string, props: Track[]) {
  const t = snapT(useEditor.getState().time)
  const here = props.filter((p) => trackKeys(ov(id), p).some((k) => Math.abs(k.t - t) < 1e-3))
  if (here.length) return useOverrides.getState().removeKeys(id, labelOf(id), here.map((p) => ({ prop: p, t })))
  const own = props.filter(isOwn)
  const mine = props.filter((p): p is KeyProp => !isOwn(p))
  if (mine.length) useOverrides.getState().setKey(id, labelOf(id), mine, t, mine.map((p) => anyNow(id, p, t)))
  if (own.length) void ownValuesNow(id, own.map(ownProp)).then((vals) => useOverrides.getState().setKey(id, labelOf(id), own, t, own.map((p) => vals[ownProp(p)] ?? 0)))
}

/** every keyframe time of a layer (or of some of its tracks) */
export function keyTimes(id: string, props: readonly Track[] = [...KEY_PROPS, ...keyedTracks(ov(id)).filter(isOwn)]): number[] {
  const set = new Set<number>()
  for (const p of props) for (const k of sortedKeys(trackKeys(ov(id), p))) set.add(+k.t.toFixed(4))
  return [...set].sort((a, b) => a - b)
}

/** J / K: the playhead to the previous / next keyframe of the selected layers */
export function jumpKey(dir: -1 | 1) {
  const { selection, time, player } = useEditor.getState()
  const times = [...new Set(selection.flatMap((id) => keyTimes(id)))].sort((a, b) => a - b)
  const t = dir < 0 ? [...times].reverse().find((x) => x < time - 1e-3) : times.find((x) => x > time + 1e-3)
  if (t == null) return
  player?.pause()
  player?.seek(t)
  useEditor.setState({ time: t })
}

// ---- Claude's motion, taken over as keyframes ----

/** the values of taken-over (or Claude's) properties at the playhead, read from the preview */
export async function ownValuesNow(id: string, props: string[]): Promise<Record<string, number | string>> {
  const { propsNow } = await import('./player')
  return propsNow(useEditor.getState().player, id, props)
}

/**
 * Makes Claude's motion of these properties the designer's keyframes (as they play now), so
 * they can be dragged, eased, added to; Claude's tweens of them stop. Returns false when the
 * preview could not read them.
 */
export async function takeOver(id: string, props: string[]): Promise<boolean> {
  const todo = props.filter((p) => !trackKeys(ov(id), ownTrack(p)).length)
  if (!todo.length) return true
  const tracks = await claudeTracks(useEditor.getState().player, id, todo)
  const got: Record<string, NonNullable<ElementOverride['own']>[string]> = {}
  for (const p of todo) {
    if (tracks[p]?.length) got[p] = tracks[p]
  }
  // a property Claude never animates (a character parameter left at rest) starts from its value now
  const missing = todo.filter((p) => !got[p])
  if (missing.length) {
    const now = await ownValuesNow(id, missing)
    for (const p of missing) if (now[p] !== undefined) got[p] = [{ t: 0, v: now[p], e: 'linear' }]
  }
  if (!Object.keys(got).length) return false
  useOverrides.getState().takeOver(id, labelOf(id), got)
  return true
}

/** sets a taken-over property at the playhead (taking it over first): a key, like any keyframed property */
export async function setOwnNow(id: string, prop: string, v: number | string) {
  if (isLocked(id)) return
  if (!(await takeOver(id, [prop]))) return
  useOverrides.getState().setKey(id, labelOf(id), ownTrack(prop), snapT(useEditor.getState().time), v)
}

export function releaseOwn(id: string, props: string[]) {
  useOverrides.getState().release(id, labelOf(id), props)
}

// ---- layers ----

export function selectionItems(ids = useEditor.getState().selection) {
  return ids
    .map((id) => el(id))
    .filter((e): e is RuntimeElement => !!e)
    .map((e) => ({ id: e.id, label: labelOf(e.id), copyOf: e.copyOf, stack: e.stack }))
}

export function duplicateSelection() {
  const items = selectionItems().filter((i) => !isLocked(i.id))
  if (!items.length) return
  const ids = useOverrides.getState().duplicate(items)
  if (ids.length) useEditor.setState({ selected: ids[0], selection: ids })
}

export function deleteSelection() {
  const items = selectionItems().filter((i) => !isLocked(i.id))
  if (!items.length) return
  useOverrides.getState().remove(items)
  useEditor.getState().select(null)
}

export function toggleLockSelection() {
  const items = selectionItems()
  if (!items.length) return
  useOverrides.getState().setLocked(items, !items.every((i) => isLocked(i.id)))
}

export function toggleHidden(ids: string[]) {
  const items = ids.map((id) => ({ id, label: labelOf(id) }))
  const hide = !items.every((i) => ov(i.id)?.hidden)
  useOverrides.getState().patchElements(items.map((i) => ({ ...i, patch: { hidden: hide } })), ['hidden'])
}

/** siblings that stack together, top first */
export function stackOf(stack: string): RuntimeElement[] {
  return useEditor.getState().elements.filter((e) => e.stack === stack && !['sfx', 'bgm', 'voice'].includes(e.type)).sort((a, b) => a.rank - b.rank)
}

/** ] / [ (with ⌘): one step up or down; front / back: to the top or the bottom of its group */
export function reorder(ids: string[], to: 'up' | 'down' | 'front' | 'back') {
  const first = el(ids[0])
  if (!first) return
  const sibs = stackOf(first.stack).map((e) => e.id)
  const moving = sibs.filter((id) => ids.includes(id))
  if (!moving.length) return
  let next = sibs.filter((id) => !moving.includes(id))
  if (to === 'front') next = [...moving, ...next]
  else if (to === 'back') next = [...next, ...moving]
  else {
    const top = sibs.indexOf(moving[0])
    const at = Math.max(0, Math.min(next.length, to === 'up' ? top - 1 : top + 1))
    next = [...next.slice(0, at), ...moving, ...next.slice(at)]
  }
  if (next.join() === sibs.join()) return
  const word = { up: '앞으로', down: '뒤로', front: '맨 앞으로', back: '맨 뒤로' }[to]
  useOverrides.getState().setOrder(first.stack, next, `${moving.length === 1 ? labelOf(moving[0]) : `레이어 ${moving.length}개`}: ${word}`)
}

/** ⌘⇧D: the layer ends at the playhead and a copy carries on from there */
export function splitAtPlayhead() {
  const t = snapT(useEditor.getState().time)
  const items = selectionItems().filter((i) => !isLocked(i.id))
  if (!items.length) return
  const st = useOverrides.getState()
  const copies = st.duplicate(items)
  items.forEach((it, i) => {
    st.setInOut([{ id: it.id, label: it.label }], undefined, t)
    st.setInOut([{ id: copies[i], label: `${it.label} 복사` }], t, ov(it.id)?.outPoint ?? null)
  })
  if (copies.length) useEditor.setState({ selected: copies[0], selection: copies })
}

/** ⌥[ / ⌥]: the in or the out point to the playhead */
export function trimToPlayhead(which: 'in' | 'out') {
  const t = snapT(useEditor.getState().time)
  const items = selectionItems().filter((i) => !isLocked(i.id))
  if (!items.length) return
  useOverrides.getState().setInOut(items, which === 'in' ? t : undefined, which === 'out' ? t : undefined)
}

// ---- arranging on the canvas ----

/** arrow keys: move the selected layers by whole pixels */
export function nudge(dx: number, dy: number) {
  const { selection, elements } = useEditor.getState()
  const items = selection
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is RuntimeElement => !!e && e.movable && !isLocked(e.id))
    .map((e) => ({ id: e.id, values: { x: valueNow(e.id, 'x') + dx, y: valueNow(e.id, 'y') + dy } }))
  if (items.length) setProps(items, ['x', 'y'])
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
/** lines the selected layers up with each other (one layer: with the canvas) */
export function align(mode: Align) {
  const { selection, elements, comp } = useEditor.getState()
  const picked = selection.map((id) => elements.find((e) => e.id === id)).filter((e): e is RuntimeElement => !!e && e.movable && !isLocked(e.id))
  if (!picked.length) return
  const box = picked.length > 1
    ? {
        x: Math.min(...picked.map((e) => e.rect.x)),
        y: Math.min(...picked.map((e) => e.rect.y)),
        r: Math.max(...picked.map((e) => e.rect.x + e.rect.w)),
        b: Math.max(...picked.map((e) => e.rect.y + e.rect.h)),
      }
    : { x: 0, y: 0, r: comp.w, b: comp.h }
  const items = picked.map((e) => {
    const r = e.rect
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = box.x - r.x
    if (mode === 'right') dx = box.r - (r.x + r.w)
    if (mode === 'hcenter') dx = (box.x + box.r) / 2 - (r.x + r.w / 2)
    if (mode === 'top') dy = box.y - r.y
    if (mode === 'bottom') dy = box.b - (r.y + r.h)
    if (mode === 'vcenter') dy = (box.y + box.b) / 2 - (r.y + r.h / 2)
    return { id: e.id, values: { x: Math.round(valueNow(e.id, 'x') + dx), y: Math.round(valueNow(e.id, 'y') + dy) } }
  })
  setProps(items, ['x', 'y'])
}

/** equal gaps between three or more layers */
export function distribute(axis: 'h' | 'v') {
  const { selection, elements } = useEditor.getState()
  const picked = selection.map((id) => elements.find((e) => e.id === id)).filter((e): e is RuntimeElement => !!e && e.movable && !isLocked(e.id))
  if (picked.length < 3) return
  const pos = (e: RuntimeElement) => (axis === 'h' ? e.rect.x : e.rect.y)
  const size = (e: RuntimeElement) => (axis === 'h' ? e.rect.w : e.rect.h)
  const sorted = [...picked].sort((a, b) => pos(a) - pos(b))
  const start = pos(sorted[0])
  const end = pos(sorted[sorted.length - 1]) + size(sorted[sorted.length - 1])
  const gap = (end - start - sorted.reduce((a, e) => a + size(e), 0)) / (sorted.length - 1)
  let at = start
  const items = sorted.map((e) => {
    const d = at - pos(e)
    at += size(e) + gap
    return { id: e.id, values: axis === 'h' ? { x: Math.round(valueNow(e.id, 'x') + d) } : { y: Math.round(valueNow(e.id, 'y') + d) } }
  })
  setProps(items, [axis === 'h' ? 'x' : 'y'])
}

// ---- adding layers ----

let seq = 0
function nextLabel(word: string) {
  const layers = useOverrides.getState().value?.layers ?? []
  const n = layers.filter((l) => l.label.startsWith(word)).length + 1 + seq++ * 0
  return `${word} ${n}`
}

/** a layer added by hand, in the middle of the canvas; images and clips come from a file or the brief's assets */
export async function addLayer(kind: DesignerLayerKind | 'rect' | 'ellipse', file?: string) {
  const project = useStore.getState().project
  if (!project) return
  const { width: W, height: H } = project.brief.output
  const id = newLayerId('L')
  const st = useOverrides.getState()
  const center = (w: number, h: number) => ({ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h) })
  let layer: DesignerLayer | null = null
  let init: ElementOverride | undefined
  if (kind === 'text') {
    const size = Math.round(Math.min(W, H) * 0.07)
    layer = { id, kind: 'text', label: nextLabel('텍스트'), text: '텍스트를 입력하세요', ...center(Math.round(W * 0.6), size * 1.3) }
    const font = project.brief.brand?.fonts.headline
    init = { style: { fontSize: size, fontWeight: 700, color: '#ffffff', textAlign: 'center', ...(font ? { fontFamily: font } : {}) } }
  } else if (kind === 'rect' || kind === 'shape') {
    layer = { id, kind: 'shape', shape: 'rect', label: nextLabel('사각형'), ...center(W * 0.25, H * 0.25) }
    init = { style: { fill: '#7c5cff' } }
  } else if (kind === 'ellipse') {
    const d = Math.min(W, H) * 0.3
    layer = { id, kind: 'shape', shape: 'ellipse', label: nextLabel('원'), ...center(d, d) }
    init = { style: { fill: '#7c5cff' } }
  } else if (kind === 'solid') {
    layer = { id, kind: 'solid', label: nextLabel('단색'), x: 0, y: 0, w: W, h: H }
    init = { style: { fill: '#111111' } }
  } else if (kind === 'adjustment') {
    layer = { id, kind: 'adjustment', label: nextLabel('조정 레이어'), x: 0, y: 0, w: W, h: H }
    init = { effects: { brightness: 110, saturate: 120 } }
  } else if (kind === 'image' || kind === 'video') {
    const picked = file ? [file] : await studio.app.pickFiles(kind === 'image' ? 'images' : 'assets')
    if (!picked[0]) return
    const [asset] = await studio.projects.importAssets(project.meta.id, [picked[0]])
    if (!asset) return
    const isVideo = asset.kind === 'video' || /\.(mp4|mov|webm|m4v)$/i.test(asset.file)
    const w0 = asset.meta?.width || W * 0.5
    const h0 = asset.meta?.height || H * 0.5
    const k = Math.min(1, (W * 0.6) / w0, (H * 0.6) / h0)
    layer = { id, kind: isVideo ? 'video' : 'image', label: nextLabel(isVideo ? '동영상' : '이미지'), src: asset.file, fit: 'contain', muted: true, ...center(w0 * k, h0 * k) }
  }
  if (!layer) return
  st.addLayer(layer, init)
  useEditor.setState({ selected: id, selection: [id], panel: 'elements' })
}

// ---- copy / paste (in place, like After Effects) ----

interface Clip {
  layer?: DesignerLayer
  of?: string
  override: ElementOverride
  label: string
}
let clipboard: Clip[] = []

export function copySelection() {
  const o = useOverrides.getState().value
  if (!o) return 0
  clipboard = selectionItems().map((i) => {
    const layer = o.layers.find((l) => l.id === i.id)
    const { locked: _l, deleted: _d, ...override } = structuredClone(o.elements[i.id] ?? {})
    return layer ? { layer: structuredClone(layer), override, label: i.label } : { of: i.copyOf ?? i.id, override, label: i.label }
  })
  return clipboard.length
}

export function paste() {
  if (!clipboard.length) return
  const st = useOverrides.getState()
  const ids: string[] = []
  for (const c of clipboard) {
    if (c.layer) {
      const id = newLayerId('L')
      st.addLayer({ ...c.layer, id, label: `${c.label} 붙여넣기` }, { ...c.override, label: undefined })
      ids.push(id)
    } else if (c.of) {
      const orig = useEditor.getState().elements.find((e) => e.id === c.of)
      const [id] = st.duplicate([{ id: c.of, label: c.label, copyOf: null, stack: orig?.stack ?? '' }])
      if (id) ids.push(id)
    }
  }
  if (ids.length) useEditor.setState({ selected: ids[0], selection: ids })
}

// ---- a group laid out by the composition (flex, grid…), set free ----

/**
 * The layers of the group around this one keep where they are now but become freely placed
 * (absolute), so each can be scaled, turned, masked… Measured in the preview once; the
 * composition's code is not touched.
 */
export async function freeLayout(id: string): Promise<boolean> {
  const e = el(id)
  if (!e?.parent) return false
  const { ask } = await import('./player')
  const r = await ask<{ group: string; size: { w: number; h: number }; kids: Record<string, { l: number; t: number; w: number; h: number }> } | { error: string }>(useEditor.getState().player, { ms: 'measure-flow', id: e.parent }, 3000)
  if (!r || 'error' in r) return false
  useOverrides.getState().setFree(r.group, labelOf(r.group), { size: r.size, kids: r.kids })
  return true
}
