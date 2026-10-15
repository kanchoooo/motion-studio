// Reading a HyperFrames report through filters (`hyperframes check 2>&1 | grep … | head`) runs
// without a permission card; anything that could run or write something else still asks.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))
const { hyperframesReadPipeline } = await import('../../src/main/agent/permissions')

const proj = mkdtempSync(join(tmpdir(), 'ms-pipe-'))
mkdirSync(join(proj, 'composition'))
const ok = (cmd: string) => hyperframesReadPipeline(cmd, proj)

describe('hyperframes report pipelines', () => {
  it('allows reading a report through read-only filters', () => {
    expect(ok(`cd "${proj}/composition" && hyperframes check 2>&1 | grep -E "✗|error\\(s\\)|:1 \\(|Check" | head -40`)).toBe(true)
    expect(ok('cd composition && hyperframes check 2>&1 | tail -5')).toBe(true)
    expect(ok("hyperframes lint 2>/dev/null | grep -c 'error'")).toBe(true)
    expect(ok('npx -y hyperframes inspect --at 2 | sort | head -3')).toBe(true)
    expect(ok("hyperframes check 2>&1 | grep '⚠' | cut -c1-200 | head -30")).toBe(true)
    // the folder can be named through /private on macOS
    expect(ok(`cd "/private${proj}/composition" && hyperframes snapshot --at 0,1.5,3 2>&1 | grep -E "contact-sheet"`)).toBe(true)
    expect(ok(`cd "${proj}/composition" && hyperframes check 2>&1 | sed -n '/^Layout/,/^Snapshots/p'`)).toBe(true)
    expect(ok('hyperframes check 2>&1 | sed -n 10,40p')).toBe(true)
    expect(ok(`cd "${proj}/composition" && hyperframes check`)).toBe(true)
  })
  it('asks for anything else', () => {
    for (const cmd of [
      'hyperframes check | tee report.txt',
      'hyperframes check > report.txt',
      'hyperframes check 2>&1 >> log.txt | head',
      'hyperframes check; rm -rf composition',
      'hyperframes check && rm -rf composition',
      'hyperframes check || true',
      'hyperframes check | sh',
      'hyperframes check | xargs rm',
      'hyperframes check | sort -o out.txt',
      'hyperframes check | grep "$(rm -rf x)"',
      'hyperframes check | grep `id`',
      'hyperframes render -o x.mp4 | tail',
      'hyperframes history undo | head',
      'cd /etc && hyperframes check | head',
      `cd "${proj}" && cd .. && hyperframes check | head`,
      'python3 -c "print(1)" | head',
      'hyperframes check | head &',
      "hyperframes check | sed -i 's/a/b/' index.html",
      "hyperframes check | sed -n '/x/w out.txt'",
      "hyperframes check | sed 's/a/b/'",
      `cd "${proj}/composition" && d=$(which hyperframes); grep -rl x "$d" | head -3`,
      "hyperframes check | grep 'x\n' ; echo",
    ])
      expect([cmd, ok(cmd)]).toEqual([cmd, false])
  })
})
