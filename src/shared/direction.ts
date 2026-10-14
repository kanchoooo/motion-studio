// 영상 템포 · 스타일 (브리프 › 톤앤매너, both optional): words the designer already uses,
// turned into numbers and design rules Claude can plan and be reviewed against. The
// styles build on hyperframes-creative/references/visual-styles.md where one fits.

export type TempoId = 'slow' | 'medium' | 'fast' | 'very-fast'

export interface Tempo {
  id: TempoId
  label: string
  /** shown under the choice */
  hint: string
  /** seconds a shot / beat holds */
  shot: [number, number]
  bpm: [number, number]
  /** for Claude */
  motion: string
}

export const TEMPOS: Tempo[] = [
  { id: 'slow', label: '느림', hint: '장면 3~4초 · 부드럽게 흐르는 전환', shot: [3, 4], bpm: [80, 90], motion: 'reveals 0.8–1.2 s on soft ease-out (power2.out / sine.inOut), crossfades and slow camera drifts, long holds, one thing moves at a time' },
  { id: 'medium', label: '보통', hint: '장면 2~3초 · 컷과 전환을 섞어서', shot: [2, 3], bpm: [100, 110], motion: 'reveals 0.5–0.7 s on power3.out, a mix of cuts and smooth transitions, short holds' },
  { id: 'fast', label: '빠름', hint: '장면 1~1.5초 · 박자에 맞춘 경쾌한 컷', shot: [1, 1.5], bpm: [120, 128], motion: 'reveals 0.3–0.45 s on expo.out / back.out, cuts on the beat, snappy overlapping moves' },
  { id: 'very-fast', label: '매우 빠름', hint: '장면 0.5~1초 · 박자마다 하드컷', shot: [0.5, 1], bpm: [140, 150], motion: 'reveals 0.15–0.3 s, hard / smash cuts on every beat, one word or image per beat, whip and impact accents' },
]

export type StyleId =
  | 'kinetic-type'
  | 'minimal'
  | 'premium'
  | 'soft'
  | 'pop'
  | 'product'
  | 'illustration'
  | '3d-glass'
  | 'retro'
  | 'collage'
  | 'glitch'
  | 'cinematic'
  | 'infographic'
  | 'ui-demo'

export interface MotionStyle {
  id: StyleId
  label: string
  /** shown under the chip */
  desc: string
  /** for Claude: what the style looks and moves like */
  guide: string
  /** a starter in hyperframes-creative/references/visual-styles.md */
  base?: string
  /** find_blocks words for this style */
  search: string[]
}

export const STYLES: MotionStyle[] = [
  { id: 'kinetic-type', label: '키네틱 타이포', desc: '글자가 주인공, 박자마다 꽂히는 문구', guide: 'type is the hero: big bold words that slam, swap, scale and shift weight on the beats; few images; blueprint kinetic-type-beats', base: 'Maximalist Type', search: ['kinetic typography', 'text slam'] },
  { id: 'minimal', label: '미니멀·에디토리얼', desc: '넓은 여백, 정돈된 그리드, 절제된 움직임', guide: 'a strict grid, generous empty space, one or two colours, precise restrained easing, one element moves at a time', base: 'Swiss Pulse', search: ['minimal editorial', 'line reveal'] },
  { id: 'premium', label: '프리미엄·럭셔리', desc: '세리프·빛 반사, 느리고 우아하게', guide: 'slow elegant camera moves, light sweeps and gloss on the product, serif headlines, a rich dark or warm neutral palette, nothing bouncy', base: 'Velvet Standard', search: ['light sweep gloss', 'elegant title'] },
  { id: 'soft', label: '감성·소프트', desc: '파스텔, 부드러운 블러와 떠다니는 움직임', guide: 'warm pastels, soft-focus blur, gentle floating loops, rounded shapes, gentle springs, airy type', base: 'Soft Signal', search: ['soft blur', 'gradient background'] },
  { id: 'pop', label: '팝·컬러풀', desc: '원색, 통통 튀는 스프링, 스티커·도형', guide: 'vivid saturated colours, bouncy back/elastic springs, stickers, badges and simple shapes, confetti accents; fun and festive', base: 'Folk Frequency', search: ['badge pop', 'confetti'] },
  { id: 'product', label: '실사 제품 중심', desc: '제품 사진이 주인공, 카메라 푸시·심도·빛', guide: 'the product photo is the hero: camera push-ins, depth of field, light leaks and sweeps, turntable / parallax; type supports and never covers the product', search: ['product hero', 'light leak'] },
  { id: 'illustration', label: '플랫 일러스트', desc: '벡터 도형·선이 그려지며 등장, 캐릭터', guide: 'flat vector shapes and lines that draw on (svg path draw), simple characters (svg-character-motion skill), bouncy secondary motion, a limited palette', search: ['svg line draw', 'hand drawn'] },
  { id: '3d-glass', label: '3D·글래스', desc: '유리·굴절·입체 오브젝트, 리퀴드', guide: '3D objects, glass and refraction, liquid-glass panels, chrome highlights, slow orbiting cameras', search: ['liquid glass', '3d object'] },
  { id: 'retro', label: '레트로·Y2K', desc: '크롬·그레인·VHS·픽셀, 강한 색', guide: 'chrome type, film grain, VHS lines and scanlines, pixel / dither, bold Y2K colours, stepped stop-motion cadence', search: ['film grain', 'vhs retro'] },
  { id: 'collage', label: '콜라주·페이퍼', desc: '오려 붙인 종이, 손글씨, 스톱모션 리듬', guide: 'paper cut-outs with torn edges and tape, hand-drawn marks and underlines, stop-motion cadence (stepped, slightly jittery)', search: ['paper collage', 'hand drawn underline'] },
  { id: 'glitch', label: '글리치·테크', desc: 'RGB 분리, 노이즈, 하드컷', guide: 'glitch and RGB split, scanlines, digital noise, hard cuts, monospace accents, high contrast', base: 'Deconstructed', search: ['glitch', 'rgb split'] },
  { id: 'cinematic', label: '시네마틱·드라마', desc: '어두운 화면, 강한 대비, 극적인 등장', guide: 'dark frames, strong contrast, light rays, slow push then a dramatic reveal, letterbox framing, weighty type', base: 'Shadow Cut', search: ['cinematic reveal', 'light rays'] },
  { id: 'infographic', label: '데이터·인포그래픽', desc: '숫자 카운트, 차트, 아이콘', guide: 'count-ups, charts that draw themselves, icons, a clean grid; numbers are the hero (data-in-motion.md)', base: 'Swiss Pulse', search: ['count up', 'chart'] },
  { id: 'ui-demo', label: '앱·UI 데모', desc: '폰·화면 목업, 커서·탭 동작', guide: 'device mockups and app screens, a cursor or finger tapping, UI state changes (blueprints cursor-ui-demo, device-surface-showcase)', search: ['device mockup', 'cursor tap'] },
]

export const MAX_STYLES = 2

export const tempoOf = (id?: string) => TEMPOS.find((t) => t.id === id)
export const styleOf = (id?: string) => STYLES.find((s) => s.id === id)

/** only known values, at most MAX_STYLES styles (the first leads) */
export function cleanDirection(tempo: unknown, styles: unknown): { tempo?: TempoId; styles?: StyleId[] } {
  const t = tempoOf(typeof tempo === 'string' ? tempo : undefined)?.id
  const s = Array.isArray(styles) ? [...new Set(styles.filter((x): x is StyleId => typeof x === 'string' && !!styleOf(x)))].slice(0, MAX_STYLES) : []
  return { tempo: t, styles: s.length ? s : undefined }
}

/** Korean labels, e.g. "키네틱 타이포(주) + 감성·소프트" */
export const styleLabels = (ids: StyleId[] = []) => ids.map((id, i) => `${styleOf(id)?.label ?? id}${ids.length > 1 && i === 0 ? '(주)' : ''}`).join(' + ')

/** what Claude gets (BRIEF.md, get_brief); null when the designer left both to Claude */
export function directionForClaude(tempo?: TempoId, styles: StyleId[] = []): { tempo?: string; styles?: string[]; note: string } | null {
  const t = tempoOf(tempo)
  if (!t && !styles.length) return null
  return {
    tempo: t ? `${t.label} (${t.id}): shots ${t.shot[0]}–${t.shot[1]} s, beat grid ${t.bpm[0]}–${t.bpm[1]} BPM; ${t.motion}` : undefined,
    styles: styles.length
      ? styles.map((id, i) => {
          const s = styleOf(id)!
          return `${i === 0 ? (styles.length > 1 ? 'MAIN' : 'STYLE') : 'ACCENT'} ${s.label} (${s.id}): ${s.guide}${s.base ? `; starter: visual-styles.md "${s.base}"` : ''}; find_blocks ideas: ${s.search.map((w) => `"${w}"`).join(', ')}`
        })
      : undefined,
    note: 'The designer chose these in the brief: they are decisions, not hints. Set the beat grid and every shot length inside the tempo range (required texts still keep their minimum time on screen). Build DESIGN.md on the main style; an accent style only adds touches. Write both into STORYBOARD.md and keep them through the build.',
  }
}
