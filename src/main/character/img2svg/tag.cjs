/* tag.js — img2svg 결과 SVG에 AI가 정한 파츠 태그를 입혀, 부위별 <g> 계층 SVG로 다시 묶는다.
 *
 *   node tag.js <img2svg 결과.svg> <태그.json> <출력.svg>
 *   const { applyTags } = require('./tag'); const r = await applyTags(svgText, tags)   // r.svg, r.report
 *
 * 태그 JSON (AI가 원본 이미지와 _shapes.png를 비교해 작성)
 * {
 *   "parts": [                          // 그리는 순서(아래 → 위). children으로 중첩
 *     { "id": "head", "label": "머리", "pivot": [638, 880], "children": [
 *         { "id": "face", "label": "얼굴", "shapes": ["s01"], "clip": "M0 0 H1254 V880 H0 Z" },
 *         { "id": "eye-l-white", "label": "왼눈 흰자", "shapes": [{ "svg": "<ellipse …/>", "note": "가려진 부분 채움" }, "s09"] },
 *         { "id": "pupil-l", "label": "왼눈동자", "shapes": ["s16"], "clip": "ellipse 512 595 92 90" }
 *     ] }
 *   ]
 * }
 *  - shapes: 도형 id 또는 { svg } (AI가 추가한 도형: 가려졌던 부분 채우기 등)
 *  - clip: SVG path d, "ellipse cx cy rx ry", "rect x y w h", 또는 "shape:s10"(그 도형 모양으로 자르기)
 *    한 도형(예: 얼굴+귀+목이 한 덩어리인 피부)을 여러 부위로 나눌 때 같은 도형을 clip만 다르게 여러 번 쓴다.
 *  - pivot: 이 부위가 돌거나 눌릴 기준점 → data-pivot 으로 기록 (모션에서 사용)
 *  - maxRot: 이 부위를 돌려도 되는 최대 각도(도) → data-max-rot (character_check · SvgRig.pose 가 지킨다)
 *  - eye: { white:[…], pupil:[…], shine:[…], lash:[…] } — 눈 장치. 흰자는 흰자+눈동자+반짝임을 감싼 매끈한 볼록 도형으로
 *    새로 만들고(원래 흰자 도형은 대신 쓰임), 눈동자는 그 흰자 모양으로 clip. 놀라서 눈이 커지거나 눈동자가 움직여도 빈틈이 없다.
 *    → <g id="eye-l" data-eye="cx cy rx ry"><g id="eye-l-white">…</g><g id="pupil-l">clip…</g><g id="lash-l">…</g></g>
 *  - underhang: { x, top, bottom, width, fill? } — 관절 밑에 숨는 연장(예: 목 기둥을 얼굴 밑 머리 pivot까지 잇는 둥근 기둥).
 *    clip 밖, 이 부위의 맨 아래에 그린다. 정지 상태에서는 위 부위(얼굴)에 가려 안 보이고, 고개를 돌리면 빈틈 대신 드러난다.
 *  - follow: "head" — 이 부위의 clip은 제자리, 안의 그림은 head 와 같이 움직인다(SvgRig.pose가 같은 변환을 복사). 예: 턱 그늘.
 *  - absorbs: [도형 id] — 그리지 않고 쓰인 것으로 친다(눈 장치가 흰자 도형을 새 흰자로 바꿀 때처럼).
 * 결과: 각 <g id>에 data-part / data-label / data-pivot, 각 도형에 data-part. 태그 안 된 도형은 경고 + "untagged" 그룹.
 */
'use strict'
const fs = require('fs')

function clipD(spec, shapeMap) {
  const t = spec.trim().split(/\s+/)
  if (t[0] === 'ellipse') { const [cx, cy, rx, ry] = t.slice(1).map(Number); return { d: `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` } }
  if (t[0] === 'rect') { const [x, y, w, h] = t.slice(1).map(Number); return { d: `M${x} ${y}h${w}v${h}h${-w}Z` } }
  if (spec.startsWith('shape:')) { const s = shapeMap[spec.slice(6)]; if (!s) throw new Error('clip 도형 없음: ' + spec); return { d: s.d, tr: s.tr } }
  return { d: spec }
}

// ---------------------------------------------------------------- 눈 장치 (흰자 전체)
function convexHull(P) {
  P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], up = []
  for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}
const polyArea = (H) => Math.abs(H.reduce((a, p, i) => { const q = H[(i + 1) % H.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
const r2 = (v) => Math.round(v * 100) / 100

/** a closed, smooth path through the hull (Catmull-Rom → cubic Béziers), grown a little outward to cover anti-aliasing */
function smoothClosed(H, grow) {
  const cx = H.reduce((a, q) => a + q[0], 0) / H.length, cy = H.reduce((a, q) => a + q[1], 0) / H.length
  const G = H.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * grow, y + (y - cy) / d * grow] })
  const V = []
  for (const q of G) if (!V.length || Math.hypot(q[0] - V[V.length - 1][0], q[1] - V[V.length - 1][1]) > 2.5) V.push(q)
  const n = V.length
  let d = `M${r2(V[0][0])} ${r2(V[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = V[(i - 1 + n) % n], p1 = V[i], p2 = V[(i + 1) % n], p3 = V[(i + 2) % n]
    d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`
  }
  return d + 'Z'
}

/** union of the shapes as a mask, its outline points, area and centre */
async function maskInfo(shapeTags, w, h) {
  const { shapeMask } = require('./lib.cjs')
  const m = new Uint8Array(w * h)
  for (const t of shapeTags) { const k = await shapeMask(t, w, h); for (let i = 0; i < k.length; i++) if (k[i]) m[i] = 1 }
  const P = []
  let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (!m[i]) continue
    area++; sx += x + 0.5; sy += y + 0.5
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) P.push([x + 0.5, y + 0.5])
  }
  return { P, area, c: area ? [r2(sx / area), r2(sy / area)] : null, box: [x0, y0, x1 + 1, y1 + 1] }
}

/**
 * Expands the tag helpers that need the drawing itself (eye rigs) into plain tag nodes.
 * Returns the expanded tags and report lines.
 */
async function prepareTags(svgText, tags) {
  const vb = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const w = Math.round(+vb[1]), h = Math.round(+vb[2])
  const shapeTag = {}
  for (const tag of svgText.match(/<path id="s\d+"[^>]*\/>/g) || []) shapeTag[tag.match(/id="([^"]+)"/)[1]] = tag
  const report = []
  async function walk(n) {
    if (n.eye) {
      const e = n.eye, ids = (k) => (e[k] || []).filter((id) => { if (!shapeTag[id]) report.push(`경고: ${n.id} 의 ${k} 도형 ${id} 없음`); return !!shapeTag[id] })
      const white = ids('white'), pupil = ids('pupil'), shine = ids('shine'), lash = ids('lash')
      if (!white.length || !pupil.length) throw new Error(`${n.id}: 눈 장치에는 white와 pupil 도형이 필요해요.`)
      const all = await maskInfo([...white, ...pupil, ...shine].map((id) => shapeTag[id]), w, h)
      const H = convexHull(all.P)
      const hullD = smoothClosed(H, 0.7)
      const ratio = polyArea(H) / Math.max(1, all.area)
      if (ratio > 1.25) report.push(`경고: ${n.id} 흰자 모양이 많이 오목해요(볼록 껍질이 ${(ratio * 100 - 100).toFixed(0)}% 더 큼). 웃는 눈처럼 원래 오목한 눈이면 눈 장치 대신 직접 태그하세요.`)
      const [bx0, by0, bx1, by1] = all.box
      const cx = r2((bx0 + bx1) / 2), cy = r2((by0 + by1) / 2), rx = r2((bx1 - bx0) / 2), ry = r2((by1 - by0) / 2)
      const pup = await maskInfo(pupil.map((id) => shapeTag[id]), w, h)
      const side = (n.id.match(/^eye-(.+)$/) || [])[1]
      const name = (k) => (side ? `${k}-${side}` : `${n.id}-${k}`)
      const fill = (shapeTag[white[0]].match(/fill="([^"]+)"/) || [])[1] || '#FFFFFF'
      const children = [
        { id: side ? `eye-${side}-white` : `${n.id}-white`, label: '흰자', absorbs: white, shapes: [{ svg: `<path fill="${fill}" d="${hullD}"/>`, note: `흰자 전체 (흰자+눈동자 모양, 원래 ${white.join('+')})` }] },
        { id: name('pupil'), label: '눈동자', pivot: pup.c, shapes: [...pupil, ...shine], clip: hullD },
      ]
      if (lash.length) children.push({ id: name('lash'), label: '속눈썹', shapes: lash })
      const rest = (n.children || []).filter((c) => !children.some((x) => x.id === c.id))
      Object.assign(n, { pivot: n.pivot || [cx, cy], eyeGeo: [cx, cy, rx, ry], children: [...children, ...rest] })
      delete n.eye
      report.push(`${n.id}: 눈 장치 — 흰자 전체를 새로 만들고 눈동자를 그 안에 clip (중심 ${cx}, ${cy} · 반지름 ${rx}×${ry})`)
    }
    for (const c of n.children || []) await walk(c)
  }
  const out = JSON.parse(JSON.stringify(tags))
  for (const n of out.parts || []) await walk(n)
  return { tags: out, report }
}

function applyTags(svgText, tags) {
  const head = svgText.match(/<svg[^>]*>/)[0]
  const bg = (svgText.match(/<rect id="bg"[^>]*\/>/) || [''])[0]
  const shapeMap = {}
  for (const tag of svgText.match(/<path id="s\d+"[^>]*\/>/g) || []) {
    const id = tag.match(/id="([^"]+)"/)[1]
    shapeMap[id] = { tag, d: tag.match(/ d="([^"]+)"/)[1], tr: (tag.match(/transform="([^"]+)"/) || [])[1] }
  }
  const used = new Set(), defs = [], report = []
  let added = 0
  function node(n, pathIds, depth) {
    const pad = '  '.repeat(depth), part = pathIds.concat(n.id).join('/')
    const attrs = [`id="${n.id}"`, `data-part="${part}"`]
    if (n.label) attrs.push(`data-label="${n.label}"`)
    if (n.pivot) attrs.push(`data-pivot="${n.pivot.join(' ')}"`)
    if (n.maxRot != null) attrs.push(`data-max-rot="${n.maxRot}"`)
    if (n.eyeGeo) attrs.push(`data-eye="${n.eyeGeo.join(' ')}"`)
    if (n.follow && !n.clip) attrs.push(`data-follow="${n.follow}"`)
    for (const id of n.absorbs || []) { if (shapeMap[id]) used.add(id); else report.push(`경고: ${n.id} 가 대신하는 도형 ${id} 없음`) }
    let inner = ''
    for (const s of n.shapes || []) {
      if (typeof s === 'object') { inner += `${pad}  ${s.svg.replace(/^<(\w+)/, `<$1 data-part="${part}" data-added="${s.note || 'AI 추가'}"`)}\n`; added++; continue }
      const sh = shapeMap[s]; if (!sh) { report.push(`경고: ${n.id} 의 도형 ${s} 없음`); continue }
      const dup = used.has(s); used.add(s)
      const t = sh.tag.replace(/id="s\d+"/, `id="${dup || n.clip ? s + '-' + n.id : s}"`).replace('<path ', `<path data-part="${part}" `)
      inner += `${pad}  ${t}\n`
    }
    for (const c of n.children || []) inner += node(c, pathIds.concat(n.id), depth + 1)
    if (n.clip) {
      const c = clipD(n.clip, shapeMap), cid = 'clip-' + n.id
      defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${c.d}"${c.tr ? ` transform="${c.tr}"` : ''}/></clipPath>`)
      // 바깥 <g>를 움직이면 잘린 영역째, data-role="content"를 움직이면 잘린 영역 안에서만 움직인다 (예: 흰자 안의 눈동자)
      inner = `${pad}  <g clip-path="url(#${cid})"><g data-role="content"${n.follow ? ` data-follow="${n.follow}"` : ''}>\n${inner}${pad}  </g></g>\n`
    }
    if (n.underhang) {
      // hidden under the part above at rest; a turning joint uncovers this instead of a gap
      const u = n.underhang, r = u.width / 2
      const firstShape = (n.shapes || []).find((x) => typeof x === 'string' && shapeMap[x])
      const fill = u.fill || (firstShape ? (shapeMap[firstShape].tag.match(/fill="([^"]+)"/) || [])[1] : '#000')
      inner = `${pad}  <path data-part="${part}" data-added="under-hang" fill="${fill}" d="M${r2(u.x - r)} ${r2(u.bottom)} V${r2(u.top)} A${r2(r)} ${r2(r)} 0 0 1 ${r2(u.x + r)} ${r2(u.top)} V${r2(u.bottom)} Z"/>\n${inner}`
      added++
    }
    return `${pad}<g ${attrs.join(' ')}>\n${inner}${pad}</g>\n`
  }
  let body = ''
  for (const n of tags.parts) body += node(n, [], 1)
  const missing = Object.keys(shapeMap).filter(id => !used.has(id))
  if (missing.length) {
    report.push('태그 안 된 도형: ' + missing.join(', '))
    body += `  <g id="untagged" data-part="untagged">\n${missing.map(id => '    ' + shapeMap[id].tag).join('\n')}\n  </g>\n`
  }
  report.unshift(`도형 ${Object.keys(shapeMap).length}개 중 ${used.size}개 태그, AI 추가 도형 ${added}개, 잘라 쓴 영역 ${defs.length}개`)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- tag.js: 파츠 태그 적용. <g data-part="경로" data-label="이름" data-pivot="x y">. data-added = 원본에 없던(가려졌던) 부분을 AI가 채운 도형 -->
${head}
<defs>
${defs.join('\n')}
</defs>
${bg ? bg + '\n' : ''}<g id="character">
${body}</g>
</svg>
`
  return { svg, report }
}

async function diffRender(a, b, w, h) {
  const sharp = require('sharp')
  const r = async s => (await sharp(Buffer.from(s)).flatten({ background: '#808080' }).raw().toBuffer())
  const A = await r(a), B = await r(b); let bad = 0
  for (let i = 0; i < w * h; i++) if (Math.abs(A[i * 3] - B[i * 3]) + Math.abs(A[i * 3 + 1] - B[i * 3 + 1]) + Math.abs(A[i * 3 + 2] - B[i * 3 + 2]) > 60) bad++
  return bad / (w * h) * 100
}

module.exports = { applyTags, prepareTags, diffRender, convexHull, smoothClosed }

if (require.main === module) (async () => {
  const [src, tagFile, out] = process.argv.slice(2)
  if (!out) { console.error('사용법: node tag.js <img2svg 결과.svg> <태그.json> <출력.svg>'); process.exit(1) }
  const svgText = fs.readFileSync(src, 'utf8'), tags = JSON.parse(fs.readFileSync(tagFile, 'utf8'))
  const prep = await prepareTags(svgText, tags)
  const r = applyTags(svgText, prep.tags)
  r.report.push(...prep.report)
  fs.writeFileSync(out, r.svg)
  const vb = svgText.match(/viewBox="0 0 (\d+) (\d+)"/)
  diffRender(svgText, r.svg, +vb[1], +vb[2]).then(p => {
    r.report.forEach(l => console.log(l))
    console.log(`원본 SVG와 다른 픽셀 ${p.toFixed(2)}% (AI 추가 도형이 보이는 곳만 달라야 정상)`)
  })
})()
