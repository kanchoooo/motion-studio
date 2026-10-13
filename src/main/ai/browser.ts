// Opens a sign-in page the way the designer chose: in a private / incognito
// window (the browser's signed-in account, often the company one, is not
// reused, so another account can sign in) or in a normal window of a chosen
// browser. Safari has no command-line private window: its address is copied
// for the designer to paste into one.
import { clipboard, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LoginBrowser, LoginWindow } from '@shared/ai'

interface Known {
  id: string
  name: string
  privateName: string
  /** macOS application name (in /Applications or ~/Applications) */
  mac: string
  /** Windows executable relative to Program Files / Program Files (x86) / LocalAppData */
  win: string[]
  /** command-line switch that opens a private window; null: there is none */
  flag: string | null
}

const KNOWN: Known[] = [
  { id: 'chrome', name: 'Chrome', privateName: '시크릿 창', mac: 'Google Chrome', win: ['Google\\Chrome\\Application\\chrome.exe'], flag: '--incognito' },
  { id: 'whale', name: '웨일', privateName: '시크릿 창', mac: 'Whale', win: ['Naver\\Naver Whale\\Application\\whale.exe'], flag: '--incognito' },
  { id: 'edge', name: 'Edge', privateName: 'InPrivate 창', mac: 'Microsoft Edge', win: ['Microsoft\\Edge\\Application\\msedge.exe'], flag: '--inprivate' },
  { id: 'brave', name: 'Brave', privateName: '개인 창', mac: 'Brave Browser', win: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'], flag: '--incognito' },
  { id: 'firefox', name: 'Firefox', privateName: '사생활 보호 창', mac: 'Firefox', win: ['Mozilla Firefox\\firefox.exe'], flag: '-private-window' },
  { id: 'safari', name: '사파리', privateName: '개인 정보 보호 창', mac: 'Safari', win: [], flag: null },
]

function macApp(name: string): string | null {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    const p = join(dir, `${name}.app`)
    if (existsSync(p)) return p
  }
  return null
}

function winExe(rel: string[]): string | null {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[]
  for (const r of roots) for (const x of rel) if (existsSync(join(r, x))) return join(r, x)
  return null
}

/** where the browser is installed on this computer, or null */
function installed(b: Known): string | null {
  return process.platform === 'darwin' ? macApp(b.mac) : process.platform === 'win32' ? winExe(b.win) : null
}

export function loginBrowsers(): LoginBrowser[] {
  return KNOWN.filter(installed).map(({ id, name, privateName, flag }) => ({ id, name, privateName, canPrivate: !!flag }))
}

/** fresh: a new instance on mac (open -n), so a private-window switch works even when the browser is already running */
function launch(path: string, args: string[], fresh: boolean) {
  if (process.platform === 'darwin') spawn('open', fresh ? ['-na', path, '--args', ...args] : ['-a', path, ...args], { detached: true, stdio: 'ignore' }).unref()
  else spawn(path, args, { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Opens url as chosen. 'copied': a private window could not be opened (Safari,
 * or no such browser here), so the address is on the clipboard instead; the
 * normal browser is never used then, it would sign in with its saved account.
 */
export async function openLogin(w: LoginWindow | undefined, url: string): Promise<'opened' | 'copied'> {
  const mode = w?.mode ?? 'normal'
  const b = KNOWN.find((x) => x.id === w?.browser)
  const path = b ? installed(b) : null
  if (mode === 'private') {
    if (b?.flag && path) {
      launch(path, [b.flag, url], true)
      return 'opened'
    }
    clipboard.writeText(url)
    return 'copied'
  }
  if (path) launch(path, [url], false)
  else await shell.openExternal(url)
  return 'opened'
}
