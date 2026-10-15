// After Effects–style editing, the pure parts: version-1 automatic locks are dropped,
// keyframe values between keys (eases), the managed block of layers the designer added,
// a locked layer that disappears is an error for Claude.
import { describe, expect, it } from 'vitest'
import { bezier, easeFn, emptyOverrides, normalizeOverrides, valueAt, type ElementOverride } from '../../src/shared/overrides'
import { applyLayers, safeSrc } from '../../src/main/designerLayers'

describe('overrides', () => {
  it('drops the locks version 1 set by itself, keeps the designer\'s own from version 2 on', () => {
    const v1 = normalizeOverrides({ version: 1, elements: { a: { text: '바로 주문', locked: true }, b: { hidden: true } } } as never)
    expect(v1.version).toBe(2)
    expect(v1.elements.a).toEqual({ text: '바로 주문' })
    const v2 = normalizeOverrides({ ...emptyOverrides(), elements: { a: { locked: true } } })
    expect(v2.elements.a.locked).toBe(true)
    expect(v2.layers).toEqual([])
    expect(v2.guides).toEqual({ x: [], y: [] })
  })

  it('reads a property between keyframes with its ease, holds before the first and after the last', () => {
    const o: ElementOverride = { transform: { x: 5 }, keys: { x: [{ t: 1, v: 0, e: 'linear' }, { t: 3, v: 200, e: 'hold' }, { t: 4, v: 50 }] } }
    expect(valueAt(o, 'x', 0)).toBe(0)
    expect(valueAt(o, 'x', 2)).toBe(100)
    expect(valueAt(o, 'x', 3.5)).toBe(200)
    expect(valueAt(o, 'x', 9)).toBe(50)
    // no keys: the fixed value, scale falls back to the older uniform one
    expect(valueAt({ transform: { x: 7, scale: 1.5 } }, 'x', 1)).toBe(7)
    expect(valueAt({ transform: { scale: 1.5 } }, 'scaleY', 1)).toBe(1.5)
    expect(valueAt(undefined, 'opacity', 1)).toBe(1)
  })

  it('eases like CSS / GSAP', () => {
    expect(bezier(0.33, 0, 0.67, 1)(0.5)).toBeCloseTo(0.5, 3)
    expect(bezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 3)
    expect(easeFn('power2.out')(0.5)).toBeCloseTo(0.875, 5) // GSAP power2 = cubic
    expect(easeFn('power2.in')(0.5)).toBeCloseTo(0.125, 5)
    expect(easeFn('quad.out')(0.5)).toBeCloseTo(0.75, 5)
    expect(easeFn('linear')(0.4)).toBe(0.4)
    expect(easeFn('back.out(1.7)')(0.6)).toBeGreaterThan(1)
    expect(easeFn('bounce.out')(1)).toBeCloseTo(1, 5)
    expect(easeFn('something.unknown')(0.5)).toBeCloseTo(0.5, 2)
  })
})

describe('layers added by hand', () => {
  const html = `<!doctype html><html><head><script>var s = '</div>'</script></head><body>
    <div id="root" data-composition-id="main" data-duration="8">
      <div data-ms-id="title" data-ms-label="제목">Hi</div>
      <div class="scene"><span>x</span></div>
    </div>
    <script>window.__timelines.main = gsap.timeline()</script>
  </body></html>`
  const o = {
    ...emptyOverrides(),
    layers: [
      { id: 'Ltext', kind: 'text' as const, label: '내 "문구"', x: 10, y: 20, w: 300, h: 50, text: '1+1 <이벤트>\n둘째 줄' },
      { id: 'Lvid', kind: 'video' as const, label: '영상', x: 0, y: 0, w: 320, h: 180, src: 'assets/clip.mp4' },
      { id: 'Lbad', kind: 'image' as const, label: '밖', x: 0, y: 0, w: 10, h: 10, src: '../../etc/passwd' },
      { id: 'no-L-prefix', kind: 'shape' as const, label: 'x', x: 0, y: 0, w: 10, h: 10 },
    ],
  }
  it('are written at the end of the root, escaped, once', () => {
    const out = applyLayers(html, o)
    const block = out.slice(out.indexOf('ms:layers:start'), out.indexOf('ms:layers:end'))
    expect(out.indexOf('ms:layers:start')).toBeGreaterThan(out.indexOf('class="scene"'))
    expect(out.indexOf('ms:layers:end')).toBeLessThan(out.indexOf('<script>window.__timelines'))
    expect(block).toContain('data-ms-label="내 &quot;문구&quot;"')
    expect(block).toContain('1+1 &lt;이벤트&gt;<br>둘째 줄')
    expect(block).toMatch(/<video id="Lvid" [^>]*data-start="0" data-duration="8\.000"[^>]* muted data-volume="0"/)
    expect(block).not.toContain('passwd')
    expect(block).not.toContain('no-L-prefix')
    // idempotent, and gone when there is nothing to write
    expect(applyLayers(out, o)).toBe(out)
    expect(applyLayers(out, emptyOverrides())).toBe(applyLayers(html, emptyOverrides()))
  })
  it('only show files inside the project', () => {
    expect(safeSrc('assets/a.png')).toBe('assets/a.png')
    expect(safeSrc('./assets/a.png')).toBe('assets/a.png')
    expect(safeSrc('https://x.com/a.png')).toBeNull()
    expect(safeSrc('/etc/a.png')).toBeNull()
    expect(safeSrc('assets/../../a.png')).toBeNull()
  })
})
