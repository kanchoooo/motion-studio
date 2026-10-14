// Project pictures without an export: the composition is loaded in a hidden
// window, moved to a representative moment and photographed. Used for the
// project cards (thumbnails/latest.jpg) and Claude's history entries.
import { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveFolder } from './preview-server'

interface Size {
  width: number
  height: number
  duration: number
}

let chain: Promise<unknown> = Promise.resolve()
const queued = new Set<string>()

/** photographs the composition at `at` (0–1 of its length); JPEG bytes, or null when it does not load */
async function capture(projectDir: string, size: Size, at: number): Promise<Buffer | null> {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.setAudioMuted(true)
  // a composition whose script hangs must not keep a hidden renderer alive
  const limit = setTimeout(() => win.destroy(), 25_000)
  try {
    // ms-preview: the server adds the HyperFrames player (window.__player) used to seek
    await win.loadURL(`${serveFolder(join(projectDir, 'composition'))}index.html?ms-preview=1`)
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
      ready = await win.webContents.executeJavaScript('!!(window.__player && window.__playerReady)')
      if (!ready) await new Promise((r) => setTimeout(r, 100))
    }
    if (!ready) return null
    const t = Math.max(0, Math.min(size.duration - 0.05, size.duration * at))
    await win.webContents.executeJavaScript(
      `(async () => { const P = window.__player; P.pause(); P.seek(${t}); if (document.fonts) await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true })()`,
    )
    await new Promise((r) => setTimeout(r, 200))
    const img = await win.webContents.capturePage()
    if (img.isEmpty()) return null
    return img.resize({ width: 480, quality: 'good' }).toJPEG(82)
  } catch {
    return null
  } finally {
    clearTimeout(limit)
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * Updates thumbnails/latest.jpg (and, with historyRel, a copy for that history
 * entry). One capture at a time; repeated requests for a project collapse.
 */
export function refreshThumbnail(projectDir: string, size: Size, opts: { historyRel?: string; onDone?: (ok: boolean) => void } = {}): void {
  if (queued.has(projectDir) && !opts.historyRel) return
  queued.add(projectDir)
  chain = chain.then(async () => {
    queued.delete(projectDir)
    if (!existsSync(join(projectDir, 'composition', 'index.html'))) return opts.onDone?.(false)
    const jpg = await capture(projectDir, size, 0.6)
    if (!jpg) return opts.onDone?.(false)
    const dir = join(projectDir, 'thumbnails')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'latest.jpg'), jpg)
    if (opts.historyRel) writeFileSync(join(projectDir, opts.historyRel), jpg)
    opts.onDone?.(true)
  })
}

/** an export already has a picture of the finished video: the project card uses it */
export function useAsLatest(projectDir: string, imagePath: string): void {
  try {
    mkdirSync(join(projectDir, 'thumbnails'), { recursive: true })
    copyFileSync(imagePath, join(projectDir, 'thumbnails', 'latest.jpg'))
  } catch {
    /* the card keeps its previous picture */
  }
}
