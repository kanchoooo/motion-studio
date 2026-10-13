// Designer-facing names for GSAP motions: property labels, easing presets
// with curve previews, and value parsing that keeps the authored unit.
import gsap from 'gsap'
import type { RuntimeMotion } from './player'

export const PROP_LABEL: Record<string, string> = {
  x: '가로 이동',
  y: '세로 이동',
  xPercent: '가로 이동(%)',
  yPercent: '세로 이동(%)',
  opacity: '투명도',
  autoAlpha: '투명도',
  scale: '크기',
  scaleX: '가로 크기',
  scaleY: '세로 크기',
  rotation: '회전',
  rotate: '회전',
  rotationX: '앞뒤 회전',
  rotationY: '좌우 회전',
  skewX: '가로 기울기',
  skewY: '세로 기울기',
  width: '너비',
  height: '높이',
  left: '왼쪽 위치',
  top: '위쪽 위치',
  filter: '필터',
  clipPath: '잘라내기',
  backgroundColor: '배경색',
  color: '글자색',
  borderRadius: '모서리',
  letterSpacing: '자간',
  transformOrigin: '기준점',
  strokeDashoffset: '선 그리기',
  drawSVG: '선 그리기',
  text: '글자',
  attr: '속성',
}

export const propLabel = (p: string) => PROP_LABEL[p] ?? p

const KIND: Record<RuntimeMotion['type'], string> = { from: '등장', to: '변화', fromTo: '변화' }

export function motionLabel(m: Pick<RuntimeMotion, 'type' | 'props'>): string {
  const names = [...new Set(m.props.map((p) => propLabel(p.name)))]
  return `${KIND[m.type]} · ${names.slice(0, 3).join('·')}${names.length > 3 ? ` 외 ${names.length - 3}` : ''}`
}

export interface EasePreset {
  value: string
  label: string
}

export const EASES: EasePreset[] = [
  { value: 'none', label: '일정하게' },
  { value: 'power1.out', label: '살짝 감속' },
  { value: 'power2.out', label: '부드럽게 감속' },
  { value: 'power3.out', label: '강하게 감속' },
  { value: 'power4.out', label: '아주 강하게 감속' },
  { value: 'expo.out', label: '빠르게 들어와 멈춤' },
  { value: 'circ.out', label: '둥글게 감속' },
  { value: 'sine.out', label: '은은하게 감속' },
  { value: 'back.out(1.7)', label: '살짝 넘쳤다 제자리' },
  { value: 'elastic.out(1,0.4)', label: '탄성' },
  { value: 'bounce.out', label: '통통 튀기' },
  { value: 'power1.in', label: '살짝 가속' },
  { value: 'power2.in', label: '부드럽게 가속' },
  { value: 'power3.in', label: '강하게 가속' },
  { value: 'expo.in', label: '천천히 출발해 빠르게' },
  { value: 'back.in(1.7)', label: '살짝 물러났다 출발' },
  { value: 'power1.inOut', label: '살짝 가속·감속' },
  { value: 'power2.inOut', label: '부드럽게 가속·감속' },
  { value: 'power3.inOut', label: '강하게 가속·감속' },
  { value: 'expo.inOut', label: '극적인 가속·감속' },
  { value: 'sine.inOut', label: '은은한 가속·감속' },
  { value: 'back.inOut(1.7)', label: '넘쳤다 돌아오는 가속·감속' },
]

/** GSAP's default when a tween names no ease */
export const DEFAULT_EASE = 'power1.out'

export function easeLabel(ease: string): string {
  const e = ease || DEFAULT_EASE
  return EASES.find((x) => x.value === e)?.label ?? e
}

/** SVG path of an ease on a w×h box (y grows upward), with headroom for overshoot */
export function easePath(ease: string, w: number, h: number, pad = 0.2): string {
  let fn: (t: number) => number
  try {
    fn = gsap.parseEase(ease || DEFAULT_EASE) as (t: number) => number
  } catch {
    fn = (t) => t
  }
  const span = 1 + pad * 2
  const pts: string[] = []
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const v = fn(t)
    pts.push(`${(t * w).toFixed(1)},${(h - ((v + pad) / span) * h).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
}

/** "120px" → { n: 120, unit: "px" }; non-numeric values are not editable */
export function parseValue(v: number | string | undefined): { n: number; unit: string } | null {
  if (typeof v === 'number') return { n: v, unit: '' }
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i)
  return m ? { n: Number(m[1]), unit: m[2] } : null
}

export const formatValue = (n: number, unit: string): number | string => (unit ? `${n}${unit}` : n)
