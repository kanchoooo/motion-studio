// Test runs skip the first-launch password by marking the sandbox profile as
// already unlocked (the password itself is not stored in the repository).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function grantAccess(userDataDir) {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'access.json'), JSON.stringify({ ok: true, at: new Date().toISOString() }))
}

/** past the environment check to Home (a fresh profile stops there while the workspace is not trusted) */
export async function toHome(win) {
  // the home screen (its folder tree), whichever folder it remembers
  const home = win.getByTestId('folder-tree')
  const start = win.getByRole('button', { name: '시작하기' })
  await Promise.race([home.waitFor({ timeout: 90000 }), start.and(win.locator(':enabled')).waitFor({ timeout: 90000 })])
  if (!(await home.isVisible())) await start.click()
  await home.waitFor({ timeout: 20000 })
}

/**
 * The app under test: the dev build, or with MS_APP_EXEC the packaged app (its release fuses
 * block Playwright's launcher, so it is started with a debugging port and attached to).
 */
export async function launchApp({ env, cwd }) {
  const exec = process.env.MS_APP_EXEC
  const { _electron: electron, chromium } = await import('playwright-core')
  if (!exec) return electron.launch({ args: [join(cwd, 'out', 'main', 'index.js')], cwd, env })
  const { spawn } = await import('node:child_process')
  const proc = spawn(exec, ['--remote-debugging-port=0'], { cwd, env: { ...env, MS_NO_UPDATE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  const ws = await new Promise((resolve, reject) => {
    let err = ''
    const timer = setTimeout(() => reject(new Error('app did not open a debugging port')), 60000)
    proc.stderr.on('data', (d) => {
      err += d
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
  })
  const browser = await chromium.connectOverCDP(ws)
  return {
    pid: proc.pid,
    async firstWindow() {
      for (;;) {
        const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools:') && !p.url().includes('ms-preview'))
        if (page) return page
        await new Promise((r) => setTimeout(r, 200))
      }
    },
    async close() {
      await browser.close().catch(() => {})
      proc.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 3000))
    },
  }
}
