import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { RenderRecord } from '@shared/project'
import { formatTime, Modal, relativeTime } from '../../components/ui'

/** two exported results side by side, playing and seeking in sync */
export function CompareModal({ a, b, base, onClose, onRestore }: { a: RenderRecord; b: RenderRecord; base: string; onClose: () => void; onRestore: (r: RenderRecord) => void }) {
  const va = useRef<HTMLVideoElement>(null)
  const vb = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const dur = Math.max(a.duration, b.duration)

  useEffect(() => {
    const v = va.current
    if (!v) return
    const tick = () => {
      setT(v.currentTime)
      // keep the second player within a frame of the first
      if (vb.current && Math.abs(vb.current.currentTime - v.currentTime) > 0.05 && v.currentTime <= b.duration) vb.current.currentTime = v.currentTime
    }
    v.addEventListener('timeupdate', tick)
    return () => v.removeEventListener('timeupdate', tick)
  }, [b.duration])

  const both = (fn: (v: HTMLVideoElement) => void) => [va.current, vb.current].forEach((v) => v && fn(v))
  const toggle = () => {
    if (playing) both((v) => v.pause())
    else both((v) => void v.play())
    setPlaying(!playing)
  }
  const seek = (x: number) => {
    both((v) => (v.currentTime = Math.min(x, v.duration || x)))
    setT(x)
  }

  const Side = ({ r, refEl }: { r: RenderRecord; refEl: React.RefObject<HTMLVideoElement | null> }) => (
    <div className="col" style={{ gap: 6, minWidth: 0 }}>
      <video ref={refEl} src={base + r.file} muted={refEl === vb} style={{ display: 'block', width: '100%', aspectRatio: `${r.width} / ${r.height}`, maxHeight: 'min(420px, calc(100vh - 340px))', objectFit: 'contain', background: '#000', borderRadius: 8 }} onEnded={() => setPlaying(false)} />
      <div className="row">
        <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
          <span className="small ellipsis" style={{ fontWeight: 600 }}>{r.versionName ?? r.fileName}</span>
          <span className="tiny faint">
            {relativeTime(r.createdAt)} · {r.width}×{r.height} · {r.duration.toFixed(1)}초
          </span>
        </div>
        <button className="btn sm" onClick={() => onRestore(r)}>
          <RotateCcw size={12} />이 상태로
        </button>
      </div>
    </div>
  )

  return (
    <Modal title="결과물 나란히 비교" onClose={onClose} width={1200}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Side r={a} refEl={va} />
        <Side r={b} refEl={vb} />
      </div>
      <div className="row">
        <button className="icon-btn" style={{ width: 36, height: 36, background: 'var(--surface-3)', color: 'var(--text)' }} onClick={toggle}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <input type="range" min={0} max={dur} step={0.01} value={t} onChange={(e) => seek(Number(e.target.value))} style={{ flex: 1 }} />
        <span className="mono small">{formatTime(t)}</span>
      </div>
      <div className="tiny faint">소리는 왼쪽 결과물만 나와요.</div>
    </Modal>
  )
}
