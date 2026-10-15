// Audio waveforms on the timeline (After Effects shows them on audio layers): a file is
// decoded once (Web Audio, at a low sample rate) and kept as loudness peaks, RATE per second.
import { useEffect, useRef, useState } from 'react'

const RATE = 200
const FLOOR_DB = 42
const cache = new Map<string, Promise<Float32Array | null>>()

function peaks(url: string): Promise<Float32Array | null> {
  let p = cache.get(url)
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        // decoding resamples to the context's rate: 8 kHz is plenty for a picture of loudness
        const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await res.arrayBuffer())
        const per = Math.max(1, Math.round(audio.sampleRate / RATE))
        const out = new Float32Array(Math.ceil(audio.length / per))
        for (let ch = 0; ch < audio.numberOfChannels; ch++) {
          const d = audio.getChannelData(ch)
          for (let i = 0; i < out.length; i++) {
            let m = out[i]
            const end = Math.min(d.length, (i + 1) * per)
            for (let j = i * per; j < end; j++) {
              const v = d[j] < 0 ? -d[j] : d[j]
              if (v > m) m = v
            }
            out[i] = m
          }
        }
        return out
      } catch {
        return null
      }
    })()
    cache.set(url, p)
    // a handful of projects' worth of sounds
    if (cache.size > 60) cache.delete(cache.keys().next().value!)
  }
  return p
}

/**
 * The waveform of `src` (composition-relative) from `from` seconds into the file, `length` seconds
 * long, filling its positioned parent. Nothing is drawn until the file is decoded.
 */
export function Waveform({ base, src, from, length, color }: { base: string; src: string; from: number; length: number; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<Float32Array | null>(null)
  const url = base && src && !/^[a-z]+:/i.test(src) ? base + src.replace(/^\.\//, '') : ''
  useEffect(() => {
    if (!url) return
    let live = true
    void peaks(url).then((p) => live && setData(p))
    return () => {
      live = false
    }
  }, [url])
  useEffect(() => {
    const c = canvas.current
    if (!c || !data) return
    const draw = () => {
      const w = Math.max(1, Math.min(8000, Math.round(c.clientWidth)))
      const h = Math.max(1, Math.round(c.clientHeight))
      const dpr = window.devicePixelRatio || 1
      c.width = w * dpr
      c.height = h * dpr
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = color
      let loudest = 0
      for (let x = 0; x < w; x++) {
        const a = Math.floor((from + (x / w) * length) * RATE)
        const b = Math.max(a + 1, Math.floor((from + ((x + 1) / w) * length) * RATE))
        let v = 0
        for (let i = Math.max(0, a); i < b && i < data.length; i++) if (data[i] > v) v = data[i]
        if (v > loudest) loudest = v
        // in decibels (−42 dB … 0 dB): quiet music still shows its shape in a short bar
        const level = v > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(v) + FLOOR_DB) / FLOOR_DB)) : 0
        const bar = level > 0 ? Math.max(1, level * h) : 0
        g.fillRect(x, (h - bar) / 2, 1, bar)
      }
      c.dataset.loudest = loudest.toFixed(3)
    }
    draw()
    // the bar changes width with the timeline zoom and the panel size
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [data, from, length, color])
  if (!url) return null
  return <canvas ref={canvas} className="tl-wave" data-testid="waveform" data-src={src} />
}
