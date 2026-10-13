// Section speed in an export: with "총 길이 유지" a slowed section makes the video
// longer (the end must not be cut), and sound effects move with the picture.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/export-remap.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// unique per run: earlier runs' exports stay in the gallery
const exportName = `remap-check-${Date.now()}`
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
try {
  console.log('home…')
  await toHome(win)
  console.log('open…')
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const state = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const o = structuredClone(state.overrides)
  o.timeRemap = [{ from: 2, to: 4, speed: 0.5 }] // 2s → 4s: 8s video becomes 10s
  o.keepTotalDuration = true
  console.log('save…')
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '테스트: 구간 속도 0.5배'), [p.id, o])
  console.log('saved')
  const html = readFileSync(join(p.path, 'composition', 'index.html'), 'utf8')
  check('file length is 10s with the slowed section', /data-composition-id="main"[^>]*data-duration="10"/.test(html), html.match(/<[^>]*data-composition-id[^>]*>/)?.[0])
  // 0–2s unchanged, 2–4s plays at half speed (doubled), after 4s everything is 2s later
  const expected = (t) => (t <= 2 ? t : t <= 4 ? 2 + (t - 2) * 2 : t + 2)
  const sfx = [...html.matchAll(/<audio[^>]*data-ms-type="sfx"[^>]*>/g)].map((m) => m[0])
  const wrong = sfx.filter((t) => {
    const a = parseFloat(t.match(/data-ms-authored-start="([\d.]+)"/)?.[1] ?? 'NaN')
    const now = parseFloat(t.match(/ data-start="([\d.]+)"/)[1])
    return !(Math.abs(now - expected(a)) < 0.01)
  })
  check(`sound effects move with the picture (${sfx.length})`, sfx.length > 0 && wrong.length === 0, wrong.join('\n').slice(0, 400))
  await win.evaluate(([id, name]) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: name }), [p.id, exportName])
  let rec = null
  for (let i = 0; i < 600 && !rec; i++) {
    await win.waitForTimeout(1000)
    rec = (await win.evaluate((id) => window.studio.renders.list(id), p.id)).find((r) => r.fileName.startsWith(exportName))
  }
  const dur = rec ? parseFloat(execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(p.path, rec.file)]).toString()) : 0
  check('exported video keeps the whole 10s (end card not cut)', Math.abs(dur - 10) < 0.15, String(dur))
  // put the project back
  o.timeRemap = []
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '테스트 되돌리기'), [p.id, o])
  const back = readFileSync(join(p.path, 'composition', 'index.html'), 'utf8')
  check('removing the section restores the file', !/data-ms-authored-start/.test(back) && /data-composition-id="main"[^>]*data-duration="8"/.test(back))
} catch (e) {
  console.error('FAILED:', e.message)
  failed++
} finally {
  console.log('closing…')
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20000))])
  console.log(closed ? 'closed' : 'CLOSE HUNG')
  if (!closed) failed++
}
process.exit(failed ? 1 : 0)
