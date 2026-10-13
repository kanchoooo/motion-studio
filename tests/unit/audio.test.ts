import { describe, expect, it } from 'vitest'
import { applyAudio, parseAudio } from '../../src/main/audio'
import { emptyOverrides } from '@shared/overrides'

const html = `<body><div id="root" data-composition-id="main" data-start="0" data-duration="8">
<audio data-ms-id="sfx-whoosh-1" data-ms-type="sfx" data-ms-sfx="whoosh" data-ms-label="휙 · 전환" src="assets/sfx/whoosh.wav" data-start="1.80" data-duration="0.70" data-volume="0.8"></audio>
<audio data-ms-id="sfx-whoosh-2" data-ms-type="sfx" data-ms-sfx="whoosh" data-ms-label="휙 · 엔드카드" src="assets/sfx/whoosh.wav" data-start="5.20" data-duration="0.70"></audio>
<audio data-ms-id="sfx-pop-1" data-ms-type="sfx" data-ms-sfx="pop" data-ms-label="팝" src="assets/sfx/pop.wav" data-start="0.5"></audio>
</div></body>`

describe('audio', () => {
  it('parses Claude-placed audio', () => {
    const a = parseAudio(html)
    expect(a.map((x) => x.id)).toEqual(['sfx-whoosh-1', 'sfx-whoosh-2', 'sfx-pop-1'])
    expect(a[0]).toMatchObject({ kind: 'sfx', group: 'whoosh', start: 1.8, volume: 0.8 })
  })

  it('replaces a whole effect group, then a single element wins over the group', () => {
    const o = emptyOverrides()
    o.sfxGroups.whoosh = { src: 'assets/my-whoosh.wav' }
    o.audio['sfx-whoosh-2'] = { src: 'assets/special.wav', volume: 0.5 }
    const a = parseAudio(applyAudio(html, o))
    expect(a.find((x) => x.id === 'sfx-whoosh-1')!.src).toBe('assets/my-whoosh.wav')
    expect(a.find((x) => x.id === 'sfx-whoosh-2')!.src).toBe('assets/special.wav')
    expect(a.find((x) => x.id === 'sfx-whoosh-2')!.volume).toBe(0.5)
    expect(a.find((x) => x.id === 'sfx-pop-1')!.src).toBe('assets/sfx/pop.wav')
    expect(a.find((x) => x.id === 'sfx-whoosh-1')!.originalSrc).toBe('assets/sfx/whoosh.wav')
  })

  it('is idempotent and reverts cleanly when edits are removed', () => {
    const o = emptyOverrides()
    o.sfxGroups.whoosh = { src: 'assets/my-whoosh.wav' }
    o.audio['sfx-pop-1'] = { muted: true, start: 0.9 }
    const once = applyAudio(html, o)
    expect(applyAudio(once, o)).toBe(once)
    const back = applyAudio(once, emptyOverrides())
    expect(parseAudio(back).map((x) => x.src)).toEqual(parseAudio(html).map((x) => x.src))
    expect(back).not.toContain('data-ms-original-src')
    expect(parseAudio(once).find((x) => x.id === 'sfx-pop-1')).toMatchObject({ volume: 0, start: 0.9 })
  })

  it('writes designer BGM tracks into a managed block inside the root', () => {
    const o = emptyOverrides()
    o.bgm = [
      { id: 'bgm-a', label: '메인 BGM', src: 'assets/music.mp3', start: 0, end: 6, mediaStart: 12, volume: 0.6, fadeIn: 0.5, fadeOut: 1, loop: false },
      { id: 'bgm-b', label: '엔딩', src: 'assets/end.mp3', start: 6, end: 8, mediaStart: 0, volume: 0.8, fadeIn: 0, fadeOut: 0.5, loop: true },
    ]
    const out = applyAudio(html, o)
    const bgm = parseAudio(out).filter((x) => x.kind === 'bgm')
    expect(bgm.map((x) => [x.id, x.start, x.duration, x.managed])).toEqual([
      ['bgm-a', 0, 6, true],
      ['bgm-b', 6, 2, true],
    ])
    expect(out).toContain('data-media-start="12.000"')
    // media without an id is silent in renders
    for (const tag of out.match(/<audio\b[^>]*>/g)!) expect(tag).toMatch(/\sid="/)
    expect(out.indexOf('ms:bgm:start')).toBeGreaterThan(out.indexOf('data-composition-id'))
    // re-applying replaces the block instead of duplicating it
    expect(applyAudio(out, o).match(/ms:bgm:start/g)!.length).toBe(1)
    expect(applyAudio(out, emptyOverrides())).not.toContain('ms:bgm:start')
  })
})

describe('length with section speed', () => {
  it('writes the output length statically and restores it when the speed change is removed', async () => {
    const { applyLength } = await import('../../src/main/audio')
    const { emptyOverrides } = await import('@shared/overrides')
    const page = '<div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="1920" data-height="1080"></div>'
    const o = emptyOverrides()
    o.timeRemap = [{ from: 0, to: 8, speed: 8 / 6 }]
    o.keepTotalDuration = false
    const fast = applyLength(page, o)
    expect(fast).toContain('data-duration="6"')
    expect(fast).toContain('data-ms-authored-duration="8"')
    expect(applyLength(fast, o)).toBe(fast)
    expect(applyLength(fast, emptyOverrides())).toBe(page)
  })
})
