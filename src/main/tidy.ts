// 편집 정리: Claude builds a video without thinking about editing; afterwards the app finds what
// the designer could not pick on its own yet (text, pictures, clips, SVGs and coloured boxes that
// sit in no named layer, and text that carries its own background box) and asks Claude to name
// them — and to split a text from its box — while it photographs the same moments before and after
// to make sure nothing on screen changed. After that, every turn is checked the same way.
import { isPartId, PART_SEP, type Overrides } from '@shared/overrides'
import { layoutSnapshot, openComposition } from './editReady'

export interface Unnamed {
  count: number
  /** a few of them, for the request ("메인 타이틀 문구", "img") */
  samples: string[]
}

export interface LayerAudit {
  /** every layer id on the page (Claude's, the app's own for loose text and boxes, the designer's) */
  ids: string[]
  /** layers Claude named itself (the app's own ones are not counted) */
  named: number
  /** the root still says there is no video (data-ms-empty) */
  empty: boolean
  /** visible content outside every named layer */
  unnamed: Unnamed
  /** text layers that carry their own coloured box (background / border on the text itself) */
  boxedTexts: { id: string; label: string }[]
}

/** the page-side part of auditLayers (an expression the page evaluates) */
export const AUDIT_SCRIPT = `(() => {
      const root = document.querySelector('[data-composition-id]') || document.body
      const seen = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return !!c && c !== 'transparent'; const a = m[1].split(',')[3]; return a == null || parseFloat(a) > 0 }
      const painted = (cs) => seen(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none') || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && seen(cs.borderTopColor))
      const out = []
      for (const el of root.querySelectorAll('*')) {
        if (/^(SCRIPT|STYLE|TEMPLATE|AUDIO|SOURCE|TRACK|BR|META|LINK|TITLE|NOSCRIPT)$/.test(el.tagName)) continue
        // inside a named layer, or the app's own wrapper around one: editable already
        if (el.closest('[data-ms-id]') || el.hasAttribute('data-ms-wrap-for')) continue
        const tag = el.tagName.toLowerCase()
        if (el.closest('svg') && tag !== 'svg') continue
        const pic = /^(img|video|canvas|svg|picture)$/.test(tag)
        let own = ''
        for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue
        own = own.replace(/\\s+/g, ' ').trim()
        // a plain coloured box: painted, nothing inside it, big enough to pick
        let box = false
        if (!pic && !own && !el.querySelector('img,video,canvas,svg,picture') && !(el.textContent || '').trim()) {
          const r = el.getBoundingClientRect()
          box = r.width >= 6 && r.height >= 6 && painted(getComputedStyle(el))
        }
        if (!pic && !own && !box) continue
        // a picture inside a picture (<picture><img>) counts once
        if (pic && el.parentElement && el.parentElement.closest('picture, svg') && tag !== 'picture') continue
        out.push(pic ? tag : box ? '색 상자' : own.slice(0, 24))
      }
      const all = [...document.querySelectorAll('[data-ms-id]')]
      const boxedTexts = all
        .filter((e) => {
          if (e.hasAttribute('data-ms-auto') || e.getAttribute('data-ms-type') !== 'text' || !(e.textContent || '').trim()) return false
          const cs = getComputedStyle(e)
          // a gradient or picture clipped to the letters colours the text: no box behind it
          return painted(cs) && !/text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '')
        })
        .map((e) => ({ id: e.getAttribute('data-ms-id'), label: e.getAttribute('data-ms-label') || e.getAttribute('data-ms-id') }))
      return {
        ids: all.map((e) => e.getAttribute('data-ms-id')),
        named: all.filter((e) => !e.hasAttribute('data-ms-auto') && !String(e.getAttribute('data-ms-id')).includes('~')).length,
        empty: root.hasAttribute('data-ms-empty'),
        unnamed: { count: out.length, samples: out.slice(0, 12) },
        boxedTexts,
      }
    })()`

/**
 * What the designer can and cannot pick in the composition: content outside every [data-ms-id]
 * (text, pictures, clips, SVGs and plain coloured boxes — a named layer or a named group around it
 * makes them editable), and text layers whose background box is part of the text.
 */
export async function auditLayers(projectDir: string, size: { width: number; height: number }): Promise<LayerAudit> {
  const h = await openComposition(projectDir, size)
  try {
    return await h.js<LayerAudit>(AUDIT_SCRIPT)
  } finally {
    h.close()
  }
}

/** visible content outside every [data-ms-id] (a named layer or a named group around it) */
export async function unnamedContent(projectDir: string, size: { width: number; height: number }): Promise<Unnamed> {
  return (await auditLayers(projectDir, size)).unnamed
}

/** what a turn's audit means for a project the designer edits by hand */
export interface AuditVerdict {
  /** no layers left (rebuilt without names, or marked empty): back to view-only */
  lost: boolean
  /** edited layers that are gone (names), the locked ones apart */
  gone: string[]
  lockedGone: string[]
  /** text layers to split from their box (not asked before) */
  split: { id: string; label: string }[]
  /** ask Claude to name / split now (once per designer request) */
  ask: boolean
  /** asked already for this request: what is still out of reach */
  stillUnnamed: number
}
export function auditVerdict(
  a: LayerAudit,
  ov: Pick<Overrides, 'elements' | 'layers' | 'duplicates'>,
  opts: { askedSplit: Set<string>; askedThisRequest: boolean; camera: string },
): AuditVerdict {
  if (a.empty || !a.named) return { lost: true, gone: [], lockedGone: [], split: [], ask: false, stillUnnamed: 0 }
  const here = new Set(a.ids)
  // what exists only while the video plays (the app's runtime makes it): copies and what is inside
  // them ("child@copy"), a character's parts ("<layer>::<part>"), text and boxes the app named in a
  // group ("<group>~<path>") — they live as long as their layer does (the same rules as checks.ts)
  const copies = new Set(ov.duplicates.map((d) => d.id))
  const runtimeOnly = (k: string) =>
    copies.has(k) || copies.has(k.split('@').pop() ?? '') || (isPartId(k) && here.has(k.split(PART_SEP)[0])) || (k.includes('~') && here.has(k.split('~')[0]))
  const goneIds = Object.keys(ov.elements).filter(
    (k) => k !== opts.camera && !here.has(k) && !runtimeOnly(k) && !ov.layers.some((x) => x.id === k) && Object.keys(ov.elements[k]).some((f) => f !== 'label'),
  )
  const name = (k: string) => ov.elements[k].label ?? k
  const split = a.boxedTexts.filter((x) => !opts.askedSplit.has(x.id))
  const want = a.unnamed.count > 0 || split.length > 0
  return {
    lost: false,
    gone: goneIds.filter((k) => !ov.elements[k].locked).map(name),
    lockedGone: goneIds.filter((k) => ov.elements[k].locked).map(name),
    split,
    ask: want && !opts.askedThisRequest,
    stillUnnamed: want && opts.askedThisRequest ? a.unnamed.count : 0,
  }
}

const SET = 'tidy-check'

/** the moments compared before and after 편집 정리 (12 spread over the video) */
export const tidyTimes = (duration: number) => Array.from({ length: 12 }, (_, i) => +(((i + 0.5) * duration) / 12).toFixed(2))

export const tidyBefore = (projectDir: string, size: { width: number; height: number; duration: number }) => layoutSnapshot(projectDir, size, 'before', tidyTimes(size.duration), SET)

/** what changed on screen since tidyBefore (worst moment first); empty when the look held */
export async function tidyAfter(projectDir: string, size: { width: number; height: number; duration: number }): Promise<{ t: number; changedPct: number; diff?: string }[]> {
  const r = await layoutSnapshot(projectDir, size, 'after', undefined, SET)
  // anti-aliasing and font hinting differ by a few pixels at most
  return (r.results ?? []).filter((x) => x.changedPct > 0.3).sort((a, b) => b.changedPct - a.changedPct)
}
