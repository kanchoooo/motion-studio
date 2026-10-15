// Instant variations (no Claude): speed-matched 6s and scaled 1280x720, exported and probed.
// Run: MS_SANDBOX=<dir> node tests/e2e/variations-quick.mjs
import { grantAccess, toHome } from './access.mjs'
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-variations')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX
const ffprobe = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffprobe')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const shot = async (n) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${n}.png`) })
  log('shot', n)
}
// the variations are made in the shared sandbox: they go again at the end so other tests see only the original
let created = []
const probe = (f) => execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'compact', f], { encoding: 'utf8' }).trim().replace(/\n/g, ' | ')
try {
  await toHome(win)
  const list = await win.evaluate(() => window.studio.projects.list())
  const original = list.find((p) => !p.family)
  await win.evaluate((p) => window.studio.projects.open(p), original.path)
  created = await win.evaluate((id) => window.studio.variations.create(id, { base: { kind: 'current' }, targets: [
    { preset: 'youtube-16x9', width: 1920, height: 1080, duration: 6, lengthMethod: 'retime' },
    { preset: 'custom', width: 1280, height: 720, duration: 8 },
  ] }), original.id)
  log('created', created.map((c) => `${c.meta.name} [${c.meta.family.method}] ${c.brief.output.width}x${c.brief.output.height} ${c.brief.output.duration}s`).join(' ; '))
  for (const c of created) {
    const html = readFileSync(join(c.path, 'composition', 'index.html'), 'utf8')
    log(c.meta.family.method, 'root:', html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0].replace(/\s+/g, ' '))
    const id = await win.evaluate(async ([pid, fmt]) => window.studio.renders.start(pid, { format: fmt, quality: 'draft', fileName: '' }), [c.meta.id, c.brief.output.format])
    // wait for the render file
    for (let i = 0; i < 600; i++) {
      const files = readdirSync(join(c.path, 'renders')).filter((f) => f.endsWith('.mp4') && !f.includes('.tmp'))
      const ix = join(c.path, 'renders', 'index.json')
      const idx = existsSync(ix) && JSON.parse(readFileSync(ix, 'utf8')).find((r) => r.id === id)
      if (idx && files.length) break
      await win.waitForTimeout(1000)
    }
    const f = readdirSync(join(c.path, 'renders')).filter((x) => x.endsWith('.mp4')).sort().at(-1)
    log(c.meta.family.method, 'render', f, '→', probe(join(c.path, 'renders', f)))
  }
  const fam = created[0]
  await win.evaluate((p) => window.studio.projects.open(p), fam.path)
} catch (e) {
  console.error('QUICK VARIATIONS FAILED:', e.message)
  await shot('zz-quick-failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  for (const c of created) rmSync(c.path, { recursive: true, force: true })
}
