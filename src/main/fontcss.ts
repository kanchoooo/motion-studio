// Generates composition/ms/fonts.css: an explicit @font-face (src: local(...))
// for every installed system font the video uses. HyperFrames treats fonts
// without @font-face as an error and skips its browser checks; local()
// declarations satisfy it and pin each weight to the exact installed face.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, relative, isAbsolute } from 'node:path'
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
  // (a quoted name never holds < > or a line break: the quote closing a style attribute is not one)
  for (const m of html.matchAll(/font-family\s*:\s*((?:"[^"<>\n]*"|'[^'<>\n]*'|[^;}"'<>])+)/gi)) add(m[1].replace(/!important/i, ''))
  for (const m of html.matchAll(/fontFamily\s*:\s*['"]([^'"]+)['"]/g)) add(m[1])
  for (const m of html.matchAll(/font\s*:\s*[^;}"<>]*?\d(?:px|rem|em|vw|vh|vmin|vmax|pt|%)(?:\/[\d.]+[a-z%]*)?\s+((?:"[^"<>\n]*"|'[^'<>\n]*'|[^;}"'<>])+)/gi)) add(m[1])
  // SVG text (font-family="…") and families kept in custom properties (font-family: var(--brand-font))
  for (const m of html.matchAll(/\sfont-family=(["'])([^"']+)\1/gi)) add(m[2])
  const vars = new Map<string, string>()
  for (const m of html.matchAll(/(--[\w-]+)\s*:\s*((?:"[^"<>\n]*"|'[^'<>\n]*'|[^;}"'<>])+)/g)) vars.set(m[1], m[2])
  for (const m of html.matchAll(/font(?:-family)?\s*:[^;}<>]*?var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/gi)) {
    const v = vars.get(m[1])
    if (v) add(v)
    if (m[2]) add(m[2])
  }
  for (const e of Object.values(overrides.elements)) if (e.style?.fontFamily) add(e.style.fontFamily)
  return [...names]
}

const loose = (s?: string) => (s ?? '').toLowerCase().replace(/[\s_-]+/g, '')
/**
 * The installed family a CSS name means: its family name (English or Korean), or — the way a page
 * often names a font that ships one file per weight ('GmarketSansMedium', 'Gmarket Sans Bold') —
 * one of its faces, in which case the whole family answers to that name (as Chrome resolves it).
 */
export function findFamily(name: string, fonts: FontFamily[] = listFonts()): FontFamily | undefined {
  const n = name.toLowerCase()
  const exact = fonts.find((g) => g.family.toLowerCase() === n || g.familyKo?.toLowerCase() === n)
  if (exact) return exact
  const l = loose(name)
  if (l.length < 4) return undefined
  return fonts.find((g) => loose(g.family) === l || loose(g.familyKo) === l) ?? fonts.find((g) => g.faces.some((f) => loose(f.postscript) === l))
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

// ---- the same faces inside index.html ----------------------------------------------
// HyperFrames, when it renders (export, snapshots, checks), adds @font-face rules of its own for
// every family the page names that has no @font-face IN THE PAGE ITSELF — linked stylesheets are
// not read — and puts them after every stylesheet. Its rules for installed fonts guess the weights
// from file names (a family may keep only one weight), so text exported thinner or bolder than
// the preview. The faces the page links (ms/fonts.css, downloaded web fonts) are therefore also
// written into the page, in a block the app manages: HyperFrames leaves those families alone.
const OPEN = '<!-- ms:fonts (모션스튜디오가 관리하는 글꼴: 지우지 마세요) -->'
const CLOSE = '<!-- /ms:fonts -->'
const BLOCK = /[ \t]*<!-- ms:fonts[^>]*-->[\s\S]*?<!-- \/ms:fonts -->[ \t]*\n?/

/** @font-face rules of the local stylesheets the page links, their url()s made relative to the page */
export function linkedFontFaces(compDir: string, html: string): string {
  const out: string[] = []
  for (const m of html.replace(BLOCK, '').matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?stylesheet/i.test(m[0])) continue
    const href = m[0].match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href || /^([a-z]+:|\/\/|\/)/i.test(href)) continue
    const path = decodeURI(href.split(/[?#]/)[0]).replace(/^\.\//, '')
    const file = join(compDir, path)
    const rel = relative(compDir, file)
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(file)) continue
    const dir = posix.dirname(path)
    for (const face of readFileSync(file, 'utf8').match(/@font-face\s*\{[^}]*\}/gi) ?? []) {
      out.push(face.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q: string, u: string) => (/^(data:|[a-z]+:|\/)/i.test(u) ? all : `url(${q}${posix.normalize(posix.join(dir, u))}${q})`)))
    }
  }
  return out.join('\n')
}

/** the page with the managed font block brought up to date (null = nothing to change) */
export function withFontBlock(html: string, faces: string): string | null {
  const block = faces ? `${OPEN}\n<style data-ms-fonts>\n${faces}\n</style>\n${CLOSE}\n` : ''
  let out: string
  if (BLOCK.test(html)) out = html.replace(BLOCK, block)
  else if (!block) return null
  else {
    // at the end of the head (after the stylesheets it repeats)
    const at = ['</head>', '<body'].map((t) => html.toLowerCase().indexOf(t)).find((i) => i >= 0) ?? -1
    if (at < 0) return null
    out = html.slice(0, at) + block + html.slice(at)
  }
  return out === html ? null : out
}
