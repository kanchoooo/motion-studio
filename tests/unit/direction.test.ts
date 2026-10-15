// 영상 템포 · 스타일 from briefs made before 0.5: only known values, at most two styles (the
// first leads); get_brief passes them on as older-brief notes.
import { describe, expect, it } from 'vitest'
import { emptyBrief, normalizeBrief } from '../../src/shared/brief'
import { cleanDirection, directionForClaude, styleLabels } from '../../src/shared/direction'

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

})
