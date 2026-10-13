import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { DoctorItem } from '@shared/api'
import { XTerm } from '../components/XTerm'
import { Modal } from '../components/ui'
import { studio, useStore } from '../store'

const ICON = {
  ok: <CheckCircle2 size={18} color="var(--success)" />,
  warn: <AlertTriangle size={18} color="var(--warning)" />,
  error: <XCircle size={18} color="var(--danger)" />,
  checking: <Loader2 size={18} className="spin" />,
}

export function Doctor({ embedded }: { embedded?: boolean }) {
  const { doctor, go } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [trusting, setTrusting] = useState(false)

  // the trust helper session closes itself once the folder is trusted
  useEffect(() => {
    if (!trusting) return
    return studio.agent.onEvent((e) => {
      if (e.type === 'session' && e.projectId === '__workspace__' && (e.state.status === 'ready' || e.state.status === 'exited')) {
        setTimeout(() => {
          setTrusting(false)
          void run()
        }, 900)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trusting])

  const run = async () => {
    useStore.setState({ doctor: null })
    const report = await studio.app.doctor()
    useStore.setState({ doctor: report })
    // move on by itself only when everything is fine, so recommendations aren't skipped silently
    if (report.ready && report.items.every((i) => i.status === 'ok') && !embedded && !sessionStorage.getItem('ms-doctor-seen')) {
      sessionStorage.setItem('ms-doctor-seen', '1')
      go('home')
    }
  }
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const act = async (item: DoctorItem) => {
    if (!item.action) return
    setBusy(item.id)
    setMsg(null)
    try {
      if (item.action.id === 'trust-workspace') {
        await studio.app.trustWorkspace()
        setTrusting(true)
        return
      }
      if (item.action.id === 'login') {
        await studio.app.login()
        useStore.setState({ loginOpen: true })
        return
      }
      else if (item.action.id === 'install-browser') setMsg((await studio.app.installBrowser()).message)
      else if (item.action.id === 'rescan-fonts') await studio.fonts.list()
    } finally {
      setBusy(null)
      void run()
    }
  }

  const items: DoctorItem[] =
    doctor?.items ??
    (['claude', 'browser', 'ffmpeg', 'fonts'] as const).map((id) => ({
      id,
      label: { claude: 'Claude 계정', browser: '영상 렌더 엔진', ffmpeg: '영상 변환 도구', fonts: '시스템 폰트' }[id],
      status: 'checking' as const,
      detail: '확인하고 있어요…',
    }))

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', padding: embedded ? 0 : '72px 24px' }}>
      <div style={{ width: 'min(560px, 100%)' }} className="col">
        {!embedded && (
          <div className="col" style={{ gap: 4, marginBottom: 12 }}>
            <div className="h1">작업 환경을 확인할게요</div>
            <div className="muted">모션스튜디오가 영상을 만들 때 필요한 것들이에요. 한 번만 준비하면 돼요.</div>
          </div>
        )}
        <div className="card" style={{ padding: 6 }}>
          {items.map((it, i) => (
            <div key={it.id} className="row" style={{ padding: '12px 12px', borderTop: i ? '1px solid var(--border)' : 'none', gap: 12 }}>
              {ICON[it.status]}
              <div className="grow col" style={{ gap: 2 }}>
                <div style={{ fontWeight: 600 }}>{it.label}</div>
                <div className="small muted">{it.detail}</div>
              </div>
              {it.action && it.status !== 'checking' && (it.status !== 'ok' || it.action.id === 'rescan-fonts') && (
                <button className={`btn sm${it.status === 'error' ? ' primary' : ''}`} disabled={!!busy} onClick={() => act(it)}>
                  {busy === it.id ? <Loader2 size={14} className="spin" /> : null}
                  {it.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
        {msg && <div className="small muted">{msg}</div>}
        {trusting && (
          <Modal title="작업 폴더 허용" onClose={() => setTrusting(false)} width={760}>
            <div className="small" style={{ lineHeight: 1.7 }}>
              아래 화면에서 키보드 <b>↓</b> 키로 <b>"Yes, I trust this folder"</b>를 고른 뒤 <b>Enter</b>를 눌러 주세요.
              <br />
              <span className="muted">한 번만 하면 모션스튜디오의 모든 프로젝트·베리에이션에서 다시 묻지 않아요. 허용되면 이 창은 자동으로 닫혀요.</span>
            </div>
            <div style={{ height: 300, display: 'flex', background: '#0f0f11', borderRadius: 8, padding: '8px 0 0 10px' }}>
              <XTerm sessionId="__workspace__" />
            </div>
          </Modal>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={run}>
            <RefreshCw size={14} />
            다시 확인
          </button>
          <div className="grow" />
          {!embedded && (
            <button className="btn primary lg" disabled={!doctor?.ready} onClick={() => go('home')}>
              시작하기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
