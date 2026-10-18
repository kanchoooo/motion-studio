// 관제 연동 (a console on this Mac — the user's own dashboard — that runs Motion Studio from a browser
// and keeps every export in one folder). Off unless the console writes <userData>/console.json:
//   {"web": true, "collectDir": "/Users/…/작업장/모션스튜디오 결과물"}
// Without the file the app behaves exactly as before (Windows and other Macs never have it).
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export interface ConsoleSettings {
  /** the console's web connection (a local server the console relays) */
  web: boolean
  /** every export also lands in this folder (absolute) */
  collectDir?: string
}

const OFF: ConsoleSettings = { web: false }
export const consoleFile = () => join(app.getPath('userData'), 'console.json')

/** the settings as the console wrote them (off when the file is missing or unreadable) */
export function readConsoleSettings(): ConsoleSettings {
  try {
    if (!existsSync(consoleFile())) return OFF
    const raw = JSON.parse(readFileSync(consoleFile(), 'utf8')) as { web?: unknown; collectDir?: unknown }
    const dir = typeof raw.collectDir === 'string' && raw.collectDir.trim() ? raw.collectDir.trim().replace(/^~(?=\/|$)/, homedir()).normalize('NFC') : undefined
    return { web: raw.web === true, collectDir: dir }
  } catch {
    return OFF
  }
}

/**
 * Calls back with the settings now and whenever the console changes them (the file is watched, and
 * read again every 10 s in case a watch event is missed). Returns a stop function.
 */
export function watchConsoleSettings(onChange: (s: ConsoleSettings) => void): () => void {
  let last = ''
  const check = () => {
    const s = readConsoleSettings()
    const key = JSON.stringify(s)
    if (key === last) return
    last = key
    onChange(s)
  }
  check()
  let w: FSWatcher | null = null
  try {
    w = watch(app.getPath('userData'), (_e, name) => name === 'console.json' && setTimeout(check, 200))
  } catch {
    /* the 10 s check is enough */
  }
  const timer = setInterval(check, 10_000)
  return () => {
    clearInterval(timer)
    w?.close()
  }
}
