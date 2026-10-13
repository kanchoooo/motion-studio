import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Gauge, Music, Pause, Play, SkipBack, Trash2, Volume2, X } from 'lucide-react'
import type { TimeRemapSection } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { formatTime, Toggle } from '../../components/ui'
import { useStore } from '../../store'
import { useEditor } from './editorStore'
import { useOverrides } from './overrides'

const SPEEDS = [0.5, 0.75, 1.25, 1.5, 2, 3]

export function Transport() {
  const { project } = useStore()
  const { player, time, duration, playing, marks, audio, selectedAudio, timing, selected } = useEditor()
  const { value: ov, setRemap, patchElement } = useOverrides()
  const [dragBar, setDragBar] = useState<{ id: string; dx: number } | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [rangeMode, setRangeMode] = useState(false)
  const [sel, setSel] = useState<{ a: number; b: number; index?: number } | null>(null)
  const [speed, setSpeed] = useState(1.5)
  const fps = project?.brief.output.fps ?? 30
  const authoredD = project?.brief.output.duration ?? 1
  const d = duration || authoredD
  const sections = ov?.timeRemap ?? []
  const keepTotal = ov?.keepTotalDuration ?? true
  const map = makeTimeMap(authoredD, sections)

  const seek = (t: number) => {
    player?.pause()
    player?.seek(Math.max(0, Math.min(d, t)))
  }
  const posToTime = (x: number) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(d, ((x - r.left) / r.width) * d))
  }

  const onDown = (e: React.PointerEvent) => {
    const el = bar.current!
    el.setPointerCapture(e.pointerId)
    if (rangeMode) {
      const t0 = posToTime(e.clientX)
      setSel({ a: t0, b: t0 })
      const move = (ev: PointerEvent) => setSel({ a: t0, b: posToTime(ev.clientX) })
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      return
    }
    seek(posToTime(e.clientX))
    const move = (ev: PointerEvent) => seek(posToTime(ev.clientX))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const apply = () => {
    if (!sel) return
    const lo = Math.min(sel.a, sel.b)
    const hi = Math.max(sel.a, sel.b)
    if (hi - lo < 0.1) return
    // the bar shows output time; sections are stored in authored time
    const section: TimeRemapSection = { from: +map.toAuthored(lo).toFixed(3), to: +map.toAuthored(hi).toFixed(3), speed }
    const rest = sections.filter((s, i) => i !== sel.index && (s.to <= section.from || s.from >= section.to))
    setRemap([...rest, section].sort((a, b) => a.from - b.from), keepTotal, `구간 속도: ${section.from.toFixed(1)}~${section.to.toFixed(1)}초 ${speed}배`)
    setSel(null)
    setRangeMode(false)
  }
  const removeSection = (index: number) => {
    setRemap(sections.filter((_, i) => i !== index), keepTotal, '구간 속도 삭제')
    setSel(null)
  }

  const ticks = Math.min(60, Math.ceil(d))
  const pct = (t: number) => `${(t / d) * 100}%`

  return (
    <div className="col" style={{ gap: 6, padding: '8px 14px 12px', position: 'relative' }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn" title="처음으로" onClick={() => seek(0)} disabled={!player}>
          <SkipBack size={15} />
        </button>
        <button className="icon-btn" title="이전 프레임 (←)" onClick={() => seek(time - 1 / fps)} disabled={!player}>
          <ChevronLeft size={16} />
        </button>
        <button
          className="icon-btn"
          title="재생/정지 (Space)"
          style={{ width: 36, height: 36, background: 'var(--surface-3)', color: 'var(--text)' }}
          onClick={() => (playing ? player?.pause() : player?.play())}
          disabled={!player}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="icon-btn" title="다음 프레임 (→)" onClick={() => seek(time + 1 / fps)} disabled={!player}>
          <ChevronRight size={16} />
        </button>
        <div className="mono small" style={{ marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--text)' }}>{formatTime(time)}</span>
          <span className="faint"> / {formatTime(d)}</span>
        </div>
        <div className="grow" />
        <button
          className={`btn sm${rangeMode ? ' primary' : ' ghost'}`}
          disabled={!project?.hasVideo}
          title="재생바에서 구간을 드래그해서 그 부분만 빠르게/느리게 바꿔요"
          onClick={() => {
            setRangeMode(!rangeMode)
            setSel(null)
          }}
        >
          <Gauge size={13} />
          {rangeMode ? '구간을 드래그하세요' : '구간 속도'}
        </button>
        <span className="tiny faint">{fps}fps</span>
      </div>
      <div
        ref={bar}
        data-testid="timeline-bar"
        onPointerDown={onDown}
        style={{ position: 'relative', height: 30, cursor: rangeMode ? 'col-resize' : 'pointer', borderRadius: 6, background: 'var(--surface-2)', border: `1px solid ${rangeMode ? 'var(--accent)' : 'var(--border)'}` }}
      >
        {/* speed sections (drawn in output time) */}
        {sections.map((s, i) => {
          const a = map.toOutput(s.from)
          const b = map.toOutput(s.to)
          return (
            <div
              key={i}
              onPointerDown={(e) => {
                e.stopPropagation()
                setSpeed(s.speed)
                setSel({ a, b, index: i })
              }}
              title="클릭해서 수정"
              style={{ position: 'absolute', left: pct(a), width: `calc(${pct(b - a)})`, top: 0, bottom: 0, background: s.speed > 1 ? 'rgba(91,127,255,0.22)' : 'rgba(245,165,36,0.22)', borderLeft: '1px solid var(--accent)', borderRight: '1px solid var(--accent)', cursor: 'pointer' }}
            >
              <span className="tiny" style={{ position: 'absolute', right: 4, top: 1, fontWeight: 700, color: s.speed > 1 ? 'var(--accent)' : 'var(--warning)' }}>
                {s.speed}×
              </span>
            </div>
          )
        })}
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(i / ticks) * 100}%`, bottom: 0, height: i % 5 === 0 ? 10 : 5, width: 1, background: 'var(--border-strong)', pointerEvents: 'none' }}>
            {i % 5 === 0 && i < ticks && (
              <span className="tiny faint" style={{ position: 'absolute', left: 3, bottom: 8 }}>
                {Math.round((i / ticks) * d)}s
              </span>
            )}
          </div>
        ))}
        {sel && (
          <div style={{ position: 'absolute', left: pct(Math.min(sel.a, sel.b)), width: pct(Math.abs(sel.b - sel.a)), top: 0, bottom: 0, background: 'var(--accent-soft)', border: '1px solid var(--accent)', pointerEvents: 'none' }} />
        )}
        {marks.map((m) => (
          <div key={m.id} title={`${m.n}번 표시`} style={{ position: 'absolute', left: pct(m.time), top: 2, width: 8, height: 8, marginLeft: -4, borderRadius: 4, background: 'var(--mark)', pointerEvents: 'none' }} />
        ))}
        <div style={{ position: 'absolute', left: pct(time), top: -3, bottom: -3, width: 2, marginLeft: -1, background: 'var(--accent)', borderRadius: 2, pointerEvents: 'none' }} />
      </div>

      {timing.filter((t) => t.type !== 'sfx' && t.type !== 'bgm').length > 0 && (
        <div className="col" style={{ gap: 2, maxHeight: 112, overflowY: 'auto', paddingRight: 2 }}>
          {timing
            .filter((t) => t.type !== 'sfx' && t.type !== 'bgm')
            .sort((a, b) => a.start - b.start)
            .map((t) => {
              const end = t.end ?? d
              const shiftPx = dragBar?.id === t.id ? dragBar.dx : 0
              const sel = selected === t.id
              return (
                <div key={t.id} style={{ position: 'relative', height: 14 }}>
                  <div
                    title={`${t.label} · ${t.start.toFixed(2)}~${end.toFixed(2)}초 · 끌어서 등장 시점 옮기기`}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      const el = e.currentTarget
                      el.setPointerCapture(e.pointerId)
                      const x0 = e.clientX
                      const width = bar.current!.getBoundingClientRect().width
                      useEditor.setState({ selected: t.id, panel: 'elements' })
                      const move = (ev: PointerEvent) => setDragBar({ id: t.id, dx: ev.clientX - x0 })
                      const up = (ev: PointerEvent) => {
                        el.removeEventListener('pointermove', move)
                        el.removeEventListener('pointerup', up)
                        setDragBar(null)
                        const delta = ((ev.clientX - x0) / width) * d
                        if (Math.abs(delta) < 0.03) return
                        const prev = ov?.elements[t.id]?.timing?.shift ?? 0
                        patchElement(t.id, t.label, { timing: { shift: +(prev + delta).toFixed(2) } }, ['shift'])
                      }
                      el.addEventListener('pointermove', move)
                      el.addEventListener('pointerup', up)
                    }}
                    className="ellipsis"
                    style={{
                      position: 'absolute',
                      left: `calc(${pct(Math.max(0, t.start))} + ${shiftPx}px)`,
                      width: pct(Math.max(0.05, Math.min(d, end) - Math.max(0, t.start))),
                      top: 0,
                      height: 14,
                      borderRadius: 3,
                      background: sel ? 'var(--accent)' : 'var(--accent-soft)',
                      color: sel ? 'var(--accent-text)' : 'var(--accent)',
                      fontSize: 10,
                      lineHeight: '14px',
                      padding: '0 5px',
                      cursor: 'grab',
                      userSelect: 'none',
                    }}
                  >
                    {t.label}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {audio.length > 0 && (
        <div className="col" style={{ gap: 3 }}>
          {audio.some((a) => a.kind === 'bgm') && (
            <div style={{ position: 'relative', height: 16 }} title="배경음악">
              <Music size={11} style={{ position: 'absolute', left: -13, top: 2, color: 'var(--text-3)' }} />
              {audio
                .filter((a) => a.kind === 'bgm')
                .map((a) => (
                  <div
                    key={a.id}
                    title={`${a.label} · ${a.start.toFixed(1)}초~`}
                    onClick={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
                    className="ellipsis"
                    style={{
                      position: 'absolute',
                      left: pct(a.start),
                      width: pct(Math.min(d - a.start, a.duration ?? d - a.start)),
                      top: 0,
                      height: 16,
                      borderRadius: 4,
                      background: a.volume === 0 ? 'var(--surface-3)' : 'rgba(52,194,122,0.22)',
                      border: `1px solid ${selectedAudio === a.id ? 'var(--success)' : 'transparent'}`,
                      color: 'var(--success)',
                      fontSize: 10,
                      lineHeight: '14px',
                      padding: '0 5px',
                      cursor: 'pointer',
                    }}
                  >
                    {a.label}
                  </div>
                ))}
            </div>
          )}
          {audio.some((a) => a.kind === 'sfx') && (
            <div style={{ position: 'relative', height: 16 }} title="효과음">
              <Volume2 size={11} style={{ position: 'absolute', left: -13, top: 2, color: 'var(--text-3)' }} />
              {audio
                .filter((a) => a.kind === 'sfx')
                .map((a) => (
                  <div
                    key={a.id}
                    title={`${a.label} · ${a.start.toFixed(2)}초`}
                    onClick={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
                    style={{
                      position: 'absolute',
                      left: pct(map.toOutput(a.start)),
                      top: 2,
                      width: 12,
                      height: 12,
                      marginLeft: -6,
                      transform: 'rotate(45deg)',
                      borderRadius: 2,
                      background: a.volume === 0 ? 'var(--surface-3)' : selectedAudio === a.id ? 'var(--warning)' : 'rgba(245,165,36,0.7)',
                      cursor: 'pointer',
                    }}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {sel && Math.abs(sel.b - sel.a) >= 0.1 && (
        <div className="card fade-in" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', padding: 12, boxShadow: 'var(--shadow)', zIndex: 10, width: 380 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 650 }}>
              {Math.min(sel.a, sel.b).toFixed(1)}초 ~ {Math.max(sel.a, sel.b).toFixed(1)}초 속도
            </span>
            <div className="grow" />
            <button className="icon-btn" onClick={() => setSel(null)}>
              <X size={14} />
            </button>
          </div>
          <div className="seg full" style={{ marginBottom: 10 }}>
            {SPEEDS.map((v) => (
              <button key={v} className={v === speed ? 'on' : ''} onClick={() => setSpeed(v)}>
                {v}×
              </button>
            ))}
          </div>
          <div className="row small" style={{ marginBottom: 10 }}>
            <Toggle on={keepTotal} onChange={(v) => setRemap(sections, v, v ? '총 길이 유지' : '총 길이 변경 허용')} />
            <span className="grow">총 길이 유지 {keepTotal ? '— 남는 시간은 마지막 장면을 늘려 채워요' : '— 영상 길이가 바뀌어요'}</span>
          </div>
          <div className="row">
            {sel.index != null && (
              <button className="btn sm danger" onClick={() => removeSection(sel.index!)}>
                <Trash2 size={13} />
                구간 삭제
              </button>
            )}
            <div className="grow" />
            <button className="btn sm primary" onClick={apply}>
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
