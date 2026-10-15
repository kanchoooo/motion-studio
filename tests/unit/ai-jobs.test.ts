// beta.3: a generation is followed by its job's status field to the full-size file the service's
// schema names (Higgsfield results[].id → job_status → rawUrl; Magnific creation.identifier →
// creations_wait → url), and the service's own reason is shown when it stops.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
const calls: { name: string; args: Record<string, unknown> }[] = []
let replies: unknown[] = []
vi.mock('../../src/main/ai/connect', () => ({
  callTool: async (_p: string, name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    return { structuredContent: replies.shift() }
  },
  listTools: async () => [],
}))
const { higgsfieldProblem, higgsfieldResult, magnificResult, pace } = await import('../../src/main/ai/jobs')
const sc = (o: unknown) => ({ structuredContent: o })

beforeEach(() => {
  calls.length = 0
  replies = []
  pace.scale = 0
})

describe('Higgsfield jobs', () => {
  const queued = {
    results: [{ id: 'job-1', status: 'queued', results: null, params: { prompt: 'a man running', medias: [{ role: 'image', url: 'https://cdn.example/input.png' }] }, author: { avatarUrl: 'https://cdn.example/avatar.png' } }],
  }

  it('follows the queued job to its full-size file (not the avatar, not the input)', async () => {
    replies = [{ generation: { id: 'job-1', status: 'in_progress' }, poll_after_seconds: 5 }, { generation: { id: 'job-1', status: 'completed', results: { rawUrl: 'https://cdn.example/out.png', minUrl: 'https://cdn.example/out-min.webp' } } }]
    expect(await higgsfieldResult(sc(queued), 5)).toBe('https://cdn.example/out.png')
    expect(calls).toEqual([
      { name: 'job_status', args: { jobId: 'job-1', sync: true } },
      { name: 'job_status', args: { jobId: 'job-1', sync: true } },
    ])
  })

  it('a job already done needs no polling, whatever the prompt says', async () => {
    expect(await higgsfieldResult(sc({ results: [{ id: 'j', status: 'completed', params: { prompt: 'pending, running' }, results: { rawUrl: 'https://cdn.example/v.mp4' } }] }), 5)).toBe('https://cdn.example/v.mp4')
    expect(calls).toEqual([])
  })

  it("says the service's reason", async () => {
    await expect(higgsfieldResult(sc({ error: 'Insufficient credits: 4.8 needed, 2.1 available' }), 5)).rejects.toThrow(/크레딧이 모자라요/)
    replies = [{ generation: { id: 'job-1', status: 'nsfw' } }]
    await expect(higgsfieldResult(sc(queued), 5)).rejects.toThrow(/부적절한 내용/)
    replies = [{ generation: { id: 'job-1', status: 'ip_detected' } }]
    await expect(higgsfieldResult(sc(queued), 5)).rejects.toThrow(/저작권/)
    await expect(higgsfieldResult(sc({ results: [] }), 5)).rejects.toThrow(/작업을 받지 않았어요/)
    expect(higgsfieldProblem({ results: [{ id: 'x' }] })).toBeNull()
  })

  it('stops after the rounds it was given', async () => {
    replies = [{ generation: { id: 'job-1', status: 'in_progress' } }, { generation: { id: 'job-1', status: 'in_progress' } }]
    await expect(higgsfieldResult(sc(queued), 2)).rejects.toThrow(/아직 만드는 중/)
  })
})

describe('Magnific creations', () => {
  const queued = { creation: { identifier: 'c-1', status: 'queued', webUrl: 'https://www.magnific.com/c-1', credits: 1 }, instruction: 'call creations_wait; in_progress entries get poll_after_seconds' }

  it('waits on the creation, then takes its url (not the thumbnail or web page)', async () => {
    replies = [
      { results: [{ identifier: 'c-1', status: 'processing', poll_after_seconds: 5 }], allTerminal: false },
      { results: [{ identifier: 'c-1', status: 'completed', results: { thumbnailUrl: 'https://cdn.example/t.jpg', url: 'https://cdn.example/full.png' } }], allTerminal: true },
    ]
    expect(await magnificResult(sc(queued), 5)).toBe('https://cdn.example/full.png')
    expect(calls.map((c) => c.name)).toEqual(['creations_wait', 'creations_wait'])
    expect(calls[0].args).toEqual({ identifiers: ['c-1'], timeoutSeconds: 25 })
  })

  it('asks creations_get when the wait has no url', async () => {
    replies = [{ results: [{ identifier: 'c-1', status: 'COMPLETED' }], allTerminal: true }, { previewUrl: 'https://cdn.example/p.jpg', url: 'https://cdn.example/full.mp4' }]
    expect(await magnificResult(sc({ creations: [{ identifier: 'c-1', status: 'queued' }] }), 5)).toBe('https://cdn.example/full.mp4')
    expect(calls[1]).toEqual({ name: 'creations_get', args: { creationIdentifier: 'c-1' } })
  })

  it("says the service's reason", async () => {
    replies = [{ results: [{ identifier: 'c-1', status: 'failed', failureReason: 'Content policy violation' }], allTerminal: true }]
    await expect(magnificResult(sc(queued), 5)).rejects.toThrow(/Content policy violation/)
    await expect(magnificResult(sc({ partialFailure: 'model unavailable' }), 5)).rejects.toThrow(/model unavailable/)
  })
})
