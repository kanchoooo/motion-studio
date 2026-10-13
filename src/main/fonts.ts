// System font scan (macOS + Windows) with localized Korean family names.
// Result is cached and only rescanned when a font folder changes.
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import * as fontkit from 'fontkit'
import type { FontFace, FontFamily } from '@shared/api'
import { dataDir } from './paths'
import { readJson, writeJson } from './util'

const EXT = new Set(['.ttf', '.otf', '.ttc', '.otc'])

export function fontDirs(): string[] {
  if (process.platform === 'win32') {
    return [
      join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
      join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts'),
    ]
  }
  return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')]
}

function* walk(dir: string, depth = 0): Generator<string> {
  let ents: import('node:fs').Dirent[] = []
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth < 2) yield* walk(p, depth + 1)
    else if (EXT.has(extname(e.name).toLowerCase())) yield p
  }
}

type FkFont = {
  familyName: string
  subfamilyName: string
  postscriptName: string
  getName(key: string, lang?: string): string | null
  hasGlyphForCodePoint(cp: number): boolean
  'OS/2'?: { usWeightClass?: number; fsSelection?: { italic?: boolean } }
}

function nameOf(f: FkFont, key: string, lang: string): string | null {
  try {
    return f.getName(key, lang)
  } catch {
    return null
  }
}

function signature(): string {
  return fontDirs()
    .map((d) => {
      try {
        return `${d}:${statSync(d).mtimeMs}`
      } catch {
        return `${d}:-`
      }
    })
    .join('|')
}

function scan(): FontFamily[] {
  const families = new Map<string, FontFamily>()
  for (const dir of fontDirs()) {
    for (const file of walk(dir)) {
      let list: FkFont[]
      try {
        const opened = fontkit.openSync(file) as unknown as FkFont & { fonts?: FkFont[] }
        list = opened.fonts ? opened.fonts : [opened]
      } catch {
        continue
      }
      list.forEach((f, index) => {
        const family = nameOf(f, 'preferredFamily', 'en') || f.familyName
        if (!family || family.startsWith('.')) return // hidden system faces
        const face: FontFace = {
          file,
          index,
          style: nameOf(f, 'preferredSubfamily', 'en') || f.subfamilyName || 'Regular',
          weight: f['OS/2']?.usWeightClass ?? 400,
          italic: !!f['OS/2']?.fsSelection?.italic,
          postscript: f.postscriptName,
        }
        let g = families.get(family)
        if (!g) {
          const ko = nameOf(f, 'preferredFamily', 'ko') || nameOf(f, 'fontFamily', 'ko')
          g = { family, familyKo: ko && ko !== family ? ko : undefined, hangul: false, weights: [], faces: [] }
          families.set(family, g)
        }
        g.faces.push(face)
        if (!g.weights.includes(face.weight)) g.weights.push(face.weight)
        if (!g.hangul) {
          try {
            g.hangul = f.hasGlyphForCodePoint(0xac00)
          } catch {
            /* ignore */
          }
        }
      })
    }
  }
  const out = [...families.values()]
  out.forEach((g) => g.weights.sort((a, b) => a - b))
  const display = (g: FontFamily) => g.familyKo ?? g.family
  return out.sort((a, b) => Number(b.hangul) - Number(a.hangul) || display(a).localeCompare(display(b), 'ko'))
}

let cache: FontFamily[] | null = null

export function listFonts(force = false): FontFamily[] {
  if (cache && !force) return cache
  const cachePath = join(dataDir(), 'fonts-cache.json')
  const sig = signature()
  const saved = readJson<{ sig: string; families: FontFamily[] } | null>(cachePath, null)
  if (!force && saved && saved.sig === sig) {
    cache = saved.families
    return cache
  }
  cache = scan()
  writeJson(cachePath, { sig, families: cache })
  return cache
}

/** true when the family name (English or Korean) is installed */
export function hasFont(name: string): boolean {
  const n = name.replace(/["']/g, '').trim().toLowerCase()
  return listFonts().some((g) => g.family.toLowerCase() === n || g.familyKo?.toLowerCase() === n)
}
