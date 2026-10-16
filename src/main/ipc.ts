import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { AgentEvent, ExportOptions, ExportProgress, SendMessageInput, AgentPermission, HelperContext, TemplateValues } from '@shared/api'
import type { Asset, Brief } from '@shared/brief'
import type { Overrides } from '@shared/overrides'
import { hasAccess, unlock } from './access'
import { checkUpdate, downloadUpdate, installUpdate } from './updater'
import { SessionManager } from './agent/pty-session'
import { parseAudio, sfxLibrary, useBuiltinSfx } from './audio'
import { fullCheck, lastElements, type EditorElementInfo } from './checks'
import { doctor, installBrowser } from './doctor'
import { listFonts } from './fonts'
import * as history from './history'
import { projectsDir, serveFolderUrl } from './ipc-helpers'
import { previewBase } from './preview-server'
import * as projects from './projects'
import * as folders from './folders'
import * as templates from './templates'
import { cancelExport, exportAll, exportingDirs, listRenders, removeRender, startExport, updateRender } from './renders'
import { createVariations, setFamilyStatus } from './variations'
import { addReferenceFiles, addYoutube, listReferences, nearDuplicates, REFERENCE_EXTENSIONS, removeReference, updateReference } from './references'
import { snapshot as hfSnapshot } from './hyperframes'
import type { AiConnectProvider, AiLoginEvent, AiMediaKind, AiSettings, AiVoiceInfo, AudioCandidate, AudioCandidateList, CreditInfo, LoginWindow } from '@shared/ai'
import { loginBrowsers } from './ai/browser'
import { refreshThumbnail } from './thumbnail'
import { patchAccount, publicInfo, removeAccount, setActive } from './ai/accounts'
import { clearCatalog, listModels, listVoices } from './ai/catalog'
import { cancelLogin, login, NeedsLoginError, resetConnections } from './ai/connect'
import { listGenerated, recordGenerated } from './ai/generated'
import { importUrl } from './ai/media'
import { aiSettings, saveAiSettings } from './ai/settings'
import { ttsSample } from './ai/tts'
import { readJson } from './util'
import { answerPermission, askingFor, setPermissionHooks, type PermissionAnswer } from './agent/permissions'
import { projectForToken } from './agent/mcp-http'
import { balanceOf, discardCandidate, estimateImage, generateCandidate, listCandidates, reconvert, writeCandidates } from './ai/generate'
import { claudeUsage } from './claudeUsage'
import { estimateVideo, generateVideoCandidate } from './ai/generateVideo'
import { askHelper } from './ai/promptHelper'
import type { Framing, GenRequest, VideoGenRequest } from '@shared/assetGen'
import { exportAePackage } from './ae/export'
import { codexStatus } from './ai/codex'
import { listWebFonts } from './webfonts'

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
  handle('app:checkUpdate', () => checkUpdate())
  handle('app:downloadUpdate', () => downloadUpdate((p) => send('app:update-progress', p)))
  handle('app:installUpdate', () => installUpdate())
  handle('app:hasAccess', () => hasAccess())
  handle('app:unlock', (password: string) => unlock(String(password ?? '').slice(0, 200)))
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, projectsDir: projectsDir() }))
  handle('app:doctor', () => doctor())
  handle('app:login', () => agent.startLogin())
  handle('app:cancelLogin', () => agent.kill('__login__'))
  handle('app:installBrowser', () => installBrowser())
  handle('app:trustWorkspace', () => agent.startWorkspaceTrust())
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle('app:reveal', (path: string) => shell.showItemInFolder(path))
  handle('app:pickFiles', async (kind: 'assets' | 'images' | 'media' | 'any') => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'assets'
          ? [{ name: '이미지·영상·소리', extensions: projects.ASSET_EXTENSIONS }]
          : kind === 'images'
            ? [{ name: '이미지', extensions: projects.FEEDBACK_IMAGE_EXTENSIONS }]
            : kind === 'media'
              ? [{ name: '이미지·영상', extensions: REFERENCE_EXTENSIONS }]
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
  handle('projects:list', () => {
    const list = projects.listProjects()
    // projects made before card pictures existed (or never exported) get one in the background
    for (const p of list) {
      if (p.hasVideo && !p.thumbnail) refreshThumbnail(p.path, { width: p.width, height: p.height, duration: p.duration }, { onDone: (ok) => ok && send('projects:changed', null) })
    }
    return list
  })
  handle('projects:renameAt', (path: string, name: string) => projects.renameAt(path, name))
  // ---- folders (홈의 폴더 트리) ----
  /** a project (or a folder of projects) Claude is working on must not move under it */
  const notWhileWorking = (dir: string, what: string) => {
    const working = projects.openIds().filter((id) => {
      try {
        return folders.isInside(projects.pathOf(id), dir) && (agent.state(id).status === 'busy' || agent.isAdapting(id))
      } catch {
        return false
      }
    })
    if (working.length) throw new Error(`Claude가 작업 중인 프로젝트가 있어요. 작업이 끝난 뒤에 ${what}.`)
    if (exportingDirs().some((d) => folders.isInside(d, dir))) throw new Error(`내보내는 중인 프로젝트가 있어요. 내보내기가 끝난 뒤에 ${what}.`)
    // idle sessions there are closed: their working folder is about to change
    for (const id of projects.openIds()) {
      try {
        if (folders.isInside(projects.pathOf(id), dir)) agent.kill(id)
      } catch {
        /* already gone */
      }
    }
  }
  handle('folders:list', () => folders.scan().folders)
  handle('folders:create', (parent: string, name: string) => folders.createFolder(String(parent ?? ''), String(name ?? '')))
  handle('folders:rename', async (rel: string, name: string) => {
    notWhileWorking(folders.folderPath(rel), '이름을 바꿔 주세요')
    const r = await folders.renameFolder(rel, name)
    projects.forgetInside(r.from)
    projects.movedOnDisk(r.from, r.to)
    return r.rel
  })
  handle('folders:remove', async (rel: string) => {
    const dir = folders.folderPath(rel)
    if (!rel) throw new Error('맨 위 폴더는 지울 수 없어요.')
    if (folders.projectsIn(dir).length) throw new Error('폴더 안에 프로젝트가 있어요. 먼저 다른 폴더로 옮기거나 휴지통으로 보내 주세요.')
    await shell.trashItem(dir)
  })
  // ---- templates ----
  handle('templates:list', () => templates.listTemplates())
  handle('templates:detect', (path: string) => ({ slots: templates.detectSlots(path), url: serveFolderUrl(path) }))
  handle('templates:create', (path: string, input: Parameters<typeof templates.createTemplate>[1]) => templates.createTemplate(path, input))
  handle('templates:rename', (id: string, name: string) => templates.renameTemplate(id, name))
  handle('templates:remove', (id: string) => templates.removeTemplate(id))
  handle('templates:createProject', async (input: Parameters<typeof templates.projectFromTemplate>[0] & { check: boolean }) => {
    const r = await templates.projectFromTemplate(input)
    const st = projects.openProject(r.dir)
    const msg = templates.claudeMessage(r.template.name, r.changed, r.todo, !!input.check)
    // new narration (and the optional check) is Claude's part: it starts in the background
    if (msg) void agent.send({ projectId: st.meta.id, text: msg }).catch(() => {})
    return r.dir
  })
  handle('templates:slots', (id: string) => templates.projectSlots(projects.pathOf(id)))
  handle('templates:apply', async (id: string, values: TemplateValues, check: boolean) => {
    notWhileBusy(id, '템플릿 칸을 바꿔 주세요')
    const dir = projects.pathOf(id)
    const t = templates.projectSlots(dir)
    if (!t) throw new Error('템플릿으로 만든 프로젝트가 아니에요.')
    const r = await templates.applySlots(dir, t.slots, values)
    projects.refreshFontCss(dir)
    projects.applyAudioEdits(dir)
    projects.touch(id)
    if (r.changed.length) await history.record(dir, { actor: 'designer', summary: `템플릿 칸을 바꿨어요 (${r.changed.join(', ')})` })
    send('agent:event', { type: 'composition-changed', projectId: id } satisfies AgentEvent)
    const msg = templates.claudeMessage(t.name, r.changed, r.todo, !!check)
    if (msg) await agent.send({ projectId: id, text: msg })
    return projects.state(id)
  })
  handle('projects:replaceAssetFile', async (id: string, from: string, to: string) => {
    notWhileBusy(id, '소재를 바꿔 주세요')
    const n = projects.replaceAssetFile(id, from, to)
    if (n) {
      await history.record(projects.pathOf(id), { actor: 'designer', summary: '영상 속 소재를 고친 것으로 바꿨어요' })
      send('agent:event', { type: 'composition-changed', projectId: id } satisfies AgentEvent)
    }
    return n
  })
  handle('projects:move', (path: string, folder: string) => {
    notWhileWorking(path, '옮겨 주세요')
    return projects.moveProject(path, String(folder ?? ''))
  })
  handle('projects:webFonts', (id: string) => listWebFonts(projects.pathOf(id)).map((f) => ({ family: f.family, weights: f.weights })))
  handle('projects:create', (input: Parameters<typeof projects.createProject>[0]) => projects.createProject(input))
  handle('projects:open', (path: string) => projects.openProject(path))
  handle('projects:state', (id: string) => projects.state(id))
  handle('projects:rename', (id: string, name: string) => projects.renameProject(id, name))
  handle('projects:remove', (path: string) => {
    // its Claude session must not keep writing into the Trash
    for (const id of projects.idsAt(path)) agent.kill(id)
    return projects.removeProject(path)
  })
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
  handle('projects:addFeedbackImage', (id: string, file: string) => projects.addFeedbackImage(id, file))
  // the asset library (소재함) and the output spec: merged into brief.json here (never a stale whole brief)
  handle('projects:addToLibrary', async (id: string, files: string[], opts?: { psd?: 'flat' | 'layers' }) => (await projects.addToLibrary(id, files, opts ?? {})).state)
  handle('projects:addAssets', (id: string, assets: Asset[]) => projects.addAssets(id, assets))
  handle('projects:removeAsset', (id: string, assetId: string) => projects.removeAsset(id, assetId))
  handle('projects:replaceAsset', (id: string, oldId: string, asset: Asset) => projects.replaceAsset(id, oldId, asset))
  handle('projects:saveOutput', (id: string, patch: Partial<Brief['output']>) => projects.saveOutput(id, patch))

  // ---- agent (live Claude Code session in a PTY) ----
  handle('agent:start', (id: string) => {
    agent.pruneIdle(id)
    return agent.start(id)
  })
  handle('agent:restart', (id: string) => agent.restart(id))
  handle('agent:state', (id: string) => agent.state(id))
  handle('agent:send', (input: SendMessageInput) => agent.send(input))
  handle('agent:interrupt', (id: string) => agent.interrupt(id))
  handle('agent:transcript', (id: string) => agent.transcript(id))
  handle('agent:storyboard', (id: string) => agent.storyboard(id))
  handle('agent:assign', (id: string, materialId: string, file: string | null) => agent.assign(id, materialId, file))
  // files from the computer straight into a storyboard slot (they join the library too)
  handle('agent:assignFiles', async (id: string, materialId: string, files: string[]) => {
    const { added } = await projects.addToLibrary(id, files)
    if (!added.length) throw new Error('이미지나 영상 파일을 넣어 주세요.')
    return agent.assign(id, materialId, added[0].file)
  })
  handle('agent:pickVoice', (id: string, itemId: string, voiceId: string) => agent.pickVoice(id, itemId, voiceId))
  handle('agent:pickAudio', (id: string, itemId: string, candidateId: string) => agent.pickAudio(id, itemId, candidateId))
  // 편집 활성화: the video becomes editable by hand (Claude names the layers if needed)
  handle('agent:activateEditing', (id: string) => agent.activateEditing(id))
  handle('agent:splitLayer', (id: string, layerId: string) => agent.splitLayer(id, layerId))
  handle('agent:setModel', (id: string, opts: { model: string; effort: string }) => agent.setModel(id, opts))
  handle('agent:setPermission', (id: string, mode: AgentPermission) => {
    projects.touch(id, { agentPermission: mode === 'all' ? 'all' : undefined })
    // questions already waiting are answered by the new mode
    if (mode === 'all') for (const a of askingFor(id)) answerPermission(id, a.id, 'allow')
  })
  handle('agent:permissions', (id: string) => askingFor(id))
  handle('agent:resolveGenerated', async (id: string, itemId: string, action: 'keep' | 'discard' | 'applied', note?: string) => {
    const dir = projects.pathOf(id)
    const item = agent.transcript(id).find((x) => x.id === itemId)
    if (!item || item.role !== 'generated') throw new Error('이 소재 카드를 찾을 수 없어요.')
    if (action === 'keep') {
      const added = await projects.importAssets(id, item.files.map((f) => join(dir, 'composition', f.file)))
      projects.addAssets(id, added.map((a) => ({ ...a, required: false, note: item.label ?? '' })))
      agent.resolveGenerated(id, itemId, 'kept', note)
    } else if (action === 'discard') {
      for (const f of item.files) await shell.trashItem(join(dir, 'composition', f.file)).catch(() => {})
      agent.resolveGenerated(id, itemId, 'discarded', note)
    } else agent.resolveGenerated(id, itemId, 'applied', note)
  })
  handle('agent:answerPermission', (id: string, askId: string, answer: PermissionAnswer) => answerPermission(id, askId, answer))
  setPermissionHooks({
    projectFor: projectForToken,
    mode: (id) => (projects.state(id).meta.agentPermission === 'all' ? 'all' : 'ask'),
    dirOf: (id) => projects.pathOf(id),
    effortOf: (id) => agent.state(id).effort,
    changed: (id, asks, added) => {
      send('agent:event', { type: 'permissions', projectId: id, asks, added } satisfies AgentEvent)
      // the designer may be in another app while Claude waits
      const w = getWindow()
      if (added && w && !w.isFocused()) {
        if (process.platform === 'darwin') app.dock?.bounce('informational')
        else w.flashFrame(true)
      }
    },
  })
  handle('terminal:snapshot', (id: string) => agent.snapshot(id))
  ipcMain.on('terminal:write', (_e, id: string, data: string) => agent.write(id, data))
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => agent.resize(id, cols, rows))

  projects.onBriefChanged((id) => send('agent:event', { type: 'project-changed', projectId: id } satisfies AgentEvent))

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
  handle('variations:family', (id: string) => {
    // a re-layout queued or running in an earlier run of the app will not continue by itself
    const fam = projects.familyOf(id)
    for (const p of fam) {
      if ((p.family?.status === 'queued' || p.family?.status === 'working') && !agent.isAdapting(p.id)) {
        try {
          setFamilyStatus(p.id, 'error')
          p.family = { ...p.family, status: 'error' }
        } catch {
          /* folder gone */
        }
      }
    }
    return fam
  })
  handle('variations:exportAll', (id: string, quality: 'draft' | 'standard' | 'high') =>
    exportAll(id, quality, (p) => send('renders:progress', p), (pid) => agent.state(pid).status === 'busy' || agent.isAdapting(pid)))

  // ---- history ----
  handle('history:list', (id: string) => history.list(projects.pathOf(id)))
  // a half-finished Claude edit must not be exported or overwritten
  const notWhileBusy = (id: string, what: string) => {
    if (agent.state(id).status === 'busy') throw new Error(`Claude가 영상을 수정하는 중이에요. 끝난 뒤에 ${what}.`)
  }
  handle('history:restore', async (id: string, entryId: string) => {
    notWhileBusy(id, '되돌려 주세요')
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
    notWhileBusy(id, '되돌려 주세요')
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
  // before export: frames almost identical to a reference, and imported media with their source / license
  handle('renders:preflight', async (id: string) => {
    const dir = projects.pathOf(id)
    const imports = listGenerated(dir).filter((g) => g.tool === 'import' && existsSync(join(dir, 'composition', g.file)) && readFileSync(join(dir, 'composition', 'index.html'), 'utf8').includes(g.file))
    let copies: { t: number; ref: string; refT: number }[] = []
    if (listReferences(dir).some((r) => r.status === 'ready' && r.frames?.length)) {
      const d = projects.state(id).brief.output.duration
      const times = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((k) => +(d * k).toFixed(2))
      const frames = await hfSnapshot(join(dir, 'composition'), times, join(dir, '.cache', 'similarity')).catch(() => [])
      copies = (await nearDuplicates(dir, frames.map((file, i) => ({ t: times[i], file }))).catch(() => [])).map((h) => ({ t: h.t, ref: h.ref, refT: h.refT }))
    }
    return { copies, imports: imports.map((g) => ({ file: g.file, label: g.label, source: g.source, license: g.license, provider: g.provider })) }
  })
  handle('renders:start', (id: string, opts: ExportOptions) => {
    notWhileBusy(id, '내보내 주세요')
    return startExport(id, opts, progress)
  })
  handle('renders:cancel', (_id: string, renderId: string) => cancelExport(renderId))
  handle('renders:exportAe', (id: string, opts: { name: string; copyTo?: string }) => {
    notWhileBusy(id, 'AE 패키지를 만들어 주세요')
    return exportAePackage(id, opts, (p) => send('renders:aeProgress', { projectId: id, ...p }))
  })
  handle('renders:update', (id: string, renderId: string, patch: { starred?: boolean; note?: string }) => updateRender(projects.pathOf(id), renderId, patch))
  handle('renders:remove', (id: string, renderId: string) => removeRender(projects.pathOf(id), renderId))
  handle('renders:fileUrl', (id: string, renderId: string) => {
    const dir = projects.pathOf(id)
    const r = listRenders(dir).find((x) => x.id === renderId)
    return r ? serveFolderUrl(dir) + r.file.split('\\').join('/') : ''
  })

  // ---- AI services ----
  handle('ai:accounts', () => publicInfo())
  handle('ai:login', (provider: AiConnectProvider, label: string, opts?: { relogin?: string; window?: LoginWindow }) => {
    void login(provider, { label, relogin: opts?.relogin, window: opts?.window }, (e: AiLoginEvent) => {
      if (e.status === 'done') clearCatalog()
      send('ai:login', e)
    })
  })
  handle('ai:cancelLogin', () => cancelLogin())
  handle('ai:setActive', (provider: AiConnectProvider, id: string) => {
    setActive(provider, id)
    resetConnections()
    clearCatalog()
    return publicInfo()
  })
  handle('ai:rename', (id: string, label: string) => {
    patchAccount(id, { label: label.trim().slice(0, 30) || '계정' })
    return publicInfo()
  })
  handle('ai:remove', (id: string) => {
    removeAccount(id)
    resetConnections()
    clearCatalog()
    return publicInfo()
  })
  handle('ai:models', (provider: AiConnectProvider, kind: AiMediaKind) => listModels(provider, kind))
  handle('ai:voices', (provider: AiConnectProvider) => listVoices(provider))
  handle('ai:ttsSample', async (voice: AiVoiceInfo, text: string) => {
    const file = await ttsSample(voice, String(text).slice(0, 200))
    return serveFolderUrl(join(file, '..')) + encodeURIComponent(file.split(/[\\/]/).pop()!)
  })
  handle('ai:browsers', () => loginBrowsers())
  handle('ai:settings', () => aiSettings())
  handle('ai:saveSettings', (patch: Partial<AiSettings>) => {
    const before = aiSettings()
    const next = saveAiSettings(patch)
    // a new MCP setup only reaches Claude through a fresh session (--resume keeps the conversation)
    if (before.artlist !== next.artlist) agent.restartIdle()
    return next
  })
  handle('ai:generated', (id: string) => listGenerated(projects.pathOf(id)))
  handle('ai:generate', (id: string, req: GenRequest) => generateCandidate(projects.pathOf(id), req))
  // what a generation would cost and what is left — read-only checks (nothing is submitted or charged)
  handle('ai:estimate', async (req: GenRequest | VideoGenRequest, kind: 'image' | 'video'): Promise<CreditInfo> => {
    if (req.provider === 'codex') return { cost: null }
    let problem: string | undefined
    const [cost, balance] = await Promise.all([
      (kind === 'video' ? estimateVideo(req as VideoGenRequest) : estimateImage(req as GenRequest)).catch((e: Error) => {
        // the app's own checks (the model does not take an end frame, …) are worth saying before the click
        if (/[가-힣]/.test(e.message)) problem = e.message
        return null
      }),
      balanceOf(req.provider).catch((e: Error) => {
        // the service's own sign-in ran out: said here rather than "모름"
        if (e instanceof NeedsLoginError) problem = e.message
        return null
      }),
    ])
    return { cost: cost?.credits ?? null, certainty: cost?.certainty, adjusted: cost?.adjusted, balance: balance ?? undefined, problem }
  })
  handle('ai:balance', async (provider: 'higgsfield' | 'magnific') => (await balanceOf(provider).catch(() => null)) ?? null)
  handle('app:claudeUsage', (force?: boolean) => claudeUsage(!!force))
  handle('ai:generateVideo', (id: string, req: VideoGenRequest) => generateVideoCandidate(projects.pathOf(id), req))
  handle('ai:candidates', (id: string) => listCandidates(projects.pathOf(id)))
  handle('ai:discardCandidate', (id: string, cid: string) => {
    discardCandidate(projects.pathOf(id), cid)
    return listCandidates(projects.pathOf(id))
  })
  handle('ai:keepCandidate', (id: string, cid: string) => {
    const c = listCandidates(projects.pathOf(id)).find((x) => x.id === cid)
    if (!c) throw new Error('후보를 찾을 수 없어요. 다시 만들어 주세요.')
    return projects.keepCandidate(id, c)
  })
  handle('ai:reconvert', async (id: string, dirRel: string, framing: Framing, colors: number) => {
    const dir = projects.pathOf(id)
    const info = await reconvert(dir, dirRel, framing, colors)
    // a kept asset or a candidate: its record follows the new conversion
    const list = listCandidates(dir)
    const mine = (c: (typeof list)[number]) => c.character?.dir === dirRel || c.file === `${dirRel}/source.png`
    if (list.some(mine)) writeCandidates(dir, list.map((c) => (mine(c) ? { ...c, character: info } : c)))
    // (a kept asset's brief entry is updated by the brief screen)
    return info
  })
  handle('ai:askHelper', (sid: string, message: string, ctx: HelperContext & { projectId?: string; referenceFiles?: string[] }) => {
    // the generator's picked images → files the helper can look at: reference assets are
    // composition-relative, video frames may also be candidates (.studio/generations/…)
    // (and images dropped on the helper: feedback/refs/…, storyboard sketches: .studio/…, attachments: references/…)
    const refs = ctx.projectId ? (ctx.referenceFiles ?? []).map((r) => (/^(\.studio|feedback|references)\//.test(r) ? join(projects.pathOf(ctx.projectId!), r) : join(projects.pathOf(ctx.projectId!), 'composition', r))).filter((f) => !relative(projects.pathOf(ctx.projectId!), f).startsWith('..')) : []
    return askHelper(sid, message, { ...ctx, references: refs })
  })
  handle('ai:codexStatus', (force?: boolean) => codexStatus(!!force))
  handle('ai:audioCandidates', (id: string) => readJson<AudioCandidateList | null>(join(projects.pathOf(id), '.studio', 'audio-candidates.json'), null))
  handle('ai:searchAudio', (id: string, input: { query: string; kind: 'bgm' | 'sfx' }) => {
    const what = input.kind === 'bgm' ? '배경음악' : '효과음'
    return agent.send({ projectId: id, text: `아트리스트에서 "${input.query.trim()}" ${what} 후보를 8개쯤 찾아서 사운드 패널에 보여 주세요. 미리듣기 주소가 있으면 꼭 넣어 주세요.` })
  })
  handle('ai:useAudioCandidate', async (id: string, item: AudioCandidate) => {
    const dir = projects.pathOf(id)
    // a listening copy already in the project: that file
    if (item.file && !item.file.includes('..') && existsSync(join(dir, 'composition', item.file))) return item.file
    const url = item.downloadUrl ?? item.previewUrl
    if (!url) throw new Error('이 후보는 내려받을 수 있는 파일 주소가 없어요. 아트리스트에서 직접 받아서 첨부해 주세요.')
    const m = await importUrl(join(dir, 'composition'), url, item.source.replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'audio')
    recordGenerated(dir, [{ file: m.file, kind: m.kind, provider: item.source, tool: 'pick', label: item.title }])
    return m.file
  })
  handle('ai:artlistLogin', () => agent.startArtlistLogin())
  handle('ai:artlistLoginDone', () => {
    agent.kill('__artlist__')
    // sessions connect to MCP servers at start: reconnect idle ones so the sign-in reaches them
    agent.restartIdle()
  })

  // ---- fonts ----
  handle('fonts:list', () => listFonts())
  handle('fonts:rescan', () => listFonts(true))

  return agent
}
