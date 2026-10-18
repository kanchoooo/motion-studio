import { describe, expect, it } from 'vitest'
import { placeOf } from '../../src/shared/textPlace'

// 선택한 글자만 색 바꾸기: the place of the dragged part, as the preview counts it
describe('placeOf', () => {
  it('counts the places of the same word before the selection', () => {
    const t = '3주 출장, 3주 휴가, 3주 방학'
    expect(placeOf(t, 0, '3주')).toBe(0)
    expect(placeOf(t, t.indexOf('3주 휴가'), '3주')).toBe(1)
    expect(placeOf(t, t.lastIndexOf('3주'), '3주')).toBe(2)
  })
  it('ignores spaces and line breaks (the page shows them differently)', () => {
    const t = '이사 날짜가\n2주나 비는데…'
    expect(placeOf(t, t.indexOf('날짜'), '날짜가\n2주')).toBe(0)
    expect(placeOf('a b a b', 4, 'a b')).toBe(1)
  })
  it('a selection starting on a space counts from its first letter', () => {
    const t = '첫 거주 3만원 3만원'
    expect(placeOf(t, t.lastIndexOf(' 3만원'), ' 3만원')).toBe(1)
  })
})
