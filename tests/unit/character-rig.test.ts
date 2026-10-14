// Phase 11 SVG characters: the eye rig (full eye white, pupil clipped to it), the neck
// under-hang, parts that follow the head, and character_check (extreme poses).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { applyTags, prepareTags, diffRender } = require('../../src/main/character/img2svg/tag.cjs')
const { checkCharacter } = require('../../src/main/character/img2svg/check.cjs')
const dir = join(__dirname, '..', 'fixtures', 'character', 'man')
const svg = readFileSync(join(dir, 'vector.svg'), 'utf8')
const tag = async (file: string) => {
  const prep = await prepareTags(svg, JSON.parse(readFileSync(join(dir, file), 'utf8')))
  return applyTags(svg, prep.tags).svg as string
}

describe('character rig', () => {
  it('builds full eye whites with the pupils clipped inside, a neck under-hang and a following chin shadow — still the same picture at rest', async () => {
    const out = await tag('tags-rig.json')
    expect(out).toMatch(/<g id="eye-l"[^>]*data-eye="[\d. ]+"/)
    expect(out).toMatch(/<g id="eye-l-white"[^>]*>\s*<path[^>]*data-added="흰자 전체/)
    expect(out).toMatch(/<g id="pupil-l"[^>]*>\s*<g clip-path="url\(#clip-pupil-l\)">/)
    expect(out).not.toMatch(/id="s09"/) // the crescent white is replaced
    expect(out).toMatch(/data-added="under-hang"/)
    expect(out).toMatch(/data-role="content" data-follow="head"/)
    expect(out).toMatch(/<g id="head"[^>]*data-max-rot="8"/)
    expect(await diffRender(svg, out, 1254, 1254)).toBeLessThanOrEqual(0.1)
  }, 120_000)

  it('character_check passes the rigged tags and catches the old eyes', async () => {
    const good = await checkCharacter(await tag('tags-rig.json'))
    expect(good.eyes.every((e: { rig: boolean }) => e.rig)).toBe(true)
    const head = good.groups.find((g: { id: string }) => g.id === 'head')
    expect(head.cracks.every((n: number) => n <= 12)).toBe(true)
    expect(good.ok).toBe(true)
    expect(good.sheet.length).toBeGreaterThan(10_000)
    const old = await checkCharacter(await tag('tags.json'))
    expect(old.eyes.some((e: { rig: boolean }) => !e.rig)).toBe(true)
    expect(old.ok).toBe(false)
  }, 180_000)
})
