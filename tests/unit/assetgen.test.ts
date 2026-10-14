// 소재 생성: prompt assembly (designer's prompt kept as written), model language,
// aspect-ratio mapping, prompt helper replies, the SVG conversion worker.
import { mkdtempSync, existsSync, copyFileSync, readFileSync } from 'node:fs'
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
    expect(say('Write', { file_path: '/p/composition/x.html' }, '/p').detail).toBe('composition/x.html')
    expect(say('Write', { file_path: '/Users/me/Desktop/x.txt' }, '/p').detail).toBe('/Users/me/Desktop/x.txt')
  })
})
