// After Effects–style timeline: transport, ruler (seek, section speed), layers
// in their group hierarchy with the time each one is on screen, every authored
// motion as a block (drag = start, right edge = length) and the audio lanes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Gauge,
  Image as ImageIcon,
  Layers,
  Lock,
  Mic,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  SkipBack,
  Trash2,
  Type,
  Video,
  Volume2,
  X,
} from 'lucide-react'
import type { TimeRemapSection } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { Splitter } from '../../components/Splitter'
import { formatTime, Toggle } from '../../components/ui'
import { useStore } from '../../store'
import { useEditor } from './editorStore'
import { clampSize, LAYOUT_DEFAULTS, useLayout } from './layout'
import { motionLabel } from './motionInfo'
import { useOverrides } from './overrides'
import type { RuntimeMotion } from './player'

const SPEEDS = [0.5, 0.75, 1.25, 1.5, 2, 3]
const ICON: Record<string, typeof Type> = { text: Type, image: ImageIcon, shape: Box, video: Video, group: Layers }

type Drag =
  | { kind: 'motion'; key: string; mode: 'move' | 'len'; dx: number }
  | { kind: 'layer'; id: string; dx: number }

export function Timeline() {
  const { project } = useStore()
  const ed = useEditor()
  const { player, time, duration, playing, marks, audio, selectedAudio, timing, selection, elements, motions, selectedMotion, openLayers } = ed
  const { value: ov, setRemap, patchElement, patchElements, patchMotion } = useOverrides()
  const { layerW, zoom, set: setLayout } = useLayout()
  const scroller = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [rangeMode, setRangeMode] = useState(false)
  const [sel, setSel] = useState<{ a: number; b: number; index?: number } | null>(null)
  const [speed, setSpeed] = useState(1.5)

  const fps = project?.brief.output.fps ?? 30
  const authoredD = project?.brief.output.duration ?? 1
  const d = duration || authoredD
  const sections = ov?.timeRemap ?? []
  const keepTotal = ov?.keepTotalDuration ?? true
  const map = useMemo(() => makeTimeMap(authoredD, sections), [authoredD, sections])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const trackW = Math.max(200, (viewW - layerW - 2) * zoom)
  const px = (t: number) => (t / d) * trackW
  const tFromX = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect()
    const x = clientX - r.left + scroller.current!.scrollLeft - layerW
    return Math.max(0, Math.min(d, (x / trackW) * d))
  }

  // keep the playhead in view while playing when zoomed in
  useEffect(() => {
    const el = scroller.current
    if (!el || zoom <= 1 || !playing) return
    const x = px(time)
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - layerW - 40) el.scrollLeft = Math.max(0, x - 80)
  }, [time, playing, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (t: number) => {
    player?.pause()
    const at = Math.max(0, Math.min(d, t))
    player?.seek(at)
    // the playhead and timecode follow the pointer at once; the frame catches up
    useEditor.setState({ time: at })
  }

  // ---- scrubbing: ruler, playhead head or line (one seek per frame while dragging) ----
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    useEditor.setState({ scrubbing: true })
    let want = tFromX(e.clientX)
    let raf = 0
    const flush = () => {
      raf = 0
      seek(want)
    }
    flush()
    const move = (ev: PointerEvent) => {
      want = tFromX(ev.clientX)
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (raf) cancelAnimationFrame(raf)
      seek(want)
      useEditor.setState({ scrubbing: false })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  /** layer click: Shift/⌘ adds or removes it, a click on the only selected layer clears the selection */
  const pickLayer = (id: string, e: React.MouseEvent | React.PointerEvent) => {
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    if (!add && selection.length === 1 && selection[0] === id) ed.select(null)
    else ed.select(id, add)
    useEditor.setState({ selectedMotion: null, panel: 'elements' })
  }

  // ---- layer tree (document order already lists parents before children) ----
  const layers = elements.filter((e) => !['sfx', 'bgm', 'voice'].includes(e.type))
  const timingById = new Map(timing.map((t) => [t.id, t]))
  const motionsOf = (id: string) => motions.filter((m) => m.owners[0] === id).sort((a, b) => a.start - b.start)
  const toggleOpen = (id: string) => useEditor.setState({ openLayers: openLayers.includes(id) ? openLayers.filter((x) => x !== id) : [...openLayers, id] })

  // ---- ruler: scrub, or pick a section ----
  const onRulerDown = (e: React.PointerEvent) => {
    if (!rangeMode) return scrub(e)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const t0 = tFromX(e.clientX)
    setSel({ a: t0, b: t0 })
    const move = (ev: PointerEvent) => setSel({ a: t0, b: tFromX(ev.clientX) })
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const applySection = () => {
    if (!sel) return
    const lo = Math.min(sel.a, sel.b)
    const hi = Math.max(sel.a, sel.b)
    if (hi - lo < 0.1) return
    const section: TimeRemapSection = { from: +map.toAuthored(lo).toFixed(3), to: +map.toAuthored(hi).toFixed(3), speed }
    const rest = sections.filter((s, i) => i !== sel.index && (s.to <= section.from || s.from >= section.to))
    setRemap([...rest, section].sort((a, b) => a.from - b.from), keepTotal, `구간 속도: ${section.from.toFixed(1)}~${section.to.toFixed(1)}초 ${speed}배`)
    setSel(null)
    setRangeMode(false)
  }

  // ---- dragging blocks ----
  const startDrag = (e: React.PointerEvent, init: Drag, onDone: (dt: number) => void) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    let dx = 0
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - x0
      setDrag({ ...init, dx } as Drag)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDrag(null)
      const dt = (dx / trackW) * d
      if (Math.abs(dx) >= 3) onDone(dt)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const selectMotion = (m: RuntimeMotion) => {
    ed.select(m.owners[0])
    useEditor.setState({ selectedMotion: m.key, panel: 'motion' })
  }

  const moveMotion = (m: RuntimeMotion, dt: number) => {
    // the bar shows output time; edits are stored in authored time
    const newStart = map.toAuthored(Math.max(0, m.start + dt))
    const curStart = m.authoredStart + m.shift
    const shift = +(m.shift + (newStart - curStart)).toFixed(3)
    patchMotion(m.key, m.sig, { shift }, `${motionLabel(m)}: 시작 ${(m.authoredStart + shift).toFixed(2)}초`)
  }
  const resizeMotion = (m: RuntimeMotion, dt: number) => {
    const cur = ov?.motions[m.key]?.duration ?? m.duration
    const outEnd = Math.max(m.start + 0.02, m.end + dt)
    const authoredDelta = map.toAuthored(outEnd) - map.toAuthored(m.end)
    const duration = +Math.max(0.02, cur + authoredDelta).toFixed(3)
    patchMotion(m.key, m.sig, { duration }, `${motionLabel(m)}: 길이 ${duration.toFixed(2)}초`)
  }

  const ticks = useMemo(() => {
    // a label every ~70px: pick a step from 0.1s to 10s
    const per = (70 / trackW) * d
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => s >= per) ?? 60
    const out: { t: number; major: boolean }[] = []
    for (let t = 0; t <= d + 1e-6; t += step / 2) out.push({ t, major: Math.round(t / step * 2) % 2 === 0 })
    return { step, out }
  }, [trackW, d])

  const rows: React.ReactNode[] = []
  for (const el of layers) {
    const t = timingById.get(el.id)
    const o = ov?.elements[el.id]
    const Icon = ICON[el.type] ?? Box
    const ms = motionsOf(el.id)
    const open = openLayers.includes(el.id)
    const isSel = selection.includes(el.id)
    const start = t ? Math.max(0, t.start) : 0
    const end = t?.end ?? d
    const layerDx = drag?.kind === 'layer' && (drag.id === el.id || (isSel && selection.includes(drag.id) && selection.length > 1)) ? drag.dx : 0
    rows.push(
      <div
        key={`l-${el.id}`}
        className={`tl-layer${isSel ? ' sel' : ''}`}
        style={{ paddingLeft: 4 + el.depth * 14, opacity: el.visible || !ed.ready ? 1 : 0.6 }}
        onClick={(e) => pickLayer(el.id, e)}
        data-layer={el.id}
      >
        <button className="icon-btn" style={{ width: 18, height: 18 }} title={ms.length ? '모션 펼치기/접기' : '모션 없음'} disabled={!ms.length} onClick={(e) => {
          e.stopPropagation()
          toggleOpen(el.id)
        }}>
          {ms.length ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </button>
        <button className="icon-btn" style={{ width: 18, height: 18 }} title={o?.hidden ? '보이기' : '숨기기'} onClick={(e) => {
          e.stopPropagation()
          patchElement(el.id, el.label, { hidden: !o?.hidden }, ['hidden'])
        }}>
          {o?.hidden ? <EyeOff size={12} color="var(--text-3)" /> : <Eye size={12} color="var(--text-3)" />}
        </button>
        <Icon size={12} color="var(--text-3)" style={{ flex: 'none' }} />
        <span className="ellipsis grow" title={el.label}>{el.label}</span>
        {o && <Lock size={10} color="var(--accent)" style={{ flex: 'none' }} aria-label="직접 수정함" />}
      </div>,
      <div key={`t-${el.id}`} className="tl-track" onPointerDown={(e) => e.target === e.currentTarget && pickLayer(el.id, e)}>
        {t && (
          <div
            className={`tl-bar${isSel ? ' sel' : ''}`}
            title={`${el.label} · ${start.toFixed(2)}~${end.toFixed(2)}초 · 끌어서 요소 전체의 등장 시점 옮기기`}
            style={{ left: px(start) + layerDx, width: Math.max(4, px(Math.min(d, end) - start)) }}
            onPointerDown={(e) => {
              // a bar of an already selected layer drags the whole selection
              const group = isSel && selection.length > 1
              if (!group) {
                ed.select(el.id, e.shiftKey || e.metaKey || e.ctrlKey)
                useEditor.setState({ selectedMotion: null, panel: 'elements' })
              }
              startDrag(e, { kind: 'layer', id: el.id, dx: 0 }, (dt) => {
                const ids = group ? selection : [el.id]
                const items = ids.map((id) => elements.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x)
                patchElements(
                  items.map((x) => ({ id: x.id, label: x.label, patch: { timing: { shift: +((ov?.elements[x.id]?.timing?.shift ?? 0) + dt).toFixed(2) } } })),
                  ['shift'],
                )
              })
            }}
          >
            {el.label}
          </div>
        )}
        {!open && ms.map((m) => <div key={m.key} className="tl-tick" style={{ left: px(m.start) + layerDx }} />)}
      </div>,
    )
    if (open) {
      for (const m of ms) {
        const msel = selectedMotion === m.key
        const md = drag?.kind === 'motion' && drag.key === m.key ? drag : null
        const left = px(m.start) + (md?.mode === 'move' ? md.dx : 0)
        const width = Math.max(6, px(m.end - m.start) + (md?.mode === 'len' ? md.dx : 0))
        rows.push(
          <div key={`ml-${m.key}`} className={`tl-layer sub${msel ? ' sel' : ''}`} style={{ paddingLeft: 44 + el.depth * 14 }} onClick={() => selectMotion(m)}>
            <span className="ellipsis grow" title={motionLabel(m)}>{motionLabel(m)}</span>
            {m.edited && <Lock size={10} color="var(--accent)" />}
          </div>,
          <div key={`mt-${m.key}`} className="tl-track sub">
            <div
              className={`tl-motion${msel ? ' sel' : ''}${m.disabled ? ' off' : ''}`}
              style={{ left, width }}
              title={`${motionLabel(m)} · ${m.start.toFixed(2)}~${m.end.toFixed(2)}초 · 끌어서 시작 옮기기, 오른쪽 끝을 끌어서 길이 조절`}
              onPointerDown={(e) => {
                selectMotion(m)
                startDrag(e, { kind: 'motion', key: m.key, mode: 'move', dx: 0 }, (dt) => moveMotion(m, dt))
              }}
            >
              {motionLabel(m)}
              <div
                className="grip"
                onPointerDown={(e) => {
                  selectMotion(m)
                  startDrag(e, { kind: 'motion', key: m.key, mode: 'len', dx: 0 }, (dt) => resizeMotion(m, dt))
                }}
              />
            </div>
          </div>,
        )
      }
    }
  }

  const bgm = audio.filter((a) => a.kind === 'bgm')
  const sfx = audio.filter((a) => a.kind === 'sfx')
  const voice = audio.filter((a) => a.kind === 'voice')
  if (bgm.length) {
    rows.push(
      <div key="l-bgm" className="tl-layer" style={{ paddingLeft: 8 }} onClick={() => useEditor.setState({ panel: 'sound' })}>
        <Music size={12} color="var(--success)" />
        <span className="grow">배경음악</span>
      </div>,
      <div key="t-bgm" className="tl-track">
        {bgm.map((a) => (
          <div
            key={a.id}
            className="tl-bar"
            title={`${a.label} · ${a.start.toFixed(1)}초~`}
            onPointerDown={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
            style={{ left: px(a.start), width: Math.max(4, px(Math.min(d - a.start, a.duration ?? d - a.start))), background: a.volume === 0 ? 'var(--surface-3)' : 'rgba(52,194,122,0.22)', color: 'var(--success)', outline: selectedAudio === a.id ? '1px solid var(--success)' : 'none', cursor: 'pointer' }}
          >
            {a.label}
          </div>
        ))}
      </div>,
    )
  }
  if (voice.length) {
    rows.push(
      <div key="l-voice" className="tl-layer" style={{ paddingLeft: 8 }} onClick={() => useEditor.setState({ panel: 'sound' })}>
        <Mic size={12} color="var(--accent)" />
        <span className="grow">내레이션</span>
      </div>,
      <div key="t-voice" className="tl-track">
        {voice.map((a) => (
          <div
            key={a.id}
            className="tl-bar"
            title={`${a.label} · ${a.start.toFixed(2)}초~`}
            onPointerDown={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
            style={{ left: px(map.toOutput(a.start)), width: Math.max(4, px(a.duration ?? 1)), outline: selectedAudio === a.id ? '1px solid var(--accent)' : 'none', cursor: 'pointer', opacity: a.volume === 0 ? 0.4 : 1 }}
          >
            {a.label}
          </div>
        ))}
      </div>,
    )
  }
  if (sfx.length) {
    rows.push(
      <div key="l-sfx" className="tl-layer" style={{ paddingLeft: 8 }} onClick={() => useEditor.setState({ panel: 'sound' })}>
        <Volume2 size={12} color="var(--warning)" />
        <span className="grow">효과음</span>
      </div>,
      <div key="t-sfx" className="tl-track">
        {sfx.map((a) => (
          <div
            key={a.id}
            title={`${a.label} · ${a.start.toFixed(2)}초`}
            onPointerDown={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
            style={{ position: 'absolute', left: px(map.toOutput(a.start)) - 6, top: 7, width: 12, height: 12, transform: 'rotate(45deg)', borderRadius: 2, background: a.volume === 0 ? 'var(--surface-3)' : selectedAudio === a.id ? 'var(--warning)' : 'rgba(245,165,36,0.7)', cursor: 'pointer' }}
          />
        ))}
      </div>,
    )
  }

  return (
    <div className="tl" style={{ height: '100%', position: 'relative' }} data-testid="timeline">
      <div className="row" style={{ gap: 4, height: 40, padding: '0 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <button className="icon-btn" title="처음으로" onClick={() => seek(0)} disabled={!player}>
          <SkipBack size={15} />
        </button>
        <button className="icon-btn" title="이전 프레임 (←)" onClick={() => seek(time - 1 / fps)} disabled={!player}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" title="재생/정지 (Space)" style={{ width: 32, height: 32, background: 'var(--surface-3)', color: 'var(--text)' }} onClick={() => (playing ? player?.pause() : player?.play())} disabled={!player}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn" title="다음 프레임 (→)" onClick={() => seek(time + 1 / fps)} disabled={!player}>
          <ChevronRight size={16} />
        </button>
        <div className="mono small" style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--text)' }}>{formatTime(time)}</span>
          <span className="faint"> / {formatTime(d)}</span>
        </div>
        <div className="grow" />
        <button
          className={`btn sm${rangeMode ? ' primary' : ' ghost'}`}
          disabled={!project?.hasVideo}
          title="눈금자에서 구간을 드래그해서 그 부분만 빠르게/느리게 바꿔요"
          onClick={() => {
            setRangeMode(!rangeMode)
            setSel(null)
          }}
        >
          <Gauge size={13} />
          {rangeMode ? '눈금자에서 구간을 드래그하세요' : '구간 속도'}
        </button>
        <div className="row" style={{ gap: 2 }} title="타임라인 확대/축소 (⌘/Ctrl + 휠)">
          <button className="icon-btn" onClick={() => setLayout({ zoom: Math.max(1, +(zoom / 1.5).toFixed(2)) })} disabled={zoom <= 1}>
            <Minus size={13} />
          </button>
          <input type="range" min={1} max={12} step={0.1} value={zoom} onChange={(e) => setLayout({ zoom: Number(e.target.value) })} style={{ width: 80 }} aria-label="타임라인 확대" />
          <button className="icon-btn" onClick={() => setLayout({ zoom: Math.min(12, +(zoom * 1.5).toFixed(2)) })} disabled={zoom >= 12}>
            <Plus size={13} />
          </button>
        </div>
        <span className="tiny faint">{fps}fps</span>
      </div>

      <div
        ref={scroller}
        className="tl-scroll"
        onPointerDown={(e) => {
          // the empty space below the layers: nothing selected
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-grid')) ed.select(null)
        }}
        onWheel={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          setLayout({ zoom: Math.max(1, Math.min(12, +(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(2))) })
        }}
      >
        <div className="tl-grid" style={{ gridTemplateColumns: `${layerW}px ${trackW}px` }}>
          <div className="tl-corner tiny muted">
            레이어 {layers.length ? `· ${layers.length}` : ''}
            <div style={{ position: 'absolute', right: 0, top: 0, height: 24, display: 'flex' }}>
              <Splitter dir="x" value={layerW} onChange={(v) => setLayout({ layerW: clampSize('layerW', v) })} onReset={() => setLayout({ layerW: LAYOUT_DEFAULTS.layerW })} title="레이어 이름 칸 폭 조절" />
            </div>
          </div>
          <div className="tl-ruler" data-testid="timeline-bar" onPointerDown={onRulerDown} style={{ cursor: rangeMode ? 'col-resize' : 'pointer', outline: rangeMode ? '1px solid var(--accent)' : 'none' }}>
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
                  style={{ position: 'absolute', left: px(a), width: px(b - a), top: 0, bottom: 0, background: s.speed > 1 ? 'rgba(91,127,255,0.22)' : 'rgba(245,165,36,0.22)', borderLeft: '1px solid var(--accent)', borderRight: '1px solid var(--accent)' }}
                >
                  <span className="tiny" style={{ position: 'absolute', right: 4, top: 4, fontWeight: 700, color: s.speed > 1 ? 'var(--accent)' : 'var(--warning)' }}>{s.speed}×</span>
                </div>
              )
            })}
            {ticks.out.map(({ t, major }) => (
              <div key={t.toFixed(3)} style={{ position: 'absolute', left: px(t), bottom: 0, height: major ? 9 : 4, width: 1, background: 'var(--border-strong)', pointerEvents: 'none' }}>
                {major && t < d - 1e-6 && (
                  <span className="tiny faint" style={{ position: 'absolute', left: 3, bottom: 7, whiteSpace: 'nowrap' }}>
                    {ticks.step < 1 ? `${t.toFixed(ticks.step < 0.5 ? 2 : 1)}s` : `${Math.round(t)}s`}
                  </span>
                )}
              </div>
            ))}
            {sel && <div style={{ position: 'absolute', left: px(Math.min(sel.a, sel.b)), width: px(Math.abs(sel.b - sel.a)), top: 0, bottom: 0, background: 'var(--accent-soft)', border: '1px solid var(--accent)', pointerEvents: 'none' }} />}
            {marks.map((m) => (
              <div key={m.id} title={`${m.n}번 표시`} style={{ position: 'absolute', left: px(m.time) - 4, top: 2, width: 8, height: 8, borderRadius: 4, background: 'var(--mark)', pointerEvents: 'none' }} />
            ))}
            {project?.hasVideo && (
              // the grip sits on the exact time; the time label goes to whichever side has room
              <div className="tl-head" style={{ left: px(time) }} onPointerDown={scrub} title="끌어서 원하는 장면으로" data-testid="playhead">
                <i />
                <span className={px(time) > trackW - 70 ? 'left' : ''}>{formatTime(time)}</span>
              </div>
            )}
          </div>
          {rows}
          {!layers.length && (
            <>
              <div className="tl-layer tiny muted" style={{ paddingLeft: 10, height: 40 }}>
                {project?.hasVideo ? '영상을 불러오는 중…' : '영상이 만들어지면 레이어가 보여요'}
              </div>
              <div className="tl-track" style={{ height: 40 }} />
            </>
          )}
          {/* playhead over every track: the line can be grabbed too */}
          {/* no grid placement: the rows are implicit, so '1 / -1' would be zero rows tall */}
          <div className="tl-playhead" style={{ left: layerW + px(time) }} onPointerDown={project?.hasVideo ? scrub : undefined} data-testid="playhead-line" />
        </div>
      </div>

      {sel && Math.abs(sel.b - sel.a) >= 0.1 && (
        <div className="card fade-in" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', padding: 12, boxShadow: 'var(--shadow)', zIndex: 10, width: 380 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 650 }}>
              {Math.min(sel.a, sel.b).toFixed(1)}초 ~ {Math.max(sel.a, sel.b).toFixed(1)}초 속도
            </span>
            <div className="grow" />
            <button className="icon-btn" title="닫기" onClick={() => setSel(null)}>
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
              <button className="btn sm danger" onClick={() => {
                setRemap(sections.filter((_, i) => i !== sel.index), keepTotal, '구간 속도 삭제')
                setSel(null)
              }}>
                <Trash2 size={13} />
                구간 삭제
              </button>
            )}
            <div className="grow" />
            <button className="btn sm primary" onClick={applySection}>
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
