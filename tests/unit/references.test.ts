import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dHash, hamming } from '../../src/main/references'

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
