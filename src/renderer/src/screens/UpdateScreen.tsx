// First screen at every launch: checks GitHub for a newer version and, if there
// is one, downloads and installs it before the designer can start working
// (no half-updated app in the middle of a job). Offline or a failed check
// never blocks the app.
import { useEffect, useState } from 'react'
import { Clapperboard, Download, Loader2, RotateCcw, WifiOff } from 'lucide-react'
import type { UpdateCheck } from '@shared/api'
import { studio, useStore } from '../store'

type Phase = { kind: 'checking' } | { kind: 'downloading'; check: UpdateCheck; percent: number } | { kind: 'installing'; check: UpdateCheck } | { kind: 'error'; check?: UpdateCheck; message: string; during: 'check' | 'download' }

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

export function UpdateScreen() {
  const { go } = useStore()
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [current, setCurrent] = useState('')
  const [wait, setWait] = useState(8)

  const run = async () => {
    setPhase({ kind: 'checking' })
    const check = await studio.app.checkUpdate().catch((e) => ({ status: 'error', current: '', message: errText(e) }) as UpdateCheck)
    setCurrent(check.current)
    if (check.status === 'skipped' || check.status === 'none') return go('lock')
    if (check.status === 'error') return setPhase({ kind: 'error', check, message: check.message ?? '업데이트를 확인하지 못했어요.', during: 'check' })
    setPhase({ kind: 'downloading', check, percent: 0 })
    const off = studio.app.onUpdateProgress((percent) => setPhase((p) => (p.kind === 'downloading' ? { ...p, percent } : p)))
    try {
      await studio.app.downloadUpdate()
      setPhase({ kind: 'installing', check })
      await new Promise((r) => setTimeout(r, 900))
      await studio.app.installUpdate()
    } catch (e) {
      setPhase({ kind: 'error', check, message: errText(e), during: 'download' })
    } finally {
      off()
    }
  }
  useEffect(() => {
    void run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a failed check does not hold the designer up for long
  useEffect(() => {
    if (phase.kind !== 'error') return
    setWait(8)
    const t = setInterval(() => setWait((w) => w - 1), 1000)
    return () => clearInterval(t)
  }, [phase.kind])
  useEffect(() => {
    if (phase.kind === 'error' && wait <= 0) go('lock')
  }, [wait, phase.kind, go])

  return (
    <div className="drag" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="update-screen">
      <div className="card no-drag col" style={{ width: 400, padding: 28, gap: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <Clapperboard size={20} color="var(--accent)" />
          <span className="h2 grow">모션스튜디오</span>
          {current && <span className="tiny faint">현재 버전 {current}</span>}
        </div>
        {phase.kind === 'checking' && (
          <div className="row small muted">
            <Loader2 size={15} className="spin" />
            새 버전이 있는지 확인하고 있어요
          </div>
        )}
        {phase.kind === 'downloading' && (
          <>
            <div className="row small">
              <Download size={15} color="var(--accent)" />
              <span className="grow">
                새 버전 <b>{phase.check.latest}</b>을 받고 있어요
              </span>
              <span className="mono small">{Math.round(phase.percent)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(3, phase.percent)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
            </div>
            <div className="tiny muted">업데이트가 끝나면 앱이 다시 열려요. 작업 중이던 프로젝트는 그대로 있어요.</div>
          </>
        )}
        {phase.kind === 'installing' && (
          <div className="row small">
            <Loader2 size={15} className="spin" />
            새 버전 {phase.check.latest}을 설치하고 다시 시작할게요
          </div>
        )}
        {phase.kind === 'error' && (
          <>
            <div className="row small" style={{ color: 'var(--warning)' }}>
              <WifiOff size={15} />
              <span className="grow">{phase.during === 'check' ? '업데이트를 확인하지 못했어요' : '새 버전을 받지 못했어요'}</span>
            </div>
            <div className="tiny muted">{phase.message} 지금 버전으로 시작하고, 다음에 앱을 열 때 다시 확인해요.</div>
            <div className="row">
              <button className="btn sm" onClick={() => void run()}>
                <RotateCcw size={12} />
                다시 시도
              </button>
              <div className="grow" />
              <button className="btn sm primary" onClick={() => go('lock')}>
                지금 버전으로 시작 ({Math.max(0, wait)})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
