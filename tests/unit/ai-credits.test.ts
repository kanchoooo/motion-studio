// beta.2: Higgsfield's nested params, the models that are not generators, what a model takes,
// the credit preflights of both services and Claude Code's /usage lines.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {} }))
const { autoHiggsfieldModel, higgsfieldModels, magnificModels } = await import('../../src/main/ai/catalog')
const { costOf, isCostOnly, nearestOf, toolParams } = await import('../../src/main/ai/generate')
const { videoArguments } = await import('../../src/main/ai/generateVideo')
const { koreanReset, parseUsage } = await import('../../src/main/claudeUsage')

const text = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] })

// the shape of Higgsfield's generate_video (2026-10-15): params is an anyOf of an object and a string
const HF_VIDEO = {
  name: 'generate_video',
  inputSchema: {
    type: 'object',
    properties: {
      params: {
        anyOf: [
          { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string' }, aspect_ratio: { type: 'string' }, duration: { type: 'integer' }, medias: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, value: { type: 'string' } } } }, get_cost: { type: 'boolean' } } },
          { type: 'string' },
        ],
      },
    },
  },
}
const HF_CATALOG = higgsfieldModels(
  [
    {
      items: [
        { id: 'seedance1_5', name: 'Seedance 1.5', provider_name: 'ByteDance', medias: [{ roles: ['start_image', 'end_image'], required: false }], durations: [4, 8, 12], aspect_ratios: ['16:9', '9:16', '1:1'] },
        { id: 'kling3_0', name: 'Kling 3.0', medias: [{ roles: ['start_image', 'end_image'] }], duration_range: { min: 3, max: 15 } },
        { id: 'wan2_6', name: 'Wan 2.6', medias: [{ roles: ['image'], required: true }], durations: [5, 10] },
        { id: 'video_background_remover', name: 'BG remover', medias: [{ roles: ['input_video'], required: true }] },
        { id: 'lipsync_x', name: 'Lip', medias: [{ roles: ['input_video', 'input_audio'], required: true }] },
        { id: 'marketing_studio_video', name: 'Marketing' },
        // live catalog 2026-10-15: editing tools and special workflows among the video models
        { id: 'reframe', name: 'Reframe', medias: [{ roles: ['video_references', 'start_image', 'image_references'] }] },
        { id: 'new_edit_tool', name: 'Edit', tags: ['video-to-video', 'video-editing'], medias: [{ roles: ['start_image'] }] },
        { id: 'new_brand_tool', name: 'Brand', parameters: [{ name: 'style_id', required: 'required' }] },
        { id: 'gemini_omni', name: 'Gemini Omni', tags: ['reference', 'image-to-video', 'video-to-video', 'text-to-video'], medias: [{ roles: ['image_references', 'video_references'] }], parameters: [{ name: 'resolution', required: 'required', default: '720p' }] },
      ],
    },
  ],
  'video',
).items

describe('Higgsfield tool parameters', () => {
  it('fills the object form of params (anyOf)', () => {
    const { nested, props } = toolParams(HF_VIDEO.inputSchema)
    expect(nested).toBe('params')
    expect(Object.keys(props)).toContain('model')
  })

  it('a flat schema stays flat', () => {
    expect(toolParams({ properties: { prompt: { type: 'string' } } })).toEqual({ nested: null, props: { prompt: { type: 'string' } } })
  })

  it('offers generators only, with what each takes', () => {
    expect(HF_CATALOG.map((m) => m.id)).toEqual(['seedance1_5', 'kling3_0', 'wan2_6', 'gemini_omni'])
    expect(HF_CATALOG[0]).toMatchObject({ roles: ['start_image', 'end_image'], durations: [4, 8, 12], needsImage: false })
    expect(HF_CATALOG[1].durationRange).toEqual({ min: 3, max: 15 })
    expect(HF_CATALOG[2].needsImage).toBe(true)
  })

  it('자동 picks a model that takes the frames given', () => {
    expect(autoHiggsfieldModel(HF_CATALOG, 'video')).toBe('seedance1_5')
    expect(autoHiggsfieldModel([HF_CATALOG[2], HF_CATALOG[1]], 'video', { start: true, end: true })).toBe('kling3_0')
    expect(autoHiggsfieldModel([{ provider: 'higgsfield', id: 'flux', name: 'F', kind: 'image' }, { provider: 'higgsfield', id: 'image_auto', name: 'A', kind: 'image' }], 'image')).toBe('image_auto')
  })

  it('a clip request: model, nested params, the nearest allowed length, the cost preflight', async () => {
    const { tool, args } = await videoArguments({ provider: 'higgsfield', model: '', lang: 'en', prompt: 'a cup', ratio: '9:16', duration: 5 }, {}, [HF_VIDEO], HF_CATALOG, { cost: true })
    expect(tool).toBe('generate_video')
    expect(args).toEqual({ params: { prompt: 'a cup', model: 'seedance1_5', aspect_ratio: '9:16', get_cost: true, duration: 4 } })
  })

  it('says so before sending when the model does not take the frames', async () => {
    const wan = { provider: 'higgsfield' as const, model: 'wan2_6', lang: 'en' as const, prompt: 'x', ratio: '16:9' as const, duration: 5 }
    await expect(videoArguments(wan, {}, [HF_VIDEO], HF_CATALOG)).rejects.toThrow(/시작 프레임 이미지가 있어야/)
    await expect(videoArguments(wan, { start: 'a.png', end: 'b.png' }, [HF_VIDEO], HF_CATALOG, { estimate: true })).rejects.toThrow(/끝 프레임을 받지 않아요/)
    // an estimate checks the frames without uploading them
    const { args } = await videoArguments({ ...wan, model: 'kling3_0', duration: 20 }, { start: 'a.png', end: 'b.png' }, [HF_VIDEO], HF_CATALOG, { estimate: true })
    expect(args).toEqual({ params: { prompt: 'x', model: 'kling3_0', aspect_ratio: '16:9', duration: 15 } })
  })
})

describe('Magnific video models', () => {
  const list = magnificModels(
    {
      models: [
        { slug: 'kling-v3', name: 'Kling 3', durations: [5, 10], aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], supportsStartFrame: true, supportsEndFrame: true, agentRecommendation: { rank: 1, summary: 'best' } },
        { slug: 'kling-lipsync', name: 'Lip sync', requiredInputs: ['keyframes'] },
        { slug: 'runway-act-two', name: 'Act two' },
        { slug: 'veo-audio', name: 'Veo audio', requiredInputs: ['audioConstraints'] },
        { slug: 'wan-i2v', name: 'Wan i2v', durations: [5], resolutions: ['480p', '720p'], supportsStartFrame: true, requiredInputs: ['keyframes'] },
      ],
    },
    'video',
  ).items
  const MG_VIDEO = { name: 'video_generate', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, slug: { type: 'string' }, duration: { type: 'number' }, aspectRatio: { type: 'string' }, resolution: { type: 'string' }, keyframes: { type: 'object' } } } }

  it('drops lip-sync, motion transfer and audio-driven models; keeps what each takes', () => {
    expect(list.map((m) => m.id)).toEqual(['kling-v3', 'wan-i2v'])
    expect(list[0]).toMatchObject({ roles: ['start_image', 'end_image'], durations: [5, 10], resolutions: ['720p', '1080p'], needsImage: false })
    expect(list[1].needsImage).toBe(true)
  })

  it('a clip request is flat, with a resolution and an allowed length', async () => {
    const { args } = await videoArguments({ provider: 'magnific', model: 'kling-v3', lang: 'en', prompt: 'x', ratio: '1:1', duration: 8 }, {}, [MG_VIDEO], list)
    expect(args).toEqual({ prompt: 'x', slug: 'kling-v3', aspectRatio: '16:9', duration: 10, resolution: '720p' })
  })

  it('auto (no slug) is left to Magnific', async () => {
    const { args } = await videoArguments({ provider: 'magnific', model: '', lang: 'en', prompt: 'x', ratio: '9:16', duration: 5 }, {}, [MG_VIDEO], list)
    expect(args).toEqual({ prompt: 'x', aspectRatio: '9:16', duration: 5 })
  })
})

describe('credits', () => {
  it("reads Higgsfield's get_cost and Magnific's simulate_cost", () => {
    expect(costOf(text({ cost: { credits: 4.8 }, adjustments: { duration: { requested: 5, used: 4 } } }))).toEqual({ credits: 4.8, adjusted: ['길이 5초 → 4초'] })
    expect(costOf(text({ credits: 35, certainty: 'variable' }))).toEqual({ credits: 35, certainty: 'variable' })
    expect(costOf(text({ credits: 2800, certainty: 'variable', reason: 'Auto mode selects the video provider at runtime. Shows the maximum possible cost.' }))?.certainty).toBe('max')
    expect(costOf(text({ nothing: true }))).toBeNull()
  })

  it('an estimate only goes out when it asks for the price', () => {
    expect(isCostOnly({ params: { model: 'a', get_cost: true } })).toBe(true)
    expect(isCostOnly({ params: { model: 'a' } })).toBe(false)
    expect(isCostOnly({ prompt: 'x', get_cost: false })).toBe(false)
  })

  it('nearest listed ratio', () => {
    expect(nearestOf(['16:9', '9:16', '1:1'], '4:5')).toBe('1:1')
    expect(nearestOf(['16:9', '9:16'], '9:16')).toBe('9:16')
  })
})

describe('Claude usage (/usage)', () => {
  it('reads the session, the week and per-model limits', () => {
    const u = parseUsage(
      [
        'You are currently using your subscription to power your Claude Code usage',
        '',
        'Current session: 10% used · resets Oct 15 at 11:39pm (Asia/Seoul)',
        'Current week (all models): 72% used · resets Oct 17 at 3:59am (Asia/Seoul)',
        'Current week (Fable): 0% used · resets Oct 17 at 4am (Asia/Seoul)',
        '',
        'Last 24h · 3223 requests · 67 sessions',
      ].join('\n'),
    )
    expect(u.session).toEqual({ pct: 10, resets: '10/15 오후 11:39' })
    expect(u.week).toEqual({ pct: 72, resets: '10/17 오전 3:59' })
    expect(u.models).toEqual([{ name: 'Fable', pct: 0, resets: '10/17 오전 4:00' }])
  })

  it('a date without a time', () => {
    expect(koreanReset('Nov 1 (Asia/Seoul)')).toBe('11/1')
  })
})
