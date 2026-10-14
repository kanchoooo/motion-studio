// Reference videos are analysed every 0.1 s: motion sheets (20 frames / 2 s each),
// a motion curve and cuts; Claude gets them from get_references.
// MS_SANDBOX=<sandbox with "앱 주문 런칭"> REF=<video> node tests/e2e/ref-sheets.mjs
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
const check = (n, ok, d = '') => {
  console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`)
  if (!ok) failed++
}
try {
  await toHome(win)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const t0 = Date.now()
  const [added] = await win.evaluate(([id, f]) => window.studio.references.addFiles(id, [f]), [st.meta.id, process.env.REF])
  let r = null
  for (let i = 0; i < 240; i++) {
    r = (await win.evaluate((id) => window.studio.references.list(id), st.meta.id)).find((x) => x.id === added.id)
    if (r?.status === 'ready' || r?.status === 'error') break
    await new Promise((res) => setTimeout(res, 500))
  }
  console.log(`analysed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, r?.status, r?.error ?? '', `${r?.meta?.duration}s`)
  const dur = r?.meta?.duration ?? 0
  check(`motion sheets cover the whole video (${r?.sheets?.length} sheets)`, r?.sheets?.length === Math.ceil(Math.round(dur * 10) / 20) && r.sheets.every((s) => existsSync(join(p.path, s.file))), JSON.stringify(r?.sheets?.slice(-1)))
  check(`motion curve every 0.1 s (${r?.motion?.length} steps)`, Math.abs((r?.motion?.length ?? 0) - Math.round(dur * 10)) <= 2)
  console.log('cuts:', JSON.stringify(r?.cuts), 'max motion:', Math.max(...(r?.motion ?? [0])))
  copyFileSync(join(p.path, r.sheets[Math.min(2, r.sheets.length - 1)].file), join(root, 'tests', 'e2e', 'shots', 'ref-sheet.jpg'))
  await win.evaluate(([id, rid]) => window.studio.references.remove(id, rid), [st.meta.id, added.id])
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
