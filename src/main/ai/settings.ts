// App-wide AI settings (not per project).
import { join } from 'node:path'
import type { AiSettings } from '@shared/ai'
import { dataDir } from '../paths'
import { readJson, writeJson } from '../util'

const file = () => join(dataDir(), 'ai-settings.json')

export function aiSettings(): AiSettings {
  return { artlist: false, ...readJson<Partial<AiSettings>>(file(), {}) }
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = { ...aiSettings(), ...patch }
  writeJson(file(), next)
  return next
}
