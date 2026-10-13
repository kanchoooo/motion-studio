import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@shared/api'

// Claude Code transcript lines for a message typed while Claude was working
const config = mkdtempSync(join(tmpdir(), 'ms-claude-'))
process.env.CLAUDE_CONFIG_DIR = config
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' } }))
const { TranscriptTail } = await import('../../src/main/agent/transcript')

const sid = '11111111-2222-3333-4444-555555555555'
const dir = join(config, 'projects', '-proj')
mkdirSync(dir, { recursive: true })
const file = join(dir, `${sid}.jsonl`)
writeFileSync(file, '')
const line = (o: object) => appendFileSync(file, JSON.stringify(o) + '\n')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const added: ChatItem[] = []
const updated: ChatItem[] = []
const tail = new TranscriptTail(sid, mkdtempSync(join(tmpdir(), 'ms-proj-')), {
  item: (i) => added.push(i),
  update: (i) => updated.push(i),
  busy: () => {},
  turnEnd: () => {},
  remoteUrl: () => {},
})
tail.start()
afterAll(() => tail.stop())

describe('messages typed while Claude works', () => {
  it('shows the message at once, marked as waiting', async () => {
    line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-13T10:00:00.000Z', content: '타이틀 색 더 진하게' })
    await wait(900)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ role: 'user', text: '타이틀 색 더 진하게', queued: true })
  })

  it('marks it delivered when Claude takes it mid-turn, without a second copy', async () => {
    const a = { type: 'attachment', uuid: 'u1', timestamp: '2026-10-13T10:00:05.000Z', attachment: { type: 'queued_command', prompt: '타이틀 색 더 진하게', origin: { kind: 'human' } } }
    line(a)
    line({ ...a, uuid: 'u2' }) // Claude Code may repeat the attachment
    await wait(900)
    expect(added).toHaveLength(1)
    expect(updated.at(-1)).toMatchObject({ id: added[0].id, queued: false })
  })

  it('a queued message taken at the end of the turn is a normal prompt line', async () => {
    line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-13T10:01:00.000Z', content: '로고 키워줘' })
    await wait(900)
    line({ type: 'user', uuid: 'u3', timestamp: '2026-10-13T10:01:30.000Z', message: { role: 'user', content: '로고 키워줘' } })
    await wait(900)
    expect(added.filter((i) => i.role === 'user' && i.text === '로고 키워줘')).toHaveLength(1)
    expect(updated.at(-1)).toMatchObject({ text: '로고 키워줘', queued: false })
  })
})
