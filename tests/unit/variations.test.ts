import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' } }))
const { adaptOverrides, methodFor, ratioLabel } = await import('../../src/main/variations')
const { emptyOverrides } = await import('@shared/overrides')

const base = { width: 1920, height: 1080, duration: 15 } as never
describe('variations', () => {
  it('picks the method from what changes', () => {
    expect(methodFor(base, { preset: 'shorts-9x16', width: 1080, height: 1920, duration: 15 })).toBe('claude')
    expect(methodFor(base, { preset: 'youtube-16x9', width: 1920, height: 1080, duration: 6, lengthMethod: 'retime' })).toBe('retime')
    expect(methodFor(base, { preset: 'youtube-16x9', width: 1920, height: 1080, duration: 6 })).toBe('claude')
    expect(methodFor(base, { preset: 'custom', width: 1280, height: 720, duration: 15 })).toBe('scale')
    expect(ratioLabel(1080, 1920)).toBe('9:16')
  })

  it('drops layout-specific edits on a re-layout but keeps typography choices', () => {
    const o = emptyOverrides()
    o.elements.title = { style: { fontFamily: 'Pretendard', fontSize: 120, letterSpacing: -4 }, transform: { x: 100 } }
    const out = adaptOverrides(o, { ...emptyOut(), width: 1920, height: 1080, duration: 15 }, { preset: 'shorts-9x16', width: 1080, height: 1920, duration: 15 }, 'claude')
    expect(out.elements.title.style).toEqual({ fontFamily: 'Pretendard', letterSpacing: -4 })
    expect(out.elements.title.transform).toBeUndefined()
  })

  it('speed-matches length and rescales music sections', () => {
    const o = emptyOverrides()
    o.bgm = [{ id: 'b', label: 'm', src: 'a.mp3', start: 0, end: 15, mediaStart: 0, volume: 1, fadeIn: 0, fadeOut: 1, loop: false }]
    const out = adaptOverrides(o, { ...emptyOut(), duration: 15 }, { preset: 'youtube-16x9', width: 1920, height: 1080, duration: 10 }, 'retime')
    expect(out.timeRemap).toEqual([{ from: 0, to: 15, speed: 1.5 }])
    expect(out.keepTotalDuration).toBe(false)
    expect(out.bgm[0].end).toBe(10)
  })
})

function emptyOut(): Parameters<typeof adaptOverrides>[1] {
  return { preset: 'youtube-16x9', width: 1920, height: 1080, fps: 29.97, duration: 15, format: 'mp4-h264', background: 'color', backgroundColor: '#000', quality: 'standard', audio: true, safeZone: 'youtube' }
}
