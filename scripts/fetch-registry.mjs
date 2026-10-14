#!/usr/bin/env node
// Copies the HyperFrames registry (every block and component `hyperframes add` can install)
// into resources/hf-registry/, so the app ships it: installs work offline and at once, and
// Claude can see a picture of each candidate before choosing (find_blocks).
// The copy is the registry of the HyperFrames version the app bundles (tag v<version>).
//
//   node scripts/fetch-registry.mjs           # skips when the copy is already this version
//   node scripts/fetch-registry.mjs --force
//
// resources/hf-registry/
//   offline-fetch.mjs                     (in git) loaded into the CLI: answers registry requests from here
//   mirror/registry/…                     registry.json, <blocks|components|examples>/<name>/…
//   mirror/static.heygen.ai/…             assets the registry keeps on HeyGen's CDN
//   previews/<name>.jpg                   3 moments of the item's preview video side by side, else its poster
//   mirror.json                           { ref, items, files, previews }
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'hf-registry')
const version = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'hyperframes', 'package.json'), 'utf8')).version
const ref = `v${version}`
const BASE = `https://raw.githubusercontent.com/heygen-com/hyperframes/${ref}/registry`
const DIRS = { 'hyperframes:block': 'blocks', 'hyperframes:component': 'components', 'hyperframes:example': 'examples' }

const stampFile = join(OUT, 'mirror.json')
if (!process.argv.includes('--force') && existsSync(stampFile)) {
  const stamp = JSON.parse(readFileSync(stampFile, 'utf8'))
  if (stamp.ref === ref) {
    console.log(`▶ HyperFrames 레지스트리 ${ref}: 이미 있어요 (${stamp.items}개, 미리보기 ${stamp.previews}개)`)
    process.exit(0)
  }
}

// a fresh copy is built next to the old one and swapped in at the end
const work = join(OUT, '.work')
rmSync(work, { recursive: true, force: true })
const inside = (base, rel) => {
  const p = normalize(join(base, rel))
  if (!p.startsWith(base + sep)) throw new Error(`unsafe path: ${rel}`)
  return p
}

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 500 * i))
    }
  }
}
function save(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}
/** runs `fn` over `list`, `n` at a time */
async function pool(list, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) await fn(list[i++])
  }))
}

const registryJson = await get(`${BASE}/registry.json`)
save(join(work, 'mirror', 'registry', 'registry.json'), registryJson)
const items = JSON.parse(registryJson.toString('utf8')).items
console.log(`▶ HyperFrames 레지스트리 ${ref}: ${items.length}개 받는 중`)

const manifests = []
await pool(items, 16, async ({ name, type }) => {
  const dir = DIRS[type]
  if (!dir) return
  const bytes = await get(`${BASE}/${dir}/${name}/registry-item.json`)
  save(inside(join(work, 'mirror', 'registry'), `${dir}/${name}/registry-item.json`), bytes)
  manifests.push({ dir, item: JSON.parse(bytes.toString('utf8')) })
})

const files = []
const cdn = new Set()
for (const { dir, item } of manifests) {
  for (const f of item.files ?? []) {
    if (f.url) cdn.add(f.url)
    else files.push({ url: `${BASE}/${dir}/${item.name}/${f.path}`, to: inside(join(work, 'mirror', 'registry'), `${dir}/${item.name}/${f.path}`) })
  }
}
for (const url of cdn) {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.hostname !== 'static.heygen.ai') throw new Error(`unexpected asset host: ${url}`)
  files.push({ url, to: inside(join(work, 'mirror', 'static.heygen.ai'), decodeURIComponent(u.pathname).slice(1)) })
}
let done = 0
await pool(files, 16, async (f) => {
  save(f.to, await get(f.url))
  if (++done % 200 === 0) console.log(`  파일 ${done}/${files.length}`)
})

// small pictures Claude looks at when choosing: three moments of the preview video in a row
// (beginning → middle → end shows the motion), else the poster. ffmpeg reads only the parts
// of the video it needs.
const exe = process.platform === 'win32' ? '.exe' : ''
const binDir = join(ROOT, 'resources', 'bin', `${process.platform}-${process.arch}`)
const ffmpeg = join(binDir, `ffmpeg${exe}`)
const ffprobe = join(binDir, `ffprobe${exe}`)
const canStrip = existsSync(ffmpeg) && existsSync(ffprobe)
if (!canStrip) console.warn('  ffmpeg가 없어 영상 미리보기 대신 포스터만 써요 (node scripts/fetch-binaries.mjs)')
async function strip(video, out) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { timeout: 60000 })
  const d = Number(stdout.trim())
  if (!(d > 0)) throw new Error('no duration')
  const at = [0.15, 0.5, 0.85].map((k) => (d * k).toFixed(2))
  mkdirSync(dirname(out), { recursive: true })
  await run(ffmpeg, ['-v', 'error', '-y', ...at.flatMap((t) => ['-ss', t, '-i', video]), '-filter_complex', '[0:v]scale=320:-2[a];[1:v]scale=320:-2[b];[2:v]scale=320:-2[c];[a][b][c]hstack=3', '-frames:v', '1', '-q:v', '5', out], { timeout: 120000 })
}
let previews = 0
await pool(manifests.filter((m) => m.item.preview?.video || m.item.preview?.poster), 8, async ({ item }) => {
  const out = inside(join(work, 'previews'), `${item.name}.jpg`)
  const errors = []
  if (canStrip && item.preview.video) {
    try {
      await strip(item.preview.video, out)
      return void previews++
    } catch (e) {
      errors.push(e.message)
    }
  }
  if (item.preview.poster) {
    try {
      const png = await get(item.preview.poster)
      save(out, await sharp(png).resize({ width: 480, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer())
      return void previews++
    } catch (e) {
      errors.push(e.message.replace(/^.*: /, ''))
    }
  }
  console.warn(`  미리보기 없음 ${item.name}: ${errors.join(' / ')}`)
})

writeFileSync(join(work, 'mirror.json'), JSON.stringify({ ref, items: manifests.length, files: files.length, previews, at: new Date().toISOString() }, null, 2))
for (const name of ['mirror', 'previews', 'mirror.json']) {
  rmSync(join(OUT, name), { recursive: true, force: true })
  renameSync(join(work, name), join(OUT, name))
}
rmSync(work, { recursive: true, force: true })
console.log(`▶ 완료: 항목 ${manifests.length}개 · 파일 ${files.length}개 · 미리보기 ${previews}개 → resources/hf-registry`)
