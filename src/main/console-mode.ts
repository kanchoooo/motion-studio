// 관제용 판 (the console build, MS_CONSOLE=1): Motion Studio for the user's own dashboard on this
// Mac. Only this build has it — the regular Mac and Windows builds do not contain this module
// (index.ts loads it behind __MS_CONSOLE__, which is false there).
//   - the results collection (collect.ts) and the web connection (web.ts), each on only while the
//     console's console.json asks for it
//   - started hidden by the console (--hidden: no window, no Dock icon) until it asks to show the
//     window or the app is opened from the Finder; an update restart keeps the mode
//   - hidden, nobody sees the update screen: a new version installs itself at a quiet moment
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { setCollectDir } from './collect'
import { readConsoleSettings, watchConsoleSettings } from './console'
import { checkUpdate, downloadUpdate, installUpdate } from './updater'
import { refreshEndpoint, startWeb, stopWeb, webQuietFor, type WebHooks } from './web'
import { emitWeb } from './console-bridge'

const hiddenMarker = () => join(app.getPath('userData'), 'hidden-restart')

/** started by the console without a window (or restarted so after an update); only with its web connection on */
export function startsHidden(): boolean {
  let marked = false
  try {
    if (existsSync(hiddenMarker())) {
      marked = Date.now() - Number(readFileSync(hiddenMarker(), 'utf8')) < 15 * 60_000
      rmSync(hiddenMarker(), { force: true })
    }
  } catch {
    /* not hidden */
  }
  return (process.argv.includes('--hidden') || marked) && readConsoleSettings().web
}

export interface ConsoleContext {
  hidden: boolean
  getWindow(): BrowserWindow | null
  createWindow(): void
  quitState(): { busy: string[]; exporting: number }
  /** the next quit does not ask (the console checked, or an update installs) */
  confirmQuit(on: boolean): void
}

export function startConsole(ctx: ConsoleContext): { isHidden(): boolean; show(): void } {
  let hidden = ctx.hidden
  const show = () => {
    if (hidden) {
      hidden = false
      app.dock?.show()
      refreshEndpoint()
    }
    const win = ctx.getWindow()
    if (!win) ctx.createWindow()
    else {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    app.focus({ steal: true })
  }
  const hooks: WebHooks = {
    status: ctx.quitState,
    quit: () => {
      ctx.confirmQuit(true)
      app.quit()
    },
    show,
    hidden: () => hidden,
    prepareInstall: () => {
      const s = ctx.quitState()
      if (s.busy.length || s.exporting) return 'Claude 작업이나 내보내기가 진행 중이에요. 끝난 뒤에 업데이트해 주세요.'
      if (hidden) writeFileSync(hiddenMarker(), String(Date.now()))
      ctx.confirmQuit(true)
      // an install that did not happen: Cmd+Q asks again, a later start is not hidden by mistake
      setTimeout(() => {
        ctx.confirmQuit(false)
        rmSync(hiddenMarker(), { force: true })
      }, 120_000).unref()
      return null
    },
  }
  watchConsoleSettings((s) => {
    setCollectDir(s.collectDir, () => {
      ctx.getWindow()?.webContents.send('projects:changed', null)
      emitWeb('projects:changed', null)
    })
    if (s.web) void startWeb(hooks).catch(() => {})
    else stopWeb()
  })
  app.on('will-quit', () => stopWeb())

  // hidden: updates install by themselves (no Claude work, no export, nobody using the web
  // connection for ten minutes), and the app comes back hidden
  if (hidden) {
    let ready = false
    let checked = 0
    let running = false
    const tick = async () => {
      if (!hidden || running) return
      running = true
      try {
        if (!ready) {
          if (Date.now() - checked < 2 * 3600_000) return
          checked = Date.now()
          if ((await checkUpdate()).status !== 'available') return
          await downloadUpdate(() => {})
          ready = true
        }
        if (!hidden || !webQuietFor(10 * 60_000) || hooks.prepareInstall()) return
        installUpdate()
      } catch {
        /* the next tick */
      } finally {
        running = false
      }
    }
    setTimeout(() => void tick(), 60_000)
    setInterval(() => void tick(), 10 * 60_000)
  }
  return { isHidden: () => hidden, show }
}
