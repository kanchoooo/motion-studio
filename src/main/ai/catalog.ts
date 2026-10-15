// Model and voice catalogues for the designer's pickers (brief, voice finder),
// read from each service's own MCP tools (formats checked against the live
// services, 2026-10-13):
//  - Magnific: images_models_list / video_models_list / audio_voices_list return
//    compact YAML-like text (see toon.ts); plan-blocked models are listed under
//    unavailableToThisAccount.
//  - Higgsfield: models_explore {action:list,type} and list_voices return JSON
//    (structuredContent), paginated; voices carry a free preview_url.
import type { AiConnectProvider, AiMediaKind, AiModelInfo, AiModelList, AiVoiceInfo } from '@shared/ai'
import { activeAccount } from './accounts'
import { callTool, type ToolResult } from './connect'
import { parseToon } from './toon'

const cache = new Map<string, { at: number; value: unknown }>()
/** successful results only: a failure is retried next time */
async function cached<T>(key: string, ttl: number, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value as T
  const value = await make()
  cache.set(key, { at: Date.now(), value })
  return value
}
export const clearCatalog = () => cache.clear()

/** text of a tool result (all text blocks) */
const textOf = (r: ToolResult) => (r.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text!).join('\n')

/** turns a service error into a message for the designer */
function failIfError(r: ToolResult) {
  if (!r.isError) return
  const t = textOf(r)
  if (/free limit|limit .*used up|daily/i.test(t)) throw new Error('오늘 무료 사용 한도를 다 썼어요. 크레딧은 차감되지 않았어요. 내일 다시 시도하거나 유료 플랜이 있는 계정을 써 주세요.')
  if (/premium|upgrade|plan/i.test(t)) throw new Error('지금 계정의 플랜으로는 쓸 수 없어요. 유료 플랜이 있는 계정으로 바꿔 주세요.')
  throw new Error(t.slice(0, 300) || '서비스가 오류를 돌려줬어요.')
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
      const toon = parseToon(t)
      if (toon) return toon
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
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [])

// ---- models -------------------------------------------------------------------------

/** Magnific catalogue text → models (plan-blocked slugs included, flagged) */
// Magnific lists lip-sync, motion-transfer and video-edit models among its video generators
const MG_NOT_GENERATOR = /lipsync|act-two|motion-control|animate|-edit\b|live2d|fabric|v2v|omnihuman|sync-/i

export function magnificModels(v: unknown, kind: AiMediaKind): AiModelList {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const items: AiModelInfo[] = (Array.isArray(o.models) ? o.models : [])
    // "private" models are feature-flagged: listed only when this account has them
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const rec = (m.agentRecommendation ?? null) as Record<string, unknown> | null
      return {
        provider: 'magnific' as const,
        id: String(m.slug ?? m.id ?? ''),
        name: String(m.name ?? m.slug ?? ''),
        kind,
        description: (rec && typeof rec.summary === 'string' ? rec.summary : undefined) ?? str(m, 'description'),
        recommended: !!rec,
        premium: m.requiresPremium === true,
        _rank: rec && typeof rec.rank === 'number' ? rec.rank : 99,
        // what the model takes: lengths, ratios, resolutions, first / last frame
        durations: Array.isArray(m.durations) ? m.durations.map(Number).filter((x) => Number.isFinite(x)) : undefined,
        aspectRatios: strings(m.aspectRatios).filter((r) => /^\d+:\d+$/.test(r)),
        resolutions: strings(m.resolutions),
        roles: [...(m.supportsStartFrame === true ? ['start_image'] : []), ...(m.supportsEndFrame === true ? ['end_image'] : [])],
        needsImage: strings(m.requiredInputs).includes('keyframes'),
        _skip: kind === 'video' && (MG_NOT_GENERATOR.test(String(m.slug ?? '')) || strings(m.requiredInputs).includes('audioConstraints')),
      }
    })
    .filter((m) => m.id && m.id !== 'auto' && !m._skip)
    .map(({ _skip, ...m }) => (void _skip, m))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a._rank - b._rank || a.name.localeCompare(b.name))
    .map(({ _rank, ...m }) => (void _rank, m))
  const blocked = strings(o.unavailableToThisAccount)
  for (const slug of blocked) if (!items.some((m) => m.id === slug)) items.push({ provider: 'magnific', id: slug, name: slug, kind, unavailable: true, premium: true })
  const what = kind === 'video' ? '영상' : '이미지'
  const note = !items.some((m) => !m.unavailable)
    ? blocked.length || o.requiresPremium === true
      ? `지금 계정의 플랜으로는 ${what} 생성을 쓸 수 없어요(매그니픽 프리미엄 필요).`
      : `이 계정에서 쓸 수 있는 ${what} 모델이 없어요. 매그니픽 플랜을 확인해 주세요.`
    : undefined
  return { items, note }
}

// Higgsfield lists editing / dubbing / workflow tools among its "video" models: only models that
// make a picture or a clip from a prompt (and optionally images) are offered
const HF_EDIT_ROLES = new Set(['video_references', 'input_video', 'input_audio', 'audio_references', 'mask'])
const HF_SKIP = /^(marketing_studio|higgsfield_preset|autosprite|soul_cast|video_background_remover|voice_change|dubbing|sync_so|ads_studio|ai_influencer)/

export function higgsfieldModels(pages: unknown[], kind: AiMediaKind): AiModelList {
  const items: AiModelInfo[] = []
  for (const p of pages)
    for (const m of entries(p)) {
      const id = str(m, 'id', 'model_id', 'slug')
      if (!id || items.some((x) => x.id === id) || HF_SKIP.test(id)) continue
      const provider = str(m, 'provider_name')
      const medias = (Array.isArray(m.medias) ? m.medias : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      const roles = [...new Set(medias.flatMap((x) => (Array.isArray(x.roles) ? x.roles.map(String) : [])))]
      // only media inputs that edit an existing clip / sound: not a generator
      if (kind === 'video' && roles.length && roles.every((r) => HF_EDIT_ROLES.has(r))) continue
      const range = m.duration_range && typeof m.duration_range === 'object' ? (m.duration_range as { min?: unknown; max?: unknown }) : null
      items.push({
        provider: 'higgsfield',
        id,
        name: `${str(m, 'name') ?? id}${provider && provider !== 'Higgsfield' ? ` · ${provider}` : ''}`,
        kind,
        description: str(m, 'description'),
        roles,
        durations: Array.isArray(m.durations) ? m.durations.map(Number).filter((x) => Number.isFinite(x)) : undefined,
        durationRange: range && Number.isFinite(Number(range.min)) && Number.isFinite(Number(range.max)) ? { min: Number(range.min), max: Number(range.max) } : undefined,
        aspectRatios: Array.isArray(m.aspect_ratios) ? m.aspect_ratios.map(String).filter((r) => /^\d+:\d+$/.test(r)) : undefined,
        needsImage: medias.some((x) => x.required === true),
      })
    }
  return { items }
}

/** Higgsfield's "자동": a model id is required there — image_auto for pictures; for clips the first generator that takes the frames given */
export function autoHiggsfieldModel(list: AiModelInfo[], kind: AiMediaKind, frames: { start?: boolean; end?: boolean } = {}): string | undefined {
  if (kind === 'image') return (list.find((m) => m.id === 'image_auto') ?? list[0])?.id
  const fits = (m: AiModelInfo) => !m.needsImage && (!frames.start || m.roles?.some((r) => r === 'start_image' || r === 'image')) && (!frames.end || m.roles?.includes('end_image'))
  return (list.find((m) => m.id === 'seedance1_5' && fits(m)) ?? list.find(fits) ?? list[0])?.id
}

export async function listModels(provider: AiConnectProvider, kind: AiMediaKind): Promise<AiModelList> {
  const acc = activeAccount(provider)
  if (!acc) return { items: [] }
  return cached(`models:${acc.id}:${kind}`, 30 * 60_000, async () => {
    if (provider === 'magnific') {
      const tool = kind === 'image' ? 'images_models_list' : kind === 'video' ? 'video_models_list' : null
      if (!tool) return { items: [] }
      const r = await callTool(provider, tool, {}, 60_000)
      failIfError(r)
      return magnificModels(payload(r), kind)
    }
    // Higgsfield: models_explore pages
    const pages: unknown[] = []
    let after: string | undefined
    for (let i = 0; i < 6; i++) {
      const r = await callTool(provider, 'models_explore', { action: 'list', type: kind, limit: 100, ...(after ? { after } : {}) }, 60_000)
      failIfError(r)
      const p = payload(r) as { has_more?: boolean; next_page_token?: string } | null
      pages.push(p)
      if (!p?.has_more || !p.next_page_token) break
      after = p.next_page_token
    }
    return higgsfieldModels(pages, kind)
  })
}

// ---- voices -------------------------------------------------------------------------

export function magnificVoices(v: unknown): AiVoiceInfo[] {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return (Array.isArray(o.voices) ? o.voices : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      provider: 'magnific' as const,
      id: String(x.id ?? ''),
      name: String(x.name ?? x.id ?? '').trim(),
      description: str(x, 'description'),
      languages: strings(x.languages),
      multilingual: x.supportsAllLanguages === true,
      gender: str(x, 'gender'),
      age: str(x, 'age'),
      engine: str(x, 'provider'),
      source: str(x, 'source') ?? 'catalog',
    }))
    .filter((x) => x.id)
}

export function higgsfieldVoices(pages: unknown[]): AiVoiceInfo[] {
  const out: AiVoiceInfo[] = []
  for (const p of pages)
    for (const x of entries(p)) {
      const id = str(x, 'voice_id', 'id')
      if (!id || out.some((v) => v.id === id)) continue
      out.push({ provider: 'higgsfield', id, name: str(x, 'name') ?? id, gender: str(x, 'gender'), previewUrl: str(x, 'preview_url'), thumbnail: str(x, 'logo_url'), voiceType: str(x, 'voice_type') ?? 'preset', description: str(x, 'description') })
    }
  return out
}

export async function listVoices(provider: AiConnectProvider): Promise<AiVoiceInfo[]> {
  const acc = activeAccount(provider)
  if (!acc) return []
  return cached(`voices:${acc.id}`, 60 * 60_000, async () => {
    if (provider === 'magnific') {
      const r = await callTool(provider, 'audio_voices_list', {}, 90_000)
      failIfError(r)
      return magnificVoices(payload(r))
    }
    const pages: unknown[] = []
    let cursor: string | undefined
    for (let i = 0; i < 15; i++) {
      const r = await callTool(provider, 'list_voices', { size: 100, ...(cursor ? { cursor } : {}) }, 60_000)
      failIfError(r)
      const p = payload(r) as { has_more?: boolean; next_cursor?: string } | null
      pages.push(p)
      if (!p?.has_more || !p.next_cursor) break
      cursor = p.next_cursor
    }
    return higgsfieldVoices(pages)
  })
}

export { failIfError, textOf }
