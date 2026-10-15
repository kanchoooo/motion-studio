// Designer edits: optimistic local state, instant preview via the runtime bridge,
// debounced save (each save becomes a history entry with a readable summary).
// Claude makes the video; everything here edits it like After Effects does (layers,
// keyframes, effects…). Nothing is locked unless the designer locks it.
import { create } from 'zustand'
import {
  autoHandles,
  EASY_EASE,
  normalizeOverrides,
  sortedKeys,
  staticPatch,
  type AudioEdit,
  type BgmTrack,
  type DesignerLayer,
  type ElementOverride,
  type FrozenGroup,
  type Keyframe,
  type KeyProp,
  type MotionOverride,
  type Overrides,
  type TimeRemapSection,
  type WiggleProp,
} from '@shared/overrides'
import { trackKeys, withTrack, type Track } from './tracks'
import { onLeaveProject, studio, useStore } from '../../store'
import { blockedEdit } from './editLock'
import { useEditor } from './editorStore'
import { ask } from './player'

const LABEL: Record<string, string> = {
  text: '문구',
  fontFamily: '폰트',
  fontWeight: '굵기',
  fontStyle: '기울임',
  fontSize: '크기',
  letterSpacing: '자간',
  lineHeight: '행간',
  color: '색',
  textAlign: '정렬',
  textDecoration: '밑줄',
  textTransform: '대문자',
  textStroke: '글자 테두리',
  fill: '채우기',
  stroke: '테두리',
  radius: '모서리',
  x: '가로 위치',
  y: '세로 위치',
  scale: '크기 배율',
  scaleX: '가로 크기',
  scaleY: '세로 크기',
  rotate: '회전',
  rotateX: '3D 회전 X',
  rotateY: '3D 회전 Y',
  anchor: '기준점',
  opacity: '불투명도',
  animSpeed: '움직임 속도',
  shift: '등장 시점',
  hidden: '숨김',
  effects: '효과',
  mask: '마스크',
  label: '이름',
  textAnim: '글자 애니메이션',
  own: 'Claude 움직임 가져오기',
  wiggle: '흔들기',
  loop: '반복',
  counter: '숫자 카운트',
  trim: '선 그리기',
  gradient: '그라디언트',
  link: '레이어 연결',
  matte: '트랙 매트',
  blur: '모션 블러',
  video: '영상 속도',
}

/** changes that need the composition to rebuild its timeline or its HTML */
const NEEDS_RELOAD = new Set(['text', 'animSpeed', 'shift', 'timeRemap', 'audio', 'motion', 'layer', 'dup', 'delete', 'order', 'keys', 'inout', 'src', 'textAnim', 'own', 'wiggle', 'loop', 'counter', 'trim', 'mask', 'free', 'link', 'matte', 'blur', 'video'])

interface OverrideState {
  value: Overrides | null
  past: Overrides[]
  future: Overrides[]
  undo(): void
  redo(): void
  /** local edits not yet saved */
  dirty: boolean
  pending: Set<string>
  reload: boolean
  load(o: Overrides): void
  patchElement(id: string, label: string, patch: ElementOverride, keys: string[]): void
  /** the same kind of edit on several elements at once (one undo step, one history line) */
  patchElements(items: { id: string; label: string; patch: ElementOverride }[], keys: string[]): void
  resetElement(id: string, label: string): void
  setRemap(sections: TimeRemapSection[], keepTotal: boolean, summary: string): void
  patchAudio(id: string, patch: AudioEdit | null, summary: string): void
  setSfxGroup(group: string, value: { src: string; volume?: number } | null, summary: string): void
  setBgm(tracks: BgmTrack[], summary: string): void
  /** edit one authored motion; null removes the edit */
  patchMotion(key: string, sig: string, patch: Partial<Omit<MotionOverride, 'sig'>> | null, summary: string): void
  /** motion edits Claude's code no longer has: gone */
  dropMotionEdits(keys: string[]): void
  /** the designer's lock: neither Claude nor a stray click changes these layers */
  setLocked(ids: { id: string; label: string }[], locked: boolean): void
  /** a layer added by hand (text, shape, image, video, solid, adjustment) */
  addLayer(layer: DesignerLayer, init?: ElementOverride): void
  /** box, text, picture… of a layer added by hand */
  updateLayer(id: string, patch: Partial<DesignerLayer>, summary: string): void
  /** copies in place (a copy of Claude's layer keeps its motion); returns the new ids */
  duplicate(items: { id: string; label: string; copyOf: string | null; stack: string }[]): string[]
  /** deletes (Claude's layers stay restorable) */
  remove(items: { id: string; label: string }[]): void
  restore(id: string, label: string): void
  /** stacking order of one group of siblings, top first */
  setOrder(stack: string, ids: string[], summary: string): void
  // ---- keyframes (a track is a designer property or "own:<prop>" taken over from Claude) ----
  setKey(id: string, label: string, track: Track | Track[], t: number, v: number | string | (number | string)[]): void
  /** stopwatch: on = a first keyframe with the current value; off = keep the value at t, no keyframes */
  setStopwatch(id: string, label: string, props: KeyProp[], on: boolean, t: number, values: (number | string)[]): void
  removeKeys(id: string, label: string, sel: { prop: Track; t: number }[]): void
  moveKeys(id: string, label: string, sel: { prop: Track; t: number }[], dt: number): void
  setKeyEase(id: string, label: string, sel: { prop: Track; t: number }[], ease: string): void
  /** a position key's motion-path handles */
  setKeyHandles(id: string, label: string, t: number, c: Keyframe['c'] | null): void
  /** the position path curved through every key (auto handles) or straight again */
  setPathCurve(id: string, label: string, curved: boolean): void
  /** Claude's motion of these properties becomes the designer's keyframes (their values as they play now) */
  takeOver(id: string, label: string, tracks: Record<string, Keyframe[]>): void
  /** hands properties back to Claude's code */
  release(id: string, label: string, props: string[]): void
  setLoop(id: string, label: string, track: Track, mode: 'cycle' | 'pingpong' | null): void
  setWiggle(id: string, label: string, prop: WiggleProp, spec: { freq: number; amount: number } | null): void
  /** edits of a layer Claude removed or renamed, moved onto another layer (to = null: thrown away) */
  moveEdits(from: string, to: string | null): void
  /** a group laid out by the composition, set free (null: back to its layout) */
  setFree(group: string, label: string, frozen: FrozenGroup | null): void
  setInOut(items: { id: string; label: string }[], inPoint: number | null | undefined, outPoint: number | null | undefined): void
  // ---- timeline / canvas helpers ----
  addMarker(t: number): void
  updateMarker(id: string, patch: { t?: number; label?: string }): void
  removeMarker(id: string): void
  setGuides(guides: { x: number[]; y: number[] }): void
}

let timer: ReturnType<typeof setTimeout> | undefined
let summaries: string[] = []
/** project the pending edits belong to (a debounced save must never land in another project) */
let pendingProject: string | null = null
/** bumped by every edit: a save only clears "dirty" if nothing changed while it ran */
let revision = 0
/** the overrides object our own last save produced (so it is not re-loaded over the undo history) */
export let lastSaved: Overrides | null = null
let saving: Promise<void> | null = null

async function flush() {
  const st = useOverrides.getState()
  const pid = pendingProject
  if (!st.value || !pid) return
  const summary = summaries.slice(-3).join(', ') || '직접 수정'
  summaries = []
  const reload = st.reload
  const rev = revision
  useOverrides.setState({ reload: false })
  try {
    const next = await studio.projects.saveOverrides(pid, st.value, summary)
    lastSaved = next.overrides
    if (rev === revision) {
      useOverrides.setState({ dirty: false })
      pendingProject = null
    }
    if (useStore.getState().project?.meta.id === pid) {
      useStore.getState().setProject(next)
      if (reload) useStore.setState({ previewNonce: useStore.getState().previewNonce + 1 })
      useStore.setState({ historyNonce: useStore.getState().historyNonce + 1 })
    }
  } catch (e) {
    useStore.getState().toast(`직접 수정한 내용을 저장하지 못했어요. ${e instanceof Error ? e.message : String(e)}`, 'error')
    useOverrides.setState({ dirty: false })
    pendingProject = null
  }
}

/** saves pending edits now (before closing or switching projects) */
export async function flushOverrides() {
  clearTimeout(timer)
  if (saving) await saving
  if (useOverrides.getState().dirty) await flush()
}

/** a different project: start from its own edits with an empty undo history */
export function resetOverrides() {
  clearTimeout(timer)
  summaries = []
  pendingProject = null
  lastSaved = null
  useOverrides.setState({ value: null, past: [], future: [], dirty: false, reload: false })
}

function schedule(keys: string[], summary: string) {
  revision++
  pendingProject = useStore.getState().project?.meta.id ?? pendingProject
  useOverrides.setState({ dirty: true })
  summaries = [...summaries.filter((s) => s !== summary), summary]
  if (keys.some((k) => NEEDS_RELOAD.has(k))) useOverrides.setState({ reload: true })
  clearTimeout(timer)
  timer = setTimeout(() => {
    saving = flush().finally(() => (saving = null))
  }, keys.some((k) => NEEDS_RELOAD.has(k)) ? 350 : 700)
}

async function livePreview(o: Overrides) {
  await ask(useEditor.getState().player, { ms: 'apply-styles', overrides: o })
  // boxes moved/resized: re-measure
  setTimeout(() => void refreshBoxes(), 30)
}

/** one element query at a time (a drag sends many edits): the last one runs once the current one is back */
let refreshing = false
let refreshAgain = false
async function refreshBoxes() {
  if (refreshing) return void (refreshAgain = true)
  refreshing = true
  try {
    const { queryElements } = await import('./player')
    const els = await queryElements(useEditor.getState().player)
    if (els) useEditor.setState({ elements: els })
  } finally {
    refreshing = false
    if (refreshAgain) {
      refreshAgain = false
      void refreshBoxes()
    }
  }
}

/** a fresh layer id (designer layers start with L, copies of Claude's layers with D) */
export function newLayerId(prefix: 'L' | 'D'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3

export const useOverrides = create<OverrideState>((set, get) => {
  /** one edit: new value, one undo step, a save with a history line */
  const commit = (next: Overrides, keys: string[], summary: string, live = false) => {
    const cur = get().value
    if (!cur) return
    set({ value: next, ...pushUndo(cur) })
    if (live && !keys.some((k) => NEEDS_RELOAD.has(k))) void livePreview(next)
    schedule(keys, summary)
  }
  const editable = () => !blockedEdit() && !!get().value
  const withElement = (cur: Overrides, id: string, f: (e: ElementOverride) => ElementOverride): Overrides => {
    const elements = { ...cur.elements }
    elements[id] = f({ ...(elements[id] ?? {}) })
    return { ...cur, elements }
  }

  return {
    value: null,
    past: [],
    future: [],
    dirty: false,
    pending: new Set(),
    reload: false,
    load: (o) => set({ value: normalizeOverrides(structuredClone(o)), past: [], future: [] }),
    undo: () => {
      if (blockedEdit()) return
      const { past, value, future } = get()
      if (!past.length || !value) return
      const prev = past[past.length - 1]
      set({ value: prev, past: past.slice(0, -1), future: [value, ...future].slice(0, 100), reload: true })
      schedule(['text'], '실행 취소')
    },
    redo: () => {
      if (blockedEdit()) return
      const { past, value, future } = get()
      if (!future.length || !value) return
      const next = future[0]
      set({ value: next, future: future.slice(1), past: [...past, value].slice(-100), reload: true })
      schedule(['text'], '다시 실행')
    },
    patchElement: (id, label, patch, keys) => get().patchElements([{ id, label, patch }], keys),
    patchElements: (items, keys) => {
      if (!editable() || !items.length) return
      const cur = get().value!
      const elements = { ...cur.elements }
      for (const { id, patch } of items) elements[id] = mergeElement(elements[id] ?? {}, patch)
      const what = keys.map((k) => LABEL[k] ?? k).join('·')
      commit({ ...cur, elements }, keys, items.length === 1 ? `${items[0].label}: ${what}` : `요소 ${items.length}개: ${what}`, true)
    },
    resetElement: (id, label) => {
      if (!editable()) return
      const cur = get().value!
      if (!cur.elements[id]) return
      const elements = { ...cur.elements }
      // the layer stays where the designer keeps it: a lock, a name, deletion survive a reset
      const { locked, label: name } = elements[id]
      if (locked || name) elements[id] = { ...(locked ? { locked } : {}), ...(name ? { label: name } : {}) }
      else delete elements[id]
      set({ reload: true })
      commit({ ...cur, elements }, ['text'], `${label}: 직접 수정 되돌리기`)
    },
    patchAudio: (id, patch, summary) => {
      if (!editable()) return
      const cur = get().value!
      const audio = { ...cur.audio }
      if (patch === null) delete audio[id]
      else audio[id] = { ...audio[id], ...patch }
      commit({ ...cur, audio }, ['audio'], summary)
    },
    setSfxGroup: (group, value, summary) => {
      if (!editable()) return
      const cur = get().value!
      const sfxGroups = { ...cur.sfxGroups }
      if (value === null) delete sfxGroups[group]
      else sfxGroups[group] = value
      commit({ ...cur, sfxGroups }, ['audio'], summary)
    },
    setBgm: (tracks, summary) => {
      if (!editable()) return
      commit({ ...get().value!, bgm: tracks }, ['audio'], summary)
    },
    patchMotion: (key, sig, patch, summary) => {
      if (!editable()) return
      const cur = get().value!
      const motions = { ...cur.motions }
      if (patch === null) delete motions[key]
      else {
        const prev = motions[key]?.sig === sig ? motions[key] : { sig }
        motions[key] = { ...prev, ...patch, values: patch.values ? { ...prev.values, ...patch.values } : prev.values, sig }
      }
      commit({ ...cur, motions }, ['motion'], summary)
    },
    dropMotionEdits: (keys) => {
      if (!editable() || !keys.length) return
      const cur = get().value!
      const motions = { ...cur.motions }
      for (const k of keys) delete motions[k]
      commit({ ...cur, motions }, ['motion'], `적용되지 않는 모션 조정 ${keys.length}개 정리`)
    },
    setRemap: (sections, keepTotal, summary) => {
      if (!editable()) return
      commit({ ...get().value!, timeRemap: sections, keepTotalDuration: keepTotal }, ['timeRemap'], summary)
    },

    setLocked: (items, locked) => {
      if (!editable() || !items.length) return
      let next = get().value!
      for (const { id } of items) next = withElement(next, id, (e) => ({ ...e, locked: locked || undefined }))
      commit(next, ['lock'], items.length === 1 ? `${items[0].label}: ${locked ? '잠금' : '잠금 해제'}` : `레이어 ${items.length}개 ${locked ? '잠금' : '잠금 해제'}`)
    },
    addLayer: (layer, init) => {
      if (!editable()) return
      const cur = get().value!
      const elements = init ? { ...cur.elements, [layer.id]: init } : cur.elements
      commit({ ...cur, layers: [...cur.layers, layer], elements }, ['layer'], `레이어 추가: ${layer.label}`)
    },
    updateLayer: (id, patch, summary) => {
      if (!editable()) return
      const cur = get().value!
      if (!cur.layers.some((l) => l.id === id)) return
      commit({ ...cur, layers: cur.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }, ['layer'], summary)
    },
    duplicate: (items) => {
      if (!editable() || !items.length) return []
      const cur = get().value!
      let layers = [...cur.layers]
      let duplicates = [...cur.duplicates]
      const elements = { ...cur.elements }
      const order = { ...cur.order }
      const ids: string[] = []
      for (const it of items) {
        const own = layers.find((l) => l.id === it.id)
        const id = newLayerId(own ? 'L' : 'D')
        if (own) layers = [...layers, { ...own, id, label: `${own.label} 복사` }]
        else duplicates = [...duplicates, { id, of: it.copyOf ?? it.id }]
        const { locked: _l, deleted: _d, ...copy } = structuredClone(elements[it.id] ?? {})
        elements[id] = { ...copy, label: `${copy.label ?? it.label} 복사` }
        // the copy sits right above the original
        const stack = order[it.stack]
        if (stack?.includes(it.id)) {
          const i = stack.indexOf(it.id)
          order[it.stack] = [...stack.slice(0, i), id, ...stack.slice(i)]
        }
        ids.push(id)
      }
      commit({ ...cur, layers, duplicates, elements, order }, ['dup'], items.length === 1 ? `복제: ${items[0].label}` : `레이어 ${items.length}개 복제`)
      return ids
    },
    remove: (items) => {
      if (!editable() || !items.length) return
      const cur = get().value!
      const gone = new Set(items.map((i) => i.id))
      const own = (id: string) => cur.layers.some((l) => l.id === id) || cur.duplicates.some((d) => d.id === id)
      const elements = { ...cur.elements }
      for (const id of gone) {
        if (own(id)) delete elements[id]
        else elements[id] = { ...(elements[id] ?? {}), deleted: true }
      }
      const order: Overrides['order'] = {}
      for (const [k, ids] of Object.entries(cur.order)) order[k] = ids.filter((id) => !(gone.has(id) && own(id)))
      commit(
        {
          ...cur,
          elements,
          order,
          layers: cur.layers.filter((l) => !gone.has(l.id)),
          // copies of what is deleted go too
          duplicates: cur.duplicates.filter((d) => !gone.has(d.id)),
        },
        ['delete'],
        items.length === 1 ? `삭제: ${items[0].label}` : `레이어 ${items.length}개 삭제`,
      )
    },
    restore: (id, label) => {
      if (!editable()) return
      commit(withElement(get().value!, id, (e) => ({ ...e, deleted: undefined })), ['delete'], `되살리기: ${label}`)
    },
    setOrder: (stack, ids, summary) => {
      if (!editable()) return
      const cur = get().value!
      commit({ ...cur, order: { ...cur.order, [stack]: ids } }, ['order'], summary)
    },

    setKey: (id, label, track, t, v) => {
      if (!editable()) return
      const tracks = Array.isArray(track) ? track : [track]
      const values = Array.isArray(v) ? v : [v]
      const time = +Math.max(0, t).toFixed(4)
      let next = get().value!
      tracks.forEach((tr, i) => {
        next = withElement(next, id, (e) => {
          const list = [...trackKeys(e, tr)]
          const at = list.findIndex((k) => near(k.t, time))
          const value = values[i] ?? values[0]
          const key: Keyframe = at >= 0 ? { ...list[at], v: value } : { t: time, v: value, e: EASY_EASE }
          if (at >= 0) list[at] = key
          else list.push(key)
          return withTrack(e, tr, sortedKeys(list))
        })
      })
      commit(next, ['keys'], `${label}: 키프레임 ${time.toFixed(2)}초`)
    },
    setStopwatch: (id, label, props, on, t, values) => {
      if (!editable()) return
      const time = +Math.max(0, t).toFixed(4)
      let next = withElement(get().value!, id, (e) => {
        let out = e
        props.forEach((p, i) => {
          out = withTrack(out, p, on ? [{ t: time, v: values[i], e: EASY_EASE }] : [])
        })
        // the value at this moment stays as the layer's fixed value
        if (!on) out = mergeElement(out, staticPatch(out, Object.fromEntries(props.map((p, i) => [p, values[i]]))))
        return out
      })
      if (!on) next = withElement(next, id, (e) => {
        const loops = { ...(e.loops ?? {}) }
        for (const p of props) delete loops[p]
        return { ...e, loops }
      })
      commit(next, ['keys'], `${label}: ${on ? '키프레임 켜기' : '키프레임 끄기'}`)
    },
    removeKeys: (id, label, sel) => {
      if (!editable() || !sel.length) return
      const next = withElement(get().value!, id, (e) => {
        let out = e
        for (const tr of new Set(sel.map((s) => s.prop))) {
          const gone = sel.filter((s) => s.prop === tr)
          out = withTrack(out, tr, trackKeys(out, tr).filter((k) => !gone.some((g) => near(g.t, k.t))))
        }
        return out
      })
      commit(next, ['keys'], `${label}: 키프레임 ${sel.length}개 삭제`)
    },
    moveKeys: (id, label, sel, dt) => {
      if (!editable() || !sel.length || !dt) return
      const next = withElement(get().value!, id, (e) => {
        let out = e
        for (const p of new Set(sel.map((s) => s.prop))) {
          const moving = (k: Keyframe) => sel.some((s) => s.prop === p && near(s.t, k.t))
          const list = trackKeys(out, p)
          const moved = list.filter(moving).map((k) => ({ ...k, t: +Math.max(0, k.t + dt).toFixed(4) }))
          // a key the moved ones land on is replaced
          const stay = list.filter((k) => !moving(k) && !moved.some((m) => near(m.t, k.t)))
          out = withTrack(out, p, sortedKeys([...stay, ...moved]))
        }
        return out
      })
      commit(next, ['keys'], `${label}: 키프레임 이동`)
    },
    setKeyEase: (id, label, sel, ease) => {
      if (!editable() || !sel.length) return
      const next = withElement(get().value!, id, (e) => {
        let out = e
        for (const p of new Set(sel.map((s) => s.prop))) {
          const here = sel.filter((s) => s.prop === p)
          out = withTrack(out, p, trackKeys(out, p).map((k) => (here.some((s) => near(s.t, k.t)) ? { ...k, e: ease } : k)))
        }
        return out
      })
      commit(next, ['keys'], `${label}: 키프레임 이징`)
    },
    setKeyHandles: (id, label, t, c) => {
      if (!editable()) return
      const next = withElement(get().value!, id, (e) =>
        withTrack(e, 'x', trackKeys(e, 'x').map((k) => (near(k.t, t) ? (c ? { ...k, c } : (({ c: _c, ...rest }) => rest)(k)) : k))),
      )
      commit(next, ['keys'], `${label}: 움직임 경로 곡선`)
    },
    setPathCurve: (id, label, curved) => {
      if (!editable()) return
      const next = withElement(get().value!, id, (e) => {
        const xs = sortedKeys(trackKeys(e, 'x'))
        const ys = sortedKeys(trackKeys(e, 'y'))
        if (curved && (xs.length < 2 || xs.length !== ys.length || xs.some((k, i) => Math.abs(k.t - ys[i].t) > 1e-3))) return e
        const hs = autoHandles(xs, ys)
        return withTrack(e, 'x', xs.map((k, i) => (curved ? { ...k, c: hs[i] } : (({ c: _c, ...rest }) => rest)(k))))
      })
      commit(next, ['keys'], `${label}: 움직임 경로 ${curved ? '곡선' : '직선'}`)
    },
    takeOver: (id, label, tracks) => {
      if (!editable()) return
      const props = Object.keys(tracks).filter((p) => tracks[p]?.length)
      if (!props.length) return
      const next = withElement(get().value!, id, (e) => ({ ...e, own: { ...(e.own ?? {}), ...Object.fromEntries(props.map((p) => [p, sortedKeys(tracks[p])])) } }))
      commit(next, ['own'], `${label}: Claude 움직임 가져오기 (${props.length}개)`)
    },
    release: (id, label, props) => {
      if (!editable() || !props.length) return
      const next = withElement(get().value!, id, (e) => {
        const own = { ...(e.own ?? {}) }
        const loops = { ...(e.loops ?? {}) }
        for (const p of props) {
          delete own[p]
          delete loops[`own:${p}`]
        }
        return { ...e, own, loops }
      })
      commit(next, ['own'], `${label}: Claude에게 돌려주기`)
    },
    setLoop: (id, label, track, mode) => {
      if (!editable()) return
      const next = withElement(get().value!, id, (e) => {
        const loops = { ...(e.loops ?? {}) }
        if (mode) loops[track] = mode
        else delete loops[track]
        return { ...e, loops }
      })
      commit(next, ['loop'], `${label}: ${mode ? (mode === 'cycle' ? '반복' : '왕복') : '반복 끄기'}`)
    },
    moveEdits: (from, to) => {
      if (!editable()) return
      const cur = get().value!
      const moving = cur.elements[from]
      if (!moving || from === to) return
      const elements = { ...cur.elements }
      delete elements[from]
      if (to) elements[to] = { ...moving, ...elements[to], ...(elements[to]?.locked ? { locked: true } : {}) }
      commit({ ...cur, elements }, ['text'], to ? `직접 수정 옮기기: ${moving.label ?? from} → ${to}` : `붙을 곳 없는 직접 수정 버리기: ${moving.label ?? from}`)
    },
    setFree: (group, label, frozen) => {
      if (!editable()) return
      const cur = get().value!
      const freeze = { ...(cur.freeze ?? {}) }
      if (frozen) freeze[group] = frozen
      else delete freeze[group]
      commit({ ...cur, freeze }, ['free'], `${label}: ${frozen ? '자유 배치로 바꾸기' : '원래 배치로'}`)
    },
    setWiggle: (id, label, prop, spec) => {
      if (!editable()) return
      const next = withElement(get().value!, id, (e) => {
        const wiggle = { ...(e.wiggle ?? {}) }
        if (spec) wiggle[prop] = spec
        else delete wiggle[prop]
        return { ...e, wiggle }
      })
      commit(next, ['wiggle'], `${label}: 흔들기`)
    },
    setInOut: (items, inPoint, outPoint) => {
      if (!editable() || !items.length) return
      let next = get().value!
      for (const { id } of items) {
        next = withElement(next, id, (e) => ({
          ...e,
          ...(inPoint !== undefined ? { inPoint: inPoint === null ? undefined : +Math.max(0, inPoint).toFixed(4) } : {}),
          ...(outPoint !== undefined ? { outPoint: outPoint === null ? undefined : +Math.max(0, outPoint).toFixed(4) } : {}),
        }))
      }
      commit(next, ['inout'], items.length === 1 ? `${items[0].label}: 인/아웃` : `레이어 ${items.length}개 인/아웃`)
    },

    addMarker: (t) => {
      if (!editable()) return
      const cur = get().value!
      const n = cur.markers.length + 1
      commit({ ...cur, markers: [...cur.markers, { id: newLayerId('L'), t: +t.toFixed(4), label: `마커 ${n}` }].sort((a, b) => a.t - b.t) }, ['marker'], `마커 추가 ${t.toFixed(2)}초`)
    },
    updateMarker: (id, patch) => {
      if (!editable()) return
      const cur = get().value!
      commit({ ...cur, markers: cur.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t) }, ['marker'], '마커 수정')
    },
    removeMarker: (id) => {
      if (!editable()) return
      const cur = get().value!
      commit({ ...cur, markers: cur.markers.filter((m) => m.id !== id) }, ['marker'], '마커 삭제')
    },
    setGuides: (guides) => {
      if (!editable()) return
      commit({ ...get().value!, guides }, ['guide'], '가이드')
    },
  }
})

function mergeElement(prev: ElementOverride, patch: ElementOverride): ElementOverride {
  return {
    ...prev,
    ...patch,
    style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
    transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
    timing: patch.timing ? { ...prev.timing, ...patch.timing } : prev.timing,
    effects: patch.effects ? { ...prev.effects, ...patch.effects } : prev.effects,
  }
}

// a drag or a scrub produces many patches; keep one undo step per gesture
let lastPush = 0
function pushUndo(cur: Overrides): Partial<OverrideState> {
  const now = Date.now()
  const st = useOverrides.getState()
  const coalesce = now - lastPush < 600
  lastPush = now
  return coalesce ? { future: [] } : { past: [...st.past, cur].slice(-100), future: [] }
}

export function rgbToHex(c: string): string {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return c.startsWith('#') ? c : '#000000'
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`
}

onLeaveProject(async () => {
  await flushOverrides()
  resetOverrides()
})
