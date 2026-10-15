// Real auto-update: runs an older packaged app (e.g. 0.2.3) and checks that it
// downloads the latest GitHub release, installs it and restarts as the new version.
// UPDATE_APP=<path to older MotionStudio.app> node tests/e2e/update-live.mjs
import { cleanupOnExit } from './access.mjs'
import { chromium } from 'playwright-core'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appPath = process.env.UPDATE_APP
const shots = join(root, 'tests', 'e2e', 'shots-update')
mkdirSync(shots, { recursive: true })
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-upd-')))
const version = () => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(appPath, 'Contents', 'Info.plist')]).toString().trim()
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)

const before = version()
log('installed version:', before)
const proc = spawn(join(appPath, 'Contents', 'MacOS', 'MotionStudio'), ['--remote-debugging-port=0'], {
  env: { ...process.env, MS_USER_DATA: join(sandbox, 'ud'), MS_PROJECTS_DIR: join(sandbox, 'pj') },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const ws = await new Promise((resolve, reject) => {
  let err = ''
  proc.stderr.on('data', (d) => {
    err += d
    const m = err.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) resolve(m[1])
  })
  setTimeout(() => reject(new Error('no debugging port')), 60000)
})
const browser = await chromium.connectOverCDP(ws)
let page
for (let i = 0; i < 100 && !page; i++) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools:'))
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
const exited = new Promise((r) => proc.once('exit', r))
let n = 0
let sawDownload = false
while (proc.exitCode === null) {
  const text = await page.evaluate(() => document.body.innerText).catch(() => '')
  if (/받고 있어요|설치하고 다시 시작/.test(text)) sawDownload = true
  if (n % 10 === 0) {
    log(text.replace(/\s+/g, ' ').slice(0, 120))
    await page.screenshot({ path: join(shots, `update-${String(n).padStart(3, '0')}.png`) }).catch(() => {})
  }
  n++
  if (/현재 버전/.test(text) === false && /작업 환경을 확인|암호/.test(text) && !sawDownload) {
    log('no update was offered')
    break
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))])
}
await browser.close().catch(() => {})
log('old app exited:', proc.exitCode, 'saw download:', sawDownload)
// ShipIt replaces the bundle after the old app quits, then starts the new one
let after = before
for (let i = 0; i < 180 && after === before; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  try {
    after = version()
  } catch {
    /* being replaced */
  }
}
log('version on disk now:', after)
// ShipIt starts the updated app a few seconds after the bundle is replaced
const relaunched = () => execFileSync('ps', ['-axo', 'pid,command']).toString().split('\n').filter((l) => l.includes(`${appPath}/Contents/MacOS/MotionStudio`))
let running = relaunched()
for (let i = 0; i < 30 && !running.length; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  running = relaunched()
}
log('restarted app processes:', running.length)
for (const l of running) {
  try {
    process.kill(Number(l.trim().split(/\s+/)[0]))
  } catch {
    /* gone */
  }
}
process.exit(after !== before && sawDownload && running.length ? 0 : 1)
