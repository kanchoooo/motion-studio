// 소재 생성: prompt assembly (designer's prompt kept as written), model language,
// aspect-ratio mapping, prompt helper replies, the SVG conversion worker.
import { mkdtempSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { buildPrompt, defaultPromptLang } from '../../src/shared/assetGen'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() }, shell: {}, BrowserWindow: class {} }))

describe('prompt', () => {
  const mine = '초록 야구모자를 쓴   소년,\n주황 후드티 '
  it('sends the designer\'s prompt exactly as typed after the style and framing', () => {
    const p = buildPrompt('flat-character', 'bust', 'en', mine)
    expect(p.endsWith(mine)).toBe(true)
    expect(p).toContain('Flat 2D vector illustration')
    expect(p).toContain('FRAMING: Bust shot')
    expect(p.indexOf('FRAMING')).toBeLessThan(p.indexOf(mine))
  })
  it('adds no framing for 자동 and nothing at all without a style', () => {
    expect(buildPrompt('flat-character', 'auto', 'zh', mine)).not.toContain('构图：')
    expect(buildPrompt('flat-character', 'full', 'zh', mine)).toContain('构图：从头到脚')
    expect(buildPrompt('none', 'full', 'ko', mine)).toBe(mine)
  })
  it('picks a language from the model name', () => {
    expect(defaultPromptLang('seedream-4')).toBe('zh')
    expect(defaultPromptLang('Hunyuan Image 3')).toBe('zh')
    expect(defaultPromptLang('gpt-image-2 · OpenAI')).toBe('ko')
    expect(defaultPromptLang('nano-banana-pro')).toBe('ko')
    expect(defaultPromptLang('flux-pro-1.1')).toBe('en')
  })
})

describe('generation arguments', () => {
  it('maps a ratio onto the tool\'s own enum', async () => {
    const { pickRatio } = await import('../../src/main/ai/generate')
    const e = { enum: ['square_1_1', 'classic_4_3', 'traditional_3_4', 'widescreen_16_9', 'social_story_9_16'] }
    expect(pickRatio(e, '3:4')).toBe('traditional_3_4')
    expect(pickRatio(e, '9:16')).toBe('social_story_9_16')
    expect(pickRatio({ enum: ['1:1', '3:4', '16:9'] }, '4:3')).toBe('16:9')
    expect(pickRatio({ type: 'string' }, '3:4')).toBe('3:4')
  })
})

describe('prompt helper', () => {
  it('splits the prompt from the note', async () => {
    const { parseHelperReply } = await import('../../src/main/ai/promptHelper')
    const r = parseHelperReply('[프롬프트]\nA cute boy in a green cap.\nBackground: solid warm yellow.\n[메모]\n표정은 모션에서 만들어요.')
    expect(r.prompt).toBe('A cute boy in a green cap.\nBackground: solid warm yellow.')
    expect(r.memo).toBe('표정은 모션에서 만들어요.')
    expect(parseHelperReply('어떤 언어로 만들까요?').prompt).toBeUndefined()
  })
})

describe('conversion worker', () => {
  it('writes the SVG, shape list, shape sheet and comparison next to the image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-char-'))
    const sharp = (await import('sharp')).default
    await sharp(join(__dirname, '..', 'fixtures', 'character', 'man', 'source.webp')).png().toFile(join(dir, 'source.png'))
    const r = await new Promise<{ ok: boolean; shapes: number; badPct: number; background: boolean }>((resolve, reject) => {
      const w = new Worker(join(__dirname, '..', '..', 'src', 'main', 'character', 'img2svg', 'worker.cjs'), {
        workerData: { input: join(dir, 'source.png'), outDir: dir, opts: { colors: 14, bg: 'auto', thin: 1.6, maxSide: 1600 } },
      })
      w.once('message', resolve)
      w.once('error', reject)
    })
    expect(r.ok).toBe(true)
    expect(r.shapes).toBeLessThan(60)
    expect(r.badPct).toBeLessThan(1)
    expect(r.background).toBe(true)
    for (const f of ['vector.svg', 'vector_shapes.json', 'vector_shapes.png', 'vector_compare.png']) expect(existsSync(join(dir, f))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'vector_shapes.json'), 'utf8')).shapes.length).toBe(r.shapes)
    void copyFileSync
  }, 60_000)
})

describe('permission questions', () => {
  it('describes what Claude wants to do in the designer\'s words', async () => {
    const { describe: say } = await import('../../src/main/agent/permissions')
    expect(say('Bash', { command: 'ffprobe -i a.mp4', description: '영상 길이 확인' }, '/p')).toMatchObject({ title: '명령 실행 · 영상 길이 확인', detail: 'ffprobe -i a.mp4', key: 'Bash:ffprobe' })
    expect(say('WebFetch', { url: 'https://example.com/a' }, '/p')).toMatchObject({ title: '웹 페이지 읽기', key: 'WebFetch:example.com' })
    // shown with the computer's own separator (composition\\x.html on Windows)
    expect(say('Write', { file_path: join('/p', 'composition', 'x.html') }, '/p').detail).toBe(join('composition', 'x.html'))
    expect(say('Write', { file_path: '/Users/me/Desktop/x.txt' }, '/p').detail).toBe('/Users/me/Desktop/x.txt')
  })
})

describe('video arguments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-vid-'))
  const a = join(dir, 'a.png')
  const b = join(dir, 'b.png')
  // any bytes: base64 inputs are not decoded here
  writeFileSync(a, Buffer.from('frame-a'))
  writeFileSync(b, Buffer.from('frame-b'))
  const req = { provider: 'higgsfield' as const, model: 'kling3_0', lang: 'en' as const, prompt: 'slow push in', ratio: '9:16' as const, duration: 8 }
  it('puts both frames into Higgsfield medias with roles', async () => {
    const { videoArguments } = await import('../../src/main/ai/generateVideo')
    const tools = [{ name: 'generate_video', inputSchema: { properties: { params: { type: 'object', properties: { model: {}, prompt: {}, aspect_ratio: { enum: ['16:9', '9:16', '1:1'] }, duration: { type: 'integer', enum: [5, 10] }, medias: { type: 'array', items: { description: 'base64 image', properties: { role: {}, value: {} } } } } } } } }]
    const { tool, args } = await videoArguments(req, { start: a, end: b }, tools)
    expect(tool).toBe('generate_video')
    const p = args.params as Record<string, unknown>
    expect(p.model).toBe('kling3_0')
    expect(p.aspect_ratio).toBe('9:16')
    expect(p.duration).toBe(10)
    expect((p.medias as { role: string }[]).map((m) => m.role)).toEqual(['start_image', 'end_image'])
    expect(typeof (p.medias as { value: string }[])[0].value).toBe('string')
  })
  it('uses Magnific-style first/last keys and the slug', async () => {
    const { videoArguments } = await import('../../src/main/ai/generateVideo')
    const tools = [{ name: 'video_generate', inputSchema: { properties: { prompt: {}, slug: {}, aspectRatio: { enum: ['widescreen_16_9', 'social_story_9_16'] }, duration: { type: 'string', enum: ['5', '10'] }, firstFrameImage: { description: 'base64' }, lastFrameImage: { description: 'base64' } } } }]
    const { args } = await videoArguments({ ...req, provider: 'magnific', model: 'kling-v3', duration: 5 }, { start: a, end: b }, tools)
    expect(args.slug).toBe('kling-v3')
    expect(args.aspectRatio).toBe('social_story_9_16')
    expect(args.duration).toBe('5')
    expect(typeof args.firstFrameImage).toBe('string')
    expect(typeof args.lastFrameImage).toBe('string')
  })
  it('uses Magnific keyframes {start,end} with image urls', async () => {
    const { videoArguments } = await import('../../src/main/ai/generateVideo')
    const frame = { type: 'object', properties: { type: {}, url: { description: 'image url or base64 data' } } }
    const tools = [{ name: 'video_generate', inputSchema: { properties: { prompt: {}, slug: {}, keyframes: { type: 'object', properties: { start: frame, end: frame } } } } }]
    const { args } = await videoArguments({ ...req, provider: 'magnific', model: 'kling-v3' }, { start: a, end: b }, tools)
    const k = args.keyframes as Record<string, { type: string; url: string }>
    expect(k.start.type).toBe('image')
    expect(typeof k.end.url).toBe('string')
  })
  it('says so when the model takes no last frame', async () => {
    const { videoArguments } = await import('../../src/main/ai/generateVideo')
    const tools = [{ name: 'video_generate', inputSchema: { properties: { prompt: {}, slug: {}, image: { description: 'base64' } } } }]
    await expect(videoArguments({ ...req, provider: 'magnific' }, { start: a, end: b }, tools)).rejects.toThrow(/끝 프레임/)
    const { args } = await videoArguments({ ...req, provider: 'magnific' }, { start: a }, tools)
    expect(typeof args.image).toBe('string')
  })
})

describe('styles and kinds', () => {
  it('puts the look and the kind before the designer\'s prompt', async () => {
    const { buildPrompt } = await import('../../src/shared/assetGen')
    const p = buildPrompt('clay', 'bust', 'ko', '빨간 모자 소년', 'character')
    expect(p.startsWith('스타일: 클레이')).toBe(true)
    expect(p).toContain('주인공: 인물·캐릭터 한 명만')
    expect(p).toContain('구도: 흉상')
    expect(p.endsWith('빨간 모자 소년')).toBe(true)
    expect(buildPrompt('photo', 'bust', 'en', 'x', 'background')).not.toContain('FRAMING')
    expect(buildPrompt('none', 'auto', 'en', 'x', 'object')).toContain('SUBJECT: One object')
  })
  it('has every look and kind in all three languages', async () => {
    const { LOOK_TEXT, KIND_TEXT, LOOK_LABELS } = await import('../../src/shared/genStyles')
    for (const t of [...Object.values(LOOK_TEXT), ...Object.values(KIND_TEXT)]) for (const l of ['en', 'zh', 'ko'] as const) expect(t[l].length).toBeGreaterThan(40)
    expect(Object.keys(LOOK_TEXT).sort()).toEqual(Object.keys(LOOK_LABELS).sort())
  })
})

describe('web collection', () => {
  it('reads the JSON block and keeps only usable items', async () => {
    const { parseCollect } = await import('../../src/main/ai/webCollect')
    const text = 'blah\n```json\n' + JSON.stringify({
      summary: '모션커피는 …',
      items: [
        { type: 'logo', title: '로고', url: 'https://example.com/logo.svg', source: 'https://example.com' },
        { type: 'image', title: '가짜', url: 'http://example.com/a.png' },
        { type: 'color', title: '브라운', hex: '#6f4e37', source: 'https://example.com/brand' },
        { type: 'color', title: '잘못', hex: 'brown' },
        { type: 'copy', title: '슬로건', text: '줄 서지 말고, 톡 주문', source: 'javascript:alert(1)' },
        { type: 'fact', title: '', text: '' },
        { type: 'video', title: '?', url: 'https://example.com/v.mp4' },
      ],
    }) + '\n```'
    const r = parseCollect(text)
    expect(r.summary).toBe('모션커피는 …')
    expect(r.items.map((x) => x.type)).toEqual(['logo', 'color', 'copy'])
    expect(r.items[1].hex).toBe('#6F4E37')
    expect(r.items[2].source).toBeUndefined()
    expect(() => parseCollect('no json here')).toThrow(/읽지 못했어요/)
  })
})
