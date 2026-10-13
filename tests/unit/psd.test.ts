import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePsdBuffer } from 'ag-psd'
import { afterAll, describe, expect, it } from 'vitest'
import { importPsd } from '../../src/main/psd'

const dir = mkdtempSync(join(tmpdir(), 'ms-psd-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const ffprobe = join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  return { width: w, height: h, data }
}

describe('PSD import', () => {
  const file = join(dir, '광고 시안.psd')
  writeFileSync(
    file,
    writePsdBuffer({
      width: 200,
      height: 120,
      imageData: solid(200, 120, [255, 255, 255, 255]),
      children: [
        { name: '로고', top: 10, left: 20, bottom: 50, right: 80, imageData: solid(60, 40, [255, 0, 0, 255]) },
        { name: '숨김 레이어', hidden: true, top: 0, left: 0, bottom: 10, right: 10, imageData: solid(10, 10, [0, 0, 0, 255]) },
        { name: '그룹', children: [{ name: '제품', top: 40, left: 100, bottom: 110, right: 180, imageData: solid(80, 70, [0, 0, 255, 255]) }] },
      ],
    } as never),
  )

  it('flattens to one PNG', async () => {
    const parts = await importPsd(file, dir, 'flat')
    expect(parts).toHaveLength(1)
    expect(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', parts[0].file], { encoding: 'utf8' }).trim()).toBe('200,120')
  })

  it('splits visible layers with their positions (groups flattened, hidden skipped)', async () => {
    const parts = await importPsd(file, dir, 'layers')
    expect(parts.map((p) => [p.name, p.left, p.top, p.width, p.height])).toEqual([
      ['로고', 20, 10, 60, 40],
      ['그룹/제품', 100, 40, 80, 70],
    ])
    expect(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', parts[1].file], { encoding: 'utf8' }).trim()).toBe('80,70')
  })
})
