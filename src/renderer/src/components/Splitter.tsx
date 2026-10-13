// Drag handle between two panels. `dir="x"` is a vertical bar resizing widths,
// `dir="y"` a horizontal bar resizing heights. Double-click restores the default.
export function Splitter({
  dir,
  value,
  onChange,
  invert = false,
  onReset,
  title = '끌어서 크기 조절 · 두 번 클릭하면 기본 크기',
}: {
  dir: 'x' | 'y'
  value: number
  onChange(v: number): void
  /** the panel grows when dragging left/up (it sits right of / below the bar) */
  invert?: boolean
  onReset?(): void
  title?: string
}) {
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
    const start = dir === 'x' ? e.clientX : e.clientY
    const v0 = value
    document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize'
    const move = (ev: PointerEvent) => {
      const d = (dir === 'x' ? ev.clientX : ev.clientY) - start
      onChange(v0 + (invert ? -d : d))
    }
    const up = () => {
      el.classList.remove('dragging')
      document.body.style.cursor = ''
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return <div className={`splitter splitter-${dir}`} role="separator" aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'} title={title} onPointerDown={onDown} onDoubleClick={onReset} />
}
