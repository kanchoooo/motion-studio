// find_blocks / add_block through the studio MCP server, on a real (throwaway) project:
// matches come with pictures of their motion, and an install lands in composition/.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'ms-tools-'))
process.env.MS_PROJECTS_DIR = join(home, 'projects')
vi.mock('electron', () => ({ app: { getVersion: () => '0.3.1', isPackaged: false, getPath: () => home, getAppPath: () => process.cwd() } }))
const { registry } = await import('../../src/main/paths')
const haveCopy = existsSync(join(registry.dir(), 'mirror', 'registry', 'registry.json'))

describe.runIf(haveCopy)('registry tools', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const projects = await import('../../src/main/projects')
  const { buildStudioServer } = await import('../../src/main/agent/tools')
  const p = await projects.createProject({ name: '레지스트리', presetId: 'shorts-9x16', duration: 10 })
  const server = buildStudioServer(p.meta.id, { onStoryboard() {}, onAudioCandidates() {}, onGenerated() {}, onVoices() {}, onBuildStart() {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(b)
  type Part = { type: string; text?: string; data?: string }
  const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })).content as Part[])

  it('find_blocks lists matches with the video size and shows their pictures', async () => {
    const parts = await call('find_blocks', { query: 'light leak warm glow', limit: 4 })
    expect(parts[0].text).toMatch(/this video: 1080x1920/)
    expect(parts[0].text).toMatch(/^light-leak \(block · \d+x\d+/m)
    const images = parts.filter((x) => x.type === 'image')
    expect(images.length).toBeGreaterThan(0)
    expect(Buffer.from(images[0].data!, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8') // jpeg
    expect((await call('find_blocks', { query: 'zzqx nothing' }))[0].text).toMatch(/Nothing in the registry/)
  })

  it('add_block installs into composition/ and says how to wire it', async () => {
    const parts = await call('add_block', { name: 'grain-overlay' })
    expect(parts[0].text).toMatch(/Installed grain-overlay — a component/)
    expect(parts[0].text).toMatch(/compositions\/components\/grain-overlay\.html/)
    expect(readFileSync(join(p.path, 'composition', 'compositions', 'components', 'grain-overlay.html'), 'utf8').length).toBeGreaterThan(100)
    expect((await call('add_block', { name: 'no-such-thing' }))[0].text).toMatch(/No registry item/)
  })
})
