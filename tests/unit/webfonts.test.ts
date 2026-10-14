// Web fonts downloaded into the project (network): Google Fonts subsets and Pretendard,
// declared with local relative URLs in composition/fonts/web-fonts.css.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addWebFont, listWebFonts } from '../../src/main/webfonts'

describe('web fonts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-webfont-'))
  mkdirSync(join(dir, 'composition', 'fonts'), { recursive: true })

  it('downloads a Google font with all its subsets and points the CSS at the local files', async () => {
    const f = await addWebFont(dir, 'Black Han Sans', [400, 700])
    expect(f.weights).toEqual([400]) // the family has one weight: asked one by one
    const css = readFileSync(join(dir, 'composition', 'fonts', 'web-fonts.css'), 'utf8')
    expect(css).toContain("font-family: 'Black Han Sans'")
    expect(css).not.toMatch(/https?:\/\//)
    const files = readdirSync(join(dir, 'composition', 'fonts', 'black-han-sans'))
    expect(files.length).toBeGreaterThan(5)
    for (const m of css.matchAll(/url\('([^']+)'\)/g)) expect(existsSync(join(dir, 'composition', 'fonts', m[1]))).toBe(true)
  }, 120_000)

  it('downloads Pretendard weights and keeps both families in the stylesheet', async () => {
    const f = await addWebFont(dir, 'Pretendard', [400, 700])
    expect(f.weights).toEqual([400, 700])
    const css = readFileSync(join(dir, 'composition', 'fonts', 'web-fonts.css'), 'utf8')
    expect(css).toContain("font-family:'Pretendard'")
    expect(css).toContain('Black Han Sans')
    expect(listWebFonts(dir).map((x) => x.family)).toEqual(['Black Han Sans', 'Pretendard'])
  }, 120_000)

  it('explains a family Google does not have', async () => {
    await expect(addWebFont(dir, 'No Such Font Family XYZ', [400])).rejects.toThrow(/찾지 못했어요/)
  }, 60_000)
})
