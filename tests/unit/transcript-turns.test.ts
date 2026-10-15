import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@shared/api'

// When does a turn really end? A Stop hook may send Claude back, and a helper running in the
// background (the reviewer) wakes Claude later: the app must keep showing "작업 중" meanwhile.
const config = mkdtempSync(join(tmpdir(), 'ms-claude-'))
process.env.CLAUDE_CONFIG_DIR = config
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' } }))
const { TranscriptTail } = await import('../../src/main/agent/transcript')

const sid = '99999999-2222-3333-4444-555555555555'
const dir = join(config, 'projects', '-proj')
mkdirSync(dir, { recursive: true })
const file = join(dir, `${sid}.jsonl`)
writeFileSync(file, '')
const line = (o: object) => appendFileSync(file, JSON.stringify(o) + '\n')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const t = (s: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, s)).toISOString()
const say = (s: number, text: string, end = false) => line({ type: 'assistant', uuid: `a${s}`, timestamp: t(s), message: { content: [{ type: 'text', text }], stop_reason: end ? 'end_turn' : null } })

const added: ChatItem[] = []
const ends: string[] = []
let busy = false
const tail = new TranscriptTail(sid, mkdtempSync(join(tmpdir(), 'ms-proj-')), {
  item: (i) => added.push(i),
  update: () => {},
  busy: (b) => (busy = b),
  turnEnd: (last, how) => ends.push(`${how}:${last}`),
  remoteUrl: () => {},
})
tail.start()
afterAll(() => tail.stop())

describe('turn ends', () => {
  it('a Stop hook sending Claude back is not the end of the turn', async () => {
    line({ type: 'user', uuid: 'u1', timestamp: t(0), message: { role: 'user', content: '콘티를 승인했어요' } })
    say(1, '다 만들었어요.', true)
    await wait(700)
    line({ type: 'user', isMeta: true, timestamp: t(2), message: { role: 'user', content: 'Stop hook feedback:\nMotion Studio quality gate …' } })
    await wait(3200)
    expect(ends).toHaveLength(0)
    expect(busy).toBe(true)
    say(10, '검수까지 마치고 다듬었어요.', true)
    await wait(3400)
    expect(ends).toEqual(['done:검수까지 마치고 다듬었어요.'])
    expect(busy).toBe(false)
  }, 15000)

  it('waits for a helper that runs in the background, then ends after its turn', async () => {
    line({ type: 'user', uuid: 'u2', timestamp: t(20), message: { role: 'user', content: '고도화해줘' } })
    line({ type: 'assistant', uuid: 'a21', timestamp: t(21), message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'motion-studio-hyperframes:motion-reviewer' } }], stop_reason: null } })
    line({ type: 'user', timestamp: t(22), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a70f78a12566b9410 (internal ID)\nThe agent is working in the background.' }] }] } })
    say(23, '검수 결과를 기다리는 중이에요.', true)
    await wait(3400)
    expect(ends).toHaveLength(1) // still the first turn only
    expect(busy).toBe(true)
    line({ type: 'queue-operation', operation: 'enqueue', timestamp: t(60), content: '<task-notification>\n<task-id>a70f78a12566b9410</task-id>\n<status>completed</status>\n</task-notification>' })
    say(61, '검수 지적을 반영했어요.', true)
    await wait(3400)
    expect(ends.at(-1)).toBe('done:검수 지적을 반영했어요.')
    expect(busy).toBe(false)
  }, 15000)

  it('a synthetic line written on resume ("No response requested.") is no turn', async () => {
    const before = { ends: ends.length, added: added.length }
    line({ type: 'assistant', uuid: 'a65', timestamp: t(65), message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }], stop_reason: 'stop_sequence' } })
    await wait(900)
    expect(busy).toBe(false)
    expect(ends).toHaveLength(before.ends)
    expect(added).toHaveLength(before.added)
  })

  it('a short note in English is shown as a progress line, not as a message', async () => {
    say(70, 'Now the ghost text, the big 1+1 and the sheen attributes.')
    await wait(900)
    const last = added.at(-1)!
    expect(last.role).toBe('status')
  })
})
