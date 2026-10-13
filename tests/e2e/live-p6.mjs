// Live test for the 1st-feedback round (uses the logged-in Claude account):
// storyboard brief with a phone mockup → Claude builds it → the mockup's inner
// copy is editable → motion edits (easing, length, start) apply → model/effort
// switch restarts the session and the conversation continues → export.
// Run: npm run build && node tests/e2e/live-p6.mjs [--keep]
import { grantAccess, toHome } from './access.mjs'
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = join(root, 'tests', 'e2e', 'shots-p6')
mkdirSync(shots, { recursive: true })
const sandbox = process.env.MS_SANDBOX || mkdtempSync(join(tmpdir(), 'ms-p6-'))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a)
let failed = 0
const check = (name, ok, detail = '') => {
  log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  cwd: root,
  env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') },
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
const shot = async (name) => {
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log('shot', name)
}
const badge = () => win.evaluate(() => [...document.querySelectorAll('.badge')].map((b) => b.textContent).find((t) => t?.startsWith('Claude')) ?? '')
const waitIdle = async (label, minutes = 25) => {
  await win.waitForTimeout(4000)
  for (let i = 0; i < minutes * 60 && /작업 중|연결 중/.test(await badge()); i++) {
    if (i % 60 === 0) log(`${label}…`, await badge())
    await win.waitForTimeout(1000)
  }
  log(`${label} done:`, await badge())
}
// ask the preview runtime directly (same bridge the editor uses)
const runtime = (expr) =>
  win.evaluate(async (expr) => {
    const f = document.querySelector('[data-iframe-slot] iframe')
    if (!f) return null
    return new Promise((res) => {
      const id = Math.random()
      const on = (e) => {
        if (e.data?.reqId === id) {
          window.removeEventListener('message', on)
          res(e.data)
        }
      }
      window.addEventListener('message', on)
      f.contentWindow.postMessage({ ms: expr, reqId: id }, '*')
      setTimeout(() => res(null), 3000)
    })
  }, expr)

try {
  await toHome(win)
  await win.getByRole('button', { name: /새 프로젝트/ }).first().click()
  await win.getByPlaceholder('예: 봄 시즌 신제품 15초').fill('앱 주문 런칭')
  await win.getByRole('button', { name: '만들기', exact: true }).click()
  await win.getByText('출력 사양').first().waitFor({ timeout: 20000 })
  const dur = win.locator('.num').filter({ hasText: '초' }).first().locator('input')
  await dur.fill('8')
  await dur.press('Enter')
  await win.getByRole('button', { name: /톤앤매너/ }).click()
  await win.getByPlaceholder('예: 모션커피').fill('모션커피')
  await win.locator('textarea').first().fill('깔끔하고 모던한 앱 런칭 광고. 커피 브라운 #5B3A29, 크림 #FFF6EC, 포인트 오렌지 #FF7A2F.')

  // storyboard: a phone mockup whose inner copy must stay editable
  await win.getByRole('button', { name: /스토리보드/ }).click()
  await win.getByRole('button', { name: /씬 추가/ }).click()
  await win.getByPlaceholder('씬 제목 (예: 오프닝 · 제품 등장)').fill('앱 화면')
  const scene1 = win.locator('[data-scene="1"]')
  await scene1.getByRole('switch').first().click() // length on (3s)
  await scene1.locator('textarea').first().fill('화면 중앙에 스마트폰 목업이 아래에서 올라오며 등장. 폰 화면 안에 앱 제목 "모션커피 오더", 메뉴 카드(카페라떼 4,500원), 오렌지색 "주문하기" 버튼이 차례로 나타남.')
  await scene1.getByRole('button', { name: /문구 추가/ }).click()
  await scene1.getByPlaceholder('예: 봄을 담은 한 잔').fill('모션커피 오더')
  await win.getByRole('button', { name: /씬 추가/ }).click()
  const scene2 = win.locator('[data-scene="2"]')
  await scene2.getByPlaceholder('씬 제목 (예: 오프닝 · 제품 등장)').fill('엔드 카드')
  await scene2.locator('textarea').first().fill('폰이 옆으로 빠지고 큰 타이포로 마무리.')
  await scene2.getByRole('button', { name: /문구 추가/ }).click()
  await scene2.getByPlaceholder('예: 봄을 담은 한 잔').fill('지금 앱에서 주문하세요')
  await scene2.getByRole('switch').nth(1).click() // lock the end line
  await win.waitForTimeout(1500)
  await shot('01-storyboard')

  await win.getByRole('button', { name: '편집으로 가기' }).click()
  await win.getByText('Claude와 대화').waitFor()
  log('waiting for trust prompt')
  await win.getByText(/이 프로젝트 폴더를 처음 열었어요/).waitFor({ timeout: 60000 })
  const xterm = win.locator('.xterm-helper-textarea')
  await xterm.focus()
  await win.keyboard.press('ArrowDown')
  await win.waitForTimeout(400)
  await win.keyboard.press('Enter')
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  log('session:', await badge())

  await win.getByPlaceholder(/Claude에게 요청하기/).fill('스토리보드대로 바로 영상을 만들어 주세요. 콘티 승인은 생략해도 돼요.')
  await win.getByPlaceholder(/Claude에게 요청하기/).press('Enter')
  await waitIdle('building')
  await win.waitForTimeout(5000)
  await shot('02-built')
  const slotVisible = await win.evaluate(() => getComputedStyle(document.querySelector('[data-iframe-slot]')).visibility !== 'hidden')
  check('preview is shown after the first build', slotVisible)

  const projDir = (await win.evaluate(() => window.studio.projects.list())).at(0)?.path
  const html = readFileSync(join(projDir, 'composition', 'index.html'), 'utf8')
  check('storyboard copy present', html.includes('모션커피 오더') && html.includes('지금 앱에서 주문하세요'))

  // ---- 8. inner elements of the mockup are editable ----
  const els = (await runtime('elements'))?.items ?? []
  const nested = els.filter((e) => e.depth >= 1 && e.type === 'text')
  log('elements:', els.map((e) => `${'  '.repeat(e.depth)}${e.label}(${e.type})`).join(' | '))
  check('mockup has editable inner texts', nested.length >= 2, `${nested.length} nested texts`)
  const target = nested.find((e) => /주문/.test(e.text ?? '') || /버튼/.test(e.label)) ?? nested[0]
  // pick it in the timeline layer list and edit it in the inspector
  await win.locator(`[data-layer="${target.id}"]`).click()
  await win.getByTestId('inspector').locator('textarea').first().fill('바로 주문')
  await win.getByTestId('inspector').locator('textarea').first().press('Meta+Enter')
  const size = win.getByTestId('inspector').locator('.num').filter({ hasText: 'T' }).locator('input')
  await size.fill(String(Math.round((target.style?.fontSize ?? 30) + 6)))
  await size.press('Enter')
  await win.waitForTimeout(3000)
  const after = ((await runtime('elements'))?.items ?? []).find((e) => e.id === target.id)
  check('inner text edited in the preview', after?.text?.includes('바로 주문') && Math.abs(after.style.fontSize - (target.style.fontSize + 6)) < 0.6, JSON.stringify(after?.style))
  await shot('03-inner-edit')

  // ---- 9. motion editing ----
  const motions = (await runtime('motions'))?.items ?? []
  log('motions:', motions.length)
  check('motions are listed', motions.length >= 3)
  const m = motions.find((x) => x.owners[0] === target.id) ?? motions[0]
  await win.locator(`[data-layer="${m.owners[0]}"]`).click()
  await win.getByTestId('inspector').getByRole('button', { name: '모션', exact: true }).click()
  await win.getByTestId('inspector').locator('button').filter({ hasText: /등장|변화/ }).first().click()
  await win.getByTestId('inspector').getByRole('button', { name: /탄성|통통 튀기/ }).first().click()
  const len = win.getByTestId('inspector').locator('.num').filter({ hasText: '길이' }).locator('input')
  await len.fill('1.6')
  await len.press('Enter')
  await win.waitForTimeout(3500)
  const m2 = ((await runtime('motions'))?.items ?? []).find((x) => x.owners[0] === m.owners[0] && x.edited)
  const ov = JSON.parse(readFileSync(join(projDir, 'overrides.json'), 'utf8'))
  const saved = Object.values(ov.motions ?? {})[0]
  check('motion edit saved and applied', !!m2 && saved?.duration === 1.6 && /elastic|bounce/.test(saved?.ease ?? ''), JSON.stringify(saved))
  check('applied motion spans the new length', m2 && Math.abs(m2.end - m2.start - 1.6) < 0.25, m2 && `${m2.start}~${m2.end}`)
  // open the layer's motions and drag the block 0.5s later
  // unfold the layer's motions (picking a motion in the inspector may have unfolded it already)
  if (!(await win.locator('.tl-motion').count())) await win.locator(`[data-layer="${m.owners[0]}"] button`).first().click()
  const block = win.locator('.tl-motion').first()
  const bb = await block.boundingBox()
  const rulerW = (await win.locator('.tl-ruler').boundingBox()).width
  const dx = (0.5 / 8) * rulerW
  await win.mouse.move(bb.x + 10, bb.y + bb.height / 2)
  await win.mouse.down()
  await win.mouse.move(bb.x + 10 + dx, bb.y + bb.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(3500)
  const ov2 = JSON.parse(readFileSync(join(projDir, 'overrides.json'), 'utf8'))
  const shifted = Object.values(ov2.motions ?? {}).find((x) => x.shift)
  check('dragging a motion block shifts it', !!shifted && Math.abs(shifted.shift - 0.5) < 0.15, JSON.stringify(shifted))
  await shot('04-motion-edit')

  // ---- 6. model / effort ----
  const pickers = win.getByTestId('model-picker').locator('select')
  await pickers.nth(0).selectOption('sonnet')
  await win.waitForTimeout(1500)
  await pickers.nth(1).selectOption('low')
  for (let i = 0; i < 60 && !/대기 중/.test(await badge()); i++) await win.waitForTimeout(1000)
  const ps = execFileSync('ps', ['-axo', 'command']).toString().split('\n').filter((l) => l.includes('--remote-control') && l.includes('앱 주문 런칭'))
  check('session restarted with --model sonnet --effort low', ps.some((l) => /--model sonnet/.test(l) && /--effort low/.test(l)), ps.join('\n').slice(0, 300))
  check('only one Claude process for the project', ps.length === 1, String(ps.length))
  const chatBefore = await win.evaluate(() => document.querySelectorAll('.fade-in').length)
  await win.getByPlaceholder(/Claude에게 요청하기/).fill('지금 쓰고 있는 모델 이름만 한 줄로 알려 주세요. 영상은 바꾸지 마세요.')
  await win.getByPlaceholder(/Claude에게 요청하기/).press('Enter')
  await waitIdle('model question', 5)
  const lastReply = await win.evaluate(() => [...document.querySelectorAll('.fade-in')].map((e) => e.textContent).slice(-1)[0] ?? '')
  log('reply:', lastReply.slice(0, 120))
  check('conversation continues after the switch', (await win.evaluate(() => document.querySelectorAll('.fade-in').length)) > chatBefore && /sonnet|소넷/i.test(lastReply), lastReply.slice(0, 120))
  await shot('05-model')

  // ---- export with the edits (draft quality keeps the run short) ----
  const pid = (await win.evaluate(() => window.studio.projects.list())).at(0).id
  await win.evaluate((pid) => window.studio.renders.start(pid, { format: 'mp4-h264', quality: 'draft', fileName: 'p6-check' }), pid)
  let rec = null
  for (let i = 0; i < 600 && !rec; i++) {
    await win.waitForTimeout(1000)
    rec = (await win.evaluate((pid) => window.studio.renders.list(pid), pid)).find((r) => r.fileName.startsWith('p6-check'))
  }
  check('export finished', !!rec && rec.bytes > 10000, JSON.stringify(rec))
  await shot('06-export')
} catch (e) {
  console.error('LIVE FAILED:', e.message)
  failed++
  await shot('zz-failure').catch(() => {})
} finally {
  await app.close().catch(() => {})
  log('sandbox:', sandbox)
}
if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
log('live p6: all passed')
