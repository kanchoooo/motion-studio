// Same piecewise-linear time map ms-runtime.js builds, for the editor UI:
// sections are stored in authored (original) time, the timeline shows output time.
import type { TimeRemapSection } from './overrides'

export interface TimeMap {
  length: number
  toOutput(t: number): number
  toAuthored(t: number): number
  segs: { a: number; b: number; k: number; o: number }[]
}

export function makeTimeMap(D: number, sections: TimeRemapSection[]): TimeMap {
  const sorted = sections.filter((s) => s.to > s.from && s.speed > 0).sort((a, b) => a.from - b.from)
  const segs: { a: number; b: number; k: number; o: number }[] = []
  let cur = 0
  for (const s of sorted) {
    const a = Math.max(cur, Math.min(s.from, D))
    const b = Math.min(s.to, D)
    if (a > cur) segs.push({ a: cur, b: a, k: 1, o: 0 })
    if (b > a) segs.push({ a, b, k: s.speed, o: 0 })
    cur = Math.max(cur, b)
  }
  if (cur < D) segs.push({ a: cur, b: D, k: 1, o: 0 })
  let out = 0
  for (const s of segs) {
    s.o = out
    out += (s.b - s.a) / s.k
  }
  return {
    length: out,
    segs,
    toOutput(t) {
      for (const s of segs) if (t <= s.b) return s.o + (Math.max(t, s.a) - s.a) / s.k
      return out
    },
    toAuthored(t) {
      for (const s of segs) {
        const end = s.o + (s.b - s.a) / s.k
        if (t <= end) return s.a + (Math.max(t, s.o) - s.o) * s.k
      }
      return D
    },
  }
}
