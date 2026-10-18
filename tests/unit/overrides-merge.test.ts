import { describe, expect, it } from 'vitest'
import { mergeOverrides } from '../../src/shared/overridesMerge'
import type { Overrides } from '../../src/shared/overrides'

// 직접 수정이 되돌아가던 문제: the editor's whole copy must not write away a change made meanwhile
const base = {
  version: 2,
  elements: { a: { transform: { x: 10 } }, b: { style: { color: '#fff' } } },
  timeRemap: [],
  keepTotalDuration: true,
  audio: {},
  sfxGroups: {},
  bgm: [],
  motions: { 'a#0': { duration: 1 } },
  layers: [],
  duplicates: [],
  order: {},
  markers: [],
  guides: { x: [], y: [] },
} as unknown as Overrides
const clone = <T>(x: T): T => structuredClone(x)

describe('mergeOverrides', () => {
  it("keeps Claude's change to one layer while the designer edits another", () => {
    const ours = clone(base)
    ours.elements.b = { style: { color: '#000' } }
    const theirs = clone(base)
    theirs.elements.a = { transform: { x: 99 } }
    const m = mergeOverrides(base, ours, theirs)
    expect(m.elements.a).toEqual({ transform: { x: 99 } })
    expect(m.elements.b).toEqual({ style: { color: '#000' } })
  })
  it('the same layer changed on both sides: the designer (the editor) wins', () => {
    const ours = clone(base)
    ours.elements.a = { transform: { x: 20 } }
    const theirs = clone(base)
    theirs.elements.a = { transform: { x: 99 } }
    expect(mergeOverrides(base, ours, theirs).elements.a).toEqual({ transform: { x: 20 } })
  })
  it('deletions and additions on either side survive', () => {
    const ours = clone(base)
    delete (ours.elements as Record<string, unknown>).b
    ours.elements.c = { hidden: true }
    const theirs = clone(base)
    theirs.elements.d = { label: '새 이름' }
    delete (theirs.motions as Record<string, unknown>)['a#0']
    const m = mergeOverrides(base, ours, theirs)
    expect(Object.keys(m.elements).sort()).toEqual(['a', 'c', 'd'])
    expect(m.motions).toEqual({})
  })
  it('lists (layers, music, markers): the side that changed it', () => {
    const ours = clone(base)
    ours.markers = [{ t: 1, label: 'x' }] as never
    const theirs = clone(base)
    theirs.bgm = [{ id: 'm1' }] as never
    const m = mergeOverrides(base, ours, theirs)
    expect(m.markers).toEqual([{ t: 1, label: 'x' }])
    expect(m.bgm).toEqual([{ id: 'm1' }])
  })
  it('nothing changed elsewhere: just the editor’s copy', () => {
    const ours = clone(base)
    ours.elements.a = { transform: { x: 1 } }
    expect(mergeOverrides(base, ours, clone(base))).toEqual(ours)
  })
})
