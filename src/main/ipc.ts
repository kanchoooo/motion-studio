import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { AgentEvent, ExportOptions, ExportProgress, SendMessageInput } from '@shared/api'
import type { Brief } from '@shared/brief'
import type { Overrides } from '@shared/overrides'
import { SessionManager } from './agent/pty-session'
import { parseAudio, sfxLibrary, useBuiltinSfx } from './audio'
import { fullCheck, lastElements, type EditorElementInfo } from './checks'
import { claudeLogin, doctor, installBrowser } from './doctor'
import { listFonts } from './fonts'
import * as history from './history'
import { projectsDir, serveFolderUrl } from './ipc-helpers'
import { previewBase } from './preview-server'
import * as projects from './projects'
import { cancelExport, exportAll, listRenders, removeRender, startExport, updateRender } from './renders'
import { createVariations } from './variations'
import { listBrands, removeBrand, saveBrand } from './brands'
import { addReferenceFiles, addYoutube, listReferences, removeReference, updateReference } from './references'

export function registerIpc(getWindow: () => BrowserWindow | null): SessionManager {
  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload)
  const agent = new SessionManager((e: AgentEvent) => send('agent:event', e))
  // follow Claude's file edits live while a turn is running
  setInterval(() => {
    for (const id of projects.openIds()) {
      if (agent.pollComposition(id)) send('agent:event', { type: 'composition-changed', projectId: id } satisfies AgentEvent)
    }
  }, 1200)
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, async (_e, ...args) => fn(...(args as A)))

  // ---- app ----
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, projectsDir: projectsDir() }))
  handle('app:doctor', () => doctor())
  handle('app:login', () => claudeLogin())
  handle('app:installBrowser', () => installBrowser())
  handle('app:trustWorkspace', () => agent.startWorkspaceTrust())
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle('app:reveal', (path: string) => shell.showItemInFolder(path))
  handle('app:pickFiles', async (kind: 'assets' | 'any') => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'assets'
          ? [{ name: '이미지·영상·소리', extensions: projects.ASSET_EXTENSIONS }]
          : [{ name: '모든 파일', extensions: ['*'] }],
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })
  handle('app:pickFolder', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:capture', async (rect: { x: number; y: number; width: number; height: number }) => {
    const win = getWindow()
    if (!win) return ''
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }
    const img = await win.webContents.capturePage(r)
    return img.toDataURL()
  })
  handle('app:setTheme', (theme: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = theme
  })

  // ---- projects ----
  handle('projects:list', () => projects.listProjects())
  handle('projects:create', (input: Parameters<typeof projects.createProject>[0]) => projects.createProject(input))
  handle('projects:open', (path: string) => projects.openProject(path))
  handle('projects:state', (id: string) => projects.state(id))
  handle('projects:rename', (id: string, name: string) => projects.renameProject(id, name))
  handle('projects:remove', (path: string) => projects.removeProject(path))
  handle('projects:saveBrief', (id: string, brief: Brief) => projects.saveBrief(id, brief))
  handle('projects:importAssets', (id: string, files: string[], opts?: { psd?: 'flat' | 'layers' }) => projects.importAssets(id, files, opts))
  handle('projects:saveOverrides', (id: string, o: Overrides, summary: string) => projects.saveOverrides(id, o, summary))
  handle('projects:previewUrl', (id: string) => {
    const dir = projects.pathOf(id)
    projects.refreshFontCss(dir)
    projects.applyAudioEdits(dir)
    const base = previewBase()
    return { src: serveFolderUrl(join(dir, 'composition')) + 'index.html', runtimeSrc: `${base}/__ms/hf-runtime.js`, base }
  })
  handle('projects:check', (id: string) => {
    const s = projects.state(id)
    return fullCheck(s.path, s.brief, s.overrides, lastElements.get(id))
  })
  handle('projects:audio', (id: string) => {
    const dir = projects.pathOf(id)
    const html = readFileSync(join(dir, 'composition', 'index.html'), 'utf8')
    return parseAudio(html)
  })
  handle('projects:sfxLibrary', () => sfxLibrary())
  handle('projects:useSfx', (id: string, sfxId: string) => useBuiltinSfx(projects.pathOf(id), sfxId))
  handle('projects:reportElements', (id: string, els: EditorElementInfo[]) => {
    lastElements.set(id, els)
  })
  handle('projects:assetUrl', (id: string, rel: string) => serveFolderUrl(join(projects.pathOf(id), 'composition')) + rel)
  handle('projects:fileUrl', (id: string, rel: string) => serveFolderUrl(projects.pathOf(id)) + rel)

  // ---- agent (live Claude Code session in a PTY) ----
  handle('agent:start', (id: string) => agent.start(id))
  handle('agent:restart', (id: string) => agent.restart(id))
  handle('agent:state', (id: string) => agent.state(id))
  handle('agent:send', (input: SendMessageInput) => agent.send(input))
  handle('agent:interrupt', (id: string) => agent.interrupt(id))
  handle('agent:transcript', (id: string) => agent.transcript(id))
  handle('agent:approveStoryboard', (id: string, itemId: string) => agent.approveStoryboard(id, itemId))
  handle('terminal:snapshot', (id: string) => agent.snapshot(id))
  ipcMain.on('terminal:write', (_e, id: string, data: string) => agent.write(id, data))
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => agent.resize(id, cols, rows))

  // ---- brand kits ----
  handle('brands:list', () => listBrands())
  handle('brands:save', (b: Parameters<typeof saveBrand>[0], logoSource?: string) => saveBrand(b, logoSource))
  handle('brands:remove', (id: string) => removeBrand(id))

  // ---- references ----
  const refsChanged = (id: string) => () => send('agent:event', { type: 'references-changed', projectId: id } satisfies AgentEvent)
  handle('references:list', (id: string) => listReferences(projects.pathOf(id)))
  handle('references:addFiles', (id: string, files: string[]) => addReferenceFiles(projects.pathOf(id), files, refsChanged(id)))
  handle('references:addYoutube', (id: string, url: string) => addYoutube(projects.pathOf(id), url, refsChanged(id)))
  handle('references:update', (id: string, refId: string, patch: Parameters<typeof updateReference>[2]) => updateReference(projects.pathOf(id), refId, patch, refsChanged(id)))
  handle('references:remove', (id: string, refId: string) => removeReference(projects.pathOf(id), refId, refsChanged(id)))

  // ---- variations ----
  handle('variations:create', async (id: string, req: Parameters<typeof createVariations>[1]) => {
    const { created, messages } = await createVariations(id, req)
    agent.enqueueAdaptations(messages)
    return created
  })
  handle('variations:family', (id: string) => projects.familyOf(id))
  handle('variations:exportAll', (id: string, quality: 'draft' | 'standard' | 'high') => exportAll(id, quality, (p) => send('renders:progress', p)))

  // ---- history ----
  handle('history:list', (id: string) => history.list(projects.pathOf(id)))
  handle('history:restore', async (id: string, entryId: string) => {
    const dir = projects.pathOf(id)
    const target = (await history.list(dir)).find((h) => h.id === entryId)
    await history.restore(dir, entryId, `되돌리기: ${target?.versionName ?? target?.summary ?? '이전 상태'}`)
    projects.refreshFontCss(dir)
    projects.applyAudioEdits(dir)
    projects.touch(id)
    send('agent:event', { type: 'composition-changed', projectId: id } satisfies AgentEvent)
    return projects.state(id)
  })
  handle('history:restorePartial', async (id: string, entryId: string, scope: history.RestoreScope) => {
    const dir = projects.pathOf(id)
    const target = (await history.list(dir)).find((h) => h.id === entryId)
    const what = { composition: '영상', overrides: '직접 수정값', brief: '브리프' }[scope]
    await history.restorePartial(dir, entryId, scope, `${what}만 되돌리기: ${target?.versionName ?? target?.summary ?? '이전 상태'}`)
    projects.refreshFontCss(dir)
    projects.applyAudioEdits(dir)
    projects.touch(id)
    send('agent:event', { type: 'composition-changed', projectId: id } satisfies AgentEvent)
    return projects.state(id)
  })
  handle('projects:diskUsage', (id: string) => projects.diskUsage(id))
  handle('projects:clearCache', (id: string) => projects.clearCache(id))
  handle('history:saveVersion', async (id: string, name: string) => {
    const entry = await history.record(projects.pathOf(id), { actor: 'designer', summary: `저장: ${name}`, versionName: name, force: true })
    return entry
  })
  handle('history:star', (id: string, entryId: string, starred: boolean) => history.setStar(projects.pathOf(id), entryId, starred))

  // ---- renders ----
  const progress = (p: ExportProgress) => send('renders:progress', p)
  handle('renders:list', (id: string) => listRenders(projects.pathOf(id)))
  handle('renders:start', (id: string, opts: ExportOptions) => startExport(id, opts, progress))
  handle('renders:cancel', (_id: string, renderId: string) => cancelExport(renderId))
  handle('renders:update', (id: string, renderId: string, patch: { starred?: boolean; note?: string }) => updateRender(projects.pathOf(id), renderId, patch))
  handle('renders:remove', (id: string, renderId: string) => removeRender(projects.pathOf(id), renderId))
  handle('renders:fileUrl', (id: string, renderId: string) => {
    const dir = projects.pathOf(id)
    const r = listRenders(dir).find((x) => x.id === renderId)
    return r ? serveFolderUrl(dir) + r.file.split('\\').join('/') : ''
  })

  // ---- fonts ----
  handle('fonts:list', () => listFonts())
  handle('fonts:rescan', () => listFonts(true))

  return agent
}
