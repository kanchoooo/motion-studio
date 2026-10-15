// The app as shipped (no Claude calls, no AI credits):
//  - version (package.json), studio tools' 15-minute MCP timeout, the planning brief (출력 사양 saved, no BRIEF.md, 소재 panel)
//  - the HyperFrames registry copy is inside the app; the `hyperframes` command Claude's
//    session gets loads it and never copies to the clipboard
//  - with the network shut off, the app's own CLI searches and installs from the copy
// MS_APP_EXEC=release/mac/MotionStudio.app/Contents/MacOS/MotionStudio node tests/e2e/release-check.mjs
// (without MS_APP_EXEC it checks the dev build)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { grantAccess, launchApp, toHome, cleanupOnExit } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const exec = process.env.MS_APP_EXEC
const resources = exec ? join(dirname(exec), '..', 'Resources') : null
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-rel-')))
const env = { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') }
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await launchApp({ env, cwd: root })
const win = await app.firstWindow()
try {
  await toHome(win)
  const info = await win.evaluate(() => window.studio.app.info())
  // the dev build reports Electron's own version
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (exec) check(`version ${info.version} (the shipped app)`, info.version === version)

  // ---- 브리프 = planning in conversation ----
  const p = await win.evaluate(() => window.studio.projects.create({ name: '배포 확인', presetId: 'shorts-9x16', duration: 10 }))
  await win.reload()
  await toHome(win)
  await win.getByTestId('tree-root').click()
  await win.getByTestId('project-card').filter({ hasText: '배포 확인' }).first().click()
  await win.getByTestId('brief-tab').waitFor({ timeout: 30000 })
  check('a new project opens on the planning chat', await win.getByTestId('plan-empty').isVisible())
  await win.getByTestId('brief-nav-output').click()
  await win.getByTestId('preset-square-1x1').click()
  let brief
  for (let i = 0; i < 20; i++) {
    brief = JSON.parse(readFileSync(join(p.path, 'brief.json'), 'utf8'))
    if (brief.output.width === brief.output.height) break
    await win.waitForTimeout(250)
  }
  check('출력 사양 saved', brief.output.width === 1080 && brief.output.height === 1080, JSON.stringify(brief.output))
  check('no BRIEF.md from the app', !existsSync(join(p.path, 'composition', 'BRIEF.md')))
  await win.getByTestId('brief-nav-assets').click()
  check('소재 panel with the prompt helper', await win.getByTestId('prompt-helper').isVisible())

  // ---- the hyperframes command of a Claude session (opening the editor starts one; this folder is not trusted, so it waits at the trust question) ----
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const shim = join(sandbox, 'userdata', 'cli', 'hyperframes')
  for (let i = 0; i < 60 && !existsSync(shim); i++) await win.waitForTimeout(500)
  const text = existsSync(shim) ? readFileSync(shim, 'utf8') : ''
  // the Claude process this app started: studio tools may run up to 15 minutes (AI generation)
  const appPid = app.pid ?? app.process?.().pid
  let mcp = ''
  for (let i = 0; i < 40 && !mcp; i++) {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    const mine = new Set([String(appPid)])
    for (let grew = true; grew; ) {
      grew = false
      for (const [, pid, ppid] of rows) if (mine.has(ppid) && !mine.has(pid)) (mine.add(pid), (grew = true))
    }
    mcp = rows.find(([, pid, , cmd]) => mine.has(pid) && cmd.includes('--mcp-config') && cmd.includes('/mcp/'))?.[3] ?? ''
    if (!mcp) await win.waitForTimeout(500)
  }
  check('studio tools may run 15 minutes (no 60 s cut-off for image generation)', /"timeout":900000/.test(mcp), mcp.slice(0, 200))
  const hook = resources ? join(resources, 'hf-registry', 'offline-fetch.mjs') : join(root, 'resources', 'hf-registry', 'offline-fetch.mjs')
  check('the session command loads the registry copy', text.includes(pathToFileURL(hook).href), text.split('\n').slice(-3).join(' | '))
  check('…and adds --no-clipboard to add', /if \[ "\$1" = add \]; then exec .* "\$@" --no-clipboard; fi/.test(text))
  if (resources) {
    const m = JSON.parse(readFileSync(join(resources, 'hf-registry', 'mirror.json'), 'utf8'))
    check(`the registry copy ships with the app (${m.ref}: ${m.items} items, ${m.previews} previews)`, m.items > 400 && m.previews > 100)
  }
  const proj = mkdtempSync(join(tmpdir(), 'ms-rel-hf-'))
  writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }))
  const home = mkdtempSync(join(tmpdir(), 'ms-rel-home-'))
  const t0 = Date.now()
  const added = JSON.parse(execFileSync(shim, ['add', 'light-leak', '--json'], { cwd: proj, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 120000 }))
  check(`the session command installs a block (${((Date.now() - t0) / 1000).toFixed(1)} s), clipboard untouched`, added.ok && added.clipboardCopied === false && existsSync(join(proj, 'compositions', 'light-leak.html')))

  // ---- the app's own Node + CLI with the network shut off ----
  if (exec) {
    const offline = join(proj, 'offline.mjs')
    writeFileSync(offline, `globalThis.fetch = async (u) => { throw new Error('network used: ' + (u?.url ?? u)) }\n`)
    const cli = join(resources, 'app', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')
    const run = (...args) => execFileSync(exec, ['--import', pathToFileURL(offline).href, '--import', pathToFileURL(hook).href, cli, ...args], { cwd: proj, env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'ms-rel-home-')), ELECTRON_RUN_AS_NODE: '1', HYPERFRAMES_TELEMETRY: '0', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1' }, encoding: 'utf8', timeout: 120000 })
    const found = JSON.parse(run('catalog', '--query', 'film grain', '--json'))
    check('offline: catalog search answers from the copy', found.results.some((r) => r.name === 'grain-overlay'))
    const inst = JSON.parse(run('add', 'carousel-path-1', '--no-clipboard', '--json'))
    check('offline: a block with CDN pictures installs from the copy', inst.ok && inst.written.filter((f) => /\.jpg$/.test(f)).length > 10)
  }
} catch (e) {
  failed++
  console.log('✗', e.message)
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'release-check-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
