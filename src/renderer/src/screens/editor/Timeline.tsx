// After Effects–style timeline: transport, ruler (seek, markers, work area, section speed),
// layers in stacking order (solo · visible · locked, drag to reorder, right-click menu), each
// layer's in/out (drag the ends), its keyframes per property (diamonds: drag, ease, delete),
// every motion Claude wrote as a block (drag = start, right edge = length) and the audio lanes.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Contrast,
  Eye,
  EyeOff,
  Film,
  Gauge,
  Headphones,
  Image as ImageIcon,
  Layers,
  Lock,
  Mic,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  Trash2,
  Type,
  Unlock,
  Activity,
  Bone,
  Video,
  Volume2,
  X,
} from 'lucide-react'
import { EASY_EASE, KEY_EASES, keysAt, PROPS, sortedKeys, type KeyProp, type TimeRemapSection } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { Splitter } from '../../components/Splitter'
import { CurveEditor } from './CurveEditor'
import { Waveform } from './Waveform'
import { formatTime, Menu, Toggle } from '../../components/ui'
import { useStore } from '../../store'
import {
  addLayer,
  deleteSelection,
  duplicateSelection,
  labelOf,
  reorder,
  takeOver,
  snapT,
  splitAtPlayhead,
  stackOf,
  toggleHidden,
  trimToPlayhead,
} from './edit'
import { stackedTree, visibleNow } from '@shared/layers'
import { useEditor, useEditorStill } from './editorStore'
import { ADD_LAYER } from './Inspector'
import { clampSize, LAYOUT_DEFAULTS, useLayout } from './layout'
import { motionLabel } from './motionInfo'
import { useOverrides } from './overrides'
import { soloLayers, type RuntimeElement, type RuntimeMotion } from './player'
import { isOwn, keyedTracks, ownProp, ownTrack, propLabel, trackKeys, trackLabel, type Track } from './tracks'

const SPEEDS = [0.5, 0.75, 1.25, 1.5, 2, 3]
const ICON: Record<string, typeof Type> = { text: Type, image: ImageIcon, shape: Box, video: Film, group: Layers, adjustment: Contrast, camera: Video, part: Bone }
/** pairs that share a row while their keyframes sit at the same times (like After Effects' position) */
const PAIRS: [KeyProp, KeyProp, string][] = [
  ['x', 'y', '위치'],
  ['scaleX', 'scaleY', '크기'],
  ['anchorX', 'anchorY', '기준점'],
  ['maskX', 'maskY', '마스크 위치'],
  ['maskW', 'maskH', '마스크 크기'],
]
const ORDER = new Map<string, number>(PROPS.map((p, i) => [p.id, i]))
/** the keyframed tracks of a layer as timeline rows */
function keyRowsOf(o: Parameters<typeof keyedTracks>[0]): { label: string; props: Track[] }[] {
  const keyed = keyedTracks(o)
  const times = (t: Track) => trackKeys(o, t).map((k) => k.t.toFixed(3)).join()
  const used = new Set<Track>()
  const rows: { label: string; props: Track[]; at: number }[] = []
  for (const [a, b, label] of PAIRS) {
    if (keyed.includes(a) && keyed.includes(b) && times(a) === times(b)) {
      rows.push({ label, props: [a, b], at: ORDER.get(a) ?? 0 })
      used.add(a)
      used.add(b)
    }
  }
  for (const t of keyed) if (!used.has(t)) rows.push({ label: isOwn(t) ? `${trackLabel(t)} ◆직접` : trackLabel(t), props: [t], at: isOwn(t) ? 1000 : ORDER.get(t) ?? 0 })
  return rows.sort((x, y) => x.at - y.at)
}

type Drag =
  | { kind: 'ckey'; id: string; prop: string; t: number; dx: number }
  | { kind: 'motion'; key: string; mode: 'move' | 'len'; dx: number }
  | { kind: 'layer'; id: string; dx: number; snapAt?: number }
  | { kind: 'inout'; id: string; edge: 'in' | 'out'; dx: number }
  | { kind: 'keys'; dx: number }
  | { kind: 'marker'; id: string; dx: number }

/** 00:00:00:00 at the project's frame rate */
export function timecode(t: number, fps: number): string {
  const f = Math.round(t * fps)
  const fr = Math.round(fps)
  const s = Math.floor(f / fr)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % fr)}`
}

export function Timeline() {
  const { project, toast } = useStore()
  const ed = useEditorStill()
  // the playhead time is read where it is shown (Playhead, Timecode) or used (now()): the rows are not
  // drawn again for every tick of playback
  const { player, duration, playing, marks, audio, selectedAudio, timing, selection, elements, motions, selectedMotion, openLayers, selectedKeys, solo, workArea } = ed
  const now = () => useEditor.getState().time
  const { value: ov, setRemap, patchMotion, setLocked, setInOut, moveKeys, setKeyEase, removeKeys, addMarker, updateMarker, removeMarker, shiftLayers } = useOverrides()
  const { layerW, zoom, frames, snap, set: setLayout } = useLayout()
  const scroller = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [rangeMode, setRangeMode] = useState(false)
  const [sel, setSel] = useState<{ a: number; b: number; index?: number } | null>(null)
  const [speed, setSpeed] = useState(1.5)
  const [menu, setMenu] = useState<{ x: number; y: number; items: { label: React.ReactNode; onClick: () => void; danger?: boolean }[] } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [reordering, setReordering] = useState<{ id: string; target: string | null; above: boolean } | null>(null)
  const [curve, setCurve] = useState<{ x: number; y: number; value: string | undefined; apply: (ease: string) => void } | null>(null)
  /** the value graph of one track (After Effects' graph editor), open under its row */
  const [graph, setGraph] = useState<{ id: string; track: Track } | null>(null)

  const fps = project?.brief.output.fps ?? 30
  const authoredD = project?.brief.output.duration ?? 1
  const d = duration || authoredD
  const sections = ov?.timeRemap ?? []
  const keepTotal = ov?.keepTotalDuration ?? true
  const map = useMemo(() => makeTimeMap(authoredD, sections), [authoredD, sections])
  const fmt = (t: number) => (frames ? timecode(t, fps) : formatTime(t))

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

  // while playing, every time update: keep the playhead in view when zoomed in, loop inside the work area
  // (a store subscription, not a render)
  const follow = useRef({ px, layerW, zoom, workArea, player, fps })
  follow.current = { px, layerW, zoom, workArea, player, fps }
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.time === prev.time || !s.playing) return
        const f = follow.current
        const el = scroller.current
        if (el && f.zoom > 1) {
          const x = f.px(s.time)
          if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - f.layerW - 40) el.scrollLeft = Math.max(0, x - 80)
        }
        const wa = f.workArea
        if (wa && f.player && (s.time >= wa.b - 1 / f.fps || s.time < wa.a - 0.05)) {
          f.player.seek(wa.a)
          f.player.play()
        }
      }),
    [],
  )

  // solo: only those layers show (the preview forgets it on reload, so it is sent again)
  useEffect(() => {
    if (ed.ready) void soloLayers(player, solo)
  }, [solo, player, ed.ready])

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

  /** layer click: picks it (Shift/⌘ adds or removes it); the empty space below the layers or Esc clears */
  const pickLayer = (id: string, e: React.MouseEvent | React.PointerEvent) => {
    const add = e.shiftKey || e.metaKey || e.ctrlKey
    ed.select(id, add)
    useEditor.setState({ selectedMotion: null, panel: 'elements', selectedKeys: [] })
  }

  const [onlySel, setOnlySel] = useState(false)
  /** 지금 보이는 것만: layers seen at the playhead (as of the last pause / seek) */
  const [onlyNow, setOnlyNow] = useState(false)
  /** 소리만: the music, narration and sound-effect lanes without the picture layers */
  const [onlySound, setOnlySound] = useState(false)
  const [filterMenu, setFilterMenu] = useState(false)
  /** the pointer just ended a drag (its click is not a click) */
  const dragged = useRef(false)
  const stacked = useMemo(() => stackedTree(elements), [elements])
  const compW = project?.brief.output.width ?? 1920
  const compH = project?.brief.output.height ?? 1080
  // 선택한 것만 / 지금 보이는 것만: those layers and the groups they sit in
  const layers = useMemo(() => {
    const withParents = (ids: Iterable<string>) => {
      const keep = new Set<string>()
      for (const id of ids) for (let p: string | null | undefined = id; p; p = stacked.find((x) => x.id === p)?.parent) keep.add(p)
      return keep
    }
    let out = stacked
    if (onlySel && selection.length) {
      const keep = withParents(selection)
      out = out.filter((x) => keep.has(x.id))
    }
    if (onlyNow) {
      const keep = withParents(visibleNow(elements, compW, compH))
      out = out.filter((x) => keep.has(x.id))
    }
    return out
  }, [stacked, onlySel, onlyNow, selection, elements, compW, compH])
  // the picked layer is in view (the list may be long)
  useEffect(() => {
    const id = selection[selection.length - 1]
    if (!id) return
    requestAnimationFrame(() => scroller.current?.querySelector(`[data-layer="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
  }, [selection])
  const timingById = new Map(timing.map((t) => [t.id, t]))
  const motionsOf = (id: string) => motions.filter((m) => m.owners[0] === id && !m.nested).sort((a, b) => a.start - b.start)
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

  // ---- dragging blocks, bar ends, keyframes, markers ----
  /** times a dragged edge snaps to: the start and end, the playhead, markers, the work area, other layers' bars */
  const snapTimes = (skip: Set<string>) => {
    const out = [0, d, now(), ...markers.map((m) => m.t)]
    if (workArea) out.push(workArea.a, workArea.b)
    for (const t of timing) if (!skip.has(t.id)) out.push(t.start, ...(t.end != null ? [t.end] : []))
    return out
  }
  /**
   * A drag along the timeline. `edges(dt)` are the times that should snap (a bar's start and end):
   * within a few pixels of a snap time the drag lands on it (⌘ while dragging: no snapping).
   */
  const startDrag = (e: React.PointerEvent, init: Drag, onDone: (dt: number) => void, snapping?: { edges: (dt: number) => number[]; skip: Set<string> }) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const cands = snapping ? snapTimes(snapping.skip) : []
    let dx = 0
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - x0
      let snapAt: number | undefined
      if (snapping && !(ev.metaKey || ev.ctrlKey) && snap) {
        const dt = (dx / trackW) * d
        const tol = (6 / trackW) * d
        let best: { off: number; at: number } | null = null
        for (const edge of snapping.edges(dt)) for (const c of cands) if (Math.abs(c - edge) <= tol && (!best || Math.abs(c - edge) < Math.abs(best.off))) best = { off: c - edge, at: c }
        if (best) {
          dx = ((dt + best.off) / d) * trackW
          snapAt = best.at
        }
      }
      setDrag({ ...init, dx, ...(snapAt != null ? { snapAt } : {}) } as Drag)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDrag(null)
      const dt = (dx / trackW) * d
      // the click that ends a drag is no click (a marker would jump back to where it was)
      dragged.current = Math.abs(dx) >= 3
      if (dragged.current) onDone(dt)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const dragDt = (kind: Drag['kind']) => (drag?.kind === kind ? (drag.dx / trackW) * d : 0)

  const selectMotion = (m: RuntimeMotion) => {
    ed.select(m.owners[0])
    useEditor.setState({ selectedMotion: m.key, panel: 'motion' })
  }

  const moveMotion = (m: RuntimeMotion, dt: number) => {
    // the bar shows output time; edits are stored in authored time
    const newStart = map.toAuthored(Math.max(0, m.start + dt))
    const curStart = m.authoredStart + m.shift + (m.layerShift ?? 0)
    const shift = +(m.shift + (newStart - curStart)).toFixed(3)
    patchMotion(m.editKey, m.sig, { shift, at: m.authoredStart }, `${motionLabel(m)}: 시작 ${(m.authoredStart + shift + (m.layerShift ?? 0)).toFixed(2)}초`)
  }
  const resizeMotion = (m: RuntimeMotion, dt: number) => {
    const cur = ov?.motions[m.editKey]?.duration ?? m.duration
    const outEnd = Math.max(m.start + 0.02, m.end + dt)
    const authoredDelta = map.toAuthored(outEnd) - map.toAuthored(m.end)
    const duration = +Math.max(0.02, cur + authoredDelta).toFixed(3)
    patchMotion(m.editKey, m.sig, { duration, at: m.authoredStart }, `${motionLabel(m)}: 길이 ${duration.toFixed(2)}초`)
  }

  // ---- keyframes ----
  const isKeySel = (id: string, props: Track[], t: number) => props.some((p) => selectedKeys.some((k) => k.id === id && k.prop === p && Math.abs(k.t - t) < 1e-3))
  const pickKey = (id: string, props: Track[], t: number, add: boolean) => {
    const here = props.filter((p) => trackKeys(ov?.elements[id], p).some((k) => Math.abs(k.t - t) < 1e-3)).map((prop) => ({ id, prop, t }))
    const already = isKeySel(id, props, t)
    let next = add ? selectedKeys.filter((k) => !(k.id === id && props.includes(k.prop) && Math.abs(k.t - t) < 1e-3)) : []
    if (!add || !already) next = [...next, ...here]
    if (!add && !next.length) next = here
    useEditor.setState({ selectedKeys: next })
  }
  /** moves the selected keyframes (of each layer) by dt, on the frame grid */
  const moveSelectedKeys = (dt: number) => {
    const step = Math.round(dt * fps) / fps
    // the selection may have changed when the drag started (a click on an unselected key picks it)
    const picked = useEditor.getState().selectedKeys
    if (!step || !picked.length) return
    for (const id of [...new Set(picked.map((k) => k.id))]) {
      moveKeys(id, labelOf(id), picked.filter((k) => k.id === id), step)
    }
    useEditor.setState({ selectedKeys: picked.map((k) => ({ ...k, t: +Math.max(0, k.t + step).toFixed(4) })) })
  }
  const keyMenu = (e: React.MouseEvent, id: string, props: Track[], t: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isKeySel(id, props, t)) pickKey(id, props, t, false)
    const sel = isKeySel(id, props, t) ? useEditor.getState().selectedKeys : props.map((prop) => ({ id, prop, t }))
    const byLayer = (f: (lid: string, ks: typeof sel) => void) => [...new Set(sel.map((k) => k.id))].forEach((lid) => f(lid, sel.filter((k) => k.id === lid)))
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...KEY_EASES.map((ea) => ({ label: ea.label, onClick: () => byLayer((lid, ks) => setKeyEase(lid, labelOf(lid), ks, ea.value)) })),
        {
          label: '곡선 직접 조절…',
          onClick: () => {
            const cur = props.map((p) => trackKeys(ov?.elements[id], p).find((k) => Math.abs(k.t - t) < 1e-3)?.e).find(Boolean)
            setCurve({ x: e.clientX, y: e.clientY, value: cur, apply: (ease) => byLayer((lid, ks) => setKeyEase(lid, labelOf(lid), ks, ease)) })
          },
        },
        { label: '이 키프레임으로 이동', onClick: () => seek(t) },
        { label: '키프레임 삭제', danger: true, onClick: () => byLayer((lid, ks) => removeKeys(lid, labelOf(lid), ks)) },
      ],
    })
  }

  // ---- layer rows: rename, reorder by dragging, right-click menu ----
  const layerMenu = (e: React.MouseEvent, el: RuntimeElement) => {
    e.preventDefault()
    if (!selection.includes(el.id)) ed.select(el.id)
    const ids = useEditor.getState().selection
    const o = ov?.elements[el.id]
    const label = labelOf(el.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '이름 바꾸기', onClick: () => setRenaming(el.id) },
        { label: '복제 (⌘D)', onClick: duplicateSelection },
        { label: '지금 시점에서 나누기 (⇧⌘D)', onClick: splitAtPlayhead },
        { label: 'In을 지금으로 (⌥[)', onClick: () => trimToPlayhead('in') },
        { label: 'Out을 지금으로 (⌥])', onClick: () => trimToPlayhead('out') },
        ...(o?.inPoint != null || o?.outPoint != null ? [{ label: 'In/Out 지우기 (처음부터 끝까지)', onClick: () => setInOut([{ id: el.id, label }], null, null) }] : []),
        { label: '맨 앞으로 (⇧⌘])', onClick: () => reorder(ids, 'front') },
        { label: '앞으로 (⌘])', onClick: () => reorder(ids, 'up') },
        { label: '뒤로 (⌘[)', onClick: () => reorder(ids, 'down') },
        { label: '맨 뒤로 (⇧⌘[)', onClick: () => reorder(ids, 'back') },
        { label: o?.locked ? '잠금 해제' : '잠그기 (⌘L)', onClick: () => setLocked(ids.map((id) => ({ id, label: labelOf(id) })), !o?.locked) },
        { label: o?.hidden ? '보이기' : '숨기기', onClick: () => toggleHidden(ids) },
        { label: solo.includes(el.id) ? '솔로 끄기' : '솔로 (이 레이어만 보기)', onClick: () => useEditor.setState({ solo: solo.includes(el.id) ? solo.filter((x) => x !== el.id) : [...solo, el.id] }) },
        ...(Object.values(o?.keys ?? {}).some((k) => k?.length)
          ? [{ label: '키프레임 모두 지우기', onClick: () => useOverrides.getState().setStopwatch(el.id, label, Object.keys(o!.keys!) as KeyProp[], false, 0, (Object.keys(o!.keys!) as KeyProp[]).map((p) => sortedKeys(o!.keys![p])[0]?.v ?? 0)) }]
          : []),
        ...(Object.values(o?.own ?? {}).some((k) => k?.length)
          ? [{ label: '가져온 Claude 움직임 모두 돌려주기', onClick: () => useOverrides.getState().release(el.id, label, Object.keys(o!.own!)) }]
          : []),
        o?.deleted ? { label: '되살리기', onClick: () => useOverrides.getState().restore(el.id, label) } : { label: '삭제 (Delete)', danger: true, onClick: deleteSelection },
      ],
    })
  }
  const startReorder = (e: React.PointerEvent, el: RuntimeElement) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input')) return
    const y0 = e.clientY
    let active = false
    // no pointer capture until it really is a drag: clicks and double-clicks (rename) stay with the label
    const row = window
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - y0) < 6) return
      active = true
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => (n as HTMLElement).closest?.('[data-layer]') as HTMLElement | null).find(Boolean)
      const target = under?.getAttribute('data-layer') ?? null
      const t = target ? elements.find((x) => x.id === target) : null
      const r = under?.getBoundingClientRect()
      setReordering({ id: el.id, target: t && t.stack === el.stack && t.id !== el.id ? t.id : null, above: r ? ev.clientY < r.top + r.height / 2 : true })
    }
    const up = () => {
      row.removeEventListener('pointermove', move)
      row.removeEventListener('pointerup', up)
      setReordering((cur) => {
        if (active && cur?.target) {
          const sibs = stackOf(el.stack).map((x) => x.id)
          const moving = selection.includes(el.id) ? sibs.filter((id) => selection.includes(id)) : [el.id]
          const rest = sibs.filter((id) => !moving.includes(id))
          const at = rest.indexOf(cur.target) + (cur.above ? 0 : 1)
          const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
          if (next.join() !== sibs.join()) useOverrides.getState().setOrder(el.stack, next, `${labelOf(el.id)}: 순서`)
        }
        return null
      })
    }
    row.addEventListener('pointermove', move)
    row.addEventListener('pointerup', up)
  }

  const ticks = useMemo(() => {
    // a label every ~70px: pick a step from 0.1s to 10s
    const per = (70 / trackW) * d
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30].find((s) => s >= per) ?? 60
    const out: { t: number; major: boolean }[] = []
    for (let t = 0; t <= d + 1e-6; t += step / 2) out.push({ t, major: Math.round(t / step * 2) % 2 === 0 })
    return { step, out }
  }, [trackW, d])

  /** Claude's motion of a layer itself, per property: the times its tweens start and end (output time) */
  const claudeRowsOf = (id: string, own: Record<string, unknown> | undefined) => {
    const by = new Map<string, number[]>()
    for (const m of motions) {
      if (m.self !== id || m.disabled) continue
      for (const p of m.props) {
        if (p.owned || own?.[p.name]) continue
        const list = by.get(p.name) ?? []
        list.push(+m.start.toFixed(4), +m.end.toFixed(4))
        by.set(p.name, list)
      }
    }
    return [...by.entries()].map(([prop, ts]) => ({ prop, times: [...new Set(ts)].sort((a, b) => a - b) }))
  }
  /** a Claude diamond edited: the property is taken over first, then the edit lands on its keys */
  const withTakeOver = async (id: string, prop: string, f: () => void) => {
    if (await takeOver(id, [prop])) f()
    else toast('Claude 움직임을 읽지 못했어요. 미리보기가 다 뜬 뒤 다시 해 주세요.', 'error')
  }
  const claudeKeyMenu = (e: React.MouseEvent, id: string, prop: string, t: number) => {
    e.preventDefault()
    e.stopPropagation()
    const label = labelOf(id)
    const tr = ownTrack(prop)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '가져와서 직접 고치기', onClick: () => void withTakeOver(id, prop, () => useEditor.setState({ selectedKeys: [{ id, prop: tr, t }] })) },
        ...KEY_EASES.map((ea) => ({ label: ea.label, onClick: () => void withTakeOver(id, prop, () => setKeyEase(id, label, [{ prop: tr, t }], ea.value)) })),
        { label: '이 키프레임으로 이동', onClick: () => seek(t) },
      ],
    })
  }

  const rows: React.ReactNode[] = []
  for (const el of onlySound ? [] : layers) {
    // a character's parts show once the character is unfolded (or one of them is picked)
    if (el.type === 'part' && el.parent && !openLayers.includes(el.parent) && !selection.some((x) => x === el.id || x.startsWith(`${el.parent}::`))) continue
    const t = timingById.get(el.id)
    const o = ov?.elements[el.id]
    const Icon = ICON[el.type] ?? Box
    const ms = motionsOf(el.id)
    const keyRows = keyRowsOf(o)
    const claudeRows = claudeRowsOf(el.id, o?.own)
    const hasParts = el.type !== 'part' && elements.some((x) => x.type === 'part' && x.parent === el.id)
    const open = openLayers.includes(el.id)
    const isSel = selection.includes(el.id)
    const label = labelOf(el.id)
    const locked = !!o?.locked
    const start = t ? Math.max(0, t.start) : 0
    const end = t?.end ?? d
    const layerDx = drag?.kind === 'layer' && (drag.id === el.id || (isSel && selection.includes(drag.id) && selection.length > 1)) ? drag.dx : 0
    const ioDrag = drag?.kind === 'inout' && drag.id === el.id ? drag : null
    const inP = Math.max(0, Math.min(d, (o?.inPoint ?? 0) + (ioDrag?.edge === 'in' ? (ioDrag.dx / trackW) * d : 0)))
    const outP = Math.max(inP, Math.min(d, (o?.outPoint ?? d) + (ioDrag?.edge === 'out' ? (ioDrag.dx / trackW) * d : 0)))
    const allKeyTimes = [...new Set(keyRows.flatMap((r) => r.props.flatMap((p) => sortedKeys(trackKeys(o, p)).map((k) => +k.t.toFixed(4)))))]
    const drop = reordering?.target === el.id ? (reordering.above ? 'drop-above' : 'drop-below') : ''
    rows.push(
      <div
        key={`l-${el.id}`}
        className={`tl-layer${isSel ? ' sel' : ''} ${drop}`}
        style={{ paddingLeft: 4 + el.depth * 14, opacity: (el.visible || !ed.ready) && !o?.deleted ? 1 : 0.5 }}
        onClick={(e) => pickLayer(el.id, e)}
        onContextMenu={(e) => layerMenu(e, el)}
        onPointerDown={(e) => startReorder(e, el)}
        data-layer={el.id}
      >
        <button className="icon-btn" style={{ width: 16, height: 18 }} title={ms.length || keyRows.length || hasParts ? '속성 펼치기/접기 (U)' : ''} disabled={!ms.length && !keyRows.length && !hasParts} onClick={(e) => {
          e.stopPropagation()
          toggleOpen(el.id)
        }} data-testid={`open-${el.id}`}>
          {ms.length || keyRows.length || hasParts ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </button>
        <button className={`icon-btn tl-toggle${solo.includes(el.id) ? ' on' : ''}`} title="솔로: 이 레이어만 보기 (저장되지 않아요)" onClick={(e) => {
          e.stopPropagation()
          useEditor.setState({ solo: solo.includes(el.id) ? solo.filter((x) => x !== el.id) : [...solo, el.id] })
        }} data-testid={`solo-${el.id}`}>
          <Headphones size={11} />
        </button>
        <button className="icon-btn tl-toggle" title={o?.hidden ? '보이기' : '숨기기'} onClick={(e) => {
          e.stopPropagation()
          toggleHidden([el.id])
        }}>
          {o?.hidden ? <EyeOff size={12} color="var(--text-3)" /> : <Eye size={12} color="var(--text-3)" />}
        </button>
        <button className={`icon-btn tl-toggle${locked ? ' on' : ''}`} title={locked ? '잠금 해제' : '잠그기: Claude도 이 레이어를 바꾸지 않아요'} onClick={(e) => {
          e.stopPropagation()
          setLocked([{ id: el.id, label }], !locked)
        }} data-testid={`lock-${el.id}`}>
          {locked ? <Lock size={11} /> : <Unlock size={11} color="var(--text-3)" />}
        </button>
        <Icon size={12} color={el.designer ? 'var(--accent)' : 'var(--text-3)'} style={{ flex: 'none' }} />
        {renaming === el.id ? (
          <input
            autoFocus
            className="input"
            style={{ height: 20, fontSize: 12, padding: '0 4px' }}
            defaultValue={label}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== label) useOverrides.getState().patchElement(el.id, label, { label: v }, ['label'])
              setRenaming(null)
            }}
            data-testid="layer-rename"
          />
        ) : (
          <span className="ellipsis grow" title={`${label} · 더블클릭: 이름 바꾸기 · 끌어서 순서 바꾸기 · 오른쪽 클릭: 메뉴`} onDoubleClick={(e) => {
            e.stopPropagation()
            setRenaming(el.id)
          }} style={{ textDecoration: o?.deleted ? 'line-through' : undefined }}>
            {label}
          </span>
        )}
      </div>,
      <div key={`t-${el.id}`} className="tl-track" onPointerDown={(e) => e.target === e.currentTarget && pickLayer(el.id, e)} onContextMenu={(e) => layerMenu(e, el)}>
        {/* outside the layer's in/out: dimmed */}
        {inP > 0 && <div className="tl-io-off" style={{ left: 0, width: px(inP) }} />}
        {outP < d && <div className="tl-io-off" style={{ left: px(outP), right: 0 }} />}
        {t && (
          <div
            className={`tl-bar${isSel ? ' sel' : ''}${locked ? ' locked' : ''}`}
            data-testid={`bar-${el.id}`}
            title={`${label} · Claude 움직임 ${start.toFixed(2)}~${end.toFixed(2)}초 · 끌어서 요소 전체의 등장 시점 옮기기`}
            style={{ left: px(start) + layerDx, width: Math.max(4, px(Math.min(d, end) - start)) }}
            onPointerDown={(e) => {
              if (locked) return
              // a bar of an already selected layer drags the whole selection
              const group = isSel && selection.length > 1
              if (!group) {
                ed.select(el.id, e.shiftKey || e.metaKey || e.ctrlKey)
                useEditor.setState({ selectedMotion: null, panel: 'elements' })
              }
              // locked layers stay where they are (also in a group drag)
              const ids = (group ? selection : [el.id]).filter((id) => !ov?.elements[id]?.locked)
              const bars = ids.map((id) => timingById.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
              startDrag(
                e,
                { kind: 'layer', id: el.id, dx: 0 },
                (dt) => {
                  // the bar shows output time; Claude's motion moves in authored time (sections may run at another speed)
                  // a layer stops at 0 (the preview keeps its spacing there): its keys move by the same amount
                  shiftLayers(
                    bars.map((b) => {
                      const by = Math.max(dt, -b.start)
                      return { id: b.id, label: labelOf(b.id), authored: +(map.toAuthored(b.start + by) - map.toAuthored(b.start)).toFixed(3), dt: +by.toFixed(3) }
                    }),
                  )
                  // the moved layer at its new start (the preview reloads)
                  seek(Math.max(0, start + dt))
                },
                { edges: (dt) => bars.flatMap((b) => [b.start + dt, ...(b.end != null ? [b.end + dt] : [])]), skip: new Set(ids) },
              )
            }}
          >
            {label}
          </div>
        )}
        {/* where the dragged bar would start, and by how much it moves */}
        {t && layerDx !== 0 && drag?.kind === 'layer' && drag.id === el.id && (
          <span className="tl-drag-tip" style={{ left: px(start) + layerDx + Math.max(4, px(Math.min(d, end) - start)) + 6 }} data-testid="layer-drag-tip">
            {fmt(Math.max(0, start + (layerDx / trackW) * d))} ({(layerDx / trackW) * d >= 0 ? '+' : ''}
            {((layerDx / trackW) * d).toFixed(2)}초){drag.snapAt != null ? ' · 붙음' : ''}
          </span>
        )}
        {!t && el.type !== 'camera' && (
          <div className="tl-bar ghost" style={{ left: 0, width: px(d) }} title={`${label} · Claude 움직임이 없는 레이어예요. 양 끝 손잡이(In/Out)로 보이는 구간을 정해요.`} />
        )}
        {/* in / out handles */}
        {!locked && el.type !== 'camera' && (
          <>
            <div className="tl-io-grip" style={{ left: px(inP) - 3 }} title={`In ${fmt(inP)} · 끌어서 시작 자르기`} onPointerDown={(e) => startDrag(e, { kind: 'inout', id: el.id, edge: 'in', dx: 0 }, (dt) => setInOut([{ id: el.id, label }], snapT((o?.inPoint ?? 0) + dt), undefined))} data-testid={`in-${el.id}`} />
            <div className="tl-io-grip" style={{ left: px(outP) - 3 }} title={`Out ${fmt(outP)} · 끌어서 끝 자르기`} onPointerDown={(e) => startDrag(e, { kind: 'inout', id: el.id, edge: 'out', dx: 0 }, (dt) => setInOut([{ id: el.id, label }], undefined, snapT((o?.outPoint ?? d) + dt)))} data-testid={`out-${el.id}`} />
          </>
        )}
        {!open && ms.map((m) => <div key={m.key} className="tl-tick" style={{ left: px(m.start) + layerDx }} />)}
        {!open && allKeyTimes.map((kt) => <div key={kt} className="tl-key mini" style={{ left: px(kt) }} />)}
      </div>,
    )
    if (open) {
      for (const r of keyRows) {
        const times = [...new Set(r.props.flatMap((p) => sortedKeys(trackKeys(o, p)).map((k) => +k.t.toFixed(4))))].sort((a, b) => a - b)
        rows.push(
          <div key={`kl-${el.id}-${r.label}`} className="tl-layer sub" style={{ paddingLeft: 44 + el.depth * 14 }}>
            <span className="ellipsis grow">{r.label}</span>
            {numericTrack(o, r.props[0]) && (
              <button
                className={`icon-btn${graph?.id === el.id && graph.track === r.props[0] ? ' active' : ''}`}
                style={{ width: 18, height: 16 }}
                title="값 그래프 (점을 끌어 값과 시점을 바꿔요)"
                onClick={() => setGraph(graph?.id === el.id && graph.track === r.props[0] ? null : { id: el.id, track: r.props[0] })}
                data-testid={`graph-${el.id}-${r.props[0]}`}
              >
                <Activity size={11} />
              </button>
            )}
            <span className="tiny faint">◆ {times.length}</span>
          </div>,
          <div key={`kt-${el.id}-${r.label}`} className="tl-track sub" data-keytrack={`${el.id}:${r.props.join('+')}`}>
            {times.map((kt) => {
              const selK = isKeySel(el.id, r.props, kt)
              const dt = selK ? dragDt('keys') : 0
              const ease = r.props.map((p) => trackKeys(o, p).find((k) => Math.abs(k.t - kt) < 1e-3)?.e).find(Boolean) ?? EASY_EASE
              return (
                <div
                  key={kt}
                  className={`tl-key${selK ? ' sel' : ''}${ease === 'hold' ? ' hold' : ease === 'linear' ? ' linear' : ''}`}
                  style={{ left: px(Math.max(0, kt + dt)) }}
                  title={`${r.label} ${fmt(kt)} · 끌어서 옮기기 · 더블클릭: 이 시점으로 · 오른쪽 클릭: 이징`}
                  onPointerDown={(e) => {
                    if (locked) return
                    if (!selK || e.shiftKey) pickKey(el.id, r.props, kt, e.shiftKey)
                    startDrag(e, { kind: 'keys', dx: 0 }, moveSelectedKeys)
                  }}
                  onDoubleClick={() => seek(kt)}
                  onContextMenu={(e) => keyMenu(e, el.id, r.props, kt)}
                  data-testid={`key-${el.id}-${r.props[0]}`}
                />
              )
            })}
          </div>,
        )
        if (graph?.id === el.id && graph.track === r.props[0]) {
          rows.push(
            <div key={`gl-${el.id}-${r.label}`} className="tl-layer sub graph" style={{ paddingLeft: 44 + el.depth * 14 }}>
              <span className="tiny muted">{r.label} 값 그래프</span>
            </div>,
            <div key={`gt-${el.id}-${r.label}`} className="tl-track sub graph">
              <ValueGraph id={el.id} track={r.props[0]} keys={trackKeys(o, r.props[0])} px={px} tOf={(x) => (x / trackW) * d} fps={fps} locked={locked} />
            </div>,
          )
        }
      }
      // Claude's own motion of the layer, per property: dragging a diamond or easing it takes it over
      for (const c of claudeRows) {
        rows.push(
          <div key={`cl-${el.id}-${c.prop}`} className="tl-layer sub claude" style={{ paddingLeft: 44 + el.depth * 14 }} title="Claude가 만든 움직임 · ◆를 끌거나 이징을 바꾸면 직접 고칠 수 있게 가져와요">
            <span className="ellipsis grow">{propLabel(c.prop)}</span>
            <span className="tiny faint">Claude</span>
          </div>,
          <div key={`ct-${el.id}-${c.prop}`} className="tl-track sub" data-claudetrack={`${el.id}:${c.prop}`}>
            {c.times.map((kt) => {
              const cd = drag?.kind === 'ckey' && drag.id === el.id && drag.prop === c.prop && Math.abs(drag.t - kt) < 1e-3 ? (drag.dx / trackW) * d : 0
              return (
                <div
                  key={kt}
                  className="tl-key claude"
                  style={{ left: px(Math.max(0, kt + cd)) }}
                  title={`${propLabel(c.prop)} ${fmt(kt)} · Claude 움직임 · 끌면 가져와서 옮겨요 · 오른쪽 클릭: 이징·가져오기`}
                  onPointerDown={(e) => {
                    if (locked) return
                    startDrag(e, { kind: 'ckey', id: el.id, prop: c.prop, t: kt, dx: 0 }, (dt) => {
                      const step = Math.round(dt * fps) / fps
                      if (step) void withTakeOver(el.id, c.prop, () => moveKeys(el.id, labelOf(el.id), [{ prop: ownTrack(c.prop), t: kt }], step))
                    })
                  }}
                  onDoubleClick={() => seek(kt)}
                  onContextMenu={(e) => !locked && claudeKeyMenu(e, el.id, c.prop, kt)}
                  data-testid={`ckey-${el.id}-${c.prop}`}
                />
              )
            })}
          </div>,
        )
      }
      for (const m of ms) {
        const msel = selectedMotion === m.key
        const md = drag?.kind === 'motion' && drag.key === m.key ? drag : null
        const left = px(m.start) + (md?.mode === 'move' ? md.dx : 0)
        const width = Math.max(6, px(m.end - m.start) + (md?.mode === 'len' ? md.dx : 0))
        rows.push(
          <div key={`ml-${m.key}`} className={`tl-layer sub${msel ? ' sel' : ''}`} style={{ paddingLeft: 44 + el.depth * 14 }} onClick={() => selectMotion(m)}>
            <span className="ellipsis grow" title={`Claude가 만든 모션: ${motionLabel(m)}`}>{motionLabel(m)}</span>
          </div>,
          <div key={`mt-${m.key}`} className="tl-track sub">
            <div
              className={`tl-motion${msel ? ' sel' : ''}${m.disabled ? ' off' : ''}`}
              style={{ left, width }}
              title={`${motionLabel(m)} · ${m.start.toFixed(2)}~${m.end.toFixed(2)}초 · 끌어서 시작 옮기기, 오른쪽 끝을 끌어서 길이 조절`}
              onPointerDown={(e) => {
                if (locked) return
                selectMotion(m)
                startDrag(e, { kind: 'motion', key: m.key, mode: 'move', dx: 0 }, (dt) => moveMotion(m, dt))
              }}
            >
              {motionLabel(m)}
              <div
                className="grip"
                onPointerDown={(e) => {
                  if (locked) return
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

  /** volume keyframes of a sound (a designer music track or one of Claude's) */
  const volumeKeysOf = (id: string) => ov?.bgm.find((t) => t.id === id)?.volumeKeys ?? ov?.audio[id]?.volumeKeys ?? []
  // sounds the designer took out are not drawn (they come back from the Sound tab)
  const kept = audio.filter((a) => !ov?.audio[a.id]?.removed)
  const bgm = kept.filter((a) => a.kind === 'bgm')
  const sfx = kept.filter((a) => a.kind === 'sfx')
  const voice = kept.filter((a) => a.kind === 'voice')
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
            data-audio={a.id}
            style={{ left: px(a.start), width: Math.max(4, px(Math.min(d - a.start, a.duration ?? d - a.start))), background: a.volume === 0 ? 'var(--surface-3)' : 'rgba(52,194,122,0.22)', color: 'var(--success)', outline: selectedAudio === a.id ? '1px solid var(--success)' : 'none', cursor: 'pointer' }}
          >
            <Waveform base={ed.compBase} src={a.src} from={a.mediaStart ?? 0} length={Math.min(d - a.start, a.duration ?? d - a.start)} color={a.volume === 0 ? 'var(--text-3)' : 'rgba(52,194,122,0.4)'} />
            <span className="tl-bar-label">{a.label}</span>
            {volumeKeysOf(a.id).map((k) => <div key={k.t} className="tl-vkey" style={{ left: px(k.t) - px(a.start) }} title={`볼륨 ${Math.round(Number(k.v) * 100)}% · ${k.t.toFixed(2)}초`} />)}
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
            data-audio={a.id}
            style={{ left: px(map.toOutput(a.start)), width: Math.max(4, px(a.duration ?? 1)), outline: selectedAudio === a.id ? '1px solid var(--accent)' : 'none', cursor: 'pointer', opacity: a.volume === 0 ? 0.4 : 1 }}
          >
            <Waveform base={ed.compBase} src={a.src} from={a.mediaStart ?? 0} length={a.duration ?? 1} color="color-mix(in srgb, var(--accent) 40%, transparent)" />
            <span className="tl-bar-label">{a.label}</span>
            {volumeKeysOf(a.id).map((k) => <div key={k.t} className="tl-vkey" style={{ left: px(k.t) - px(map.toOutput(a.start)) }} title={`볼륨 ${Math.round(Number(k.v) * 100)}% · ${k.t.toFixed(2)}초`} />)}
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
          <Fragment key={a.id}>
            {/* the sound itself, behind its start marker */}
            {!!a.duration && (
              <div className="tl-sfx-wave" style={{ left: px(map.toOutput(a.start)), width: Math.max(2, px(a.duration)) }}>
                <Waveform base={ed.compBase} src={a.src} from={a.mediaStart ?? 0} length={a.duration} color={a.volume === 0 ? 'var(--text-3)' : 'rgba(245,165,36,0.8)'} />
              </div>
            )}
            <div
              title={`${a.label} · ${a.start.toFixed(2)}초`}
              onPointerDown={() => useEditor.setState({ panel: 'sound', selectedAudio: a.id })}
            data-audio={a.id}
              style={{ position: 'absolute', left: px(map.toOutput(a.start)) - 6, top: 7, width: 12, height: 12, transform: 'rotate(45deg)', borderRadius: 2, background: a.volume === 0 ? 'var(--surface-3)' : selectedAudio === a.id ? 'var(--warning)' : 'rgba(245,165,36,0.7)', cursor: 'pointer' }}
            />
          </Fragment>
        ))}
      </div>,
    )
  }

  const markers = ov?.markers ?? []
  const wa = workArea
  return (
    <div className="tl" style={{ height: '100%', position: 'relative' }} data-testid="timeline">
      <div className="row" style={{ gap: 4, height: 40, padding: '0 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <button className="icon-btn" title="처음으로 (Home)" onClick={() => seek(0)} disabled={!player}>
          <SkipBack size={15} />
        </button>
        <button className="icon-btn" title="이전 프레임 (←, ⌘←)" onClick={() => seek(now() - 1 / fps)} disabled={!player}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" title="재생/정지 (Space)" style={{ width: 32, height: 32, background: 'var(--surface-3)', color: 'var(--text)' }} onClick={() => (playing ? player?.pause() : player?.play())} disabled={!player}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn" title="다음 프레임 (→, ⌘→)" onClick={() => seek(now() + 1 / fps)} disabled={!player}>
          <ChevronRight size={16} />
        </button>
        <button className="mono small" style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }} title="눌러서 초 / 프레임 표시 바꾸기" onClick={() => setLayout({ frames: !frames })} data-testid="timecode">
          <NowLabel fmt={fmt} />
          <span className="faint"> / {fmt(d)}</span>
        </button>
        <div className="grow" />
        <div style={{ position: 'relative' }}>
          <button className="btn sm" disabled={!project?.hasVideo} onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4, items: ADD_LAYER.map(({ kind, label, icon: I }) => ({ label: <><I size={13} />{label}</>, onClick: () => void addLayer(kind).catch((err) => toast(String(err), 'error')) })) })
          }} data-testid="tl-add-layer" title="레이어 추가">
            <Plus size={13} />
            레이어
          </button>
        </div>
        <button className="icon-btn" title="지금 시점에 마커 (*)" disabled={!project?.hasVideo} onClick={() => addMarker(now())} data-testid="add-marker">
          <Bookmark size={14} />
        </button>
        <button
          className={`icon-btn${wa ? ' active' : ''}`}
          title={wa ? `작업 영역 ${fmt(wa.a)}~${fmt(wa.b)} 반복 재생 · 눌러서 끄기 (B/N으로 시작·끝 지정)` : '작업 영역 반복 재생: B로 시작, N으로 끝 지정'}
          disabled={!project?.hasVideo}
          onClick={() => useEditor.setState({ workArea: wa ? null : { a: Math.min(now(), d - 0.5), b: Math.min(d, Math.max(now() + 2, 1)) } })}
          data-testid="work-area"
        >
          <Repeat size={14} />
        </button>
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
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-grid')) {
            ed.select(null)
            useEditor.setState({ selectedKeys: [] })
          }
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
            {/* 보기: the picked layers, the layers seen now, or the sound lanes only */}
            <span style={{ position: 'relative', marginLeft: 6 }}>
              <button
                className={`btn ghost sm${onlySel || onlyNow || onlySound ? ' active' : ''}`}
                style={{ height: 18, gap: 2, color: onlySel || onlyNow || onlySound ? 'var(--accent)' : undefined }}
                onClick={() => setFilterMenu(!filterMenu)}
                title="타임라인에 보일 줄 고르기"
                data-testid="timeline-filter"
              >
                {[onlySel && '선택만', onlyNow && '보이는 것만', onlySound && '소리만'].filter(Boolean).join(' · ') || '보기'}
                <ChevronDown size={11} />
              </button>
              {filterMenu && (
                <Menu
                  style={{ left: 0, top: 22, minWidth: 200 }}
                  onClose={() => setFilterMenu(false)}
                  items={[
                    { label: '고른 레이어만 (그룹 포함)', active: onlySel, onClick: () => setOnlySel(!onlySel), testId: 'timeline-only-selected' },
                    { label: '지금 화면에 보이는 레이어만', active: onlyNow, onClick: () => setOnlyNow(!onlyNow), testId: 'timeline-only-now' },
                    { label: '소리만 (배경음악·내레이션·효과음)', active: onlySound, onClick: () => setOnlySound(!onlySound), testId: 'timeline-only-sound' },
                    { label: '모두 보기', onClick: () => (setOnlySel(false), setOnlyNow(false), setOnlySound(false)), testId: 'timeline-show-all' },
                  ]}
                />
              )}
            </span>
            {solo.length > 0 && (
              <button className="btn ghost sm" style={{ height: 18, marginLeft: 6 }} onClick={() => useEditor.setState({ solo: [] })} title="솔로 모두 끄기">
                솔로 끄기
              </button>
            )}
            {/* the grip stays inside the name column: the ruler's very start (0 s) is the ruler's */}
            <div style={{ position: 'absolute', right: 3, top: 0, height: 24, display: 'flex' }}>
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
            {wa && <div className="tl-workarea" style={{ left: px(wa.a), width: px(wa.b - wa.a) }} title="작업 영역 (B/N)" />}
            {ticks.out.map(({ t, major }) => (
              <div key={t.toFixed(3)} style={{ position: 'absolute', left: px(t), bottom: 0, height: major ? 9 : 4, width: 1, background: 'var(--border-strong)', pointerEvents: 'none' }}>
                {major && t < d - 1e-6 && (
                  <span className="tiny faint" style={{ position: 'absolute', left: 3, bottom: 7, whiteSpace: 'nowrap' }}>
                    {frames ? timecode(t, fps).slice(3) : ticks.step < 1 ? `${t.toFixed(ticks.step < 0.5 ? 2 : 1)}s` : `${Math.round(t)}s`}
                  </span>
                )}
              </div>
            ))}
            {sel && <div style={{ position: 'absolute', left: px(Math.min(sel.a, sel.b)), width: px(Math.abs(sel.b - sel.a)), top: 0, bottom: 0, background: 'var(--accent-soft)', border: '1px solid var(--accent)', pointerEvents: 'none' }} />}
            {marks.map((m) => (
              <div key={m.id} title={`${m.n}번 표시`} style={{ position: 'absolute', left: px(m.time) - 4, top: 2, width: 8, height: 8, borderRadius: 4, background: 'var(--mark)', pointerEvents: 'none' }} />
            ))}
            {markers.map((m) => {
              const mdx = drag?.kind === 'marker' && drag.id === m.id ? drag.dx : 0
              return (
                <div
                  key={m.id}
                  className="tl-marker"
                  style={{ left: px(m.t) + mdx }}
                  title={`${m.label} · ${fmt(m.t)} · 클릭: 이동 · 끌기: 옮기기 · 더블클릭: 이름 · 오른쪽 클릭: 삭제`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    startDrag(e, { kind: 'marker', id: m.id, dx: 0 }, (dt) => updateMarker(m.id, { t: snapT(m.t + dt) }))
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragged.current) return void (dragged.current = false)
                    seek(m.t)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setRenaming(`marker:${m.id}`)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({ x: e.clientX, y: e.clientY, items: [{ label: '이 마커로 이동', onClick: () => seek(m.t) }, { label: '마커 삭제', danger: true, onClick: () => removeMarker(m.id) }] })
                  }}
                  data-testid="marker"
                >
                  {renaming === `marker:${m.id}` ? (
                    <input
                      autoFocus
                      className="input"
                      style={{ position: 'absolute', left: 3, top: 0, height: 18, width: 110, fontSize: 11, padding: '0 4px', zIndex: 3 }}
                      defaultValue={m.label}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== m.label) updateMarker(m.id, { label: v })
                        setRenaming(null)
                      }}
                      data-testid="marker-rename"
                    />
                  ) : (
                    <span>{m.label}</span>
                  )}
                </div>
              )
            })}
            {project?.hasVideo && (
              // the grip sits on the exact time; the time label goes to whichever side has room
              <PlayheadHead px={px} trackW={trackW} fmt={fmt} onPointerDown={scrub} />
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
          <PlayheadLine left={layerW} px={px} onPointerDown={project?.hasVideo ? scrub : undefined} />
          {drag?.kind === 'layer' && drag.snapAt != null && <div className="tl-snap-line" style={{ left: layerW + px(drag.snapAt) }} data-testid="timeline-snap" />}
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
      {curve && (
        <CurveEditor
          value={curve.value}
          at={curve}
          onClose={() => setCurve(null)}
          onApply={(ease) => {
            curve.apply(ease)
            setCurve(null)
          }}
        />
      )}
      {menu && <Menu items={menu.items} onClose={() => setMenu(null)} style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 30), maxHeight: '70vh', overflow: 'auto' }} />}
    </div>
  )
}

const isNumberTrackKeys = (ks: { v: number | string }[]) => ks.length > 0 && ks.every((k) => typeof k.v === 'number')
function numericTrack(o: Parameters<typeof trackKeys>[0], t: Track) {
  return isNumberTrackKeys(trackKeys(o, t))
}

/**
 * The value of one keyframed property over time (After Effects' value graph): the curve between
 * the keys with their eases; a key dragged up / down changes its value, sideways its time.
 */
function ValueGraph({ id, track, keys, px, tOf, fps, locked }: { id: string; track: Track; keys: { t: number; v: number | string; e?: string }[]; px: (t: number) => number; tOf: (x: number) => number; fps: number; locked: boolean }) {
  const [drag, setDrag] = useState<{ t: number; nt: number; nv: number } | null>(null)
  const H = 112
  const ks = keys.filter((k) => typeof k.v === 'number') as { t: number; v: number; e?: string }[]
  const vals = ks.map((k) => k.v).concat(drag ? [drag.nv] : [])
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi - lo < 1e-6) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.12
  lo -= pad
  hi += pad
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12)
  const vOf = (py: number) => lo + ((H - 6 - py) / (H - 12)) * (hi - lo)
  const shown = drag ? ks.map((k) => (Math.abs(k.t - drag.t) < 1e-3 ? { ...k, t: drag.nt, v: drag.nv } : k)).sort((a, b) => a.t - b.t) : ks
  const pts: string[] = []
  if (shown.length) {
    const t0 = shown[0].t
    const t1 = shown[shown.length - 1].t
    const steps = Math.max(2, Math.round((px(t1) - px(t0)) / 3))
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps
      pts.push(`${px(t)},${y(Number(keysAt(shown, t) ?? 0))}`)
    }
  }
  const st = useOverrides.getState()
  return (
    <svg width="100%" height={H} style={{ display: 'block', overflow: 'visible' }} data-testid={`value-graph-${id}`}>
      <line x1={0} x2="100%" y1={y(lo + pad)} y2={y(lo + pad)} stroke="var(--border)" strokeDasharray="2 3" />
      <line x1={0} x2="100%" y1={y(hi - pad)} y2={y(hi - pad)} stroke="var(--border)" strokeDasharray="2 3" />
      <text x={4} y={y(hi - pad) - 3} fontSize={9} fill="var(--text-3)">{(hi - pad).toFixed(2)}</text>
      <text x={4} y={y(lo + pad) + 10} fontSize={9} fill="var(--text-3)">{(lo + pad).toFixed(2)}</text>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--warning)" strokeWidth={1.6} />
      {ks.map((k) => {
        const d = drag && Math.abs(drag.t - k.t) < 1e-3 ? drag : null
        return (
          <circle
            key={k.t}
            cx={px(d ? d.nt : k.t)}
            cy={y(d ? d.nv : k.v)}
            r={5}
            fill="#fff"
            stroke="var(--warning)"
            strokeWidth={2}
            style={{ cursor: locked ? 'default' : 'grab' }}
            onPointerDown={(e) => {
              if (locked) return
              e.stopPropagation()
              const el = e.currentTarget
              el.setPointerCapture(e.pointerId)
              const svg = el.ownerSVGElement!.getBoundingClientRect()
              const x0 = e.clientX
              let cur = { t: k.t, nt: k.t, nv: k.v }
              const move = (ev: PointerEvent) => {
                const nt = Math.max(0, Math.round((k.t + tOf(ev.clientX - x0)) * fps) / fps)
                cur = { t: k.t, nt: ev.shiftKey ? k.t : nt, nv: +vOf(ev.clientY - svg.top).toFixed(3) }
                setDrag(cur)
              }
              const up = () => {
                el.removeEventListener('pointermove', move)
                el.removeEventListener('pointerup', up)
                setDrag(null)
                const label = labelOf(id)
                if (Math.abs(cur.nt - k.t) > 1e-4) st.moveKeys(id, label, [{ prop: track, t: k.t }], cur.nt - k.t)
                if (Math.abs(cur.nv - k.v) > 1e-6) useOverrides.getState().setKey(id, label, track, +cur.nt.toFixed(4), cur.nv)
              }
              el.addEventListener('pointermove', move)
              el.addEventListener('pointerup', up)
            }}
            data-testid={`graph-key-${k.t}`}
          />
        )
      })}
    </svg>
  )
}

// The playhead and the timecode are the only parts of the timeline that follow every time update
// while the video plays: small components of their own, so the rows are not drawn again each tick.
function NowLabel({ fmt }: { fmt: (t: number) => string }) {
  const time = useEditor((s) => s.time)
  return <span>{fmt(time)}</span>
}

function PlayheadHead({ px, trackW, fmt, onPointerDown }: { px: (t: number) => number; trackW: number; fmt: (t: number) => string; onPointerDown: (e: React.PointerEvent) => void }) {
  const time = useEditor((s) => s.time)
  // the grip sits on the exact time; the time label goes to whichever side has room
  return (
    <div className="tl-head" style={{ left: px(time) }} onPointerDown={onPointerDown} title="끌어서 원하는 장면으로" data-testid="playhead">
      <i />
      <span className={px(time) > trackW - 70 ? 'left' : ''}>{fmt(time)}</span>
    </div>
  )
}

function PlayheadLine({ left, px, onPointerDown }: { left: number; px: (t: number) => number; onPointerDown?: (e: React.PointerEvent) => void }) {
  const time = useEditor((s) => s.time)
  return <div className="tl-playhead" style={{ left: left + px(time) }} onPointerDown={onPointerDown} data-testid="playhead-line" />
}
