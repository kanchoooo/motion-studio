// Claude writes compositions the plain HyperFrames way, so the lines Motion Studio needs at the
// top of <head> (local GSAP, the fonts it found, the designer's edits, the runtime) may be
// missing or out of order, and GSAP may come from a CDN. The app repairs the head instead of
// asking Claude to keep a contract: CDN GSAP (and its plugins the app has a copy of) point at
// local copies in vendor/, and the four app lines go to the top of <head>, before any script.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeText } from './util'

export const APP_HEAD = ['<script src="vendor/gsap.min.js"></script>', '<link rel="stylesheet" href="ms/fonts.css" />', '<script src="ms/overrides.js"></script>', '<script src="ms/runtime.js"></script>']
const MARK = '<!-- 모션스튜디오: 앱이 관리하는 줄 (지우지 마세요) -->'

// https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/ScrollTrigger.min.js · https://unpkg.com/gsap@3/dist/gsap.min.js ·
// https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/SplitText.min.js (the whole tag, to drop integrity / crossorigin)
const CDN_GSAP = /<script\b([^>]*?)\bsrc=(["'])https?:\/\/[^"']*\bgsap\b[^"']*?\/([A-Za-z0-9]+)(?:\.min)?\.js\2([^>]*)>/gi

/** any form of the app's own tags (./vendor/…, other attributes, another order), with the rest of its line */
const APP_TAG = /[ \t]*(?:<script\b[^>]*\bsrc=["'](?:\.\/)?(?:vendor\/gsap\.min\.js|ms\/overrides\.js|ms\/runtime\.js)["'][^>]*>\s*<\/script>|<link\b[^>]*\bhref=["'](?:\.\/)?ms\/fonts\.css["'][^>]*>)[ \t]*\n?/gi
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** where the head ends: </head>, else <body>, else the composition root (a head may be left unclosed) */
function headEnd(html: string): number {
  for (const re of [/<\/head>/i, /<body\b/i, /<[a-z]+\b[^>]*data-composition-id=/i]) {
    const i = html.search(re)
    if (i >= 0) return i
  }
  return html.length
}

/**
 * The html with a repaired head, plus the GSAP files it now loads from vendor/ (null = nothing to
 * change). `has(file)` says whether the app has a local copy of a GSAP file (others stay on the CDN).
 */
export function repairHead(html: string, has: (file: string) => boolean = () => true): { html: string; vendor: string[] } | null {
  if (!/data-composition-id=/.test(html)) return null
  const vendor = new Set<string>()
  let out = html.replace(CDN_GSAP, (tag, pre: string, _q: string, name: string, post: string) => {
    const file = `${name === 'gsap' ? 'gsap' : name}.min.js`
    if (name !== 'gsap' && (name === 'all' || !has(file))) return tag
    vendor.add(file)
    // the local copy has another hash: integrity / crossorigin would block it
    const keep = `${pre} ${post}`.replace(/\s(integrity|crossorigin|referrerpolicy)(=("[^"]*"|'[^']*'|[^\s>]*))?/gi, '').replace(/\s+/g, ' ').trim()
    return `<script src="vendor/${file}"${keep ? ` ${keep}` : ''}>`
  })
  // already in place: the four lines exactly once (no other form anywhere), in order, before any other script
  const end = headEnd(out)
  const head = out.slice(0, end)
  const found = [...out.matchAll(APP_TAG)].map((m) => m[0].trim())
  const at = APP_HEAD.map((l) => head.indexOf(l))
  const inPlace = found.length === 4 && found.every((t, k) => t === APP_HEAD[k]) && at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])) && head.search(/<script\b/i) === at[0]
  if (!inPlace) {
    // every copy of the app lines comes out (wherever Claude moved them), then they go to the top of the head:
    // after <meta charset> when it comes first, and always before the first script
    out = out.replace(APP_TAG, '').replace(new RegExp(`[ \\t]*${escapeRe(MARK)}[ \\t]*\\n?`, 'g'), '')
    const block = `\n    ${MARK}\n    ${APP_HEAD.join('\n    ')}\n`
    const e = headEnd(out)
    const firstScript = out.slice(0, e).search(/<script\b/i)
    const charset = out.slice(0, e).match(/<meta\b[^>]*charset[^>]*>/i)
    const headOpen = out.slice(0, e).match(/<head\b[^>]*>/i)
    let pos = charset ? charset.index! + charset[0].length : headOpen ? headOpen.index! + headOpen[0].length : -1
    if (firstScript >= 0 && (pos < 0 || firstScript < pos)) pos = firstScript
    if (pos >= 0) out = out.slice(0, pos) + block + out.slice(pos)
    else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b[^>]*>/i, (m) => `${m}\n  <head>${block}  </head>`)
    else out = `<head>${block}</head>\n${out}`
  }
  if (out === html) return null
  vendor.delete('gsap.min.js')
  return { html: out, vendor: [...vendor] }
}

/** the GSAP file a composition may load from vendor/ (the app ships the whole gsap dist) */
export const gsapFileIn = (gsapDist: string) => (file: string) => /^[A-Za-z0-9]+\.min\.js$/.test(file) && existsSync(join(gsapDist, file))

/** repairs composition/index.html on disk (and copies the GSAP plugins it now needs); true when it changed */
export function repairCompositionHead(projectDir: string, gsapDist: string): boolean {
  const index = join(projectDir, 'composition', 'index.html')
  if (!existsSync(index)) return false
  const r = repairHead(readFileSync(index, 'utf8'), gsapFileIn(gsapDist))
  if (!r) return false
  for (const f of r.vendor) {
    const dst = join(projectDir, 'composition', 'vendor', f)
    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(join(gsapDist, f), dst)
    }
  }
  writeText(index, r.html)
  return true
}
