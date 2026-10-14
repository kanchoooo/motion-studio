// The reviewer agent thinks as hard as the session: the PreToolUse hook puts the
// effort set in the chat panel into every motion-reviewer dispatch.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() } }))
const { handleHook, setPermissionHooks } = await import('../../src/main/agent/permissions')

let effort: string | undefined = 'high'
setPermissionHooks({ projectFor: (t) => (t === 'abc' ? 'p1' : undefined), mode: () => 'ask', dirOf: () => '/tmp/none', changed: () => {}, effortOf: () => effort })

async function pretool(body: unknown): Promise<Record<string, any>> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  let out = ''
  const res = { writeHead: () => res, end: (s: string) => (out = s) } as unknown as ServerResponse
  await handleHook(req, res, '/hook/abc/pretool')
  return JSON.parse(out)
}

describe('reviewer effort', () => {
  const dispatch = (input: Record<string, unknown>) => pretool({ session_id: 's', tool_name: 'Agent', tool_input: input })
  it('gives the reviewer the session effort, replacing one Claude picked', async () => {
    const r = await dispatch({ subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: '검수해 주세요', description: '검수' })
    expect(r.hookSpecificOutput).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: '검수해 주세요', description: '검수', effort: 'high' } })
    effort = 'xhigh'
    const r2 = await dispatch({ subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: 'x', effort: 'low' })
    expect(r2.hookSpecificOutput.updatedInput.effort).toBe('xhigh')
  })
  it('leaves other agents and an unknown session alone', async () => {
    expect(await dispatch({ subagent_type: 'Explore', prompt: 'x' })).toEqual({})
    effort = undefined
    expect(await dispatch({ subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: 'x' })).toEqual({})
  })
})
