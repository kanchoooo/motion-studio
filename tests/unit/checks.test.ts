import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/fonts', () => ({
  listFonts: () => [{ family: 'Pretendard', familyKo: undefined, hangul: true, weights: [400, 700], faces: [{ file: 'x', index: 0, style: 'Regular', weight: 400, italic: false, postscript: 'Pretendard-Regular' }] }],
  hasFont: (n: string) => n === 'Pretendard',
}))
vi.mock('../../src/main/hyperframes', () => ({ check: async () => ({ ok: true, issues: [], raw: '' }) }))

const { staticFindings } = await import('../../src/main/checks')
const { emptyBrief } = await import('@shared/brief')
const { emptyOverrides } = await import('@shared/overrides')

const HEAD = `<head><script src="vendor/gsap.min.js"></script><link rel="stylesheet" href="ms/fonts.css" /><script src="ms/overrides.js"></script><script src="ms/runtime.js"></script><style>h1{font-family:"Pretendard"}</style></head>`
const page = (body: string, head = HEAD) => `<html>${head}<body><div id="root" data-composition-id="main" data-start="0" data-duration="15" data-width="1920" data-height="1080">${body}</div></body></html>`

describe('staticFindings', () => {
  const brief = emptyBrief('t')

  it('passes a well-formed composition', () => {
    const f = staticFindings(page('<h1 data-ms-id="title" data-ms-label="타이틀">안녕</h1>'), brief, emptyOverrides())
    expect(f.filter((x) => x.severity === 'error')).toEqual([])
  })

  it('flags missing managed scripts and wrong order', () => {
    const f = staticFindings(page('<h1 data-ms-id="a" data-ms-label="A">x</h1>', '<head><script src="ms/runtime.js"></script><script src="vendor/gsap.min.js"></script></head>'), brief, emptyOverrides())
    const codes = f.map((x) => x.code)
    expect(codes).toContain('ms_script_missing')
    expect(codes).toContain('ms_fonts_css_missing')
  })

  it('requires locked texts verbatim', () => {
    const b = { ...brief, texts: [{ id: '1', text: '※ 매장별 판매 시기가 다를 수 있습니다', locked: true, timing: { mode: 'any' as const }, minDuration: 1, position: 'any' as const, style: { mode: 'auto' as const }, note: '' }] }
    const missing = staticFindings(page('<p data-ms-id="d" data-ms-label="고지">※ 매장별 판매 시기가 다를 수 있어요</p>'), b, emptyOverrides())
    expect(missing.find((x) => x.code === 'ms_required_text')?.severity).toBe('error')
    const ok = staticFindings(page('<p data-ms-id="d" data-ms-label="고지">※ 매장별 판매 시기가<br>다를 수 있습니다</p>'), b, emptyOverrides())
    expect(ok.find((x) => x.code === 'ms_required_text')).toBeUndefined()
  })

  it('flags duplicate ids, missing labels, reference leaks, network deps and missing fonts', () => {
    const html = page('<h1 data-ms-id="a">x</h1><p data-ms-id="a" data-ms-label="b" style="font-family:\'NoSuchFont\'">y</p><img src="../references/ref.png"><script src="https://cdn.example.com/x.js"></script>')
    const codes = staticFindings(html, brief, emptyOverrides()).map((x) => x.code)
    expect(codes).toEqual(expect.arrayContaining(['ms_duplicate_id', 'ms_label_missing', 'ms_reference_leak', 'ms_network_dependency', 'ms_font_missing']))
  })

  it('checks canvas size and duration against the brief', () => {
    const html = page('<h1 data-ms-id="a" data-ms-label="A">x</h1>').replace('data-duration="15"', 'data-duration="10"').replace('data-width="1920"', 'data-width="1080"')
    const codes = staticFindings(html, brief, emptyOverrides()).map((x) => x.code)
    expect(codes).toEqual(expect.arrayContaining(['ms_canvas_size', 'ms_duration']))
  })

  it('reports group content that cannot be edited on its own, and stale motion edits', () => {
    const f = staticFindings(page('<div data-ms-id="phone" data-ms-label="폰" data-ms-type="group"><p>9:41</p></div>'), brief, emptyOverrides(), [], {
      loose: [{ id: 'phone', label: '폰 목업', text: '9:41 주문하기', images: 1 }],
      stale: ['title#2'],
    })
    const g = f.find((x) => x.code === 'ms_group_inner_not_editable')
    // the app names them itself ("phone~…"), so the designer can edit them: a warning for Claude
    expect(g?.severity).toBe('warning')
    expect(g?.message).toContain('폰 목업')
    expect(g?.message).toContain('이미지 1개')
    expect(f.find((x) => x.code === 'ms_motion_edit_stale')?.severity).toBe('info')
  })
})
