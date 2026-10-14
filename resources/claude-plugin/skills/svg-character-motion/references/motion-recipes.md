# 연기 레시피 + 코드 조각

예시 전체 코드: `example-man-motion.html`(연기) + `example-man-extra-shapes.js`(표정 도형 추가 — 모션스튜디오에서는 character_embed의 extra_svg / extra_defs로 넣는다). 좌표는 예시 남자(1254×1254) 기준.

## 기본 뼈대

```js
var host = document.getElementById('host')            // data-ms-id 부여 권장
function tr(x, y) { return 'translate(' + x + ' ' + y + ')' }
function rot(a, x, y) { return 'rotate(' + a + ' ' + x + ' ' + y + ')' }
function sc(x, y, sx, sy) { return 'translate(' + x + ' ' + y + ') scale(' + sx + ' ' + sy + ') translate(' + (-x) + ' ' + (-y) + ')' }
function content(id) { return document.querySelector('#' + id + ' [data-role="content"]') }   // clip 안쪽

SvgRig.add(host, { lid: 0, tilt: 0, sq: 0, 'look-x': 0 /* … */ }, function (P, t) {
  $('head').setAttribute('transform', tr(0, P['head-y']) + ' ' + rot(P.tilt, 638, 880) + ' ' + sc(638, 880, 1 + P.sq * 0.7, 1 - P.sq))
  content('pupil-l').setAttribute('transform', tr(P['look-x'] * 16, P['look-y'] * 14))
  // …
})
var tl = gsap.timeline({ paused: true })
function at(t, vars, dur, ez) {                       // CSS 변수 트윈
  var o = { duration: dur, ease: ez || 'power2.inOut' }; for (var k in vars) o['--' + k] = vars[k]; tl.to(host, o, t)
}
window.__timelines = { main: SvgRig.attach(tl) }
```

## 눈꺼풀 (게슴츠레·깜빡임·슬픈 눈)

눈 그룹 맨 위에 `<g clip-path="흰자보다 조금 큰 원"><path 피부면/><path 눈꺼풀 선 stroke=진한색 width=13/></g>`.

```js
// E = { cx, rx, top: 윗눈선 위, bot: 흰자 아래, outer: -1(L) | 1(R) }
var y = lerp(E.top, E.bot, lid), tl = P['lid-tilt'] * 20                  // tilt>0 = 바깥쪽 처짐(졸림·비웃음·슬픔)
var xo = E.cx + E.outer * (E.rx + 14), xi = E.cx - E.outer * (E.rx + 14)
var yo = y + tl, yi = y - tl                                                 // xa<xb 로 정렬해서 사용
var yc = (ya + yb) / 2 + 28 * (1 - Math.abs(lid - 0.5))                     // 눈알을 따라 아래로 볼록
skin.d = 'M'+(xa-40)+' '+(E.top-90)+'H'+(xb+40)+'V'+yb+'L'+xb+' '+yb+'Q'+E.cx+' '+yc+' '+xa+' '+ya+'L'+(xa-40)+' '+ya+'Z'
line.d = 'M'+xa+' '+ya+'Q'+E.cx+' '+yc+' '+xb+' '+yb;  line.opacity = clamp(lid * 7, 0, 1)
```
lid: 0 뜸 · 0.22 슬픔 · 0.5 게슴츠레 · 0.75 움츠림 · 1 감음

## 표정 도형 교체

```js
var w = P['m-o']                                                  // 0→1 트윈
$('mouth').setAttribute('opacity', Math.max(wo, ww, wl) < 0.5 ? 1 : 0)   // 원본 입
$('mouth-o').setAttribute('opacity', w >= 0.5 ? 1 : 0)
$('mouth-o').setAttribute('transform', sc(658, 745, 0.55 + 0.45 * w, 0.55 + 0.45 * w))
```
연속 교체(O → 떨리는 입)는 앞 것이 0.5 아래로 내려가는 시점과 뒤 것이 0.5를 넘는 시점을 1~2프레임 차이로 맞춘다.

## 흐느낌 (자동 반복)

```js
var ph = Math.sin(t * 2 * Math.PI / 0.46), up = P.sob * Math.max(0, ph)
$('body').setAttribute('transform', sc(638, 1254, 1, 1 + 0.03 * (P.shrug + 0.8 * up)))   // 몸은 아래 기준 세로 늘림만
var lift = -11.2 * (P.shrug + 0.8 * up)                                                   // (1254-880)·0.03 → 머리도 같이 올림
// 우는 입: sc(658, 720, sl*(1+0.04*ph*sob), sl*(1+0.16*ph*sob)), 머리카락: sob*3*sin(phase-0.9) 늦게
```

## 눈물

```js
// 줄기: <path pathLength="1" stroke="#8FD8FF" stroke-width="26"> + 흰 하이라이트 선(7px)
var w1 = 6 * Math.sin(t * 11)
d = 'M468 676 C' + (448 + w1) + ' 740 ' + (476 - w1) + ' 800 ' + (446 + w1 / 2) + ' 900'
path.setAttribute('stroke-dasharray', tears + ' 1')                       // tears 0→1 = 흘러내림
// 방울: 결정적 포물선 반복
var p = ((t * 1.7 + i * 0.137) % 1 + 1) % 1, side = i % 2 ? 1 : -1
x = (side < 0 ? 430 : 870) + side * (60 + 150 * p + 25 * (i % 3)); y = 590 - 150 * p + 330 * p * p
// 고임: 흰자 clip 안 하늘색 타원(아래쪽) + 흰 점, 눈동자 content 안에 반짝임 원 하나 추가
```

## 레시피 (시간은 시작 기준, 괄호는 길이)

**깜빡임** — lid 1 (0.07, power2.in) → 원래 값 (0.12, power2.out). 2.5~4초마다, 스냅 동작 순간과 겹치지 않게.

**게슴츠레 비아냥** — 0.55초 power2.out에 한 번에:
lid 0.5, lid-tilt 0.2, look-x 0.9(곁눈질), look-y 0.15, 한쪽 눈썹 −20px·+5°, 반대쪽 +6px·−5°, 입 비틀기(smirk 1), tilt −4, turn −0.2, 턱 들기(head-y −4)
→ **피식** ×3: shrug 0.5→0 (0.1 + 0.15), head-y −8↔−4, smirk 1.25↔1
→ **눈 굴리기**: lid 0.3·look-y −1 (0.22) → look-x 0.6→−0.9 (0.45, sine) + 고개 tilt 3 → 원위치 (0.35) → 느린 깜빡임

**놀람** — 움츠림 0.15초(sq 0.06, head-y +6, lid 0.75, 눈썹 내림) →
스냅 0.12초 power3.out(sq −0.08, head-y −14, lid 0, eye-big 1, pupil 1(작게), 눈썹 −36, O 입, shrug 1) →
sq elastic.out(1,0.4) 0.6 정착, 머리카락 +12 → elastic 0.9, 동공 떨림 0.8초, 식은땀 1.1초 흘러내림

**울먹** — 0.5초: brow-sad 1, lid 0.22·lid-tilt 0.55(바깥 처짐), pupil −0.6(크게), eye-big 0.3, head-y +6, 홍조 0.5 →
떨리는 입 교체, 눈물 고임 0.9초 → **훌쩍** shrug 0.6 (0.08) → 0 (0.25) ×2 → 터지기 직전 움츠림(sq 0.05, head-y +12, squeeze 0.4)

**오열** — 0.14초 power3.out: `><` 교체(squeeze 1), 우는 입 교체, sq −0.06, head-y −8(고개 젖힘), 고임 0, 홍조 1 →
눈물 줄기 0.4초, sob 1·물방울 on, 머리카락 −10 → elastic → 고개 좌우 tilt ±5 (1초 sine) 반복

**웃음** — happy(^^ 교체) 1 + 웃는 입 교체 + 볼터치, 눈썹 −10 → 하하하 ×6: head-y +4/−6 (0.12+0.16), 몸 +4, 입 벌림 ±0.4, 끈·머리카락 따라 흔들림

**윙크** — 한쪽만 blink-l 1 (0.08) + 그쪽 눈썹 +8 → 0.45초 유지 → 원위치

**끄덕끄덕** — head-y +12, sq 0.03, 머리카락 −6 (0.14, power2.in) → 0 (0.18, power2.out) ×2

**갸웃** — tilt 8, turn 0.25, 몸 x +5 (0.45) + 머리카락 반대로 −3 → elastic
