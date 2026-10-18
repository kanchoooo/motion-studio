// The editor saves its whole copy of the designer's edits. When something else changed the file
// since the editor loaded it (Claude's update_designer_edits, a restore, another window), the two
// are merged instead of the editor's copy writing the other change away: per layer (and per sound
// edit, motion edit, stacking group…), the side that changed it wins; where both changed the same
// layer, the editor (the designer's latest action) wins.
import type { Overrides } from './overrides'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function mergeRecord<T>(base: Record<string, T> | undefined, ours: Record<string, T> | undefined, theirs: Record<string, T> | undefined): Record<string, T> {
  const b = base ?? {}
  const o = ours ?? {}
  const t = theirs ?? {}
  const out: Record<string, T> = {}
  for (const k of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const mine = !same(b[k], o[k])
    const v = mine ? o[k] : t[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/** the editor's copy (ours, edited from `base`) merged with what is on disk now (theirs) */
export function mergeOverrides(base: Overrides, ours: Overrides, theirs: Overrides): Overrides {
  const out = { ...theirs } as Record<string, unknown>
  const b = base as unknown as Record<string, unknown>
  const o = ours as unknown as Record<string, unknown>
  const t = theirs as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const isRecord = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
    if (isRecord(o[k]) && isRecord(t[k]) && (b[k] === undefined || isRecord(b[k])) && k !== 'guides') {
      out[k] = mergeRecord(b[k] as Record<string, unknown>, o[k] as Record<string, unknown>, t[k] as Record<string, unknown>)
    } else if (!same(b[k], o[k])) {
      if (o[k] === undefined) delete out[k]
      else out[k] = o[k]
    }
  }
  return out as unknown as Overrides
}
