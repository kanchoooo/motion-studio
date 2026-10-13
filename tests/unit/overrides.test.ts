import { describe, expect, it } from 'vitest'
import { emptyOverrides, isEmptyOverride, overridesToScript } from '@shared/overrides'

describe('overridesToScript', () => {
  it('produces a script that sets window.__MS_OVERRIDES__', () => {
    const o = emptyOverrides()
    o.elements.title = { text: 'hello', style: { fontSize: 120 } }
    const js = overridesToScript(o)
    const win: Record<string, unknown> = {}
    new Function('window', js)(win)
    expect((win.__MS_OVERRIDES__ as { elements: Record<string, { text: string }> }).elements.title.text).toBe('hello')
  })

  it('cannot close the surrounding <script> tag', () => {
    const o = emptyOverrides()
    o.elements.t = { text: '</script><script>alert(1)</script>' }
    expect(overridesToScript(o)).not.toContain('</script>')
  })

  it('detects empty overrides', () => {
    expect(isEmptyOverride({})).toBe(true)
    expect(isEmptyOverride({ animSpeed: 1 })).toBe(true)
    expect(isEmptyOverride({ transform: { x: 4 } })).toBe(false)
  })
})

describe('motions in the runtime script', () => {
  it('passes motion edits to the runtime', () => {
    const o = emptyOverrides()
    o.motions['title#1'] = { sig: 'from:opacity,y', duration: 2, ease: 'none', shift: 0.5 }
    const win: Record<string, unknown> = {}
    new Function('window', overridesToScript(o))(win)
    expect((win.__MS_OVERRIDES__ as { motions: Record<string, { duration: number }> }).motions['title#1'].duration).toBe(2)
  })
})
