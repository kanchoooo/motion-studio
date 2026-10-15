// The session's permission plumbing: no quality gates any more (Claude works as in plain
// Claude Code); the PreToolUse hook only passes the session's effort to the reviewer.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() }, shell: {}, BrowserWindow: class {} }))

describe('pretool hook (no gates: only the reviewer\'s effort)', async () => {
  const { handleHook, setPermissionHooks } = await import('../../src/main/agent/permissions')
  setPermissionHooks({ projectFor: () => 'p1', mode: () => 'ask', dirOf: () => tmpdir(), changed() {}, effortOf: () => 'xhigh' })
  const call = async (body: unknown) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
    let out = ''
    const res = { writeHead: () => res, end: (s: string) => ((out = s), res) } as unknown as ServerResponse
    expect(await handleHook(req, res, '/hook/abc123/pretool')).toBe(true)
    return JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string; updatedInput?: Record<string, unknown> } }
  }
  it('lets the first composition write through (no skill / recipe gate)', async () => {
    expect(await call({ tool_name: 'Write', session_id: 's', tool_input: { file_path: join(tmpdir(), 'composition', 'index.html'), content: '<html></html>' } })).toEqual({})
    expect(await call({ tool_name: 'Edit', session_id: 's', tool_input: { file_path: 'composition/index.html' } })).toEqual({})
  })
  it('gives the reviewer the session effort, leaves other agents alone', async () => {
    const r = await call({ tool_name: 'Agent', tool_input: { subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: 'x' } })
    expect(r.hookSpecificOutput?.permissionDecision).toBe('allow')
    expect(r.hookSpecificOutput?.updatedInput?.effort).toBe('xhigh')
    expect(await call({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'x' } })).toEqual({})
  })
})
