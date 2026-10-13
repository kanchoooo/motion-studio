import { describe, expect, it } from 'vitest'
import { makeTimeMap } from '@shared/timeRemap'

describe('makeTimeMap', () => {
  it('is identity without sections', () => {
    const m = makeTimeMap(6, [])
    expect(m.length).toBe(6)
    expect(m.toOutput(3)).toBe(3)
    expect(m.toAuthored(3)).toBe(3)
  })

  it('compresses a 2x section (matches the PoC render)', () => {
    const m = makeTimeMap(6, [{ from: 1, to: 3, speed: 2 }])
    expect(m.length).toBe(5)
    expect(m.toOutput(2)).toBe(1.5) // authored 2.0 shows at output 1.5
    expect(m.toOutput(3)).toBe(2)
    expect(m.toAuthored(1.5)).toBe(2)
    expect(m.toAuthored(2)).toBe(3)
    expect(m.toOutput(6)).toBe(5)
  })

  it('round-trips output <-> authored time', () => {
    const m = makeTimeMap(15, [
      { from: 2, to: 4, speed: 1.5 },
      { from: 8, to: 12, speed: 0.5 },
    ])
    for (const t of [0, 1, 2.5, 3.9, 7, 9.5, 14]) expect(m.toAuthored(m.toOutput(t))).toBeCloseTo(t, 6)
  })

  it('ignores invalid sections', () => {
    const m = makeTimeMap(10, [{ from: 5, to: 4, speed: 2 }, { from: 1, to: 2, speed: 0 }])
    expect(m.length).toBe(10)
  })
})
