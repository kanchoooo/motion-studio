#!/usr/bin/env node
// Downloads the FFmpeg / ffprobe / yt-dlp binaries the app ships with into
// resources/bin/<platform>-<arch>/, verifying each against binaries.lock.json.
//
//   node scripts/fetch-binaries.mjs                 # current machine
//   node scripts/fetch-binaries.mjs --target darwin-arm64
//   node scripts/fetch-binaries.mjs --all           # every supported target
//   node scripts/fetch-binaries.mjs --update-lock   # recompute hashes (maintainers)
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, rmSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK_PATH = join(ROOT, 'scripts', 'binaries.lock.json')
const BIN_ROOT = join(ROOT, 'resources', 'bin')

export const TARGETS = ['darwin-x64', 'darwin-arm64', 'win32-x64']

const FFMPEG_TAG = 'b6.1.1'
const YTDLP_TAG = '2026.08.19'
const ffmpegUrl = (name, target) =>
  `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/${name}-${target}.gz`
const ytdlpUrl = (target) =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/${target.startsWith('win32') ? 'yt-dlp.exe' : 'yt-dlp_macos'}`

function filesFor(target) {
  const exe = target.startsWith('win32') ? '.exe' : ''
  return [
    { file: `ffmpeg${exe}`, url: ffmpegUrl('ffmpeg', target), gzip: true },
    { file: `ffprobe${exe}`, url: ffmpegUrl('ffprobe', target), gzip: true },
    { file: `yt-dlp${exe}`, url: ytdlpUrl(target), gzip: false },
  ]
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

async function download({ url, gzip }, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`)
  const tmp = `${dest}.part`
  const body = Readable.fromWeb(res.body)
  await (gzip ? pipeline(body, createGunzip(), createWriteStream(tmp)) : pipeline(body, createWriteStream(tmp)))
  renameSync(tmp, dest)
}

async function fetchTarget(target, lock, updateLock) {
  const dir = join(BIN_ROOT, target)
  mkdirSync(dir, { recursive: true })
  for (const entry of filesFor(target)) {
    const dest = join(dir, entry.file)
    const key = `${target}/${entry.file}`
    const expected = lock[key]
    if (!updateLock && expected && existsSync(dest) && sha256(dest) === expected) {
      console.log(`  ✓ ${key} (이미 있음)`)
      continue
    }
    process.stdout.write(`  ↓ ${key} ... `)
    await download(entry, dest)
    const actual = sha256(dest)
    if (updateLock) {
      lock[key] = actual
    } else if (expected && actual !== expected) {
      rmSync(dest)
      throw new Error(`해시 불일치: ${key}\n  기대값 ${expected}\n  실제값 ${actual}`)
    } else if (!expected) {
      throw new Error(`binaries.lock.json에 ${key} 해시가 없습니다. --update-lock으로 갱신하세요.`)
    }
    if (!target.startsWith('win32')) chmodSync(dest, 0o755)
    console.log('완료')
  }
}

export function currentTarget() {
  return `${process.platform}-${process.arch}`
}

async function main() {
  const args = process.argv.slice(2)
  const updateLock = args.includes('--update-lock')
  const ti = args.indexOf('--target')
  const targets = args.includes('--all') || updateLock ? TARGETS : [ti >= 0 ? args[ti + 1] : currentTarget()]
  for (const t of targets) {
    if (!TARGETS.includes(t)) throw new Error(`지원하지 않는 환경: ${t} (지원: ${TARGETS.join(', ')})`)
  }
  const lock = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : {}
  for (const t of targets) {
    console.log(`[${t}]`)
    await fetchTarget(t, lock, updateLock)
  }
  if (updateLock) {
    const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(LOCK_PATH, JSON.stringify(sorted, null, 2) + '\n')
    console.log('binaries.lock.json 갱신 완료')
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-binaries.mjs')) {
  main().catch((e) => {
    console.error(`\n✗ ${e.message}`)
    process.exit(1)
  })
}
