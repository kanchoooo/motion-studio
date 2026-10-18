import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron'
import { registerIpc } from './ipc'
import { cancelAllExports, runningExports } from './renders'
import { isDev } from './paths'
import { startPreviewServer } from './preview-server'

let win: BrowserWindow | null = null

function createWindow(previewBase: string) {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: '모션스튜디오',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#f4f4f5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [`--ms-preview-base=${previewBase}`],
    },
  })
  win.once('ready-to-show', () => win?.show())
  // links open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // the window only ever shows the app itself (a dropped file must not replace it)
  const appPage = pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev && process.env.ELECTRON_RENDERER_URL ? url.startsWith(process.env.ELECTRON_RENDERER_URL) : url.split('#')[0] === appPage
    if (!allowed) e.preventDefault()
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.setName('모션스튜디오')
// Chromium must not touch the macOS keychain ("Safe Storage" item): with
// changing builds/signatures that item triggers repeated keychain prompts.
// Claude Code keeps its own sign-in there; the app's AI-service tokens live in a
// user-only file (see ai/accounts.ts).
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain')
// isolated profile for automated tests
if (process.env.MS_USER_DATA) app.setPath('userData', process.env.MS_USER_DATA)

app.whenReady().then(async () => {
  // 관제용 판 only (MS_CONSOLE=1 builds): the regular builds do not contain it
  const consoleMode = __MS_CONSOLE__ ? await import('./console-mode') : null
  const hidden = __MS_CONSOLE__ ? consoleMode!.startsHidden() : false
  if (hidden) app.dock?.hide()
  const previewBase = await startPreviewServer()
  // CSP: the app shell only talks to itself and the local preview server
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith(previewBase)) return cb({ responseHeaders: details.responseHeaders })
    const devSrc = isDev ? " 'unsafe-eval' ws: http://localhost:*" : ''
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' ${previewBase}${devSrc}; script-src 'self' ${previewBase}${devSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: ${previewBase}; media-src 'self' blob: https: ${previewBase}; frame-src ${previewBase}; connect-src 'self' ${previewBase}${devSrc}; font-src 'self' data:`,
        ],
      },
    })
  })
  // nothing in the app needs device permissions
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  const sessions = registerIpc(() => win)
  let confirmedQuit = false
  const consoleCtl = __MS_CONSOLE__
    ? consoleMode!.startConsole({
        hidden,
        getWindow: () => win,
        createWindow: () => createWindow(previewBase),
        quitState: () => ({ busy: sessions.busyProjects(), exporting: runningExports() }),
        confirmQuit: (on) => (confirmedQuit = on),
      })
    : null
  // automated tests (isolated profile) can ask why the app would not quit
  if (process.env.MS_USER_DATA) {
    const g = globalThis as Record<string, unknown>
    g.__msQuitState = () => ({ exporting: runningExports(), busy: sessions.busyProjects() })
    // the review card for generated media, without spending AI credits
    g.__msShowGenerated = (projectId: string, files: { file: string; kind: string }[], label?: string) => sessions.showGenerated(projectId, files, label)
  }
  if (!hidden) createWindow(previewBase)
  app.on('before-quit', (e) => {
    const busy = sessions.busyProjects()
    const exporting = runningExports()
    if ((busy.length || exporting) && !confirmedQuit) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['계속 작업하기', '종료하기'],
        defaultId: 0,
        cancelId: 0,
        message: exporting && busy.length ? 'Claude 작업과 내보내기가 아직 진행 중이에요' : exporting ? '영상을 내보내는 중이에요' : 'Claude가 아직 작업 중이에요',
        detail: `지금 종료하면 진행 중인 작업이 멈춰요.${exporting ? ' 내보내던 영상은 취소돼요.' : ''} 대화 내용은 남아 있어서 다음에 이어서 할 수 있어요.`,
      })
      if (choice === 0) {
        e.preventDefault()
        return
      }
      confirmedQuit = true
    }
    cancelAllExports()
    sessions.killAll()
  })
  app.on('activate', () => {
    if (consoleCtl?.isHidden()) consoleCtl.show()
    else if (BrowserWindow.getAllWindows().length === 0) createWindow(previewBase)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
