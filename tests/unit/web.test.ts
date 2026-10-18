import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 관제용 판's web connection: what can be checked without the app (the rest: tests/e2e/web-flow.mjs)
const root = mkdtempSync(join(tmpdir(), 'ms-web-'))
vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => join(root, 'userdata'), getAppPath: () => process.cwd() }, shell: {} }))
const { safeUploadName } = await import('../../src/main/web')
const { marksSvg } = await import('../../src/main/web-frame')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('web connection', () => {
  it('an uploaded file keeps only its own name', () => {
    expect(safeUploadName('../../밖으로.txt')).toBe('밖으로.txt')
    expect(safeUploadName('C:\\Users\\x\\사진.png')).toBe('사진.png')
    expect(safeUploadName('..')).toBe('file')
    expect(safeUploadName('.env')).toBe('env')
    expect(safeUploadName(null)).toBe('file')
    expect(safeUploadName('a\u0000b:c.mp4')).toBe('a_b_c.mp4')
    const long = safeUploadName(`${'가'.repeat(300)}.mp4`)
    expect(long.length).toBeLessThanOrEqual(180)
    expect(long.endsWith('.mp4')).toBe(true)
    // macOS hands over decomposed Korean: stored composed
    expect(safeUploadName('사진.png'.normalize('NFD'))).toBe('사진.png')
  })

  it('the marks are drawn onto the frame (a box, a pin, a line)', async () => {
    const marks = [
      { id: 'a', n: 1, kind: 'box' as const, rect: { x: 100, y: 100, w: 300, h: 200 }, time: 1, note: '', elements: [], resolved: false },
      { id: 'b', n: 2, kind: 'pin' as const, rect: { x: 1500, y: 800, w: 0, h: 0 }, time: 1, note: '', elements: [], resolved: false },
      { id: 'c', n: 3, kind: 'pen' as const, points: [{ x: 600, y: 600 }, { x: 900, y: 700 }], time: 1, note: '<&>', elements: [], resolved: false },
    ]
    const svg = marksSvg(marks, 1920, 1080)
    expect(svg).toContain('<rect')
    expect(svg).toContain('<polyline')
    const frame = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#000' } }).png().toBuffer()
    const out = await sharp(frame).composite([{ input: Buffer.from(svg) }]).raw().toBuffer({ resolveWithObject: true })
    // the box's top edge is pink where the frame was black
    const at = (x: number, y: number) => out.data.subarray((y * out.info.width + x) * out.info.channels, (y * out.info.width + x) * out.info.channels + 3)
    expect(at(250, 100)[0]).toBeGreaterThan(200)
    expect(at(1000, 300)[0]).toBe(0)
  })
})
