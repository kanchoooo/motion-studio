// beta.4: Claude sets the output spec the designer agreed in the conversation (set_output), and
// a voice card can hold open-source voices Claude ran on this Mac (provider "local" + sample).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'ms-outvoice-'))
process.env.MS_PROJECTS_DIR = join(home, 'projects')
vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => home, getAppPath: () => process.cwd() } }))

describe('set_output and local voices', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const projects = await import('../../src/main/projects')
  const { buildStudioServer } = await import('../../src/main/agent/tools')
  const { STUDIO_PROMPT } = await import('../../src/main/agent/prompt')
  const p = await projects.createProject({ name: '길이', presetId: 'shorts-9x16', duration: 8 })
  const notices: string[] = []
  const cards: unknown[] = []
  const server = buildStudioServer(p.meta.id, { onStoryboard() {}, onAudioCandidates() {}, onGenerated() {}, onVoices: (_id, c) => cards.push(c), onBuildStart() {}, onNotice: (_id, t) => notices.push(t) })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text

  it('the prompt asks before following a length that differs from the app', () => {
    expect(STUDIO_PROMPT).toMatch(/ask which one they want/)
    expect(STUDIO_PROMPT).toMatch(/set_output/)
  })

  it('changes the length the designer agreed to, and says so in the chat', async () => {
    const r = await call('set_output', { duration: 15, agreed: '15초로 할게요' })
    expect(r).toMatch(/8s → 15s|길이 8초 → 15초/)
    expect(projects.state(p.meta.id).brief.output.duration).toBe(15)
    expect(notices.at(-1)).toBe('대화에서 정한 대로 출력 사양을 바꿨어요: 길이 8초 → 15초')
  })

  it('fps from the offered list, size as a pair (a preset when it is one)', async () => {
    expect(await call('set_output', { fps: 27, agreed: 'x' })).toMatch(/not offered/)
    await call('set_output', { fps: 29.97, width: 1920, height: 1080, agreed: '가로로요' })
    const o = projects.state(p.meta.id).brief.output
    expect([o.fps, o.width, o.height]).toEqual([29.97, 1920, 1080])
    expect(o.preset).not.toBe('custom')
    expect(await call('set_output', { width: 1000, agreed: 'x' })).toMatch(/together/)
    expect(await call('set_output', { width: 1001, height: 1000, agreed: 'x' })).toMatch(/even/)
  })

  it('a local voice needs its sample in the composition', async () => {
    const voice = { provider: 'local', id: 'supertonic-F1', name: '수퍼토닉 여성 1', engine: 'Supertonic 3 · OpenRAIL-M' }
    expect(await call('show_voice_candidates', { voices: [{ ...voice, sample: 'assets/generated/none.wav' }] })).toMatch(/needs sample/)
    mkdirSync(join(p.path, 'composition', 'assets', 'generated'), { recursive: true })
    writeFileSync(join(p.path, 'composition', 'assets', 'generated', 'voice-st-1.wav'), 'RIFF')
    expect(await call('show_voice_candidates', { voices: [{ ...voice, sample: 'assets/generated/voice-st-1.wav' }, { provider: 'magnific', id: '42', name: '서비스 목소리', preview_url: 'https://cdn.example/42.mp3' }] })).toMatch(/보여줬어요/)
    expect(cards.at(-1)).toMatchObject({ voices: [{ provider: 'local', sample: 'assets/generated/voice-st-1.wav', engine: 'Supertonic 3 · OpenRAIL-M' }, { provider: 'magnific', previewUrl: 'https://cdn.example/42.mp3' }] })
  })
})
