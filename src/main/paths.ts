// Resolves bundled binaries and app folders for every OS/CPU we ship
// (darwin-x64, darwin-arm64, win32-x64), in dev and in the packaged app.
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

export const target = `${process.platform}-${process.arch}`
export const isDev = !app?.isPackaged

/** repo root in dev, <app>/Contents/Resources/app in production (asar disabled) */
let rootCache: string | null = null
export function appRoot(): string {
  if (rootCache) return rootCache
  // walk up from the bundled main file so it works however Electron was launched
  let dir = import.meta.dirname
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'node_modules'))) return (rootCache = dir)
    dir = dirname(dir)
  }
  return (rootCache = app.getAppPath())
}

/** directory holding ffmpeg/ffprobe/yt-dlp for this machine */
export function binDir(): string {
  return isDev ? join(appRoot(), 'resources', 'bin', target) : join(process.resourcesPath, 'bin')
}

export const bin = {
  ffmpeg: () => join(binDir(), exe('ffmpeg')),
  ffprobe: () => join(binDir(), exe('ffprobe')),
  ytdlp: () => join(binDir(), exe('yt-dlp')),
}

const nodeModules = () => join(appRoot(), 'node_modules')

export const hyperframes = {
  cli: () => join(nodeModules(), 'hyperframes', 'bin', 'hyperframes.mjs'),
  dist: () => join(nodeModules(), 'hyperframes', 'dist'),
  playerScript: () => join(nodeModules(), 'hyperframes', 'dist', 'hyperframes-player.global.js'),
  runtimeScript: () => join(nodeModules(), 'hyperframes', 'dist', 'hyperframe.runtime.iife.js'),
}

/** files copied into every project's composition/ (ms runtime, local GSAP) */
export const runtimeFiles = {
  msRuntime: () => join(isDev ? join(appRoot(), 'src', 'runtime') : join(process.resourcesPath, 'runtime'), 'ms-runtime.js'),
  /** SVG character acting helper (ms-svg-character) */
  svgrig: () => join(isDev ? join(appRoot(), 'src', 'runtime') : join(process.resourcesPath, 'runtime'), 'svgrig.js'),
  gsap: () => join(nodeModules(), 'gsap', 'dist', 'gsap.min.js'),
}

/** image → SVG character tools: plain CommonJS shipped as files (they load sharp / vtracer from node_modules) */
export const characterTools = () => join(appRoot(), 'src', 'main', 'character', 'img2svg')

export function projectsDir(): string {
  // MS_PROJECTS_DIR lets tests use a throwaway folder
  const dir = process.env.MS_PROJECTS_DIR || join(app.getPath('documents'), '모션스튜디오')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** environment for child processes that run JS with Electron's bundled Node */
export function electronNodeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HYPERFRAMES_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_FFMPEG_PATH: bin.ffmpeg(),
    HYPERFRAMES_FFPROBE_PATH: bin.ffprobe(),
    ...extra,
  }
}
