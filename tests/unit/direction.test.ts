// 영상 템포 · 스타일 in the brief: only known values, at most two styles (the first leads),
// and Claude gets them as numbers and rules in BRIEF.md and get_brief.
import { describe, expect, it } from 'vitest'
import { emptyBrief, normalizeBrief } from '../../src/shared/brief'
import { cleanDirection, directionForClaude, styleLabels } from '../../src/shared/direction'
import { briefMarkdown } from '../../src/main/agent/briefDoc'

describe('tempo and styles', () => {
  it('keeps known values, two styles at most, in the order chosen', () => {
    expect(cleanDirection('fast', ['soft', 'kinetic-type', 'premium'])).toEqual({ tempo: 'fast', styles: ['soft', 'kinetic-type'] })
    expect(cleanDirection('warp', ['nope', 'soft', 'soft'])).toEqual({ tempo: undefined, styles: ['soft'] })
    expect(cleanDirection(undefined, [])).toEqual({ tempo: undefined, styles: undefined })
    const b = normalizeBrief({ ...emptyBrief('x'), tempo: 'slow', styles: ['premium', 'x' as never] })
    expect([b.tempo, b.styles]).toEqual(['slow', ['premium']])
    expect(styleLabels(['kinetic-type', 'soft'])).toBe('키네틱 타이포(주) + 감성·소프트')
  })

  it('gives Claude numbers and rules, or nothing when both are left to Claude', () => {
    expect(directionForClaude()).toBeNull()
    const d = directionForClaude('very-fast', ['kinetic-type', 'pop'])!
    expect(d.tempo).toMatch(/shots 0\.5–1 s, beat grid 140–150 BPM/)
    expect(d.styles![0]).toMatch(/^MAIN 키네틱 타이포 \(kinetic-type\): type is the hero.*"Maximalist Type".*find_blocks ideas: "kinetic typography"/)
    expect(d.styles![1]).toMatch(/^ACCENT 팝·컬러풀/)
  })

  it('writes them into BRIEF.md', () => {
    const b = { ...emptyBrief('봄 신메뉴', 'shorts-9x16', 12), tempo: 'fast' as const, styles: ['product' as const] }
    const md = briefMarkdown(b)
    expect(md).toMatch(/- 템포\(디자이너가 고름\): 빠름 \(fast\): shots 1–1\.5 s/)
    expect(md).toMatch(/- 스타일\(디자이너가 고름, 실사 제품 중심\):\n  - STYLE 실사 제품 중심/)
    expect(briefMarkdown(emptyBrief('x', 'shorts-9x16', 12))).not.toMatch(/템포|스타일/)
  })
})
