// Generates composition/ms/fonts.css: an explicit @font-face (src: local(...))
// for every installed system font the video uses. HyperFrames treats fonts
// without @font-face as an error and skips its browser checks; local()
// declarations satisfy it and pin each weight to the exact installed face.
import type { FontFamily } from '@shared/api'
import type { Overrides } from '@shared/overrides'
import { listFonts } from './fonts'

const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'inherit', 'initial', 'unset', 'emoji', 'math'])

/** font-family names used by the composition and the designer's overrides */
export function usedFamilies(html: string, overrides: Overrides): string[] {
  const names = new Set<string>()
  const add = (list: string) => {
    for (const raw of list.split(',')) {
      const n = raw.trim().replace(/^['"]|['"]$/g, '').trim()
      if (n && !GENERIC.has(n.toLowerCase()) && !n.startsWith('var(') && !n.startsWith('-apple-system')) names.add(n)
    }
  }
  // a value is a run of quoted names and plain characters; it ends at ; } < > or the quote closing a style attribute
  for (const m of html.matchAll(/font-family\s*:\s*((?:"[^"]*"|'[^']*'|[^;}"'<>])+)/gi)) add(m[1].replace(/!important/i, ''))
  for (const m of html.matchAll(/fontFamily\s*:\s*['"]([^'"]+)['"]/g)) add(m[1])
  for (const m of html.matchAll(/font\s*:\s*[^;}"<>]*?\d+px(?:\/[\d.]+)?\s+((?:"[^"]*"|'[^']*'|[^;}"'<>])+)/gi)) add(m[1])
  for (const e of Object.values(overrides.elements)) if (e.style?.fontFamily) add(e.style.fontFamily)
  return [...names]
}

export function findFamily(name: string, fonts: FontFamily[] = listFonts()): FontFamily | undefined {
  const n = name.toLowerCase()
  return fonts.find((g) => g.family.toLowerCase() === n || g.familyKo?.toLowerCase() === n)
}

export function fontCss(html: string, overrides: Overrides): { css: string; missing: string[] } {
  const fonts = listFonts()
  const rules: string[] = ['/* 모션스튜디오가 자동으로 만드는 파일입니다. 직접 수정하지 마세요. */']
  const missing: string[] = []
  for (const name of usedFamilies(html, overrides)) {
    const fam = findFamily(name, fonts)
    if (!fam) {
      missing.push(name)
      continue
    }
    const safe = name.replace(/["\\]/g, '')
    for (const face of fam.faces) {
      const ps = face.postscript?.replace(/["\\]/g, '')
      if (!ps) continue
      rules.push(
        `@font-face { font-family: "${safe}"; src: local("${ps}"); font-weight: ${face.weight}; font-style: ${face.italic ? 'italic' : 'normal'}; }`,
      )
    }
  }
  return { css: rules.join('\n') + '\n', missing }
}
