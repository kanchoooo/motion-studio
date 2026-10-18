import { describe, expect, it } from 'vitest'
import { approvalFor, designerLayers, elementSpan, pageAfter, touchedLayers } from '../../src/main/agent/designerGuard'
import type { Overrides } from '../../src/shared/overrides'

// 직접 고친 레이어 보호: what a request lets Claude change, and which page edits reach those layers
const page = `<html><head><style>
#t1 { top: 100px; }
#t2 {
  top: 200px;
  color: #fff;
}
</style></head><body>
<div data-ms-id="scene" data-ms-label="장면1">
  <div id="t1" data-ms-id="title" data-ms-label="장면1 · 제목">3주 출장,</div>
  <div id="t2" data-ms-id="sub" data-ms-label="장면1 · 부제">숙소는 어디서</div>
  <img data-ms-id="logo" data-ms-label="로고" src="a.png">
</div>
<script>tl.from('#t1', { y: 40 }, 0); tl.from('#t2', { y: 40 }, 0.2)</script>
</body></html>`
const ov = { elements: { title: { transform: { x: 10 } }, sub: { style: { color: '#f00' } }, scene: { label: '장면 하나' }, logo: { locked: true } }, layers: [{ id: 'Lmine', kind: 'shape', label: '내 도형', x: 0, y: 0, w: 1, h: 1 }] } as unknown as Overrides
const layers = designerLayers(ov, page)

describe('designer layers', () => {
  it('are the edited ones (not a rename or a lock alone) and the ones the designer added', () => {
    expect([...layers.keys()].sort()).toEqual(['Lmine', 'sub', 'title'])
    expect(layers.get('title')).toBe('장면1 · 제목')
  })
  it('an element span covers its children', () => {
    const s = elementSpan(page, 'scene')!
    expect(page.slice(s.from, s.to)).toContain('숙소는 어디서')
    expect(page.slice(s.from, s.to).endsWith('</div>')).toBe(true)
    const img = elementSpan(page, 'logo')!
    expect(page.slice(img.from, img.to)).toBe('<img data-ms-id="logo" data-ms-label="로고" src="a.png">')
  })
})

describe('which edits reach them', () => {
  const edit = (old: string, now: string) => touchedLayers(page, pageAfter('Edit', { old_string: old, new_string: now }, page)!, layers)
  it('its text, its CSS rule (also a rule over several lines), its motion', () => {
    expect(edit('3주 출장,', '4주 출장,')).toEqual(['title'])
    expect(edit('#t1 { top: 100px; }', '#t1 { top: 140px; }')).toEqual(['title'])
    expect(edit('  color: #fff;', '  color: #000;')).toEqual(['sub'])
    expect(edit("tl.from('#t2', { y: 40 }, 0.2)", "tl.from('#t2', { y: 80 }, 0.2)")).toEqual(['sub'])
  })
  it('not an edit next to them, even one that quotes them unchanged', () => {
    expect(edit('<img data-ms-id="logo"', '<img data-ms-id="logo" alt=""')).toEqual([])
    const both = '  <div id="t2" data-ms-id="sub" data-ms-label="장면1 · 부제">숙소는 어디서</div>\n'
    expect(edit(both, both + '  <div data-ms-id="new" data-ms-label="새 문구">새로</div>\n')).toEqual([])
  })
  it('a whole new page: whatever changed about them', () => {
    expect(touchedLayers(page, pageAfter('Write', { content: page.replace('숙소는', '방은') }, page)!, layers)).toEqual(['sub'])
    expect(touchedLayers(page, pageAfter('Write', { content: page }, page)!, layers)).toEqual([])
  })
  it('an edit that does not apply is not judged', () => {
    expect(pageAfter('Edit', { old_string: 'nowhere', new_string: 'x' }, page)).toBeNull()
  })
})

describe('what a request allows', () => {
  it('the layers it marks or names', () => {
    expect([...approvalFor({ text: '제목을 더 크게', marks: [] }, layers).ids]).toEqual(['title'])
    expect([...approvalFor({ text: '여기 고쳐줘', marks: [{ elements: [{ id: 'sub', label: '' }] }] as never }, layers).ids]).toEqual(['sub'])
    expect(approvalFor({ text: '배경 색만 바꿔 줘' }, layers).ids.size).toBe(0)
  })
  it('"yes" after Claude asked about a layer', () => {
    const ask = '「장면1 · 부제」의 위치가 화면 밖으로 나가 있어요. 고쳐도 될까요?'
    expect([...approvalFor({ text: '네 고쳐 주세요' }, layers, ask).ids]).toEqual(['sub'])
    expect(approvalFor({ text: '아니요 그대로 두세요' }, layers, ask).ids.size).toBe(0)
    expect(approvalFor({ text: '네 그리고 배경 음악도 바꾸고 전체적으로 좀 더 밝은 느낌으로 다시 만들어 주세요' }, layers, ask).ids.size).toBe(0)
  })
  it('everything when the designer says so, or for the app’s own requests', () => {
    expect(approvalFor({ text: '직접 고친 것도 다 바꿔도 돼요' }, layers).all).toBe(true)
    expect(approvalFor({ text: '새 부분 이름 붙여 줘', fromApp: true }, layers).all).toBe(true)
    expect(approvalFor({ text: '전체적으로 밝게' }, layers).all).toBe(false)
  })
})
