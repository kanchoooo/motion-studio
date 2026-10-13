import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron'
import { registerIpc } from './ipc'
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
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '') : url.startsWith('file://')
    if (!allowed) e.preventDefault()
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.setName('모션스튜디오')
// isolated profile for automated tests
if (process.env.MS_USER_DATA) app.setPath('userData', process.env.MS_USER_DATA)

app.whenReady().then(async () => {
  const previewBase = await startPreviewServer()
  // CSP: the app shell only talks to itself and the local preview server
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith(previewBase)) return cb({ responseHeaders: details.responseHeaders })
    const devSrc = isDev ? " 'unsafe-eval' ws: http://localhost:*" : ''
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' ${previewBase}${devSrc}; script-src 'self' ${previewBase}${devSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${previewBase}; media-src 'self' blob: ${previewBase}; frame-src ${previewBase}; connect-src 'self' ${previewBase}${devSrc}; font-src 'self' data:`,
        ],
      },
    })
  })
  // nothing in the app needs device permissions
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  const sessions = registerIpc(() => win)
  createWindow(previewBase)
  let confirmedQuit = false
  app.on('before-quit', (e) => {
    const busy = sessions.busyProjects()
    if (busy.length && !confirmedQuit) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['계속 작업하기', '종료하기'],
        defaultId: 0,
        cancelId: 0,
        message: 'Claude가 아직 작업 중이에요',
        detail: '지금 종료하면 진행 중인 작업이 멈춰요. 대화 내용은 남아 있어서 다음에 이어서 할 수 있어요.',
      })
      if (choice === 0) {
        e.preventDefault()
        return
      }
      confirmedQuit = true
    }
    sessions.killAll()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(previewBase)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
