// 소재 > AI로 만들기: the looks (스타일) and the kinds of asset (종류) the designer can
// ask for. Each is a few plain sentences put in front of the designer's own prompt, in
// the language the model reads best. They follow OpenAI's image prompting guide
// (medium → rendering → light → palette → composition → constraints) and were checked
// by making samples with GPT Image through Codex (tests/e2e/style-samples.mjs).
import type { PromptLang } from './assetGen'

/** looks other than "none" and the flat SVG character (which has its own sentences) */
export type LookStyle = 'flat' | 'cartoon' | 'clay' | '3d' | 'isometric' | 'watercolor' | 'paper' | 'line' | 'anime' | 'pixel' | 'photo' | 'retro' | 'sticker'
export type GenKind = 'free' | 'character' | 'object' | 'element' | 'background' | 'scene'

export const LOOK_LABELS: Record<LookStyle, string> = {
  flat: '플랫 일러스트',
  cartoon: '카툰',
  clay: '클레이',
  '3d': '3D 렌더',
  isometric: '아이소메트릭',
  watercolor: '수채화',
  paper: '페이퍼 아트',
  line: '라인 드로잉',
  anime: '애니메이션',
  pixel: '픽셀 아트',
  photo: '실사 사진',
  retro: '레트로 포스터',
  sticker: '스티커',
}

/** one line for the designer under the style picker */
export const LOOK_HINTS: Record<LookStyle, string> = {
  flat: '외곽선 없이 단색 면으로만 그린 광고·앱용 벡터 일러스트. 그라데이션·질감 없이 깔끔해요.',
  cartoon: '굵고 고른 외곽선, 한 단계 그늘(셀 셰이딩), 쨍한 색. TV 애니메이션·마스코트 느낌.',
  clay: '찰흙으로 빚은 스톱모션 느낌. 손자국·둥근 덩어리·부드러운 스튜디오 조명.',
  '3d': '장난감처럼 귀여운 3D 캐릭터·아이콘 렌더. 매트 플라스틱 재질, 부드러운 빛과 그림자.',
  isometric: '30° 등각 투시의 미니어처 디오라마. 사물·장면·배경에 잘 맞아요 (인물 한 명에는 잘 안 맞아요).',
  watercolor: '종이에 번지는 수채 물감과 연필 선. 맑고 따뜻한 손그림.',
  paper: '색 마분지를 오려 3~6겹으로 붙인 페이퍼 컷 공예 사진. 층마다 두께와 그림자.',
  line: '검은 펜 선과 2~3가지 포인트 색의 손그림 두들. 여백이 많아요.',
  anime: '일본 TV 애니메이션 셀화. 가는 선, 또렷한 그늘과 하이라이트.',
  pixel: '네모 픽셀이 보이는 16비트 게임 그래픽. 제한된 팔레트.',
  photo: '진짜 광고 사진처럼 실제 재질·조명·심도.',
  retro: '리소그래프 인쇄 포스터. 별색 2~4개, 망점, 살짝 어긋난 인쇄.',
  sticker: '흰 테두리를 두른 다이컷 스티커. 귀엽고 밝은 색.',
}

export const KIND_LABELS: Record<GenKind, string> = {
  free: '자유',
  character: '인물·캐릭터',
  object: '사물·제품',
  element: '오브젝트·아이콘',
  background: '배경',
  scene: '장면',
}

export const KIND_HINTS: Record<GenKind, string> = {
  free: '종류를 정하지 않고 프롬프트대로 만들어요.',
  character: '한 명을 가운데에, 단색 배경으로 (배경 지우기 쉬워요).',
  object: '물건 하나를 가운데에, 단색 배경과 옅은 바닥 그림자만.',
  element: '모션에 쓸 단순한 그래픽 요소 하나 (코인·하트·선물상자 같은). 단색 배경.',
  background: '화면을 꽉 채우는 배경. 가운데는 비워 글자·요소 올릴 자리를 남겨요.',
  scene: '인물·사물이 배경 안에 있는 완성된 한 장면.',
}

/** the kinds that come on a plain background (so the background can be taken away) */
export const ISOLATED_KINDS: GenKind[] = ['character', 'object', 'element']

export const LOOK_TEXT: Record<LookStyle, Record<PromptLang, string>> = {
  flat: {
    en: 'STYLE: Flat 2D vector illustration in a modern advertising style, like a corporate or app illustration. Built only from clean geometric shapes filled with solid colors that meet edge to edge. NO black or dark outlines and no line art at all: details such as hair strands, folds and facial features are separate color shapes, not lines. At most one flat, hard-edged shadow tone per color, no gradients, no texture, no photographic detail. Harmonious limited palette of 6 to 10 colors.',
    zh: '风格：现代广告风格的扁平 2D 矢量插画，像企业或应用插画。只由纯色填充、边缘相接的干净几何形状组成。完全不要黑色或深色描边和线稿：发丝、衣褶、五官等细节都用独立的色块表现，而不是线条。每种颜色最多一个扁平、硬边的阴影色，不要渐变、纹理或照片级细节。和谐的有限色板，6 到 10 种颜色。',
    ko: '스타일: 요즘 광고·앱에 쓰는 플랫 2D 벡터 일러스트. 단색으로 채운 깔끔한 기하 도형이 서로 맞닿아서만 이루어진다. 검은색·진한 외곽선과 선화는 전혀 없음: 머리카락 결, 옷 주름, 이목구비 같은 디테일도 선이 아니라 따로 칠한 색 면으로. 색마다 경계가 또렷한 그늘 한 단계까지만, 그라데이션·질감·사진 같은 디테일 없음. 6~10색의 조화로운 제한 팔레트.',
  },
  cartoon: {
    en: 'STYLE: Polished cartoon illustration. Bold, clean dark outlines of even weight, cel shading with one hard-edged shadow tone, bright saturated colors, simplified and slightly exaggerated proportions, expressive shapes, smooth flat fills. Looks like a frame from a modern TV animation or a brand mascot illustration. No painterly texture, no photorealism.',
    zh: '风格：精致的卡通插画。粗细均匀、干净的深色描边，赛璐璐上色，只有一层硬边阴影，明亮饱和的颜色，简化并略带夸张的比例，富有表现力的形状，平滑的纯色填充。像现代电视动画的一帧或品牌吉祥物插画。不要绘画笔触，不要写实。',
    ko: '스타일: 완성도 높은 카툰 일러스트. 굵기가 고른 깔끔한 진한 외곽선, 경계가 또렷한 그늘 한 단계의 셀 셰이딩, 밝고 채도 높은 색, 단순하고 살짝 과장된 비례, 표정이 풍부한 형태, 매끈한 단색 채색. 요즘 TV 애니메이션의 한 장면이나 브랜드 마스코트 일러스트처럼. 붓 질감·실사 느낌 없음.',
  },
  clay: {
    en: 'STYLE: Claymation, plasticine stop-motion look. Everything is sculpted from soft matte modeling clay: rounded chunky forms, subtle fingerprints and tool marks, slightly imperfect handmade edges. Soft diffused studio lighting with gentle contact shadows, slight depth of field, warm pastel-leaning colors. Photographed like a miniature stop-motion set.',
    zh: '风格：黏土定格动画（橡皮泥）质感。所有东西都用柔软的哑光造型黏土捏成：圆润厚实的形体，细微的指纹和工具痕迹，略带手工感的不完美边缘。柔和漫射的摄影棚灯光，轻柔的接触阴影，轻微景深，偏暖的粉彩色。像拍摄微缩定格动画布景的照片。',
    ko: '스타일: 클레이 애니메이션(찰흙 스톱모션) 느낌. 모든 것이 부드러운 무광 찰흙으로 빚어졌다: 둥글고 도톰한 덩어리, 은은한 손자국과 도구 자국, 손으로 만든 듯 살짝 고르지 않은 가장자리. 부드럽게 퍼지는 스튜디오 조명과 은은한 접지 그림자, 약한 심도, 따뜻한 파스텔 계열 색. 미니어처 스톱모션 세트를 찍은 사진처럼.',
  },
  '3d': {
    en: 'STYLE: Stylized 3D render of a cute toy-like figure or object, like a feature animation character or a premium 3D app icon. Simplified rounded forms with soft bevels; characters have a slightly oversized head, big simple eyes and smooth vinyl-toy skin. Soft materials (matte plastic, soft rubber, a light gloss), soft global illumination with a key light and a gentle rim light, ambient occlusion. Clean palette from pastel to vivid. Clearly a 3D render, not a painting and not realistic.',
    zh: '风格：可爱玩具感的风格化 3D 渲染，像动画长片角色或精致的 3D 应用图标。简化圆润、带柔和倒角的形体；角色头部略大，眼睛大而简单，皮肤像光滑的搪胶玩具。柔和的材质（哑光塑料、软橡胶、轻微光泽），柔和的全局光照，一盏主光和柔和的轮廓光，环境光遮蔽。从粉彩到鲜艳的干净色板。明显是 3D 渲染，不是绘画，也不写实。',
    ko: '스타일: 장난감처럼 귀여운 스타일라이즈드 3D 렌더. 애니메이션 영화 캐릭터나 정성 들인 3D 앱 아이콘처럼. 단순하고 둥근 형태와 부드럽게 깎인 모서리, 인물은 머리가 살짝 크고 눈이 크고 단순하며 피부는 매끈한 비닐 피규어 같다. 부드러운 재질(무광 플라스틱, 말랑한 고무, 약한 광택), 키 라이트와 은은한 림 라이트의 부드러운 전역 조명, 앰비언트 오클루전. 파스텔부터 선명한 색까지 깔끔한 팔레트. 그림이 아니라 확실한 3D 렌더, 실사 느낌 없음.',
  },
  isometric: {
    en: 'STYLE: Isometric illustration in a true isometric projection (30° angles, no perspective, parallel edges). Clean vector-like shapes with crisp edges and flat colors, lit consistently from the top left: each surface in three tones (light top, mid left, dark right). Neat miniature-diorama feel, tidy details, cohesive limited palette.',
    zh: '风格：真正等轴测投影的等距插画（30° 角，无透视，边线平行）。干净的矢量感形状，边缘清晰，纯色，光线统一来自左上方：每个面三种明度（顶面亮、左面中、右面暗）。整齐的微缩模型感，细节利落，统一的有限色板。',
    ko: '스타일: 진짜 등각 투시(30° 각도, 원근 없음, 평행한 모서리)의 아이소메트릭 일러스트. 가장자리가 또렷한 벡터 같은 도형과 단색, 왼쪽 위에서 오는 일정한 빛: 면마다 세 단계 밝기(윗면 밝게, 왼면 중간, 오른면 어둡게). 정돈된 미니어처 디오라마 느낌, 깔끔한 디테일, 통일된 제한 팔레트.',
  },
  watercolor: {
    en: 'STYLE: Hand-painted watercolor illustration. Transparent washes with soft wet-in-wet blooms, visible cold-press paper grain, light pencil or ink linework in places, gentle color bleeding, white paper showing through as highlights. Fresh, airy, warm and natural palette.',
    zh: '风格：手绘水彩插画。透明的晕染，湿画法形成柔和的水渍，可见冷压水彩纸纹理，局部有淡淡的铅笔或墨线，颜色轻轻渗化，留白的纸面作为高光。清新、通透、温暖自然的色调。',
    ko: '스타일: 손으로 그린 수채화 일러스트. 투명하게 겹친 물감, 젖은 위에 번진 부드러운 얼룩, 눈에 보이는 수채 종이 결, 군데군데 연한 연필·잉크 선, 은은하게 번지는 색, 하이라이트로 남긴 종이의 흰 바탕. 맑고 산뜻하며 따뜻하고 자연스러운 색.',
  },
  paper: {
    en: 'STYLE: Handmade layered paper-cut craft, photographed. Every part (face, hair, clothes, background) is a separate piece cut from matte colored cardstock and glued on top of the one behind it, 3 to 6 layers deep, each casting a visible soft shadow on the layer below; real paper thickness at the cut edges, subtle paper fiber texture, a slightly raised dimensional look. Soft directional light from the top left. Limited bright palette. Clearly physical paper, not a flat digital illustration.',
    zh: '风格：手工分层剪纸工艺的实拍照片。每个部分（脸、头发、衣服、背景）都是从哑光彩色卡纸上剪下的独立纸片，粘在后面一层之上，共 3 到 6 层，每层都在下一层投下明显的柔和阴影；切边可见真实纸张厚度，细微的纸张纤维纹理，略微凸起的立体感。柔和的方向光来自左上方。有限而明亮的色板。明显是实体纸艺，而不是扁平的数字插画。',
    ko: '스타일: 손으로 만든 페이퍼 컷 공예를 찍은 사진. 얼굴·머리·옷·배경 같은 모든 부분이 무광 색 마분지에서 따로 오린 조각이고, 뒤 층 위에 붙어 3~6겹으로 쌓여 있으며, 층마다 아래 층에 부드러운 그림자가 또렷이 진다. 칼선에 실제 종이 두께가 보이고 은은한 종이 섬유 질감, 살짝 도드라진 입체감. 왼쪽 위에서 오는 부드러운 방향광. 밝은 제한 팔레트. 평평한 디지털 일러스트가 아니라 확실한 실물 종이 공예.',
  },
  line: {
    en: 'STYLE: Hand-drawn line illustration. Confident black ink lines of varying weight with a loose, doodle-like charm; only 2 or 3 flat accent colors, filled slightly off the lines; plenty of white space. Looks like a modern editorial or brand doodle illustration.',
    zh: '风格：手绘线条插画。自信、粗细变化的黑色墨线，带着随性的涂鸦趣味；只有 2 到 3 种平涂的点缀色，填色略微偏离线条；大量留白。像现代杂志插图或品牌涂鸦插画。',
    ko: '스타일: 손그림 라인 일러스트. 굵기가 변하는 자신감 있는 검은 펜 선과 자유로운 두들 느낌, 선에서 살짝 어긋나게 칠한 2~3가지 단색 포인트 컬러, 넉넉한 여백. 요즘 매거진·브랜드 두들 일러스트처럼.',
  },
  anime: {
    en: 'STYLE: Japanese anime cel illustration. Clean thin line art, flat cel shading with crisp hard-edged shadows and highlights, vivid clear colors, expressive large eyes for characters, a detailed painted-look background when a background is present. Looks like a high-quality TV anime key visual.',
    zh: '风格：日本动画赛璐璐插画。干净的细线稿，平涂赛璐璐上色，阴影和高光边缘清晰利落，鲜明通透的颜色，角色有富有表现力的大眼睛，有背景时是细致的手绘感背景。像高质量电视动画的主视觉。',
    ko: '스타일: 일본 TV 애니메이션 셀화. 깔끔하고 가는 선화, 경계가 또렷한 그늘과 하이라이트의 셀 셰이딩, 맑고 선명한 색, 인물은 표정이 풍부한 큰 눈, 배경이 있으면 정성 들여 그린 듯한 배경. 퀄리티 높은 TV 애니메이션 키 비주얼처럼.',
  },
  pixel: {
    en: 'STYLE: Pixel art. Clearly visible square pixels on a low-resolution grid (the subject about 64 to 128 pixels across), a limited retro palette of 16 to 32 colors, no anti-aliasing, no blur, hard pixel edges, dithering only where needed. Like a polished 16-bit game sprite or scene.',
    zh: '风格：像素画。在低分辨率网格上清晰可见的方形像素（主体约 64 到 128 像素宽），16 到 32 色的有限复古色板，不要抗锯齿，不要模糊，像素边缘硬朗，只在需要时使用抖动。像精致的 16 位游戏精灵或场景。',
    ko: '스타일: 픽셀 아트. 저해상도 격자 위에 또렷이 보이는 네모 픽셀(주인공이 가로 64~128픽셀 정도), 16~32색의 제한된 레트로 팔레트, 안티에일리어싱·흐림 없음, 딱 떨어지는 픽셀 가장자리, 필요한 곳에만 디더링. 잘 만든 16비트 게임 스프라이트나 장면처럼.',
  },
  photo: {
    en: 'STYLE: Photorealistic commercial photograph. Real materials and textures, accurate proportions, professional studio or natural lighting with soft shadows, sharp focus on the subject, shallow depth of field where it helps, clean color grading. Looks like a real advertising photo, not an illustration or a 3D render.',
    zh: '风格：照片级写实的商业摄影。真实的材质和纹理，准确的比例，专业的影棚光或自然光，阴影柔和，主体对焦清晰，需要时使用浅景深，干净的调色。看起来是真正的广告照片，而不是插画或 3D 渲染。',
    ko: '스타일: 실사 광고 사진(포토리얼리스틱). 실제 재질과 질감, 정확한 비례, 부드러운 그림자의 전문 스튜디오 조명 또는 자연광, 주인공에 또렷한 초점, 필요하면 얕은 심도, 깔끔한 색 보정. 일러스트나 3D 렌더가 아니라 진짜 광고 사진처럼.',
  },
  retro: {
    en: 'STYLE: Retro risograph poster print. Bold simplified shapes printed in 2 to 4 flat spot inks (for example fluorescent pink, teal, yellow, navy) with slight misregistration, halftone dot shading, visible grain and uncoated paper texture. Mid-century graphic poster feel.',
    zh: '风格：复古孔版（Risograph）海报印刷。大胆简化的形状，用 2 到 4 种平涂专色油墨印刷（例如荧光粉、蓝绿、黄、藏青），套印略有错位，网点阴影，可见颗粒和非涂布纸纹理。二十世纪中叶的平面海报感。',
    ko: '스타일: 레트로 리소그래프 인쇄 포스터. 과감하게 단순화한 형태를 2~4가지 별색(예: 형광 핑크, 청록, 노랑, 남색)으로 찍고, 인쇄가 살짝 어긋나 있으며, 망점으로 명암을 내고, 거친 입자와 비코팅 종이 질감이 보인다. 미드센추리 그래픽 포스터 느낌.',
  },
  sticker: {
    en: 'STYLE: Die-cut sticker. The subject drawn as a cute flat vector sticker with clean shapes and simple shading, surrounded by a thick, even white border that follows its outline, with a subtle soft shadow under the sticker. Bright, cheerful colors.',
    zh: '风格：模切贴纸。主体画成可爱的扁平矢量贴纸，形状干净，阴影简单，四周有一圈沿轮廓的粗而均匀的白边，贴纸下方有淡淡的柔和阴影。明亮欢快的颜色。',
    ko: '스타일: 다이컷 스티커. 주인공을 깔끔한 도형과 단순한 음영의 귀여운 플랫 벡터 스티커로 그리고, 윤곽을 따라 두껍고 고른 흰 테두리를 두르며, 스티커 아래에 옅고 부드러운 그림자. 밝고 경쾌한 색.',
  },
}

export const KIND_TEXT: Record<Exclude<GenKind, 'free'>, Record<PromptLang, string>> = {
  character: {
    en: 'SUBJECT: One character or person as the only subject, centered and entirely inside the frame with margin around it (never crop the head). Plain single-color background that contrasts with the character; no scenery and no props unless requested. No text.',
    zh: '主体：只有一个角色或人物，居中，完整地在画面内，四周留出空间（绝不裁切头部）。与角色形成对比的单一纯色背景；除非有要求，不要场景和道具。不要文字。',
    ko: '주인공: 인물·캐릭터 한 명만, 가운데에, 사방에 여백을 두고 화면 안에 전부(머리는 절대 자르지 않음). 캐릭터와 대비되는 단색 배경, 요청이 없으면 풍경·소품 없음. 글자 없음.',
  },
  object: {
    en: 'SUBJECT: One object or product as the only subject, centered and fully visible with even margin on every side, shown from a clear front or three-quarter view that reads at a glance. Plain single-color background that contrasts with it and only a soft contact shadow; no other objects; no text or labels unless requested.',
    zh: '主体：只有一个物品或产品，居中，完整可见，四周留出均匀空间，用一眼就能看懂的正面或四分之三视角展示。与它形成对比的单一纯色背景，只有柔和的接触阴影；没有其他物品；除非有要求，不要文字或标签。',
    ko: '주인공: 사물·제품 하나만, 가운데에, 사방에 고른 여백을 두고 전부 보이게, 한눈에 알아볼 수 있는 정면 또는 3/4 각도로. 대비되는 단색 배경과 옅은 바닥 그림자만, 다른 물건 없음, 요청이 없으면 글자·라벨 없음.',
  },
  element: {
    en: 'SUBJECT: One simple graphic element (an icon-like object or symbol, for example a coin, heart, gift box or speech bubble) to be animated in motion graphics. Bold, instantly readable silhouette, few small details, centered with generous margin. Plain single-color background, no ground shadow. No text.',
    zh: '主体：一个简单的图形元素（类似图标的物体或符号，例如硬币、爱心、礼盒、对话气泡），用于动态图形动画。轮廓醒目、一眼可读，细小细节少，居中并留出充足空间。单一纯色背景，没有地面阴影。不要文字。',
    ko: '주인공: 모션 그래픽에서 움직일 단순한 그래픽 요소 하나(코인, 하트, 선물상자, 말풍선 같은 아이콘 같은 사물이나 기호). 굵고 한눈에 읽히는 실루엣, 작은 디테일은 적게, 가운데에 넉넉한 여백. 단색 배경, 바닥 그림자 없음. 글자 없음.',
  },
  background: {
    en: 'SUBJECT: A background that fills the whole frame edge to edge (an environment, a place or an abstract backdrop). No main character or large subject in the middle: keep calm, open areas where headlines and other elements will be placed later. No text, no logos, no watermark.',
    zh: '主体：铺满整个画面的背景（环境、地点或抽象背景）。画面中间不要主角或大的主体：保留安静、开阔的区域，之后要放标题和其他元素。不要文字、标志或水印。',
    ko: '주인공: 화면 끝까지 꽉 채우는 배경(공간, 장소 또는 추상 배경). 가운데에 주인공이나 큰 물체를 두지 않고, 나중에 헤드라인과 다른 요소를 올릴 차분하고 빈 영역을 남긴다. 글자·로고·워터마크 없음.',
  },
  scene: {
    en: 'SUBJECT: A complete scene: characters and/or objects inside an environment, showing one clear moment with a clear focal point and a readable composition that fills the frame. No text, no logos, no watermark.',
    zh: '主体：一个完整的场景：角色和/或物品身处环境中，表现一个清晰的瞬间，有明确的视觉焦点，构图易读并填满画面。不要文字、标志或水印。',
    ko: '주인공: 인물·사물이 공간 안에 있는 완성된 한 장면. 분명한 한 순간, 뚜렷한 초점, 화면을 채우는 읽기 쉬운 구도. 글자·로고·워터마크 없음.',
  },
}

/** framing for characters in the other looks (the flat character has stricter sentences) */
export const FRAMING_SIMPLE: Record<'bust' | 'upper' | 'full', Record<PromptLang, string>> = {
  bust: { en: 'FRAMING: Bust shot, head and shoulders.', zh: '构图：胸像，头部和肩膀。', ko: '구도: 흉상, 머리와 어깨.' },
  upper: { en: 'FRAMING: Upper body from the waist up, both hands visible.', zh: '构图：腰部以上的上半身，双手可见。', ko: '구도: 허리 위 상반신, 양손이 보이게.' },
  full: { en: 'FRAMING: Full body from head to feet, entirely inside the frame.', zh: '构图：从头到脚的全身，完全在画面内。', ko: '구도: 머리부터 발끝까지 전신, 화면 안에 전부.' },
}

/** words to keep out, for the services that take a negative prompt */
export const LOOK_NEGATIVE: Partial<Record<LookStyle, string>> = {
  flat: 'gradient, 3d render, photo, texture, noise, painterly, heavy outline, text, watermark',
  cartoon: 'photo, realistic, 3d render, painterly texture, sketchy lines, text, watermark',
  clay: 'flat illustration, vector, line art, glossy plastic, photo of real people, text, watermark',
  '3d': 'flat illustration, line art, sketch, photo, grainy noise, cluttered background, text, watermark',
  isometric: 'perspective, vanishing point, fisheye, photo, sketch, text, watermark',
  watercolor: 'vector, flat colors, 3d render, photo, digital gradient, text, watermark',
  paper: 'flat vector, 3d plastic, photo of people, painterly, text, watermark',
  line: '3d render, photo, gradient, full color painting, text, watermark',
  anime: 'photo, realistic, 3d render, western cartoon, sketch, text, watermark',
  pixel: 'smooth, anti-aliasing, blur, high resolution detail, vector, 3d render, text, watermark',
  photo: 'illustration, cartoon, 3d render, painting, drawing, text, watermark, extra fingers',
  retro: 'photo, 3d render, smooth gradient, glossy, text, watermark',
  sticker: 'photo, realistic, 3d render, busy background, text, watermark',
}
