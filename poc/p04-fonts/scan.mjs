// P0-4: enumerate system fonts (mac + win dirs) with localized family names, weights, file paths
import * as fontkit from 'fontkit'
import { readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const dirs = process.platform === 'win32'
  ? [join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')]
  : ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')]
const EXT = new Set(['.ttf', '.otf', '.ttc', '.otc'])

function* walk(d, depth = 0) {
  let ents = []
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = join(d, e.name)
    if (e.isDirectory() && depth < 2) yield* walk(p, depth + 1)
    else if (EXT.has(extname(e.name).toLowerCase())) yield p
  }
}
const name = (f, key, lang) => { try { return f.getName(key, lang) } catch { return null } }
const t0 = Date.now()
const faces = []
let errors = 0
for (const d of dirs) for (const file of walk(d)) {
  try {
    const opened = fontkit.openSync(file)
    const list = opened.fonts ? opened.fonts : [opened]
    list.forEach((f, index) => {
      const fam = name(f, 'preferredFamily', 'en') || f.familyName
      faces.push({
        file, index,
        family: fam,
        familyKo: name(f, 'preferredFamily', 'ko') || name(f, 'fontFamily', 'ko'),
        style: name(f, 'preferredSubfamily', 'en') || f.subfamilyName,
        postscript: f.postscriptName,
        weight: f['OS/2']?.usWeightClass ?? 400,
        italic: !!(f['OS/2']?.fsSelection?.italic),
        hangul: f.hasGlyphForCodePoint?.(0xAC00) ?? false,
      })
    })
  } catch { errors++ }
}
const families = new Map()
for (const f of faces) {
  const k = f.family
  if (!families.has(k)) families.set(k, { family: k, familyKo: f.familyKo, hangul: false, weights: new Set(), faces: 0 })
  const g = families.get(k); g.faces++; g.hangul ||= f.hangul; g.weights.add(f.weight); g.familyKo ||= f.familyKo
}
const ko = [...families.values()].filter((g) => g.hangul)
console.log(`faces=${faces.length} families=${families.size} hangulFamilies=${ko.length} errors=${errors} elapsed=${Date.now() - t0}ms`)
for (const g of ko.slice(0, 40)) console.log(`  ${g.family}${g.familyKo ? ' / ' + g.familyKo : ''}  weights=${[...g.weights].sort().join(',')}`)
