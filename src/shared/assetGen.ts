// Making assets with an image model (브리프 > 소재 > AI로 만들기), and the
// "flat character" style whose images become SVG characters that can act.
// The style sentences come from ms-svg-character (STYLE_PROMPT.md v1).

import { FRAMING_SIMPLE, KIND_TEXT, LOOK_LABELS, LOOK_NEGATIVE, LOOK_TEXT, type GenKind, type LookStyle } from './genStyles'

export type PromptLang = 'en' | 'zh' | 'ko'
export type Framing = 'auto' | 'bust' | 'upper' | 'full'
export type GenStyle = 'none' | 'flat-character' | LookStyle
export type { GenKind, LookStyle }

export const PROMPT_LANG_LABELS: Record<PromptLang, string> = { en: '영어', zh: '중국어', ko: '한국어' }
export const FRAMING_LABELS: Record<Framing, string> = { auto: '자동', bust: '흉상', upper: '상반신', full: '전신' }
export const STYLE_LABELS: Record<GenStyle, string> = { none: '스타일 없음 (프롬프트 그대로)', 'flat-character': '플랫 캐릭터 · SVG로 연기', ...LOOK_LABELS }
export const RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const
export type Ratio = (typeof RATIOS)[number]
/** the ratio each framing is made for */
export const FRAMING_RATIO: Record<Framing, Ratio> = { auto: '1:1', bust: '1:1', upper: '1:1', full: '3:4' }

const FLAT_STYLE: Record<PromptLang, string> = {
  en: `Create a single character illustration that will be automatically converted to SVG and animated part by part.

STYLE
- Flat 2D vector illustration made only of solid-color shapes.
- No outlines or line art around shapes. Separate parts by color, not by lines.
- No gradients, no airbrush shading, no texture, no grain, no glow, no drop shadows.
- At most one flat, hard-edged shadow tone per material, and shading never crosses from one body part onto another: no shadow cast by the head on the neck, no shadow of the hair on the face.
- Limited palette of about 8 to 12 colors. Skin, hair, eyes, clothing and background must each be clearly different colors.
- Plain single-color background that contrasts with the skin, the hair and the clothes. No scenery, no pattern, no ground line.

CHARACTER
- One character, centered, facing the viewer (straight on or a slight three-quarter view). How much of the body is shown follows the framing or the request.
- Large head and simple rounded shapes.
- Eyes: the white of each eye is a complete oval; a dark round pupil with one small white highlight sits inside it with a visible margin of white all around (it may touch only the upper lid); a simple dark upper-lid shape.
- Eyebrows: separate solid shapes that do not touch the hair.
- Nose: one small simple shape. Mouth: a small filled closed smile shape (not a hairline).
- Neck: a simple straight column of skin, slightly darker than the face, so the jawline is a clear colour edge.
- Both ears visible. Hair: one solid mass with at most one to three simple highlight shapes; hair and headwear must not cover the eyes or eyebrows.
- Clothing: large flat color blocks; small details as separate simple shapes. Where possible, sleeves and trousers are a different color from the torso clothing. Sleeve cuffs cover the wrists and trouser hems cover the ankles.

POSE AND EXPRESSION
- Neutral or mild expression: eyes open, mouth closed.
- Nothing in front of the face: no hands, props, glasses, masks, or hair strands across the face.
- Relaxed, simple pose. Any visible arm or leg is separated from the torso and from the other limbs by a clear gap of background, and does not cross in front of the body.
- Any visible hand is simple, fully shown, and holds nothing unless requested.
- Never crop the head: the whole head and any headwear stay inside the frame with margin above.

OUTPUT
- At least 1024 px on the shorter side. Aspect ratio as requested (1:1 if not specified). No text, no logo, no watermark, no border.`,
  zh: `生成一张单个角色的插画，之后会被自动转换为 SVG，并按部位制作动画。

风格
- 扁平 2D 矢量插画，只由纯色色块组成。
- 色块周围不要描边或线稿，用颜色而不是线条来区分部位。
- 不要渐变、喷枪式阴影、纹理、颗粒、发光或投影。
- 每种材质最多一个扁平、硬边的阴影色，阴影不能从一个身体部位延伸到另一个部位：头部不在脖子上投下阴影，头发不在脸上投下阴影。
- 色板控制在约 8 到 12 种颜色。皮肤、头发、眼睛、衣服和背景必须是明显不同的颜色。
- 纯色背景，与皮肤、头发和衣服都形成对比。不要场景、图案或地面线。

角色
- 只有一个角色，居中，面向观众（正面或略微四分之三侧面）。身体显示多少按照构图设置或要求。
- 头部偏大，造型简单圆润。
- 眼睛：每只眼的眼白是完整的椭圆；深色圆形瞳孔（带一个小的白色高光）在眼白里面，四周都留有可见的白边（只可以碰到上眼睑）；简单的深色上眼睑形状。
- 眉毛：独立的纯色形状，不与头发相接。
- 鼻子：一个简单的小形状。嘴：一个闭着的小微笑填充形状（不是细线）。
- 脖子：一个简单的直柱形皮肤，比脸稍深，让下颌线是清楚的颜色边界。
- 两只耳朵都可见。头发：一整块纯色，最多一到三个简单的高光形状；头发和帽子不能遮住眼睛或眉毛。
- 衣服：大面积扁平色块；小细节用独立的简单形状。尽量让袖子和裤子的颜色与上身衣服不同。袖口盖住手腕，裤脚盖住脚踝。

姿势与表情
- 中性或温和的表情：睁眼，闭嘴。
- 脸前不能有任何东西：不要手、道具、眼镜、口罩，也不要有发丝横过脸。
- 姿势放松简单。可见的手臂或腿与躯干、与其他肢体之间要有明显的背景间隙，不要交叉挡在身体前面。
- 可见的手要简单、完整露出，除非有要求，否则不拿任何东西。
- 绝不裁切头部：整个头部和帽子都在画面内，上方留出空间。

输出
- 短边至少 1024 像素。宽高比按要求（未指定时为 1:1）。不要文字、标志、水印或边框。`,
  ko: `캐릭터 일러스트 한 장을 만든다. 이 이미지는 자동으로 SVG로 변환되어 부위별로 애니메이션된다.

스타일
- 단색 면으로만 이루어진 플랫 2D 벡터 일러스트.
- 도형 둘레에 외곽선·선화 없음. 부위는 선이 아니라 색으로 구분한다.
- 그라데이션, 에어브러시 음영, 질감, 노이즈, 광택, 그림자 효과 없음.
- 재질마다 경계가 또렷한 그늘 색은 최대 한 가지. 그늘이 한 부위에서 다른 부위로 넘어가지 않는다: 머리가 목에 드리우는 그림자, 머리카락이 얼굴에 드리우는 그림자 없음.
- 8~12색 정도의 제한된 팔레트. 피부, 머리, 눈, 옷, 배경은 서로 확실히 다른 색.
- 피부·머리·옷과 대비되는 단색 배경. 풍경·무늬·바닥선 없음.

캐릭터
- 캐릭터 한 명, 화면 가운데, 정면 또는 살짝 비스듬히. 몸이 어디까지 보이는지는 구도 설정이나 요청을 따른다.
- 큰 머리, 단순하고 둥근 형태.
- 눈: 흰자는 온전한 타원. 진한 둥근 눈동자(작은 흰 하이라이트 하나)는 흰자 안에 있고 둘레에 흰자가 보인다(윗눈꺼풀에만 닿을 수 있음). 단순한 진한 윗눈꺼풀.
- 눈썹: 머리카락에 닿지 않는 별도의 단색 도형.
- 코: 작고 단순한 도형 하나. 입: 면으로 칠한 다문 작은 미소(가는 선 아님).
- 목: 단순한 일자 기둥. 얼굴보다 조금 어두운 피부색이라 턱선이 색 경계로 또렷하다.
- 양쪽 귀가 보인다. 머리카락: 하나의 단색 덩어리와 단순한 하이라이트 1~3개. 머리카락과 모자가 눈·눈썹을 가리지 않는다.
- 옷: 큰 단색 덩어리. 작은 디테일은 별도의 단순한 도형. 가능하면 소매와 바지는 몸통 옷과 다른 색. 소매 끝은 손목을, 바지 끝단은 발목을 덮는다.

자세와 표정
- 무표정 또는 옅은 표정: 눈을 뜨고 입은 다문다.
- 얼굴 앞을 가리는 것 없음: 손, 소품, 안경, 마스크, 얼굴을 가로지르는 머리카락 없음.
- 편안하고 단순한 자세. 보이는 팔·다리는 몸통이나 다른 팔다리와 배경이 보일 만큼 떨어져 있고, 몸 앞으로 겹치지 않는다.
- 보이는 손은 단순하게, 전부 보이게. 요청이 없으면 아무것도 들지 않는다.
- 머리는 절대 자르지 않는다: 머리와 모자 전체가 화면 안에 들어오고 위로 여백.

출력
- 짧은 변 최소 1024px. 비율은 요청대로(지정 없으면 1:1). 글자·로고·워터마크·테두리 없음.`,
}

const FRAMING_TEXT: Record<Exclude<Framing, 'auto'>, Record<PromptLang, string>> = {
  bust: {
    en: 'FRAMING: Bust shot, head and shoulders. Arms outside the frame; the shoulders may be cropped by the bottom edge.',
    zh: '构图：胸像，头部和肩膀。手臂在画面外；肩膀可以被画面下边缘裁切。',
    ko: '구도: 흉상, 머리와 어깨. 팔은 화면 밖, 어깨는 화면 아래에서 잘려도 된다.',
  },
  upper: {
    en: 'FRAMING: Upper body from the waist up. Both arms fully visible, hanging relaxed slightly away from the body with a clear gap between each arm and the torso; both hands visible. The body may be cropped at the hips.',
    zh: '构图：腰部以上的上半身。双臂完整可见，自然下垂并稍微离开身体，手臂与躯干之间有明显间隙；双手可见。身体可以在臀部处被裁切。',
    ko: '구도: 허리 위 상반신. 양팔이 모두 보이고, 몸에서 조금 떨어져 편하게 내려와 있으며 팔과 몸통 사이에 틈이 보인다. 양손이 보인다. 몸은 엉덩이에서 잘려도 된다.',
  },
  full: {
    en: 'FRAMING: Full body from head to feet, entirely inside the frame with margin on all sides. Standing upright, feet slightly apart with a gap between the legs, arms relaxed slightly away from the body, both hands and both feet visible.',
    zh: '构图：从头到脚的全身，完全在画面内，四周留出空间。直立站姿，双脚稍微分开、两腿之间有间隙，手臂放松并稍微离开身体，双手和双脚都可见。',
    ko: '구도: 머리부터 발까지 전신, 사방에 여백을 두고 화면 안에. 똑바로 선 자세, 발은 조금 벌려 다리 사이에 틈, 팔은 몸에서 조금 떨어져 편하게, 양손과 양발이 보인다.',
  },
}

export const FLAT_NEGATIVE =
  'outline, line art, sketch, gradient, 3d render, realistic, photo, texture, noise, painterly, soft shading, glow, lens flare, text, watermark, multiple characters, hands near face, hair covering eyes, glasses, cropped head, arms crossed, limbs overlapping body, cast shadow on neck, pupil touching the eye outline'

/** conversion settings of the flat character style (img2svg) */
export const FLAT_CONVERT = { colors: 14, bg: 'auto', thin: 1.6, maxSide: 1600 } as const
/** most shapes a clean conversion has, by framing (initial values from the tests) */
export const MAX_SHAPES: Record<Framing, number> = { auto: 100, bust: 60, upper: 80, full: 100 }
/** most pixels (%) the SVG may differ from the image */
export const MAX_DIFF_PCT = 1

/**
 * The text sent to the model: style sentences (in the model's language), what kind of
 * asset it is, the framing sentence (characters, unless 자동), then the designer's
 * prompt exactly as typed.
 */
export function buildPrompt(style: GenStyle, framing: Framing, lang: PromptLang, prompt: string, kind: GenKind = 'free'): string {
  const parts: string[] = []
  if (style === 'flat-character') {
    parts.push(FLAT_STYLE[lang])
    if (framing !== 'auto') parts.push(FRAMING_TEXT[framing][lang])
  } else {
    if (style !== 'none') parts.push(LOOK_TEXT[style][lang])
    if (kind !== 'free') parts.push(KIND_TEXT[kind][lang])
    if (kind === 'character' && framing !== 'auto') parts.push(FRAMING_SIMPLE[framing][lang])
  }
  parts.push(prompt)
  return parts.filter((p) => p.trim()).join('\n\n')
}

/** what to keep out, for services with a negative prompt */
export const negativeFor = (style: GenStyle): string | undefined => (style === 'flat-character' ? FLAT_NEGATIVE : style === 'none' ? undefined : LOOK_NEGATIVE[style])

/** the language a model reads best, guessed from its name (the designer can change it per model) */
export function defaultPromptLang(model: string): PromptLang {
  const m = model.toLowerCase()
  if (/seedream|seededit|hunyuan|qwen|kling|wan[-_ ]?\d|hailuo|minimax|jimeng|doubao|cogview|kolors|vidu|bytedance|tencent|alibaba/.test(m)) return 'zh'
  if (/gpt|openai|dall|gemini|imagen|nano[-_ ]?banana|google/.test(m)) return 'ko'
  return 'en'
}

export interface GenRequest {
  provider: 'higgsfield' | 'magnific' | 'codex'
  /** service model id ('' = the service's own default) */
  model: string
  modelLabel?: string
  style: GenStyle
  /** what kind of asset (older candidates have none: 자유) */
  kind?: GenKind
  framing: Framing
  ratio: Ratio
  lang: PromptLang
  /** exactly what the designer typed (never rewritten) */
  prompt: string
  /** reference images (composition-relative, e.g. assets/logo.png) */
  references: string[]
  /** 수정해서 다시 만들기: the designer's change requests, oldest first (the last one is new) */
  revision?: string[]
  /** the image being revised (project-relative: .studio/generations/<id>/source.png or composition/assets/…); sent along when the model takes images */
  revisedFrom?: string
}

/** SVG conversion of a character image and what Claude did with it */
export interface CharacterInfo {
  status: 'converting' | 'done' | 'failed'
  /** folder with source.png, vector.svg, … (project-relative, e.g. composition/assets/char-ab12) */
  dir: string
  shapes?: number
  /** % of pixels where the SVG differs from the image */
  badPct?: number
  /** within the quality limits */
  pass?: boolean
  /** why it did not pass (Korean, for the designer) */
  reasons?: string[]
  colors?: number
  framing?: Framing
  /** tagged.svg made by Claude */
  tagged?: boolean
  message?: string
}

export const VIDEO_RATIOS = ['16:9', '9:16', '1:1'] as const
export const VIDEO_DURATIONS = [5, 8, 10] as const

/** 소재 > AI로 만들기 > 영상: a clip from a video model, optionally between two images */
export interface VideoGenRequest {
  provider: 'higgsfield' | 'magnific'
  /** service model id ('' = the service's own default) */
  model: string
  modelLabel?: string
  lang: PromptLang
  /** how it moves, exactly as typed */
  prompt: string
  ratio: (typeof VIDEO_RATIOS)[number]
  /** seconds */
  duration: number
  /** first / last frame: project-relative images (composition/assets/… or .studio/generations/<id>/source.png) */
  start?: string
  end?: string
  /** 수정해서 다시 만들기: the designer's change requests, oldest first */
  revision?: string[]
  /** the clip being revised (project-relative; not sent, it tells which asset a revision may replace) */
  revisedFrom?: string
}

const REVISE_WITH_IMAGE: Record<PromptLang, string> = {
  en: 'REVISION: The attached image is the previous version of this image. Keep its subject, composition, framing, style and palette, and change only this:',
  zh: '修改要求：附带的图片是这张图的上一版。保持主体、构图、取景、风格和配色不变，只修改以下内容：',
  ko: '수정 요청: 첨부한 이미지는 이 그림의 이전 결과물이다. 대상·구도·화면 구성·스타일·색감은 그대로 두고 아래만 바꾼다:',
}
const REVISE_TEXT: Record<PromptLang, string> = {
  en: 'REVISION: apply these changes to the description above (later lines win):',
  zh: '修改要求：在上面的描述中加入以下改动（后面的优先）：',
  ko: '수정 요청: 위 설명에 아래 변경을 반영한다 (뒤의 줄이 우선):',
}

/**
 * The change request put after the prompt. With the previous image attached only the newest
 * request is needed (the image already has the earlier ones); without it every request is listed.
 */
export function withRevision(sent: string, lang: PromptLang, revision: string[] | undefined, withImage: boolean): string {
  const notes = (revision ?? []).map((r) => r.trim()).filter(Boolean)
  if (!notes.length) return sent
  const body = withImage ? `${REVISE_WITH_IMAGE[lang]}\n${notes[notes.length - 1]}` : `${REVISE_TEXT[lang]}\n${notes.map((n) => `- ${n}`).join('\n')}`
  return `${sent}\n\n${body}`
}

/** a generated image or clip waiting for the designer to keep or discard it */
export interface GenCandidate {
  id: string
  at: string
  /** project-relative image (.studio/generations/<id>/source.png) */
  file: string
  request: GenRequest
  /** the full prompt that was sent */
  sent: string
  character?: CharacterInfo
  /** a video clip: file is the .mp4, poster a still for the card */
  video?: { request: VideoGenRequest; poster: string; duration?: number }
}
