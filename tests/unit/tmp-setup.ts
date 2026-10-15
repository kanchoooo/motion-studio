// Every unit test run gets its own temporary folder (TMPDIR), removed when the run ends: the
// project folders, homes and caches the tests make never pile up on the disk.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ms-vitest-'))
  // macOS / Linux read TMPDIR, Windows TEMP / TMP
  const names = ['TMPDIR', 'TEMP', 'TMP'] as const
  const before = names.map((n) => process.env[n])
  for (const n of names) process.env[n] = dir
  return () => {
    names.forEach((n, i) => {
      if (before[i] === undefined) delete process.env[n]
      else process.env[n] = before[i]
    })
    rmSync(dir, { recursive: true, force: true })
  }
}
