// The designer can look around the editor (play, scrub, select, listen) but not change anything
//  - while Claude is working: Claude is rewriting the composition, and an edit made now could
//    land on an element that is about to change or disappear
//  - before 편집 활성화 (0.5+ projects): the video is still refined in the conversation; the
//    button makes it editable by hand (Claude names the layers, the picture stays)
// Every edit path asks blockedEdit() first; the banner over the canvas says why.
import { create } from 'zustand'
import { useStore } from '../../store'

type S = ReturnType<typeof useStore.getState>
/** a video that waits for 편집 활성화 (older projects have no flag: always editable) */
const viewOnly = (s: S) => !!s.project?.hasVideo && s.project.meta.editable === false
const locked = (s: S) => s.session.status === 'busy' || viewOnly(s)

export const editLocked = () => locked(useStore.getState())
export const useEditLocked = () => useStore(locked)
export const useViewOnly = () => useStore(viewOnly)

/** when an edit was last refused (the banner flashes) */
export const useLockNotice = create<{ at: number }>(() => ({ at: 0 }))

/** true when editing is blocked right now (and the banner flashes) */
export function blockedEdit(): boolean {
  if (!editLocked()) return false
  useLockNotice.setState({ at: Date.now() })
  return true
}
