import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))
const { linkedFontFaces, usedFamilies, withFontBlock } = await import('../../src/main/fontcss')
const { emptyOverrides } = await import('../../src/shared/overrides')

// 내보내기에서 글꼴 굵기가 달라지던 문제: the faces the page links are written into the page too,
// so HyperFrames does not add its own (guessed) faces for those families when it renders
const comp = mkdtempSync(join(tmpdir(), 'ms-fontblock-'))
afterAll(() => rmSync(comp, { recursive: true, force: true }))
mkdirSync(join(comp, 'ms'), { recursive: true })
mkdirSync(join(comp, 'fonts', 'pretendard'), { recursive: true })
writeFileSync(join(comp, 'ms', 'fonts.css'), '/* 자동 */\n@font-face { font-family: "Apple SD Gothic Neo"; src: local("AppleSDGothicNeo-Bold"); font-weight: 700; font-style: normal; }\n')
writeFileSync(join(comp, 'fonts', 'web-fonts.css'), "@font-face{font-family:'Pretendard';font-weight:800;src:url('pretendard/Pretendard-ExtraBold.woff2') format('woff2')}")
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="ms/fonts.css" />
<link rel="stylesheet" href="fonts/web-fonts.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
</head><body><div data-composition-id="main"></div></body></html>`

describe('font block', () => {
  it('collects the faces of the local stylesheets, urls relative to the page', () => {
    const faces = linkedFontFaces(comp, page)
    expect(faces).toContain('local("AppleSDGothicNeo-Bold")')
    expect(faces).toContain("url('fonts/pretendard/Pretendard-ExtraBold.woff2')")
    expect(faces).not.toContain('googleapis')
  })
  it('writes them into the head once, and keeps it up to date (no change → null)', () => {
    const once = withFontBlock(page, linkedFontFaces(comp, page))!
    expect(once.indexOf('<style data-ms-fonts>')).toBeLessThan(once.indexOf('</head>'))
    expect(once.indexOf('<style data-ms-fonts>')).toBeGreaterThan(once.indexOf('web-fonts.css'))
    // HyperFrames looks for @font-face with the family in the page text
    expect(once).toMatch(/@font-face\s*\{\s*font-family:\s*"Apple SD Gothic Neo"/)
    expect(withFontBlock(once, linkedFontFaces(comp, once))).toBeNull()
    const changed = withFontBlock(once, 'x')!
    expect(changed.match(/ms:fonts \(/g)).toHaveLength(1)
    expect(withFontBlock(once, '')).not.toContain('data-ms-fonts')
  })
  it('a block put in before an indented </head> stays as it is on the next pass', () => {
    const indented = page.replace('</head>', '  </head>')
    const once = withFontBlock(indented, linkedFontFaces(comp, indented))!
    expect(withFontBlock(once, linkedFontFaces(comp, once))).toBeNull()
    expect(withFontBlock(once, '')).toBe(indented)
  })
  it('finds families kept in custom properties, in the font shorthand with any unit, and in SVG text', () => {
    const html = `<style>:root{--brand:'Nanum Square'} .a{font-family:var(--brand), sans-serif} .b{font: 700 2rem/1.2 "Gmarket Sans"}</style><svg><text font-family="Black Han Sans">가</text></svg>`
    expect(usedFamilies(html, emptyOverrides()).sort()).toEqual(['Black Han Sans', 'Gmarket Sans', 'Nanum Square'])
  })
})
