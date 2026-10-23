// 관제용 판's web shim (src/renderer/src/web/shim.ts): window.studio's methods and the channels they
// use, as in src/preload/index.ts (tests/unit/web-shim.test.ts compares the two).

/** studio.<namespace>.<method>() → invoke('<namespace>:<method>') */
export const INVOKE: Record<string, string[]> = {
  app: ['checkUpdate', 'downloadUpdate', 'installUpdate', 'hasAccess', 'unlock', 'info', 'doctor', 'login', 'cancelLogin', 'installBrowser', 'setupClaude', 'openExternal', 'reveal', 'pickFiles', 'claudeUsage', 'pickFolder', 'trustWorkspace', 'capture', 'setTheme'],
  projects: ['list', 'handoff', 'exportShare', 'importShare', 'renameAt', 'webFonts', 'create', 'move', 'replaceAssetFile', 'open', 'state', 'rename', 'remove', 'saveBrief', 'importAssets', 'saveOverrides', 'previewUrl', 'check', 'reportElements', 'audio', 'sfxLibrary', 'useSfx', 'fileUrl', 'addFeedbackImage', 'addToLibrary', 'addAssets', 'removeAsset', 'replaceAsset', 'saveOutput', 'diskUsage', 'clearCache'],
  templates: ['list', 'detect', 'create', 'rename', 'remove', 'createProject', 'slots', 'apply'],
  folders: ['list', 'create', 'rename', 'remove'],
  agent: ['start', 'restart', 'state', 'send', 'interrupt', 'transcript', 'storyboard', 'assign', 'assignFiles', 'pickVoice', 'pickAudio', 'requestHandoff', 'activateEditing', 'splitLayer', 'setModel', 'setPermission', 'permissions', 'answerPermission', 'resolveGenerated'],
  terminal: ['snapshot'],
  references: ['list', 'addFiles', 'addYoutube', 'update', 'remove'],
  variations: ['create', 'family', 'exportAll'],
  history: ['list', 'restore', 'restorePartial', 'saveVersion', 'star'],
  renders: ['preflight', 'list', 'start', 'cancel', 'update', 'remove', 'fileUrl', 'exportAe'],
  fonts: ['list'],
  claudeApi: ['status', 'saveKey', 'removeKey', 'setEnabled', 'retry', 'setBalance', 'cost'],
  ai: ['accounts', 'login', 'cancelLogin', 'setActive', 'rename', 'remove', 'models', 'voices', 'ttsSample', 'browsers', 'settings', 'saveSettings', 'generated', 'audioCandidates', 'searchAudio', 'useAudioCandidate', 'artlistLogin', 'artlistLoginDone', 'generate', 'estimate', 'balance', 'generateVideo', 'candidates', 'discardCandidate', 'keepCandidate', 'reconvert', 'askHelper', 'codexStatus'],
}
/** studio.<namespace>.<method>(cb) → the window's events */
export const EVENTS: Record<string, Record<string, string>> = {
  app: { onUpdateProgress: 'app:update-progress' },
  projects: { onChanged: 'projects:changed' },
  agent: { onEvent: 'agent:event' },
  renders: { onProgress: 'renders:progress', onAeProgress: 'renders:aeProgress' },
  ai: { onLogin: 'ai:login' },
}
/** fire-and-forget (ipcRenderer.send) */
export const SENDS: Record<string, Record<string, string>> = {
  terminal: { write: 'terminal:write', resize: 'terminal:resize' },
}
