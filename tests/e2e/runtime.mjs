// Runtime test in a real browser (the render engine's Chrome): motion capture,
// motion edits (length, easing, values, shift, off, stale), nested offsets.
// Run: node tests/e2e/runtime.mjs
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gsapJs = readFileSync(join(root, 'node_modules', 'gsap', 'dist', 'gsap.min.js'), 'utf8')
const runtimeJs = readFileSync(join(root, 'src', 'runtime', 'ms-runtime.js'), 'utf8')

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME
  const base = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')
  for (const v of existsSync(base) ? readdirSync(base) : []) {
    for (const d of readdirSync(join(base, v))) {
      const f = join(base, v, d, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
      if (existsSync(f)) return f
    }
  }
  return execFileSync(process.execPath, [join(root, 'node_modules', 'hyperframes', 'dist', 'cli.js'), 'browser', 'path'], { encoding: 'utf8' }).trim()
}

const COMP = `
<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="800" data-height="600" style="position:relative;width:800px;height:600px">
  <div data-ms-id="title" data-ms-type="text" data-ms-label="타이틀" style="position:absolute;left:100px;top:100px;font-size:40px">Hello</div>
  <div data-ms-id="phone" data-ms-type="group" data-ms-label="폰" style="position:absolute;left:400px;top:50px;width:200px;height:400px;display:flex;flex-direction:column">
    <div data-ms-id="phone-title" data-ms-type="text" data-ms-label="폰 제목" style="font-size:20px">앱 화면</div>
    <div data-ms-id="phone-cta" data-ms-type="text" data-ms-label="폰 버튼" style="position:relative;left:5px;font-size:16px">구매하기</div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true })
  tl.from('[data-ms-id="title"]', { y: 100, opacity: 0, duration: 1, ease: 'power2.out' }, 0.5)
  tl.to('[data-ms-id="title"]', { x: 200, duration: 1 }, 3)
  tl.fromTo('[data-ms-id="phone-title"]', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1)
  window.__timelines = window.__timelines || {}
  window.__timelines["main"] = tl
</script>`

async function page(browser, overrides) {
  const p = await browser.newPage()
  await p.setContent(`<!doctype html><html><head>
<script>${gsapJs}</script>
<script>window.__MS_OVERRIDES__ = ${JSON.stringify(overrides)};</script>
<script>${runtimeJs}</script></head><body style="margin:0">${COMP}</body></html>`)
  return p
}
const motions = (p) =>
  p.evaluate(
    () =>
      new Promise((res) => {
        window.addEventListener('message', function on(e) {
          if (e.data && e.data.ms === 'motions:reply') {
            window.removeEventListener('message', on)
            res(e.data)
          }
        })
        window.postMessage({ ms: 'motions', reqId: 1 }, '*')
      }),
  )
const at = (p, t, sel, prop) =>
  p.evaluate(
    ([t, sel, prop]) => {
      window.__timelines.main.seek(t)
      return Number(gsap.getProperty(document.querySelector(sel), prop))
    },
    [t, sel, prop],
  )

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
try {
  // 1. capture
  let p = await page(browser, { elements: {}, timeRemap: [], motions: {} })
  let m = await motions(p)
  const keys = m.items.map((x) => x.key).sort()
  check('motions captured with stable keys', JSON.stringify(keys) === JSON.stringify(['phone-title#1', 'title#1', 'title#2']), JSON.stringify(keys))
  const t1 = m.items.find((x) => x.key === 'title#1')
  check('from-tween: kind, start, length, ease, values', t1.type === 'from' && Math.abs(t1.start - 0.5) < 1e-6 && t1.duration === 1 && t1.ease === 'power2.out' && t1.props.find((q) => q.name === 'y').from === 100, JSON.stringify(t1))
  check('signature', t1.sig === 'from:opacity,y', t1.sig)
  check('authored motion plays', Math.abs((await at(p, 0.5, '[data-ms-id="title"]', 'y')) - 100) < 0.5 && Math.abs(await at(p, 2, '[data-ms-id="title"]', 'y')) < 0.5)
  await p.close()

  // 2. edits: longer, linear, different from-value, moved 1s later
  p = await page(browser, { elements: {}, timeRemap: [], motions: { 'title#1': { sig: 'from:opacity,y', duration: 2, ease: 'none', values: { 'from.y': 300 }, shift: 1 } } })
  m = await motions(p)
  const e1 = m.items.find((x) => x.key === 'title#1')
  check('edited motion reports new start and keeps authored start', Math.abs(e1.start - 1.5) < 1e-6 && Math.abs(e1.authoredStart - 0.5) < 1e-6 && e1.edited, JSON.stringify(e1))
  const y0 = await at(p, 1.5, '[data-ms-id="title"]', 'y')
  const yMid = await at(p, 2.5, '[data-ms-id="title"]', 'y')
  const yEnd = await at(p, 3.6, '[data-ms-id="title"]', 'y')
  check('edited values/length/easing applied', Math.abs(y0 - 300) < 0.5 && Math.abs(yMid - 150) < 0.5 && Math.abs(yEnd) < 0.5, `${y0} ${yMid} ${yEnd}`)
  await p.close()

  // 3. off: element rests in its natural state
  p = await page(browser, { elements: {}, timeRemap: [], motions: { 'title#1': { sig: 'from:opacity,y', disabled: true } } })
  check('disabled motion leaves the element at rest', Math.abs(await at(p, 0.5, '[data-ms-id="title"]', 'opacity') - 1) < 1e-6 && Math.abs(await at(p, 0.5, '[data-ms-id="title"]', 'y')) < 0.5)
  await p.close()

  // 4. stale: Claude rewrote the motion → edit not applied
  p = await page(browser, { elements: {}, timeRemap: [], motions: { 'title#1': { sig: 'from:y', duration: 5 } } })
  m = await motions(p)
  check('stale edit reported and ignored', m.stale.includes('title#1') && m.items.find((x) => x.key === 'title#1').duration === 1 && Math.abs(await at(p, 2, '[data-ms-id="title"]', 'y')) < 0.5)
  await p.close()

  // 5. nested flow elements move with relative offsets, layout untouched
  p = await page(browser, { elements: { 'phone-title': { transform: { x: 20, y: 10 } }, 'phone-cta': { transform: { x: 7 } } }, timeRemap: [], motions: {} })
  await p.evaluate(() => new Promise((r) => setTimeout(r, 50)))
  const r = await p.evaluate(() => {
    const a = document.querySelector('[data-ms-id="phone-title"]')
    const b = document.querySelector('[data-ms-id="phone-cta"]')
    const pr = document.querySelector('[data-ms-id="phone"]').getBoundingClientRect()
    return { ax: a.getBoundingClientRect().left - pr.left, ay: a.getBoundingClientRect().top - pr.top, bx: b.getBoundingClientRect().left - pr.left, unwrapped: a.getAttribute('data-ms-unwrappable') }
  })
  check('nested flow element offset by designer move', Math.abs(r.ax - 20) < 0.5 && Math.abs(r.ay - 10) < 0.5 && r.unwrapped === 'static', JSON.stringify(r))
  check('relative element keeps authored offset + move', Math.abs(r.bx - 12) < 0.5, JSON.stringify(r))
  const els = await p.evaluate(() => window.__MS_RUNTIME__.listElements().map((e) => [e.id, e.parent, e.depth, e.transformable]))
  check('element tree: parent and depth', JSON.stringify(els) === JSON.stringify([['title', null, 0, true], ['phone', null, 0, true], ['phone-title', 'phone', 1, false], ['phone-cta', 'phone', 1, false]]), JSON.stringify(els))
  await p.close()
} finally {
  await browser.close()
}
if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nruntime: all passed')
