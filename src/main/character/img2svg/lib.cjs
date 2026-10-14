/* img2svg — 이미지 → 모션용 SVG (Node / Electron 공용, CommonJS)
 *
 *   const { vectorize, previews } = require('./lib')
 *   const r = await vectorize('in.png', { colors: 14, bg: 'auto' })   // r.svg, r.shapes, r.width, r.height
 *   const p = await previews('in.png', r)                               // p.compare, p.sheet (PNG Buffer)
 *
 * 의존성: @visioncortex/vtracer (WASM, 네이티브 없음), sharp (이미지 디코드/SVG 래스터 — 모션스튜디오에 이미 포함)
 *
 * 처리 순서
 *  1) 배경: 투명 PNG면 알파로, 아니면 테두리의 지배색과 이어진 영역. 크로마키(초록/마젠타)·투명은 지우고, 그 외는 사각형 1개.
 *  2) 색 정리: Lab k-means(N색) → 비슷한 색 병합 → 3x3 최빈값 필터 → 작거나 얇은 조각(안티앨리어싱 띠)은 이웃 색에 흡수.
 *  3) 벡터화: 정리된 단색 이미지 + 고정 팔레트로 VTracer(stacked, spline). stacked라서 아래 도형이 위 도형 밑까지 이어짐.
 *  4) 기록: 도형마다 id(s01…, 그리는 순서)와 data-color / data-bbox / data-area / data-visible. 완전히 가려진 도형·티끌 제거.
 */
'use strict'
const vtracer = require('@visioncortex/vtracer')
const sharp = require('sharp')

// ---------------------------------------------------------------- 유틸
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
function rgb2lab(r, g, b) {
  const f = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92 }
  r = f(r); g = f(g); b = f(b)
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const h = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  x = h(x); y = h(y); z = h(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

async function decode(input, maxSide) {
  let img = sharp(input).rotate()
  const meta = await img.metadata()
  const s = Math.min(1, maxSide / Math.max(meta.width, meta.height))
  if (s < 1) img = img.resize(Math.round(meta.width * s), Math.round(meta.height * s), { kernel: 'lanczos3' })
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height }
}

// ---------------------------------------------------------------- 1) 배경
function findBackground(px, w, h) {
  const n = w * h, mask = new Uint8Array(n)
  let transparent = 0
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] < 250) transparent++
  if (transparent > n * 0.02) { for (let i = 0; i < n; i++) mask[i] = px[i * 4 + 3] < 128 ? 1 : 0; return { mask, color: null, alpha: true } }
  const border = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1)
  const hist = new Map()
  for (const i of border) { const k = (px[i * 4] >> 3) * 1024 + (px[i * 4 + 1] >> 3) * 32 + (px[i * 4 + 2] >> 3); hist.set(k, (hist.get(k) || 0) + 1) }
  let best = -1, bc = 0
  for (const [k, c] of hist) if (c > bc) { bc = c; best = k }
  if (bc < border.length * 0.35) return { mask, color: null, alpha: false }
  const sel = border.filter(i => (px[i * 4] >> 3) * 1024 + (px[i * 4 + 1] >> 3) * 32 + (px[i * 4 + 2] >> 3) === best)
  const med = c => { const v = sel.map(i => px[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1] }
  const ref = [med(0), med(1), med(2)]
  const near = i => Math.abs(px[i * 4] - ref[0]) + Math.abs(px[i * 4 + 1] - ref[1]) + Math.abs(px[i * 4 + 2] - ref[2]) < 60
  const q = new Int32Array(n); let qh = 0, qt = 0
  for (const i of border) if (!mask[i] && near(i)) { mask[i] = 1; q[qt++] = i }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0
    if (x > 0 && !mask[i - 1] && near(i - 1)) { mask[i - 1] = 1; q[qt++] = i - 1 }
    if (x < w - 1 && !mask[i + 1] && near(i + 1)) { mask[i + 1] = 1; q[qt++] = i + 1 }
    if (y > 0 && !mask[i - w] && near(i - w)) { mask[i - w] = 1; q[qt++] = i - w }
    if (y < h - 1 && !mask[i + w] && near(i + w)) { mask[i + w] = 1; q[qt++] = i + w }
  }
  return { mask, color: ref, alpha: false }
}

function dilate(mask, w, h, iters) {
  let m = mask
  for (let k = 0; k < iters; k++) {
    const o = m.slice()
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (m[i]) continue
      for (let dy = -1; dy <= 1 && !o[i]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy
        if (X >= 0 && Y >= 0 && X < w && Y < h && m[Y * w + X]) { o[i] = 1; break }
      }
    }
    m = o
  }
  return m
}

// ---------------------------------------------------------------- 2) 색 정리
function kmeansLab(px, fg, n, K) {
  const lab = new Float32Array(n * 3), idx = []
  for (let i = 0; i < n; i++) if (fg[i]) { const L = rgb2lab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2]; idx.push(i) }
  const rnd = mulberry32(7), S = Math.min(idx.length, 60000), samp = new Int32Array(S)
  for (let s = 0; s < S; s++) samp[s] = idx[Math.floor(rnd() * idx.length)]
  const d2 = (i, c) => { const a = lab[i * 3] - c[0], b = lab[i * 3 + 1] - c[1], e = lab[i * 3 + 2] - c[2]; return a * a + b * b + e * e }
  // k-means++
  let C = [[lab[samp[0] * 3], lab[samp[0] * 3 + 1], lab[samp[0] * 3 + 2]]]
  const dist = new Float64Array(S).fill(Infinity)
  while (C.length < K) {
    let sum = 0
    for (let s = 0; s < S; s++) { dist[s] = Math.min(dist[s], d2(samp[s], C[C.length - 1])); sum += dist[s] }
    if (sum === 0) break
    let r = rnd() * sum, s = 0
    while (s < S - 1 && (r -= dist[s]) > 0) s++
    C.push([lab[samp[s] * 3], lab[samp[s] * 3 + 1], lab[samp[s] * 3 + 2]])
  }
  for (let it = 0; it < 25; it++) {
    const acc = C.map(() => [0, 0, 0, 0])
    for (let s = 0; s < S; s++) {
      let b = 0, bd = Infinity
      for (let k = 0; k < C.length; k++) { const d = d2(samp[s], C[k]); if (d < bd) { bd = d; b = k } }
      const i = samp[s]; acc[b][0] += lab[i * 3]; acc[b][1] += lab[i * 3 + 1]; acc[b][2] += lab[i * 3 + 2]; acc[b][3]++
    }
    C = C.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c)
  }
  // ΔE < 9 병합
  for (let merged = true; merged;) {
    merged = false
    outer: for (let a = 0; a < C.length; a++) for (let b = a + 1; b < C.length; b++) {
      if (Math.hypot(C[a][0] - C[b][0], C[a][1] - C[b][1], C[a][2] - C[b][2]) < 9) {
        C[a] = [(C[a][0] + C[b][0]) / 2, (C[a][1] + C[b][1]) / 2, (C[a][2] + C[b][2]) / 2]; C.splice(b, 1); merged = true; break outer
      }
    }
  }
  const L = new Int16Array(n).fill(-1)
  for (const i of idx) { let b = 0, bd = Infinity; for (let k = 0; k < C.length; k++) { const d = d2(i, C[k]); if (d < bd) { bd = d; b = k } } L[i] = b }
  return { L, K: C.length }
}

function majority(L, w, h, K) {
  const out = L.slice(), cnt = new Int32Array(K)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (L[i] < 0) continue
    cnt.fill(0)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy
      if (X >= 0 && Y >= 0 && X < w && Y < h) { const v = L[Y * w + X]; if (v >= 0) cnt[v]++ }
    }
    let b = L[i]; for (let k = 0; k < K; k++) if (cnt[k] > cnt[b]) b = k
    out[i] = b
  }
  return out
}

function absorbSmall(L, w, h, minPx, thinRatio) {
  const n = w * h
  for (let pass = 0; pass < 4; pass++) {
    const comp = new Int32Array(n).fill(-1), q = new Int32Array(n)
    let changed = 0, cid = 0
    for (let s = 0; s < n; s++) {
      if (L[s] < 0 || comp[s] >= 0) continue
      const lab = L[s]; let qh = 0, qt = 0; q[qt++] = s; comp[s] = cid
      while (qh < qt) {
        const i = q[qh++], x = i % w, y = (i / w) | 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue
          const j = Y * w + X; if (comp[j] < 0 && L[j] === lab) { comp[j] = cid; q[qt++] = j }
        }
      }
      const area = qt
      {
        let per = 0; const nb = new Map()
        for (let k = 0; k < qt; k++) {
          const i = q[k], x = i % w, y = (i / w) | 0; let edge = false
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) { edge = true; continue }
            const j = Y * w + X
            if (comp[j] !== cid) { edge = true; if (L[j] !== lab) nb.set(L[j], (nb.get(L[j]) || 0) + 1) }
          }
          if (edge) per++
        }
        const thin = area / Math.max(1, per) < thinRatio   // 평균 폭이 약 3px 이하인 띠(경계 안티앨리어싱)
        if ((area < minPx || thin) && nb.size) {
          let best = null, bc = -1
          for (const [k, c] of nb) if (k >= 0 && c > bc) { bc = c; best = k }
          if (best === null) best = -1
          for (let k = 0; k < qt; k++) L[q[k]] = best
          changed++
        }
      }
      cid++
    }
    if (!changed) break
  }
  return L
}

// ---------------------------------------------------------------- 3)~4) 벡터화 + 기록
// path d 를 하위 경로(M…)별로 나눈다. 상대 좌표 m 은 절대 좌표 M 으로 바꿔서 떼어내도 위치가 유지되게 한다.
function splitSubpaths(d) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || []
  const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  const subs = []; let cur = '', x = 0, y = 0, sx = 0, sy = 0, i = 0, cmd = null
  const fmt = v => +v.toFixed(2)
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++]
    const lc = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase(), n = ARGS[lc]
    if (lc === 'z') { cur += 'Z'; x = sx; y = sy; cmd = null; continue }
    const a = toks.slice(i, i + n).map(Number); i += n
    if (lc === 'm') {
      x = (rel ? x : 0) + a[0]; y = (rel ? y : 0) + a[1]; sx = x; sy = y
      if (cur) subs.push(cur)
      cur = 'M' + fmt(x) + ',' + fmt(y); cmd = rel ? 'l' : 'L'; continue
    }
    cur += cmd + a.join(',')
    if (lc === 'h') x = (rel ? x : 0) + a[0]
    else if (lc === 'v') y = (rel ? y : 0) + a[0]
    else { x = (rel ? x : 0) + a[n - 2]; y = (rel ? y : 0) + a[n - 1] }
  }
  if (cur) subs.push(cur)
  return subs
}
function maskOf(d, w, h) { return shapeMask('<path fill="#fff" d="' + d + '"/>', w, h) }

async function shapeMask(pathTag, w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${pathTag.replace(/fill="[^"]*"/, 'fill="#fff"')}</svg>`
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const m = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) m[i] = data[i * 4 + 3] > 127 ? 1 : 0
  return m
}

async function vectorize(input, opts = {}) {
  const o = Object.assign({ colors: 14, bg: 'auto', minPx: 0, maxSide: 1600, smooth: 2, simplify: 0, thin: 1.6 }, opts)
  const { px, w, h } = await decode(input, o.maxSide)
  const n = w * h, minPx = o.minPx || Math.max(24, Math.round(n * 0.00006))
  // 1) 배경
  const B = findBackground(px, w, h)
  const c = B.color
  const chroma = !!c && ((c[1] > 180 && c[0] < 90 && c[2] < 90) || (c[0] > 180 && c[2] > 180 && c[1] < 90))
  const hasBg = B.mask.some(v => v)
  const bgMode = o.bg !== 'auto' ? o.bg : (B.alpha || chroma ? 'none' : (hasBg ? 'keep' : 'none'))
  const bgMask = hasBg ? dilate(B.mask, w, h, chroma ? 2 : (B.alpha ? 0 : 1)) : B.mask
  const fg = new Uint8Array(n); for (let i = 0; i < n; i++) fg[i] = bgMask[i] ? 0 : 1
  // 2) 색 정리
  let { L, K } = kmeansLab(px, fg, n, o.colors)
  for (let s = 0; s < o.smooth; s++) L = majority(L, w, h, K)
  L = absorbSmall(L, w, h, minPx, o.thin)
  for (let i = 0; i < n; i++) if (bgMask[i]) L[i] = -1
  // 라벨별 실제 색 = 원본 픽셀 채널별 중앙값
  const hist = new Uint32Array(K * 3 * 256), cnt = new Uint32Array(K)
  for (let i = 0; i < n; i++) { const k = L[i]; if (k < 0) continue; cnt[k]++; for (let ch = 0; ch < 3; ch++) hist[(k * 3 + ch) * 256 + px[i * 4 + ch]]++ }
  const pal = []
  for (let k = 0; k < K; k++) {
    if (!cnt[k]) { pal.push(null); continue }
    const col = [0, 1, 2].map(ch => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[(k * 3 + ch) * 256 + v]; if (acc * 2 >= cnt[k]) return v } return 0 })
    pal.push(col)
  }
  const flat = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const k = L[i]
    if (k >= 0) { const p = pal[k]; flat[i * 4] = p[0]; flat[i * 4 + 1] = p[1]; flat[i * 4 + 2] = p[2]; flat[i * 4 + 3] = 255 }
    else if (bgMode === 'keep' && c) { flat[i * 4] = c[0]; flat[i * 4 + 1] = c[1]; flat[i * 4 + 2] = c[2]; flat[i * 4 + 3] = 255 }
  }
  const palette = pal.filter(Boolean).map(p => hex(p[0], p[1], p[2]))
  if (bgMode === 'keep' && c) palette.unshift(hex(c[0], c[1], c[2]))
  // 3) 벡터화
  const raw = vtracer.convertPixels(flat, w, h, {
    hierarchical: 'stacked', mode: 'spline', palette, filterSpeckle: 4,
    cornerThreshold: 60, lengthThreshold: 4, spliceThreshold: 45, pathPrecision: 2,
    ...(o.simplify ? { simplify: o.simplify } : {})
  })
  // 4) 기록
  const tags = raw.match(/<path[^>]*\/>/g) || []
  const shapes = []
  for (const tag of tags) {
    const fill = ((tag.match(/fill="([^"]+)"/) || [])[1] || '#000000').toUpperCase()
    const tr = (tag.match(/transform="([^"]+)"/) || [])[1]
    const subs = splitSubpaths(tag.match(/ d="([^"]+)"/)[1])
    if (subs.length === 1 || tr) { shapes.push({ tag, fill, mask: await shapeMask(tag, w, h) }); continue }
    // 같은 색이라도 떨어진 영역은 각각 다른 도형으로. 다른 하위 경로 안에 들어 있는 하위 경로는 그 도형의 구멍.
    const parts = []
    for (const d of subs) { const m = await maskOf(d, w, h); let a = 0; for (let i = 0; i < m.length; i++) a += m[i]; parts.push({ d, m, a, holes: [] }) }
    const bySize = parts.slice().sort((p, q) => q.a - p.a), outers = []
    for (const p of bySize) {
      let host = null
      for (const o of outers) { let inside = 0; for (let i = 0; i < p.m.length; i++) if (p.m[i] && o.m[i]) inside++; if (inside > p.a * 0.95) { host = o; break } }
      if (host) host.holes.push(p.d); else outers.push(p)
    }
    outers.sort((p, q) => parts.indexOf(p) - parts.indexOf(q))   // 원래 그리는 순서 유지
    for (const o of outers) {
      const t = '<path d="' + [o.d].concat(o.holes).join('') + '" fill="' + fill + '"' + (o.holes.length ? ' fill-rule="evenodd"' : '') + '/>'
      shapes.push({ tag: t, fill, mask: o.holes.length ? await shapeMask(t, w, h) : o.m })
    }
  }
  const taken = new Uint8Array(n)
  for (let s = shapes.length - 1; s >= 0; s--) {
    const m = shapes[s].mask; let area = 0, vis = 0, x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let i = 0; i < n; i++) if (m[i]) {
      area++; if (!taken[i]) { vis++; taken[i] = 1 }
      const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    Object.assign(shapes[s], { area, visible: vis, bbox: x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1] })
  }
  let bgRect = null
  const kept = []
  shapes.forEach((s, i) => {
    if (i === 0 && bgMode === 'keep' && s.area > n * 0.6) { bgRect = s.fill; return }
    if (s.visible < Math.max(8, Math.round(minPx / 3))) return
    kept.push(s)
  })
  const meta = kept.map((s, i) => ({ id: 's' + String(i + 1).padStart(2, '0'), color: s.fill, bbox: s.bbox, area: s.area, visible: s.visible, z: i + 1 }))
  const rows = kept.map((s, i) => {
    const m = meta[i], d = s.tag.match(/ d="([^"]+)"/)[1], tr = s.tag.match(/transform="[^"]+"/)
    const fr = /fill-rule="evenodd"/.test(s.tag) ? ' fill-rule="evenodd"' : ''
    return `<path id="${m.id}" data-color="${m.color}" data-bbox="${m.bbox.join(' ')}" data-area="${m.area}" data-visible="${m.visible}" fill="${m.color}"${fr}${tr ? ' ' + tr[0] : ''} d="${d}"/>`
  })
  const src = typeof input === 'string' ? require('path').basename(input) : 'buffer'
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- img2svg: ${src} → 도형 ${rows.length}개. id 순서 = 그리는 순서(아래→위). data-bbox="x y w h", data-visible = 실제 보이는 픽셀 수.
     다음 단계: 원본을 보고 각 도형에 data-part="부위" 를 붙이고 부위별 <g>로 묶는다. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-source="${src}">
${bgRect ? `<rect id="bg" data-role="background" width="${w}" height="${h}" fill="${bgRect}"/>\n` : ''}<g id="shapes">
${rows.join('\n')}
</g>
</svg>
`
  return { svg, shapes: meta, width: w, height: h, background: bgRect, palette, _px: px, _bgMask: bgMask, _kept: kept }
}

// ---------------------------------------------------------------- 확인용 이미지
async function previews(r) {
  const { width: w, height: h } = r, n = w * h
  const checker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#fff"/><rect width="16" height="16" fill="#e6e6e6"/><rect x="16" y="16" width="16" height="16" fill="#e6e6e6"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#c)"/></svg>`)
  const back = await sharp(checker).ensureAlpha().raw().toBuffer()
  const rend = await sharp(back, { raw: { width: w, height: h, channels: 4 } }).composite([{ input: Buffer.from(r.svg) }]).raw().toBuffer()
  const orig = Buffer.alloc(n * 4), heat = Buffer.alloc(n * 4)
  let bad = 0
  for (let i = 0; i < n; i++) {
    const bgp = !r.background && r._bgMask[i]
    for (let ch = 0; ch < 3; ch++) orig[i * 4 + ch] = bgp ? rend[i * 4 + ch] : r._px[i * 4 + ch]
    orig[i * 4 + 3] = 255
    const d = Math.abs(orig[i * 4] - rend[i * 4]) + Math.abs(orig[i * 4 + 1] - rend[i * 4 + 1]) + Math.abs(orig[i * 4 + 2] - rend[i * 4 + 2])
    const g = (orig[i * 4] * 0.3) | 0
    heat[i * 4] = heat[i * 4 + 1] = heat[i * 4 + 2] = g; heat[i * 4 + 3] = 255
    if (d > 150) { heat[i * 4] = 255; heat[i * 4 + 1] = 40; heat[i * 4 + 2] = 40; bad++ } else if (d > 60) { heat[i * 4] = 255; heat[i * 4 + 1] = 220; heat[i * 4 + 2] = 0 }
  }
  const raw = { width: w, height: h, channels: 4 }
  const tile = async b => sharp(b, { raw }).png().toBuffer()
  const compareFull = await sharp({ create: { width: w * 3, height: h, channels: 4, background: '#000' } })
    .composite([{ input: await tile(orig), left: 0, top: 0 }, { input: await tile(rend), left: w, top: 0 }, { input: await tile(heat), left: w * 2, top: 0 }]).png().toBuffer()
  const compare = await sharp(compareFull).resize({ height: Math.min(h, 700) }).png().toBuffer()
  // 도형 낱장
  const CW = 200, CH = 170, COLS = 8, list = r._kept
  const rows = Math.max(1, Math.ceil(list.length / COLS))
  let cells = ''
  list.forEach((s, k) => {
    const m = r.shapes[k], [x0, y0, bw, bh] = m.bbox, cx = (k % COLS) * CW, cy = Math.floor(k / COLS) * CH, pad = 6
    cells += `<g transform="translate(${cx} ${cy})"><rect x="0.5" y="0.5" width="${CW - 1}" height="${CH - 1}" fill="url(#c)" stroke="#bbb"/>` +
      `<svg x="5" y="5" width="${CW - 10}" height="${CH - 38}" viewBox="${x0 - pad} ${y0 - pad} ${bw + 2 * pad} ${bh + 2 * pad}">${s.tag}</svg>` +
      `<rect y="${CH - 28}" width="${CW}" height="28" fill="#111"/><text x="8" y="${CH - 9}" font-family="Arial" font-weight="bold" font-size="17" fill="#ffd166">${m.id}</text>` +
      `<text x="64" y="${CH - 9}" font-family="Arial" font-size="13" fill="#ccc">${m.color}  ${m.visible}px</text></g>`
  })
  const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW * COLS}" height="${CH * rows}"><defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#e6e6e6"/><rect x="8" y="8" width="8" height="8" fill="#e6e6e6"/></pattern></defs><rect width="100%" height="100%" fill="#fff"/>${cells}</svg>`
  const sheet = await sharp(Buffer.from(sheetSvg)).png().toBuffer()
  return { compare, sheet, badPct: bad / n * 100 }
}

module.exports = { vectorize, previews }
