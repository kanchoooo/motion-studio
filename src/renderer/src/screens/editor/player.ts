// The preview is a plain iframe served by the local preview server with the
// HyperFrames runtime injected; transport and element queries go through the
// ms-runtime postMessage bridge, so it works across origins (dev and packaged).
import { CAMERA_ID, type Keyframe } from '@shared/overrides'
import { useStore } from '../../store'

export interface RuntimeElement {
  id: string
  label: string
  type: string
  /** html tag (img, video, div…) */
  tag: string
  /** a layer the designer added ('text', 'shape'…) or a copy of Claude's ('copy'); null for Claude's own */
  designer: string | null
  /** for a copy: the layer it copies */
  copyOf: string | null
  /** enclosing editable element (group), null at the top level */
  parent: string | null
  depth: number
  /** siblings that stack together share this key; rank 0 is the top of that stack */
  stack: string
  rank: number
  movable: boolean
  /** false for nested elements in normal flow: they move, but do not scale/rotate */
  transformable: boolean
  visible: boolean
  /** on-screen box now (composition px) */
  rect: { x: number; y: number; w: number; h: number }
  /** box at rest without the designer's transform (composition px) */
  base: { x: number; y: number; w: number; h: number } | null
  /** where it scales and rotates around (composition px) */
  pivot: { x: number; y: number } | null
  /** its own coordinates (where its mask is drawn) → composition px, now: CSS matrix [a, b, c, d, e, f] */
  local?: Affine | null
  /** composition px per px of the layer's own units (a character part's drawing units; 1 elsewhere) */
  unit?: number
  /** a character's acting parameters (SvgRig): CSS variables --<name> on the layer */
  rig?: { name: string; def: number }[] | null
  /** picture / clip it shows */
  src?: string
  text?: string
  /** a styled line's parts in order (when it has a few) */
  runs?: string[]
  /** a layer the app named itself (text or a picture Claude left without an id) */
  auto?: boolean
  style: { fontFamily: string; fontSize: number; fontWeight: number; letterSpacing: number; lineHeight: number; color: string; textAlign: string; background: string; radius: number }
}

export interface PlayerState {
  time: number
  duration: number
  playing: boolean
}

export class MsPlayer {
  readonly iframe: HTMLIFrameElement
  private listeners: ((e: MessageEvent) => void)[] = []
  currentTime = 0
  duration = 0
  playing = false
  /**
   * Each play / pause / seek is numbered and the preview says which one it had done when it posted
   * a state. The preview plays at real speed in its own process: on a slow computer its time updates
   * pile up while the editor draws, and the old ones (posted before a pause or a seek) would move the
   * playhead on after the pause — they are dropped, and of the rest only the latest is shown, once
   * per frame.
   */
  private cmd = 0
  private pending: PlayerState | null = null
  private frame = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    src: string,
    width: number,
    height: number,
    private on: { ready(duration: number): void; state(s: PlayerState): void; error(msg: string): void },
  ) {
    const f = document.createElement('iframe')
    f.width = String(width)
    f.height = String(height)
    f.setAttribute('scrolling', 'no')
    // 관제용 판, in a browser: the preview is another origin, its sound needs the page's leave to play
    if (__MS_CONSOLE__ && window.studio.internal?.web) f.allow = 'autoplay'
    f.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;border:0;transform-origin:0 0;background:transparent;pointer-events:none;`
    f.src = src
    this.iframe = f
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || !e.data || typeof e.data !== 'object') return
      const d = e.data as { ms?: string; time?: number; duration?: number; playing?: boolean; message?: string; seq?: number }
      if (d.ms === 'ready') {
        this.duration = d.duration ?? 0
        this.on.ready(this.duration)
      } else if (d.ms === 'state') {
        // posted before the preview got our last command: stale (a runtime without numbers: every state counts)
        if (typeof d.seq === 'number' && d.seq < this.cmd) return
        this.currentTime = d.time ?? 0
        this.duration = d.duration ?? this.duration
        this.playing = !!d.playing
        this.deliver({ time: this.currentTime, duration: this.duration, playing: this.playing })
      } else if (d.ms === 'error') this.on.error(d.message ?? '미리보기를 시작하지 못했어요.')
    }
    window.addEventListener('message', onMsg)
    this.listeners.push(onMsg)
  }

  /** the latest state, once per frame (a hidden window has no frames: then within 100 ms) */
  private deliver(st: PlayerState) {
    this.pending = st
    if (this.frame || this.timer) return
    const go = () => {
      if (this.frame) cancelAnimationFrame(this.frame)
      if (this.timer) clearTimeout(this.timer)
      this.frame = 0
      this.timer = null
      const p = this.pending
      this.pending = null
      if (p) this.on.state(p)
    }
    this.frame = requestAnimationFrame(go)
    this.timer = setTimeout(go, 100)
  }

  private post(msg: Record<string, unknown>) {
    this.iframe.contentWindow?.postMessage(msg, '*')
  }
  play() {
    this.post({ ms: 'play', seq: ++this.cmd })
  }
  pause() {
    this.post({ ms: 'pause', seq: ++this.cmd })
    // the button and the editor stop at once; the preview's own state brings the exact time
    if (this.playing) {
      this.playing = false
      this.pending = null
      this.on.state({ time: this.currentTime, duration: this.duration, playing: false })
    }
  }
  seek(t: number) {
    this.currentTime = t
    this.post({ ms: 'seek', t, seq: ++this.cmd })
  }
  dispose() {
    for (const l of this.listeners) window.removeEventListener('message', l)
    if (this.frame) cancelAnimationFrame(this.frame)
    if (this.timer) clearTimeout(this.timer)
    this.iframe.remove()
  }
}

let seq = 0
export function ask<T>(p: MsPlayer | null, msg: Record<string, unknown>, timeout = 1500): Promise<T | null> {
  const frame = p?.iframe
  if (!frame?.contentWindow) return Promise.resolve(null)
  const reqId = ++seq
  return new Promise((resolve) => {
    const done = (v: T | null) => {
      window.removeEventListener('message', onMsg)
      clearTimeout(timer)
      resolve(v)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && e.data?.reqId === reqId) done(e.data as T)
    }
    const timer = setTimeout(() => done(null), timeout)
    window.addEventListener('message', onMsg)
    frame.contentWindow!.postMessage({ ...msg, reqId }, '*')
  })
}

export interface ElementTiming {
  id: string
  label: string
  type: string
  start: number
  end: number | null
}

export async function queryTiming(p: MsPlayer | null): Promise<ElementTiming[]> {
  const r = await ask<{ items: ElementTiming[] }>(p, { ms: 'timing' })
  return r?.items ?? []
}

/** one authored motion (GSAP tween) as reported by the runtime */
export interface RuntimeMotion {
  key: string
  /** where the designer's edit of it is stored (its key when it was edited; Claude may have moved it since) */
  editKey: string
  owners: string[]
  /** the layer it moves itself (every target is that element), else null */
  self: string | null
  type: 'to' | 'from' | 'fromTo' | 'set' | 'keyframes' | 'css'
  sig: string
  /** owned = the designer took this property over (it plays from their keyframes); color = a colour value */
  props: { name: string; from?: number | string; to?: number | string; editable: boolean; owned?: boolean; color?: boolean }[]
  /** authored easing ('' = GSAP default) and per-item length */
  ease: string
  duration: number
  stagger: boolean
  staggerEach: number | null
  staggerFrom: string
  /** how many things it moves one after another */
  staggerCount: number
  repeat: number
  yoyo: boolean
  shift: number
  edited: boolean
  disabled: boolean
  /** authored-timeline start without the designer's shifts (the motion's own and its layer's) */
  authoredStart: number
  /** the whole layer moved by the designer (timeline bar), seconds of the authored timeline */
  layerShift?: number
  /** one target's part of a staggered motion (GSAP's own): its times, but no block of its own */
  nested?: boolean
  /** output-time position (after section speed) */
  start: number
  end: number
}

export async function queryMotions(p: MsPlayer | null): Promise<{ items: RuntimeMotion[]; stale: string[] }> {
  const r = await ask<{ items: RuntimeMotion[]; stale: string[] }>(p, { ms: 'motions' })
  return { items: r?.items ?? [], stale: r?.stale ?? [] }
}

/** the editable elements now; null when the preview did not answer (keep what you have) */
export async function queryElements(p: MsPlayer | null): Promise<RuntimeElement[] | null> {
  const r = await ask<{ items: RuntimeElement[] }>(p, { ms: 'elements' }, 3000)
  return r ? [...r.items, cameraElement()] : null
}

/** the camera: a layer of the editor's own (its transform moves the whole picture) */
export function cameraElement(): RuntimeElement {
  const out = useStore.getState().project?.brief.output
  const W = out?.width ?? 1920
  const H = out?.height ?? 1080
  return {
    id: CAMERA_ID, label: '카메라', type: 'camera', tag: 'camera', designer: null, copyOf: null, parent: null, depth: 0,
    stack: '__camera', rank: 0, movable: true, transformable: true, visible: true,
    rect: { x: 0, y: 0, w: W, h: H }, base: { x: 0, y: 0, w: W, h: H }, pivot: { x: W / 2, y: H / 2 }, local: null,
    style: { fontFamily: '', fontSize: 0, fontWeight: 400, letterSpacing: 0, lineHeight: 1.2, color: '', textAlign: '', background: '', radius: 0 },
  }
}

/** Claude's motion of a layer as keyframes per GSAP property, read from the timeline (for taking it over) */
export async function claudeTracks(p: MsPlayer | null, id: string, props?: string[]): Promise<Record<string, Keyframe[]>> {
  const r = await ask<{ tracks: Record<string, Keyframe[]> }>(p, { ms: 'claude-tracks', id, props }, 4000)
  return r?.tracks ?? {}
}

/** GSAP properties of a layer at this moment (the inspector's numbers for Claude's motion) */
export async function propsNow(p: MsPlayer | null, id: string, props: string[]): Promise<Record<string, number | string>> {
  if (!props.length) return {}
  const r = await ask<{ values: Record<string, number | string> }>(p, { ms: 'props-now', id, props }, 800)
  return r?.values ?? {}
}

/** the editor's solo switch: only these layers show in the preview (nothing is saved) */
export function soloLayers(p: MsPlayer | null, ids: string[]) {
  return ask(p, { ms: 'solo', ids })
}

/** editable layers painted at a composition point, top first */
/** the layers at a point as the designer sees them now, top first; null when the preview did not answer */
export async function hitTest(p: MsPlayer | null, x: number, y: number): Promise<string[] | null> {
  const r = await ask<{ ids: string[] }>(p, { ms: 'hit', x, y }, 400)
  return r ? r.ids : null
}

/** a 2D affine map in CSS matrix order: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Affine = [number, number, number, number, number, number]
export const applyAffine = (m: Affine, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
export function invertAffine(m: Affine, x: number, y: number): { x: number; y: number } | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-9) return null
  const dx = x - m[4]
  const dy = y - m[5]
  return { x: (m[3] * dx - m[2] * dy) / det, y: (-m[1] * dx + m[0] * dy) / det }
}
