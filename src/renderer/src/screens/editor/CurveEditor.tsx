// The speed curve of a keyframe (After Effects' graph editor, simplified): two bezier handles
// shape how the value moves from this key to the next. Value graph: time → progress.
import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { bezier, EASY_EASE, parseBezier } from '@shared/overrides'

const SIZE = 220
const PAD = 24
const PRESETS: [string, string][] = [
  ['이지 이즈', EASY_EASE],
  ['직선', 'cubic-bezier(0,0,1,1)'],
  ['이지 인', 'cubic-bezier(0.33,0,1,1)'],
  ['이지 아웃', 'cubic-bezier(0,0,0.67,1)'],
  ['확 빠르게', 'cubic-bezier(0.16,1,0.3,1)'],
  ['살짝 넘침', 'cubic-bezier(0.34,1.56,0.64,1)'],
]

/** opens next to `at` (the right-clicked keyframe), moved so all of it is on screen */
export function CurveEditor({ value, onApply, onClose, at }: { value: string | undefined; onApply: (ease: string) => void; onClose: () => void; at: { x: number; y: number } }) {
  const [b, setB] = useState<[number, number, number, number]>(parseBezier(value) ?? parseBezier(EASY_EASE)!)
  const svg = useRef<SVGSVGElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const r = card.current!.getBoundingClientRect()
    const fit = (v: number, size: number, room: number) => Math.max(10, Math.min(v, room - size - 10))
    setPos({ left: fit(at.x + 12, r.width, window.innerWidth), top: fit(at.y - r.height / 2, r.height, window.innerHeight) })
  }, [at.x, at.y])
  // graph space: x 0..1 → PAD..PAD+SIZE, y 0..1 → bottom..top (overshoot allowed above / below)
  const gx = (x: number) => PAD + x * SIZE
  const gy = (y: number) => PAD + SIZE - y * SIZE
  const drag = (i: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as SVGElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = svg.current!.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left - PAD) / SIZE))
      const y = Math.max(-0.6, Math.min(1.6, (SIZE + PAD - (ev.clientY - r.top)) / SIZE))
      setB((cur) => {
        const next = [...cur] as [number, number, number, number]
        next[i * 2] = +x.toFixed(2)
        next[i * 2 + 1] = +y.toFixed(2)
        return next
      })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const f = bezier(...b)
  const pts = Array.from({ length: 61 }, (_, i) => i / 60).map((k) => `${gx(k)},${gy(f(k))}`).join(' ')
  const ease = `cubic-bezier(${b.join(',')})`
  return (
    <div
      ref={card}
      className="card fade-in"
      style={{ position: 'fixed', zIndex: 60, padding: 12, boxShadow: 'var(--shadow)', width: SIZE + PAD * 2 + 24, maxHeight: 'calc(100vh - 20px)', overflowY: 'auto', left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? 'visible' : 'hidden' }}
      data-testid="curve-editor"
    >
      <div className="row" style={{ marginBottom: 6 }}>
        <b className="grow">속도 곡선</b>
        <button className="icon-btn" onClick={onClose} title="닫기">
          <X size={14} />
        </button>
      </div>
      <div className="tiny muted" style={{ marginBottom: 6 }}>손잡이를 끌어서 이 키프레임에서 다음 키프레임까지의 속도감을 정해요. 가파를수록 빨라요.</div>
      <svg ref={svg} width={SIZE + PAD * 2} height={SIZE + PAD * 2} style={{ background: 'var(--surface-2)', borderRadius: 6, touchAction: 'none' }}>
        <rect x={PAD} y={PAD} width={SIZE} height={SIZE} fill="none" stroke="var(--border-strong)" />
        <line x1={gx(0)} y1={gy(0)} x2={gx(b[0])} y2={gy(b[1])} stroke="var(--accent)" strokeWidth={1} />
        <line x1={gx(1)} y1={gy(1)} x2={gx(b[2])} y2={gy(b[3])} stroke="var(--accent)" strokeWidth={1} />
        <polyline points={pts} fill="none" stroke="var(--warning)" strokeWidth={2} />
        <circle cx={gx(b[0])} cy={gy(b[1])} r={7} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={drag(0)} data-testid="curve-h1" />
        <circle cx={gx(b[2])} cy={gy(b[3])} r={7} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={drag(1)} data-testid="curve-h2" />
      </svg>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4, margin: '8px 0' }}>
        {PRESETS.map(([label, v]) => (
          <button key={label} className="btn ghost sm" style={{ height: 22 }} onClick={() => setB(parseBezier(v)!)}>
            {label}
          </button>
        ))}
      </div>
      <div className="row">
        <span className="mono tiny faint grow">{ease}</span>
        <button className="btn sm primary" onClick={() => onApply(ease)} data-testid="curve-apply">
          적용
        </button>
      </div>
    </div>
  )
}
