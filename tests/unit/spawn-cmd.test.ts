import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cmdLine, spawnCommand } from '../../src/main/spawn-cmd'

// Codex on Windows is codex.cmd: with Node's shell: true a project path with a space split in two
// and Codex said "error: unexpected argument '-' found".
describe('a .cmd on Windows keeps its arguments whole', () => {
  it('quotes each argument and escapes cmd characters, twice for a batch file', () => {
    expect(cmdLine('C:/npm/codex.cmd', ['a b', '-'])).toBe('C:\\npm\\codex.cmd ^^^"a^^^ b^^^" ^^^"-^^^"')
    expect(cmdLine('C:\\tools\\x.exe', ['a b', 'k="v"', 'end\\'])).toBe('C:\\tools\\x.exe ^"a^ b^" ^"k=\\^"v\\^"^" ^"end\\\\^"')
  })

  // the real thing (Windows CI): a .cmd that prints the arguments it got
  it.runIf(process.platform === 'win32')('cmd.exe hands the .cmd exactly these arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-cmd '))
    try {
      writeFileSync(join(dir, 'argv.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
      const fake = join(dir, 'fake codex.cmd')
      writeFileSync(fake, `@"${process.execPath}" "%~dp0argv.js" %*\r\n`)
      const args = ['exec', '-C', 'C:\\Users\\디자이너\\모션 스튜디오\\앱 주문 런칭.msproj\\.studio\\gen', '-c', 'model_reasoning_effort="low"', '-i', 'C:\\refs\\a b.png', 'x&y', 'a(b)', 'end\\', '-']
      const child = spawnCommand(fake, args)
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      const code = await new Promise((r) => child.on('close', r))
      expect(code).toBe(0)
      expect(JSON.parse(out)).toEqual(args)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
