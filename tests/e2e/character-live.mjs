// SVG character acting with a real Claude session (logged-in account, default Opus + high).
// A new project gets the ms-svg-character example man as a character asset, and Claude is
// asked for a short "surprised" acting clip. Checks: tags applied (≤ 0.1% at rest) with the eye rig and
// the neck under-hang, character_check passed, the
// character inline in index.html with svgrig, and the picture changing over time.
// Permission cards are answered "허용" and logged, so the run shows what Claude asked for.
// MS_SANDBOX=<sandbox whose projects folder is trusted> node tests/e2e/character-live.mjs
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { grantAccess, toHome } from './access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
const shots = join(root, 'tests', 'e2e', 'shots')
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1500, height: 950 }).catch(() => {})
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')

try {
  await toHome(win)
  // the sandbox's trusted project (a new project folder would need the designer to trust it)
  const proj = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭').path
  const st = await win.evaluate((path) => window.studio.projects.open(path), proj)
  const pid = st.meta.id
  // put everything back afterwards
  const head = (await win.evaluate((id) => window.studio.history.list(id), pid))[0]?.id
  // the example man, as if made with the flat character style and kept
  const cid = `man${Date.now() % 100000}`
  const gdir = join(proj, '.studio', 'generations', cid)
  mkdirSync(gdir, { recursive: true })
  await sharp(join(root, 'tests', 'fixtures', 'character', 'man', 'source.webp')).png().toFile(join(gdir, 'source.png'))
  const req = { provider: 'magnific', model: '', style: 'flat-character', framing: 'bust', ratio: '1:1', lang: 'en', prompt: '짧은 머리 남자, 네이비 재킷, 빨간 배경', references: [] }
  const listFile = join(proj, '.studio', 'generations', 'candidates.json')
  writeFileSync(listFile, JSON.stringify([{ id: cid, at: new Date().toISOString(), file: `.studio/generations/${cid}/source.png`, request: req, sent: req.prompt }]))
  await win.evaluate(([id, dir]) => window.studio.ai.reconvert(id, dir, 'bust', 14), [pid, `.studio/generations/${cid}`])
  const asset = await win.evaluate(([id, c]) => window.studio.ai.keepCandidate(id, c), [pid, cid])
  await win.evaluate(([id, b]) => window.studio.projects.saveBrief(id, b), [pid, { ...st.brief, storyboard: [], assets: [...st.brief.assets, { ...asset, required: true, note: '주인공 캐릭터' }] }])
  const folder = join(proj, 'composition', asset.file.replace('/source.png', ''))
  log('character asset:', asset.file, JSON.stringify(asset.character))

  await win.reload()
  await toHome(win)
  await win.locator('.card').filter({ hasText: '앱 주문 런칭' }).first().click()
  await win.locator('.drag .seg').getByRole('button', { name: '편집' }).click({ timeout: 30000 })
  await win.getByPlaceholder(/Claude에게 요청하기/).waitFor({ timeout: 30000 })
  await win.evaluate(([id]) => window.studio.agent.setModel(id, { model: '', effort: '' }), [pid])
  for (let i = 0; i < 90 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  check('session ready', /대기 중/.test(await badge()), await badge())

  const input = win.getByPlaceholder(/Claude에게 요청하기/)
  await input.fill('지금 영상은 버리고, 콘티 없이 바로 새로 만들어 주세요(8초, 앱 홍보 문구·스토리보드는 무시). 브리프의 남자 캐릭터 하나만 크게: 가만히 있다가 한 번 깜빡이고, 움츠렸다가 크게 놀라는 연기(눈썹·눈·입이 따로 움직이게)를 해 주세요. 배경은 캐릭터 배경색과 맞춰 주세요.')
  await input.press('Enter')
  const asked = []
  let quietSince = 0
  for (let i = 0; i < 2400; i++) {
    const card = win.getByTestId('permission-card').first()
    if (await card.count()) {
      const t = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 200)
      asked.push(t)
      log('permission asked:', t)
      await card.getByRole('button', { name: '허용', exact: true }).click().catch(() => {})
    }
    const approve = win.getByRole('button', { name: /콘티 승인|이대로 만들기|승인/ }).first()
    if (await approve.count().catch(() => 0)) await approve.click().catch(() => {})
    const b = await badge()
    if (/대기 중/.test(b)) {
      if (!quietSince) quietSince = Date.now()
      if (Date.now() - quietSince > 8000 && i > 20) break
    } else quietSince = 0
    if (i % 60 === 0) log('…', b)
    await win.waitForTimeout(1000)
  }
  const reply = await win.getByTestId('chat-list').evaluate((el) => el.innerText.slice(-900))
  log('last reply:\n' + reply)

  const html = existsSync(join(proj, 'composition', 'index.html')) ? readFileSync(join(proj, 'composition', 'index.html'), 'utf8') : ''
  const info = existsSync(join(folder, 'character.json')) ? JSON.parse(readFileSync(join(folder, 'character.json'), 'utf8')) : {}
  check('Claude tagged the character (tagged.svg, tags.json)', existsSync(join(folder, 'tagged.svg')) && existsSync(join(folder, 'tags.json')) && info.tagged === true)
  const tags = existsSync(join(folder, 'tags.json')) ? readFileSync(join(folder, 'tags.json'), 'utf8') : ''
  const tagged = existsSync(join(folder, 'tagged.svg')) ? readFileSync(join(folder, 'tagged.svg'), 'utf8') : ''
  check('eyes use the eye rig (full white, pupil clipped inside)', /"eye"\s*:/.test(tags) && /data-eye="/.test(tagged) && /data-added="흰자 전체/.test(tagged))
  check('the neck has its under-hang', /data-added="under-hang"/.test(tagged))
  const chk = existsSync(join(folder, 'check.json')) ? JSON.parse(readFileSync(join(folder, 'check.json'), 'utf8')) : null
  check(`character_check ran and passes (${chk ? JSON.stringify(chk.groups.map((g) => [g.id, g.cracks, g.ghosts])) : 'not run'})`, !!chk?.ok)
  if (existsSync(join(folder, 'check_sheet.png'))) await sharp(join(folder, 'check_sheet.png')).toFile(join(shots, 'p11-character-check.png'))
  check('the character is inline in the composition', html.includes('<!--ms-character:'))
  check('svgrig drives it', html.includes('ms/svgrig.js') && /SvgRig\.(add|attach)/.test(html))
  // it moves: two moments of the preview differ
  await win.locator('[data-layer]').first().waitFor({ timeout: 30000 }).catch(() => {})
  const ruler = win.getByTestId('timeline-bar')
  const frame = async (x) => {
    await ruler.click({ position: { x, y: 12 } })
    await win.waitForTimeout(800)
    return (await win.locator('[data-capture-frame]').screenshot()).toString('base64')
  }
  const box = await ruler.boundingBox()
  const a = await frame(box.width * 0.05)
  await win.screenshot({ path: join(shots, 'p7-character-start.png') })
  const b2 = await frame(box.width * 0.75)
  await win.screenshot({ path: join(shots, 'p7-character-late.png') })
  check('the character moves over time', a !== b2)
  log('permissions asked during the run:', asked.length ? asked.join(' | ') : '(none)')
  if (head) {
    await win.evaluate(([id, h]) => window.studio.history.restore(id, h), [pid, head])
    log('project restored to', head.slice(0, 8))
  }
} catch (e) {
  failed++
  log('✗', e.message)
  await win.screenshot({ path: join(shots, 'p7-character-fail.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
