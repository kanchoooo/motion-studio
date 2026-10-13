import { create } from 'zustand'
import type { AudioClipInfo } from '@shared/api'
import type { FeedbackMark } from '@shared/project'
import type { ElementTiming, MsPlayer, RuntimeElement, RuntimeMotion } from './player'

export type Tool = 'select' | 'box' | 'pin'

interface EditorState {
  player: MsPlayer | null
  time: number
  duration: number
  playing: boolean
  ready: boolean
  elements: RuntimeElement[]
  selected: string | null
  /** audio clips parsed from the composition (Claude's + designer BGM) */
  audio: AudioClipInfo[]
  timing: ElementTiming[]
  motions: RuntimeMotion[]
  /** motion edits Claude's latest code no longer matches */
  staleMotions: string[]
  selectedMotion: string | null
  /** layers whose motions are unfolded in the timeline */
  openLayers: string[]
  selectedAudio: string | null
  panel: 'elements' | 'motion' | 'sound'
  tool: Tool
  marks: FeedbackMark[]
  markTime: number | null
  /** composition size the overlay maps onto */
  comp: { w: number; h: number }
  set(p: Partial<EditorState>): void
  addMark(m: Omit<FeedbackMark, 'n' | 'id' | 'resolved'>): void
  updateMark(id: string, patch: Partial<FeedbackMark>): void
  removeMark(id: string): void
  clearMarks(): void
}

export const useEditor = create<EditorState>((set, get) => ({
  player: null,
  time: 0,
  duration: 0,
  playing: false,
  ready: false,
  elements: [],
  selected: null,
  audio: [],
  timing: [],
  motions: [],
  staleMotions: [],
  selectedMotion: null,
  openLayers: [],
  selectedAudio: null,
  panel: 'elements',
  tool: 'select',
  marks: [],
  markTime: null,
  comp: { w: 1920, h: 1080 },
  set: (p) => set(p),
  addMark: (m) => {
    const marks = get().marks
    set({ marks: [...marks, { ...m, id: crypto.randomUUID(), n: marks.length + 1, resolved: false }], markTime: get().markTime ?? m.time })
  },
  updateMark: (id, patch) => set({ marks: get().marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
  removeMark: (id) => {
    const marks = get().marks.filter((m) => m.id !== id).map((m, i) => ({ ...m, n: i + 1 }))
    set({ marks, markTime: marks.length ? get().markTime : null })
  },
  clearMarks: () => set({ marks: [], markTime: null }),
}))

/**
 * Elements a markup box refers to, best match first: what the box mostly covers,
 * ignoring full-canvas backgrounds unless nothing else is there.
 */
export function elementsForMark(els: RuntimeElement[], r: { x: number; y: number; w: number; h: number }, comp: { w: number; h: number }) {
  const markArea = Math.max(1, r.w * r.h)
  const canvas = comp.w * comp.h
  const scored = els
    .filter((e) => e.visible && e.rect.w > 0 && e.rect.h > 0)
    .map((e) => {
      const iw = Math.min(r.x + r.w, e.rect.x + e.rect.w) - Math.max(r.x, e.rect.x)
      const ih = Math.min(r.y + r.h, e.rect.y + e.rect.h) - Math.max(r.y, e.rect.y)
      const inter = Math.max(0, iw) * Math.max(0, ih)
      const area = e.rect.w * e.rect.h
      const background = area > canvas * 0.85
      return { e, inter, background, score: (inter / markArea) * 0.6 + (inter / area) * 0.4 }
    })
    .filter((x) => x.inter > 0)
  const fg = scored.filter((x) => !x.background)
  return (fg.length ? fg : scored).sort((a, b) => b.score - a.score).map((x) => ({ id: x.e.id, label: x.e.label }))
}

/** elements whose box intersects a composition-space rect (or contains a point) */
export function elementsUnder(els: RuntimeElement[], r: { x: number; y: number; w: number; h: number }) {
  return els
    .filter((e) => e.visible && e.rect.w > 0 && e.rect.h > 0)
    .filter((e) => e.rect.x < r.x + Math.max(r.w, 1) && e.rect.x + e.rect.w > r.x && e.rect.y < r.y + Math.max(r.h, 1) && e.rect.y + e.rect.h > r.y)
    .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)
    .map((e) => ({ id: e.id, label: e.label }))
}
