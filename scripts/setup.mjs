#!/usr/bin/env node
// One-command developer setup for Intel Macs, Apple Silicon Macs and Windows.
//   npm run setup
// 1) checks Node  2) installs dependencies  3) downloads FFmpeg/ffprobe/yt-dlp
// for this OS+CPU  4) checks the render browser  5) checks the Claude login.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const target = `${process.platform}-${process.arch}`
const ok = (m) => console.log(`  ✓ ${m}`)
const warn = (m) => console.log(`  ! ${m}`)
const step = (m) => console.log(`\n▶ ${m}`)
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts })

console.log(`모션스튜디오 개발 환경 설정 (${target})`)

step('Node.js 버전')
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`  ✗ Node ${process.versions.node} — 22.12 이상이 필요해요. (.nvmrc: 24)\n    nvm install 24 && nvm use 24   또는   fnm use`)
  process.exit(1)
}
ok(`Node ${process.versions.node}`)
if (!['darwin-x64', 'darwin-arm64', 'win32-x64'].includes(target)) warn(`${target}는 공식 지원 환경이 아니에요 (darwin-x64, darwin-arm64, win32-x64)`)

step('의존성 설치 (npm ci)')
const lock = existsSync(join(root, 'package-lock.json'))
const r = run('npm', [lock ? 'ci' : 'install'])
if (r.status !== 0) process.exit(r.status ?? 1)
ok('설치 완료 (node-pty 실행 권한 보정 포함)')

step(`FFmpeg · ffprobe · yt-dlp (${target})`)
const b = run(process.execPath, [join(root, 'scripts', 'fetch-binaries.mjs')])
if (b.status !== 0) process.exit(b.status ?? 1)

step('Claude Code (Agent SDK에 포함된 실행 파일)')
const claude = join(root, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${target}`, win ? 'claude.exe' : 'claude')
if (!existsSync(claude)) warn(`실행 파일이 없어요: ${claude}\n    npm ci를 다시 실행해 주세요.`)
else {
  try {
    const s = JSON.parse(execFileSync(claude, ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 20000 }))
    if (s.loggedIn) ok(`로그인됨: ${s.email ?? ''} ${s.orgName ? `(${s.orgName})` : ''}`)
    else warn(`로그인이 필요해요:  "${claude}" auth login`)
  } catch {
    warn(`로그인 상태를 확인하지 못했어요. 앱의 환경 점검 화면에서 로그인할 수 있어요.`)
  }
}

step('영상 렌더 엔진 (Chrome)')
const hf = join(root, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')
const p = spawnSync(process.execPath, [hf, 'browser', 'path'], { cwd: root, encoding: 'utf8', env: { ...process.env, HYPERFRAMES_TELEMETRY: '0' } })
const found = (p.stdout || '').split('\n').map((l) => l.trim()).find((l) => l && existsSync(l))
if (found) ok(found)
else {
  warn('렌더 엔진이 없어서 내려받아요 (약 150MB)')
  run(process.execPath, [hf, 'browser', 'ensure'], { env: { ...process.env, HYPERFRAMES_TELEMETRY: '0' } })
}

console.log(`\n준비 완료!  다음 명령으로 실행하세요:\n  npm run dev        개발 모드\n  npm test           단위 테스트\n  npm run test:e2e   화면 흐름 테스트\n`)
