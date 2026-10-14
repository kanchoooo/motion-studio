// Editor panel sizes (like a studio tool: every area can be resized, chat and
// history can be folded away). Remembered per computer.
import { useEffect, useState } from 'react'
import { create } from 'zustand'

export interface EditorLayout {
  chatW: number
  inspectorW: number
  historyW: number
  timelineH: number
  terminalH: number
  layerW: number
  chatOpen: boolean
  historyOpen: boolean
  zoom: number
  /** safe-zone guide on the preview */
  guides: boolean
}

const KEY = 'ms-editor-layout'
export const LAYOUT_DEFAULTS: EditorLayout = { chatW: 340, inspectorW: 320, historyW: 300, timelineH: 250, terminalH: 280, layerW: 230, chatOpen: true, historyOpen: false, zoom: 1, guides: false }
export const LAYOUT_LIMITS: Record<'chatW' | 'inspectorW' | 'historyW' | 'timelineH' | 'terminalH' | 'layerW', [number, number]> = {
  terminalH: [140, 700],
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

/** window size, updated on resize */
export function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

/**
 * Panel sizes that fit this window: widths chosen on a big monitor shrink on a
 * laptop so the canvas keeps at least MIN_CANVAS px, the timeline never takes
 * more than about half of the height.
 */
export function fitLayout(L: EditorLayout, win: { w: number; h: number }, terminalOpen: boolean) {
  const MIN_CANVAS = 380
  const rails = (L.chatOpen ? 0 : 30) + (L.historyOpen ? 0 : 30)
  const side = (L.chatOpen ? L.chatW : 0) + L.inspectorW + (L.historyOpen ? L.historyW : 0)
  const room = Math.max(0, win.w - rails - MIN_CANVAS)
  const k = side > room ? room / side : 1
  const terminalH = terminalOpen ? Math.min(L.terminalH, Math.round(win.h * 0.45)) : 0
  const body = win.h - 48 - terminalH
  return {
    chatW: Math.max(220, Math.round(L.chatW * k)),
    inspectorW: Math.max(240, Math.round(L.inspectorW * k)),
    historyW: Math.max(220, Math.round(L.historyW * k)),
    timelineH: Math.max(110, Math.min(L.timelineH, Math.round(body * 0.55))),
    terminalH,
  }
}
