// Editor panel sizes (like a studio tool: every area can be resized, chat and
// history can be folded away). Remembered per computer.
import { create } from 'zustand'

export interface EditorLayout {
  chatW: number
  inspectorW: number
  historyW: number
  timelineH: number
  layerW: number
  chatOpen: boolean
  historyOpen: boolean
  zoom: number
}

const KEY = 'ms-editor-layout'
export const LAYOUT_DEFAULTS: EditorLayout = { chatW: 340, inspectorW: 320, historyW: 300, timelineH: 250, layerW: 230, chatOpen: true, historyOpen: false, zoom: 1 }
export const LAYOUT_LIMITS: Record<'chatW' | 'inspectorW' | 'historyW' | 'timelineH' | 'layerW', [number, number]> = {
  chatW: [260, 640],
  inspectorW: [260, 620],
  historyW: [240, 520],
  timelineH: [120, 640],
  layerW: [160, 420],
}

function load(): EditorLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<EditorLayout>
    return { ...LAYOUT_DEFAULTS, ...saved }
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}

export const useLayout = create<EditorLayout & { set(p: Partial<EditorLayout>): void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p)
    const { set: _omit, ...rest } = get()
    void _omit
    try {
      localStorage.setItem(KEY, JSON.stringify(rest))
    } catch {
      /* storage unavailable: sizes reset next time */
    }
  },
}))

export const clampSize = (k: keyof typeof LAYOUT_LIMITS, v: number) => Math.round(Math.max(LAYOUT_LIMITS[k][0], Math.min(LAYOUT_LIMITS[k][1], v)))
