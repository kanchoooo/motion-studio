// Log of media generated or imported by AI tools in a project (for the
// designer's lists: generated images/clips, narration takes).
import { join } from 'node:path'
import { nowIso, readJson, writeJson } from '../util'

export interface GeneratedItem {
  file: string
  kind: 'image' | 'video' | 'audio' | 'other'
  provider: string
  tool: string
  /** what it was made from (prompt, script line, track title) */
  label?: string
  at: string
}

const file = (projectDir: string) => join(projectDir, '.studio', 'generated.json')

export function listGenerated(projectDir: string): GeneratedItem[] {
  return readJson<GeneratedItem[]>(file(projectDir), [])
}

export function recordGenerated(projectDir: string, items: Omit<GeneratedItem, 'at'>[]) {
  if (!items.length) return
  const all = listGenerated(projectDir)
  writeJson(file(projectDir), [...items.map((i) => ({ ...i, at: nowIso() })), ...all].slice(0, 500))
}
