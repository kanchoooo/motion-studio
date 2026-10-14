// Character image → SVG → part tags (tools from ms-svg-character, example "man").
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { vectorize, previews } = require('../../src/main/character/img2svg/lib.cjs')
const { applyTags, diffRender } = require('../../src/main/character/img2svg/tag.cjs')
const dir = join(__dirname, '..', 'fixtures', 'character', 'man')

describe('img2svg', () => {
  it('turns the flat character into about 26 shapes, within 1% of the original', async () => {
    const r = await vectorize(join(dir, 'source.webp'), { colors: 14, bg: 'auto', thin: 1.6, maxSide: 1600 })
    const p = await previews(r)
    expect(r.shapes.length).toBeGreaterThan(15)
    expect(r.shapes.length).toBeLessThan(40)
    expect(p.badPct).toBeLessThan(1)
    expect(r.svg).toContain('id="s01"')
    expect(p.sheet.length).toBeGreaterThan(1000)
  }, 60_000)

  it('applies the AI part tags with at most 0.1% visible change', async () => {
    const svg = readFileSync(join(dir, 'vector.svg'), 'utf8')
    const tags = JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8'))
    const r = applyTags(svg, tags)
    expect(r.svg).toContain('data-part="head')
    const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!
    const pct = await diffRender(svg, r.svg, +w, +h)
    expect(pct).toBeLessThanOrEqual(0.1)
  }, 60_000)
})
