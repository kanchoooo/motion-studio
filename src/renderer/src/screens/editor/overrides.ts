// Designer edits: optimistic local state, instant preview via the runtime bridge,
// debounced save (each save becomes a history entry with a readable summary).
import { create } from 'zustand'
import { normalizeOverrides, type AudioEdit, type BgmTrack, type ElementOverride, type MotionOverride, type Overrides, type TimeRemapSection } from '@shared/overrides'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { ask } from './player'

const LABEL: Record<string, string> = {
  text: '문구',
  fontFamily: '폰트',
  fontWeight: '굵기',
  fontSize: '크기',
  letterSpacing: '자간',
  lineHeight: '행간',
  color: '색',
  textAlign: '정렬',
  x: '가로 위치',
  y: '세로 위치',
  scale: '크기 배율',
  rotate: '회전',
  animSpeed: '움직임 속도',
  shift: '등장 시점',
  hidden: '숨김',
}

/** changes that need the composition to rebuild its timeline */
const NEEDS_RELOAD = new Set(['text', 'animSpeed', 'shift', 'timeRemap', 'audio', 'motion'])

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
  resetElement(id: string, label: string): void
  setRemap(sections: TimeRemapSection[], keepTotal: boolean, summary: string): void
  patchAudio(id: string, patch: AudioEdit | null, summary: string): void
  setSfxGroup(group: string, value: { src: string; volume?: number } | null, summary: string): void
  setBgm(tracks: BgmTrack[], summary: string): void
  /** edit one authored motion; null removes the edit */
  patchMotion(key: string, sig: string, patch: Partial<Omit<MotionOverride, 'sig'>> | null, summary: string): void
}

let timer: ReturnType<typeof setTimeout> | undefined
let summaries: string[] = []

async function flush() {
  const st = useOverrides.getState()
  const project = useStore.getState().project
  if (!st.value || !project) return
  const summary = summaries.slice(-3).join(', ') || '직접 수정'
  summaries = []
  const reload = st.reload
  useOverrides.setState({ reload: false })
  const next = await studio.projects.saveOverrides(project.meta.id, st.value, summary)
  useOverrides.setState({ dirty: false })
  useStore.getState().setProject(next)
  if (reload) useStore.setState({ previewNonce: useStore.getState().previewNonce + 1 })
  useStore.setState({ historyNonce: useStore.getState().historyNonce + 1 })
}

function schedule(keys: string[], summary: string) {
  useOverrides.setState({ dirty: true })
  summaries = [...summaries.filter((s) => s !== summary), summary]
  if (keys.some((k) => NEEDS_RELOAD.has(k))) useOverrides.setState({ reload: true })
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), keys.some((k) => NEEDS_RELOAD.has(k)) ? 350 : 700)
}

async function livePreview(o: Overrides) {
  await ask(useEditor.getState().player, { ms: 'apply-styles', overrides: o })
  // boxes moved/resized: re-measure
  setTimeout(() => void refreshBoxes(), 30)
}

async function refreshBoxes() {
  const { queryElements } = await import('./player')
  useEditor.setState({ elements: await queryElements(useEditor.getState().player) })
}

export const useOverrides = create<OverrideState>((set, get) => ({
  value: null,
  past: [],
  future: [],
  dirty: false,
  pending: new Set(),
  reload: false,
  load: (o) => set({ value: normalizeOverrides(structuredClone(o)), past: [], future: [] }),
  undo: () => {
    const { past, value, future } = get()
    if (!past.length || !value) return
    const prev = past[past.length - 1]
    set({ value: prev, past: past.slice(0, -1), future: [value, ...future].slice(0, 100), reload: true })
    schedule(['text'], '실행 취소')
  },
  redo: () => {
    const { past, value, future } = get()
    if (!future.length || !value) return
    const next = future[0]
    set({ value: next, future: future.slice(1), past: [...past, value].slice(-100), reload: true })
    schedule(['text'], '다시 실행')
  },
  patchElement: (id, label, patch, keys) => {
    const cur = get().value
    if (!cur) return
    const prev = cur.elements[id] ?? {}
    const merged: ElementOverride = {
      ...prev,
      ...patch,
      style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
      transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
      timing: patch.timing ? { ...prev.timing, ...patch.timing } : prev.timing,
      locked: true,
    }
    const next: Overrides = { ...cur, elements: { ...cur.elements, [id]: merged } }
    set({ value: next, ...pushUndo(cur) })
    if (!keys.some((k) => NEEDS_RELOAD.has(k))) void livePreview(next)
    schedule(keys, `${label}: ${keys.map((k) => LABEL[k] ?? k).join('·')}`)
  },
  resetElement: (id, label) => {
    const cur = get().value
    if (!cur || !cur.elements[id]) return
    const elements = { ...cur.elements }
    delete elements[id]
    const next = { ...cur, elements }
    set({ value: next, reload: true, ...pushUndo(cur) })
    schedule(['text'], `${label}: 직접 수정 되돌리기`)
  },
  patchAudio: (id, patch, summary) => {
    const cur = get().value
    if (!cur) return
    const audio = { ...cur.audio }
    if (patch === null) delete audio[id]
    else audio[id] = { ...audio[id], ...patch }
    set({ value: { ...cur, audio }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  setSfxGroup: (group, value, summary) => {
    const cur = get().value
    if (!cur) return
    const sfxGroups = { ...cur.sfxGroups }
    if (value === null) delete sfxGroups[group]
    else sfxGroups[group] = value
    set({ value: { ...cur, sfxGroups }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  setBgm: (tracks, summary) => {
    const cur = get().value
    if (!cur) return
    set({ value: { ...cur, bgm: tracks }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  patchMotion: (key, sig, patch, summary) => {
    const cur = get().value
    if (!cur) return
    const motions = { ...cur.motions }
    if (patch === null) delete motions[key]
    else {
      const prev = motions[key]?.sig === sig ? motions[key] : { sig }
      const next: MotionOverride = { ...prev, ...patch, values: patch.values ? { ...prev.values, ...patch.values } : prev.values, sig }
      motions[key] = next
    }
    set({ value: { ...cur, motions }, ...pushUndo(cur) })
    schedule(['motion'], summary)
  },
  setRemap: (sections, keepTotal, summary) => {
    const cur = get().value
    if (!cur) return
    set({ value: { ...cur, timeRemap: sections, keepTotalDuration: keepTotal }, ...pushUndo(cur) })
    schedule(['timeRemap'], summary)
  },
}))

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
