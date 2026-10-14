// 소재 > AI로 만들기 styles and kinds, checked with real images from GPT Image through the
// designer's Codex CLI (uses one image of the Codex quota per sample):
//  - every look with the same character ("인물·캐릭터"), so the looks can be compared
//  - every kind with one look
// The samples go through the app's own path (window.studio.ai.generate) into a sandbox
// project; a labelled contact sheet is written to tests/e2e/shots/style-samples.png.
// MS_SANDBOX=<sandbox with the "앱 주문 런칭" project> [ONLY=clay,3d] [KINDS=0] node tests/e2e/style-samples.mjs
import { _electron as electron } from 'playwright-core'
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

const LOOKS = ['flat', 'cartoon', 'clay', '3d', 'isometric', 'watercolor', 'paper', 'line', 'anime', 'pixel', 'photo', 'retro', 'sticker']
const CHARACTER = '커피잔을 들고 웃는 20대 바리스타 여성, 갈색 앞치마, 단발머리'
const KINDS = [
  ['object', '3d', '민트색 보온 텀블러'],
  ['element', '3d', '반짝이는 금색 코인'],
  ['background', 'flat', '아침 햇살이 드는 아늑한 카페 내부'],
  ['scene', 'cartoon', '카페 카운터에서 바리스타가 손님에게 커피를 건네는 장면'],
]
const only = process.env.ONLY?.split(',')
const jobs = [
  ...LOOKS.filter((l) => !only || only.includes(l)).map((style) => ({ label: style, req: { style, kind: 'character', framing: 'upper', ratio: '1:1', prompt: CHARACTER } })),
  ...(process.env.KINDS === '0' ? [] : KINDS.filter(([k]) => !only || only.includes(k)).map(([kind, style, prompt]) => ({ label: `${kind}·${style}`, req: { style, kind, framing: 'auto', ratio: kind === 'background' || kind === 'scene' ? '16:9' : '1:1', prompt } }))),
]

grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
const results = []
try {
  await toHome(win)
  const st = await win.evaluate(() => window.studio.ai.codexStatus(true))
  log('codex:', JSON.stringify(st))
  if (!st.usable) throw new Error(`Codex를 쓸 수 없어요: ${st.reason}`)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  await win.evaluate((path) => window.studio.projects.open(path), p.path)
  // three at a time (each takes about a minute)
  const queue = [...jobs]
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const req = { provider: 'codex', model: 'gpt-image', modelLabel: 'GPT 이미지 (Codex)', lang: 'ko', references: [], ...job.req }
      const t = Date.now()
      try {
        const c = await win.evaluate(([id, r]) => window.studio.ai.generate(id, r), [p.id, req])
        results.push({ ...job, file: join(p.path, c.file), secs: Math.round((Date.now() - t) / 1000) })
        log(`✓ ${job.label} (${Math.round((Date.now() - t) / 1000)}s)`)
      } catch (e) {
        failed++
        log(`✗ ${job.label}: ${e.message.slice(0, 200)}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
} catch (e) {
  failed++
  log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}

// contact sheet: 5 per row, 360px tiles with the label underneath
if (results.length) {
  const order = jobs.map((j) => results.find((r) => r.label === j.label)).filter(Boolean)
  const W = 360
  const H = 400
  const cols = 5
  const rows = Math.ceil(order.length / cols)
  const tiles = await Promise.all(
    order.map(async (r, i) => {
      const img = await sharp(r.file).resize(W, W - 20, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
      const label = Buffer.from(`<svg width="${W}" height="40"><rect width="100%" height="100%" fill="#111"/><text x="12" y="27" font-family="Helvetica" font-size="20" fill="#fff">${r.label}</text></svg>`)
      return [
        { input: img, left: (i % cols) * W, top: Math.floor(i / cols) * H },
        { input: label, left: (i % cols) * W, top: Math.floor(i / cols) * H + W - 20 },
      ]
    }),
  )
  await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#222' } })
    .composite(tiles.flat())
    .png()
    .toFile(join(shots, only ? `style-samples-${only.join('-')}.png` : 'style-samples.png'))
  log('contact sheet:', join(shots, only ? `style-samples-${only.join('-')}.png` : 'style-samples.png'))
  for (const r of order) log(`  ${r.label}: ${r.file}`)
}
log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
