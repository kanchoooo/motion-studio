import { RotateCcw, X } from 'lucide-react'
import { TERM_THEMES, XTerm } from '../../components/XTerm'
import { studio, useStore } from '../../store'

/** the live Claude Code terminal; kept mounted so the screen survives tab switches */
export function TerminalPanel() {
  const { project, terminalOpen, setTerminal, session, theme } = useStore()
  const pid = project?.meta.id

  const attention =
    session.attention === 'trust'
      ? '이 프로젝트 폴더를 처음 열었어요. 키보드 ↓ 키로 "Yes, I trust this folder"를 고른 뒤 Enter를 눌러 주세요. (그냥 Enter를 누르면 Claude가 종료돼요)'
      : session.attention === 'login'
        ? 'Claude 로그인이 풀렸어요. 오른쪽 버튼으로 다시 로그인하면 이어서 작업할 수 있어요.'
        : session.attention === 'usage'
          ? '사용량 한도에 도달했어요. 터미널에 표시된 초기화 시간 이후에 이어서 작업할 수 있어요.'
          : null

  return (
    <div style={{ display: terminalOpen ? 'flex' : 'none', flexDirection: 'column', height: 300, borderTop: '1px solid var(--border)', background: TERM_THEMES[theme].background, flex: 'none' }}>
      <div className="row" style={{ height: 34, padding: '0 8px 0 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <span className="small" style={{ fontWeight: 600 }}>터미널</span>
        <span className="tiny faint">Claude Code 원본 화면 · 키보드로 직접 입력할 수 있어요</span>
        <div className="grow" />
        {session.status === 'exited' && (
          <button className="btn sm" onClick={() => pid && studio.agent.start(pid)}>
            <RotateCcw size={13} />
            다시 시작
          </button>
        )}
        <button className="icon-btn" title="터미널 닫기" onClick={() => setTerminal(false)}>
          <X size={15} />
        </button>
      </div>
      {attention && (
        <div className="row small" style={{ padding: '8px 14px', background: 'var(--warning-soft)', color: 'var(--warning)', borderBottom: '1px solid var(--border)' }}>
          <span className="grow">{attention}</span>
          {session.attention === 'login' && (
            <button
              className="btn sm primary"
              onClick={async () => {
                await studio.app.login()
                useStore.setState({ loginOpen: true })
              }}
            >
              Claude 로그인
            </button>
          )}
        </div>
      )}
      {pid && <XTerm sessionId={pid} active={terminalOpen} style={{ padding: '6px 0 0 10px' }} />}
    </div>
  )
}
