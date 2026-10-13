// The preview is a plain iframe served by the local preview server with the
// HyperFrames runtime injected; transport and element queries go through the
// ms-runtime postMessage bridge, so it works across origins (dev and packaged).

export interface RuntimeElement {
  id: string
  label: string
  type: string
  movable: boolean
  visible: boolean
  rect: { x: number; y: number; w: number; h: number }
  text?: string
  style: { fontFamily: string; fontSize: number; fontWeight: number; letterSpacing: number; lineHeight: number; color: string; textAlign: string }
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
    f.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;border:0;transform-origin:0 0;background:transparent;pointer-events:none;`
    f.src = src
    this.iframe = f
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || !e.data || typeof e.data !== 'object') return
      const d = e.data as { ms?: string; time?: number; duration?: number; playing?: boolean; message?: string }
      if (d.ms === 'ready') {
        this.duration = d.duration ?? 0
        this.on.ready(this.duration)
      } else if (d.ms === 'state') {
        this.currentTime = d.time ?? 0
        this.duration = d.duration ?? this.duration
        this.playing = !!d.playing
        this.on.state({ time: this.currentTime, duration: this.duration, playing: this.playing })
      } else if (d.ms === 'error') this.on.error(d.message ?? '미리보기를 시작하지 못했어요.')
    }
    window.addEventListener('message', onMsg)
    this.listeners.push(onMsg)
  }

  private post(msg: Record<string, unknown>) {
    this.iframe.contentWindow?.postMessage(msg, '*')
  }
  play() {
    this.post({ ms: 'play' })
  }
  pause() {
    this.post({ ms: 'pause' })
  }
  seek(t: number) {
    this.currentTime = t
    this.post({ ms: 'seek', t })
  }
  dispose() {
    for (const l of this.listeners) window.removeEventListener('message', l)
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

export async function queryElements(p: MsPlayer | null): Promise<RuntimeElement[]> {
  const r = await ask<{ items: RuntimeElement[] }>(p, { ms: 'elements' })
  return r?.items ?? []
}
