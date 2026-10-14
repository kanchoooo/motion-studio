// Variation re-layouts run side by side (each in its own Claude session), at most
// MAX_ADAPTING at once; the next one starts as soon as one finishes.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() } }))
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
const status = vi.hoisted(() => [] as [string, string][])
vi.mock('../../src/main/variations', () => ({ setFamilyStatus: (id: string, s: string) => status.push([id, s]) }))
const { SessionManager, MAX_ADAPTING } = await import('../../src/main/agent/pty-session')

describe('variation re-layouts', () => {
  it(`run ${MAX_ADAPTING} at once and start the next when one finishes`, async () => {
    const m = new SessionManager(() => {})
    const sent: string[] = []
    // a send that is still being typed counts as running
    ;(m as unknown as { send: (i: { projectId: string }) => Promise<void> }).send = async (i) => {
      sent.push(i.projectId)
    }
    m.enqueueAdaptations(['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((projectId) => ({ projectId, text: '다시 구성해 주세요' })))
    await new Promise((r) => setTimeout(r, 10))
    expect(sent).toEqual(['v1', 'v2', 'v3', 'v4'])
    expect(['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((id) => m.isAdapting(id))).toEqual([true, true, true, true, true, true])
    // v2 finishes its turn: v5 starts
    await (m as unknown as { onTurnEnd(l: { projectId: string }, t: string, how: string): Promise<void> }).onTurnEnd({ projectId: 'v2' }, '', 'done')
    await new Promise((r) => setTimeout(r, 600))
    expect(sent).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
    expect(m.isAdapting('v2')).toBe(false)
    expect(status).toContainEqual(['v2', 'done'])
  })
})
