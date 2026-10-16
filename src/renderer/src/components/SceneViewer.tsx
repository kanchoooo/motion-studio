// 콘티 크게 보기: one scene's sketch filling the window with what the scene says under it.
// ← → (or the side buttons) go through the scenes that have a sketch; Esc or a click outside closes.
// The keys stop here: the editor behind would nudge layers with them.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import type { StoryboardScene } from '@shared/api'

export function SceneViewer({ scenes, n, base, onShow, onClose }: { scenes: StoryboardScene[]; n: number; base: string; onShow(n: number): void; onClose(): void }) {
  const shown = scenes.filter((s) => s.frame)
  const i = Math.max(0, shown.findIndex((s) => s.n === n))
  const s = shown[i]
  const go = (d: number) => shown.length > 1 && onShow(shown[(i + d + shown.length) % shown.length].n)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })
  if (!s) return null
  return createPortal(
    <div className="scrim scene-viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="scene-viewer">
      <button className="icon-btn scene-viewer-close" title="닫기 (Esc)" onClick={onClose} data-testid="scene-viewer-close">
        <X size={20} />
      </button>
      {shown.length > 1 && (
        <button className="icon-btn scene-viewer-nav" style={{ left: 16 }} title="이전 장면 (←)" onClick={() => go(-1)} data-testid="scene-viewer-prev">
          <ChevronLeft size={28} />
        </button>
      )}
      <div className="scene-viewer-body" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <img src={base + s.frame} alt={`${s.n}. ${s.title}`} draggable={false} data-testid="scene-viewer-image" />
        <div className="scene-viewer-info">
          <div className="row" style={{ gap: 10 }}>
            <b className="grow">
              {s.n}. {s.title}
            </b>
            <span className="mono tiny muted">
              {s.from.toFixed(1)}–{s.to.toFixed(1)}s · {i + 1}/{shown.length}
            </span>
          </div>
          {s.description && <div className="small muted" style={{ lineHeight: 1.6 }}>{s.description}</div>}
          {s.texts.length > 0 && <div className="tiny">문구: {s.texts.map((t) => `“${t}”`).join(' · ')}</div>}
          {s.motion && <div className="tiny" style={{ color: 'var(--accent)' }}>모션: {s.motion}</div>}
        </div>
      </div>
      {shown.length > 1 && (
        <button className="icon-btn scene-viewer-nav" style={{ right: 16 }} title="다음 장면 (→)" onClick={() => go(1)} data-testid="scene-viewer-next">
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body,
  )
}

/** the corner mark on a sketch that opens it large */
export function ZoomMark() {
  return (
    <span className="scene-zoom-mark" aria-hidden>
      <Maximize2 size={12} />
    </span>
  )
}
