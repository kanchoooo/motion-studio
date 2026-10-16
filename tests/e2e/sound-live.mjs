// Choosing music by listening, with a real Claude session (uses the logged-in Claude account and the
// internet; the app's default model and effort):
//  - asked for free background music, Claude shows candidates in the chat with something to play
//    (a direct audio link that answers, or a listening copy in the project)
//  - the designer picks one on the card: Claude brings it in as THE background music, marked
//    (data-ms-type="bgm"), one music track — and the Sound tab lists it
// The folder-trust question is never answered by a test, so the sandbox's trusted project is used:
// it (and the profile) is backed up first and put back afterwards.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted (ms-p6-…)> node tests/e2e/sound-live.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
if (!sandbox) throw new Error('MS_SANDBOX=<sandbox with the trusted "앱 주문 런칭" project> required')
const NAME = '앱 주문 런칭'
const proj = join(sandbox, 'projects', `${NAME}.msproj`)
const comp = join(proj, 'composition', 'index.html')
const backup = join(sandbox, `backup-sound-live-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`)
const shots = join(root, 'tests', 'e2e', 'shots-live')
mkdirSync(shots, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

cpSync(proj, join(backup, 'project'), { recursive: true })
cpSync(join(sandbox, 'userdata'), join(backup, 'userdata'), { recursive: true })
function restore() {
  rmSync(proj, { recursive: true, force: true })
  cpSync(join(backup, 'project'), proj, { recursive: true })
  rmSync(join(sandbox, 'userdata'), { recursive: true, force: true })
  cpSync(join(backup, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
  rmSync(backup, { recursive: true, force: true })
}
// the app's default model and effort
const metaFile = join(proj, 'project.json')
const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
delete meta.agentModel
delete meta.agentEffort
writeFileSync(metaFile, JSON.stringify(meta, null, 2))
const bgmTags = () => [...readFileSync(comp, 'utf8').matchAll(/<audio\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /data-ms-type="bgm"/.test(t) && !/data-ms-managed="true"/.test(t))

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
async function closeApp() {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  }).catch(() => {})
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20000))])
  if (!closed) app.process().kill('SIGKILL')
}
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    try {
      app.process().kill('SIGKILL')
    } catch {
      /* gone */
    }
    restore()
    process.exit(1)
  })

const state = (pid) => win.evaluate((id) => window.studio.agent.state(id), pid)
const chat = (pid) => win.evaluate((id) => window.studio.agent.transcript(id), pid)
async function waitTurns(pid, label, minutes) {
  for (let i = 0; i < 90 && (await state(pid)).status !== 'busy'; i++) await win.waitForTimeout(1000)
  let quiet = 0
  for (let i = 0; i < minutes * 60; i++) {
    const s = await state(pid)
    if (s.attention === 'usage' || s.attention === 'login' || s.attention === 'trust') throw new Error(`Claude needs the designer (${s.attention})`)
    if (s.status === 'exited') throw new Error('the Claude session ended')
    quiet = s.status === 'ready' ? quiet + 1 : 0
    if (quiet >= 25) return true
    if (i % 60 === 0) log('…', label, s.status)
    await win.waitForTimeout(1000)
  }
  return false
}

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: NAME }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === NAME).id
  for (let i = 0; i < 120 && (await state(pid)).status !== 'ready'; i++) {
    if ((await state(pid)).attention === 'trust') throw new Error('this sandbox folder is not trusted (a test never answers that question)')
    await win.waitForTimeout(1000)
  }
  check('session ready', (await state(pid)).status === 'ready')
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'all'), pid)
  const bgm0 = bgmTags()
  log('music before:', JSON.stringify(bgm0))

  // ---- ask for candidates ----
  const askAt = Date.now()
  const input = win.getByPlaceholder(/Claude에게 요청하기|표시한 부분을/)
  await input.fill('배경음악을 바꾸고 싶어요. 상업적으로 쓸 수 있고 출처 표기가 필요 없는 무료 음악 중에 밝고 경쾌한 후보 3개만 찾아서 들어 볼 수 있게 보여 주세요. 고르면 그걸로 바꿔 주세요.')
  await input.press('Enter')
  // the message reached the session (a terminal prompt would swallow what is typed)
  const plain = (s) => s.replace(/\x1b\[(\d*)C/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
  let reached = false
  for (let i = 0; i < 30 && !reached; i++) {
    reached = (await chat(pid)).some((x) => x.role === 'user' && Date.parse(x.at) >= askAt) || (await state(pid)).status === 'busy'
    if (!reached) await win.waitForTimeout(1000)
  }
  if (!reached) log('terminal:', plain(await win.evaluate((id) => window.studio.terminal.snapshot(id), pid)).split('\n').filter((l) => l.trim()).slice(-25).join('\n'))
  check('the message reached Claude', reached)
  if (!reached) throw new Error('the message did not reach Claude (terminal above)')
  check('the search turns finished', await waitTurns(pid, 'finding music', 20))
  const card = (await chat(pid)).filter((x) => x.role === 'audio' && Date.parse(x.at) >= askAt).pop()
  log('candidates:', JSON.stringify(card?.list?.items?.map((c) => ({ t: c.title, src: c.source, lic: c.license, url: c.previewUrl, file: c.file }))))
  check('a card of music candidates came to the chat', !!card && card.list.kind === 'bgm' && card.list.items.length >= 2, JSON.stringify(card))
  // each can be heard: a link that answers with audio, or a file in the project
  let audible = 0
  for (const c of card?.list.items ?? []) {
    if (c.file && existsSync(join(proj, 'composition', c.file))) audible++
    else if (c.previewUrl) {
      const r = await fetch(c.previewUrl, { method: 'GET', headers: { Range: 'bytes=0-1023' } }).catch(() => null)
      const type = r?.headers.get('content-type') ?? ''
      if (r && r.status < 400 && /audio|octet-stream|mpeg/.test(type)) audible++
      else log('not playable:', c.previewUrl, r?.status, type)
    }
  }
  check('every candidate can be played', !!card && audible === card.list.items.length, `${audible}/${card?.list.items.length}`)
  const ui = win.getByTestId('audio-card').last()
  await ui.scrollIntoViewIfNeeded()
  check('the card shows a play button and a pick button per candidate', (await ui.getByTestId('audio-play').count()) === card?.list.items.length && (await ui.getByTestId('audio-pick').count()) === card?.list.items.length)
  await ui.getByTestId('audio-play').first().click()
  await win.waitForTimeout(1500)
  check('pressing play plays it (the button turns to pause)', (await ui.getByTestId('audio-play').first().innerHTML()).includes('pause'))
  await ui.getByTestId('audio-play').first().click()
  await win.screenshot({ path: join(shots, 'sound-live-card.png') })

  // ---- pick one: Claude makes it the background music ----
  await ui.getByTestId('audio-pick').first().click()
  check('the pick shows on the card', await ui.getByText('골랐어요').waitFor({ timeout: 10000 }).then(() => true, () => false))
  check('the pick turns finished', await waitTurns(pid, 'placing the music', 20))
  const after = bgmTags()
  log('music after:', JSON.stringify(after))
  const src = after[0]?.match(/\ssrc="([^"]+)"/)?.[1] ?? ''
  check('one music track, marked as bgm with a label', after.length === 1 && /data-ms-id="[^"]+"/.test(after[0]) && /data-ms-label="[^"]+"/.test(after[0]), JSON.stringify(after))
  check('…playing a file brought into the project (not the old one)', !!src && existsSync(join(proj, 'composition', decodeURIComponent(src))) && !bgm0.some((t) => t.includes(`src="${src}"`)), src)
  await win.getByRole('button', { name: '사운드', exact: true }).click()
  await win.waitForTimeout(1200)
  const panel = await win.getByTestId('sound-panel').innerText()
  check('the Sound tab lists the new music (Claude)', /배경음악[\s\S]*Claude/.test(panel) && panel.includes(src.split('/').pop().replace(/\.[^.]+$/, '').slice(0, 12)), panel.slice(0, 500))
  await win.screenshot({ path: join(shots, 'sound-live-panel.png') })
  const said = (await chat(pid)).filter((x) => x.role === 'assistant' && Date.parse(x.at) >= askAt).map((x) => x.text.replace(/\s+/g, ' ').slice(0, 300))
  for (const x of said) log('Claude:', x)
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'sound-live-fail.png') }).catch(() => {})
} finally {
  await closeApp()
  restore()
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
