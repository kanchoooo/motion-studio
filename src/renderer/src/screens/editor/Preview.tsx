// The canvas (After Effects' composition panel): the preview, selection with handles
// (scale, rotate, anchor point), moving with smart-guide snapping, marquee selection,
// zoom and pan, rulers with guides, the motion path of keyframed position, mask drawing
// and the feedback marks for Claude. Locked layers let clicks through. A click picks the top
// layer the designer sees at this moment (⌥-click: the one under it); right-click lists every
// layer at that spot and adds guides; a click on the grey area around the frame deselects.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Hash, Loader2, Magnet, Maximize, Ruler, Smartphone } from 'lucide-react'
import { isSpatial, sortedKeys, valueAt, type LayerMask } from '@shared/overrides'
import { Menu, type MenuItem } from '../../components/ui'
import { studio, useStore } from '../../store'
import { freeLayout, isKeyed, isLocked, labelOf, outermost, ov, setProps, valueNow } from './edit'
import { elementsForMark, elementsUnder, useEditor } from './editorStore'
import { useLayout } from './layout'
import { beginEditGesture, useOverrides } from './overrides'
import { ask, hitTest, invertAffine, MsPlayer, queryElements, queryMotions, queryTiming, soloLayers, type Affine, type RuntimeElement } from './player'

const SAFE: Record<string, { top: number; right: number; bottom: number; left: number } | null> = {
  none: null,
  youtube: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  shorts: { top: 0.12, right: 0.18, bottom: 0.25, left: 0.05 },
  reels: { top: 0.13, right: 0.12, bottom: 0.3, left: 0.06 },
  tiktok: { top: 0.13, right: 0.17, bottom: 0.27, left: 0.06 },
}
const SAFE_LABELS: { id: string; label: string }[] = [
  { id: 'youtube', label: '유튜브·TV (가장자리 5%)' },
  { id: 'shorts', label: '유튜브 쇼츠' },
  { id: 'reels', label: '인스타그램 릴스' },
  { id: 'tiktok', label: '틱톡' },
]

/** the platform safe-zone guide (where Shorts / Reels buttons sit): which platform, on or off */
function SafeZoneMenu({ zone, on, onChange }: { zone: string; on: boolean; onChange(zone: string, on: boolean): void }) {
  const { project, setProject, toast } = useStore()
  const value = on && zone !== 'none' ? zone : 'off'
  return (
    <span className="row" style={{ gap: 4 }} title="쇼츠·릴스에서 버튼·글자가 덮는 영역을 점선으로 보여줘요. Claude도 중요한 내용을 이 안에 둬요." data-testid="guide-toggle">
      <Smartphone size={13} color={value === 'off' ? 'var(--text-3)' : 'var(--accent)'} />
      <select
        className="select"
        style={{ height: 24, fontSize: 11, padding: '0 6px', width: 'auto' }}
        value={value}
        onChange={async (e) => {
          const next = e.target.value
          if (next === 'off') return onChange(zone, false)
          onChange(next, true)
          if (next !== zone) {
            try {
              setProject(await studio.projects.saveOutput(project!.meta.id, { safeZone: next as never }))
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error')
            }
          }
        }}
      >
        <option value="off">가이드 끄기</option>
        {SAFE_LABELS.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </select>
    </span>
  )
}

const RULER = 20
type Pt = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

type Gesture =
  | { kind: 'move'; items: { id: string; x: number; y: number; keyed: boolean; rect: Box; unit: number }[]; p0: Pt; moved: boolean; dx: number; dy: number; pickOnClick?: boolean }
  | { kind: 'scale'; id: string; handle: string; p0: Pt; pivot: Pt; sx: number; sy: number; r: number; keyed: boolean; nsx: number; nsy: number; rect0?: Box }
  | { kind: 'rotate'; id: string; p0: Pt; pivot: Pt; r0: number; keyed: boolean; nr: number }
  | { kind: 'anchor'; id: string; p0: Pt; ax: number; ay: number; x: number; y: number; sx: number; sy: number; r: number; keyedPos: boolean; d: Pt }
  | { kind: 'marquee'; p0: Pt; p1: Pt; add: boolean; click?: string }
  | { kind: 'pan'; c0: Pt; panX: number; panY: number }
  | { kind: 'guide'; axis: 'x' | 'y'; index: number; value: number }
  | { kind: 'pathkey'; id: string; t: number; x: number; y: number; p0: Pt; dx: number; dy: number }
  | { kind: 'pathhandle'; id: string; t: number; side: 'o' | 'i'; c: { ox: number; oy: number; ix: number; iy: number }; c0?: { ox: number; oy: number; ix: number; iy: number }; key: Pt }
  | { kind: 'mask'; id: string; p0: Pt; p1: Pt }

export function Preview({ active }: { active: boolean }) {
  const { project, previewNonce, session, toast } = useStore()
  const ed = useEditor()
  const host = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MsPlayer | null>(null)
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 })
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [g, setG] = useState<Gesture | null>(null)
  const gRef = useRef<Gesture | null>(null)
  const [snapLines, setSnapLines] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [hand, setHand] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  /** the layer under the pointer (outlined, named) and one a menu item points at */
  const [hover, setHover] = useState<string | null>(null)
  const hovering = useRef<{ busy: boolean; next: Pt | null; over: boolean }>({ busy: false, next: null, over: false })
  const { guides: safeOn, rulers, showGuides, snap, set: setLayout } = useLayout()
  const overrides = useOverrides((s) => s.value)
  const pid = project!.meta.id
  const out = project!.brief.output
  const W = out.width
  const H = out.height
  const setGesture = (next: Gesture | null) => {
    gRef.current = next
    setG(next)
  }

  // ---- mount / reload the preview iframe ----
  useEffect(() => {
    if (!project?.hasVideo) return
    let disposed = false
    let player: MsPlayer | null = null
    void (async () => {
      const { src } = await studio.projects.previewUrl(pid)
      if (disposed || !host.current) return
      useEditor.setState({ compBase: src.replace(/index\.html$/, '') })
      const keepTime = useEditor.getState().time
      player = new MsPlayer(`${src}?ms-preview=1&v=${previewNonce}`, out.width, out.height, {
        ready: (duration) => {
          useEditor.setState({ ready: true, duration: duration || out.duration })
          void studio.projects.audio(pid).then((audio) => useEditor.setState({ audio }))
          void queryTiming(player).then((timing) => useEditor.setState({ timing }))
          void queryMotions(player).then(({ items, stale }) => useEditor.setState({ motions: items, staleMotions: stale }))
          if (keepTime > 0) player!.seek(Math.min(keepTime, duration || keepTime))
          const solo = useEditor.getState().solo
          if (solo.length) void soloLayers(player, solo)
          // edits made while it was opening (not saved yet) reach the new page too
          const pending = useOverrides.getState()
          if (pending.dirty && pending.value) void ask(player, { ms: 'apply-styles', overrides: pending.value })
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

  // ---- host size (the frame is fitted or zoomed inside it) ----
  const measure = useCallback(() => {
    const h = host.current
    if (!h) return
    const r = h.getBoundingClientRect()
    setHostSize({ w: r.width, h: r.height })
  }, [])
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (host.current) ro.observe(host.current)
    return () => ro.disconnect()
    // the host div only exists once there is a video: measure again when the first one arrives
  }, [measure, active, project?.hasVideo])

  // ---- element boxes follow the playhead when paused ----
  const refreshElements = useCallback(async () => {
    const els = await queryElements(playerRef.current)
    if (!els) return
    useEditor.setState({ elements: els })
    void studio.projects.reportElements(pid, els.map((e) => ({ id: e.id, label: e.label, movable: e.movable })))
  }, [pid])
  useEffect(() => {
    if (!ed.playing && !ed.scrubbing) void refreshElements()
  }, [ed.time, ed.playing, ed.scrubbing, refreshElements])

  // H: hand tool while held
  useEffect(() => {
    if (!active) return
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      // the H key (also with the Korean keyboard on: "ㅗ")
      if (e.code === 'KeyH') setHand(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') setHand(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [active])

  // ---- view: fitted, or zoomed and panned (composition px) ----
  const pad = rulers ? RULER : 0
  const availW = Math.max(1, hostSize.w - pad)
  const availH = Math.max(1, hostSize.h - pad)
  const fit = Math.min(availW / W, availH / H)
  const view = ed.view
  const scale = view.zoom ?? fit
  const frame = hostSize.w
    ? { x: pad + availW / 2 - (W / 2 + (view.zoom ? view.panX : 0)) * scale, y: pad + availH / 2 - (H / 2 + (view.zoom ? view.panY : 0)) * scale, w: W * scale, h: H * scale }
    : null
  const setZoom = (z: number | null, at?: Pt) => {
    if (z == null) return useEditor.setState({ view: { zoom: null, panX: 0, panY: 0 } })
    const nz = Math.max(0.05, Math.min(8, z))
    // keep the point under the cursor where it is
    const c = at ?? { x: W / 2 + (view.zoom ? view.panX : 0), y: H / 2 + (view.zoom ? view.panY : 0) }
    const cur = { x: W / 2 + (view.zoom ? view.panX : 0), y: H / 2 + (view.zoom ? view.panY : 0) }
    const k = scale / nz
    useEditor.setState({ view: { zoom: nz, panX: c.x - (c.x - cur.x) * k - W / 2, panY: c.y - (c.y - cur.y) * k - H / 2 } })
  }
  useEffect(() => {
    canvasView.zoomBy = (f) => setZoom(scale * f)
    canvasView.fit = () => setZoom(null)
    canvasView.actual = () => setZoom(1)
  })

  const toComp = (clientX: number, clientY: number): Pt => {
    const r = host.current!.getBoundingClientRect()
    return { x: (clientX - r.left - frame!.x) / scale, y: (clientY - r.top - frame!.y) / scale }
  }
  // a character's parts can be picked once the character (or one of its parts) is: a click on the
  // character picks it, the next click on it picks the part under the pointer
  const partsOpen = (x: RuntimeElement) => !!x.parent && ed.selection.some((id) => id === x.parent || id.startsWith(`${x.parent}::`))
  const visibleEls = ed.elements.filter((x) => x.visible && !ov(x.id)?.deleted && x.type !== 'camera' && (x.type !== 'part' || partsOpen(x)))
  const pickable = (els: RuntimeElement[]) => els.filter((x) => !isLocked(x.id))

  // ---- snapping: canvas edges / centre, guides, other layers' edges and centres ----
  const guides = overrides?.guides ?? { x: [], y: [] }
  const guidesOn = showGuides
  /** lines a moving edge snaps to: the canvas edges and centre, the guides, other layers' edges and centres */
  const snapLinesFor = (skip: Set<string>) => {
    const xs = [0, W / 2, W, ...(guidesOn ? guides.x : [])]
    const ys = [0, H / 2, H, ...(guidesOn ? guides.y : [])]
    for (const e of visibleEls) {
      if (skip.has(e.id) || e.rect.w * e.rect.h > W * H * 0.9) continue
      xs.push(e.rect.x, e.rect.x + e.rect.w / 2, e.rect.x + e.rect.w)
      ys.push(e.rect.y, e.rect.y + e.rect.h / 2, e.rect.y + e.rect.h)
    }
    return { xs, ys }
  }
  const snapMove = (boxes: Box[], dx: number, dy: number, skip: Set<string>, off: boolean) => {
    if (!snap || off || !boxes.length) return { dx, dy, lines: { x: [] as number[], y: [] as number[] } }
    const u = { x: Math.min(...boxes.map((b) => b.x)) + dx, y: Math.min(...boxes.map((b) => b.y)) + dy, r: Math.max(...boxes.map((b) => b.x + b.w)) + dx, b: Math.max(...boxes.map((b) => b.y + b.h)) + dy }
    const { xs, ys } = snapLinesFor(skip)
    const tol = 6 / scale
    const best = (edges: number[], cands: number[]) => {
      let b: { d: number; at: number } | null = null
      for (const e of edges) for (const c of cands) if (Math.abs(c - e) <= tol && (!b || Math.abs(c - e) < Math.abs(b.d))) b = { d: c - e, at: c }
      return b
    }
    const bx = best([u.x, (u.x + u.r) / 2, u.r], xs)
    const by = best([u.y, (u.y + u.b) / 2, u.b], ys)
    return { dx: dx + (bx?.d ?? 0), dy: dy + (by?.d ?? 0), lines: { x: bx ? [bx.at] : [], y: by ? [by.at] : [] } }
  }
  /**
   * Scaling an upright layer by a handle: the edges the handle moves snap like a moved layer's do
   * (a corner keeps the proportions: the nearer of its two edges decides).
   */
  const snapScale = (cur: Extract<Gesture, { kind: 'scale' }>, fx: number, fy: number, off: boolean) => {
    const none = { fx, fy, lines: { x: [] as number[], y: [] as number[] } }
    const r0 = cur.rect0
    if (!snap || off || !r0 || Math.abs(cur.r % 360) > 0.5) return none
    const { xs, ys } = snapLinesFor(new Set([cur.id]))
    const tol = 6 / scale
    const near = (edge0: number, pivot: number, f: number, cands: number[]) => {
      if (Math.abs(edge0 - pivot) < 1) return null
      const at = pivot + (edge0 - pivot) * f
      let b: { d: number; line: number } | null = null
      for (const c of cands) if (Math.abs(c - at) <= tol && (!b || Math.abs(c - at) < Math.abs(b.d))) b = { d: c - at, line: c }
      return b ? { ...b, f: (b.line - pivot) / (edge0 - pivot) } : null
    }
    const h = cur.handle
    const ex = h.includes('e') ? near(r0.x + r0.w, cur.pivot.x, fx, xs) : h.includes('w') ? near(r0.x, cur.pivot.x, fx, xs) : null
    const ey = h.includes('s') ? near(r0.y + r0.h, cur.pivot.y, fy, ys) : h.includes('n') ? near(r0.y, cur.pivot.y, fy, ys) : null
    if (h.length === 2 && Math.abs(fx) === Math.abs(fy)) {
      // proportional corner: one factor for both
      const pick = ex && (!ey || Math.abs(ex.d) <= Math.abs(ey.d)) ? ex : ey
      if (!pick) return none
      const f = Math.abs(pick.f)
      return { fx: f * Math.sign(fx || 1), fy: f * Math.sign(fy || 1), lines: { x: pick === ex ? [ex!.line] : [], y: pick === ey ? [ey!.line] : [] } }
    }
    return { fx: ex ? ex.f : fx, fy: ey ? ey.f : fy, lines: { x: ex ? [ex.line] : [], y: ey ? [ey.line] : [] } }
  }

  /** the layers at a point as seen now, pickable ones only (null: the preview did not answer) */
  const layersAt = async (p: Pt): Promise<string[] | null> => {
    const ok = new Set(pickable(visibleEls).map((x) => x.id))
    const painted = await hitTest(playerRef.current, p.x, p.y)
    return painted === null ? null : painted.filter((id) => ok.has(id))
  }
  /** right-click: every layer at that spot (pick one), and guides */
  const canvasMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!frame) return
    const p = toComp(e.clientX, e.clientY)
    const at = { x: e.clientX, y: e.clientY }
    const ids = (await layersAt(p)) ?? elementsUnder(pickable(visibleEls), { x: p.x, y: p.y, w: 1, h: 1 }).map((h) => h.id)
    const st = useOverrides.getState()
    const gx = Math.round(p.x)
    const gy = Math.round(p.y)
    const items: MenuItem[] = []
    if (ids.length) {
      items.push({ heading: true, label: `여기 있는 레이어 ${ids.length}개 · 위에서부터`, onClick: () => {} })
      for (const id of ids.slice(0, 12))
        items.push({ label: labelOf(id), active: ed.selection.includes(id), onClick: () => ed.select(id), onHover: (on) => useEditor.setState({ peek: on ? id : null }), testId: 'here-layer' })
    }
    items.push({ heading: true, label: '가이드', onClick: () => {} })
    items.push({ label: `여기에 가로 가이드 (y ${gy})`, onClick: () => st.setGuides({ ...guides, y: [...guides.y, gy] }), testId: 'add-guide-y' })
    items.push({ label: `여기에 세로 가이드 (x ${gx})`, onClick: () => st.setGuides({ ...guides, x: [...guides.x, gx] }), testId: 'add-guide-x' })
    const s1 = sel && ed.selection.length <= 1 ? sel : null
    if (s1) {
      const r = s1.rect
      items.push({
        label: `「${labelOf(s1.id)}」 가장자리에 가이드`,
        onClick: () => st.setGuides({ x: [...new Set([...guides.x, Math.round(r.x), Math.round(r.x + r.w)])], y: [...new Set([...guides.y, Math.round(r.y), Math.round(r.y + r.h)])] }),
        testId: 'guides-around',
      })
    }
    items.push({ label: '캔버스 가운데에 가이드', onClick: () => st.setGuides({ x: [...new Set([...guides.x, Math.round(W / 2)])], y: [...new Set([...guides.y, Math.round(H / 2)])] }) })
    if (guides.x.length || guides.y.length) {
      items.push({ label: guidesOn ? '가이드 숨기기 (⌘;)' : '가이드 보이기 (⌘;)', onClick: () => setLayout({ showGuides: !guidesOn }) })
      items.push({ label: `가이드 모두 지우기 (${guides.x.length + guides.y.length}개)`, danger: true, onClick: () => st.setGuides({ x: [], y: [] }), testId: 'clear-guides' })
    }
    items.push({ label: rulers ? '눈금자 숨기기 (⌘R)' : '눈금자 보이기 (⌘R) · 끌어서 가이드', onClick: () => setLayout({ rulers: !rulers }) })
    items.push({ label: snap ? '스냅 끄기' : '스냅 켜기', onClick: () => setLayout({ snap: !snap }) })
    setMenu({ ...at, items })
  }
  /** the pointer over the canvas: outline and name the layer it would pick (one lookup at a time) */
  const trackHover = (p: Pt) => {
    const h = hovering.current
    h.next = p
    h.over = true
    if (h.busy) return
    h.busy = true
    void (async () => {
      while (h.next) {
        const q = h.next
        h.next = null
        const ids = await layersAt(q)
        // the pointer left while this was looked up
        setHover(h.over ? (ids?.[0] ?? null) : null)
      }
      h.busy = false
    })()
  }

  // ---- pointer handling ----
  const sel = ed.elements.find((x) => x.id === ed.selected)
  const single = ed.selection.length <= 1 && sel && !isLocked(sel.id) ? sel : null
  /** a press whose top layer is still being looked up (a quick click may end before the answer) */
  const pressing = useRef<{ up: boolean } | null>(null)
  const onDown = async (e: React.PointerEvent) => {
    if (!frame) return
    const p = toComp(e.clientX, e.clientY)
    const target = e.currentTarget as HTMLElement
    const capture = () => {
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        /* the button was already let go */
      }
    }
    // pan: hand tool or middle button
    if (hand || e.button === 1) {
      capture()
      setGesture({ kind: 'pan', c0: { x: e.clientX, y: e.clientY }, panX: view.zoom ? view.panX : 0, panY: view.zoom ? view.panY : 0 })
      if (!view.zoom) useEditor.setState({ view: { zoom: scale, panX: 0, panY: 0 } })
      return
    }
    if (e.button !== 0) return
    // drawing a mask for a layer
    if (ed.maskDraw) {
      capture()
      setGesture({ kind: 'mask', id: ed.maskDraw, p0: p, p1: p })
      return
    }
    if (ed.tool === 'select') {
      playerRef.current?.pause()
      const add = e.shiftKey || e.metaKey || e.ctrlKey
      // the top layer the designer sees here now (After Effects picks the top layer under the pointer);
      // locked, hidden and faded-out ones let the click through
      const press = { up: false }
      pressing.current = press
      const painted = await layersAt(p)
      pressing.current = null
      // only when the preview did not answer: the smallest box there
      const hits = painted !== null ? painted.map((id) => ({ id })) : elementsUnder(pickable(visibleEls), { x: p.x, y: p.y, w: 1, h: 1 })
      // ⌥-click: the next layer down under the pointer (each click goes one deeper)
      if (e.altKey && hits.length) {
        const i = hits.findIndex((h) => h.id === useEditor.getState().selected)
        return void ed.select(hits[(i + 1) % hits.length].id)
      }
      if (press.up) {
        // the button was let go while looking: a plain click
        if (!hits.length) return void (!add && ed.select(null))
        return void ed.select(hits[0].id, add)
      }
      // a press inside the box of what is picked where that layer paints nothing and only the canvas
      // background (or nothing) is there — around a turned layer, between letters — drags the picked
      // layers, as a press on them does; a click there without moving still picks as before
      if (!add) {
        const picked = outermost(ed.selection, ed.elements)
          .map((id) => ed.elements.find((x) => x.id === id))
          .filter((x): x is RuntimeElement => !!x && x.type !== 'camera' && x.movable && !isLocked(x.id))
        const inBox = picked.some((x) => p.x >= x.rect.x && p.x <= x.rect.x + x.rect.w && p.y >= x.rect.y && p.y <= x.rect.y + x.rect.h)
        const top = hits.length ? ed.elements.find((x) => x.id === hits[0].id) : undefined
        const onlyBackground = !hits.length || (!!top && top.rect.w * top.rect.h > W * H * 0.9 && !ed.selection.includes(top.id))
        if (picked.length && inBox && onlyBackground && !hits.some((h) => ed.selection.includes(h.id))) {
          capture()
          beginEditGesture()
          setGesture({ kind: 'move', items: picked.map((el) => ({ id: el.id, x: valueNow(el.id, 'x'), y: valueNow(el.id, 'y'), keyed: isKeyed(el.id, 'x') || isKeyed(el.id, 'y'), rect: el.rect, unit: el.unit ?? 1 })), p0: p, moved: false, dx: 0, dy: 0, pickOnClick: true })
          return
        }
      }
      if (!hits.length) {
        // empty canvas: marquee selection
        if (!add) ed.select(null)
        capture()
        setGesture({ kind: 'marquee', p0: p, p1: p, add })
        return
      }
      // a full-canvas background that is not selected: dragging on it draws a marquee, a click picks it
      const top = ed.elements.find((x) => x.id === hits[0].id)
      if (top && top.rect.w * top.rect.h > W * H * 0.9 && !ed.selection.includes(top.id) && !add) {
        capture()
        setGesture({ kind: 'marquee', p0: p, p1: p, add: false, click: top.id })
        return
      }
      if (add) {
        // Shift/⌘: add the element under the pointer, or take it out again
        ed.select(hits[0].id, true)
        return
      }
      // clicking inside the current selection keeps it, so all of it can be dragged
      const inside = hits.find((h) => ed.selection.includes(h.id))
      if (!inside) ed.select(hits[0].id)
      // a picked group carries its picked layers along: they are not moved twice
      const ids = inside ? outermost(ed.selection, ed.elements) : [hits[0].id]
      const movable = ids.map((id) => ed.elements.find((x) => x.id === id)).filter((x): x is RuntimeElement => !!x && x.movable && !isLocked(x.id))
      if (movable.length) {
        capture()
        beginEditGesture()
        setGesture({ kind: 'move', items: movable.map((el) => ({ id: el.id, x: valueNow(el.id, 'x'), y: valueNow(el.id, 'y'), keyed: isKeyed(el.id, 'x') || isKeyed(el.id, 'y'), rect: el.rect, unit: el.unit ?? 1 })), p0: p, moved: false, dx: 0, dy: 0 })
      }
      return
    }
    // feedback marks for Claude
    playerRef.current?.pause()
    if (ed.tool === 'pin') {
      const time = ed.time
      void (async () => {
        // what is seen there now, top first (a layer that is invisible at this moment is not it): the
        // layer and what holds it — locked ones too, the pin is for Claude
        const known = new Map(ed.elements.filter((x) => x.type !== 'camera').map((x) => [x.id, x.label]))
        const painted = await hitTest(playerRef.current, p.x, p.y)
        const elements = painted
          ? painted.filter((id) => known.has(id)).slice(0, 2).map((id) => ({ id, label: known.get(id)! }))
          : elementsUnder(ed.elements, { x: p.x, y: p.y, w: 1, h: 1 }).slice(0, 1)
        ed.addMark({ kind: 'pin', rect: { x: p.x, y: p.y, w: 0, h: 0 }, time, note: '', elements })
      })()
      return
    }
    capture()
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: React.PointerEvent) => {
    const cur = gRef.current
    if (cur && frame) {
      const p = toComp(e.clientX, e.clientY)
      if (cur.kind === 'pan') {
        setGesture(cur)
        useEditor.setState({ view: { zoom: useEditor.getState().view.zoom ?? scale, panX: cur.panX - (e.clientX - cur.c0.x) / scale, panY: cur.panY - (e.clientY - cur.c0.y) / scale } })
        return
      }
      if (cur.kind === 'marquee' || cur.kind === 'mask') return setGesture({ ...cur, p1: p })
      if (cur.kind === 'move') {
        let dx = p.x - cur.p0.x
        let dy = p.y - cur.p0.y
        if (!cur.moved && Math.abs(dx) + Math.abs(dy) < 3 / scale) return
        // Shift locks to one axis, like design tools
        if (e.shiftKey) {
          if (Math.abs(dy) > Math.abs(dx)) dx = 0
          else dy = 0
        }
        const s = snapMove(cur.items.map((i) => i.rect), dx, dy, new Set(cur.items.map((i) => i.id)), e.metaKey || e.ctrlKey)
        setSnapLines(s.lines)
        const next = { ...cur, moved: true, dx: Math.round(s.dx), dy: Math.round(s.dy) }
        setGesture(next)
        // fixed values follow live; keyframed ones get their key when the drag ends
        const live = next.items.filter((i) => !i.keyed)
        if (live.length) setProps(live.map((i) => ({ id: i.id, values: { x: i.x + next.dx / i.unit, y: i.y + next.dy / i.unit } })), ['x', 'y'])
        return
      }
      if (cur.kind === 'scale') {
        const rad = (cur.r * Math.PI) / 180
        const ux = { x: Math.cos(rad), y: Math.sin(rad) }
        const uy = { x: -Math.sin(rad), y: Math.cos(rad) }
        const v0 = { x: cur.p0.x - cur.pivot.x, y: cur.p0.y - cur.pivot.y }
        const v1 = { x: p.x - cur.pivot.x, y: p.y - cur.pivot.y }
        const proj = (v: Pt, u: Pt) => v.x * u.x + v.y * u.y
        const ratio = (a: number, b: number) => (Math.abs(b) < 1e-3 ? 1 : a / b)
        let fx = ratio(proj(v1, ux), proj(v0, ux))
        let fy = ratio(proj(v1, uy), proj(v0, uy))
        const corner = cur.handle.length === 2
        if (cur.handle === 'e' || cur.handle === 'w') fy = 1
        if (cur.handle === 'n' || cur.handle === 's') fx = 1
        if (corner && !e.shiftKey) {
          const f = Math.hypot(v1.x, v1.y) / Math.max(1e-3, Math.hypot(v0.x, v0.y))
          fx = f * Math.sign(fx || 1)
          fy = f * Math.sign(fy || 1)
        }
        const sn = snapScale(cur, fx, fy, e.metaKey || e.ctrlKey)
        fx = sn.fx
        fy = sn.fy
        setSnapLines(sn.lines)
        const next = { ...cur, nsx: +(cur.sx * fx).toFixed(4), nsy: +(cur.sy * fy).toFixed(4) }
        setGesture(next)
        if (!cur.keyed) setProps([{ id: cur.id, values: { scaleX: next.nsx, scaleY: next.nsy } }], ['scaleX'])
        return
      }
      if (cur.kind === 'rotate') {
        const a0 = Math.atan2(cur.p0.y - cur.pivot.y, cur.p0.x - cur.pivot.x)
        const a1 = Math.atan2(p.y - cur.pivot.y, p.x - cur.pivot.x)
        let r = cur.r0 + ((a1 - a0) * 180) / Math.PI
        if (e.shiftKey) r = Math.round(r / 15) * 15
        const next = { ...cur, nr: +r.toFixed(1) }
        setGesture(next)
        if (!cur.keyed) setProps([{ id: cur.id, values: { rotate: next.nr } }], ['rotate'])
        return
      }
      if (cur.kind === 'anchor') {
        setGesture({ ...cur, d: { x: p.x - cur.p0.x, y: p.y - cur.p0.y } })
        return
      }
      if (cur.kind === 'pathkey') {
        setGesture({ ...cur, dx: Math.round(p.x - cur.p0.x), dy: Math.round(p.y - cur.p0.y) })
        return
      }
      if (cur.kind === 'pathhandle') {
        const dx = Math.round(p.x - cur.key.x)
        const dy = Math.round(p.y - cur.key.y)
        // a smooth key: the other handle points the other way
        setGesture({ ...cur, c: cur.side === 'o' ? { ox: dx, oy: dy, ix: -dx, iy: -dy } : { ix: dx, iy: dy, ox: -dx, oy: -dy } })
        return
      }
      if (cur.kind === 'guide') {
        let v = Math.round(cur.axis === 'x' ? p.x : p.y)
        // a guide being placed snaps to the canvas centre and edges and to layer edges (⌘: free)
        if (snap && !(e.metaKey || e.ctrlKey)) {
          const { xs, ys } = snapLinesFor(new Set())
          const own = new Set(guides[cur.axis])
          const cands = (cur.axis === 'x' ? xs : ys).filter((c) => !own.has(c))
          const hit = cands.reduce<number | null>((b, c) => (Math.abs(c - v) <= 6 / scale && (b === null || Math.abs(c - v) < Math.abs(b - v)) ? c : b), null)
          if (hit !== null) v = Math.round(hit)
        }
        setGesture({ ...cur, value: v })
        return
      }
      return
    }
    if (!draft || !frame) {
      if (frame && ed.tool === 'select' && !ed.playing && !hand && !markMode) trackHover(toComp(e.clientX, e.clientY))
      return
    }
    const p = toComp(e.clientX, e.clientY)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }
  /** a click there, as before: the top layer under the pointer (the canvas background), or nothing */
  const pickUnder = async (p: Pt) => {
    const painted = await layersAt(p)
    const hits = painted !== null ? painted : elementsUnder(pickable(visibleEls), { x: p.x, y: p.y, w: 1, h: 1 }).map((h) => h.id)
    useEditor.getState().select(hits[0] ?? null)
  }
  const onUp = (e: React.PointerEvent) => {
    if (pressing.current) pressing.current.up = true
    const cur = gRef.current
    setGesture(null)
    setSnapLines({ x: [], y: [] })
    if (cur) {
      const st = useOverrides.getState()
      // pressed in an empty part of the picked layer's box and let go without moving: a click, as before
      if (cur.kind === 'move' && !cur.moved && cur.pickOnClick) void pickUnder(cur.p0)
      if (cur.kind === 'move' && cur.moved) {
        const keyed = cur.items.filter((i) => i.keyed)
        if (keyed.length) setProps(keyed.map((i) => ({ id: i.id, values: { x: i.x + cur.dx / i.unit, y: i.y + cur.dy / i.unit } })), ['x', 'y'])
      }
      // a click on a handle that did not move it adds no keyframe
      if (cur.kind === 'scale' && cur.keyed && (cur.nsx !== cur.sx || cur.nsy !== cur.sy)) setProps([{ id: cur.id, values: { scaleX: cur.nsx, scaleY: cur.nsy } }], ['scaleX'])
      if (cur.kind === 'rotate' && cur.keyed && cur.nr !== cur.r0) setProps([{ id: cur.id, values: { rotate: cur.nr } }], ['rotate'])
      if (cur.kind === 'anchor' && (cur.d.x || cur.d.y)) {
        // the pivot moves, the layer stays where it is: anchor += M⁻¹·d, position += d − anchor change
        const rad = (cur.r * Math.PI) / 180
        const lx = (Math.cos(rad) * cur.d.x + Math.sin(rad) * cur.d.y) / (cur.sx || 1)
        const ly = (-Math.sin(rad) * cur.d.x + Math.cos(rad) * cur.d.y) / (cur.sy || 1)
        const transform: Record<string, number> = { anchorX: Math.round(cur.ax + lx), anchorY: Math.round(cur.ay + ly) }
        if (!cur.keyedPos) {
          transform.x = Math.round(cur.x + cur.d.x - lx)
          transform.y = Math.round(cur.y + cur.d.y - ly)
        }
        st.patchElement(cur.id, labelOf(cur.id), { transform }, ['anchor'])
      }
      if (cur.kind === 'marquee') {
        const r = { x: Math.min(cur.p0.x, cur.p1.x), y: Math.min(cur.p0.y, cur.p1.y), w: Math.abs(cur.p1.x - cur.p0.x), h: Math.abs(cur.p1.y - cur.p0.y) }
        if (cur.click && (r.w <= 4 / scale || r.h <= 4 / scale)) ed.select(cur.click)
        else if (r.w > 4 / scale && r.h > 4 / scale) {
          const inside = pickable(visibleEls).filter((x) => x.type !== 'camera' && x.type !== 'part' && x.rect.x < r.x + r.w && x.rect.x + x.rect.w > r.x && x.rect.y < r.y + r.h && x.rect.y + x.rect.h > r.y && x.rect.w * x.rect.h < W * H * 0.9)
          const ids = inside.map((x) => x.id)
          const next = cur.add ? [...new Set([...ed.selection, ...ids])] : ids
          useEditor.setState({ selection: next, selected: next[0] ?? null })
        }
      }
      if (cur.kind === 'pathkey' && (cur.dx || cur.dy)) st.setKey(cur.id, labelOf(cur.id), ['x', 'y'], cur.t, [cur.x + cur.dx, cur.y + cur.dy])
      if (cur.kind === 'pathhandle' && JSON.stringify(cur.c) !== JSON.stringify(cur.c0)) st.setKeyHandles(cur.id, labelOf(cur.id), cur.t, cur.c)
      // a guide clicked but not moved: nothing to save
      if (cur.kind === 'guide' && !(cur.index >= 0 && guides[cur.axis][cur.index] === cur.value)) {
        const list = [...guides[cur.axis]]
        const outside = cur.value < 0 || cur.value > (cur.axis === 'x' ? W : H)
        if (cur.index >= 0) list.splice(cur.index, 1)
        if (!outside) list.push(cur.value)
        st.setGuides({ ...guides, [cur.axis]: list })
      }
      if (cur.kind === 'mask') {
        const el = ed.elements.find((x) => x.id === cur.id)
        const r = el && maskRect(el, cur.p0, cur.p1)
        if (r && r.w > 2 && r.h > 2) {
          const m = ov(cur.id)?.mask
          st.patchElement(cur.id, labelOf(cur.id), { mask: { shape: m?.shape ?? 'rect', feather: m?.feather ?? 0, radius: m?.radius, invert: m?.invert, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } }, ['mask'])
        }
        useEditor.setState({ maskDraw: null })
      }
      return
    }
    if (!draft) return
    const rect = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) }
    setDraft(null)
    if (rect.w < 6 || rect.h < 6) return
    ed.addMark({ kind: 'box', rect, time: ed.time, note: '', elements: elementsForMark(ed.elements, rect, { w: out.width, h: out.height }).slice(0, 3) })
    void e
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!frame) return
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      setZoom(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), toComp(e.clientX, e.clientY))
    } else if (view.zoom) {
      useEditor.setState({ view: { zoom: view.zoom, panX: view.panX + e.deltaX / scale, panY: view.panY + e.deltaY / scale } })
    }
  }
  // the canvas swallows the page's wheel only while zooming
  useEffect(() => {
    const h = host.current
    if (!h) return
    const stop = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey || useEditor.getState().view.zoom) e.preventDefault()
    }
    h.addEventListener('wheel', stop, { passive: false })
    return () => h.removeEventListener('wheel', stop)
  }, [project?.hasVideo])

  const startHandle = (e: React.PointerEvent, el: RuntimeElement, handle: string) => {
    // the anchor point sits in the middle, where a layer is grabbed to move it: it moves the anchor only
    // with ⌥ held (After Effects' Pan Behind); a plain press goes on to the canvas and moves the layer
    if (handle === 'anchor' && !e.altKey) return
    e.stopPropagation()
    // a layer placed by the composition's layout (flex, grid, flow): its group is set free first —
    // nothing moves on screen, and from then on it scales, turns and takes effects like any layer
    if (!el.transformable) {
      void freeLayout(el.id).then((ok) => toast(ok ? '이 묶음을 자유 배치로 바꿨어요. 화면이 다시 열리면 크기·회전을 조절해 주세요.' : '이 레이어는 자유 배치로 바꿀 수 없어요.', ok ? 'success' : 'error'))
      return
    }
    if (!el.pivot) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    playerRef.current?.pause()
    beginEditGesture()
    const p0 = toComp(e.clientX, e.clientY)
    if (handle === 'rot') setGesture({ kind: 'rotate', id: el.id, p0, pivot: el.pivot, r0: valueNow(el.id, 'rotate'), keyed: isKeyed(el.id, 'rotate'), nr: valueNow(el.id, 'rotate') })
    else if (handle === 'anchor') {
      const t = ov(el.id)?.transform ?? {}
      setGesture({ kind: 'anchor', id: el.id, p0, ax: t.anchorX ?? 0, ay: t.anchorY ?? 0, x: valueNow(el.id, 'x'), y: valueNow(el.id, 'y'), sx: valueNow(el.id, 'scaleX'), sy: valueNow(el.id, 'scaleY'), r: valueNow(el.id, 'rotate'), keyedPos: isKeyed(el.id, 'x') || isKeyed(el.id, 'y'), d: { x: 0, y: 0 } })
    } else setGesture({ kind: 'scale', id: el.id, handle, p0, pivot: el.pivot, sx: valueNow(el.id, 'scaleX'), sy: valueNow(el.id, 'scaleY'), r: valueNow(el.id, 'rotate'), keyed: isKeyed(el.id, 'scaleX') || isKeyed(el.id, 'scaleY'), nsx: valueNow(el.id, 'scaleX'), nsy: valueNow(el.id, 'scaleY'), rect0: { ...el.rect } })
  }
  const startGuide = (e: React.PointerEvent, axis: 'x' | 'y', index: number, value: number) => {
    e.stopPropagation()
    // a new guide out of the ruler is shown even when guides were hidden
    if (!guidesOn) setLayout({ showGuides: true })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setGesture({ kind: 'guide', axis, index, value })
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

  const safe = SAFE[out.safeZone]
  const many = ed.selection.length > 1
  const markMode = ed.tool !== 'select'
  const visibleMarks = ed.marks.filter((m) => ed.markTime == null || Math.abs(m.time - ed.time) < 0.05 || !ed.ready)
  const S = (v: number) => v * scale
  const moving = g?.kind === 'move' && g.moved ? g : null
  const showHandles = !markMode && !ed.playing && single && (single.transformable ? !!single.pivot : single.movable && !isLocked(single.id)) && !ed.maskDraw

  // the motion path of keyframed position (pivot now + offset between then and now)
  const pathEl = !markMode && !ed.playing && single && (isKeyed(single.id, 'x') || isKeyed(single.id, 'y')) && single.pivot ? single : null
  const path = (() => {
    if (!pathEl || !overrides) return null
    const o = overrides.elements[pathEl.id]
    const times = [...new Set([...sortedKeys(o?.keys?.x), ...sortedKeys(o?.keys?.y)].map((k) => +k.t.toFixed(4)))].sort((a, b) => a - b)
    if (times.length < 1) return null
    const now = { x: valueAt(o, 'x', ed.time), y: valueAt(o, 'y', ed.time) }
    const at = (t: number) => ({ x: pathEl.pivot!.x + valueAt(o, 'x', t) - now.x, y: pathEl.pivot!.y + valueAt(o, 'y', t) - now.y })
    const pts: Pt[] = []
    const a = times[0]
    const b = times[times.length - 1]
    const steps = Math.max(2, Math.min(240, Math.round((b - a) * 60)))
    for (let i = 0; i <= steps; i++) pts.push(at(a + ((b - a) * i) / steps))
    // a curved path: each key's handles (out toward the next key, in from the previous)
    const xk = sortedKeys(o?.keys?.x)
    const handles = isSpatial(o) ? xk.map((k) => ({ t: k.t, c: k.c ?? { ox: 0, oy: 0, ix: 0, iy: 0 }, ...at(k.t) })) : []
    return { pts, keys: times.map((t) => ({ t, ...at(t), x0: valueAt(o, 'x', t), y0: valueAt(o, 'y', t) })), handles }
  })()

  return (
    <div
      ref={host}
      data-preview-host
      style={{ position: 'absolute', inset: 0, cursor: hand ? 'grab' : undefined }}
      onWheel={onWheel}
      onPointerDown={(e) => {
        // the grey area around the frame: a click there clears the selection (Shift/⌘ keep it)
        if (e.target !== e.currentTarget || e.button !== 0 || hand || e.shiftKey || e.metaKey || e.ctrlKey) return
        useEditor.setState({ selectedKeys: [] })
        ed.select(null)
      }}
      data-testid="canvas-letterbox"
    >
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

      {/* view tools */}
      <div className="row canvas-tools" style={{ position: 'absolute', top: 8 + pad, right: 8, zIndex: 6, gap: 4 }}>
        <span className="badge" title="캔버스 확대 (⌘+휠, ⌘= / ⌘-, ⌘0 맞춤)" data-testid="canvas-zoom">{Math.round(scale * 100)}%</span>
        <button className="icon-btn" title="화면에 맞추기 (⌘0)" onClick={() => setZoom(null)}>
          <Maximize size={13} />
        </button>
        <button className="btn sm" style={{ height: 24 }} title="실제 크기 (⌘1)" onClick={() => setZoom(1)}>
          100%
        </button>
        <button className={`icon-btn${rulers ? ' active' : ''}`} title="눈금자·가이드 (⌘R) · 눈금자에서 끌어서 가이드를 만들어요" onClick={() => setLayout({ rulers: !rulers })} data-testid="rulers-toggle">
          <Ruler size={13} />
        </button>
        <button
          className={`icon-btn${guidesOn ? ' active' : ''}`}
          title={`가이드 ${guidesOn ? '숨기기' : '보이기'} (⌘;) · 눈금자에서 끌거나 캔버스 오른쪽 클릭으로 가이드를 만들어요`}
          onClick={() => setLayout({ showGuides: !guidesOn })}
          data-testid="guides-show"
        >
          <Hash size={13} />
        </button>
        <button className={`icon-btn${snap ? ' active' : ''}`} title="스냅: 캔버스·가이드·다른 레이어에 맞춰 붙어요 (끌면서 ⌘를 누르면 잠시 끔)" onClick={() => setLayout({ snap: !snap })}>
          <Magnet size={13} />
        </button>
        <SafeZoneMenu zone={out.safeZone} on={!!safe && safeOn} onChange={(_zone, on) => setLayout({ guides: on })} />
      </div>
      {/* the 영역 / 핀 buttons live in the chat box; while marking, the canvas says what to do */}
      {markMode && (
        <div className="canvas-mark-tools" style={{ top: 8 + pad, left: 8 + pad }} data-testid="mark-hint">
          <span className="tiny" style={{ color: 'var(--mark)', fontWeight: 650, padding: '0 6px' }}>
            {ed.tool === 'pin' ? '바꿀 곳을 클릭하세요 · 여러 개 찍어도 돼요' : '바꿀 곳을 드래그하세요'} · 요청은 채팅창에 (Esc: 끝)
          </span>
        </div>
      )}
      {ed.maskDraw && (
        <div className="lock-banner" style={{ top: 10 + pad }}>
          <b>마스크 그리기</b> · 캔버스에서 끌어서 영역을 정해요 (Esc: 취소)
        </div>
      )}

      {frame && (
        <div
          data-capture-frame
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => {
            hovering.current.over = false
            hovering.current.next = null
            setHover(null)
          }}
          onContextMenu={(e) => void canvasMenu(e)}
          style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h, cursor: hand ? 'grab' : markMode || ed.maskDraw ? 'crosshair' : 'default', zIndex: 2 }}
        >
          {/* safe zone (where Shorts / Reels buttons sit), only when the guide is on */}
          {safe && safeOn && (
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
          {/* ruler guides */}
          {guidesOn &&
            (['x', 'y'] as const).flatMap((axis) =>
              guides[axis].map((v, i) =>
                g?.kind === 'guide' && g.axis === axis && g.index === i ? null : (
                  <div
                    key={`${axis}${i}`}
                    className={`canvas-guide ${axis}${snapLines[axis].some((l) => Math.abs(l - v) < 0.5) ? ' snapped' : ''}`}
                    style={axis === 'x' ? { left: S(v) } : { top: S(v) }}
                    onPointerDown={(e) => startGuide(e, axis, i, v)}
                    title="끌어서 옮기기 · 눈금자 밖으로 끌면 지워져요"
                    data-testid="canvas-guide"
                  />
                ),
              ),
            )}
          {g?.kind === 'guide' && <div className={`canvas-guide ${g.axis} live`} style={g.axis === 'x' ? { left: S(g.value) } : { top: S(g.value) }} />}
          {g?.kind === 'guide' && (
            <div className="guide-value" style={g.axis === 'x' ? { left: S(g.value) + 4, top: 4 } : { top: S(g.value) + 4, left: 4 }} data-testid="guide-value">
              {g.value < 0 || g.value > (g.axis === 'x' ? W : H) ? '놓으면 지워져요' : `${g.axis === 'x' ? 'x' : 'y'} ${g.value}`}
            </div>
          )}
          {/* hover/selection boxes */}
          {!markMode && !ed.playing &&
            visibleEls.map((x) => {
              const picked = ed.selection.includes(x.id) || x.id === ed.selected
              const lockedX = isLocked(x.id)
              const shift = moving && moving.items.some((i) => i.id === x.id && i.keyed) ? { x: moving.dx, y: moving.dy } : { x: 0, y: 0 }
              return (
                <div
                  key={x.id}
                  title={lockedX ? `${x.label} (잠김)` : x.label}
                  style={{
                    position: 'absolute',
                    left: S(x.rect.x + shift.x),
                    top: S(x.rect.y + shift.y),
                    width: S(x.rect.w),
                    height: S(x.rect.h),
                    outline: picked ? `${lockedX ? 1 : 2}px ${x.id === ed.selected || !many ? 'solid' : 'dashed'} ${lockedX ? 'var(--text-3)' : 'var(--accent)'}` : '1px solid transparent',
                    pointerEvents: 'none',
                  }}
                  className={`el-box${!picked && (x.id === hover || x.id === ed.peek) ? ' hover' : ''}`}
                />
              )
            })}
          {/* the layer a click would pick (or a menu item points at), named */}
          {!markMode && !ed.playing && !g && (() => {
            const id = ed.peek ?? hover
            const el = id && !ed.selection.includes(id) ? visibleEls.find((x) => x.id === id) : null
            return el ? (
              <div className="hover-label" style={{ left: S(el.rect.x), top: Math.max(0, S(el.rect.y) - 18) }} data-testid="hover-label">
                {labelOf(el.id)}
              </div>
            ) : null
          })()}
          {/* snap lines */}
          {snapLines.x.map((x) => <div key={`sx${x}`} className="snap-line x" style={{ left: S(x) }} />)}
          {snapLines.y.map((y) => <div key={`sy${y}`} className="snap-line y" style={{ top: S(y) }} />)}
          {/* marquee */}
          {g?.kind === 'marquee' && (
            <div className="marquee" style={{ left: S(Math.min(g.p0.x, g.p1.x)), top: S(Math.min(g.p0.y, g.p1.y)), width: S(Math.abs(g.p1.x - g.p0.x)), height: S(Math.abs(g.p1.y - g.p0.y)) }} />
          )}
          {/* the mask being drawn, and the picked layer's mask: in the layer's own coordinates, turning with it */}
          {g?.kind === 'mask' &&
            (() => {
              const el = ed.elements.find((x) => x.id === g.id)
              const r = el?.local && maskRect(el, g.p0, g.p1)
              return r ? (
                <MaskShape m={el!.local!} k={scale} mask={{ shape: ov(g.id)?.mask?.shape ?? 'rect', radius: ov(g.id)?.mask?.radius, ...r }} live />
              ) : (
                <div className="marquee mask" style={{ left: S(Math.min(g.p0.x, g.p1.x)), top: S(Math.min(g.p0.y, g.p1.y)), width: S(Math.abs(g.p1.x - g.p0.x)), height: S(Math.abs(g.p1.y - g.p0.y)) }} />
              )
            })()}
          {g?.kind !== 'mask' && !markMode && !ed.playing && single?.local && overrides?.elements[single.id]?.mask && (
            <MaskShape m={single.local} k={scale} mask={overrides.elements[single.id].mask!} />
          )}
          {/* motion path */}
          {path && (
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} data-testid="motion-path">
              <polyline points={path.pts.map((q) => `${S(q.x)},${S(q.y)}`).join(' ')} fill="none" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 3" />
            </svg>
          )}
          {path?.keys.map((k) => {
            const drag = g?.kind === 'pathkey' && Math.abs(g.t - k.t) < 1e-3 ? g : null
            return (
              <div
                key={k.t}
                className="path-key"
                style={{ left: S(k.x + (drag?.dx ?? 0)), top: S(k.y + (drag?.dy ?? 0)) }}
                title={`${k.t.toFixed(2)}초 위치 키프레임 · 끌어서 옮기기`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  setGesture({ kind: 'pathkey', id: pathEl!.id, t: k.t, x: k.x0, y: k.y0, p0: toComp(e.clientX, e.clientY), dx: 0, dy: 0 })
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                data-testid="path-key"
              />
            )
          })}
          {/* curved path handles: drag to bend the path (the other side follows, smooth) */}
          {path?.handles.map((h) =>
            (['o', 'i'] as const).map((side) => {
              const drag = g?.kind === 'pathhandle' && Math.abs(g.t - h.t) < 1e-3 ? g : null
              const c = drag ? drag.c : h.c
              const hx = h.x + (side === 'o' ? c.ox : c.ix)
              const hy = h.y + (side === 'o' ? c.oy : c.iy)
              return (
                <Fragment key={`${h.t}-${side}`}>
                  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
                    <line x1={S(h.x)} y1={S(h.y)} x2={S(hx)} y2={S(hy)} stroke="var(--warning)" strokeWidth={1} />
                  </svg>
                  <div
                    className="path-handle"
                    style={{ left: S(hx), top: S(hy) }}
                    title="경로 곡선 손잡이 · 끌어서 휘게"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                      setGesture({ kind: 'pathhandle', id: pathEl!.id, t: h.t, side, c: { ...h.c }, c0: { ...h.c }, key: { x: h.x, y: h.y } })
                    }}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    data-testid={`path-handle-${side}`}
                  />
                </Fragment>
              )
            }),
          )}
          {/* handles: scale (8), rotate, anchor point */}
          {showHandles && single && (
            <SelectionHandles
              el={single}
              S={S}
              gesture={g}
              onHandle={(e, h) => startHandle(e, single, h)}
              onMove={onMove}
              onUp={onUp}
            />
          )}
          {sel && !markMode && !ed.playing && (
            <div className="badge accent" style={{ position: 'absolute', left: S(sel.rect.x), top: Math.max(0, S(sel.rect.y) - 24), pointerEvents: 'none', zIndex: 3 }}>
              {many ? `${labelOf(sel.id)} 외 ${ed.selection.length - 1}개 · 기준` : labelOf(sel.id)}
              {g?.kind === 'scale' && ` · ${Math.round(g.nsx * 100)}% × ${Math.round(g.nsy * 100)}%`}
              {g?.kind === 'rotate' && ` · ${g.nr}°`}
              {moving && ` · ${moving.dx >= 0 ? '+' : ''}${moving.dx}, ${moving.dy >= 0 ? '+' : ''}${moving.dy}`}
            </div>
          )}
          {/* markup */}
          {visibleMarks.map((m) =>
            m.kind === 'pin' ? (
              <div key={m.id} className="mark-pin" style={{ left: S(m.rect!.x), top: S(m.rect!.y) }}>
                {m.n}
              </div>
            ) : (
              <div key={m.id} className="mark-box" style={{ left: S(m.rect!.x), top: S(m.rect!.y), width: S(m.rect!.w), height: S(m.rect!.h) }}>
                <span>{m.n}</span>
              </div>
            ),
          )}
          {draft && (
            <div
              className="mark-box"
              style={{
                left: S(Math.min(draft.x0, draft.x1)),
                top: S(Math.min(draft.y0, draft.y1)),
                width: S(Math.abs(draft.x1 - draft.x0)),
                height: S(Math.abs(draft.y1 - draft.y0)),
              }}
            />
          )}
        </div>
      )}

      {menu && <Menu items={menu.items} onClose={() => setMenu(null)} style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 30), maxHeight: '70vh', overflow: 'auto', zIndex: 60 }} />}
      {/* rulers: drag out of them to make a guide */}
      {rulers && frame && (
        <>
          <RulerStrip axis="x" length={hostSize.w} offset={frame.x} scale={scale} onDown={(e) => startGuide(e, 'y', -1, Math.round(toComp(e.clientX, e.clientY).y))} onMove={onMove} onUp={onUp} />
          <RulerStrip axis="y" length={hostSize.h} offset={frame.y} scale={scale} onDown={(e) => startGuide(e, 'x', -1, Math.round(toComp(e.clientX, e.clientY).x))} onMove={onMove} onUp={onUp} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: RULER, height: RULER, background: 'var(--surface-2)', zIndex: 5 }} />
        </>
      )}
    </div>
  )
}

/** canvas zoom for the shortcuts (set by the mounted canvas) */
export const canvasView = {
  zoomBy: (_f: number) => {},
  fit: () => {},
  actual: () => {},
}

/** captures the video frame with the marks drawn on it (PNG data URL) */
export async function captureAnnotatedFrame(): Promise<string | undefined> {
  const el = document.querySelector('[data-capture-frame]') as HTMLElement | null
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  return studio.app.capture({ x: r.left, y: r.top, width: r.width, height: r.height })
}

/** a ruler along the top (axis x) or the left (axis y) of the canvas, composition px */
function RulerStrip({ axis, length, offset, scale, onDown, onMove, onUp }: { axis: 'x' | 'y'; length: number; offset: number; scale: number; onDown: (e: React.PointerEvent) => void; onMove: (e: React.PointerEvent) => void; onUp: (e: React.PointerEvent) => void }) {
  const step = [10, 20, 50, 100, 200, 500, 1000].find((s) => s * scale >= 50) ?? 2000
  const ticks: number[] = []
  const first = Math.floor(-offset / scale / step) * step
  for (let v = first; v * scale + offset < length; v += step) ticks.push(v)
  const style: React.CSSProperties = axis === 'x' ? { left: RULER, top: 0, right: 0, height: RULER } : { left: 0, top: RULER, bottom: 0, width: RULER }
  return (
    <div className={`canvas-ruler ${axis}`} style={style} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} title="끌어서 가이드 만들기" data-testid={`ruler-${axis}`}>
      {ticks.map((v) => (
        <span key={v} style={axis === 'x' ? { left: v * scale + offset - RULER } : { top: v * scale + offset - RULER }}>
          {v}
        </span>
      ))}
    </div>
  )
}

/** eight scale handles, a rotation knob above, the anchor point at the pivot */
function SelectionHandles({ el, S, gesture, onHandle, onMove, onUp }: { el: RuntimeElement; S: (v: number) => number; gesture: Gesture | null; onHandle: (e: React.PointerEvent, h: string) => void; onMove: (e: React.PointerEvent) => void; onUp: (e: React.PointerEvent) => void }) {
  const r = el.rect
  const pts: [string, number, number][] = [
    ['nw', r.x, r.y],
    ['n', r.x + r.w / 2, r.y],
    ['ne', r.x + r.w, r.y],
    ['e', r.x + r.w, r.y + r.h / 2],
    ['se', r.x + r.w, r.y + r.h],
    ['s', r.x + r.w / 2, r.y + r.h],
    ['sw', r.x, r.y + r.h],
    ['w', r.x, r.y + r.h / 2],
  ]
  const cursor: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
  const center = el.pivot ?? { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  const piv = gesture?.kind === 'anchor' && gesture.id === el.id ? { x: center.x + gesture.d.x, y: center.y + gesture.d.y } : center
  const common = { onPointerMove: onMove, onPointerUp: onUp }
  return (
    <>
      {pts.map(([h, x, y]) => (
        <div key={h} className="sel-handle" style={{ left: S(x), top: S(y), cursor: cursor[h] }} onPointerDown={(e) => onHandle(e, h)} {...common} data-testid={`handle-${h}`} title="끌어서 크기 (모서리: 비율 유지, Shift: 자유롭게)" />
      ))}
      <div className="rot-stem" style={{ left: S(r.x + r.w / 2), top: S(r.y) - 22, height: 22 }} />
      <div className="rot-handle" style={{ left: S(r.x + r.w / 2), top: S(r.y) - 26 }} onPointerDown={(e) => onHandle(e, 'rot')} {...common} title="끌어서 회전 (Shift: 15° 단위)" data-testid="handle-rot" />
      {el.type !== 'part' && el.type !== 'camera' && (
        <div className="anchor-handle" style={{ left: S(piv.x), top: S(piv.y) }} onPointerDown={(e) => onHandle(e, 'anchor')} {...common} title="기준점 (크기·회전의 중심) · ⌥를 누른 채 끌면 옮겨요 · 그냥 끌면 레이어가 움직여요" data-testid="handle-anchor" />
      )}
      {el.type === 'part' && <div className="anchor-handle part" style={{ left: S(piv.x), top: S(piv.y), pointerEvents: 'none' }} title="관절 (이 점을 중심으로 돌아요)" />}
    </>
  )
}

/**
 * A mask dragged on the canvas (two corners in composition px) as a rectangle in the layer's own
 * coordinates — the layer's turn and scale undone, like After Effects' mask tools on a turned layer.
 */
function maskRect(el: RuntimeElement, p0: Pt, p1: Pt): { x: number; y: number; w: number; h: number } | null {
  if (el.local) {
    const a = invertAffine(el.local, p0.x, p0.y)
    const b = invertAffine(el.local, p1.x, p1.y)
    if (!a || !b) return null
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  }
  // an older preview without the map: unturned layers only
  if (!el.base) return null
  return { x: Math.min(p0.x, p1.x) - el.base.x - valueNow(el.id, 'x'), y: Math.min(p0.y, p1.y) - el.base.y - valueNow(el.id, 'y'), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) }
}

/** a mask's outline on the canvas: drawn in the layer's own coordinates through its map (k = canvas zoom) */
function MaskShape({ m, k, mask, live }: { m: Affine; k: number; mask: Pick<LayerMask, 'shape' | 'x' | 'y' | 'w' | 'h' | 'radius'>; live?: boolean }) {
  const paint = { fill: live ? 'rgba(255,212,0,0.12)' : 'none', stroke: '#ffd400', strokeWidth: 1.5, strokeDasharray: live ? undefined : '5 3', vectorEffect: 'non-scaling-stroke' as const }
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} data-testid={live ? 'mask-live' : 'mask-outline'}>
      <g transform={`matrix(${m.map((v) => v * k).join(' ')})`}>
        {mask.shape === 'ellipse' ? (
          <ellipse cx={mask.x + mask.w / 2} cy={mask.y + mask.h / 2} rx={mask.w / 2} ry={mask.h / 2} {...paint} />
        ) : (
          <rect x={mask.x} y={mask.y} width={mask.w} height={mask.h} rx={mask.radius ?? 0} {...paint} />
        )}
      </g>
    </svg>
  )
}
