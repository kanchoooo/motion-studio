// Runs the HyperFrames CLI with Electron's bundled Node (no Node install needed).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fpsArg, type OutputFormat, type OutputQuality } from '@shared/brief'
import { electronNodeEnv, hyperframes } from './paths'

export interface HfResult {
  code: number
  stdout: string
  stderr: string
}

export interface HfProgress {
  code: string
  pct: number
  done?: number
  total?: number
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

export function runHf(
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; onProgress?: (p: HfProgress) => void; timeoutMs?: number } = {},
): Promise<HfResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hyperframes.cli(), ...args], {
      cwd: opts.cwd,
      env: electronNodeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let buf = ''
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null
    const onAbort = () => child.kill()
    opts.signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stdout += s
      if (!opts.onProgress) return
      buf += s.replace(/\r/g, '\n')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const m = line.replace(ANSI, '').match(/^@hf-progress (\{.*\})\s*$/)
        if (!m) continue
        try {
          opts.onProgress(JSON.parse(m[1]) as HfProgress)
        } catch {
          /* ignore malformed */
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, stdout: stdout.replace(ANSI, ''), stderr: stderr.replace(ANSI, '') })
    })
  })
}

const FORMAT_ARG: Record<OutputFormat, string> = {
  'mp4-h264': 'mp4',
  'mp4-h265': 'mp4', // re-encoded to HEVC afterwards
  'mov-prores4444': 'mov',
  'webm-vp9': 'webm',
  'png-sequence': 'png-sequence',
}
const QUALITY_ARG: Record<OutputQuality, string> = { draft: 'draft', standard: 'standard', high: 'high' }

export function renderComposition(
  compDir: string,
  out: string,
  o: { format: OutputFormat; quality: OutputQuality; fps: number },
  onProgress: (p: HfProgress) => void,
  signal?: AbortSignal,
): Promise<HfResult> {
  return runHf(
    [
      'render', compDir, '-o', out, '--format', FORMAT_ARG[o.format], '-q', QUALITY_ARG[o.quality],
      '-f', fpsArg(o.fps),
    ],
    { onProgress, signal },
  )
}

/** captures frames at exact times; returns PNG paths in time order */
export async function snapshot(compDir: string, times: number[], outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true })
  for (const f of readdirSync(outDir)) if (f.startsWith('frame-')) rmSync(join(outDir, f), { force: true })
  const res = await runHf(['snapshot', compDir, '--at', times.map((t) => t.toFixed(2)).join(','), '--no-end', '-o', outDir, '--describe', 'false'], {
    timeoutMs: 180_000,
  })
  if (res.code !== 0) throw new Error(lastLines(res.stderr || res.stdout))
  return readdirSync(outDir)
    .filter((f) => /^frame-\d+.*\.png$/.test(f))
    .sort()
    .map((f) => join(outDir, f))
}

export interface HfCheckIssue {
  section: 'lint' | 'runtime' | 'layout' | 'motion'
  code: string
  severity: string
  message: string
  selector?: string
  time?: number
}

/** lint + runtime + layout + motion check (contrast off: ad colours are the designer's call) */
export async function check(compDir: string): Promise<{ ok: boolean; issues: HfCheckIssue[]; raw: string }> {
  const res = await runHf(['check', compDir, '--json', '--no-contrast', '--samples', '7'], { timeoutMs: 180_000 })
  const raw = res.stdout.trim()
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, { findings?: Record<string, unknown>[] } | unknown>
    const issues: HfCheckIssue[] = []
    for (const section of ['lint', 'runtime', 'layout', 'motion'] as const) {
      const block = parsed[section] as { findings?: Record<string, unknown>[] } | undefined
      for (const f of block?.findings ?? []) {
        issues.push({
          section,
          code: String(f.code ?? 'issue'),
          severity: String(f.severity ?? 'warning'),
          message: String(f.message ?? ''),
          selector: typeof f.selector === 'string' ? f.selector : undefined,
          time: typeof f.time === 'number' ? f.time : undefined,
        })
      }
    }
    return { ok: parsed.ok === true, issues, raw }
  } catch {
    return { ok: res.code === 0, issues: [], raw: raw || res.stderr }
  }
}

export async function browserPath(): Promise<string | null> {
  const res = await runHf(['browser', 'path'], { timeoutMs: 30_000 })
  const line = res.stdout.split('\n').map((l) => l.trim()).find((l) => l && existsSync(l))
  return line ?? null
}

export async function ensureBrowser(): Promise<boolean> {
  const res = await runHf(['browser', 'ensure'], { timeoutMs: 600_000 })
  return res.code === 0
}

export function lastLines(s: string, n = 8): string {
  return s.trim().split('\n').slice(-n).join('\n')
}
