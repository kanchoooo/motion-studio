---
name: svg-character-motion
description: >
  소재 탭에서 생성·자동 변환된 캐릭터 SVG(vector.svg)로 캐릭터 연기 모션을 만들 때 사용.
  원본 이미지와 SVG 도형 낱장을 비교해 파츠 태그(tags.json)를 쓰고 tag.js로 부위별 계층 SVG(tagged.svg)를 만든 뒤,
  부위 그룹을 움직이고 원본에 없는 표정 도형(눈꺼풀, ><, O입, 우는 입, 눈물 등)을 추가해 깜빡임·비웃음·놀람·웃음·울음 같은 연기를 만든다.
  Use when a brief or composition uses a character asset that has vector.svg (flat, outline-less style).
---

# svg-character-motion

변환 직후 SVG는 **색 덩어리 단위**다(예: 얼굴·귀·목이 한 도형). 그대로 움직이면 제대로 된 연기가 안 나온다.
반드시 **① 태깅 → ② 모션** 순서로 한다.

## 0. 입력 (모션스튜디오)

소재 폴더는 get_brief의 assets[].character.folder (예: `assets/gen-ab12cd34`). `character_info(asset)`가 읽을 파일을 알려 준다.
- `source.png`(원본), `vector.svg`(도형 `s01…`, 그리는 순서), `vector_shapes.json`(id·색·bbox·보이는 면적), `vector_shapes.png`(도형 낱장, id 표기)
- 이 폴더는 앱이 관리한다: 직접 쓰지 말고 도구(character_tag, character_embed)로만 바꾼다.
- 예시(남자 1254×1254): `references/example-man-tags.json`(태그), `references/example-man-extra-shapes.js`(표정 도형 추가), `references/example-man-motion.html`(연기 코드)

## 1. 파츠 태깅

### 1-1. 보기
`source.png` 와 `vector_shapes.png` 를 **이미지로 열어** 비교한다. `vector_shapes.json` 의 bbox로 위치를 맞춘다.
경계가 애매하면(귀와 얼굴, 턱과 목) 원본을 확대하고 좌표 격자를 얹어 본다.

### 1-2. tags.json 형식
```json
{ "parts": [                                   // 그리는 순서: 아래 → 위
  { "id": "body", "label": "몸", "pivot": [638, 1254], "maxRot": 3, "children": [
    { "id": "neck-skin", "label": "목", "shapes": ["s01"], "clip": "rect 551 840 175 414",
      "underhang": { "x": 638.5, "top": 790, "bottom": 905, "width": 175 } },
    { "id": "shirt", "label": "터틀넥", "shapes": ["s05"] },
    { "id": "neck-shadow", "label": "턱 그늘", "shapes": ["s13"], "clip": "rect 551 840 175 414", "follow": "head" } ] },
  { "id": "head", "label": "머리", "pivot": [638, 790], "maxRot": 8, "children": [
    { "id": "hair-back", "label": "두피 채움", "shapes": [{ "svg": "<ellipse cx=\"615\" cy=\"300\" rx=\"265\" ry=\"160\" fill=\"#261617\"/>", "note": "머리카락이 움직여도 빈틈 없게" }] },
    { "id": "face", "label": "얼굴", "shapes": ["s01"], "clip": "M0 0 H1254 V555 … 턱선을 따라 … Z" },
    { "id": "eye-l", "label": "눈 L", "eye": { "white": ["s09"], "pupil": ["s16"], "lash": ["s24"] } },
    { "id": "eye-r", "label": "눈 R", "eye": { "white": ["s10"], "pupil": ["s17"], "lash": ["s25"] } } ] } ] }
```
- `shapes`: 도형 id, 또는 `{ "svg": … }` (AI가 추가하는 도형 — 가려졌던 부분 채우기)
- `clip`: path d / `"ellipse cx cy rx ry"` / `"rect x y w h"` / `"shape:s10"` — 같은 도형을 clip만 달리해 여러 부위에 쓸 수 있다
- `pivot`: 회전·눌림 기준점 → `data-pivot`. `maxRot`: 이 부위를 돌려도 되는 최대 각도 → `data-max-rot` (SvgRig.pose가 지킨다)
- **`eye`**: 눈 장치. 흰자·눈동자·반짝임(shine)·속눈썹(lash) 도형 id만 적으면 도구가 **흰자+눈동자를 감싼 매끈한 흰자 전체**를 새로 만들고(원래 흰자 도형은 대신 쓰임), 눈동자를 그 흰자 모양으로 clip한다. `data-eye="cx cy rx ry"`가 붙는다.
- **`underhang`**: 관절 밑에 숨는 연장. `{x, top, bottom, width}` 의 둥근 기둥을 이 부위 맨 아래(clip 밖)에 그린다. 목이면 x = 목 중심, width = 목 기둥 폭, top = 머리 pivot의 y, bottom = 보이는 목 안쪽(옷깃 위). 정지 상태에서는 얼굴에 가려 안 보이고, 고개를 돌리면 틈 대신 목이 이어져 보인다.
- **`follow`**: `"head"` — 이 부위의 clip은 제자리, 안의 그림은 head와 같이 움직인다(턱 그늘처럼 머리가 드리우는 그늘).
- 전체 예시: `references/example-man-tags.json`

### 1-3. 규칙
1. **모든 도형을 태그한다.** 빠지면 tag.js가 경고하고 `untagged` 그룹에 넣는다.
2. **레이어 순서는 아래 표를 따른다.** 정지 상태에서 서로 겹치는 도형끼리만 원래 순서(s번호)가 중요하고, 맞닿기만 하는 도형은 표대로 둔다. s번호는 크기순일 뿐 앞뒤 관계가 아니다(예: 발 도형이 바지보다 번호가 뒤여도 발은 바지 **밑**).

   | 관절 | 뒤 → 앞 | 숨은 연장(underhang)이 있는 곳 | pivot |
   |---|---|---|---|
   | 머리 / 목 | 몸 → 목 + 연장 → 턱 그늘(follow head, 목 안으로 clip) → 옷깃·후드 앞 → 머리 | 목 | 목 중심선, 턱보다 목 폭의 절반 이상 **위**(귓불 높이) — 머리 안쪽 |
   | 손 / 소매 | 손 + 손목 연장 → 소매 | 손 | 소매 끝 안쪽의 손목 중심 |
   | 발 / 바지 | 발 + 발목 연장 → 바지 | 발 | 바지 끝단 안쪽의 발목 중심 |
   | 팔 / 몸통 | 팔 뒤쪽은 몸 뒤, 앞으로 오는 팔은 몸 앞 | 어깨 | 어깨 관절 |
   | 눈 | 흰자 전체 → 눈동자(clip) → 속눈썹 → 눈썹 | — | 흰자 중심 |
   | 머리카락 | 두피 채움 → 얼굴 → 앞머리 | 두피 채움 | 정수리 아래 |
3. **피부 한 덩어리 나누기**(clip):
   - 귀: 귀 원 전체를 담는 rect. 얼굴 clip은 귀 자리만 (살짝 곡선으로) 파낸다.
   - **얼굴은 턱선을 따라 자른다** (보통 턱 그늘의 윗변, 없으면 양쪽 턱–목 모서리를 잇는 곡선). 한 색 도형을 **보이는 윤곽에서 끝나는 직선으로 자르지 않는다** — 고개를 돌리면 계단·각이 생긴다(실제로 겪은 문제: `rect 0 0 1254 228` 로 자른 얼굴의 턱 끝이 몸에 남음).
   - **목 기둥 rect는 얼굴을 파낸 턱 아래 폭과 같게**, 그리고 반드시 `underhang` 을 단다. 목 기둥 밖에서는 얼굴 clip이 턱 바로 아래까지만.
4. **눈은 항상 `eye` 장치로 만든다.** 흰자가 초승달이든 온전하든 마찬가지 — 놀라서 커지거나 눈동자가 움직여도 흰자가 찢어지지 않는다. 표정 때문에 눈을 **새로 그리지 않는다**(원래 색·모양이 바뀌어 눈이 달라 보인다). 웃는 눈처럼 원래 오목한 눈만 직접 태그한다(도구가 경고한다).
5. **두피·숨은 부분 채우기**: 머리카락 실루엣 **안쪽**의 머리색 타원을 얼굴 뒤에(`{svg}`), 머리카락 사이 홈으로 삐져나오지 않게 작게.
6. **pivot은 움직이는 부위 안쪽**: head = 위 표, eye = 흰자 중심(장치가 정함), pupil = 눈동자 중심, brow/nose/mouth = 도형 중심, ear = 얼굴과 붙는 지점, hair = 정수리 아래, body = 화면 아래 중앙, 손·발 = 소매·바지 끝단 안쪽.
7. 얇은 띠·작은 조각도 **지우기 전에 원본에서 확인** — 두 부위 사이 틈을 메우는 띠일 수 있다.

### 1-4. 표준 id (L/R = 화면 기준)
`body` `neck-skin` `neck-shadow` `neck-front` `shirt` `jacket-*` `sleeve-l/r` `pocket-square` ·
`head` `hair-back` `hair`(`hair-main` `hair-side` `hair-shine`) `ear-l/r` `face` ·
`eye-l/r`(`eye-l-white` `pupil-l` `lash-l`) `brow-l/r` `nose` `mouth` — 필요하면 `cheek` `hat` `accessory-*` 추가
상반신·전신: `arm-l/r`(`upper-arm` `forearm`) `hand-l/r` `leg-l/r` `foot-l/r` — 팔 pivot = 어깨, 다리 pivot = 엉덩이 관절.
소매가 몸통 옷과 같은 색이라 한 도형이면 어깨에서 clip으로 나눈다. (팔·다리 모션은 아직 검증 전)

### 1-5. 적용·검증
`character_tag(asset, tags)` — tags.json·tagged.svg를 소재 폴더에 쓰고 보고서와 원본 대비 차이(%)를 돌려준다.
그다음 **`character_check(asset)`** — 움직이는 부위를 최대 각도(머리 8°, 손·발·팔·다리 12°, 몸 3°, 머리카락 6°, 또는 maxRot)로 양쪽으로 돌려 보고
관절의 틈(빨강)과 같은 색이 드러난 곳(자홍), 눈 장치 여부를 `check_sheet.png` 로 보여 준다. **Read로 시트를 보고 `ok: true` 가 될 때까지 태그를 고친다**
(눈 → eye 장치 / 턱 계단·턱 끝이 남음 → 턱선 clip + 목 underhang / 손·발 끝단 틈 → 레이어 순서(발은 바지 밑) + 발목 underhang + pivot을 끝단 안쪽으로).
자홍은 목이 이어져 보이는 것이면 괜찮고, 턱 끝·얼굴 모서리가 떨어져 남은 것이면 고친다.
- `도형 N개 중 N개 태그` 확인
- `원본 SVG와 다른 픽셀` **0.1% 이하** — AI 추가 도형은 정지 상태에서 안 보여야 한다. 넘으면 두 SVG를 렌더해 차이 위치를 보고 고친다.
  흔한 원인: 얼굴 clip이 옷 아래 피부를 끌어올림 / 채움 도형이 밖으로 삐져나옴 / 그리는 순서가 바뀜.
- clip된 부위는 `<g id><g clip-path><g data-role="content">` 구조 → **바깥 g를 움직이면 잘린 영역째, content를 움직이면 잘린 영역 안에서만**(눈동자).

## 2. 모션

### 2-1. 컴포지션 구조
- index.html에 호스트 요소를 먼저 만든다: `<div data-ms-id="char" data-ms-type="group" data-ms-label="캐릭터" style="position:absolute; …크기·위치…"></div>`
- `character_embed(asset, element_id: "char", view_box?, extra_defs?, extra_svg?)` 가 tagged.svg를 그 안에 인라인으로 넣는다(다시 부르면 교체).
  - 표정 도형(눈꺼풀, ><, O 입, 우는 입, 눈물, 홍조, 땀 …)은 `extra_svg`(그림 맨 위) / `extra_defs`(clipPath 등)로 함께 넣는다. 특정 그룹 안에 넣어야 하는 도형(눈동자 반짝임 등)은 삽입된 SVG를 Edit로 고친다.
  - 16:9로 쓸 때는 view_box 가로를 늘리고 배경도 같이 늘린다 (예: 1254×1254 → `"-487.7 0 2229.3 1254"`; 배경 rect는 Edit로 `x=-488 width=2230`). 배경을 영상 배경과 합치려면 `#bg` 를 숨겨도 된다.
- `<script src="ms/runtime.js"></script>` 바로 다음에 `<script src="ms/svgrig.js"></script>` 를 넣는다.
- 연기 값은 **호스트 요소의 CSS 변수**(`--lid`, `--tilt`, `--m-o` …). GSAP으로 트윈하고 `render(P, t)` 에서 매 프레임 transform을 계산
  (`SvgRig.add(host, 기본값, render)` + `window.__timelines['main'] = SvgRig.attach(tl)`, `ms/svgrig.js`). 호스트에 `data-ms-id` 가 있어서 디자이너가 트윈을 수정할 수 있다.
- 결정적으로: `Math.random` 금지. 반복 동작(흐느낌, 떨림, 물방울)은 시간 `t` 의 함수(sin, 결정적 noise)로.
- **같은 변수의 트윈이 시간상 겹치지 않게** 배치한다(탄성 정착 시간까지 계산).

### 2-2. 부위 움직임
| 부위 | 방법 |
|---|---|
| 머리 | `SvgRig.pose(svg, 'head', {rot: tilt, sx: 1+0.7sq, sy: 1−sq, y: lift})` — pivot·최대 각도(data-max-rot)·턱 그늘 follow를 알아서 지킨다 |
| 고개 돌림(2.5D) | 이목구비 그룹 +18·turn px, 귀 −10·turn, 머리카락 +8·turn |
| 머리카락 | `#hair`: 머리보다 0.05~0.1초 늦게 반대로 → `elastic.out` 정착 (follow-through) |
| 눈 | `SvgRig.eyeRig(svg, 'eye-l', {scale, lookX, lookY, pupil})` — 놀람 scale 1.25 + pupil 0.75, 울먹 pupil 1.15, 곁눈질 lookX ±1. 떨림 = lookX에 sin(t·61)·0.1 |
| 눈썹 | 개별 이동·회전. 비웃음 = 한쪽만 올림 / 놀람 = 둘 다 크게 / 슬픔 = 안쪽 끝 올림(L −15°, R +15°) |
| 입 | 원본 입은 기울이기·크기만(비웃음 = −9° 회전 + 폭 줄임). 다른 입 모양은 추가 도형으로 교체 |
| 몸 | `#body`: 화면 아래 중앙 기준 `scaleY(1+0.03·shrug)` 로 어깨 들썩. **아래가 화면에 잘린 몸은 위로 이동 금지**(아래 끝이 드러남). 머리는 그만큼 같이 올린다 |

### 2-3. 원본에 없는 표정 → 도형 추가 (색은 원본 팔레트에서)
| 표정 | 도형 |
|---|---|
| 게슴츠레·졸림·슬픈 눈 | **눈꺼풀**: 피부색 면 + 진한 눈꺼풀 선. 흰자보다 조금 큰 원으로 clip, 높이(lid 0~1)와 기울기(바깥 처짐)로 조절 |
| 깜빡임·감은 눈 | 눈꺼풀 lid=1 (또는 감은 눈 곡선으로 교체) |
| 질끈 감음(오열) | `><` 굵은 선 — 0.5에서 눈 그룹과 교체 |
| 웃는 눈 | `^ ^` 굵은 곡선 |
| 놀람 입 / 떨리는 입 / 우는 입 | O 타원(+혀) / 지그재그 선(떨림 노이즈) / 위가 둥근 벌린 입(+혀, 흐느낌에 맞춰 벌어짐) |
| 눈물 | 고임(흰자 안에 clip된 하늘색 띠 + 반짝임), 줄기(`pathLength=1` + `stroke-dasharray` 로 흘러내림), 튀는 방울 |
| 기타 | 볼 홍조(반투명 타원), 식은땀 방울 |

**교체 방식**: 가중치 0→1 트윈, **0.5에서 보이는 도형을 바꾸고** 크기(0.55→1)로 이어준다. 같은 자리의 도형은 한 번에 하나만.

### 2-4. 연기 레시피
`references/motion-recipes.md` — 비아냥(게슴츠레·곁눈질·피식·눈 굴리기), 놀람, 울먹, 오열, 깜빡임, 웃음, 윙크, 끄덕임 + 코드 조각.

### 2-5. 움직임 한계 (character_check가 더 넓게 통과하지 않는 한)
| 부위 | 한계 |
|---|---|
| 머리 기울기 | ±8° (maxRot) |
| 머리 들기 | 머리 높이의 4% 이하 |
| 눈 크기 | 0.9–1.35 |
| 눈동자 크기 | 0.6–1.2 |
| 손 / 발 | ±12° |
| 몸 흔들림 | ±3° |
- 부위가 다른 부위 **위로 와야 하는 동작**(손을 얼굴 앞으로, 팔을 몸 앞으로)은 동작 직전에 `SvgRig.layer(svg, 'hand-l', 'head', 'above')` 로 순서를 바꾸고, 끝나면 되돌린다.

### 2-6. 확인
check_video 후 look_at_frames로: 첫 프레임이 원본과 같은지 / 고개 최대 기울기에서 턱·목·귀 경계 / 놀람(눈 최대) 순간의 흰자 / 손·발이 가장 많이 돌아간 순간의 끝단 / 표정 교체 직전·직후 / 흐느낌 중 몸 아래 끝.
**부위가 떨어져 보이거나 순서가 뒤바뀐 프레임이 하나라도 있으면 태그나 모션을 고친다.**
