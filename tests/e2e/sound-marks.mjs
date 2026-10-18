// Sounds Claude placed without the app's marks (music changed in the conversation, an imported
// effect, a workflow's id="el-bgm") still show in the Sound tab and the timeline:
//  - the app gives them data-ms-id / data-ms-type / data-ms-label (attributes only)
//  - 사운드 tab: the music under 배경음악 (Claude), the effect among the effects
//  - the timeline's 소리만 view shows their lanes
//  - a sound can be taken out (Sound tab button, or Delete on it in the timeline), brought back,
//    and undone; a section of it can be cut (구간 지우기) and its length shortened
// The sandbox is copied; the copy is removed afterwards.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> node tests/e2e/sound-marks.mjs
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOnExit, grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = cleanupOnExit(mkdtempSync(join(tmpdir(), 'ms-snd-')))
cpSync(join(process.env.MS_SANDBOX, 'projects'), join(sandbox, 'projects'), { recursive: true })
cpSync(join(process.env.MS_SANDBOX, 'userdata'), join(sandbox, 'userdata'), { recursive: true })
const proj = join(sandbox, 'projects', '앱 주문 런칭.msproj')
const comp = join(proj, 'composition', 'index.html')
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

// music and an effect as Claude may write them: plain ids, single quotes, no data-ms-*
writeFileSync(
  comp,
  readFileSync(comp, 'utf8').replace(
    '<!-- 효과음 -->',
    `<audio id="el-bgm" src="assets/test-bgm_2.mp3" data-start="0" data-duration="8" data-volume="0.5"></audio>
      <audio id='whoosh-extra' src='assets/sfx/swipe.wav' data-start='3.1' data-duration='0.6'></audio>

      <!-- 효과음 -->`,
  ),
)

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
try {
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click()
  await win.locator('[data-layer]').first().waitFor({ timeout: 30000 })
  await win.waitForTimeout(1500)
  const html = readFileSync(comp, 'utf8')
  const bgmTag = html.match(/<audio[^>]*id="el-bgm"[^>]*>/)?.[0] ?? ''
  const fxTag = html.match(/<audio[^>]*id="whoosh-extra"[^>]*>/)?.[0] ?? ''
  check('the music got the marks (id, bgm, label), the rest as written', /data-ms-id="el-bgm"/.test(bgmTag) && /data-ms-type="bgm"/.test(bgmTag) && /data-ms-label="배경음악"/.test(bgmTag) && /data-volume="0.5"/.test(bgmTag), bgmTag)
  check('the effect too (sfx, named after its file; its single-quoted attributes now double-quoted)', /data-ms-id="whoosh-extra"/.test(fxTag) && /data-ms-type="sfx"/.test(fxTag) && /data-ms-label="swipe"/.test(fxTag) && /src="assets\/sfx\/swipe.wav"/.test(fxTag), fxTag)
  await win.getByRole('button', { name: '사운드', exact: true }).click()
  await win.waitForTimeout(800)
  const panel = await win.getByTestId('sound-panel').innerText()
  check('사운드 tab: the music is listed (Claude)', /배경음악[\s\S]*Claude/.test(panel) && panel.includes('test-bgm_2'), panel.slice(0, 400))
  check('…and the effect among the effects', panel.includes('swipe'), panel.slice(0, 600))
  await win.getByTestId('timeline-filter').click()
  await win.getByTestId('timeline-only-sound').click()
  await win.waitForTimeout(400)
  const lanes = await win.locator('[data-testid="timeline"]').innerText()
  check('the timeline 소리만 view lists the music', lanes.includes('배경음악'), lanes.slice(0, 300))

  // ---- taking sounds out ----
  const ovFile = join(proj, 'overrides.json')
  const ov = () => JSON.parse(readFileSync(ovFile, 'utf8'))
  const until = async (f, ms = 6000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
      if (await f()) return true
      await win.waitForTimeout(150)
    }
    return false
  }
  const panelEl = win.getByTestId('sound-panel')
  await panelEl.getByRole('button', { name: /swipe/ }).first().click()
  await win.getByTestId('sound-remove').click()
  check('an effect is taken out from the Sound tab', await until(() => ov().audio?.['whoosh-extra']?.removed === true), JSON.stringify(ov().audio))
  const fx = () => readFileSync(comp, 'utf8').match(/<audio[^>]*id="whoosh-extra"[^>]*>/)?.[0] ?? ''
  check('…it plays silent in the video, its file kept', await until(() => /data-volume="0"/.test(fx()) && /src="assets\/sfx\/swipe.wav"/.test(fx()), 8000), fx())
  await win.waitForTimeout(1500)
  check('…and is listed under 지운 소리, not among the effects', (await win.getByTestId('removed-sounds').innerText()).includes('swipe') && (await win.locator('[data-testid="timeline"] [data-audio="whoosh-extra"]').count()) === 0)
  await win.getByTestId('removed-sounds').getByTestId('sound-restore').first().click()
  check('되살리기 brings it back', await until(() => !ov().audio?.['whoosh-extra']?.removed))
  await win.waitForTimeout(1500)
  // Delete on a sound picked in the timeline (the playhead away from it: its line lies on top)
  await win.locator('[data-testid="timeline"]').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await win.keyboard.press('End')
  await win.waitForTimeout(400)
  await win.locator('[data-testid="timeline"] [data-audio="whoosh-extra"]').first().click()
  await win.waitForTimeout(300)
  await win.keyboard.press('Delete')
  check('Delete on a sound picked in the timeline takes it out', await until(() => ov().audio?.['whoosh-extra']?.removed === true))
  await win.waitForTimeout(800)
  await win.keyboard.press('Meta+z')
  check('…and ⌘Z puts it back', await until(() => !ov().audio?.['whoosh-extra']?.removed))
  await win.waitForTimeout(1500)

  // ---- 구간 지우기 and length on the music ----
  await win.getByRole('button', { name: '사운드', exact: true }).click()
  await win.waitForTimeout(500)
  await panelEl.getByRole('button', { name: /test-bgm_2/ }).first().click()
  const cut = win.getByTestId('section-cut')
  const typeIn = async (loc, v) => {
    await loc.click()
    await loc.fill(String(v))
    await loc.press('Enter')
  }
  await typeIn(cut.locator('.num input').nth(0), 2)
  await typeIn(cut.locator('.num input').nth(1), 4)
  await cut.getByTestId('section-cut-run').click()
  const keysOk = await until(() => {
    const k = ov().audio?.['el-bgm']?.volumeKeys ?? []
    return k.some((x) => x.t === 2 && x.v === 0) && k.some((x) => x.t === 4 && x.v === 0) && k.some((x) => x.t > 4 && x.v > 0)
  })
  check('구간 지우기: 2–4 s goes silent (keys), the music before and after stays', keysOk, JSON.stringify(ov().audio?.['el-bgm']))
  const curveOk = await until(() => {
    const tag = readFileSync(comp, 'utf8').match(/<audio[^>]*id="el-bgm"[^>]*>/)?.[0] ?? ''
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1] ?? ''
    return src.includes('.ms-audio') && existsSync(join(proj, 'composition', src))
  }, 15000)
  check('…the app writes the music with that curve (preview and export sound the same)', curveOk, readFileSync(comp, 'utf8').match(/<audio[^>]*id="el-bgm"[^>]*>/)?.[0])
  const lenField = win.locator('.num').filter({ hasText: '길이' }).locator('input').first()
  await typeIn(lenField, 3)
  check('길이: the music can be cut shorter', await until(() => ov().audio?.['el-bgm']?.duration === 3), JSON.stringify(ov().audio?.['el-bgm']))
  await win.screenshot({ path: join(root, 'tests', 'e2e', 'shots', 'sound-cut.png') }).catch(() => {})
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} failed` : '\nsound marks: all passed')
process.exit(failed ? 1 : 0)
