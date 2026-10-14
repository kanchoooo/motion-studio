// While Claude is working the designer can look around the editor (play, scrub, select,
// listen) but not change anything: Claude is rewriting the composition, and an edit made
// now could land on an element that is about to change or disappear. Every edit path
// asks blockedEdit() first; the banner over the canvas says why.
import { create } from 'zustand'
import { useStore } from '../../store'

export const editLocked = () => useStore.getState().session.status === 'busy'
export const useEditLocked = () => useStore((s) => s.session.status === 'busy')

/** when an edit was last refused (the banner flashes) */
export const useLockNotice = create<{ at: number }>(() => ({ at: 0 }))

/** true when editing is blocked right now (and the banner flashes) */
export function blockedEdit(): boolean {
  if (!editLocked()) return false
  useLockNotice.setState({ at: Date.now() })
  return true
}
