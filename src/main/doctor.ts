import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DoctorItem, DoctorReport } from '@shared/api'
import { listFonts } from './fonts'
import { browserPath, ensureBrowser } from './hyperframes'
import { claudeEnv, ignoredCredentialVars } from './claude-env'
import { appRoot, bin, projectsDir } from './paths'
import { isTrusted } from './trust'

const run = promisify(execFile)

/** the Claude Code binary bundled with the Agent SDK for this OS/CPU */
export function claudeBinary(): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return join(appRoot(), 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, exe)
}

export interface ClaudeAuth {
  loggedIn: boolean
  email?: string
  orgName?: string
  subscriptionType?: string
  authMethod?: string
}

export async function claudeAuthStatus(): Promise<ClaudeAuth> {
  try {
    const { stdout } = await run(claudeBinary(), ['auth', 'status', '--json'], { timeout: 20_000, env: claudeEnv() })
    return JSON.parse(stdout) as ClaudeAuth
  } catch (e) {
    const out = (e as { stdout?: string }).stdout
    try {
      return JSON.parse(out ?? '') as ClaudeAuth
    } catch {
      return { loggedIn: false }
    }
  }
}

/** macOS: the login keychain must be unlocked for Claude Code to read its sign-in */
export function keychainLocked(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('security', ['show-keychain-info', 'login.keychain-db'], { stdio: 'pipe', timeout: 5000 })
    return false
  } catch {
    return true
  }
}

const PLAN_LABEL: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }

export async function doctor(): Promise<DoctorReport> {
  const items: DoctorItem[] = []

  const auth = await claudeAuthStatus()
  const ignored = ignoredCredentialVars()
  const login = { id: 'login' as const, label: 'Claude 로그인' }
  if (keychainLocked()) {
    items.push({ id: 'claude', label: 'Claude 계정', status: 'error', detail: '맥 키체인이 잠겨 있어서 Claude 로그인 정보를 읽을 수 없어요. 맥 잠금을 풀고(로그인 암호) "다시 확인"을 눌러 주세요.', action: login })
  } else if (!auth.loggedIn) {
    items.push({ id: 'claude', label: 'Claude 계정', status: 'error', detail: '로그인이 필요해요. 본인 Claude 계정(회사 Team 계정)으로 로그인해 주세요.', action: login })
  } else if (auth.authMethod && auth.authMethod !== 'claude.ai') {
    items.push({
      id: 'claude',
      label: 'Claude 계정',
      status: 'warn',
      detail: `Claude 구독 계정이 아닌 방식(${auth.authMethod})으로 연결돼 있어요. 리모트 컨트롤이 동작하지 않을 수 있어요. Claude 계정으로 다시 로그인해 주세요.`,
      action: login,
    })
  } else {
    items.push({
      id: 'claude',
      label: 'Claude 계정',
      status: 'ok',
      detail: `${auth.email ?? ''}${auth.subscriptionType ? ` · ${PLAN_LABEL[auth.subscriptionType] ?? auth.subscriptionType} 플랜` : ''}${ignored.length ? ` · ${ignored.join(', ')} 환경변수는 쓰지 않고 키체인 로그인을 써요` : ''}`,
    })
  }

  if (auth.loggedIn) {
    items.push(
      isTrusted(projectsDir())
        ? { id: 'workspace', label: '작업 폴더 허용', status: 'ok', detail: `${projectsDir()} — Claude가 이 폴더의 프로젝트를 다룰 수 있어요` }
        : {
            id: 'workspace',
            label: '작업 폴더 허용 (권장)',
            status: 'warn',
            detail: '모션스튜디오 폴더를 한 번만 허용하면 새 프로젝트·베리에이션마다 묻지 않아요. 건너뛰면 프로젝트를 처음 열 때마다 터미널에서 허용해야 해요.',
            action: { id: 'trust-workspace', label: '작업 폴더 허용하기' },
          },
    )
  }

  const browser = await browserPath().catch(() => null)
  items.push(
    browser
      ? { id: 'browser', label: '영상 렌더 엔진', status: 'ok', detail: '준비됐어요' }
      : {
          id: 'browser',
          label: '영상 렌더 엔진',
          status: 'error',
          detail: '영상을 만들 때 쓰는 브라우저 엔진이 없어요. 한 번만 내려받으면 돼요 (약 150MB).',
          action: { id: 'install-browser', label: '렌더 엔진 내려받기' },
        },
  )

  let ffmpegOk = false
  if (existsSync(bin.ffmpeg()) && existsSync(bin.ffprobe())) {
    try {
      await run(bin.ffmpeg(), ['-version'], { timeout: 10_000 })
      ffmpegOk = true
    } catch {
      /* broken binary */
    }
  }
  items.push(
    ffmpegOk
      ? { id: 'ffmpeg', label: '영상 변환 도구', status: 'ok', detail: '준비됐어요' }
      : { id: 'ffmpeg', label: '영상 변환 도구', status: 'error', detail: '앱 설치 파일이 손상됐을 수 있어요. 앱을 다시 설치해 주세요.' },
  )

  const fonts = listFonts()
  const ko = fonts.filter((f) => f.hangul).length
  items.push({
    id: 'fonts',
    label: '시스템 폰트',
    status: fonts.length ? 'ok' : 'warn',
    detail: fonts.length ? `폰트 ${fonts.length}종 (한글 ${ko}종)` : '폰트를 찾지 못했어요',
    action: { id: 'rescan-fonts', label: '다시 찾기' },
  })

  try {
    const s = statfsSync(projectsDir())
    const freeGb = (s.bavail * s.bsize) / 1024 ** 3
    items.push({
      id: 'disk',
      label: '저장 공간',
      status: freeGb < 5 ? 'warn' : 'ok',
      detail: `여유 ${freeGb.toFixed(0)}GB${freeGb < 5 ? ' — 영상 작업에는 5GB 이상을 권장해요' : ''}`,
    })
  } catch {
    /* statfs unsupported */
  }

  return { items, ready: items.every((i) => i.status !== 'error') }
}

export async function installBrowser(): Promise<{ ok: boolean; message: string }> {
  const ok = await ensureBrowser()
  return ok ? { ok, message: '렌더 엔진을 준비했어요.' } : { ok, message: '내려받지 못했어요. 인터넷 연결을 확인해 주세요.' }
}
