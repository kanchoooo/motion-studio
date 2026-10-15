import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={`toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
  testId,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  full?: boolean
  testId?: string
}) {
  return (
    <div className={`seg${full ? ' full' : ''}`} data-testid={testId}>
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** number input whose label can be dragged left/right to scrub the value (Figma style) */
export function NumberField({
  value,
  onChange,
  label,
  unit,
  step = 1,
  min,
  max,
  precision = 0,
  title,
}: {
  value: number | undefined
  onChange: (v: number) => void
  label?: ReactNode
  unit?: string
  step?: number
  min?: number
  max?: number
  precision?: number
  title?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  const round = (v: number) => Number(v.toFixed(precision))
  /** what was typed, once it is a change (a click in and out of the field changes nothing) */
  const commit = (s: string) => {
    const typed = draft !== null
    setDraft(null)
    if (!typed) return
    const v = parseFloat(s)
    if (!Number.isFinite(v)) return
    const next = round(clamp(v))
    if (value != null && next === round(value)) return
    onChange(next)
  }
  const startScrub = (e: React.PointerEvent) => {
    const startX = e.clientX
    const start = value ?? 0
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
      onChange(round(clamp(start + Math.round((ev.clientX - startX) / 2) * step * mult)))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div className="num" title={title}>
      {label != null && (
        <span className="scrub" onPointerDown={startScrub}>
          {label}
        </span>
      )}
      <input
        value={draft ?? (value == null ? '' : String(round(value)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            onChange(round(clamp((value ?? 0) + d)))
            setDraft(null)
          }
        }}
        inputMode="decimal"
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
        <header>
          <div className="title grow">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  /** a heading above a group of items (not clickable) */
  heading?: boolean
  /** shown as the current one */
  active?: boolean
  onHover?: (on: boolean) => void
  testId?: string
}

export function Menu({ items, onClose, style }: { items: MenuItem[]; onClose: () => void; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => window.addEventListener('mousedown', h), 0)
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div className="menu fade-in" ref={ref} style={style}>
      {items.map((it, i) =>
        it.heading ? (
          <div key={i} className="menu-heading">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            className={`${it.danger ? 'danger' : ''}${it.active ? ' active' : ''}`}
            onMouseEnter={() => it.onHover?.(true)}
            onMouseLeave={() => it.onHover?.(false)}
            onClick={() => {
              it.onHover?.(false)
              onClose()
              it.onClick()
            }}
            data-testid={it.testId}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        type="color"
        value={/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value.slice(0, 7) : '#000000'}
        // the picker has no transparency: keep the one the colour had
        onChange={(e) => onChange(e.target.value + (/^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : ''))}
        style={{ width: 32, height: 30, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer' }}
      />
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} style={{ height: 30 }} />
    </div>
  )
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`
  return `${(n / 1024 ** 3).toFixed(2)}GB`
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
}

export function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}
