// Quitting after an export must not hang (no stray warning dialog, no leftover work).
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// unique per run: earlier runs' exports stay in the gallery
const exportName = `close-check-${Date.now()}`
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await toHome(win)
const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
await win.evaluate((path) => window.studio.projects.open(path), p.path)
if (process.env.REMAP) {
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const o = structuredClone(st.overrides)
  o.timeRemap = [{ from: 2, to: 4, speed: 0.5 }]
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '닫기 확인(구간)'), [p.id, o])
  console.log('remap saved')
}
if (process.env.SAVE) {
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const o = structuredClone(st.overrides)
  o.timeRemap = [{ from: 2, to: 4, speed: 0.5 }]
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '닫기 확인'), [p.id, o])
  o.timeRemap = []
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '닫기 확인 되돌리기'), [p.id, o])
  console.log('saved twice')
}
if (process.env.EXPORT) {
  await win.evaluate(([id, name]) => window.studio.renders.start(id, { format: 'mp4-h264', quality: 'draft', fileName: name }), [p.id, exportName])
  for (let i = 0; i < 600; i++) {
    await win.waitForTimeout(1000)
    if ((await win.evaluate((id) => window.studio.renders.list(id), p.id)).some((r) => r.fileName.startsWith(exportName))) break
  }
  console.log('exported')
}
const { execFileSync } = await import('node:child_process')
const chromes = () => execFileSync('ps', ['-axo', 'pid,ppid,etime,command']).toString().split('\n').filter((l) => l.includes('chrome-headless-shell --allow')).map((l) => l.trim().split(/\s+/).slice(0, 3).join(' '))
console.log('render chrome before close:', JSON.stringify(chromes()))
console.log('quit state:', JSON.stringify(await app.evaluate(() => globalThis.__msQuitState?.())))
const pending = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle() + (w.isVisible() ? '' : ' (hidden)')))
console.log('windows before close:', JSON.stringify(pending))
const t0 = Date.now()
const closed = await Promise.race([app.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))])
console.log(closed ? `closed in ${Date.now() - t0}ms` : 'CLOSE HUNG')
console.log('render chrome after close:', JSON.stringify(chromes()))
process.exit(closed ? 0 : 1)

