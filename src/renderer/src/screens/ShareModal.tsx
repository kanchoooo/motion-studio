// 프로젝트 공유: one file another designer opens to continue the project. The memo their Claude
// starts from is written by Claude here and read (and edited) by the designer first; the
// conversation, the designer's messages, the version history and exported videos stay here.
import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Share2, Sparkles } from 'lucide-react'
import type { AgentEvent } from '@shared/api'
import { Modal, Toggle } from '../components/ui'
import { cleanError, studio, useStore } from '../store'
import { flushOverrides } from './editor/overrides'

const mb = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)}GB` : `${Math.max(0.1, n / 1024 / 1024).toFixed(1)}MB`)

export function ShareModal({ onClose }: { onClose(): void }) {
  const { project, session, toast } = useStore()
  const pid = project!.meta.id
  const [memo, setMemo] = useState('')
  const [asking, setAsking] = useState(false)
  const [references, setReferences] = useState(true)
  const [candidates, setCandidates] = useState(true)
  const [making, setMaking] = useState(false)
  const [made, setMade] = useState<{ path: string; bytes: number } | null>(null)

  // a memo saved before (an earlier share) is the starting point
  useEffect(() => {
    void studio.projects.handoff(pid).then((m) => setMemo((cur) => cur || m))
  }, [pid])
  // Claude's memo arrives through save_handoff
  useEffect(
    () =>
      studio.agent.onEvent((e: AgentEvent) => {
        if (e.type === 'handoff-ready' && e.projectId === pid) {
          setMemo(e.markdown)
          setAsking(false)
        }
      }),
    [pid],
  )
  // Claude finished its turn without saving one: stop waiting
  useEffect(() => {
    if (asking && session.status === 'ready') {
      const t = setTimeout(() => setAsking(false), 4000)
      return () => clearTimeout(t)
    }
  }, [asking, session.status])

  const ask = async () => {
    try {
      setAsking(true)
      await studio.agent.requestHandoff(pid)
    } catch (e) {
      setAsking(false)
      toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
    }
  }
  const make = async () => {
    setMaking(true)
    try {
      // edits still waiting to be saved go into the file too
      await flushOverrides()
      const r = await studio.projects.exportShare(pid, { references, candidates, memo })
      if (r) setMade({ path: r.path, bytes: r.bytes })
    } catch (e) {
      toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setMaking(false)
    }
  }

  return (
    <Modal
      title="프로젝트 공유"
      onClose={onClose}
      width={620}
      footer={
        made ? (
          <>
            <button className="btn" onClick={() => studio.app.reveal(made.path)}>
              <FolderOpen size={14} />
              폴더에서 보기
            </button>
            <button className="btn primary" onClick={onClose}>
              닫기
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              취소
            </button>
            <button className="btn primary" disabled={!memo.trim() || making || asking} onClick={() => void make()} data-testid="share-make">
              {making ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />}
              공유 파일 만들기
            </button>
          </>
        )
      }
    >
      {made ? (
        <div className="col" style={{ gap: 8 }} data-testid="share-made">
          <b>공유 파일을 만들었어요 ({mb(made.bytes)})</b>
          <div className="small muted" style={{ wordBreak: 'break-all' }}>{made.path}</div>
          <div className="small" style={{ lineHeight: 1.6 }}>
            카톡·메일·드라이브 등으로 보내면, 받는 사람은 모션스튜디오 홈의 <b>공유 파일 열기</b>로 열어 이어서 작업해요. 받는 쪽 Claude는 인계 메모를 먼저 읽고 시작해요.
          </div>
        </div>
      ) : (
        <>
          <div className="small muted" style={{ lineHeight: 1.6 }}>
            다른 디자이너가 이어서 작업할 수 있게 파일 하나로 만들어요. 영상·소재·브리프·콘티·직접 수정한 내용이 들어가고, <b>대화 기록과 보낸 메시지 원문, 작업 이력, 내보낸 영상은 넣지 않아요.</b>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="row">
              <span className="section-label grow">인계 메모 · 받는 쪽 Claude가 먼저 읽어요</span>
              <button className="btn sm" disabled={asking || session.status !== 'ready'} onClick={() => void ask()} title={session.status === 'ready' ? '' : 'Claude가 작업을 마치면 받을 수 있어요'} data-testid="share-ask">
                {asking ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                {asking ? 'Claude가 쓰는 중…' : memo.trim() ? 'Claude에게 다시 받기' : 'Claude에게 요약 받기'}
              </button>
            </div>
            <textarea
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Claude에게 요약을 받거나 직접 적어 주세요. 목표·확정된 결정·스타일·남은 일 등. 대화 원문은 넘어가지 않아요."
              style={{ minHeight: 220, resize: 'vertical', lineHeight: 1.55, fontSize: 12.5 }}
              data-testid="share-memo"
            />
            <div className="tiny faint">받는 사람이 읽어도 괜찮은 내용인지 확인하고 고쳐 주세요.</div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <label className="row small" style={{ cursor: 'pointer' }}>
              <Toggle on={references} onChange={setReferences} />
              레퍼런스 첨부도 넣기 (유튜브 링크·참고 이미지·영상과 메모)
            </label>
            <label className="row small" style={{ cursor: 'pointer' }}>
              <Toggle on={candidates} onChange={setCandidates} />
              아직 고르지 않은 AI 후보도 넣기
            </label>
          </div>
        </>
      )}
    </Modal>
  )
}
