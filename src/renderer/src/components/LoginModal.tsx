import { useEffect } from 'react'
import { studio, useStore } from '../store'
import { Modal } from './ui'
import { XTerm } from './XTerm'

/** Claude Code's own sign-in, shown as a real terminal (browser link + optional pasted code) */
export function LoginModal() {
  const { loginOpen, project, toast } = useStore()

  useEffect(() => {
    if (!loginOpen) return
    return studio.agent.onEvent(async (e) => {
      if (e.type !== 'session' || e.projectId !== '__login__' || e.state.status !== 'exited') return
      const report = await studio.app.doctor()
      useStore.setState({ doctor: report, loginOpen: false })
      const claude = report.items.find((i) => i.id === 'claude')
      if (claude?.status === 'ok') {
        toast(`Claude에 로그인했어요 (${claude.detail.split(' · ')[0]})`, 'success')
        // a project session that stopped for lack of sign-in starts again
        if (project) void studio.agent.restart(project.meta.id).then((session) => useStore.setState({ session }))
      } else toast('로그인이 끝나지 않았어요. 다시 시도해 주세요.', 'error')
    })
  }, [loginOpen, project, toast])

  if (!loginOpen) return null
  return (
    <Modal
      title="Claude 로그인"
      onClose={() => {
        void studio.app.cancelLogin()
        useStore.setState({ loginOpen: false })
      }}
      width={760}
    >
      <div className="small" style={{ lineHeight: 1.7 }}>
        브라우저에 Claude 로그인 화면이 열려요. <b>본인 회사 Team 계정</b>으로 로그인하고 승인해 주세요.
        <br />
        <span className="muted">브라우저가 열리지 않으면 아래에 나온 주소를 열고, 화면에 나온 코드를 아래 창에 붙여넣은 뒤 Enter를 눌러요. 로그인 정보는 Claude가 맥 키체인(Windows 자격 증명)에 직접 저장하고, 모션스튜디오는 보거나 보관하지 않아요.</span>
      </div>
      <div style={{ height: 300, display: 'flex', background: '#0f0f11', borderRadius: 8, padding: '8px 0 0 10px' }}>
        <XTerm sessionId="__login__" />
      </div>
    </Modal>
  )
}
