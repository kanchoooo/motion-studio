// 편집 정리: Claude builds a video without thinking about editing; afterwards the app finds what
// the designer could not pick on its own yet (text, pictures, clips and SVGs that sit in no
// named layer) and asks Claude to name them — attributes only — while it photographs the same
// moments before and after to make sure nothing on screen changed.
import { layoutSnapshot, openComposition } from './editReady'

export interface Unnamed {
  count: number
  /** a few of them, for the request ("메인 타이틀 문구", "img") */
  samples: string[]
}

/** visible content outside every [data-ms-id] (a named layer or a named group around it) */
export async function unnamedContent(projectDir: string, size: { width: number; height: number }): Promise<Unnamed> {
  const h = await openComposition(projectDir, size)
  try {
    return await h.js<Unnamed>(`(() => {
      const root = document.querySelector('[data-composition-id]') || document.body
      const out = []
      for (const el of root.querySelectorAll('*')) {
        if (/^(SCRIPT|STYLE|TEMPLATE|AUDIO|SOURCE|TRACK|BR|META|LINK|TITLE|NOSCRIPT)$/.test(el.tagName)) continue
        if (el.closest('[data-ms-id]')) continue
        const tag = el.tagName.toLowerCase()
        if (el.closest('svg') && tag !== 'svg') continue
        const pic = /^(img|video|canvas|svg|picture)$/.test(tag)
        let own = ''
        for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue
        own = own.replace(/\\s+/g, ' ').trim()
        if (!pic && !own) continue
        // a picture inside a picture (<picture><img>) counts once
        if (pic && el.parentElement && el.parentElement.closest('picture, svg') && tag !== 'picture') continue
        out.push(pic ? tag : own.slice(0, 24))
      }
      return { count: out.length, samples: out.slice(0, 12) }
    })()`)
  } finally {
    h.close()
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
