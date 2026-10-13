import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AiVoiceInfo } from '@shared/ai'
import { filterVoices, matchesQuery, voiceTags } from '@shared/voiceSearch'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
const { parseToon } = await import('../../src/main/ai/toon')
const { higgsfieldModels, higgsfieldVoices, magnificModels, magnificVoices, payload } = await import('../../src/main/ai/catalog')

// real (trimmed) responses from the services, 2026-10-13
const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8')

describe('Magnific catalogue text', () => {
  it('parses nested objects, inline arrays and quoted scalars', () => {
    const t = parseToon('models[1]:\n  - slug: a\n    name: "A, b"\n    aspectRatios[2]: "1:1","16:9"\n    agentRecommendation:\n      tier: sota\n      rank: 2\ninstruction: "x"')!
    expect(t.models).toEqual([{ slug: 'a', name: 'A, b', aspectRatios: ['1:1', '16:9'], agentRecommendation: { tier: 'sota', rank: 2 } }])
    expect(t.instruction).toBe('x')
  })

  it('lists image models, recommended first, without "auto"', () => {
    const r = magnificModels(payload({ content: [{ type: 'text', text: fixture('magnific-images-models.txt') }] }), 'image')
    expect(r.items.map((m) => m.id)).toEqual(['magnific-one', 'classic'])
    expect(r.items[0]).toMatchObject({ recommended: true })
    expect(r.items.some((m) => m.id === 'auto')).toBe(false)
    expect(r.items.find((m) => m.id === 'classic')?.premium).toBe(true)
  })

  it('shows plan-blocked video models instead of an empty list', () => {
    const r = magnificModels(payload({ content: [{ type: 'text', text: fixture('magnific-video-models-unavailable.txt') }] }), 'video')
    expect(r.items.length).toBe(6)
    expect(r.items.every((m) => m.unavailable)).toBe(true)
    expect(r.note).toContain('프리미엄')
  })

  it('explains an empty video catalogue', () => {
    const r = magnificModels(payload({ content: [{ type: 'text', text: 'models[0]:\ninstruction: "…"' }] }), 'video')
    expect(r.items).toEqual([])
    expect(r.note).toContain('영상 모델이 없어요')
  })

  it('reads voices with language, gender, age and description', () => {
    const v = magnificVoices(payload({ content: [{ type: 'text', text: fixture('magnific-voices.txt') }] }))
    const chaewon = v.find((x) => x.name === 'Chaewon Baek')!
    expect(chaewon).toMatchObject({ id: '994', gender: 'female', age: 'young', languages: ['Korean'], engine: 'elevenlabs', source: 'catalog' })
    expect(v.some((x) => x.multilingual)).toBe(true)
  })
})

describe('Higgsfield catalogue JSON', () => {
  it('reads paginated models and voices with previews', () => {
    const page = { items: [{ id: 'gpt_image_2', name: 'GPT Image 2', provider_name: 'OpenAI', description: 'x', output_type: 'image' }], has_more: false }
    expect(higgsfieldModels([page], 'image').items[0]).toMatchObject({ id: 'gpt_image_2', name: 'GPT Image 2 · OpenAI' })
    const voices = higgsfieldVoices([{ voices: [{ voice_id: 'v1', voice_type: 'preset', name: 'Grady', gender: 'male', preview_url: 'https://cdn/x.mp3' }], has_more: false }])
    expect(voices[0]).toMatchObject({ id: 'v1', voiceType: 'preset', previewUrl: 'https://cdn/x.mp3', gender: 'male' })
  })
})

describe('finding a voice in Korean', () => {
  const v = (p: Partial<AiVoiceInfo>): AiVoiceInfo => ({ provider: 'magnific', id: Math.random().toString(), name: 'x', ...p })
  const list = [
    v({ name: 'Chaewon', gender: 'female', age: 'young', languages: ['Korean'], description: 'A clear and calm Korean female voice, natural news-anchor style, ideal for narration.' }),
    v({ name: 'Dohyun', gender: 'male', age: 'middle_aged', languages: ['Korean'], description: 'A deep, warm voice for commercials and advertising.' }),
    v({ name: 'Achird', gender: 'male', age: 'young', multilingual: true, description: 'Friendly and approachable' }),
    v({ name: 'Ada', gender: 'female', languages: ['English'], description: 'Conversational storytelling voice' }),
  ]

  it('understands Korean words ("한국 여성 차분")', () => {
    expect(matchesQuery(list[0], '한국')).toBe(true)
    expect(matchesQuery(list[0], '차분한 여성 내레이션')).toBe(true)
    expect(matchesQuery(list[1], '중후한 남성 광고')).toBe(true)
    // "male" must not match "female"
    expect(matchesQuery(list[0], '남성')).toBe(false)
  })

  it('filters by language (multilingual voices included) and puts native speakers first', () => {
    const ko = filterVoices(list, { query: '', language: 'ko', gender: '', age: '', feelings: [] })
    expect(ko.map((x) => x.name)).toEqual(['Chaewon', 'Dohyun', 'Achird'])
  })

  it('filters by feeling chips and shows Korean tags', () => {
    const calm = filterVoices(list, { query: '', language: '', gender: '', age: '', feelings: ['calm'] })
    expect(calm.map((x) => x.name)).toEqual(['Chaewon'])
    expect(voiceTags(list[1])).toEqual(expect.arrayContaining(['따뜻한', '중후한', '광고']))
  })
})
