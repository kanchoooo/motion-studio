import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dHash, hamming, youtubeError } from '../../src/main/references'

const dir = mkdtempSync(join(tmpdir(), 'ms-ref-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const ffmpeg = join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const img = (name: string, src: string) => {
  const f = join(dir, name)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', f])
  return f
}

describe('near-duplicate guard', () => {
  it('sees a re-encoded copy as identical and a different picture as different', async () => {
    const a = img('a.png', 'testsrc2=size=640x360')
    const copy = join(dir, 'copy.jpg')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', a, '-vf', 'scale=320:-2', '-q:v', '8', copy])
    const other = img('b.png', 'mandelbrot=size=640x360')
    const [ha, hc, hb] = await Promise.all([dHash(a), dHash(copy), dHash(other)])
    expect(hamming(ha, hc)).toBeLessThanOrEqual(6)
    expect(hamming(ha, hb)).toBeGreaterThan(12)
  })
})

describe('a YouTube download that failed says why', () => {
  it('names the usual reasons, else shows what yt-dlp said', () => {
    expect(youtubeError("[youtube] abc: Video does not pass filter (duration <= 600), skipping ..")).toBe('10분이 넘는 영상은 레퍼런스로 쓸 수 없어요.')
    expect(youtubeError("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser")).toMatch(/자동 접속으로 보고 막았어요/)
    expect(youtubeError('ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access')).toBe('비공개 영상이라 내려받을 수 없어요.')
    expect(youtubeError('ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader')).toMatch(/볼 수 없는 영상이에요/)
    expect(youtubeError('ERROR: [youtube] abc: Requested format is not available')).toBe('영상을 내려받지 못했어요. (Requested format is not available)')
    expect(youtubeError('')).toBe('영상을 내려받지 못했어요. 주소와 인터넷 연결을 확인해 주세요.')
  })
})
