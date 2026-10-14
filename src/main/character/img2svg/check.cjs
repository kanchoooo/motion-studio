/* check.js — 태그된 캐릭터 SVG(tagged.svg)를 극단 자세로 돌려 보고 관절 문제를 찾는다.
 *
 *   const { checkCharacter } = require('./check.cjs'); const r = await checkCharacter(svgText)   // r.sheet(PNG), r.groups, r.eyes, r.ok
 *
 * 부위(<g data-pivot>)마다 최대 각도(data-max-rot, 없으면 부위별 기본값)의 양쪽으로 돌려서, pivot 주변에서
 *  - 틈(cracks): 정지 상태에는 없던 가는 빈틈(투명) — 부위가 떨어져 보인다
 *  - 남은 조각(ghosts, 자홍): 부위가 비킨 자리에 같은 색이 드러남 — 턱 끝이 목에 남는 식이면 끊겨 보이고,
 *    목이 이어져 보이는 것이면 괜찮다(눈으로 판단). 일부러 넣은 숨은 도형(data-added)은 세지 않는다
 * 눈(data-eye)은 눈 장치(흰자 전체 + clip된 눈동자)로 만들었는지 보고, 1.3배로 키운 모습을 시트에 넣는다.
 */
'use strict'
const sharp = require('sharp')

const DEFAULT_ROT = [[/^head$/, 8], [/hand|foot|wrist|ankle/, 12], [/arm|leg|thigh|shin/, 12], [/^body$/, 3], [/^hair$|tail/, 6]]
const SKIP = /^(eye|pupil|lash|brow|mouth|nose|cheek|face|neck|untagged|character)/

/** [start, end) of <g id="…">…</g> and its opening tag */
function block(svg, id) {
  const open = new RegExp(`<g id="${id}"[^>]*>`).exec(svg)
  if (!open) return null
  const re = /<\/?g\b[^>]*>/g
  re.lastIndex = open.index
  let depth = 0, m
  while ((m = re.exec(svg))) {
    if (m[0][1] === '/') { if (--depth === 0) return { start: open.index, end: m.index + m[0].length, tag: open[0] } }
    else if (!m[0].endsWith('/>')) depth++
  }
  return null
}

/** the group (and every element that follows it) transformed */
function transformed(svg, id, t) {
  return svg
    .replace(new RegExp(`(<g id="${id}"[^>]*?)(\\s*/?)>`), `$1 transform="${t}"$2>`)
    .replace(new RegExp(`(<g[^>]*data-follow="${id}"[^>]*?)>`, 'g'), `$1 transform="${t}">`)
}

/** the moving group painted magenta; the fills added on purpose to be uncovered (under-hang, scalp …) cyan */
function flagged(svg, id) {
  let out = svg.replace(/(<(?:path|ellipse|circle|rect|polygon)[^>]*data-added="[^"]*"[^>]*?)fill="[^"]*"/g, '$1fill="#00FFFF"')
  const b = block(out, id)
  if (b) out = out.slice(0, b.start) + out.slice(b.start, b.end).replace(/fill="[^"]*"/g, 'fill="#FF00FF"') + out.slice(b.end)
  return out.replace(/(<g[^>]*data-follow="[^"]*"[^>]*>)([\s\S]*?)(<\/g>)/g, (m, a, inner, c) => (a.includes(`data-follow="${id}"`) ? a + inner.replace(/fill="[^"]*"/g, 'fill="#FF00FF"') + c : m))
}

async function render(svg, w, h) {
  const { data } = await sharp(Buffer.from(svg), { density: 72 }).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data
}

const isMag = (b, i) => b[i * 4 + 3] > 127 && b[i * 4] > 200 && b[i * 4 + 1] < 70 && b[i * 4 + 2] > 200
const isCyan = (b, i) => b[i * 4 + 3] > 127 && b[i * 4] < 70 && b[i * 4 + 1] > 200 && b[i * 4 + 2] > 200
const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16))

/** thin gaps: pixels that a small closing fills (inside the disc) */
function cracks(img, w, h, cx, cy, R) {
  const x0 = Math.max(0, Math.round(cx - R)), y0 = Math.max(0, Math.round(cy - R)), x1 = Math.min(w, Math.round(cx + R)), y1 = Math.min(h, Math.round(cy + R))
  const W = x1 - x0, H = y1 - y0
  if (W <= 0 || H <= 0) return []
  const a = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = img[((y + y0) * w + x + x0) * 4 + 3] > 127 ? 1 : 0
  const morph = (src, grow, r) => {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 1
      for (let dy = -r; dy <= r && v === (grow ? 0 : 1); dy++) for (let dx = -r; dx <= r; dx++) {
        const X = x + dx, Y = y + dy
        const s = X < 0 || Y < 0 || X >= W || Y >= H ? 0 : src[Y * W + X]
        if (grow && s) { v = 1; break }
        if (!grow && !s) { v = 0; break }
      }
      out[y * W + x] = v
    }
    return out
  }
  const closed = morph(morph(a, true, 3), false, 3)
  const list = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (closed[i] && !a[i] && Math.hypot(x + x0 - cx, y + y0 - cy) <= R) list.push((y + y0) * w + x + x0)
  }
  return list
}

/** a tile around (cx, cy): the render with problem pixels painted */
async function tile(img, w, h, cx, cy, R, marks, label, size = 280) {
  const buf = Buffer.from(img)
  for (const [list, col] of marks) for (const i of list) { buf[i * 4] = col[0]; buf[i * 4 + 1] = col[1]; buf[i * 4 + 2] = col[2]; buf[i * 4 + 3] = 255 }
  // a pivot at or beyond the edge (a cropped body) still gets a tile of the canvas around it
  const left = Math.min(w - 1, Math.max(0, Math.round(cx - R))), top = Math.min(h - 1, Math.max(0, Math.round(cy - R)))
  const width = Math.max(1, Math.min(w - left, Math.round(2 * R))), height = Math.max(1, Math.min(h - top, Math.round(2 * R)))
  const pic = await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).extract({ left, top, width, height }).flatten({ background: '#d9d9d9' }).resize(size, size, { fit: 'contain', background: '#d9d9d9' }).png().toBuffer()
  const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="26"><rect width="100%" height="100%" fill="#111"/><text x="8" y="18" font-family="Arial" font-size="14" fill="#ffd166">${label.replace(/[<&]/g, '')}</text></svg>`)
  return sharp({ create: { width: size, height: size + 26, channels: 4, background: '#111' } }).composite([{ input: pic, left: 0, top: 0 }, { input: caption, left: 0, top: size }]).png().toBuffer()
}

async function checkCharacter(svgText) {
  const vb = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const w = Math.round(+vb[1]), h = Math.round(+vb[2])
  // holes must show: no background rect
  const svg = svgText.replace(/<\?xml[^>]*>/, '').replace(/<rect id="bg"[^>]*\/>/, '')
  const rest = await render(svg, w, h)
  const groups = [], eyes = [], tiles = []
  tiles.push(await tile(rest, w, h, w / 2, h / 2, Math.max(w, h) / 2, [], '정지 상태'))
  for (const m of svg.matchAll(/<g id="([^"]+)"[^>]*\bdata-pivot="([\d.\-]+) ([\d.\-]+)"[^>]*>/g)) {
    const [tag, id] = m
    const pivot = [+m[2], +m[3]]
    const eyeGeo = tag.match(/data-eye="([^"]+)"/)
    if (eyeGeo || /^eye-/.test(id)) {
      const b = block(svg, id)
      const rig = !!eyeGeo && !!b && /data-added="흰자 전체/.test(svg.slice(b.start, b.end)) && /clip-path=/.test(svg.slice(b.start, b.end))
      eyes.push({ id, rig })
      const [cx, cy, rx, ry] = eyeGeo ? eyeGeo[1].split(' ').map(Number) : [pivot[0], pivot[1], 40, 40]
      const pupilId = id.replace(/^eye-/, 'pupil-')
      const look = transformed(svg, id, `translate(${cx} ${cy}) scale(1.3) translate(${-cx} ${-cy})`).replace(new RegExp(`(<g id="${pupilId}"[\\s\\S]*?data-role="content")`), `$1 transform="translate(${(rx * 0.3).toFixed(1)} 0)"`)
      tiles.push(await tile(await render(look, w, h), w, h, cx, cy, Math.max(rx, ry) * 2.2, [], `${id} · 1.3배${rig ? '' : ' · 눈 장치 아님'}`, 200))
      continue
    }
    if (SKIP.test(id)) continue
    const own = tag.match(/data-max-rot="([\d.]+)"/)
    const def = DEFAULT_ROT.find(([re]) => re.test(id))
    const max = own ? +own[1] : def ? def[1] : 0
    if (!max) continue
    const b = block(svg, id)
    if (!b) continue
    const fills = [...new Set([...svg.slice(b.start, b.end).matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((x) => x[1].toUpperCase()))].map(hexRgb)
    const area = (svg.slice(b.start, b.end).match(/data-area="(\d+)"/g) || []).reduce((a, x) => a + +x.match(/\d+/)[0], 0)
    const R = Math.max(40, Math.min(Math.min(w, h) * 0.16, Math.sqrt(area || w * h * 0.02) * 0.45))
    const restFlag = await render(flagged(svg, id), w, h)
    const baseCracks = cracks(rest, w, h, pivot[0], pivot[1], R).length
    const res = { id, angle: max, cracks: [], ghosts: [] }
    for (const deg of [-max, max]) {
      const t = `rotate(${deg} ${pivot[0]} ${pivot[1]})`
      const pose = transformed(svg, id, t)
      const img = await render(pose, w, h)
      const flag = await render(flagged(pose, id), w, h)
      const crack = cracks(img, w, h, pivot[0], pivot[1], R)
      const ghost = []
      for (let y = Math.max(0, Math.round(pivot[1] - R)); y < Math.min(h, pivot[1] + R); y++)
        for (let x = Math.max(0, Math.round(pivot[0] - R)); x < Math.min(w, pivot[0] + R); x++) {
          const i = y * w + x
          if (Math.hypot(x - pivot[0], y - pivot[1]) > R || !isMag(restFlag, i) || isMag(flag, i) || isCyan(flag, i) || img[i * 4 + 3] < 128) continue
          const c = [img[i * 4], img[i * 4 + 1], img[i * 4 + 2]]
          if (fills.some((f) => Math.abs(f[0] - c[0]) + Math.abs(f[1] - c[1]) + Math.abs(f[2] - c[2]) < 36)) ghost.push(i)
        }
      res.cracks.push(Math.max(0, crack.length - baseCracks))
      res.ghosts.push(ghost.length)
      tiles.push(await tile(img, w, h, pivot[0], pivot[1], R, [[crack, [255, 0, 0]], [ghost, [255, 0, 255]]], `${id} ${deg > 0 ? '+' : ''}${deg}° · 틈 ${Math.max(0, crack.length - baseCracks)} · 조각 ${ghost.length}`))
    }
    // gaps are always wrong; uncovered same-colour skin is shown for judging (the neck continuing under a
    // turned head is fine, a chin tip or face corner left behind is not) and only fails when it is large
    res.limit = Math.max(60, Math.round(Math.PI * R * R * 0.012))
    res.ok = Math.max(...res.cracks) <= 12 && Math.max(...res.ghosts) <= res.limit
    groups.push(res)
  }
  // contact sheet
  const COLS = 4, S = 280, CELL = S + 26
  const rows = Math.ceil(tiles.length / COLS)
  const sheet = await sharp({ create: { width: COLS * S, height: rows * CELL, channels: 4, background: '#222' } })
    .composite(tiles.map((t, k) => ({ input: t, left: (k % COLS) * S, top: Math.floor(k / COLS) * CELL })))
    .png()
    .toBuffer()
  const ok = groups.every((g) => g.ok) && eyes.every((e) => e.rig)
  return { sheet, groups, eyes, ok }
}

module.exports = { checkCharacter, block, transformed, flagged }
