// The Windows installer onto the public releases repository: CI builds it in the source repository
// when a v<version> tag is pushed (.github/workflows/build.yml puts it on that repository's release);
// this waits for that run and copies the installer and its update file (latest.yml) over.
// node scripts/mirror-windows.mjs [version]   (build-mac.mjs --release runs it)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = 'kanchoooo/motion-studio'
const RELEASES = 'kanchoooo/motion-studio-releases'
const version = process.argv[2] || JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = `v${version}`
const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', ...opts })
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

console.log(`\n▶ 윈도우 설치 파일: ${SOURCE}의 ${tag} 빌드를 기다려요`)
let id = ''
for (let i = 0; i < 60 && !id; i++) {
  id = gh(['run', 'list', '--repo', SOURCE, '--workflow', 'build.yml', '--branch', tag, '--limit', '1', '--json', 'databaseId', '-q', '.[0].databaseId']).trim()
  if (!id) sleep(10_000)
}
if (!id) throw new Error(`${tag} 윈도우 빌드가 시작되지 않았어요 (태그가 올라갔는지 확인해 주세요)`)
try {
  gh(['run', 'watch', id, '--repo', SOURCE, '--exit-status', '--interval', '30'], { stdio: 'ignore' })
} catch {
  throw new Error(`윈도우 빌드가 실패했어요: https://github.com/${SOURCE}/actions/runs/${id} (gh run rerun ${id} --failed 뒤 이 스크립트를 다시 실행)`)
}
const dir = mkdtempSync(join(tmpdir(), 'ms-win-'))
try {
  gh(['release', 'download', tag, '--repo', SOURCE, '--dir', dir, '--pattern', `MotionStudio-Setup-${version}-*`, '--pattern', 'latest.yml'], { stdio: 'inherit' })
  const files = readdirSync(dir).map((f) => join(dir, f))
  if (!files.some((f) => f.endsWith('.exe')) || !files.some((f) => f.endsWith('latest.yml'))) throw new Error('윈도우 설치 파일이나 latest.yml이 없어요')
  gh(['release', 'upload', tag, ...files, '--repo', RELEASES, '--clobber'], { stdio: 'inherit' })
  console.log(`▶ 윈도우 배포 완료: https://github.com/${RELEASES}/releases/tag/${tag}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
