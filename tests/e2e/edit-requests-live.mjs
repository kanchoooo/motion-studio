// What a real Claude session does with the editor's requests (uses the logged-in Claude account,
// the app's default model and effort):
//  - 배경 따로 떼기 on a text that carries its own box: the text keeps its id, the box becomes
//    "<id>-bg" behind it, both in "<id>-group", and the video looks and moves the same
//  - after a turn, content without names (put in here by hand, like a turn that forgot them) makes
//    the app ask Claude once to name it: attributes only, the look stays
//  - a new element the designer asks for comes named (box and text apart)
//  - pins with files: what to do with them is in each pin's comment — replace a picture with the
//    attached one (use_as_material), restyle a button like the attached image, take a clip's colours
//    as a reference; Claude opens every attached file
// The folder-trust question is never answered by a test, so the sandbox's trusted project is used:
// it (and the profile) is backed up first and put back afterwards.
// MS_SANDBOX=<sandbox whose "앱 주문 런칭" folder is trusted (ms-p6-…)> node tests/e2e/edit-requests-live.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
if (!sandbox) throw new Error('MS_SANDBOX=<sandbox with the trusted "앱 주문 런칭" project> required')
const NAME = '앱 주문 런칭'
const proj = join(sandbox, 'projects', `${NAME}.msproj`)
const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
const backup = join(sandbox, `backup-edit-live-${stamp}`)
const shots = join(root, 'tests', 'e2e', 'shots-live')
mkdirSync(shots, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// ---- the project as it is put back afterwards ----
cpSync(proj, join(backup, 'project'), { recursive: true })
cpSync(join(sandbox, 'userdata'), join(backup, 'userdata'), { recursive: true })
function restore() {
  rmSync(proj, { recursive: true, force: true })
  cpSync(join(backup, 'project'), proj, { recursive: true })
  rmSync(join(sandbox, 'userdata'), { recursive: true, force: true })
  cpSync(join(backup, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
  rmSync(backup, { recursive: true, force: true })
}

// a video the designer edits by hand, at the app's default model / effort
const metaFile = join(proj, 'project.json')
const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
delete meta.agentModel
delete meta.agentEffort
meta.editable = true
writeFileSync(metaFile, JSON.stringify(meta, null, 2))
// content without names, as a turn that forgot them would leave (a box and the text on it)
const comp = join(proj, 'composition', 'index.html')
const UNNAMED_TEXT = '신메뉴 출시 기념'
writeFileSync(
  comp,
  readFileSync(comp, 'utf8').replace(
    '<!-- 효과음 -->',
    `<div style="position:absolute;left:1480px;top:70px;width:380px;height:90px;background:#FFE3CC;border-radius:20px"></div>
      <div style="position:absolute;left:1480px;top:70px;width:380px;height:90px;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#5B3A29">${UNNAMED_TEXT}</div>

      <!-- 효과음 -->`,
  ),
)
const source = () => readFileSync(comp, 'utf8')

// ---- what goes on the pins: a photo to put in, a button style, a clip to take colours from ----
const files = join(backup, 'pin-files')
mkdirSync(files, { recursive: true })
const ffmpeg = join(root, 'resources', 'bin', `darwin-${process.arch}`, 'ffmpeg')
const refClip = join(files, 'mood.mp4')
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2b1055:s=640x360:d=3:r=30,hue=h=t*40', '-pix_fmt', 'yuv420p', refClip])

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
win.on('dialog', (d) => void d.accept())
/** quits even while Claude works (the app asks first: 종료하기), never hangs the put-back */
async function closeApp() {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  }).catch(() => {})
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20000))])
  if (!closed) app.process().kill('SIGKILL')
}
let stopping = false
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    try {
      app.process().kill('SIGKILL')
    } catch {
      /* gone */
    }
    restore()
    process.exit(1)
  })
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})

/** an HTML picture drawn by the app's own browser (a PNG file) */
async function drawPng(file, html, width, height) {
  const b64 = await app.evaluate(
    async ({ BrowserWindow }, { html, width, height }) => {
      const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { offscreen: true } })
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await new Promise((r) => setTimeout(r, 400))
      const png = (await w.webContents.capturePage()).toPNG().toString('base64')
      w.destroy()
      return png
    },
    { html, width, height },
  )
  writeFileSync(file, Buffer.from(b64, 'base64'))
}
const photo = join(files, 'matcha.png')
await drawPng(
  photo,
  `<body style="margin:0;width:600px;height:440px;background:radial-gradient(circle at 30% 20%,#f4f1e6,#d8e4c8);display:flex;align-items:center;justify-content:center;font-family:sans-serif">
    <div style="position:relative;width:300px;height:300px">
      <div style="position:absolute;left:30px;top:250px;width:240px;height:30px;border-radius:50%;background:rgba(60,80,40,.18)"></div>
      <div style="position:absolute;left:40px;top:60px;width:220px;height:200px;border-radius:0 0 90px 90px;background:#fff;box-shadow:inset -20px 0 30px rgba(0,0,0,.06)"></div>
      <div style="position:absolute;left:40px;top:40px;width:220px;height:50px;border-radius:50%;background:#7fae4a"></div>
      <div style="position:absolute;left:70px;top:50px;width:160px;height:30px;border-radius:50%;background:#a9cf73"></div>
      <div style="position:absolute;left:250px;top:100px;width:60px;height:80px;border:16px solid #fff;border-left:none;border-radius:0 50px 50px 0"></div>
    </div>
    <div style="position:absolute;bottom:18px;width:100%;text-align:center;font-size:30px;font-weight:700;color:#3d5a1f">말차 라떼</div>
  </body>`,
  600,
  440,
)
const buttonLook = join(files, 'button-style.png')
await drawPng(
  buttonLook,
  `<body style="margin:0;width:640px;height:320px;background:#f6f4ff;display:flex;align-items:center;justify-content:center;font-family:sans-serif">
    <div style="padding:34px 90px;border-radius:999px;background:linear-gradient(90deg,#7b2ff7,#f107a3);color:#fff;font-size:44px;font-weight:800;box-shadow:0 18px 40px rgba(123,47,247,.45);border:4px solid rgba(255,255,255,.6)">Order now</div>
  </body>`,
  640,
  320,
)
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex')

// ---- reading the session ----
const pidOf = async () => (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === NAME).id
const state = (pid) => win.evaluate((id) => window.studio.agent.state(id), pid)
const chat = (pid) => win.evaluate((id) => window.studio.agent.transcript(id), pid)
/** Claude's turns (and the app's follow-up requests) are over: ready for 25 seconds in a row */
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
/** the files Claude opened with Read since a moment */
function readsSince(sessionId, since) {
  const dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  const file = readdirSync(dir).map((d) => join(dir, d, `${sessionId}.jsonl`)).find((f) => existsSync(f))
  if (!file) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const rec = JSON.parse(line)
      if (rec.type !== 'assistant' || Date.parse(rec.timestamp) < since) continue
      for (const c of rec.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'Read') out.push(String(c.input?.file_path ?? ''))
    } catch {
      /* a partial line */
    }
  }
  return out
}

// ---- the composition, looked at outside the editor (Claude's own page, no designer edits) ----
const preview = () => win.frames().find((f) => f.url().includes('ms-preview'))
async function ready() {
  for (let i = 0; i < 160; i++) {
    const f = preview()
    const ok = f && (await f.evaluate(() => !!(window.__playerReady && window.__player && window.__MS_RUNTIME__)).catch(() => false))
    if (ok && (await win.locator('[data-layer]').count())) return f
    await win.waitForTimeout(250)
  }
  throw new Error('preview did not start')
}
/** pictures of the moments and what `probe` (an expression) says at each, in a hidden window */
async function look(name, times, probe = 'null') {
  const url = (await ready()).url()
  const r = await app.evaluate(
    async ({ BrowserWindow }, { url, times, probe }) => {
      const w = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } })
      try {
        await w.loadURL(url)
        const js = (c) => w.webContents.executeJavaScript(c)
        for (let i = 0; i < 150 && !(await js('!!(window.__player && window.__playerReady)')); i++) await new Promise((res) => setTimeout(res, 100))
        await js('document.fonts ? document.fonts.ready.then(() => true) : true')
        const out = []
        for (const t of times) {
          await js(`(async () => { const P = window.__player; P.pause(); P.seek(${t}); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true })()`)
          await new Promise((res) => setTimeout(res, 250))
          out.push({ t, png: (await w.webContents.capturePage()).toPNG().toString('base64'), data: await js(probe) })
        }
        return out
      } finally {
        w.destroy()
      }
    },
    { url, times, probe },
  )
  for (const x of r) writeFileSync(join(shots, `edit-live-${name}-${x.t}.png`), Buffer.from(x.png, 'base64'))
  return r
}
/** share of pixels that changed between two pictures */
const changed = (a, b) =>
  app.evaluate(
    ({ nativeImage }, [a, b]) => {
      const x = nativeImage.createFromBuffer(Buffer.from(a, 'base64'))
      const y = nativeImage.createFromBuffer(Buffer.from(b, 'base64'))
      const p = x.toBitmap()
      const q = y.toBitmap()
      if (p.length !== q.length) return 1
      let n = 0
      for (let i = 0; i < p.length; i += 4) if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > 40) n++
      return n / (p.length / 4)
    },
    [a, b],
  )
/** the source as a document (DOMParser in the app window) */
const parsed = (fn, arg) => win.evaluate(([html, fn, arg]) => new Function('doc', 'arg', `return (${fn})(doc, arg)`)(new DOMParser().parseFromString(html, 'text/html'), arg), [source(), fn.toString(), arg])
// on the page: loose content (outside every named layer) and texts that carry their own box
const AUDIT = `(() => {
  const seen = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return !!c && c !== 'transparent'; const a = m[1].split(',')[3]; return a == null || parseFloat(a) > 0 }
  const painted = (cs) => seen(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')
  const root = document.querySelector('[data-composition-id]')
  const loose = []
  for (const el of root.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|AUDIO|SOURCE|BR)$/.test(el.tagName) || el.closest('[data-ms-id]') || el.hasAttribute('data-ms-wrap-for') || el.closest('svg')) continue
    let own = ''
    for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue
    own = own.trim()
    const r = el.getBoundingClientRect()
    if (own || /^(IMG|VIDEO|SVG|CANVAS)$/i.test(el.tagName) || (!el.textContent.trim() && r.width >= 6 && r.height >= 6 && painted(getComputedStyle(el)))) loose.push(own.slice(0, 20) || el.tagName)
  }
  const boxed = [...document.querySelectorAll('[data-ms-type="text"]')].filter((e) => !e.hasAttribute('data-ms-auto') && e.textContent.trim()).filter((e) => { const cs = getComputedStyle(e); return painted(cs) && !/text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '') }).map((e) => e.getAttribute('data-ms-id'))
  const style = (id) => { const e = document.querySelector('[data-ms-id="' + id + '"]'); if (!e) return null; const cs = getComputedStyle(e); return { bg: cs.backgroundColor, image: cs.backgroundImage, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius } }
  return { loose, boxed, chip: style('menu-chip'), chipBg: style('menu-chip-bg'), btn: style('order-btn'), bg: style('bg'), root: getComputedStyle(root).backgroundColor }
})()`

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: NAME }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  const pid = await pidOf()
  await win.locator('[data-layer="menu-chip"]').waitFor({ timeout: 60000 })
  for (let i = 0; i < 120 && (await state(pid)).status !== 'ready'; i++) {
    if ((await state(pid)).attention === 'trust') throw new Error('this sandbox folder is not trusted (a test never answers that question)')
    await win.waitForTimeout(1000)
  }
  const s0 = await state(pid)
  check('session ready at the app default (opus · high)', s0.status === 'ready' && s0.model === 'opus' && s0.effort === 'high', JSON.stringify(s0))
  await win.evaluate((id) => window.studio.agent.setPermission(id, 'all'), pid)
  await win.waitForTimeout(800)
  const before = await look('before', [0.5, 1.6, 2.0, 4.0], AUDIT)
  check('to start with: the chip carries its box, the box and text put in by hand have no names', before[2].data.boxed.includes('menu-chip') && before[2].data.loose.includes(UNNAMED_TEXT), JSON.stringify(before[2].data))

  // ---- 배경 따로 떼기 (and then the app's naming request for the loose content) ----
  await win.locator('[data-testid="layer-row"][data-row="menu-chip"] button.row').click()
  await win.getByTestId('split-box').waitFor({ timeout: 10000 })
  check('a text with its own box offers 배경 따로 떼기', await win.getByTestId('split-box').isVisible())
  const splitAt = Date.now()
  await win.getByTestId('split-box-run').click()
  check('split and naming turns finished', await waitTurns(pid, 'splitting, then naming', 25))
  const items = await chat(pid)
  const appAsks = items.filter((x) => x.role === 'user' && x.fromApp && Date.parse(x.at) >= splitAt).map((x) => x.text)
  log('the app asked:', JSON.stringify(appAsks))
  check('the split request went to Claude, by the layer name (not its id)', appAsks.some((x) => x.includes('「베스트 칩」의 글자와 배경을 따로')), JSON.stringify(appAsks))
  check('…then the app asked once to name what had no names', appAsks.filter((x) => x.includes('레이어 이름을 붙여')).length === 1, JSON.stringify(appAsks))
  const split = await parsed((doc) => {
    const g = (id) => doc.querySelector(`[data-ms-id="${id}"]`)
    const chip = g('menu-chip')
    const bg = g('menu-chip-bg')
    const group = g('menu-chip-group')
    return {
      chip: chip && { type: chip.getAttribute('data-ms-type'), text: chip.textContent.trim() },
      bg: bg && { type: bg.getAttribute('data-ms-type'), label: bg.getAttribute('data-ms-label') },
      group: group && { type: group.getAttribute('data-ms-type'), label: group.getAttribute('data-ms-label'), both: !!chip && !!bg && group.contains(chip) && group.contains(bg) },
    }
  })
  log('split:', JSON.stringify(split))
  check('the text keeps its id and words', split.chip?.type === 'text' && split.chip.text === 'BEST')
  check('its box is a layer of its own (menu-chip-bg, a shape, "베스트 칩 배경")', split.bg?.type === 'shape' && /베스트 칩/.test(split.bg.label ?? ''), JSON.stringify(split.bg))
  check('both in one group (menu-chip-group, "베스트 칩 묶음")', split.group?.type === 'group' && split.group.both && /베스트 칩/.test(split.group.label ?? ''), JSON.stringify(split.group))
  const named = await parsed((doc, words) => {
    const textEl = [...doc.querySelectorAll('div')].find((e) => e.textContent.trim() === words && !e.children.length)
    const layer = textEl?.closest('[data-ms-id]')
    // the box put in by hand: a painted div with no text right before the text (or wrapped with it)
    const boxEl = [...doc.querySelectorAll('div')].find((e) => /#FFE3CC/i.test(e.getAttribute('style') ?? '') && !e.textContent.trim())
    const boxLayer = boxEl?.closest('[data-ms-id]')
    const info = (e) => e && { id: e.getAttribute('data-ms-id'), label: e.getAttribute('data-ms-label'), type: e.getAttribute('data-ms-type') }
    return { text: info(layer), box: info(boxLayer), textStill: !!textEl }
  }, UNNAMED_TEXT)
  log('named:', JSON.stringify(named))
  check('the loose text got a name and a type', named.textStill && !!named.text?.id && !!named.text.label && ['text', 'group'].includes(named.text.type))
  check('the loose box got a name too', !!named.box?.id && !!named.box.label)
  const after1 = await look('after-split', [0.5, 1.6, 2.0, 4.0], AUDIT)
  check('nothing loose is left, no text carries its box', !after1[2].data.loose.length && !after1[2].data.boxed.length, JSON.stringify({ loose: after1[2].data.loose, boxed: after1[2].data.boxed }))
  check('the chip has no box of its own any more; the box layer has it', !!after1[2].data.chip && after1[2].data.chip.image === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(after1[2].data.chip.bg) && !!after1[2].data.chipBg, JSON.stringify([after1[2].data.chip, after1[2].data.chipBg]))
  for (let i = 0; i < before.length; i++) {
    const d = await changed(before[i].png, after1[i].png)
    check(`the video looks the same at ${before[i].t}s (${(d * 100).toFixed(2)}% of pixels changed)`, d < 0.005)
  }
  const notices1 = (await chat(pid)).filter((x) => x.role === 'notice' && Date.parse(x.at) >= splitAt).map((x) => x.text)
  check('no "still without a name" or "lost layers" notice', !notices1.some((x) => /아직 이름이 없어|사라졌어요/.test(x)), JSON.stringify(notices1))
  await win.keyboard.press('Escape')

  // ---- a new element the designer asks for ----
  const input = win.getByPlaceholder(/Claude에게 요청하기|표시한 부분을/)
  const askAt = Date.now()
  await input.fill("주문하기 버튼 바로 위에 '오늘만 20% 할인'이라고 적힌 작은 빨간 배지를 하나 추가해 줘. 다른 건 그대로 두고.")
  await input.press('Enter')
  check('the badge turns finished', await waitTurns(pid, 'adding a badge', 25))
  const badge = await parsed((doc) => {
    const t = [...doc.querySelectorAll('[data-composition-id] *')].find((e) => /20%/.test(e.textContent) && ![...e.children].some((c) => /20%/.test(c.textContent)))
    const layer = t?.closest('[data-ms-id]')
    return t ? { tag: t.tagName, layer: layer && { id: layer.getAttribute('data-ms-id'), label: layer.getAttribute('data-ms-label'), type: layer.getAttribute('data-ms-type') }, own: t.hasAttribute('data-ms-id') } : null
  })
  log('badge:', JSON.stringify(badge))
  check('the badge is there, in a named layer', !!badge?.layer?.id && !!badge.layer.label)
  const asked2 = (await chat(pid)).filter((x) => x.role === 'user' && x.fromApp && Date.parse(x.at) >= askAt).map((x) => x.text)
  log(asked2.length ? `the app had to ask: ${JSON.stringify(asked2)}` : 'Claude named it by itself (the app did not need to ask)')
  const after2 = await look('after-badge', [2.0, 4.0], AUDIT)
  check('after it: nothing loose, the badge text does not carry its box', !after2[0].data.loose.length && !after2[0].data.boxed.length, JSON.stringify({ loose: after2[0].data.loose, boxed: after2[0].data.boxed }))

  // ---- pins with files, said in their comments ----
  const f = await ready()
  await f.evaluate(() => window.__player.seek(2))
  const r = await win.getByTestId('timeline-bar').boundingBox()
  await win.mouse.click(r.x + (2 / 8) * r.width, r.y + r.height - 4)
  await win.waitForTimeout(800)
  /** where a layer's middle is on the screen */
  const middle = async (id) => {
    const c = await (await ready()).evaluate((id) => {
      const e = document.querySelector(`[data-ms-id="${id}"]`).getBoundingClientRect()
      const root = document.querySelector('[data-composition-id]').getBoundingClientRect()
      return { x: (e.x + e.width / 2 - root.x) / root.width, y: (e.y + e.height / 2 - root.y) / root.height }
    }, id)
    const box = await win.locator('[data-capture-frame]').boundingBox()
    return { x: box.x + c.x * box.width, y: box.y + c.y * box.height }
  }
  const pins = [
    { id: 'menu-photo', file: photo, note: '이 사진으로 바꿔 줘' },
    { id: 'order-btn', file: buttonLook, note: '이 버튼을 붙인 이미지 스타일처럼 바꿔 줘' },
  ]
  await win.getByTestId('canvas-mark-tools').getByTestId('tool-pin').click()
  for (const p of pins) {
    const m = await middle(p.id)
    await win.mouse.click(m.x, m.y)
    await win.waitForTimeout(400)
  }
  // the background: a corner away from the phone
  const box = await win.locator('[data-capture-frame]').boundingBox()
  await win.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.85)
  await win.waitForTimeout(400)
  await win.keyboard.press('Escape')
  for (let i = 0; i < 20 && (await win.locator('[data-mark-row]').count()) < 3; i++) await win.waitForTimeout(150)
  check('three pins', (await win.locator('[data-mark-row]').count()) === 3)
  // a pin names what is seen there at that moment, and what is under it (the tap ripple waits on the
  // button as a small dot until 2.3s: the button's words come with it)
  const pinned = await win.locator('[data-mark-row]').evaluateAll((rs) => rs.map((r) => r.querySelector('.ellipsis')?.getAttribute('title') ?? ''))
  check('the pins name what is seen there and what is under it', /메뉴 일러스트/.test(pinned[0]) && /주문하기 버튼|버튼 문구/.test(pinned[1]) && /배경/.test(pinned[2]), JSON.stringify(pinned))
  const attach = async (n, file, note) => {
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
    }, file)
    await win.getByTestId(`mark-attach-${n}`).click()
    const row = win.locator(`[data-mark-row="${n}"]`)
    for (let i = 0; i < 100 && (await row.locator('img, video').count()) === 0; i++) await win.waitForTimeout(200)
    await win.getByTestId(`mark-note-${n}`).fill(note)
  }
  await attach(1, pins[0].file, pins[0].note)
  await attach(2, pins[1].file, pins[1].note)
  await attach(3, refClip, '이 영상 색감을 참고해서 배경 색을 바꿔 줘')
  check('no purpose picker on the pins', (await win.locator('[data-testid^="mark-use-"]').count()) === 0)
  await win.screenshot({ path: join(shots, 'edit-live-pins.png') })
  const pinAt = Date.now()
  await input.fill('표시한 곳 고쳐 주세요')
  await input.press('Enter')
  check('the pin turns finished', await waitTurns(pid, 'pins with files', 30))
  const sent = (await chat(pid)).find((x) => x.role === 'user' && !x.fromApp && Date.parse(x.at) >= pinAt && x.marks?.length)
  const refs = sent?.marks?.flatMap((m) => m.refs ?? []) ?? []
  log('sent files:', JSON.stringify(refs), 'notes:', JSON.stringify(sent?.marks?.map((m) => m.note)))
  check('the message carried three pins, each with its file and comment', sent?.marks?.length === 3 && refs.length === 3 && sent.marks.every((m) => m.note))
  const reads = readsSince((await state(pid)).sessionId, pinAt)
  log('Claude read:', JSON.stringify(reads.map((x) => x.split('/').slice(-3).join('/'))))
  for (const ref of refs) {
    const want = /\.(mp4|mov|webm)$/i.test(ref) ? [ref, `${ref}.jpg`] : [ref]
    check(`Claude opened ${ref.split('/').pop()}`, reads.some((x) => want.some((w) => x.endsWith(w))))
  }
  // 1: the picture is the attached photo now (copied into the library)
  const photoNow = await parsed((doc) => {
    const l = doc.querySelector('[data-ms-id="menu-photo"]')
    if (!l) return null
    const img = l.tagName === 'IMG' ? l : l.querySelector('img')
    return { src: img?.getAttribute('src') ?? null, svg: !!l.querySelector('svg'), style: l.getAttribute('style') }
  })
  log('menu-photo:', JSON.stringify(photoNow))
  const photoFile = photoNow?.src && join(proj, 'composition', decodeURIComponent(photoNow.src.replace(/^\.\//, '')))
  check('1번: the menu picture is the attached photo (in the library)', !!photoFile && existsSync(photoFile) && md5(photoFile) === md5(photo) && photoNow.src.startsWith('assets/'), JSON.stringify(photoNow))
  const lib = await win.evaluate((id) => window.studio.projects.state(id), pid)
  check('…and the photo is in the material library', lib.brief.assets.some((a) => a.file && existsSync(join(proj, 'composition', a.file)) && md5(join(proj, 'composition', a.file)) === md5(photo)), JSON.stringify(lib.brief.assets.slice(-2)))
  // 2: the button restyled like the picture, its words kept (the designer's own text edit too)
  const after3 = await look('after-pins', [2.0, 4.0], AUDIT)
  const btn0 = before[2].data.btn
  const btn1 = after3[0].data.btn
  log('button before/after:', JSON.stringify(btn0), JSON.stringify(btn1))
  check('2번: the button took the gradient look', !!btn1 && /gradient/.test(btn1.image) && btn1.image !== btn0.image)
  const label = await parsed((doc) => doc.querySelector('[data-ms-id="order-btn-label"]')?.textContent.trim() ?? null)
  const ov = JSON.parse(readFileSync(join(proj, 'overrides.json'), 'utf8'))
  check('…its words stay (the layer and the designer\'s text edit)', label === '주문하기' && ov.elements['order-btn-label']?.text === '바로 주문', JSON.stringify({ label, edit: ov.elements['order-btn-label'] }))
  // 3: the background's colours changed after the clip
  const bgDiff = await changed(before[2].png, after3[0].png)
  log('background before/after:', JSON.stringify([before[2].data.bg, after3[0].data.bg]), `${(bgDiff * 100).toFixed(1)}% of pixels changed at 2s`)
  check('3번: the background colours changed', JSON.stringify(before[2].data.bg) !== JSON.stringify(after3[0].data.bg) || before[2].data.root !== after3[0].data.root || bgDiff > 0.3)
  check('everything still has a name after the pins', !after3[0].data.loose.length && !after3[0].data.boxed.length, JSON.stringify({ loose: after3[0].data.loose, boxed: after3[0].data.boxed }))
  const pj = JSON.parse(readFileSync(metaFile, 'utf8'))
  check('the video stays editable', pj.editable === true)
  await win.screenshot({ path: join(shots, 'edit-live-end.png') })
  const notices = (await chat(pid)).filter((x) => x.role === 'notice' && Date.parse(x.at) >= splitAt).map((x) => x.text)
  log('notices:', JSON.stringify(notices))
  const replies = (await chat(pid)).filter((x) => x.role === 'assistant' && Date.parse(x.at) >= splitAt).map((x) => x.text.replace(/\s+/g, ' ').slice(0, 300))
  for (const x of replies) log('Claude:', x)
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'edit-live-fail.png') }).catch(() => {})
} finally {
  await closeApp()
  restore()
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
