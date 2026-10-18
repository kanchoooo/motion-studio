// 관제용 판 only (MS_CONSOLE=1 builds; ipc.ts reaches this behind __MS_CONSOLE__, so the regular
// Mac and Windows builds do not contain it). What the window's IPC does is also seen here:
//   - the handlers, for the web connection (web.ts serves them to the browser)
//   - the events, for the browser (server-sent) and for the results collection (a finished export)
//   - renames, moves and deletes, for the collection
import type { AeProgress, ExportProgress } from '@shared/api'
import * as collect from './collect'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => unknown

/** ipcMain.handle channels (studio.*.* that return a value) */
export const invokeHandlers = new Map<string, Fn>()
/** ipcMain.on channels (terminal:write, terminal:resize) */
export const sendHandlers = new Map<string, Fn>()

let listener: ((channel: string, payload: unknown) => void) | null = null
/** the web connection listens while it is on */
export function onWebEvent(f: ((channel: string, payload: unknown) => void) | null) {
  listener = f
}
export function emitWeb(channel: string, payload: unknown) {
  listener?.(channel, payload)
}

/** an event the window gets */
export function event(channel: string, payload: unknown) {
  emitWeb(channel, payload)
  if (channel === 'renders:progress') {
    const p = payload as ExportProgress
    if (p.phase === 'done' && p.record) collect.onRender(p.projectId, p.record)
  } else if (channel === 'renders:aeProgress') {
    const p = payload as AeProgress & { projectId: string }
    if (p.phase === 'done' && p.folder) collect.onAePackage(p.projectId, p.folder)
  }
}

// what the collection follows once the handler has done its part
const PROJECTS_CHANGED = new Set(['projects:renameAt', 'projects:rename', 'projects:move', 'projects:remove', 'folders:rename', 'projects:importShare'])

/** the handler as the window and the web connection call it */
export function handler(channel: string, fn: Fn): Fn {
  const f = wrap(channel, fn)
  invokeHandlers.set(channel, f)
  return f
}

function wrap(channel: string, fn: Fn): Fn {
  // an export deleted in the app: its copy goes (once it is really deleted)
  if (channel === 'renders:remove')
    return (...args: unknown[]) => {
      const r = fn(...args)
      collect.onRenderRemoved(String(args[0]), String(args[1]))
      return r
    }
  // a project renamed, moved, deleted or added: the collection looks again (whatever came of it)
  if (PROJECTS_CHANGED.has(channel))
    return (...args: unknown[]) => {
      let r: unknown
      try {
        r = fn(...args)
      } catch (e) {
        collect.onProjectsChanged()
        throw e
      }
      if (r instanceof Promise) return r.finally(() => collect.onProjectsChanged())
      collect.onProjectsChanged()
      return r
    }
  return fn
}
