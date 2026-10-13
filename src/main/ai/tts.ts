// Short text-to-speech samples so the designer can hear a voice before using it.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AiConnectProvider } from '@shared/ai'
import { dataDir } from '../paths'
import { callTool, listTools } from './connect'
import { saveResultMedia } from './media'

/** generates a sample with the service's TTS tool; returns the absolute file path */
export async function ttsSample(provider: AiConnectProvider, voiceId: string, text: string): Promise<string> {
  const tools = await listTools(provider)
  const tool = tools.find((t) => /tts|speech|text_to_speech/i.test(t.name) && !/voice.*list|list/i.test(t.name))
  if (!tool) throw new Error('이 서비스에서 음성 생성 도구를 찾지 못했어요.')
  const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {})
  const textKey = props.find((k) => /^(text|input|script|prompt)$/i.test(k)) ?? 'text'
  const voiceKey = props.find((k) => /^(voice_id|voiceId|voice)$/i.test(k)) ?? 'voice_id'
  const dir = join(dataDir(), 'tts-samples')
  mkdirSync(dir, { recursive: true })
  const r = await callTool(provider, tool.name, { [textKey]: text, [voiceKey]: voiceId })
  if (r.isError) throw new Error(r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300) ?? '음성을 만들지 못했어요.')
  // saveResultMedia writes into <dir>/assets/generated
  const saved = await saveResultMedia(dir, `${provider}-sample`, r, 1)
  if (!saved.length) throw new Error('음성 파일을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  return join(dir, saved[0].file)
}
