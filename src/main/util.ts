import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const newId = () => randomUUID()
export const shortId = () => randomUUID().slice(0, 8)
export const nowIso = () => new Date().toISOString()

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** atomic write so a crash never leaves a half-written project file */
export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2) + '\n')
}

export function writeText(path: string, text: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

/** file-system safe name that keeps Korean characters */
export function safeName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .normalize('NFC')
    // % and # break file URLs (preview server, renderer <img>)
    .replace(/[\\/:*?"<>|%#\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
  return cleaned || fallback
}

export function uniquePath(make: (n: number) => string): string {
  for (let n = 0; ; n++) {
    const p = make(n)
    if (!existsSync(p)) return p
  }
}

export function formatDate(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
