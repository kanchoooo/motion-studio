// Auto-update from the GitHub releases of kanchoooo/motion-studio (electron-updater).
// Checked at every launch before anything else: if a newer version exists it is
// downloaded and installed, and the app restarts — the designer only starts
// working once that is done. Offline or a failed check never blocks the app.
import { app } from 'electron'
import updaterPkg from 'electron-updater'
import type { UpdateCheck } from '@shared/api'

const { autoUpdater } = updaterPkg

let configured = false
function setup() {
  if (configured) return
  configured = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = null
}

const notesText = (n: unknown): string | undefined => {
  if (typeof n === 'string') return n.replace(/<[^>]+>/g, '').trim() || undefined
  if (Array.isArray(n)) return n.map((x) => (typeof x?.note === 'string' ? x.note : '')).join('\n').replace(/<[^>]+>/g, '').trim() || undefined
  return undefined
}

export async function checkUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  // development builds have no update feed; automated tests of a packaged build opt out
  if (!app.isPackaged || process.env.MS_NO_UPDATE) return { status: 'skipped', current }
  setup()
  try {
    const r = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000)),
    ])
    const info = r?.updateInfo
    if (!r || !info || !r.isUpdateAvailable) return { status: 'none', current }
    return { status: 'available', current, latest: info.version, notes: notesText(info.releaseNotes) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', current, message: /timeout|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(msg) ? '인터넷 연결을 확인할 수 없어요.' : msg.slice(0, 200) }
  }
}

/** downloads the update; resolves once it is ready to install */
export function downloadUpdate(onProgress: (percent: number) => void): Promise<void> {
  setup()
  return new Promise((resolve, reject) => {
    const progress = (p: { percent: number }) => onProgress(p.percent)
    const done = () => {
      cleanup()
      resolve()
    }
    const fail = (e: Error) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      autoUpdater.off('download-progress', progress)
      autoUpdater.off('update-downloaded', done)
      autoUpdater.off('error', fail)
    }
    autoUpdater.on('download-progress', progress)
    autoUpdater.on('update-downloaded', done)
    autoUpdater.on('error', fail)
    autoUpdater.downloadUpdate().catch(fail)
  })
}

/** quits, installs and starts the new version */
export function installUpdate() {
  // Windows: the installer runs silently (no wizard pages mid-update); both then start the new version
  setImmediate(() => autoUpdater.quitAndInstall(process.platform === 'win32', true))
}
