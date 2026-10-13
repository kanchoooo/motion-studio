// Model and voice catalogues for the designer's pickers (brief, TTS browser),
// read from the services' own MCP tools and normalised.
import type { AiConnectProvider, AiMediaKind, AiModelInfo, AiVoiceInfo } from '@shared/ai'
import { activeAccount } from './accounts'
import { callTool, listTools, type ToolInfo, type ToolResult } from './connect'

const cache = new Map<string, { at: number; value: unknown }>()
async function cached<T>(key: string, make: () => Promise<T>, ttl = 10 * 60_000): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value as T
  const value = await make()
  cache.set(key, { at: Date.now(), value })
  return value
}
export const clearCatalog = () => cache.clear()

const KIND_RE: Record<AiMediaKind, RegExp> = { image: /image/i, video: /video/i, audio: /voice|tts|audio|speech/i }

function pickTool(tools: ToolInfo[], subject: RegExp, kind?: RegExp): ToolInfo | undefined {
  const cand = tools.filter((t) => subject.test(t.name) && (!kind || kind.test(t.name)))
  return cand.find((t) => /list|search|catalog/i.test(t.name)) ?? cand[0]
}

/** JSON payload of a tool result (structured content, or the first JSON text block) */
export function payload(r: ToolResult): unknown {
  if (r.structuredContent) return r.structuredContent
  for (const c of r.content ?? []) {
    if (c.type !== 'text' || !c.text) continue
    const t = c.text.trim()
    try {
      return JSON.parse(t)
    } catch {
      const m = t.match(/[[{][\s\S]*[\]}]/)
      if (m) {
        try {
          return JSON.parse(m[0])
        } catch {
          /* not JSON */
        }
      }
    }
  }
  return null
}

/** the largest array of objects that look like catalogue entries */
export function entries(v: unknown): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) {
      const objs = x.filter((e) => e && typeof e === 'object' && !Array.isArray(e)) as Record<string, unknown>[]
      if (objs.length > best.length && objs.some((o) => ['id', 'slug', 'model', 'model_id', 'voice_id', 'name'].some((k) => k in o))) best = objs
      x.forEach(walk)
    } else if (x && typeof x === 'object') Object.values(x).forEach(walk)
  }
  walk(v)
  return best
}

const str = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

export async function listModels(provider: AiConnectProvider, kind: AiMediaKind): Promise<AiModelInfo[]> {
  const acc = activeAccount(provider)
  if (!acc) return []
  return cached(`models:${acc.id}:${kind}`, async () => {
    const tools = await listTools(provider)
    const tool = pickTool(tools, /model/i, KIND_RE[kind])
    if (!tool) return []
    const items = entries(payload(await callTool(provider, tool.name, {}, 60_000)))
    return items
      .map((o): AiModelInfo | null => {
        const id = str(o, 'id', 'model_id', 'model', 'slug', 'key', 'name')
        if (!id) return null
        const name = str(o, 'display_name', 'displayName', 'title', 'name', 'label') ?? id
        return { provider, id, name, kind, description: str(o, 'description', 'summary', 'tagline') }
      })
      .filter((x): x is AiModelInfo => !!x)
  })
}

export async function listVoices(provider: AiConnectProvider, query = ''): Promise<AiVoiceInfo[]> {
  const acc = activeAccount(provider)
  if (!acc) return []
  const tools = await listTools(provider)
  const tool = pickTool(tools, /voice/i)
  if (!tool) return []
  const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {})
  const qKey = props.find((k) => /^(q|query|search|keyword|text|name)$/i.test(k))
  const all = await cached(`voices:${acc.id}:${qKey ? query : ''}`, async () => {
    const args: Record<string, unknown> = {}
    if (qKey && query) args[qKey] = query
    const lim = props.find((k) => /^(limit|page_size|per_page|count)$/i.test(k))
    if (lim) args[lim] = 100
    return entries(payload(await callTool(provider, tool.name, args, 60_000)))
      .map((o): AiVoiceInfo | null => {
        const id = str(o, 'id', 'voice_id', 'voiceId', 'slug', 'key', 'name')
        if (!id) return null
        const tags = Object.values(o).flatMap((v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [])) as string[]
        return {
          provider,
          id,
          name: str(o, 'display_name', 'displayName', 'name', 'title') ?? id,
          description: str(o, 'description', 'style', 'accent', 'use_case'),
          language: str(o, 'language', 'lang', 'locale', 'language_code'),
          gender: str(o, 'gender', 'sex'),
          tags: tags.slice(0, 8),
          previewUrl: str(o, 'preview_url', 'previewUrl', 'sample_url', 'sampleUrl', 'preview', 'sample', 'audio_url', 'demo_url'),
        }
      })
      .filter((x): x is AiVoiceInfo => !!x)
  })
  const q = query.trim().toLowerCase()
  if (!q || qKey) return all
  return all.filter((v) => [v.name, v.description, v.language, v.gender, ...(v.tags ?? [])].some((s) => s?.toLowerCase().includes(q)))
}
