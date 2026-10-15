// Claude and the designer's After Effects–style edits, through the studio MCP server:
// get_designer_edits lists the locked layers and everything else; clear_designer_edits hands
// unlocked layers back to Claude (layers / copies the designer added go away) and refuses
// locked ones; check_video flags a locked layer that disappeared.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'ms-dtools-'))
process.env.MS_PROJECTS_DIR = join(home, 'projects')
vi.mock('electron', () => ({ app: { getVersion: () => '0.3.1', isPackaged: false, getPath: () => home, getAppPath: () => process.cwd() } }))

describe('designer edits for Claude', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const projects = await import('../../src/main/projects')
  const { buildStudioServer } = await import('../../src/main/agent/tools')
  const { staticFindings } = await import('../../src/main/checks')
  const p = await projects.createProject({ name: '잠금', presetId: 'shorts-9x16', duration: 10 })
  // a composition with three layers of Claude's
  const index = join(p.path, 'composition', 'index.html')
  writeFileSync(index, readFileSync(index, 'utf8').replace(/<div id="root"([^>]*)data-ms-empty="true"><\/div>/, '<div id="root"$1><div data-ms-id="logo" data-ms-label="로고"></div><div data-ms-id="title" data-ms-label="제목"></div><div data-ms-id="cta" data-ms-label="버튼"></div></div>'))
  const o = structuredClone(p.overrides)
  o.elements = { logo: { locked: true, transform: { x: 10 } }, title: { transform: { y: 40 }, keys: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } }, Lmine: { style: { fill: '#ff0000' } } }
  o.layers = [{ id: 'Lmine', kind: 'shape', label: '내 도형', x: 0, y: 0, w: 100, h: 100 }]
  o.duplicates = [{ id: 'Dcopy', of: 'cta' }]
  await projects.saveOverrides(p.meta.id, o, '준비')
  const server = buildStudioServer(p.meta.id, { onStoryboard() {}, onAudioCandidates() {}, onGenerated() {}, onVoices() {}, onBuildStart() {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text

  it('get_designer_edits names the locked layers and the rest of the edits', async () => {
    const r = JSON.parse(await call('get_designer_edits'))
    expect(r.locked).toEqual([{ id: 'logo' }])
    expect(r.edits.title.keyframes).toEqual(['opacity: 2 keys'])
    expect(r.designerLayers[0]).toMatchObject({ id: 'Lmine', kind: 'shape' })
    expect(r.duplicates).toEqual([{ id: 'Dcopy', of: 'cta' }])
    expect(r.rules.join(' ')).toMatch(/LOCKED layers/)
  })

  it("update_designer_edits changes the designer's values instead of clearing them, refuses locked ones", async () => {
    const r = await call('update_designer_edits', { id: 'title', patch: { transform: { y: 80 }, own: { rotation: [{ t: 0, v: 0 }, { t: 1, v: 45 }] } }, reason: '제목 내리기' })
    expect(r).toMatch(/Updated/)
    const t = projects.state(p.meta.id).overrides.elements.title
    expect(t.transform).toEqual({ y: 80 })
    expect(t.keys?.opacity).toHaveLength(2)
    expect(t.own?.rotation).toHaveLength(2)
    expect(await call('update_designer_edits', { id: 'logo', patch: { transform: { x: 0 } }, reason: 'x' })).toMatch(/Refused/)
    // a layer the designer added: its text changes too
    await call('update_designer_edits', { id: 'Lmine', layer: { w: 240 }, patch: { keys: { opacity: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] } }, reason: '등장 모션' })
    const o = projects.state(p.meta.id).overrides
    expect(o.layers[0].w).toBe(240)
    expect(o.elements.Lmine.keys?.opacity).toHaveLength(2)
  })

  it('clear_designer_edits with props hands back only those properties', async () => {
    const r = await call('clear_designer_edits', { ids: ['title'], props: ['rotation', 'y'], reason: '회전은 다시 코드로' })
    expect(r).toMatch(/Cleared rotation, y on title/)
    const t = projects.state(p.meta.id).overrides.elements.title
    expect(t.own?.rotation).toBeUndefined()
    expect(t.transform?.y).toBeUndefined()
    expect(t.keys?.opacity).toHaveLength(2)
  })

  it('clear_designer_edits hands layers back, refuses locked ones', async () => {
    const r = await call('clear_designer_edits', { ids: ['logo', 'title', 'Lmine', 'Dcopy'], reason: '제목을 다시 잡으려고' })
    expect(r).toMatch(/Cleared: title, Lmine, Dcopy/)
    expect(r).toMatch(/Refused \(locked by the designer\): logo/)
    const after = projects.state(p.meta.id).overrides
    expect(Object.keys(after.elements)).toEqual(['logo'])
    expect(after.layers).toEqual([])
    expect(after.duplicates).toEqual([])
    // the managed block goes with the layer
    expect(readFileSync(index, 'utf8')).not.toContain('Lmine')
  })

  it('check_video: a locked layer that disappeared is an error', () => {
    const html = readFileSync(index, 'utf8').replace(/<div data-ms-id="logo"[^>]*><\/div>/, '')
    const findings = staticFindings(html, projects.state(p.meta.id).brief, projects.state(p.meta.id).overrides, [])
    expect(findings.some((f) => f.code === 'ms_locked_removed' && f.elementId === 'logo')).toBe(true)
  })
})
