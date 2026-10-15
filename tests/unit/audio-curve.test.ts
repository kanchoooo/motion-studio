// A sound's volume over time (keyframes): the app writes the clip with its curve and the page plays
// that file from its start at full volume.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { emptyOverrides } from '../../src/shared/overrides'

vi.mock('electron', () => ({ app: { getVersion: () => '0.3.1', isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))

describe('volume curves', async () => {
  const { applyAudio, audioEnvelopes, volumeExpr } = await import('../../src/main/audio')
  const ffmpeg = join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  it('an ffmpeg expression: held before the first key and after the last, linear between', () => {
    expect(volumeExpr([{ t: 1, v: 1 }, { t: 2, v: 0 }])).toBe('if(lt(t,1),1,if(lt(t,2),1+(-1)*(t-1)/1,0))')
    expect(volumeExpr([{ t: 0, v: 0.5, e: 'hold' }, { t: 1, v: 1 }])).toBe('if(lt(t,0),0.5,if(lt(t,1),0.5,1))')
  })
  it('writes the clip with its curve and plays it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-curve-'))
    mkdirSync(join(dir, 'composition', 'assets'), { recursive: true })
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', join(dir, 'composition', 'assets', 'tone.wav')])
    const html = '<div data-composition-id="main" data-duration="5"><audio id="a1" data-ms-id="a1" data-ms-type="bgm" src="assets/tone.wav" data-start="1" data-duration="2" data-media-start="0.5" data-volume="0.8"></audio></div>'
    const o = { ...emptyOverrides(), audio: { a1: { volumeKeys: [{ t: 1, v: 1 }, { t: 2, v: 0 }] } } }
    const env = audioEnvelopes(dir, html, o)
    expect(env.a1).toMatch(/^assets\/\.ms-audio\/a1-[0-9a-f]{10}\.wav$/)
    expect(existsSync(join(dir, 'composition', env.a1))).toBe(true)
    const out = applyAudio(html, o, env)
    expect(out).toContain(`src="${env.a1}"`)
    expect(out).toContain('data-media-start="0"')
    expect(out).toContain('data-ms-original-media-start="0.5"')
    expect(out).toContain('data-volume="1"')
    // and taking the curve away gives the original back
    const back = applyAudio(out, { ...o, audio: {} }, {})
    expect(back).toContain('src="assets/tone.wav"')
    expect(back).toContain('data-media-start="0.5"')
  })
})
