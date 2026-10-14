// Designer edits: optimistic local state, instant preview via the runtime bridge,
// debounced save (each save becomes a history entry with a readable summary).
import { create } from 'zustand'
import { normalizeOverrides, type AudioEdit, type BgmTrack, type ElementOverride, type MotionOverride, type Overrides, type TimeRemapSection } from '@shared/overrides'
import { onLeaveProject, studio, useStore } from '../../store'
import { blockedEdit } from './editLock'
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
  /** the same kind of edit on several elements at once (one undo step, one history line) */
  patchElements(items: { id: string; label: string; patch: ElementOverride }[], keys: string[]): void
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
    if (blockedEdit()) return
    const cur = get().value
    if (!cur || !items.length) return
    const elements = { ...cur.elements }
    for (const { id, patch } of items) elements[id] = mergeElement(elements[id] ?? {}, patch)
    const next: Overrides = { ...cur, elements }
    set({ value: next, ...pushUndo(cur) })
    if (!keys.some((k) => NEEDS_RELOAD.has(k))) void livePreview(next)
    const what = keys.map((k) => LABEL[k] ?? k).join('·')
    schedule(keys, items.length === 1 ? `${items[0].label}: ${what}` : `요소 ${items.length}개: ${what}`)
  },
  resetElement: (id, label) => {
    if (blockedEdit()) return
    const cur = get().value
    if (!cur || !cur.elements[id]) return
    const elements = { ...cur.elements }
    delete elements[id]
    const next = { ...cur, elements }
    set({ value: next, reload: true, ...pushUndo(cur) })
    schedule(['text'], `${label}: 직접 수정 되돌리기`)
  },
  patchAudio: (id, patch, summary) => {
    if (blockedEdit()) return
    const cur = get().value
    if (!cur) return
    const audio = { ...cur.audio }
    if (patch === null) delete audio[id]
    else audio[id] = { ...audio[id], ...patch }
    set({ value: { ...cur, audio }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  setSfxGroup: (group, value, summary) => {
    if (blockedEdit()) return
    const cur = get().value
    if (!cur) return
    const sfxGroups = { ...cur.sfxGroups }
    if (value === null) delete sfxGroups[group]
    else sfxGroups[group] = value
    set({ value: { ...cur, sfxGroups }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  setBgm: (tracks, summary) => {
    if (blockedEdit()) return
    const cur = get().value
    if (!cur) return
    set({ value: { ...cur, bgm: tracks }, ...pushUndo(cur) })
    schedule(['audio'], summary)
  },
  patchMotion: (key, sig, patch, summary) => {
    if (blockedEdit()) return
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
    if (blockedEdit()) return
    const cur = get().value
    if (!cur) return
    set({ value: { ...cur, timeRemap: sections, keepTotalDuration: keepTotal }, ...pushUndo(cur) })
    schedule(['timeRemap'], summary)
  },
}))

function mergeElement(prev: ElementOverride, patch: ElementOverride): ElementOverride {
  return {
    ...prev,
    ...patch,
    style: patch.style ? { ...prev.style, ...patch.style } : prev.style,
    transform: patch.transform ? { ...prev.transform, ...patch.transform } : prev.transform,
    timing: patch.timing ? { ...prev.timing, ...patch.timing } : prev.timing,
    locked: true,
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
