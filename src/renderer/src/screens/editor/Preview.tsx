import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Loader2 } from 'lucide-react'
import { studio, useStore } from '../../store'
import { elementsForMark, elementsUnder, useEditor } from './editorStore'
import { useOverrides } from './overrides'
import { MsPlayer, queryElements, queryTiming } from './player'

const SAFE: Record<string, { top: number; right: number; bottom: number; left: number } | null> = {
  none: null,
  youtube: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  shorts: { top: 0.12, right: 0.18, bottom: 0.25, left: 0.05 },
  reels: { top: 0.13, right: 0.12, bottom: 0.3, left: 0.06 },
  tiktok: { top: 0.13, right: 0.17, bottom: 0.27, left: 0.06 },
}

export function Preview({ active }: { active: boolean }) {
  const { project, previewNonce, session } = useStore()
  const ed = useEditor()
  const host = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MsPlayer | null>(null)
  const [frame, setFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef<{ id: string; label: string; px: number; py: number; x: number; y: number; moved: boolean } | null>(null)
  const pid = project!.meta.id
  const out = project!.brief.output

  // ---- mount / reload the preview iframe ----
  useEffect(() => {
    if (!project?.hasVideo) return
    let disposed = false
    let player: MsPlayer | null = null
    void (async () => {
      const { src } = await studio.projects.previewUrl(pid)
      if (disposed || !host.current) return
      const keepTime = useEditor.getState().time
      player = new MsPlayer(`${src}?ms-preview=1&v=${previewNonce}`, out.width, out.height, {
        ready: (duration) => {
          useEditor.setState({ ready: true, duration: duration || out.duration })
          void studio.projects.audio(pid).then((audio) => useEditor.setState({ audio }))
          void queryTiming(player).then((timing) => useEditor.setState({ timing }))
          if (keepTime > 0) player!.seek(Math.min(keepTime, duration || keepTime))
          setTimeout(refreshElements, 150)
          setError(null)
        },
        state: (st) => useEditor.setState({ time: st.time, duration: st.duration || out.duration, playing: st.playing }),
        error: (msg) => setError(msg),
      })
      const slot = host.current.querySelector('[data-iframe-slot]')
      slot?.replaceChildren(player.iframe)
      playerRef.current = player
      useEditor.setState({ player, ready: false, playing: false, comp: { w: out.width, h: out.height } })
    })()
    return () => {
      disposed = true
      player?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, previewNonce, project?.hasVideo, out.width, out.height])

  // ---- where the video actually sits inside the host (letterboxed) ----
  const measure = useCallback(() => {
    const h = host.current
    if (!h) return
    const r = h.getBoundingClientRect()
    const s = Math.min(r.width / out.width, r.height / out.height)
    const w = out.width * s
    const hh = out.height * s
    setFrame({ x: (r.width - w) / 2, y: (r.height - hh) / 2, w, h: hh })
  }, [out.width, out.height])
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (host.current) ro.observe(host.current)
    return () => ro.disconnect()
  }, [measure, active])

  // ---- element boxes follow the playhead when paused ----
  const refreshElements = useCallback(async () => {
    const els = await queryElements(playerRef.current)
    useEditor.setState({ elements: els })
    void studio.projects.reportElements(pid, els.map((e) => ({ id: e.id, label: e.label, movable: e.movable })))
  }, [pid])
  useEffect(() => {
    if (!ed.playing) void refreshElements()
  }, [ed.time, ed.playing, refreshElements])

  const scale = frame ? frame.w / out.width : 1
  const toComp = (clientX: number, clientY: number) => {
    const r = host.current!.getBoundingClientRect()
    return { x: (clientX - r.left - frame!.x) / scale, y: (clientY - r.top - frame!.y) / scale }
  }

  // ---- pointer handling for select / box / pin ----
  const onDown = (e: React.PointerEvent) => {
    if (!frame || ed.tool === 'select') {
      if (ed.tool === 'select' && frame) {
        const p = toComp(e.clientX, e.clientY)
        const hits = elementsUnder(ed.elements, { x: p.x, y: p.y, w: 1, h: 1 })
        // keep the current selection when clicking inside it, so it can be dragged
        const hit = hits.find((h) => h.id === ed.selected) ?? hits[0]
        useEditor.setState({ selected: hit?.id ?? null })
        const el = hit && ed.elements.find((x) => x.id === hit.id)
        if (el?.movable) {
          playerRef.current?.pause()
          const t = useOverrides.getState().value?.elements[el.id]?.transform ?? {}
          drag.current = { id: el.id, label: el.label, px: p.x, py: p.y, x: t.x ?? 0, y: t.y ?? 0, moved: false }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }
      }
      return
    }
    playerRef.current?.pause()
    const p = toComp(e.clientX, e.clientY)
    if (ed.tool === 'pin') {
      ed.addMark({ kind: 'pin', rect: { x: p.x, y: p.y, w: 0, h: 0 }, time: ed.time, note: '', elements: elementsUnder(ed.elements, { x: p.x, y: p.y, w: 1, h: 1 }).slice(0, 1) })
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) {
      const p = toComp(e.clientX, e.clientY)
      const dx = Math.round(p.x - d.px)
      const dy = Math.round(p.y - d.py)
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return
      d.moved = true
      // Shift locks to one axis, like design tools
      const lockX = e.shiftKey && Math.abs(dy) > Math.abs(dx)
      const lockY = e.shiftKey && !lockX
      useOverrides.getState().patchElement(d.id, d.label, { transform: { x: lockX ? d.x : d.x + dx, y: lockY ? d.y : d.y + dy } }, ['x', 'y'])
      return
    }
    if (!draft) return
    const p = toComp(e.clientX, e.clientY)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }
  const onUp = () => {
    if (drag.current) {
      drag.current = null
      return
    }
    if (!draft) return
    const rect = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) }
    setDraft(null)
    if (rect.w < 6 || rect.h < 6) return
    ed.addMark({ kind: 'box', rect, time: ed.time, note: '', elements: elementsForMark(ed.elements, rect, { w: out.width, h: out.height }).slice(0, 3) })
  }

  if (!project?.hasVideo) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="icon">
          <Clapperboard size={22} />
        </div>
        <div className="title" style={{ color: 'var(--text)' }}>아직 영상이 없어요</div>
        <div style={{ maxWidth: 360 }}>
          왼쪽 대화창에서 Claude에게 영상을 요청해 보세요. 브리프를 바탕으로 <b>콘티</b>를 먼저 보여드려요.
        </div>
        {session.status === 'starting' && (
          <div className="row small muted">
            <Loader2 size={13} className="spin" />
            Claude를 연결하고 있어요
          </div>
        )}
      </div>
    )
  }

  const sel = ed.elements.find((x) => x.id === ed.selected)
  const safe = SAFE[out.safeZone]
  const markMode = ed.tool !== 'select'
  const visibleMarks = ed.marks.filter((m) => ed.markTime == null || Math.abs(m.time - ed.time) < 0.05 || !ed.ready)

  return (
    <div ref={host} data-preview-host style={{ position: 'absolute', inset: 0 }}>
      <div
        data-iframe-slot
        style={{
          position: 'absolute',
          left: frame?.x ?? 0,
          top: frame?.y ?? 0,
          width: out.width,
          height: out.height,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          overflow: 'clip',
          visibility: frame ? undefined : 'hidden',
        }}
      />
      {error && <div className="empty" style={{ position: 'absolute', inset: 0 }}>{error}</div>}
      {frame && (
        <div
          data-capture-frame
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h, cursor: markMode ? 'crosshair' : 'default', zIndex: 2 }}
        >
          {/* safe zone */}
          {safe && (
            <div
              style={{
                position: 'absolute',
                left: `${safe.left * 100}%`,
                top: `${safe.top * 100}%`,
                right: `${safe.right * 100}%`,
                bottom: `${safe.bottom * 100}%`,
                border: '1px dashed rgba(255,255,255,0.35)',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* hover/selection boxes */}
          {!markMode && !ed.playing &&
            ed.elements
              .filter((x) => x.visible)
              .map((x) => (
                <div
                  key={x.id}
                  title={x.label}
                  style={{
                    position: 'absolute',
                    left: x.rect.x * scale,
                    top: x.rect.y * scale,
                    width: x.rect.w * scale,
                    height: x.rect.h * scale,
                    outline: x.id === ed.selected ? '2px solid var(--accent)' : '1px solid transparent',
                    pointerEvents: 'none',
                  }}
                  className="el-box"
                />
              ))}
          {sel && !markMode && !ed.playing && (
            <div className="badge accent" style={{ position: 'absolute', left: sel.rect.x * scale, top: Math.max(0, sel.rect.y * scale - 24), pointerEvents: 'none' }}>
              {sel.label}
            </div>
          )}
          {/* markup */}
          {visibleMarks.map((m) =>
            m.kind === 'pin' ? (
              <div key={m.id} className="mark-pin" style={{ left: m.rect!.x * scale, top: m.rect!.y * scale }}>
                {m.n}
              </div>
            ) : (
              <div key={m.id} className="mark-box" style={{ left: m.rect!.x * scale, top: m.rect!.y * scale, width: m.rect!.w * scale, height: m.rect!.h * scale }}>
                <span>{m.n}</span>
              </div>
            ),
          )}
          {draft && (
            <div
              className="mark-box"
              style={{
                left: Math.min(draft.x0, draft.x1) * scale,
                top: Math.min(draft.y0, draft.y1) * scale,
                width: Math.abs(draft.x1 - draft.x0) * scale,
                height: Math.abs(draft.y1 - draft.y0) * scale,
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** captures the video frame with the marks drawn on it (PNG data URL) */
export async function captureAnnotatedFrame(): Promise<string | undefined> {
  const el = document.querySelector('[data-capture-frame]') as HTMLElement | null
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  return studio.app.capture({ x: r.left, y: r.top, width: r.width, height: r.height })
}
