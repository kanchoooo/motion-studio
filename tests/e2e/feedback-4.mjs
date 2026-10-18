// 사용 피드백 4차 (beta.10), in the app with a copy of the "앱 주문 런칭" project and two test layers:
//  - 글자 일부만 색: drag over part of a text in the text box → that part alone takes a colour
//  - a text with parts inside (a highlight bar in a box) keeps them, and its size, when a word changes
//  - 직접 수정이 되돌아가지 않음: a change saved meanwhile by someone else (Claude's tools write the
//    file) survives the designer's next edit, also after a press that changed nothing
//  - 대화창 소리 후보: the card plays the listening copy in the project; a broken one says so and the
//    button does not stay on "pause"
//  - 글꼴: the fonts the page links are also in the page itself (the render engine keeps their weights)
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/feedback-4.mjs
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-fb4-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const comp = join(proj, 'composition', 'index.html')
let html = readFileSync(comp, 'utf8')
const layers = `
      <div data-ms-id="fb-box" data-ms-type="text" data-ms-label="상자 문구" style="position:absolute;left:120px;top:600px;font-size:72px;font-weight:800;color:#fff"><span class="box" style="display:inline-block;position:relative;padding:0 28px"><i style="position:absolute;inset:0;background:#f2652d"></i><span style="position:relative">3주 출장,</span></span></div>
      <div data-ms-id="fb-copy" data-ms-type="text" data-ms-label="강조 문구" style="position:absolute;left:120px;top:760px;font-size:64px;color:#fff">3주 출장, 3주 휴가</div>`
const rootTag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
const endOfRoot = html.lastIndexOf('</div>', html.indexOf('<script>', rootTag.index))
html = html.slice(0, endOfRoot) + layers + '\n    ' + html.slice(endOfRoot)
writeFileSync(comp, html)
// a listening copy and a broken "mp3" for the sound card
const ffmpeg = join(root, 'resources', 'bin', `darwin-${process.arch}`, 'ffmpeg')
mkdirSync(join(proj, 'composition', 'assets', 'candidates'), { recursive: true })
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', join(proj, 'composition', 'assets', 'candidates', 'tone.mp3')])
writeFileSync(join(proj, 'composition', 'assets', 'candidates', 'broken.mp3'), '<html>not a sound</html>')
const ovFile = join(proj, 'overrides.json')
const overrides = () => JSON.parse(readFileSync(ovFile, 'utf8'))

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata'), MS_NO_UPDATE: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const settle = (ms = 600) => win.waitForTimeout(ms)
const until = async (f, ms = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await f()) return true
    await win.waitForTimeout(200)
  }
  return false
}
const preview = async () => {
  for (let i = 0; i < 120; i++) {
    const f = win.frames().find((x) => x.url().includes('ms-preview'))
    if (f && (await f.evaluate(() => !!window.__player && window.__player.getDuration() > 0).catch(() => false))) return f
    await win.waitForTimeout(500)
  }
}
const pick = async (id) => {
  await win.getByTestId('layer-search').fill('')
  const row = win.locator(`[data-testid="layer-row"][data-row="${id}"] button.row`)
  if (!(await row.count())) await win.getByTestId('layer-search').fill(id === 'fb-box' ? '상자 문구' : '강조 문구')
  await row.first().click()
  await settle()
}

try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.locator('[data-layer="fb-copy"], [data-testid="layer-row"][data-row="fb-copy"]').first().waitFor({ timeout: 40000 })
  let f = await preview()
  await settle(1200)
  const pid = (await win.evaluate(() => window.studio.projects.list())).find((p) => p.name === '앱 주문 런칭').id

  // ---- fonts in the page ----
  check('the fonts the page links are written into the page too', /<!-- ms:fonts[\s\S]*@font-face\s*\{\s*font-family:\s*"Pretendard"[\s\S]*<!-- \/ms:fonts -->/.test(readFileSync(comp, 'utf8')))

  // ---- part of a text in its own colour ----
  await pick('fb-copy')
  const box = win.getByTestId('layer-text')
  check('the text box says a dragged part can take its own colour', await win.getByText('글자 일부를 드래그해서 고르면').isVisible())
  // drag over the second "3주"
  await box.evaluate((t) => {
    const at = t.value.lastIndexOf('3주')
    t.focus()
    t.setSelectionRange(at, at)
  })
  await win.keyboard.press('Shift+ArrowRight')
  await win.keyboard.press('Shift+ArrowRight')
  await settle(300)
  const row = win.getByTestId('selection-style')
  check('…a row for the chosen part appears', await row.isVisible() && (await row.innerText()).includes('3주'))
  await row.locator('input.input').fill('#ff0000')
  await settle(1500)
  const hl = overrides().elements['fb-copy']?.highlights ?? []
  check('…saved as that place only (the second)', JSON.stringify(hl) === JSON.stringify([{ text: '3주', nth: 1, color: '#ff0000' }]), JSON.stringify(hl))
  f = await preview()
  await settle(800)
  const spans = await f.evaluate(() => [...document.querySelectorAll('[data-ms-id="fb-copy"] [data-ms-highlight]')].map((s) => [s.textContent, getComputedStyle(s).color]))
  const order = await f.evaluate(() => document.querySelector('[data-ms-id="fb-copy"]').innerHTML.indexOf('data-ms-highlight') > document.querySelector('[data-ms-id="fb-copy"]').innerHTML.indexOf('출장'))
  check('…and the preview colours only that part', JSON.stringify(spans) === JSON.stringify([['3주', 'rgb(255, 0, 0)']]) && order, JSON.stringify(spans))

  // ---- a word of a boxed text changes: the box stays ----
  // (the preview reloads after an edit: asked again until it answers)
  const sizeOf = async () => {
    for (let i = 0; i < 20; i++) {
      try {
        return await (await preview()).evaluate(() => { const el = document.querySelector('[data-ms-id="fb-box"]'); return { w: el.offsetWidth, h: el.offsetHeight, bar: !!el.querySelector('i'), text: el.innerText } })
      } catch {
        await settle(500)
      }
    }
  }
  await settle(1500)
  const before = await sizeOf()
  await pick('fb-box')
  await win.getByTestId('layer-text').fill('4주 출장,')
  await win.getByTestId('layer-text').blur()
  await until(async () => overrides().elements['fb-box']?.text === '4주 출장,', 5000)
  f = await preview()
  await settle(800)
  const after = await sizeOf()
  check('a word of a boxed text changes: the highlight bar and the size stay', after.text === '4주 출장,' && after.bar && Math.abs(after.w - before.w) <= 2 && after.h === before.h, JSON.stringify({ before, after }))

  // ---- a change saved meanwhile is not written away ----
  await win.keyboard.press('Escape')
  // a press on the canvas that moves nothing (a no-op drag)
  const cb = await win.locator('[data-capture-frame]').boundingBox()
  await win.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.62)
  await win.mouse.down()
  await win.mouse.up()
  await settle(900)
  // someone else (Claude's update_designer_edits writes the file the same way) changes another layer
  const theirs = overrides()
  theirs.elements['fb-copy'] = { ...(theirs.elements['fb-copy'] ?? {}), transform: { ...(theirs.elements['fb-copy']?.transform ?? {}), y: 33 } }
  await win.evaluate(([id, o]) => window.studio.projects.saveOverrides(id, o, '다른 쪽의 변경'), [pid, theirs])
  await settle(800)
  // the designer then edits the boxed text's colour
  await pick('fb-box')
  const colour = win.locator('[data-prop="color"] input.input, [data-key-row="color"] input.input').first()
  if (await colour.count()) await colour.fill('#00ff00')
  else await win.evaluate(() => {})
  await win.keyboard.press('Shift+ArrowRight')
  await settle(1500)
  const now = overrides()
  check("the other change survives the designer's next edit", now.elements['fb-copy']?.transform?.y === 33 && now.elements['fb-copy']?.highlights?.length === 1, JSON.stringify(now.elements['fb-copy']))
  check("…and the designer's own edits are there too", now.elements['fb-box']?.text === '4주 출장,' && !!now.elements['fb-box']?.transform, JSON.stringify(now.elements['fb-box']))

  // ---- the sound card plays from the project ----
  await win.evaluate(() => {
    window.__audios = []
    const A = window.Audio
    window.Audio = function (src) {
      const a = new A(src)
      window.__audios.push(a)
      return a
    }
  })
  await app.evaluate((_e, [id]) => globalThis.__msShowAudio(id, { id: 'c1', at: new Date().toISOString(), query: '테스트 음악', kind: 'bgm', items: [{ id: 'ok', source: 'mixkit', kind: 'bgm', title: '잘 되는 곡', file: 'assets/candidates/tone.mp3' }, { id: 'bad', source: 'web', kind: 'bgm', title: '깨진 곡', file: 'assets/candidates/broken.mp3' }] }), [pid])
  const card = win.getByTestId('audio-card').last()
  await card.waitFor({ timeout: 10000 })
  await card.getByTestId('audio-play').first().click()
  check('the sound card plays the listening copy', await until(() => win.evaluate(() => window.__audios.some((a) => !a.paused && a.currentTime > 0.2)), 6000))
  await card.getByTestId('audio-play').nth(1).click()
  check('a broken one says it could not play', await until(async () => (await win.locator('.toast').allInnerTexts()).some((t) => t.includes('미리듣기를 재생하지 못했어요')), 6000))
  check('…and its button does not stay on "pause"', await until(async () => (await card.getByTestId('audio-play').nth(1).locator('svg').getAttribute('class'))?.includes('play'), 4000), await card.getByTestId('audio-play').nth(1).innerHTML())
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.evaluate(({ dialog }) => (dialog.showMessageBoxSync = () => 1)).catch(() => {})
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} failed` : '\nfeedback 4: all passed')
process.exit(failed ? 1 : 0)
