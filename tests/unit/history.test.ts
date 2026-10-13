import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as history from '../../src/main/history'

const dir = mkdtempSync(join(tmpdir(), 'ms-hist-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const write = (f: string, s: string) => {
  mkdirSync(join(dir, f, '..'), { recursive: true })
  writeFileSync(join(dir, f), s)
}

describe('history', () => {
  it('records only tracked files and skips no-op saves', async () => {
    write('brief.json', '{"v":1}')
    write('composition/index.html', '<h1>v1</h1>')
    write('composition/assets/big.mp4', 'x'.repeat(1000))
    write('renders/out.mp4', 'video')
    const first = await history.record(dir, { actor: 'app', summary: '처음' })
    expect(first).not.toBeNull()
    expect(await history.record(dir, { actor: 'designer', summary: '변경 없음' })).toBeNull()
    expect(history.isTracked('composition/assets/big.mp4')).toBe(false)
    expect(history.isTracked('renders/out.mp4')).toBe(false)
    expect(history.isTracked('composition/index.html')).toBe(true)
  })

  it('restores an older state as a new entry, and the restore can be undone', async () => {
    const v1 = (await history.list(dir))[0].id
    write('composition/index.html', '<h1>v2</h1>')
    write('composition/extra.css', 'h1{}')
    const v2 = await history.record(dir, { actor: 'claude', summary: 'Claude 수정' })
    expect(v2).not.toBeNull()

    await history.restore(dir, v1, '되돌리기: 처음')
    expect(readFileSync(join(dir, 'composition/index.html'), 'utf8')).toBe('<h1>v1</h1>')
    expect(existsSync(join(dir, 'composition/extra.css'))).toBe(false) // files added later are removed
    expect(existsSync(join(dir, 'composition/assets/big.mp4'))).toBe(true) // originals are never touched

    const list = await history.list(dir)
    expect(list[0].restoredFrom).toBe(v1)
    expect(list.map((e) => e.summary)).toContain('Claude 수정')

    await history.restore(dir, v2!.id, '되돌리기: Claude 수정')
    expect(readFileSync(join(dir, 'composition/index.html'), 'utf8')).toBe('<h1>v2</h1>')
  })

  it('stores named versions and stars', async () => {
    const v = await history.record(dir, { actor: 'designer', summary: '저장: 1차 시안', versionName: '1차 시안', force: true })
    history.setStar(dir, v!.id, true)
    const top = (await history.list(dir))[0]
    expect(top.versionName).toBe('1차 시안')
    expect(top.starred).toBe(true)
  })
})

describe('partial restore', () => {
  it('brings back only the chosen part', async () => {
    const d = mkdtempSync(join(tmpdir(), 'ms-part-'))
    const w = (f: string, s: string) => {
      mkdirSync(join(d, f, '..'), { recursive: true })
      writeFileSync(join(d, f), s)
    }
    w('brief.json', '{"b":1}')
    w('overrides.json', '{"o":1}')
    w('composition/index.html', 'v1')
    const first = (await history.record(d, { actor: 'app', summary: 'one' }))!
    w('brief.json', '{"b":2}')
    w('overrides.json', '{"o":2}')
    w('composition/index.html', 'v2')
    await history.record(d, { actor: 'claude', summary: 'two' })
    await history.restorePartial(d, first.id, 'overrides', '직접 수정값만')
    expect(readFileSync(join(d, 'overrides.json'), 'utf8')).toBe('{"o":1}')
    expect(readFileSync(join(d, 'composition/index.html'), 'utf8')).toBe('v2')
    expect(readFileSync(join(d, 'brief.json'), 'utf8')).toBe('{"b":2}')
    await history.restorePartial(d, first.id, 'composition', '영상만')
    expect(readFileSync(join(d, 'composition/index.html'), 'utf8')).toBe('v1')
    rmSync(d, { recursive: true, force: true })
  })
})
