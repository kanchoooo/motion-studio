// 모션스튜디오 맥 설치 파일: Developer ID 서명 + 공증 (M칩용·Intel용 각각)
// 사용법: node scripts/build-mac.mjs [--arch arm64|x64|both] [--release [--notes "변경 내용"]]   (npm run dist:mac)
//   --release: 빌드가 끝나면 GitHub Releases(kanchoooo/motion-studio)에 v<버전>으로 올린다 → 설치된 앱이 다음 실행 때 자동 업데이트
//   --local: 개발 중 빠른 확인용. 이 맥의 CPU용 앱만 서명해서 만들고(공증·dmg·zip 없음, 이 맥에서 만든 앱이라 격리 표시가 없음)
//            /Applications/MotionStudio.app 에 덮어써 설치한다. 열려 있던 앱은 정상 종료 후 다시 연다.
//   --local --no-install: 빌드만 한다(테스트 중인 앱을 끄지 않게). 앱은 release/mac(-arm64)/MotionStudio.app
//
// 미니미광장(scripts/build-mac.mjs)과 같은 서명 방식·키체인 안전 규칙을 쓴다.
// 서명: ~/.minimi-signing/DeveloperID_Application.p12 (+ p12-password)
//   빌드 전용 임시 키체인에 넣어서 서명 → 키체인 "허용" 창이 뜨지 않는다.
//   (electron-builder 26 의 CSC_LINK 임시 키체인은 set-key-partition-list 에 p12 비밀번호를 넘기는 버그가 있어 직접 만든다)
// 공증: 키체인 프로필 "minimi-notary" (xcrun notarytool store-credentials 로 한 번 저장)
//
// 키체인 안전 규칙 (다른 앱이 아무도 모르는 암호 창에 걸리지 않게)
//   - 임시 키체인은 검색 목록 맨 뒤(login.keychain-db 뒤)에만 붙이고, 빌드 중에는 잠기지 않게 둔다
//   - 끝나면(성공·실패·Ctrl+C·SIGTERM·예외 모두) 목록에서 빼고 지운다
//   - 끊긴 빌드가 남긴 임시 키체인은 다음 빌드 시작 때 먼저 치운다
//   - 서명 빌드는 한 번에 하나만: ~/.minimi-signing/.build.lock (미니미광장·비둘기모니터 서명 빌드와 같이 쓴다)
//   - 기본 키체인·로그인 키체인 암호는 건드리지 않는다
//   - Claude Code 실행 파일은 Anthropic 서명을 그대로 둔다 (electron-builder.config.cjs signIgnore)
import { execFileSync, execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import yaml from 'js-yaml'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const dir = process.env.MINIMI_SIGNING_DIR ?? join(homedir(), '.minimi-signing')
const p12 = join(dir, 'DeveloperID_Application.p12')
const pwFile = join(dir, 'p12-password')
const profile = process.env.APPLE_KEYCHAIN_PROFILE ?? 'minimi-notary'
const local = process.argv.includes('--local')
const ai = process.argv.indexOf('--arch')
const archArg = ai > 0 ? process.argv[ai + 1] : local ? (process.arch === 'arm64' ? 'arm64' : 'x64') : 'both'
if (local && process.argv.includes('--release')) throw new Error('--local 과 --release 는 같이 쓸 수 없어요')
const arches = archArg === 'both' ? ['arm64', 'x64'] : [archArg]
if (!arches.every((a) => a === 'arm64' || a === 'x64')) throw new Error(`--arch 는 arm64, x64, both 중 하나예요: ${archArg}`)
const LOCK = join(homedir(), '.minimi-signing', '.build.lock')

if (!existsSync(p12) || !existsSync(pwFile)) {
  throw new Error(`서명 인증서가 없어요: ${p12} (DEVELOPMENT.md "코드 서명과 공증" 참고)`)
}
let notarize = !local
if (notarize) {
  try {
    execSync(`xcrun notarytool history --keychain-profile ${profile}`, { stdio: 'ignore' })
  } catch {
    notarize = false
  }
  if (!notarize) console.warn(`⚠ 공증 프로필 "${profile}" 이 없어 서명만 하고 공증은 건너뜁니다.`)
}

const keychain = join(dir, 'build.keychain-db')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const security = (...args) => execFileSync('/usr/bin/security', args, { encoding: 'utf8' })
const unquote = (l) => l.trim().replace(/^"|"$/g, '')
const userKeychains = () => security('list-keychains', '-d', 'user').split('\n').map(unquote).filter(Boolean)

/** 검색 목록을 바꾼다. 비면 기본 키체인(로그인)만 남긴다 */
function setUserKeychains(list) {
  if (!list.length) list = [unquote(security('default-keychain', '-d', 'user'))]
  security('list-keychains', '-d', 'user', '-s', ...list)
}

/** 목록에서 우리 임시 키체인(과 이미 지워진 키체인 파일)만 뺀다 — 다른 항목은 그대로 둔다 */
function dropFromSearchList({ missingToo = false } = {}) {
  const now = userKeychains()
  const keep = now.filter((k) => k !== keychain && (!missingToo || existsSync(k)))
  if (keep.length !== now.length) {
    for (const k of now.filter((k) => !keep.includes(k))) console.log(`  키체인 검색 목록에서 뺌: ${k}`)
    setUserKeychains(keep)
  }
}

// ───────── 동시 빌드 잠금 ─────────

let lockHeld = false

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

async function acquireLock() {
  mkdirSync(dirname(LOCK), { recursive: true, mode: 0o700 })
  for (let waited = 0; ; waited += 5) {
    try {
      const fd = openSync(LOCK, 'wx', 0o600)
      writeSync(fd, JSON.stringify({ pid: process.pid, project: process.cwd(), startedAt: new Date().toISOString() }))
      closeSync(fd)
      lockHeld = true
      return
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let info = null
    try {
      info = JSON.parse(readFileSync(LOCK, 'utf8'))
    } catch {
      /* 막 만들어지는 중이거나 깨진 파일 */
    }
    let stale = info ? !alive(Number(info.pid)) : false
    if (!info) {
      try {
        stale = Date.now() - statSync(LOCK).mtimeMs > 60_000
      } catch {
        continue // 그 사이에 지워짐
      }
    }
    if (stale) {
      console.warn(`이전에 끊긴 서명 빌드의 잠금을 지웁니다${info ? ` (pid ${info.pid}, ${info.project})` : ''}`)
      try {
        unlinkSync(LOCK)
      } catch {
        /* 다른 쪽이 먼저 지움 */
      }
      continue
    }
    if (waited === 0) {
      console.log(`다른 서명 빌드가 진행 중이에요 (pid ${info?.pid ?? '?'}, ${info?.project ?? '?'}) — 끝나길 기다립니다…`)
    }
    if (waited >= 3600) throw new Error(`한 시간을 기다려도 다른 서명 빌드가 끝나지 않았어요: ${LOCK}`)
    await sleep(5000)
  }
}

// ───────── 정리 (어떻게 끝나든 한 번) ─────────

let child = null
let cleaned = false

function cleanup() {
  if (cleaned) return
  cleaned = true
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM') // electron-builder 와 그 아래 codesign 까지
    } catch {
      /* 이미 끝남 */
    }
  }
  if (lockHeld) {
    try {
      dropFromSearchList()
    } catch (e) {
      console.warn('키체인 검색 목록 복구 실패 — `security list-keychains -d user` 를 확인해 주세요', e)
    }
    try {
      security('delete-keychain', keychain)
    } catch {
      /* 없으면 무시 */
    }
    try {
      unlinkSync(LOCK)
    } catch {
      /* 무시 */
    }
    lockHeld = false
  }
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
for (const [sig, code] of Object.entries(SIGNALS)) {
  process.on(sig, () => {
    console.warn(`\n${sig} — 임시 키체인을 치우고 끝냅니다`)
    cleanup()
    process.exit(code)
  })
}
process.on('uncaughtException', (e) => {
  console.error(e)
  cleanup()
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(e)
  cleanup()
  process.exit(1)
})
process.on('exit', cleanup)

/** 자식 프로세스를 따로 묶어 실행 — 신호가 오면 cleanup() 이 묶음째 끈다 */
function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    child = spawn(cmd, args, { stdio: 'inherit', env, detached: true })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      child = null
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} 실패 (${signal ?? code})`))
    })
  })
}

// ───────── 빌드 ─────────

await acquireLock()

// 끊긴 빌드가 남긴 임시 키체인부터 치운다
dropFromSearchList({ missingToo: true })
try {
  security('delete-keychain', keychain)
} catch {
  /* 없으면 무시 */
}

const kcPass = randomBytes(24).toString('hex')
security('create-keychain', '-p', kcPass, keychain)
// 옵션 없음 = 시간·잠자기로 잠기지 않음 (빌드 중 다른 앱의 키체인 조회가 암호 창에 걸리지 않게)
security('set-keychain-settings', keychain)
security('unlock-keychain', '-p', kcPass, keychain)
security('import', p12, '-k', keychain, '-P', readFileSync(pwFile, 'utf8').trim(), '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild')
security('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', kcPass, keychain)
// 서명 인증서 이름은 p12 에서 읽는다 (저장소에 이름·팀 ID 를 적지 않으려고)
const found = security('find-identity', '-p', 'codesigning', keychain).match(/"Developer ID Application: ([^"]+)"/)
if (!found) throw new Error('p12 안에 Developer ID Application 인증서가 없어요')
const IDENTITY = found[1]
// electron-builder 가 서명 인증서를 검색 목록에서 찾으므로 넣되, 맨 뒤(로그인 키체인 뒤)에 붙인다
setUserKeychains([...userKeychains().filter((k) => k !== keychain), keychain])

const env = {
  ...process.env,
  CSC_KEYCHAIN: keychain,
  CSC_NAME: IDENTITY,
  ...(notarize ? { APPLE_KEYCHAIN_PROFILE: profile } : {})
}
delete env.CSC_LINK
delete env.CSC_KEY_PASSWORD
if (!notarize) delete env.APPLE_KEYCHAIN_PROFILE

try {
  await run('npx', ['electron-vite', 'build'])
  for (const arch of arches) {
    const target = `darwin-${arch}`
    // native packages for the target CPU (lets an Intel Mac build the M-chip app too)
    await run('node', ['scripts/prepare-target.mjs', '--target', target])
    await run('node', ['scripts/fetch-binaries.mjs', '--target', target])
    await run('npx', ['electron-builder', '--config', 'electron-builder.config.cjs', '--mac', ...(local ? ['dir'] : ['dmg', 'zip']), `--${arch}`, '--publish', 'never'], { ...env, MS_TARGET_ARCH: arch })
    // each run writes latest-mac.yml for its own CPU: keep it, they are merged below
    if (existsSync('release/latest-mac.yml')) copyFileSync('release/latest-mac.yml', `release/latest-mac-${arch}.yml`)
  }
  if (!local) mergeUpdateInfo()
  // a quick self-check of what we are about to hand out
  for (const app of ['release/mac/MotionStudio.app', 'release/mac-arm64/MotionStudio.app']) {
    if (!existsSync(app)) continue
    console.log(`\n▶ 확인: ${app}`)
    try {
      console.log(execFileSync('/usr/sbin/spctl', ['-a', '-vv', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
    } catch (e) {
      console.log(String(e.stderr || e.message).trim())
    }
    if (notarize) {
      try {
        console.log(execFileSync('xcrun', ['stapler', 'validate', app], { encoding: 'utf8' }).trim())
      } catch (e) {
        console.log(String(e.stdout || e.message).trim())
      }
    }
  }
} finally {
  cleanup()
}

if (process.argv.includes('--release')) publishRelease()
if (local && !process.argv.includes('--no-install')) installLocal()
else if (local) console.log(`\n▶ 빌드만 했어요(설치 안 함): ${arches[0] === 'arm64' ? 'release/mac-arm64' : 'release/mac'}/MotionStudio.app`)

/** --local: replaces /Applications/MotionStudio.app with the build (quits the open app first, reopens it after) */
function installLocal() {
  const built = arches[0] === 'arm64' ? 'release/mac-arm64/MotionStudio.app' : 'release/mac/MotionStudio.app'
  const target = '/Applications/MotionStudio.app'
  if (!existsSync(built)) throw new Error(`빌드한 앱이 없어요: ${built}`)
  const running = () => {
    try {
      return execFileSync('pgrep', ['-f', `${target}/Contents/MacOS/MotionStudio`], { encoding: 'utf8' }).trim().length > 0
    } catch {
      return false
    }
  }
  const wasOpen = running()
  if (wasOpen) {
    console.log('\n▶ 열려 있는 모션스튜디오를 정상 종료합니다')
    try {
      execFileSync('osascript', ['-e', 'tell application id "com.motionstudio.app" to quit'], { stdio: 'ignore', timeout: 20000 })
    } catch {
      /* the app may show its own "작업 중" question */
    }
    for (let i = 0; i < 60 && running(); i++) execSync('sleep 0.5')
    if (running()) throw new Error('모션스튜디오가 아직 열려 있어요(작업 중이거나 내보내는 중이면 앱이 종료를 묻습니다). 앱을 닫은 뒤 다시 실행해 주세요.')
  }
  const old = '/Applications/.MotionStudio-old.app'
  if (existsSync(old)) execFileSync('rm', ['-rf', old])
  if (existsSync(target)) execFileSync('mv', [target, old])
  try {
    execFileSync('ditto', [built, target])
  } catch (e) {
    if (existsSync(old)) execFileSync('mv', [old, target])
    throw e
  }
  if (existsSync(old)) execFileSync('rm', ['-rf', old])
  const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', `${target}/Contents/Info.plist`], { encoding: 'utf8' }).trim()
  console.log(`\n▶ 설치 완료: ${target} (버전 ${version})`)
  if (wasOpen) execFileSync('open', [target])
}

/** one latest-mac.yml listing both CPUs: the updater picks the arm64 or the x64 zip itself */
function mergeUpdateInfo() {
  const parts = ['arm64', 'x64'].map((a) => `release/latest-mac-${a}.yml`).filter((f) => existsSync(f))
  if (!parts.length) return
  const docs = parts.map((f) => yaml.load(readFileSync(f, 'utf8')))
  const files = docs.flatMap((d) => d.files ?? [])
  const main = docs.find((d) => !String(d.path).includes('arm64')) ?? docs[0]
  writeFileSync('release/latest-mac.yml', yaml.dump({ ...main, files }, { lineWidth: -1 }))
  console.log(`▶ 업데이트 정보: release/latest-mac.yml (${files.map((f) => f.url).join(', ')})`)
}

/** GitHub Releases v<version>: dmg (first install) + zip/blockmap/latest-mac.yml (auto-update) */
function publishRelease() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const tag = `v${version}`
  const ni = process.argv.indexOf('--notes')
  const notes = ni > 0 ? process.argv[ni + 1] : `모션스튜디오 ${version}`
  const assets = readdirSync('release')
    .filter((f) => f.startsWith(`MotionStudio-${version}-`) || f === 'latest-mac.yml')
    .filter((f) => /\.(dmg|zip|blockmap|yml)$/.test(f))
    .map((f) => `release/${f}`)
  if (!assets.some((a) => a.endsWith('latest-mac.yml'))) throw new Error('release/latest-mac.yml이 없어요')
  const repo = 'kanchoooo/motion-studio'
  let exists = true
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' })
  } catch {
    exists = false
  }
  if (exists) execFileSync('gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber'], { stdio: 'inherit' })
  else execFileSync('gh', ['release', 'create', tag, ...assets, '--repo', repo, '--title', `모션스튜디오 ${version}`, '--notes', notes, '--latest'], { stdio: 'inherit' })
  console.log(`\n▶ 배포 완료: https://github.com/${repo}/releases/tag/${tag}`)
}
