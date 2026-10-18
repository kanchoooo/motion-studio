// Runtime test in a real browser (the render engine's Chrome): text edits and coloured parts.
//  - a text with parts inside (a highlight bar, a box around the words, a styled word) keeps them
//    when its words change; a new line break becomes <br>; a removed one replaces the text
//  - a plain text is replaced as before
//  - a dragged-over part (highlight with nth) colours only that place, also across parts; a word
//    highlight without nth still colours every place
// Run: node tests/e2e/runtime-text.mjs
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
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="900" data-height="900" style="position:relative;width:900px;height:900px;font-size:40px">
  <div data-ms-id="boxed" data-ms-type="text" style="position:absolute;left:20px;top:20px"><span class="box" style="display:inline-block;padding:0 24px;position:relative"><i style="position:absolute;inset:0;background:orange"></i><span style="position:relative">3주 출장,</span></span></div>
  <div data-ms-id="addr" data-ms-type="text" style="position:absolute;left:20px;top:120px">서울시 강남구 역삼동 <span class="chip" style="color:red">도보 5분</span></div>
  <div data-ms-id="two" data-ms-type="text" style="position:absolute;left:20px;top:220px"><b>이사 날짜가</b> <span>2주나 비는데</span></div>
  <div data-ms-id="lines" data-ms-type="text" style="position:absolute;left:20px;top:320px"><span>첫 줄</span><br><span>둘째 줄</span></div>
  <div data-ms-id="plain" data-ms-type="text" style="position:absolute;left:20px;top:440px">평범한 글자</div>
  <div data-ms-id="hl" data-ms-type="text" style="position:absolute;left:20px;top:540px">3주 출장, 3주 휴가</div>
  <div data-ms-id="hl2" data-ms-type="text" style="position:absolute;left:20px;top:640px">가<span>나</span>다 가나다</div>
  <div data-ms-id="hl3" data-ms-type="text" style="position:absolute;left:20px;top:740px">50% 할인 50% 적립</div>
</div>
<script>window.__timelines = { main: gsap.timeline({ paused: true }) }</script>`

async function page(browser, elements) {
  const p = await browser.newPage()
  await p.setContent(`<!doctype html><html><head><script>${gsapJs}</script><script>window.__MS_OVERRIDES__ = ${JSON.stringify({ elements })};</script><script>${runtimeJs}</script></head><body style="margin:0">${COMP}</body></html>`)
  return p
}
const info = (p, id) =>
  p.evaluate((id) => {
    const el = document.querySelector(`[data-ms-id="${id}"]`)
    return { text: el.innerText, html: el.innerHTML, w: el.offsetWidth, h: el.offsetHeight, hl: [...el.querySelectorAll('[data-ms-highlight]')].map((s) => s.textContent) }
  }, id)

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
try {
  const plain0 = await page(browser, {})
  const before = await info(plain0, 'boxed')
  await plain0.close()
  const p = await page(browser, {
    boxed: { text: '4주 출장,' },
    addr: { text: '서울시 강남구 삼성동 도보 7분' },
    two: { text: '이사 날짜가\n2주나 비는데' },
    lines: { text: '첫 줄 둘째 줄' },
    plain: { text: '바뀐 글자\n둘째 줄' },
    hl: { highlights: [{ text: '3주', nth: 1, color: '#ff0000' }] },
    hl2: { highlights: [{ text: '가나', nth: 0, color: '#ff0000' }] },
    hl3: { highlights: [{ text: '50%', color: '#ff0000' }] },
  })
  const boxed = await info(p, 'boxed')
  check('a box around the words keeps its parts (the bar, the padding) when a word changes', boxed.text === '4주 출장,' && boxed.html.includes('<i ') && boxed.html.includes('class="box"') && Math.abs(boxed.w - before.w) <= 2, JSON.stringify({ before, boxed }))
  const addr = await info(p, 'addr')
  check('a styled word keeps its style; a change inside it lands inside it', addr.text === '서울시 강남구 삼성동 도보 7분' && /<span class="chip"[^>]*>도보 7분<\/span>/.test(addr.html), addr.html)
  const two = await info(p, 'two')
  check('a new line break becomes <br>, the parts stay', two.text.replace(/\s+\n/g, '\n') === '이사 날짜가\n2주나 비는데' && two.html.includes('<b>') && two.html.includes('<br>'), JSON.stringify(two))
  const lines = await info(p, 'lines')
  check('a removed line break: the text is replaced as typed', lines.text === '첫 줄 둘째 줄', JSON.stringify(lines))
  const plain = await info(p, 'plain')
  check('a plain text is replaced as before (line breaks as <br>)', plain.text === '바뀐 글자\n둘째 줄' && plain.html === '바뀐 글자<br>둘째 줄', plain.html)
  const hl = await info(p, 'hl')
  check('a dragged-over part: only that place (the second 3주)', JSON.stringify(hl.hl) === '["3주"]' && hl.html.indexOf('data-ms-highlight') > hl.html.indexOf('출장'), hl.html)
  const hl2 = await info(p, 'hl2')
  check('…across styled parts (가 + <span>나</span>), not the later 가나', JSON.stringify(hl2.hl) === '["가","나"]' && hl2.text === '가나다 가나다', JSON.stringify(hl2))
  const hl3 = await info(p, 'hl3')
  check('a word highlight without a place colours every place, as before', JSON.stringify(hl3.hl) === '["50%","50%"]', JSON.stringify(hl3))
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} failed` : '\nruntime text: all passed')
process.exit(failed ? 1 : 0)
