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
      inner = `${pad}  <g clip-path="url(#${cid})"><g data-role="content">\n${inner}${pad}  </g></g>\n`
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

module.exports = { applyTags, diffRender }

if (require.main === module) {
  const [src, tagFile, out] = process.argv.slice(2)
  if (!out) { console.error('사용법: node tag.js <img2svg 결과.svg> <태그.json> <출력.svg>'); process.exit(1) }
  const svgText = fs.readFileSync(src, 'utf8'), tags = JSON.parse(fs.readFileSync(tagFile, 'utf8'))
  const r = applyTags(svgText, tags)
  fs.writeFileSync(out, r.svg)
  const vb = svgText.match(/viewBox="0 0 (\d+) (\d+)"/)
  diffRender(svgText, r.svg, +vb[1], +vb[2]).then(p => {
    r.report.forEach(l => console.log(l))
    console.log(`원본 SVG와 다른 픽셀 ${p.toFixed(2)}% (AI 추가 도형이 보이는 곳만 달라야 정상)`)
  })
}
