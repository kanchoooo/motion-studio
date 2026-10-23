import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bashFromGit, cliCandidates, findClaudeCli, pathHasDir, profileLine } from '../../src/main/claudeSetup'

// 환경 점검: Claude Code on this computer (install, PATH) and Git Bash on Windows
describe('claude setup', () => {
  it('reads PATH the way each system does', () => {
    expect(pathHasDir('/usr/bin:/Users/a/.local/bin/:/bin', '/Users/a/.local/bin', false)).toBe(true)
    expect(pathHasDir('/usr/bin:/bin', '/Users/a/.local/bin', false)).toBe(false)
    expect(pathHasDir('C:\\Windows;c:\\users\\a\\.local\\bin\;D:\\x', 'C:\\Users\\A\\.local\\bin', true)).toBe(true)
    expect(pathHasDir('C:\\Windows', 'C:\\Users\\A\\.local\\bin', true)).toBe(false)
  })
  it('writes the profile line with $HOME, finds bash next to git, knows where installers put claude', () => {
    expect(profileLine('/Users/a/.local/bin', '/Users/a')).toBe('export PATH="$HOME/.local/bin:$PATH"')
    expect(profileLine('/opt/homebrew/bin', '/Users/a')).toBe('export PATH="/opt/homebrew/bin:$PATH"')
    expect(bashFromGit('C:/Program Files/Git/cmd/git.exe').replace(/\\/g, '/')).toBe('C:/Program Files/Git/bin/bash.exe')
    expect(cliCandidates('/Users/a', false)[0]).toBe('/Users/a/.local/bin/claude')
    expect(cliCandidates('C:/Users/a', true, {})[0]).toMatch(/\.local[\\/]bin[\\/]claude\.exe$/)
  })
  // only where a claude is installed (not on CI machines)
  it.skipIf(process.platform !== 'darwin' || !cliCandidates().some((p) => existsSync(p)))('finds the claude of this Mac', async () => {
    const c = await findClaudeCli()
    expect(c.path).toBeTruthy()
    expect(c.version).toMatch(/\d+\.\d+/)
  }, 60_000)
})
