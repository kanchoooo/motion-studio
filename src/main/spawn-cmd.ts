// Windows runs a .cmd / .bat (an npm-installed CLI such as codex.cmd) only through cmd.exe, and
// Node's `shell: true` joins the arguments as they are: a path with a space (a project folder)
// splits in two and quotes go missing — "error: unexpected argument '-' found". The command line
// is built here instead, with the rules cross-spawn uses: MSVC quoting for the program's own
// argument parser, then ^ before cmd's special characters (twice for a batch file, whose %*
// cmd reads once more).
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'

const META = /([()\][%!^"`<>&|;, *?])/g
const caret = (s: string) => s.replace(META, '^$1')
const isBatch = (file: string) => /\.(cmd|bat)$/i.test(file)

/** one argument, quoted for the program and escaped for cmd.exe */
function cmdArg(arg: string, batch: boolean): string {
  // backslashes before a quote (or the closing quote) are doubled; the quote itself is escaped
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
  return batch ? caret(caret(quoted)) : caret(quoted)
}

/** the cmd.exe /c line that runs `file` with exactly these arguments */
export function cmdLine(file: string, args: string[]): string {
  const batch = isBatch(file)
  return [caret(file.replace(/\//g, '\\')), ...args.map((a) => cmdArg(a, batch))].join(' ')
}

/** spawn, with a Windows .cmd / .bat run through cmd.exe without its arguments being split */
export function spawnCommand(file: string, args: string[], opts: SpawnOptionsWithoutStdio = {}): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32' && isBatch(file))
    return spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `"${cmdLine(file, args)}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true })
  return spawn(file, args, opts)
}

/** stops a process and what it started (on Windows cmd.exe's child would outlive a plain kill) */
export function killTree(child: { pid?: number; kill: () => boolean }) {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill())
      return
    } catch {
      /* fall through */
    }
  }
  child.kill()
}
