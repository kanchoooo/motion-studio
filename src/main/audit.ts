// Loads a composition in a hidden window and asks the Motion Studio runtime
// what is editable: the element tree, content inside groups that has no
// data-ms-id of its own, and motion edits that no longer match the code.
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { serveFolder } from './preview-server'

export interface AuditResult {
  elements: { id: string; label: string; movable: boolean; transformable?: boolean; parent: string | null }[]
  loose: { id: string; label: string; text: string; images: number }[]
  stale: string[]
}

export async function auditComposition(projectDir: string, size: { width: number; height: number }): Promise<AuditResult | null> {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.setAudioMuted(true)
  // a composition whose script hangs must not hold check_video (and a hidden renderer) forever
  const limit = setTimeout(() => win.destroy(), 20_000)
  try {
    await win.loadURL(`${serveFolder(join(projectDir, 'composition'))}index.html`)
    // the timeline is registered by the composition's own script; wrappers are added after it
    for (let i = 0; i < 40; i++) {
      const ready = await win.webContents.executeJavaScript('!!(window.__MS_RUNTIME__ && window.__timelines && Object.keys(window.__timelines).length)')
      if (ready) break
      await new Promise((r) => setTimeout(r, 100))
    }
    await new Promise((r) => setTimeout(r, 150))
    return (await win.webContents.executeJavaScript('window.__MS_RUNTIME__ ? window.__MS_RUNTIME__.audit() : null')) as AuditResult | null
  } catch {
    return null
  } finally {
    clearTimeout(limit)
    if (!win.isDestroyed()) win.destroy()
  }
}
