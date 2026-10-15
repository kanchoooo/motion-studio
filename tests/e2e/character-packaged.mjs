// The installed app can turn a character image into SVG (worker thread + sharp +
// vtracer shipped as files next to node_modules). No Claude, no AI credits.
// MS_APP_EXEC=<packaged app binary> node tests/e2e/character-packaged.mjs
// (without MS_APP_EXEC it runs the dev build)
import { _electron as electron, chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { grantAccess, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-charpkg-')))
const exec = process.env.MS_APP_EXEC
const env = { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata'), MS_NO_UPDATE: '1' }
grantAccess(join(sandbox, 'userdata'))

async function attachPackaged(file) {
  const proc = spawn(file, ['--remote-debugging-port=0'], { cwd: sandbox, env, stdio: ['ignore', 'ignore', 'pipe'] })
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
    async firstWindow() {
      for (;;) {
        const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools:'))
        if (page) return page
        await new Promise((r) => setTimeout(r, 200))
      }
    },
    async close() {
      await browser.close().catch(() => {})
      proc.kill('SIGTERM')
    },
  }
}

const app = exec ? await attachPackaged(exec) : await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env })
const win = await app.firstWindow()
let failed = 0
try {
  await toHome(win)
  const st = await win.evaluate(() => window.studio.projects.create({ name: '캐릭터 변환 확인', presetId: 'square-1x1', duration: 5 }))
  await win.evaluate((p) => window.studio.projects.open(p), st.path)
  const dir = join(st.path, '.studio', 'generations', 'pkgcheck')
  mkdirSync(dir, { recursive: true })
  await sharp(join(root, 'tests', 'fixtures', 'character', 'man', 'source.webp')).png().toFile(join(dir, 'source.png'))
  writeFileSync(join(st.path, '.studio', 'generations', 'candidates.json'), '[]')
  const info = await win.evaluate((id) => window.studio.ai.reconvert(id, '.studio/generations/pkgcheck', 'bust', 14), st.meta.id)
  const ok = info.status === 'done' && info.pass && info.shapes > 10
  console.log(`${ok ? '✓' : '✗'} character converted in ${exec ? 'the installed app' : 'the dev build'}: ${JSON.stringify(info)}`)
  if (!ok) failed++
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
