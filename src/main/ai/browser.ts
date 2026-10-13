// Opens a sign-in page in a private / incognito window of an installed browser,
// so a second account (personal vs. company) is not signed in automatically by
// the browser's existing session. Safari has no command-line private window:
// the UI offers "copy address" for it.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PrivateBrowser } from '@shared/ai'

interface Known {
  id: string
  label: string
  /** macOS application name (in /Applications or ~/Applications) */
  mac: string
  /** Windows executable relative to Program Files / Program Files (x86) / LocalAppData */
  win: string[]
  flag: string
}

const KNOWN: Known[] = [
  { id: 'chrome', label: 'Chrome 시크릿 창', mac: 'Google Chrome', win: ['Google\\Chrome\\Application\\chrome.exe'], flag: '--incognito' },
  { id: 'whale', label: '웨일 시크릿 창', mac: 'Whale', win: ['Naver\\Naver Whale\\Application\\whale.exe'], flag: '--incognito' },
  { id: 'edge', label: 'Edge InPrivate 창', mac: 'Microsoft Edge', win: ['Microsoft\\Edge\\Application\\msedge.exe'], flag: '--inprivate' },
  { id: 'brave', label: 'Brave 개인 창', mac: 'Brave Browser', win: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'], flag: '--incognito' },
  { id: 'firefox', label: 'Firefox 사생활 보호 창', mac: 'Firefox', win: ['Mozilla Firefox\\firefox.exe'], flag: '-private-window' },
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

export function privateBrowsers(): PrivateBrowser[] {
  return KNOWN.filter((b) => (process.platform === 'darwin' ? macApp(b.mac) : process.platform === 'win32' ? winExe(b.win) : null)).map(({ id, label }) => ({ id, label }))
}

/** opens url in a private window of the given browser; false if it is not installed */
export function openPrivate(browserId: string, url: string): boolean {
  const b = KNOWN.find((x) => x.id === browserId)
  if (!b) return false
  if (process.platform === 'darwin') {
    const app = macApp(b.mac)
    if (!app) return false
    // -n: a new window even when the browser is already running
    spawn('open', ['-na', app, '--args', b.flag, url], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'win32') {
    const exe = winExe(b.win)
    if (!exe) return false
    spawn(exe, [b.flag, url], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  return false
}
