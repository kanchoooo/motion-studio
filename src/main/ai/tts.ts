// Short text-to-speech samples for voices without a free preview (Magnific).
// Each sample is made once (it costs the service's credits) and kept on disk.
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AiVoiceInfo } from '@shared/ai'
import { dataDir } from '../paths'
import { failIfError, payload } from './catalog'
import { callTool, type ToolResult } from './connect'
import { saveResultMedia } from './media'

const sampleDir = () => join(dataDir(), 'tts-samples')
const prefixOf = (v: AiVoiceInfo) => `${v.provider}-${v.id.replace(/[^\w-]/g, '')}`

/** creation identifiers in a queued result */
function identifiers(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => identifiers(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (/^(identifier|creationIdentifier|identifiers)$/i.test(k)) (Array.isArray(x) ? x : [x]).forEach((i) => typeof i === 'string' && !out.includes(i) && out.push(i))
      else identifiers(x, out)
    }
  return out
}

/** absolute path of an existing sample, if the voice was auditioned before */
export function existingSample(v: AiVoiceInfo): string | null {
  const dir = join(sampleDir(), 'assets', 'generated')
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).find((n) => n.startsWith(`${prefixOf(v)}-`) && /\.(mp3|wav|m4a|ogg|aac)$/i.test(n))
  return f ? join(dir, f) : null
}

export async function ttsSample(v: AiVoiceInfo, text: string): Promise<string> {
  const have = existingSample(v)
  if (have) return have
  if (v.provider !== 'magnific') throw new Error('이 목소리는 미리듣기로 들어 주세요.')
  mkdirSync(sampleDir(), { recursive: true })
  let r: ToolResult = await callTool('magnific', 'audio_tts', { text, voiceId: Number(v.id), source: v.source ?? 'catalog' }, 120_000)
  failIfError(r)
  let saved = await saveResultMedia(sampleDir(), prefixOf(v), r, 1)
  // queued: wait for the creation, then read its URLs
  const ids = saved.length ? [] : identifiers(payload(r)).slice(0, 1)
  for (let i = 0; i < 6 && ids.length && !saved.length; i++) {
    r = await callTool('magnific', 'creations_wait', { identifiers: ids, timeoutSeconds: 25 }, 60_000)
    failIfError(r)
    const done = !/in[_ -]?progress|queued|processing|poll_after/i.test(JSON.stringify(payload(r)) ?? '')
    if (done) {
      r = await callTool('magnific', 'creations_get', { identifiers: ids }, 60_000)
      failIfError(r)
      saved = await saveResultMedia(sampleDir(), prefixOf(v), r, 1)
    }
  }
  if (!saved.length) throw new Error('샘플 소리를 받지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  return join(sampleDir(), saved[0].file)
}
