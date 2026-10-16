// beta.5 editing: a layer moved in time takes its own keys along; one layer order and a search for
// the layer list and ⌘↑/⌘↓; after 편집 활성화 every turn is checked (names for new things, a text
// split from its box, layers that went missing) — the verdict and the page-side audit.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { chromium } from 'playwright-core'
import { emptyOverrides, shiftElement } from '@shared/overrides'

vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => '/tmp' }, BrowserWindow: class {}, safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
const { AUDIT_SCRIPT, auditVerdict } = await import('../../src/main/tidy')
const { COMPOSITION_CONTRACT, NAME_NEW_REQUEST, splitRequest, STUDIO_PROMPT, TIDY_REQUEST } = await import('../../src/main/agent/prompt')
const { listedLayers, matchesLayer, neighbourLayer } = await import('@shared/layers')

describe('moving a layer in time', () => {
  it("moves Claude's motion (authored time) and the designer's own timed edits (output time)", () => {
    const e = shiftElement(
      {
        timing: { shift: 0.5 },
        keys: { opacity: [{ t: 1, v: 0 }, { t: 2, v: 1 }] },
        own: { y: [{ t: 0.2, v: 10 }] },
        textKeys: [{ t: 3, text: '둘' }],
        inPoint: 0.5,
        outPoint: 4,
        counter: { from: 0, to: 100, start: 1, duration: 1, decimals: 0, comma: true },
        textAnim: { preset: 'fade', start: 2, duration: 0.3, stagger: 0.05, by: 'char' } as never,
        parent: { id: 'p', at: 1.5 },
      },
      0.8,
      1,
    )
    expect(e.timing?.shift).toBe(1.3)
    expect(e.keys?.opacity?.map((k) => k.t)).toEqual([2, 3])
    expect(e.own?.y?.[0].t).toBe(1.2)
    expect(e.textKeys?.[0].t).toBe(4)
    expect([e.inPoint, e.outPoint]).toEqual([1.5, 5])
    expect(e.counter?.start).toBe(2)
    expect(e.textAnim?.start).toBe(3)
    expect(e.parent?.at).toBe(2.5)
  })

  it('a moved video starts later in the page the export reads (and back when the move is undone)', async () => {
    const { applyLength } = await import('../../src/main/audio')
    const page = '<div data-composition-id="main" data-duration="8"><video id="v" data-ms-id="clip" src="a.mp4" data-start="2" data-duration="3"></video></div>'
    const o = emptyOverrides()
    o.elements = { clip: { timing: { shift: 1.5 } } }
    const moved = applyLength(page, o)
    expect(moved).toContain('data-start="3.5000"')
    expect(moved).toContain('data-ms-authored-start="2"')
    expect(moved).toContain('data-ms-shift-baked="1.5"')
    expect(applyLength(moved, o)).toBe(moved)
    expect(applyLength(moved, emptyOverrides())).toBe(page.replace('data-start="2" data-duration="3"', 'data-start="2" data-duration="3"'))
    // with a section at another speed: the moved start goes through the section map
    o.timeRemap = [{ from: 0, to: 2, speed: 2 }]
    expect(applyLength(page, o)).toContain('data-start="2.5000"')
  })

  it('never before 0, and leaves what was not set alone', () => {
    const e = shiftElement({ keys: { x: [{ t: 0.3, v: 0 }] } }, -2, -2)
    expect(e.keys?.x?.[0].t).toBe(0)
    expect(e.timing?.shift).toBe(-2)
    expect('inPoint' in e || 'outPoint' in e || 'counter' in e).toBe(false)
  })
})

describe('one layer order, ⌘↑ / ⌘↓ and the search', () => {
  type L = { id: string; type: string; parent: string | null; stack: string; rank: number; text?: string }
  const el = (id: string, parent: string | null, rank: number, extra: Partial<L> = {}): L => ({ id, type: 'shape', parent, stack: parent ?? 'root', rank, ...extra })
  const els = [el('bg', null, 2), el('card', null, 1, { type: 'group' }), el('card-text', 'card', 0, { type: 'text', text: '지금 구매하기' }), el('card-box', 'card', 1), el('logo', null, 0, { type: 'image' })]

  it('stacking order: top first, a group with its layers under it', () => {
    expect(listedLayers(els).map((e) => e.id)).toEqual(['logo', 'card', 'card-text', 'card-box', 'bg'])
  })

  it('the layer below / above, wrapping, skipping locked ones', () => {
    expect(neighbourLayer(els, 'card', 1)).toBe('card-text')
    expect(neighbourLayer(els, 'logo', -1)).toBe('bg')
    expect(neighbourLayer(els, null, 1)).toBe('logo')
    expect(neighbourLayer(els, 'card', 1, (id) => id === 'card-text')).toBe('card-box')
  })

  it('finds a layer by its name, its text or its kind', () => {
    const [text] = els.filter((e) => e.id === 'card-text')
    expect(matchesLayer(text, '버튼 문구', '구매')).toBe(true)
    expect(matchesLayer(text, '버튼 문구', '버튼 글자')).toBe(true)
    expect(matchesLayer(text, '버튼 문구', '로고')).toBe(false)
  })
})

describe('after 편집 활성화: every turn is checked', () => {
  const audit = (over: Record<string, unknown> = {}) => ({ ids: ['title', 'cta', 'cta-bg'], named: 3, empty: false, unnamed: { count: 0, samples: [] }, boxedTexts: [], ...over }) as never
  const ov = () => {
    const o = emptyOverrides()
    o.elements = { title: { transform: { x: 10 } }, gone: { style: { color: '#fff' } }, locked: { locked: true, label: '로고' }, named: { label: '이름만' } }
    return o
  }
  const opts = { askedSplit: new Set<string>(), askedThisRequest: false, camera: '__camera' }

  it('a video that lost its layers goes back to view-only', () => {
    expect(auditVerdict(audit({ named: 0 }), ov(), opts).lost).toBe(true)
    expect(auditVerdict(audit({ empty: true }), ov(), opts).lost).toBe(true)
  })

  it("what only exists while the video plays is not 'gone' (copies, parts, the app's names in a group)", () => {
    const o = ov()
    o.elements = { 'card~0.1': { locked: true }, 'hero::arm': { transform: { rotate: 10 } }, Dcopy: { transform: { x: 1 } }, 'kid@Dcopy': { style: { color: '#000' } } }
    o.duplicates = [{ id: 'Dcopy', of: 'card' }]
    const v = auditVerdict(audit({ ids: ['card', 'hero'] }), o, opts)
    expect([v.gone, v.lockedGone]).toEqual([[], []])
  })

  it('edited and locked layers that went missing are named (a name alone is no edit)', () => {
    const v = auditVerdict(audit(), ov(), opts)
    expect(v.gone).toEqual(['gone'])
    expect(v.lockedGone).toEqual(['로고'])
  })

  it('new content without names: ask once per designer request, then only say so', () => {
    const a = audit({ unnamed: { count: 2, samples: ['새 문구', '색 상자'] } })
    expect(auditVerdict(a, ov(), opts)).toMatchObject({ ask: true, stillUnnamed: 0 })
    expect(auditVerdict(a, ov(), { ...opts, askedThisRequest: true })).toMatchObject({ ask: false, stillUnnamed: 2 })
  })

  it('a text with its own box is asked to be split once', () => {
    const a = audit({ boxedTexts: [{ id: 'badge', label: '배지' }] })
    expect(auditVerdict(a, ov(), opts)).toMatchObject({ ask: true, split: [{ id: 'badge', label: '배지' }] })
    expect(auditVerdict(a, ov(), { ...opts, askedSplit: new Set(['badge']) })).toMatchObject({ ask: false, split: [] })
  })

  it('what Claude is told', () => {
    expect(COMPOSITION_CONTRACT).toMatch(/Everything visible you add or rebuild gets those three attributes/)
    expect(COMPOSITION_CONTRACT).toMatch(/A text on a coloured box/)
    expect(TIDY_REQUEST).toMatch(/Only add attributes/)
    expect(TIDY_REQUEST).toMatch(/One exception: a text whose own element carries its coloured box/)
    expect(NAME_NEW_REQUEST).toMatch(/every existing id stays/)
    const r = splitRequest('cta', '구매 버튼', true)
    expect(r).toContain('"cta-bg"')
    expect(r).toContain('"cta-group"')
    expect(r).toContain('「구매 버튼」')
    expect(r).toMatch(/already edited this layer/)
    expect(STUDIO_PROMPT.length).toBeLessThan(9000)
  })
})

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME
  const base = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')
  for (const v of existsSync(base) ? readdirSync(base) : []) {
    for (const d of readdirSync(join(base, v))) {
      const f = join(base, v, d, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
      if (existsSync(f)) return f
    }
  }
  return execFileSync(process.execPath, [join(process.cwd(), 'node_modules', 'hyperframes', 'dist', 'cli.js'), 'browser', 'path'], { encoding: 'utf8' }).trim()
}

describe('marks with files', () => {
  it('the files of a mark go with its comment, the ways to use them spelled out', async () => {
    vi.doMock('node-pty', () => ({ spawn: () => ({}) }))
    const { markLines } = await import('../../src/main/agent/pty-session')
    const base = { kind: 'pin' as const, time: 1, note: '', elements: [{ id: 'cta', label: '구매 버튼' }], resolved: false }
    const text = markLines([
      { ...base, id: 'a', n: 1, refs: ['feedback/refs/1.png'], note: '이 사진으로 바꿔 줘' },
      { ...base, id: 'b', n: 2, refs: ['feedback/refs/2.mp4'] },
      { ...base, id: 'c', n: 3 },
    ])
    const [one, two, three] = text.split(/\n(?=- )/)
    expect(one).toMatch(/1번 표시[\s\S]*코멘트: "이 사진으로 바꿔 줘"[\s\S]*첨부 파일: feedback\/refs\/1\.png — Read[\s\S]*use_as_material[\s\S]*스타일[\s\S]*참고 자료/)
    expect(two).toMatch(/첨부 파일: feedback\/refs\/2\.mp4 \(영상 · 가운데 장면: feedback\/refs\/2\.mp4\.jpg\)/)
    expect(three).not.toMatch(/첨부/)
  })
})

describe('지금 보이는 것만', () => {
  it('keeps layers shown on the canvas at the playhead (not hidden, transparent, off the canvas, or the camera)', async () => {
    const { visibleNow } = await import('../../src/shared/layers')
    const el = (id: string, visible: boolean, x: number, w = 100, type = 'shape') => ({ id, type, visible, rect: { x, y: 10, w, h: 100 } })
    expect(visibleNow([el('a', true, 10), el('hidden', false, 10), el('off', true, 2000), el('edge', true, -50), el('flat', true, 10, 0), el('__camera', true, 0, 1920, 'camera')], 1920, 1080)).toEqual(['a', 'edge'])
  })
})

describe('the name a request uses', () => {
  it('is the layer label in the composition, in either attribute order', async () => {
    vi.doMock('node-pty', () => ({ spawn: () => ({}) }))
    const { labelInComposition } = await import('../../src/main/agent/pty-session')
    const dir = mkdtempSync(join(tmpdir(), 'ms-label-'))
    mkdirSync(join(dir, 'composition'))
    writeFileSync(join(dir, 'composition', 'index.html'), '<div id="menu-chip" data-ms-id="menu-chip" data-ms-label="베스트 칩" data-ms-type="text">BEST</div><p data-ms-label="가격" data-ms-id="price">1</p><i data-ms-id="menu-chip-bg"></i>')
    expect(labelInComposition(dir, 'menu-chip')).toBe('베스트 칩')
    expect(labelInComposition(dir, 'price')).toBe('가격')
    expect(labelInComposition(dir, 'menu-chip-bg')).toBeNull()
    expect(labelInComposition(dir, 'nope')).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('the page-side audit', () => {
  it('finds unnamed text and boxes, texts that carry their box, the layers there are', async () => {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
    try {
      const p = await browser.newPage()
      await p.setContent(`<!doctype html><html><body style="margin:0">
<div id="root" data-composition-id="main" data-duration="4" style="position:relative;width:800px;height:600px">
  <div data-ms-id="title" data-ms-type="text" data-ms-label="제목" style="position:absolute;left:10px;top:10px">안녕</div>
  <div data-ms-id="badge" data-ms-type="text" data-ms-label="배지" style="position:absolute;left:10px;top:60px;background:#ff3355;border-radius:20px;padding:4px 12px">NEW</div>
  <div data-ms-id="grad" data-ms-type="text" data-ms-label="그라데이션 글자" style="position:absolute;left:10px;top:120px;background:linear-gradient(90deg,red,blue);-webkit-background-clip:text;background-clip:text;color:transparent">SALE</div>
  <div data-ms-id="card" data-ms-type="group" style="position:absolute;left:300px;top:10px"><p>카드 안 글자</p></div>
  <p style="position:absolute;left:10px;top:200px">이름 없는 문구</p>
  <div style="position:absolute;left:10px;top:300px;width:120px;height:30px;background:#2255ff"></div>
  <div style="position:absolute;left:10px;top:400px;width:120px;height:30px"></div>
  <div style="position:absolute;left:10px;top:450px;width:3px;height:3px;background:#000"></div>
</div></body></html>`)
      const a = (await p.evaluate(AUDIT_SCRIPT)) as { ids: string[]; named: number; empty: boolean; unnamed: { count: number; samples: string[] }; boxedTexts: { id: string }[] }
      expect(a.ids).toEqual(['title', 'badge', 'grad', 'card'])
      expect(a.named).toBe(4)
      expect(a.empty).toBe(false)
      expect(a.unnamed).toEqual({ count: 2, samples: ['이름 없는 문구', '색 상자'] })
      expect(a.boxedTexts).toEqual([{ id: 'badge', label: '배지' }])
    } finally {
      await browser.close()
    }
  }, 60_000)
})
