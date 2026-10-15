// Claude changing the designer's own edits (update_designer_edits) instead of throwing them
// away: merged field by field; what does not belong in an edit is reported, not stored.
import { isKeyProp, sortedKeys, WIGGLE_PROPS, type ElementOverride, type Keyframe } from '@shared/overrides'

const OBJECTS = ['transform', 'style', 'effects'] as const
const PLAIN = ['mask', 'counter', 'trim', 'textAnim', 'inPoint', 'outPoint', 'hidden', 'label', 'text', 'src', 'animSpeed', 'timing', 'deleted', 'textRuns', 'highlights', 'textKeys', 'parent', 'moveTo', 'matte', 'motionBlur', 'videoFx'] as const

function keyList(v: unknown): Keyframe[] | null {
  if (!Array.isArray(v)) return null
  const out: Keyframe[] = []
  for (const k of v) {
    if (!k || typeof k !== 'object') continue
    const r = k as Record<string, unknown>
    const t = Number(r.t)
    const val = typeof r.v === 'string' ? r.v : Number(r.v)
    if (!Number.isFinite(t) || (typeof val === 'number' && !Number.isFinite(val))) continue
    out.push({ t: Math.max(0, t), v: val, ...(typeof r.e === 'string' ? { e: r.e } : {}) })
  }
  return sortedKeys(out)
}

const withoutNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null))

export function mergeDesignerPatch(cur: ElementOverride, patch: Record<string, unknown>): { merged: ElementOverride; problems: string[] } {
  const out = structuredClone(cur) as Record<string, unknown>
  const problems: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if ((OBJECTS as readonly string[]).includes(k)) {
      if (v === null) delete out[k]
      else if (typeof v !== 'object' || Array.isArray(v)) problems.push(`${k}: must be an object`)
      else out[k] = withoutNulls({ ...((out[k] as Record<string, unknown>) ?? {}), ...(v as Record<string, unknown>) })
    } else if (k === 'keys' || k === 'own') {
      if (v === null) {
        delete out[k]
        continue
      }
      if (typeof v !== 'object' || Array.isArray(v)) {
        problems.push(`${k}: must be { property: keyframes[] }`)
        continue
      }
      const target = { ...((out[k] as Record<string, Keyframe[]>) ?? {}) }
      for (const [p, list] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'keys' && !isKeyProp(p)) {
          problems.push(`keys.${p}: not a designer property (see propertyCatalog); properties of your own motion go under own`)
          continue
        }
        if (list === null) {
          delete target[p]
          continue
        }
        const ks = keyList(list)
        if (!ks) problems.push(`${k}.${p}: must be a list of keyframes { t, v, e }`)
        else if (ks.length) target[p] = ks
        else delete target[p]
      }
      out[k] = target
    } else if (k === 'loops') {
      if (v === null) delete out.loops
      else if (typeof v === 'object' && !Array.isArray(v)) {
        const ok = Object.entries(v as Record<string, unknown>).filter(([, m]) => m === null || m === 'cycle' || m === 'pingpong')
        out.loops = withoutNulls({ ...((out.loops as Record<string, unknown>) ?? {}), ...Object.fromEntries(ok) })
      } else problems.push('loops: must be { property: "cycle" | "pingpong" | null }')
    } else if (k === 'wiggle') {
      if (v === null) delete out.wiggle
      else if (typeof v === 'object' && !Array.isArray(v)) {
        const next = { ...((out.wiggle as Record<string, unknown>) ?? {}) }
        for (const [p, w] of Object.entries(v as Record<string, unknown>)) {
          if (!(WIGGLE_PROPS as readonly string[]).includes(p)) problems.push(`wiggle.${p}: one of ${WIGGLE_PROPS.join(', ')}`)
          else if (w === null) delete next[p]
          else if (w && typeof w === 'object' && Number.isFinite(Number((w as Record<string, unknown>).freq)) && Number.isFinite(Number((w as Record<string, unknown>).amount)))
            next[p] = { freq: Number((w as Record<string, unknown>).freq), amount: Number((w as Record<string, unknown>).amount) }
          else problems.push(`wiggle.${p}: { freq, amount }`)
        }
        out.wiggle = next
      }
    } else if ((PLAIN as readonly string[]).includes(k)) {
      if (v === null) delete out[k]
      else out[k] = v
    } else if (k === 'locked') problems.push('locked: only the designer locks or unlocks layers')
    else problems.push(`${k}: not an edit field`)
  }
  return { merged: out as ElementOverride, problems }
}
