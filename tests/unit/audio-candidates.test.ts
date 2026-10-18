import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 대화창에서 소리 후보가 재생되지 않던 문제: the previews are downloaded into the project and played
// from there; what is not a sound file is left out (and Claude is told)
const home = mkdtempSync(join(tmpdir(), 'ms-audiocand-'))
process.env.MS_PROJECTS_DIR = join(home, 'projects')
vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => home, getAppPath: () => process.cwd() } }))
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)])
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(100)])
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string) => {
  const u = String(url)
  if (u.endsWith('/song.mp3')) return new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  if (u.endsWith('/voice')) return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav' } })
  if (u.endsWith('/login.mp3')) return new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  if (u.endsWith('/fake.mp3')) return new Response(Buffer.from('not audio at all'), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  return new Response('nope', { status: 403 })
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

describe('sound candidates in the chat', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const projects = await import('../../src/main/projects')
  const { buildStudioServer } = await import('../../src/main/agent/tools')
  const { looksLikeAudio } = await import('../../src/main/ai/media')
  const p = await projects.createProject({ name: '소리', presetId: 'shorts-9x16', duration: 10 })
  const shown: { audio: unknown[]; voices: unknown[] } = { audio: [], voices: [] }
  const server = buildStudioServer(p.meta.id, { onStoryboard() {}, onAudioCandidates: (_id: string, l: unknown) => shown.audio.push(l), onGenerated() {}, onVoices: (_id: string, v: unknown) => shown.voices.push(v), onBuildStart() {} } as never)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text
  const comp = join(p.path, 'composition')

  it('knows a sound file by its first bytes', () => {
    expect(looksLikeAudio(mp3.subarray(0, 16))).toBe(true)
    expect(looksLikeAudio(wav.subarray(0, 16))).toBe(true)
    expect(looksLikeAudio(Buffer.from('<!doctype html>'))).toBe(false)
  })

  it('downloads each preview into the project; the ones that are not sound are left out and named', async () => {
    const r = await call('show_audio_candidates', {
      query: '밝은 음악',
      kind: 'bgm',
      source: 'mixkit',
      items: [
        { title: '좋은 곡', preview_url: 'https://x.test/song.mp3' },
        { title: '로그인 필요', preview_url: 'https://x.test/login.mp3' },
        { title: '가짜 파일', preview_url: 'https://x.test/fake.mp3' },
      ],
    })
    const list = shown.audio[0] as { items: { title: string; file?: string }[] }
    expect(list.items.map((x) => x.title)).toEqual(['좋은 곡'])
    expect(list.items[0].file).toMatch(/^assets\/candidates\/.+\.mp3$/)
    expect(readFileSync(join(comp, list.items[0].file!)).subarray(0, 3).toString()).toBe('ID3')
    expect(r).toMatch(/로그인 필요/)
    expect(r).toMatch(/가짜 파일/)
  })

  it('none playable: Claude is asked for other links, no card', async () => {
    const n = shown.audio.length
    const r = await call('show_audio_candidates', { query: 'x', kind: 'sfx', items: [{ title: '막힌 링크', preview_url: 'https://x.test/blocked.mp3' }] })
    expect(shown.audio.length).toBe(n)
    expect(r).toMatch(/None of the previews could be downloaded/)
    expect(await call('show_audio_candidates', { query: 'x', kind: 'sfx', items: [{ title: 'http', preview_url: 'http://x.test/song.mp3' }] })).toMatch(/https/)
  })

  it('a service voice is heard from a copy of its preview', async () => {
    await call('show_voice_candidates', { voices: [{ provider: 'magnific', id: 'v1', name: '지우', preview_url: 'https://x.test/voice' }, { provider: 'magnific', id: 'v2', name: '미리듣기 없음' }] })
    const v = (shown.voices[0] as { voices: { id: string; listen?: string }[] }).voices
    expect(v[0].listen).toMatch(/^assets\/candidates\/voice-v1-.+\.wav$/)
    expect(existsSync(join(comp, v[0].listen!))).toBe(true)
    expect(v[1].listen).toBeUndefined()
  })
})
