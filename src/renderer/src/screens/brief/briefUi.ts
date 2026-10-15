// What is open beside the planning chat (출력 사양 · 스토리보드 · 소재) and what a storyboard
// slot asked the 소재 panel to make.
import { create } from 'zustand'
import type { StoryMaterial } from '@shared/api'

export type BriefPanel = 'output' | 'storyboard' | 'assets'

/** "만들기" on a storyboard material: the generator opens with its prompts */
export interface GenIntent {
  nonce: number
  material: StoryMaterial
  scene: number
  sceneTitle: string
  sceneDescription: string
}

interface BriefUi {
  panel: BriefPanel | null
  intent: GenIntent | null
  open(panel: BriefPanel | null): void
  makeFor(intent: Omit<GenIntent, 'nonce'>): void
  clearIntent(): void
}

export const useBriefUi = create<BriefUi>((set, get) => ({
  panel: null,
  intent: null,
  open: (panel) => set({ panel: get().panel === panel ? null : panel }),
  makeFor: (intent) => set({ panel: 'assets', intent: { ...intent, nonce: Date.now() } }),
  clearIntent: () => set({ intent: null }),
}))

/** a library tile dragged onto a storyboard slot carries its composition path */
export const ASSET_DRAG = 'application/x-ms-asset'
