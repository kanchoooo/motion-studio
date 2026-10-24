// 환경 점검의 "Claude Code (이 컴퓨터)": the app runs its own Claude Code, but some computers have
// no Claude Code of their own, or have one the terminal cannot find (PATH), and on Windows Claude Code
// needs Git Bash (CLAUDE_CODE_GIT_BASH_PATH when Git is not where it looks). This finds what is
// there, installs Claude Code with Anthropic's own installer, and puts the environment variables
// right — for the user's account (shell profile on a Mac, user environment on Windows) and for the
// running app, so sessions started from now on see them too.
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** PowerShell writes in the system code page (CP949 on Korean Windows) unless told otherwise: a 김광조 folder would come back broken */
const PS_UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
const ps = (command: string, opts: Parameters<typeof execFile>[2] = {}) =>
  run('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_UTF8 + command], { timeout: 30_000, windowsHide: true, encoding: 'utf8', ...opts } as never) as unknown as Promise<{ stdout: string; stderr: string }>
const WIN = process.platform === 'win32'
const home = () => homedir()

export interface ClaudeCli {
  /** the claude found on this computer (null: none) */
  path: string | null
  version?: string
  /** a terminal opened now finds it */
  onPath: boolean
}
export interface GitBash {
  /** bash.exe found (null: no Git for Windows) */
  path: string | null
  /** Claude Code will find it: Git is on PATH, or CLAUDE_CODE_GIT_BASH_PATH points at it */
  usable: boolean
  /** CLAUDE_CODE_GIT_BASH_PATH is set but points nowhere */
  badVar?: string
}

/** where Anthropic's installer, npm and Homebrew put claude */
export function cliCandidates(h = home(), win = WIN, env: NodeJS.ProcessEnv = process.env): string[] {
  if (win) {
    const appdata = env.APPDATA ?? join(h, 'AppData', 'Roaming')
    const local = env.LOCALAPPDATA ?? join(h, 'AppData', 'Local')
    return [join(h, '.local', 'bin', 'claude.exe'), join(appdata, 'npm', 'claude.cmd'), join(local, 'Programs', 'claude', 'claude.exe')]
  }
  return [join(h, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', join(h, '.claude', 'local', 'claude'), join(h, '.npm-global', 'bin', 'claude')]
}

/** a PATH holds the folder (Windows: any case, a trailing slash is the same folder) */
export function pathHasDir(pathValue: string, dir: string, win = WIN): boolean {
  const norm = (p: string) => {
    let s = p.trim().replace(/^"|"$/g, '')
    s = win ? s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : s.replace(/\/+$/, '')
    return s
  }
  const want = norm(dir)
  return pathValue.split(win ? ';' : ':').some((p) => p && norm(p) === want)
}

/** the line a shell profile gets (the home folder written as $HOME) */
export function profileLine(dir: string, h = home()): string {
  const d = dir.startsWith(h + '/') ? `$HOME${dir.slice(h.length)}` : dir
  return `export PATH="${d}:$PATH"`
}

/** Git for Windows' bash.exe from where git.exe is (…\Git\cmd\git.exe or …\Git\bin\git.exe) */
export function bashFromGit(gitExe: string): string {
  return join(dirname(dirname(gitExe)), 'bin', 'bash.exe')
}

async function works(p: string): Promise<string | null> {
  try {
    const { stdout } = await run(p, ['--version'], { timeout: 20_000, windowsHide: true, shell: WIN && p.endsWith('.cmd') })
    return stdout.trim().split('\n')[0] || 'claude'
  } catch {
    return null
  }
}

/** the PATH a terminal opened now gets (Mac: the login shell with its profile; Windows: user + machine) */
export async function terminalPath(): Promise<string> {
  if (WIN) {
    try {
      const { stdout } = await ps("[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')")
      return stdout.trim().replace(/%([^%]+)%/g, (all, k: string) => process.env[k] ?? all)
    } catch {
      return process.env.Path ?? process.env.PATH ?? ''
    }
  }
  const shell = process.env.SHELL && /\/(zsh|bash)$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/zsh'
  try {
    // an interactive login shell reads the same profile a new Terminal window does
    const { stdout } = await run(shell, ['-ilc', 'printf "__MS_PATH__%s" "$PATH"'], { timeout: 15_000, env: { HOME: home(), USER: process.env.USER ?? '', TERM: 'dumb' } })
    const m = stdout.match(/__MS_PATH__(.*)$/m)
    if (m) return m[1].trim()
  } catch {
    /* a profile that hangs or fails: the system PATH below */
  }
  return ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
}

export async function findClaudeCli(): Promise<ClaudeCli> {
  const tp = await terminalPath()
  // the one a terminal would run first, else any that works
  const onPathFirst = cliCandidates().sort((a, b) => Number(pathHasDir(tp, dirname(b))) - Number(pathHasDir(tp, dirname(a))))
  for (const p of onPathFirst) {
    if (!existsSync(p)) continue
    const version = await works(p)
    if (version) return { path: p, version, onPath: pathHasDir(tp, dirname(p)) }
  }
  return { path: null, onPath: false }
}

export async function findGitBash(): Promise<GitBash> {
  const v = process.env.CLAUDE_CODE_GIT_BASH_PATH?.trim()
  const badVar = v && !existsSync(v) ? v : undefined
  if (v && !badVar) return { path: v, usable: true }
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? join(home(), 'AppData', 'Local')
  let gitOnPath: string | null = null
  try {
    const { stdout } = await ps('(Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source')
    gitOnPath = stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => /git\.exe$/i.test(s)) ?? null
  } catch {
    /* git is not on PATH */
  }
  const found = [gitOnPath && bashFromGit(gitOnPath), join(pf, 'Git', 'bin', 'bash.exe'), join(pf86, 'Git', 'bin', 'bash.exe'), join(local, 'Programs', 'Git', 'bin', 'bash.exe')].find((p): p is string => !!p && existsSync(p)) ?? null
  // Claude Code finds bash itself through git on PATH; otherwise only through the variable
  return { path: found, usable: !!found && !!gitOnPath && !badVar, badVar }
}

// ---- fixes -------------------------------------------------------------------

/** a folder on the user's PATH from now on (Mac: the shell profile; Windows: the user environment) and in this app */
export async function addToPath(dir: string): Promise<void> {
  if (WIN) {
    await ps("$d=$env:MS_DIR; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; if (-not (($p -split ';') | Where-Object { $_.TrimEnd('\\') -ieq $d.TrimEnd('\\') })) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $d).TrimStart(';'), 'User') }", { env: { ...process.env, MS_DIR: dir } })
    const cur = process.env.Path ?? process.env.PATH ?? ''
    if (!pathHasDir(cur, dir)) process.env.Path = process.env.PATH = `${cur.replace(/;$/, '')};${dir}`
    return
  }
  const shell = process.env.SHELL ?? '/bin/zsh'
  const files = /bash$/.test(shell) ? ['.bash_profile'] : ['.zshrc', '.zprofile']
  const line = profileLine(dir)
  for (const f of files) {
    const file = join(home(), f)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text.includes(line)) continue
    appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}\n# 모션스튜디오: Claude Code\n${line}\n`)
  }
  if (!pathHasDir(process.env.PATH ?? '', dir)) process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
}

/** a variable for the user's account from now on, and for this app (Windows) */
async function setUserVar(name: string, value: string): Promise<void> {
  await ps(`[Environment]::SetEnvironmentVariable('${name}', $env:MS_VALUE, 'User')`, { env: { ...process.env, MS_VALUE: value } })
  process.env[name] = value
}

const tail = (s: string) => s.trim().split(/\r?\n/).slice(-4).join(' ').slice(0, 300)

/** Anthropic's installer (https://claude.ai/install.sh / install.ps1), then the PATH */
export async function installClaude(): Promise<{ ok: boolean; message: string }> {
  try {
    if (WIN) await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { timeout: 15 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    else await run('/bin/bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ''}\n${(e as { stderr?: string }).stderr ?? ''}`
    return { ok: false, message: `설치하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.${tail(out) ? ` (${tail(out)})` : ''}` }
  }
  const cli = await findClaudeCli()
  if (!cli.path) return { ok: false, message: '설치는 끝났는데 Claude Code를 찾지 못했어요. 다시 확인을 눌러 주세요.' }
  if (!cli.onPath) await addToPath(dirname(cli.path))
  return { ok: true, message: `Claude Code를 설치했어요 (${cli.version}).${cli.onPath ? '' : ' 환경변수(PATH)도 설정했어요.'}` }
}

export async function fixClaudePath(): Promise<{ ok: boolean; message: string }> {
  const cli = await findClaudeCli()
  if (!cli.path) return { ok: false, message: 'Claude Code가 없어요. 먼저 설치해 주세요.' }
  if (cli.onPath) return { ok: true, message: '이미 맞게 설정돼 있어요.' }
  try {
    await addToPath(dirname(cli.path))
  } catch (e) {
    return { ok: false, message: `환경변수를 설정하지 못했어요: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, message: `환경변수(PATH)에 ${dirname(cli.path)}를 넣었어요. 새로 여는 터미널부터 claude 명령을 쓸 수 있어요.` }
}

/** Windows: Git for Windows through winget, then the variable */
export async function installGit(): Promise<{ ok: boolean; message: string }> {
  try {
    await run('winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements'], { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  } catch (e) {
    const code = (e as { code?: string | number }).code
    if (code === 'ENOENT') return { ok: false, message: '이 컴퓨터에는 자동 설치 도구(winget)가 없어요. https://git-scm.com/downloads/win 에서 Git을 설치한 뒤 다시 확인을 눌러 주세요.' }
    return { ok: false, message: `Git을 설치하지 못했어요. ${tail(String((e as { stdout?: string }).stdout ?? (e as Error).message))}` }
  }
  return fixGitBash('Git을 설치했어요.')
}

export async function fixGitBash(done = ''): Promise<{ ok: boolean; message: string }> {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && !existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) delete process.env.CLAUDE_CODE_GIT_BASH_PATH
  const g = await findGitBash()
  if (!g.path) return { ok: false, message: `${done} Git Bash(bash.exe)를 찾지 못했어요. Git을 설치해 주세요.`.trim() }
  try {
    await setUserVar('CLAUDE_CODE_GIT_BASH_PATH', g.path)
  } catch (e) {
    return { ok: false, message: `환경변수를 설정하지 못했어요: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, message: `${done} 환경변수 CLAUDE_CODE_GIT_BASH_PATH를 ${g.path}로 설정했어요.`.trim() }
}
