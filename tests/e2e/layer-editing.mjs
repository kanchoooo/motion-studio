// Moving a whole layer in time (timeline bar drag → elements[id].timing.shift), in a real browser:
//  - a tween shared with another layer is split: only the moved layer's part moves
//  - layers moved together move a shared tween once (not twice)
//  - a stagger keeps each target's own slot
//  - an initial state set at 0 (autoAlpha:0 before an entrance) stays at 0
//  - moving earlier than 0 stops the whole layer at 0 and keeps its spacing
//  - tweens inside a scene timeline move in the scene's time; clips (data-start) move too
//  - the editor's bars and motion blocks report the moved times
// And plain coloured boxes inside a group (the pill behind a label) become layers of their own;
// a click picks the layer the designer sees at that moment (not one faded out on top of it).
// Run: node tests/e2e/layer-editing.mjs
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

const PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
const COMP = `
<div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="800" data-height="600" style="position:relative;width:800px;height:600px">
  <div data-ms-id="a" data-ms-type="shape" class="st" style="position:absolute;left:10px;top:10px;width:50px;height:50px;background:red">A</div>
  <div data-ms-id="b" data-ms-type="shape" class="st" style="position:absolute;left:110px;top:10px;width:50px;height:50px;background:blue">B</div>
  <div data-ms-id="c" data-ms-type="shape" class="st" style="position:absolute;left:210px;top:10px;width:50px;height:50px;background:green">C</div>
  <div data-ms-id="solo" data-ms-type="text" style="position:absolute;left:10px;top:200px">혼자</div>
  <div data-ms-id="scene" data-ms-type="group" style="position:absolute;left:10px;top:300px"><div data-ms-id="kid" data-ms-type="text">아이</div></div>
  <img data-ms-id="clip" data-ms-type="image" src="${PX}" data-start="2" data-duration="2" style="position:absolute;left:400px;top:400px;width:20px;height:20px">
  <div data-ms-id="row" data-ms-type="group" style="position:absolute;left:300px;top:500px;display:flex;gap:10px"><span data-ms-id="flowtext" data-ms-type="text">흐름 글자</span></div>
  <div data-ms-id="d" data-ms-type="shape" style="position:absolute;left:500px;top:10px;width:20px;height:20px;background:#000"></div>
  <div data-ms-id="e" data-ms-type="shape" style="position:absolute;left:540px;top:10px;width:20px;height:20px;background:#000"></div>
  <div data-ms-id="f" data-ms-type="shape" class="rp" style="position:absolute;left:580px;top:10px;width:20px;height:20px;background:#000"></div>
  <div data-ms-id="g" data-ms-type="shape" class="rp" style="position:absolute;left:620px;top:10px;width:20px;height:20px;background:#000"></div>
</div>
<script>
  const tl = gsap.timeline({ paused: true })
  tl.set('[data-ms-id="solo"]', { autoAlpha: 0 }, 0)
  tl.to('[data-ms-id="solo"]', { autoAlpha: 1, duration: 0.5 }, 2)
  tl.from(['[data-ms-id="a"]', '[data-ms-id="b"]'], { x: -100, duration: 1, ease: 'none' }, 1)
  tl.from('.st', { y: 50, duration: 0.5, ease: 'none', stagger: 0.5 }, 3)
  const scene = gsap.timeline()
  scene.to('[data-ms-id="kid"]', { x: 100, duration: 1, ease: 'none' }, 0.5)
  scene.to('[data-ms-id="kid"]', { y: 50, duration: 0.5, ease: 'none' }, 1.5)
  tl.to(['[data-ms-id="d"]', '[data-ms-id="e"]'], { x: 100, duration: 1, delay: 0.5, ease: 'none' }, 1)
  tl.to('.rp', { y: 10, duration: 0.5, stagger: 0.5, repeat: 2, ease: 'none' }, 5)
  tl.add(scene, 4)
  window.__timelines = window.__timelines || {}
  window.__timelines["main"] = tl
</script>`

async function page(browser, elements, comp = COMP) {
  const p = await browser.newPage()
  await p.setContent(`<!doctype html><html><head>
<script>${gsapJs}</script>
<script>window.__MS_OVERRIDES__ = ${JSON.stringify({ elements, timeRemap: [], motions: {} })};</script>
<script>${runtimeJs}</script></head><body style="margin:0">${comp}</body></html>`)
  return p
}
const BOXES = `
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="800" data-height="600" style="position:relative;width:800px;height:600px">
  <div data-ms-id="badge" data-ms-type="group" data-ms-label="배지" style="position:absolute;left:10px;top:10px;padding:8px 16px">
    <div style="position:absolute;inset:0;background:#ff3355;border-radius:20px"></div>
    <span style="position:relative;font-size:24px">NEW</span>
    <div style="width:2px;height:2px;background:#000"></div>
    <div style="width:40px;height:10px"></div>
    <div style="background:#2255ff;padding:4px">SALE</div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true })
  tl.from('[data-ms-id="badge"]', { scale: 0, duration: 0.5 }, 0)
  window.__timelines = window.__timelines || {}
  window.__timelines["main"] = tl
</script>`
const ask = (p, ms) =>
  p.evaluate(
    (ms) =>
      new Promise((res) => {
        window.addEventListener('message', function on(e) {
          if (e.data && e.data.ms === `${ms}:reply`) {
            window.removeEventListener('message', on)
            res(e.data)
          }
        })
        window.postMessage({ ms, reqId: 1 }, '*')
      }),
    ms,
  )
/** a property of one layer at a time of the main timeline */
const at = (p, t, id, prop) =>
  p.evaluate(
    ([t, id, prop]) => {
      window.__timelines.main.seek(t)
      return Number(gsap.getProperty(document.querySelector(`[data-ms-id="${id}"]`), prop))
    },
    [t, id, prop],
  )
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol
/** the layers the editor's click finds at a point, at a time */
const hit = (p, t, x, y) =>
  p.evaluate(
    ([t, x, y]) =>
      new Promise((res) => {
        window.__timelines.main.seek(t)
        window.addEventListener('message', function on(e) {
          if (e.data && e.data.ms === 'hit:reply') {
            window.removeEventListener('message', on)
            res(e.data.ids)
          }
        })
        window.postMessage({ ms: 'hit', reqId: 1, x, y }, '*')
      }),
    [t, x, y],
  )
const SCENES = `
<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="800" data-height="600" style="position:relative;width:800px;height:600px">
  <div data-ms-id="bg" data-ms-type="shape" style="position:absolute;inset:0;background:#111"></div>
  <div data-ms-id="scene1" data-ms-type="group" style="position:absolute;inset:0">
    <div data-ms-id="title1" data-ms-type="text" style="position:absolute;left:100px;top:100px;width:200px;height:50px;background:#fff">첫 장면</div>
  </div>
  <div data-ms-id="scene2" data-ms-type="group" style="position:absolute;inset:0;pointer-events:none">
    <div data-ms-id="title2" data-ms-type="text" style="position:absolute;left:100px;top:100px;width:200px;height:50px;background:#f00">둘째 장면</div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true })
  tl.set('[data-ms-id="scene2"]', { autoAlpha: 0 }, 0)
  tl.to('[data-ms-id="scene1"]', { autoAlpha: 0, duration: 0.1 }, 3)
  tl.to('[data-ms-id="scene2"]', { autoAlpha: 1, duration: 0.1 }, 3)
  window.__timelines = window.__timelines || {}
  window.__timelines["main"] = tl
</script>`

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed++
}
const shift = (s) => ({ timing: { shift: s } })

const browser = await chromium.launch({ executablePath: chromePath(), headless: true })
try {
  // 0. as authored
  let p = await page(browser, {})
  let tm = (await ask(p, 'timing')).items
  const bar = (id) => tm.find((x) => x.id === id)
  check('bars start where the layer shows up (an initial set at 0 does not count)', near(bar('solo').start, 2, 1e-3), JSON.stringify(bar('solo')))
  check("a staggered target's bar is its own slot", near(bar('c').start, 4, 1e-3) && near(bar('c').end, 4.5, 1e-3), JSON.stringify(bar('c')))
  check('a repeating stagger: each bar ends with its last repeat', near(bar('f').end, 7.5, 1e-3) && near(bar('g').end, 8, 1e-3), JSON.stringify([bar('f'), bar('g')]))
  check('as authored: shared tween and stagger', near(await at(p, 1, 'a', 'x'), -100) && near(await at(p, 2, 'b', 'x'), 0) && near(await at(p, 3.25, 'a', 'y'), 25))
  await p.close()

  // 1. a alone moves 1 s later: the tween it shares with b is split
  p = await page(browser, { a: shift(1) })
  check('moved layer: its part of a shared tween moves', near(await at(p, 2, 'a', 'x'), -100) && near(await at(p, 2.5, 'a', 'x'), -50) && near(await at(p, 3, 'a', 'x'), 0), `${await at(p, 2, 'a', 'x')} ${await at(p, 2.5, 'a', 'x')}`)
  check('the other layer of that tween stays', near(await at(p, 1, 'b', 'x'), -100) && near(await at(p, 1.5, 'b', 'x'), -50) && near(await at(p, 2, 'b', 'x'), 0), `${await at(p, 1.5, 'b', 'x')}`)
  check('stagger: the moved target slot moves, the others keep theirs', near(await at(p, 4.25, 'a', 'y'), 25) && near(await at(p, 3.75, 'b', 'y'), 25) && near(await at(p, 4.25, 'c', 'y'), 25), `${await at(p, 4.25, 'a', 'y')} ${await at(p, 3.75, 'b', 'y')} ${await at(p, 4.25, 'c', 'y')}`)
  tm = (await ask(p, 'timing')).items
  check('the bar shows the moved times', near(bar('a').start, 2, 1e-3) && near(bar('b').start, 1, 1e-3), JSON.stringify([bar('a'), bar('b')]))
  let mo = (await ask(p, 'motions')).items
  const shared = mo.find((m) => m.owners[0] === 'a' && m.type === 'from' && m.sig.includes('x'))
  check('motion blocks: moved start, authored start, layer shift', shared && near(shared.start, 2, 1e-3) && near(shared.authoredStart, 1, 1e-3) && shared.layerShift === 1, JSON.stringify(shared))
  await p.close()

  // 1b. a shared tween with a delay: the delay counts once
  p = await page(browser, { d: shift(1) })
  check('a split tween keeps its delay once', near(await at(p, 2.5, 'd', 'x'), 0) && near(await at(p, 3, 'd', 'x'), 50) && near(await at(p, 2, 'e', 'x'), 50), `${await at(p, 3, 'd', 'x')} ${await at(p, 2, 'e', 'x')}`)
  await p.close()

  // 2. a and b moved together: their shared tween moves once
  p = await page(browser, { a: shift(1), b: shift(1) })
  check('layers moved together: a shared tween moves once (not twice)', near(await at(p, 2, 'a', 'x'), -100) && near(await at(p, 3, 'a', 'x'), 0) && near(await at(p, 2.5, 'b', 'x'), -50), `${await at(p, 3, 'a', 'x')}`)
  await p.close()

  // 3. the initial state stays at 0
  p = await page(browser, { solo: shift(1) })
  check('initial set stays at 0: hidden until its entrance', near(await at(p, 0.5, 'solo', 'opacity'), 0, 1e-3) && near(await at(p, 2.9, 'solo', 'opacity'), 0, 1e-3) && near(await at(p, 3.5, 'solo', 'opacity'), 1, 1e-3), `${await at(p, 0.5, 'solo', 'opacity')} ${await at(p, 3.5, 'solo', 'opacity')}`)
  await p.close()

  // 4. earlier than 0: the layer stops at 0 with its spacing kept
  p = await page(browser, { a: shift(-5) })
  check('moved before 0: the layer starts at 0 and keeps its spacing', near(await at(p, 0, 'a', 'x'), -100) && near(await at(p, 1, 'a', 'x'), 0) && near(await at(p, 2.25, 'a', 'y'), 25), `${await at(p, 0, 'a', 'x')} ${await at(p, 2.25, 'a', 'y')}`)
  mo = (await ask(p, 'motions')).items
  const ofA = mo.filter((m) => m.owners[0] === 'a')
  check('…and reports the shift it really got', ofA.length && ofA.every((m) => m.layerShift === -1), JSON.stringify(ofA.map((m) => [m.key, m.sig, m.layerShift, m.start])))
  const inner = ofA.find((m) => m.nested)
  check("a stagger target's own record is marked (no block) and follows the move", inner && near(inner.start, 2, 1e-3), JSON.stringify(inner))
  await p.close()

  // 4b. earlier inside a scene: the layer stops at the scene's start, spacing kept
  p = await page(browser, { kid: shift(-3) })
  check('moved before its scene starts: stops there, spacing kept', near(await at(p, 4.5, 'kid', 'x'), 50) && near(await at(p, 5.25, 'kid', 'y'), 25), `${await at(p, 4.5, 'kid', 'x')} ${await at(p, 5.25, 'kid', 'y')}`)
  await p.close()

  // 5. inside a scene timeline, and a clip placed by data-start
  p = await page(browser, { kid: shift(1), clip: shift(1.5) })
  check('a tween in a scene moves in scene time', near(await at(p, 5.5, 'kid', 'x'), 0) && near(await at(p, 6, 'kid', 'x'), 50) && near(await at(p, 6.5, 'kid', 'x'), 100), `${await at(p, 6, 'kid', 'x')}`)
  const clipStart = await p.evaluate(() => document.querySelector('[data-ms-id="clip"]').getAttribute('data-start'))
  check('a clip moves with its layer', near(parseFloat(clipStart), 3.5, 1e-3), clipStart)
  tm = (await ask(p, 'timing')).items
  check("the clip's bar follows", near(bar('clip').start, 3.5, 1e-3) && near(bar('clip').end, 5.5, 1e-3), JSON.stringify(bar('clip')))
  await p.close()

  // 5b. in / out points of a layer the composition lays out (no wrapper)
  p = await page(browser, { flowtext: { inPoint: 2, outPoint: 5 } })
  const vis = (t) => p.evaluate((t) => { window.__timelines.main.seek(t); return getComputedStyle(document.querySelector('[data-ms-id="flowtext"]')).visibility }, t)
  check('in / out on a laid-out layer (no wrapper)', (await vis(1)) === 'hidden' && (await vis(3)) === 'visible' && (await vis(6)) === 'hidden', `${await vis(1)} ${await vis(3)} ${await vis(6)}`)
  await p.close()

  // 6. the pill behind a label is a layer of its own
  p = await page(browser, {}, BOXES)
  const els = (await ask(p, 'elements')).items.map((e) => [e.id, e.type, e.label, e.parent])
  check('a plain coloured box in a group gets its own layer', JSON.stringify(els.find((e) => e[0] === 'badge~0')) === JSON.stringify(['badge~0', 'shape', '상자', 'badge']), JSON.stringify(els))
  check('its label stays a separate text layer', els.some((e) => e[0] === 'badge~1' && e[1] === 'text' && e[2] === 'NEW'), JSON.stringify(els))
  check('tiny or invisible boxes are not layers', !els.some((e) => e[0] === 'badge~2' || e[0] === 'badge~3'), JSON.stringify(els))
  check('a box with text in it stays one text layer (Claude splits those)', els.some((e) => e[0] === 'badge~4' && e[1] === 'text' && e[2] === 'SALE'), JSON.stringify(els))
  await p.close()
  // the designer moved the box: it moves (it has its own wrapper)
  p = await page(browser, { 'badge~0': { transform: { x: 30 } } }, BOXES)
  const moved = await p.evaluate(() => {
    const w = document.querySelector('[data-ms-wrap-for="badge~0"]')
    return w ? getComputedStyle(w).getPropertyValue('--ms-x').trim() : null
  })
  check('a moved box moves on its own', moved === '30px', String(moved))
  await p.close()

  // 7. clicking picks what is on screen now (wrappers and the composition turn pointer events off)
  p = await page(browser, { title1: { transform: { x: 0 } } }, SCENES)
  const early = await hit(p, 1, 150, 120)
  check('a click picks the visible layer, not one faded out on top of it', early[0] === 'title1' && !early.includes('title2') && !early.includes('scene2'), JSON.stringify(early))
  const late = await hit(p, 4, 150, 120)
  check('…and the other one once the scenes change', late[0] === 'title2' && !late.includes('title1'), JSON.stringify(late))
  const empty = await hit(p, 1, 700, 500)
  check("an empty spot: what is drawn there first, a container's bare area last", JSON.stringify(empty) === JSON.stringify(['bg', 'scene1']), JSON.stringify(empty))
  await p.close()
} finally {
  await browser.close()
}
if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nlayer editing: all passed')
