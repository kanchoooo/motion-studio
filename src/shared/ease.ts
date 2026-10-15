// Easing shared by the editor (values between keyframes) and the runtime's notion of them:
// CSS cubic-bezier curves and GSAP's named eases, plus the choices the editor offers.

/** easy ease (After Effects F9) */
export const EASY_EASE = 'cubic-bezier(0.33,0,0.67,1)'

/** cubic-bezier(x1,y1,x2,y2) → its four numbers, or null */
export function parseBezier(e: string | undefined): [number, number, number, number] | null {
  const m = e?.match(/^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null
}

/** CSS-style cubic bezier timing function */
export function bezier(x1: number, y1: number, x2: number, y2: number): (k: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u
  const sy = (u: number) => ((ay * u + by) * u + cy) * u
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx
  return (k: number) => {
    if (k <= 0) return 0
    if (k >= 1) return 1
    let u = k
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - k
      const d = dx(u)
      if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break
      u -= err / d
    }
    if (u < 0 || u > 1) {
      // bisection fallback
      let lo = 0
      let hi = 1
      u = k
      for (let i = 0; i < 30; i++) {
        if (sx(u) < k) lo = u
        else hi = u
        u = (lo + hi) / 2
      }
    }
    return sy(u)
  }
}

const POW = (n: number) => ({
  in: (k: number) => k ** n,
  out: (k: number) => 1 - (1 - k) ** n,
  inOut: (k: number) => (k < 0.5 ? (2 * k) ** n / 2 : 1 - (2 * (1 - k)) ** n / 2),
})

/** an easing function for the editor (approximates GSAP's named eases) */
export function easeFn(e: string | undefined): (k: number) => number {
  const name = (e ?? EASY_EASE).trim()
  if (name === 'linear' || name === 'none') return (k) => k
  if (name === 'hold') return () => 0
  const b = parseBezier(name)
  if (b) return bezier(...b)
  const m = name.match(/^(power([0-4])|quad|cubic|quart|quint|strong|sine|expo|circ|back|elastic|bounce)(?:\.(in|out|inOut))?(?:\(([\d.]+)\))?$/)
  if (!m) return bezier(0.33, 0, 0.67, 1)
  const kind = m[1]
  const dir = (m[3] ?? 'out') as 'in' | 'out' | 'inOut'
  const n = kind.startsWith('power') ? Number(m[2]) + 1 : ({ quad: 2, cubic: 3, quart: 4, quint: 5, strong: 5 } as Record<string, number>)[kind]
  if (n) return n === 1 ? (k) => k : POW(n)[dir]
  const shapes: Record<string, { in: (k: number) => number }> = {
    sine: { in: (k) => 1 - Math.cos((k * Math.PI) / 2) },
    expo: { in: (k) => (k === 0 ? 0 : 2 ** (10 * k - 10)) },
    circ: { in: (k) => 1 - Math.sqrt(1 - k * k) },
    back: { in: (k) => { const s = Number(m[4] ?? 1.70158); return k * k * ((s + 1) * k - s) } },
    elastic: { in: (k) => (k === 0 || k === 1 ? k : -(2 ** (10 * k - 10)) * Math.sin((k * 10 - 10.75) * ((2 * Math.PI) / 3))) },
    bounce: { in: (k) => 1 - bounceOut(1 - k) },
  }
  const f = kind === 'bounce' ? { in: shapes.bounce.in } : shapes[kind]
  if (!f) return (k) => k
  if (dir === 'in') return f.in
  if (dir === 'out') return kind === 'bounce' ? bounceOut : (k) => 1 - f.in(1 - k)
  return (k) => (k < 0.5 ? f.in(2 * k) / 2 : 1 - f.in(2 * (1 - k)) / 2)
}

function bounceOut(k: number): number {
  const n = 7.5625
  const d = 2.75
  if (k < 1 / d) return n * k * k
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375
  return n * (k -= 2.625 / d) * k + 0.984375
}

/** the ease choices the editor offers for a keyframe */
export const KEY_EASES: { value: string; label: string }[] = [
  { value: EASY_EASE, label: '이지 이즈 (F9)' },
  { value: 'linear', label: '직선' },
  { value: 'cubic-bezier(0.33,0,1,1)', label: '이지 인 (천천히 시작)' },
  { value: 'cubic-bezier(0,0,0.67,1)', label: '이지 아웃 (천천히 멈춤)' },
  { value: 'power3.out', label: '빠르게 → 부드럽게' },
  { value: 'expo.out', label: '확 빠르게 → 멈춤' },
  { value: 'back.out(1.7)', label: '살짝 넘쳤다 돌아오기' },
  { value: 'elastic.out', label: '탄성' },
  { value: 'bounce.out', label: '튕기기' },
  { value: 'hold', label: '정지 (다음 키에서 바로 바뀜)' },
]
