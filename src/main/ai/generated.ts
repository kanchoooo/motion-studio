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
  /** the settings it was made with, without the prompt / script (voice id, model …) */
  args?: Record<string, unknown>
  /** imported from the web: the page it came from and its license (shown before export) */
  source?: string
  license?: string
  at: string
}

/** settings worth keeping from a tool call: short plain values, not the prompt or the script itself */
export function keptArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (/^(prompt|text|script|input|negative.*)$/i.test(k)) continue
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)) out[k] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = keptArgs(v as Record<string, unknown>)
      if (Object.keys(inner).length) out[k] = inner
    }
  }
  return out
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
