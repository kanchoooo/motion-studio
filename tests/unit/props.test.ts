// The designer's properties in one list (props.ts): fixed values where they always lived, colours
// between keyframes, loops after the last key, the runtime animating the same CSS variables, and
// Claude changing the designer's values instead of clearing them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anyValueAt, keysAt, lerpColor, PROPS, setValue, staticPatch, unsetStatic, valueAt, type ElementOverride, type KeyProp } from '../../src/shared/overrides'
import { mergeDesignerPatch } from '../../src/main/designerEdits'

describe('properties', () => {
  it('every property reads back the fixed value it was given', () => {
    for (const p of PROPS) {
      const v = p.kind === 'color' ? '#12ab34' : 7
      const o = staticPatch(undefined, { [p.id]: v } as Partial<Record<KeyProp, number | string>>)
      expect(setValue(o, p.id), p.id).toBe(v)
      // and unsetting it goes back to the resting value
      expect(setValue(unsetStatic(o, [p.id]), p.id), `${p.id} unset`).toBeUndefined()
    }
  })

  it('keeps the other parts of a shadow when one is set', () => {
    const o: ElementOverride = { effects: { shadow: { x: 1, y: 2, blur: 3, color: '#ff0000' } } }
    expect(staticPatch(o, { shadowBlur: 9 }).effects?.shadow).toEqual({ x: 1, y: 2, blur: 9, color: '#ff0000' })
    expect(staticPatch(o, { shadowColor: '#00ff00' }).effects?.shadow?.color).toBe('#00ff00')
  })

  it('colours go through the colours between them', () => {
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(lerpColor('rgb(255, 0, 0)', '#0000ff', 0)).toBe('#ff0000')
    expect(lerpColor('#00000000', '#000000ff', 0.5)).toBe('#00000080')
    const o: ElementOverride = { keys: { color: [{ t: 0, v: '#000000', e: 'linear' }, { t: 2, v: '#ffffff' }] } }
    expect(anyValueAt(o, 'color', 1)).toBe('#808080')
    expect(anyValueAt(o, 'color', 5)).toBe('#ffffff')
  })

  it('loops repeat the keys after the last one (cycle) or go back and forth (pingpong)', () => {
    const ks = [{ t: 1, v: 0, e: 'linear' }, { t: 2, v: 10 }]
    expect(keysAt(ks, 2.5)).toBe(10)
    expect(keysAt(ks, 2.5, 'cycle')).toBe(5)
    expect(keysAt(ks, 3.25, 'cycle')).toBe(2.5)
    expect(keysAt(ks, 2.25, 'pingpong')).toBe(7.5)
    expect(keysAt(ks, 3.25, 'pingpong')).toBe(2.5)
    const o: ElementOverride = { keys: { x: ks }, loops: { x: 'cycle' } }
    expect(valueAt(o, 'x', 2.5)).toBe(5)
  })

  it('the runtime animates the same variables for the same properties', () => {
    const js = readFileSync(join(__dirname, '..', '..', 'src', 'runtime', 'ms-runtime.js'), 'utf8')
    const list = js.slice(js.indexOf('var PROPDEFS = ['), js.indexOf('var KEYVAR'))
    const rows = [...list.matchAll(/\['(\w+)', '(--ms-[\w-]+)', '(\w*)', '(wrap|el)'/g)].map((m) => ({ id: m[1], v: m[2], unit: m[3], target: m[4] }))
    for (const p of PROPS) {
      if (!p.cssVar) continue
      const r = rows.find((x) => x.id === p.id)
      expect(r, p.id).toBeTruthy()
      expect(r!.v, p.id).toBe(p.cssVar)
      expect(r!.target, p.id).toBe(p.target)
      expect(r!.unit === 'color' ? 'color' : r!.unit, p.id).toBe(p.kind === 'color' ? 'color' : p.unit)
    }
  })
})

describe("Claude changing the designer's edits", () => {
  it('merges values and keyframes, reports what does not belong', () => {
    const cur: ElementOverride = { transform: { x: 10, y: 4 }, keys: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, own: { y: [{ t: 0, v: 100 }] }, label: '로고' }
    const { merged, problems } = mergeDesignerPatch(cur, {
      transform: { x: 30, y: null },
      keys: { opacity: [{ t: 0.5, v: 0 }, { t: 1.5, v: 1, e: 'linear' }], bogus: [] },
      own: { rotation: [{ t: 0, v: 0 }, { t: 1, v: 90 }] },
      wiggle: { x: { freq: 3, amount: 10 } },
      locked: true,
      nope: 1,
    })
    expect(merged.transform).toEqual({ x: 30 })
    expect(merged.keys?.opacity).toEqual([{ t: 0.5, v: 0 }, { t: 1.5, v: 1, e: 'linear' }])
    expect(merged.own).toEqual({ y: [{ t: 0, v: 100 }], rotation: [{ t: 0, v: 0 }, { t: 1, v: 90 }] })
    expect(merged.wiggle).toEqual({ x: { freq: 3, amount: 10 } })
    expect(merged.label).toBe('로고')
    expect(merged.locked).toBeUndefined()
    expect(problems.join(' ')).toMatch(/keys\.bogus/)
    expect(problems.join(' ')).toMatch(/locked/)
    expect(problems.join(' ')).toMatch(/nope/)
  })
})
