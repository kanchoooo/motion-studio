// The HyperFrames skills tell the agent to run `npx hyperframes …` (check, snapshot,
// add <block> …). The designer's computer may have no Node at all, so the Claude
// session gets a small bin folder first on its PATH:
//   hyperframes  → the HyperFrames CLI inside the app (run by the app's own Node)
//   npx          → `npx [-y] hyperframes[@version] …` goes to the same CLI; anything
//                  else goes to a real npx when the computer has one
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { bin, dataDir, hyperframes } from '../paths'

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`

/** writes the shims (paths change when the app moves or updates) and returns the folder */
export function ensureCliShims(): string {
  const dir = join(dataDir(), 'cli')
  mkdirSync(dir, { recursive: true })
  const vars: [string, string][] = [
    ['ELECTRON_RUN_AS_NODE', '1'],
    ['HYPERFRAMES_TELEMETRY', '0'],
    ['DO_NOT_TRACK', '1'],
    ['HYPERFRAMES_SKIP_SKILLS', '1'],
    ['HYPERFRAMES_FFMPEG_PATH', bin.ffmpeg()],
    ['HYPERFRAMES_FFPROBE_PATH', bin.ffprobe()],
  ]
  const node = process.execPath
  const cli = hyperframes.cli()
  if (process.platform === 'win32') {
    // cmd.exe, PowerShell and Git Bash (which Claude Code uses on Windows)
    const sets = vars.map(([k, v]) => `set "${k}=${v}"`).join('\r\n')
    writeFileSync(join(dir, 'hyperframes.cmd'), `@echo off\r\n${sets}\r\n"${node}" "${cli}" %*\r\n`)
    writeFileSync(
      join(dir, 'npx.cmd'),
      `@echo off\r\nset "A=%~1"\r\nif "%A%"=="-y" shift\r\nif "%A%"=="--yes" shift\r\nset "B=%~1"\r\nif "%B:~0,11%"=="hyperframes" (\r\n  shift\r\n  call "%~dp0hyperframes.cmd" %1 %2 %3 %4 %5 %6 %7 %8 %9\r\n  exit /b %errorlevel%\r\n)\r\necho npx is not installed here. Use "hyperframes <command>" or the studio tools. 1>&2\r\nexit /b 127\r\n`,
    )
    const posix = (p: string) => p.replace(/\\/g, '/')
    writeFileSync(join(dir, 'hyperframes'), `#!/bin/sh\n${vars.map(([k, v]) => `export ${k}=${q(posix(v))}`).join('\n')}\nexec ${q(posix(node))} ${q(posix(cli))} "$@"\n`)
  } else {
    writeFileSync(join(dir, 'hyperframes'), `#!/bin/sh\n# Motion Studio: the HyperFrames CLI that ships with the app\n${vars.map(([k, v]) => `export ${k}=${q(v)}`).join('\n')}\nexec ${q(node)} ${q(cli)} "$@"\n`)
    writeFileSync(
      join(dir, 'npx'),
      [
        '#!/bin/sh',
        '# Motion Studio: npx hyperframes … → the app\'s HyperFrames; anything else → a real npx if there is one',
        'case "$1" in -y|--yes) shift ;; esac',
        'case "$1" in',
        `  hyperframes|hyperframes@*) shift; exec ${q(join(dir, 'hyperframes'))} "$@" ;;`,
        'esac',
        `PATH=$(printf %s "$PATH" | tr ':' '\\n' | grep -vxF ${q(dir)} | paste -sd: -)`,
        'real=$(command -v npx 2>/dev/null) && exec "$real" "$@"',
        'echo "npx is not installed on this computer. Use \'hyperframes <command>\' or the studio tools." >&2',
        'exit 127',
        '',
      ].join('\n'),
    )
    chmodSync(join(dir, 'hyperframes'), 0o755)
    chmodSync(join(dir, 'npx'), 0o755)
  }
  return dir
}

/** PATH for the Claude session: the shims first */
export function sessionPath(): string {
  const dir = ensureCliShims()
  return [dir, ...(process.env.PATH ?? '').split(delimiter).filter((p) => p && p !== dir)].join(delimiter)
}

