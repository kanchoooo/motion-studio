// build.js — 태그된 SVG(../man/tagged.svg)에 표정 교체용 도형을 끼워 넣고 모션 컴포지션(index.html)을 만든다. 실행: node build.js.
// 원본에 없는 표정 도형만 코드로 추가: 눈꺼풀(+눈꺼풀 선), 눈물 고임·반짝임, 눈물 줄기·방울, 땀, 볼 홍조, O 입, 떨리는 입, 우는 입, >< 눈.
const fs = require('fs'), path = require('path')
const HERE = __dirname
let svg = fs.readFileSync(path.join(HERE, '../man/tagged.svg'), 'utf8')
svg = svg.slice(svg.indexOf('<defs>'), svg.lastIndexOf('</svg>'))
svg = svg.replace(/<rect id="bg"[^>]*\/>/, '<rect id="bg" x="-488" y="0" width="2230" height="1254" fill="#FA3C3F"/>')

const SKIN = '#FBA46D', DARK = '#261617', LIP = '#4C2727', TEAR = '#8FD8FF', TONGUE = '#E2735A'
const s10 = svg.match(/<path[^>]*id="s10"[^>]*\/>/)[0].match(/ d="([^"]+)"/)[1]
const WAIL = 'M590 772 C600 698 716 698 726 772 C700 794 616 794 590 772 Z'
const defs = `
<clipPath id="lidclip-l" clipPathUnits="userSpaceOnUse"><ellipse cx="512" cy="595" rx="104" ry="104"/></clipPath>
<clipPath id="lidclip-r" clipPathUnits="userSpaceOnUse"><ellipse cx="778.5" cy="598.5" rx="98" ry="102"/></clipPath>
<clipPath id="pool-l-clip" clipPathUnits="userSpaceOnUse"><ellipse cx="512" cy="595" rx="92.5" ry="90.5"/></clipPath>
<clipPath id="pool-r-clip" clipPathUnits="userSpaceOnUse"><path d="${s10}"/></clipPath>
<clipPath id="clip-o" clipPathUnits="userSpaceOnUse"><ellipse cx="658" cy="745" rx="30" ry="38"/></clipPath>
<clipPath id="clip-wail" clipPathUnits="userSpaceOnUse"><path d="${WAIL}"/></clipPath>`
svg = svg.replace('</defs>', defs + '\n</defs>')

const lid = s => `<g id="lid-${s}" clip-path="url(#lidclip-${s})"><path id="lid-${s}-skin" fill="${SKIN}" d=""/><path id="lid-${s}-line" fill="none" stroke="${DARK}" stroke-width="13" stroke-linecap="round" d=""/></g>`
const pool = s => `<g id="pool-${s}" opacity="0" clip-path="url(#pool-${s}-clip)"><ellipse id="pool-${s}-water" cx="${s === 'l' ? 512 : 778.5}" cy="672" rx="96" ry="36" fill="${TEAR}"/><ellipse cx="${s === 'l' ? 480 : 748}" cy="662" rx="16" ry="6" fill="#fff" opacity="0.8"/></g>`
// 눈 그룹 안: 눈동자 위에 눈물 고임, 맨 위에 눈꺼풀
for (const s of ['l', 'r']) {
  const re = new RegExp(`(<g id="lash-${s}"[\\s\\S]*?</g>\\n)`)
  if (!re.test(svg)) throw new Error('lash-' + s)
  svg = svg.replace(re, (m) => pool(s) + '\n' + m + lid(s) + '\n')
}
// 눈동자 반짝임(울먹일 때) — 눈동자 content 안에 넣어 같이 움직임
svg = svg.replace(/(<g id="pupil-l"[\s\S]*?<g data-role="content">)/, `$1<circle class="spark" cx="582" cy="632" r="11" fill="#fff" opacity="0"/>`)
svg = svg.replace(/(<g id="pupil-r"[\s\S]*?<g data-role="content">)/, `$1<circle class="spark" cx="831" cy="630" r="11" fill="#fff" opacity="0"/>`)
// 순서 주의: 반짝임은 눈동자 path 뒤에 와야 보이므로 path 다음으로 옮긴다
svg = svg.replace(/(<circle class="spark"[^>]*\/>)(\s*<path[^>]*\/>)/g, '$2$1')

// 볼 홍조: 눈 아래
svg = svg.replace('<g id="eye-l"', `<g id="flush" opacity="0" fill="#F2665A"><ellipse cx="452" cy="742" rx="52" ry="26"/><ellipse cx="838" cy="744" rx="50" ry="25"/></g>\n<g id="eye-l"`)
// 머리 맨 위: >< 눈, 입 3종, 눈물 줄기·방울, 땀
const extras = `
<g id="cross-l" opacity="0"><path d="M468 556 L556 600 L468 644" fill="none" stroke="${DARK}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="cross-r" opacity="0"><path d="M822 556 L734 600 L822 644" fill="none" stroke="${DARK}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="mouth-o" opacity="0"><ellipse cx="658" cy="745" rx="30" ry="38" fill="${LIP}"/><g clip-path="url(#clip-o)"><ellipse cx="658" cy="778" rx="20" ry="12" fill="${TONGUE}"/></g></g>
<g id="mouth-wave" opacity="0"><path id="mouth-wave-path" d="" fill="none" stroke="${LIP}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="mouth-wail" opacity="0"><path d="${WAIL}" fill="${LIP}"/><g clip-path="url(#clip-wail)"><ellipse cx="658" cy="792" rx="44" ry="24" fill="${TONGUE}"/></g></g>
<g id="tears" opacity="0" fill="none" stroke-linecap="round">
  <path id="tear-l" pathLength="1" stroke="${TEAR}" stroke-width="26" d=""/><path id="tear-l2" pathLength="1" stroke="#ffffff" stroke-opacity="0.65" stroke-width="7" d=""/>
  <path id="tear-r" pathLength="1" stroke="${TEAR}" stroke-width="26" d=""/><path id="tear-r2" pathLength="1" stroke="#ffffff" stroke-opacity="0.65" stroke-width="7" d=""/>
</g>
<g id="drops" fill="${TEAR}">${Array.from({ length: 12 }, (_, i) => `<ellipse class="drop" rx="10" ry="13" cx="0" cy="0" opacity="0"/>`).join('')}</g>
<g id="sweat" opacity="0"><path d="M0 -34 C10 -14 18 -2 18 10 C18 22 9 30 0 30 C-9 30 -18 22 -18 10 C-18 -2 -10 -14 0 -34 Z" fill="${TEAR}"/><ellipse cx="-6" cy="12" rx="4" ry="7" fill="#fff" opacity="0.8"/></g>`
svg = svg.replace(/(<g id="mouth"[\s\S]*?<\/g>\n)(\s*<\/g>\n<\/g>\s*)$/, (m, a, b) => a + extras + '\n' + b)
for (const id of ['cross-l', 'mouth-wail', 'tears', 'sweat', 'flush', 'lid-l', 'pool-r']) if (!svg.includes(`id="${id}"`)) throw new Error('missing ' + id)

const html = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8').replace('/*SVG*/', svg)

fs.writeFileSync(path.join(HERE, 'index.html'), html)
console.log('ok')
