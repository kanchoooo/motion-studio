// Free web fonts kept inside the project: Claude may pick a typeface that is not
// installed (when the brief does not name one). The files are downloaded once into
// composition/fonts/ (Google Fonts, or Pretendard) and declared in
// composition/fonts/web-fonts.css with relative URLs, so preview and export work
// offline and render the same every time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './util'

export interface WebFont {
  family: string
  weights: number[]
  source: 'google' | 'pretendard'
  /** css file inside composition/fonts/ */
  css: string
}

const fontsDir = (projectDir: string) => join(projectDir, 'composition', 'fonts')
const indexFile = (projectDir: string) => join(fontsDir(projectDir), 'web-fonts.json')
export const listWebFonts = (projectDir: string) => readJson<WebFont[]>(indexFile(projectDir), [])

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font'
// Google serves woff2 with unicode-range subsets to current browsers
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

async function download(url: string, file: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`폰트 파일을 받지 못했어요 (${r.status})`)
  writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

const PRETENDARD: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }

/** @font-face rules for the family with files downloaded into fonts/<slug>/ */
async function fetchFaces(projectDir: string, family: string, weights: number[]): Promise<{ css: string; weights: number[]; source: WebFont['source'] }> {
  const dir = join(fontsDir(projectDir), slug(family))
  mkdirSync(dir, { recursive: true })
  if (/^pretendard$/i.test(family.trim())) {
    const rules: string[] = []
    const got: number[] = []
    for (const w of weights) {
      const name = PRETENDARD[Math.round(w / 100) * 100]
      if (!name) continue
      const file = `Pretendard-${name}.woff2`
      // the npm package (the GitHub one is over jsDelivr's size limit)
      await download(`https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/${file}`, join(dir, file))
      rules.push(`@font-face{font-family:'Pretendard';font-style:normal;font-weight:${w};font-display:block;src:url('${slug(family)}/${file}') format('woff2')}`)
      got.push(w)
    }
    return { css: rules.join('\n'), weights: got, source: 'pretendard' }
  }
  // Google Fonts: ask for all the weights; a weight the family does not have makes the request fail, so retry one by one
  const ask = async (ws: number[]) => {
    const q = `family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}${ws.length ? `:wght@${ws.join(';')}` : ''}&display=block`
    const r = await fetch(`https://fonts.googleapis.com/css2?${q}`, { headers: { 'User-Agent': UA } })
    return r.ok ? r.text() : null
  }
  let css = await ask(weights)
  let got = weights
  if (!css) {
    const parts: string[] = []
    got = []
    for (const w of weights) {
      const one = await ask([w])
      if (one) {
        parts.push(one)
        got.push(w)
      }
    }
    css = parts.join('\n')
    if (!css) {
      const regular = await ask([])
      if (!regular) throw new Error(`"${family}" 폰트를 Google Fonts에서 찾지 못했어요. 이름(대소문자·띄어쓰기)을 확인하거나 다른 폰트를 골라 주세요.`)
      css = regular
      got = [400]
    }
  }
  // every remote file → local, in the order they appear
  let n = 0
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1])
  const local = new Map<string, string>()
  for (const u of urls) {
    if (local.has(u)) continue
    const file = `${String(++n).padStart(3, '0')}.woff2`
    await download(u, join(dir, file))
    local.set(u, `${slug(family)}/${file}`)
  }
  const out = css.replace(/url\((https:\/\/[^)]+)\)/g, (_m, u: string) => `url('${local.get(u)}')`).replace(/\/\*[^*]*\*\//g, '')
  // the weights the family really has (Google may answer a request for a weight it lacks)
  const real = [...new Set([...out.matchAll(/font-weight:\s*(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b)
  const kept = real.filter((w) => got.includes(w))
  return { css: out.trim(), weights: kept.length ? kept : real.length ? real : got, source: 'google' }
}

/** downloads a family (weights) into the project and rewrites fonts/web-fonts.css */
export async function addWebFont(projectDir: string, family: string, weights: number[]): Promise<WebFont> {
  const ws = [...new Set((weights.length ? weights : [400, 700]).map((w) => Math.max(100, Math.min(900, Math.round(w / 100) * 100))))].sort((a, b) => a - b)
  const list = listWebFonts(projectDir).filter((f) => f.family.toLowerCase() !== family.trim().toLowerCase())
  const faces = await fetchFaces(projectDir, family.trim(), ws)
  const css = `${slug(family)}.css`
  writeFileSync(join(fontsDir(projectDir), css), faces.css + '\n')
  const entry: WebFont = { family: family.trim(), weights: faces.weights, source: faces.source, css }
  const next = [...list, entry]
  writeJson(indexFile(projectDir), next)
  // one stylesheet for the composition to link
  writeFileSync(join(fontsDir(projectDir), 'web-fonts.css'), next.map((f) => (existsSync(join(fontsDir(projectDir), f.css)) ? readFileSync(join(fontsDir(projectDir), f.css), 'utf8') : '')).join('\n'))
  return entry
}

/** families the project brings itself (counted as available fonts) */
export const webFontFamilies = (projectDir: string) => listWebFonts(projectDir).map((f) => f.family)
