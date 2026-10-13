import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/fonts', () => ({
  listFonts: () => [
    { family: 'Pretendard', hangul: true, weights: [400, 700], faces: [
      { file: 'a', index: 0, style: 'Regular', weight: 400, italic: false, postscript: 'Pretendard-Regular' },
      { file: 'b', index: 0, style: 'Bold', weight: 700, italic: false, postscript: 'Pretendard-Bold' },
    ] },
    { family: 'MDAlong', familyKo: 'MD아롱체', hangul: true, weights: [400], faces: [{ file: 'c', index: 0, style: 'Regular', weight: 400, italic: false, postscript: 'MDAlong' }] },
  ],
}))
const { fontCss, usedFamilies } = await import('../../src/main/fontcss')
const { emptyOverrides } = await import('@shared/overrides')

describe('fontcss', () => {
  it('collects families from CSS, inline styles, GSAP and overrides', () => {
    const o = emptyOverrides()
    o.elements.t = { style: { fontFamily: 'MD아롱체' } }
    const html = `<style>h1 { font-family: "Pretendard", sans-serif; } p{font: 700 40px/1.2 'Apple SD Gothic Neo', serif}</style><div style="font-family:'Noto Sans KR'"></div>`
    expect(usedFamilies(html, o).sort()).toEqual(['Apple SD Gothic Neo', 'MD아롱체', 'Noto Sans KR', 'Pretendard'].sort())
  })

  it('emits local() faces for installed fonts and reports missing ones', () => {
    const { css, missing } = fontCss(`<style>h1{font-family:"Pretendard"} h2{font-family:"Ghost Font"}</style>`, emptyOverrides())
    expect(css).toContain('src: local("Pretendard-Bold"); font-weight: 700')
    expect(missing).toEqual(['Ghost Font'])
  })

  it('declares Korean family names exactly as used', () => {
    const o = emptyOverrides()
    o.elements.t = { style: { fontFamily: 'MD아롱체' } }
    expect(fontCss('', o).css).toContain('font-family: "MD아롱체"; src: local("MDAlong")')
  })
})
