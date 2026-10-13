import { describe, expect, it } from 'vitest'
import { emptyBrief, normalizeBrief, type Brief } from '@shared/brief'

describe('brief', () => {
  it('new briefs let Claude design the background and have an empty storyboard', () => {
    const b = emptyBrief('t')
    expect(b.output.background).toBe('auto')
    expect(b.storyboard).toEqual([])
    expect(b.ai.narration.enabled).toBe(false)
  })

  it('old briefs get the new fields without losing their own values', () => {
    const old = { ...emptyBrief('old'), output: { ...emptyBrief('old').output, background: 'color', backgroundColor: '#123456' } } as Partial<Brief>
    delete old.storyboard
    delete old.ai
    const b = normalizeBrief(old)
    expect(b.output.background).toBe('color')
    expect(b.output.backgroundColor).toBe('#123456')
    expect(b.storyboard).toEqual([])
    expect(b.ai).toEqual({ image: null, video: null, narration: { enabled: false, script: '', note: '' }, artlist: false })
  })
})
