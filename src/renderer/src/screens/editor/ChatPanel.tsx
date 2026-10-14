import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, Check, ChevronsLeft, Clapperboard, Cpu, ImagePlus, Info, Loader2, MapPin, ShieldCheck, ShieldQuestion, Square, SquareDashed, X } from 'lucide-react'
import type { AgentEffort, AgentModel, AgentPermission, ChatItem, PermissionAsk, Storyboard } from '@shared/api'
import { Markdown } from '../../components/Markdown'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { captureAnnotatedFrame } from './Preview'

// the first request of a new project (edit requests come later, once there is a video)
const FIRST = '브리프대로 콘티 먼저 보여줘'

export function ChatPanel({ onFold }: { onFold?(): void }) {
  const { project, chat, session, toast, setTerminal, asks } = useStore()
  const { marks, markTime, removeMark, updateMark, clearMarks, player } = useEditor()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [dropping, setDropping] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  // follow new messages only while the designer is at the bottom (reading older ones is not interrupted)
  const atBottom = useRef(true)
  const [behind, setBehind] = useState(false)
  const pid = project!.meta.id
  const busy = session.status === 'busy'

  useEffect(() => {
    const el = list.current
    if (!el) return
    if (atBottom.current) el.scrollTop = el.scrollHeight
    else setBehind(true)
  }, [chat.length, chat[chat.length - 1], asks.length])
  const toBottom = () => {
    const el = list.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    atBottom.current = true
    setBehind(false)
  }

  /** copies picked/dropped images into the project and returns their project paths */
  const addImages = async (files: string[]): Promise<string[]> => {
    const out: string[] = []
    for (const f of files) {
      try {
        out.push(await studio.projects.addFeedbackImage(pid, f))
      } catch (e) {
        toast(errText(e), 'error')
      }
    }
    return out
  }
  const droppedFiles = (e: React.DragEvent) => [...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean)

  const send = async (override?: string) => {
    const body = (override ?? text).trim()
    if (!body && !marks.length && !attachments.length) return
    setSending(true)
    try {
      let annotatedFrame: string | undefined
      if (marks.length) {
        player?.pause()
        if (markTime != null) player?.seek(markTime)
        await new Promise((r) => setTimeout(r, 250))
        annotatedFrame = await captureAnnotatedFrame()
      }
      await studio.agent.send({
        projectId: pid,
        text: body || (marks.length ? '표시한 부분을 확인하고 고쳐 주세요.' : '첨부한 이미지를 참고해 주세요.'),
        marks: marks.length ? marks : undefined,
        annotatedFrame,
        time: markTime ?? undefined,
        attachments: attachments.length ? attachments : undefined,
      })
      setText('')
      setAttachments([])
      clearMarks()
      toBottom()
      useEditor.setState({ tool: 'select' })
    } catch (e) {
      const msg = errText(e)
      toast(msg, 'error')
      if (/신뢰|터미널/.test(msg)) setTerminal(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--surface)', position: 'relative' }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDropping(false)
        const added = await addImages(droppedFiles(e))
        if (added.length) setAttachments((a) => [...a, ...added])
      }}
    >
      <div className="row" style={{ height: 40, padding: '0 8px 0 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span style={{ fontWeight: 650 }}>Claude와 대화</span>
        <div className="grow" />
        {busy && (
          <button className="btn sm" onClick={() => studio.agent.interrupt(pid)} title="지금 하던 작업을 멈춰요 (Esc)">
            <Square size={11} fill="currentColor" />
            멈추기
          </button>
        )}
        {onFold && (
          <button className="icon-btn" title="대화창 접기" onClick={onFold}>
            <ChevronsLeft size={15} />
          </button>
        )}
      </div>

      <div
        ref={list}
        data-testid="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          if (atBottom.current) setBehind(false)
        }}
        style={{ flex: 1, overflow: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {chat.length === 0 && (
          <div className="col" style={{ gap: 10, padding: '20px 4px' }}>
            <div className="title">무엇을 만들까요?</div>
            <div className="small muted">브리프를 정리했다면 아래 버튼으로 시작해 보세요. Claude가 콘티를 먼저 보여 주고, 승인하면 영상을 만들어요.</div>
            <button className="btn sm primary" style={{ justifyContent: 'flex-start', alignSelf: 'flex-start' }} onClick={() => send(FIRST)} data-testid="quick-first">
              {FIRST}
            </button>
          </div>
        )}
        {collapse(chat).map(({ item, count }) => (
          <ChatRow key={item.id} item={item} count={count} />
        ))}
        {busy && (
          <div className="row small muted" style={{ padding: '2px 4px' }}>
            <Loader2 size={13} className="spin" />
            Claude가 작업하고 있어요 · 지금 보내는 메시지는 다음 차례에 전달돼요
          </div>
        )}
        {asks.map((a) => (
          <PermissionCard key={a.id} ask={a} />
        ))}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--border)', flex: 'none', position: 'relative' }} className="col">
        {behind && (
          <button className="btn sm" onClick={toBottom} style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', boxShadow: 'var(--shadow-sm)', zIndex: 2 }} data-testid="chat-latest">
            ↓ 최신 메시지
          </button>
        )}
        {marks.length > 0 && (
          <div className="col" style={{ gap: 6, maxHeight: 260, overflow: 'auto' }}>
            <div className="row tiny muted">
              <span>{markTime?.toFixed(2)}초 화면에 표시 {marks.length}개 · 표시마다 참고 이미지를 끌어 놓을 수 있어요</span>
              <div className="grow" />
              <button className="btn ghost sm" onClick={clearMarks}>
                모두 지우기
              </button>
            </div>
            {marks.map((m) => (
              <div
                key={m.id}
                className="col"
                style={{ gap: 4 }}
                data-mark-row={m.n}
                onDragOver={(e) => {
                  if (![...e.dataTransfer.types].includes('Files')) return
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropping(false)
                  const added = await addImages(droppedFiles(e))
                  if (added.length) updateMark(m.id, { refs: [...(m.refs ?? []), ...added] })
                }}
              >
                <div className="row" style={{ gap: 6 }}>
                  <span className="mark-chip">{m.n}</span>
                  <span className="tiny muted" style={{ width: 64, flex: 'none' }} title={m.elements.map((e) => e.label).join(', ')}>
                    {m.elements[0]?.label ?? (m.kind === 'pin' ? '지점' : '영역')}
                  </span>
                  <input className="input" style={{ height: 28 }} placeholder={`${m.n}번에 대한 요청 (선택)`} value={m.note} onChange={(e) => updateMark(m.id, { note: e.target.value })} />
                  <button
                    className="icon-btn"
                    title="참고 이미지 첨부 (끌어 놓아도 돼요)"
                    onClick={async () => {
                      const added = await addImages(await studio.app.pickFiles('images'))
                      if (added.length) updateMark(m.id, { refs: [...(m.refs ?? []), ...added] })
                    }}
                  >
                    <ImagePlus size={14} />
                  </button>
                  <button className="icon-btn" title="이 표시 지우기" onClick={() => removeMark(m.id)}>
                    <X size={14} />
                  </button>
                </div>
                {!!m.refs?.length && (
                  <div className="row" style={{ gap: 4, paddingLeft: 28, flexWrap: 'wrap' }}>
                    {m.refs.map((r) => (
                      <Thumb key={r} rel={r} size={40} onRemove={() => updateMark(m.id, { refs: m.refs!.filter((x) => x !== r) })} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="card" style={{ padding: 8, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 6, outline: dropping ? '2px dashed var(--accent)' : 'none' }}>
          {attachments.length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {attachments.map((r) => (
                <Thumb key={r} rel={r} size={48} onRemove={() => setAttachments((a) => a.filter((x) => x !== r))} />
              ))}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            onPaste={async (e) => {
              const files = [...e.clipboardData.files].map((f) => studio.app.pathForFile(f)).filter(Boolean)
              if (!files.length) return
              e.preventDefault()
              const added = await addImages(files)
              if (added.length) setAttachments((a) => [...a, ...added])
            }}
            placeholder={marks.length ? '표시한 부분을 어떻게 바꿀지 말해 주세요' : 'Claude에게 요청하기 (Shift+Enter 줄바꿈 · 이미지를 끌어 놓아 첨부)'}
            rows={3}
            style={{ border: 'none', outline: 'none', background: 'transparent', resize: 'none', minHeight: 54 }}
          />
          <div className="row">
            <ToolButtons />
            <button
              className="icon-btn"
              title="참고 이미지 첨부"
              onClick={async () => {
                const added = await addImages(await studio.app.pickFiles('images'))
                if (added.length) setAttachments((a) => [...a, ...added])
              }}
            >
              <ImagePlus size={15} />
            </button>
            <div className="grow" />
            <button className="btn primary sm" disabled={sending || (!text.trim() && !marks.length && !attachments.length)} onClick={() => send()} style={{ width: 32, padding: 0 }} title="보내기 (Enter)">
              {sending ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <ModelPicker />
          <PermissionPicker />
        </div>
      </div>
      {dropping && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--accent-soft)', border: '2px dashed var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }} className="small">
          참고 이미지를 놓으면 메시지에 첨부돼요
        </div>
      )}
    </div>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

// '' = the app default (latest Opus, high effort; see DEFAULT_MODEL / DEFAULT_EFFORT in pty-session)
const MODELS: { value: AgentModel; label: string }[] = [
  { value: '', label: 'Opus 최신 (기본)' },
  { value: 'fable', label: 'Fable · 가장 강력' },
  { value: 'sonnet', label: 'Sonnet · 빠르고 효율적' },
  { value: 'haiku', label: 'Haiku · 가장 빠름' },
]
const EFFORTS: { value: AgentEffort; label: string }[] = [
  { value: '', label: '높음 (기본)' },
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'xhigh', label: '매우 높음' },
  { value: 'max', label: '최대' },
]

/** images / clips Claude generated: the designer reviews them before they go into the video */
function GeneratedCard({ item }: { item: Extract<ChatItem, { role: 'generated' }> }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const { selected, elements } = useEditor()
  const [base, setBase] = useState('')
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void studio.projects.fileUrl(pid, 'composition/').then(setBase)
  }, [pid])
  const sel = elements.find((e) => e.id === selected)
  const paths = item.files.map((f) => f.file).join(', ')
  const act = async (action: 'keep' | 'discard' | 'applied', message?: string, note?: string) => {
    setBusy(true)
    setMenu(false)
    try {
      await studio.agent.resolveGenerated(pid, item.id, action, note)
      if (message) await studio.agent.send({ projectId: pid, text: message })
      if (action === 'keep') toast('브리프 소재에 넣었어요', 'success')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const STATUS = { kept: '소재함에 넣었어요', discarded: '버렸어요', applied: '적용을 요청했어요' } as const
  return (
    <div className="card fade-in" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="generated-card">
      <div className="row small" style={{ gap: 6, fontWeight: 650 }}>
        <ImagePlus size={14} color="var(--accent)" />
        <span className="grow">Claude가 만든 소재{item.label ? ` · ${item.label}` : ''}</span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', opacity: item.status === 'discarded' ? 0.4 : 1 }}>
        {base &&
          item.files.map((f) =>
            f.kind === 'video' ? (
              <video key={f.file} src={base + f.file} muted loop autoPlay playsInline style={{ width: 150, borderRadius: 6, background: 'var(--canvas)' }} />
            ) : (
              <img key={f.file} src={base + f.file} style={{ width: 150, maxHeight: 150, objectFit: 'contain', borderRadius: 6, background: 'var(--canvas)' }} />
            ),
          )}
      </div>
      {item.status === 'pending' ? (
        <div className="row" style={{ gap: 6, position: 'relative', flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={busy} onClick={() => setMenu(!menu)} data-testid="generated-apply">
            적용 ▾
          </button>
          <button className="btn sm" disabled={busy} onClick={() => void act('keep')} title="브리프 소재에 넣어 두고 나중에 써요">
            소재함에 추가
          </button>
          <div className="grow" />
          <button className="btn sm ghost" disabled={busy} onClick={() => void act('discard')}>
            버리기
          </button>
          {menu && (
            <div className="card" style={{ position: 'absolute', left: 0, top: 32, zIndex: 5, padding: 4, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', minWidth: 230 }}>
              <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => void act('applied', `방금 만든 소재(${paths})를 영상에 알맞은 자리에 넣어 줘.`, 'Claude에게 맡김')}>
                Claude에게 맡기기 (알맞은 자리에)
              </button>
              <button
                className="btn ghost sm"
                style={{ justifyContent: 'flex-start' }}
                disabled={!sel}
                title={sel ? undefined : '편집 화면에서 바꿀 요소를 먼저 골라 주세요'}
                onClick={() => sel && void act('applied', `방금 만든 소재(${paths})로 '${sel.label}'(${sel.id}) 요소를 바꿔 줘.`, `${sel.label}에 적용`)}
              >
                고른 요소에 넣기{sel ? ` · ${sel.label}` : ' (요소를 먼저 골라 주세요)'}
              </button>
              <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => void act('applied', `방금 만든 소재(${paths})를 배경으로 써 줘.`, '배경으로')}>
                배경으로 쓰기
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="tiny muted">
          {STATUS[item.status]}
          {item.note ? ` · ${item.note}` : ''}
        </div>
      )}
    </div>
  )
}

/** Claude waits for the designer: allow once, for the rest of the conversation, or refuse */
function PermissionCard({ ask }: { ask: PermissionAsk }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const answer = async (a: 'allow' | 'always' | 'deny') => {
    setBusy(true)
    try {
      await studio.agent.answerPermission(ask.projectId, ask.id, a)
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
    }
  }
  return (
    <div className="card fade-in" style={{ padding: 12, borderColor: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))' }} data-testid="permission-card">
      <div className="row small" style={{ gap: 6, fontWeight: 650, marginBottom: 6 }}>
        <ShieldQuestion size={15} color="var(--warning)" />
        <span className="grow">Claude가 허락을 기다려요 · {ask.title}</span>
      </div>
      {ask.detail && (
        <pre className="mono tiny" style={{ margin: '0 0 10px', padding: 8, borderRadius: 6, background: 'var(--surface-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 140, overflow: 'auto' }}>
          {ask.detail}
        </pre>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm primary" disabled={busy} onClick={() => answer('allow')}>
          허용
        </button>
        <button className="btn sm" disabled={busy} onClick={() => answer('always')} title="이 대화가 끝날 때까지 같은 종류의 작업은 묻지 않아요">
          이 대화에서 계속 허용
        </button>
        <div className="grow" />
        <button className="btn sm ghost" disabled={busy} onClick={() => answer('deny')}>
          거부
        </button>
      </div>
    </div>
  )
}

/** "물어보기" / "모두 허용" for this project (no restart needed) */
function PermissionPicker() {
  const { project, toast, setProject } = useStore()
  const pid = project!.meta.id
  const mode: AgentPermission = project!.meta.agentPermission === 'all' ? 'all' : 'ask'
  const change = async (next: AgentPermission) => {
    if (next === 'all' && !confirm('Claude가 묻지 않고 명령 실행·웹 접속·프로젝트 밖 파일 쓰기까지 할 수 있어요.\n앱이 관리하는 파일(브리프·직접 수정값 등)은 그대로 보호돼요.\n모두 허용으로 바꿀까요?')) return
    try {
      await studio.agent.setPermission(pid, next)
      setProject(await studio.projects.state(pid))
      toast(next === 'all' ? '이제 Claude가 묻지 않고 진행해요' : '이제 Claude가 필요할 때 대화창에서 물어봐요', 'success')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }
  return (
    <div className="row tiny muted" style={{ gap: 6 }} data-testid="permission-picker" title="Claude가 명령 실행·웹 접속처럼 평소 권한 밖의 작업을 할 때">
      {mode === 'all' ? <ShieldCheck size={12} color="var(--warning)" /> : <ShieldQuestion size={12} />}
      <span>권한</span>
      <select className="select" style={{ height: 24, fontSize: 11, padding: '0 6px', width: 'auto' }} value={mode} onChange={(e) => void change(e.target.value as AgentPermission)}>
        <option value="ask">물어보기</option>
        <option value="all">모두 허용</option>
      </select>
    </div>
  )
}

/** model + reasoning effort for this project's Claude session */
function ModelPicker() {
  const { project, session, toast, setProject } = useStore()
  const pid = project!.meta.id
  // older projects may hold the defaults explicitly
  const model = (project!.meta.agentModel === 'opus' ? '' : (project!.meta.agentModel ?? '')) as AgentModel
  const effort = (project!.meta.agentEffort === 'high' ? '' : (project!.meta.agentEffort ?? '')) as AgentEffort
  const change = async (next: { model: AgentModel; effort: AgentEffort }) => {
    try {
      const st = await studio.agent.setModel(pid, next)
      setProject(await studio.projects.state(pid))
      toast(st.pendingRestart ? '지금 작업이 끝나면 바꿀게요' : 'Claude를 새 설정으로 다시 연결했어요. 대화는 그대로 이어져요.', 'success')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }
  return (
    <div className="row tiny muted" style={{ gap: 6 }} data-testid="model-picker">
      <Cpu size={12} />
      <select className="select" style={{ height: 24, fontSize: 11, padding: '0 6px', width: 'auto' }} value={model} onChange={(e) => change({ model: e.target.value as AgentModel, effort })} title="Claude 모델">
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <span>추론</span>
      <select className="select" style={{ height: 24, fontSize: 11, padding: '0 6px', width: 'auto' }} value={effort} onChange={(e) => change({ model, effort: e.target.value as AgentEffort })} title="추론 강도: 높을수록 더 깊이 생각하지만 느리고 사용량이 많아요">
        {EFFORTS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {session.pendingRestart && <span style={{ color: 'var(--warning)' }}>작업 후 적용</span>}
    </div>
  )
}

/** project image (feedback/refs/…) as a small thumbnail */
function Thumb({ rel, size, onRemove }: { rel: string; size: number; onRemove?(): void }) {
  const { project } = useStore()
  const [url, setUrl] = useState('')
  useEffect(() => {
    void studio.projects.fileUrl(project!.meta.id, rel).then(setUrl)
  }, [rel, project])
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      {url && <img src={url} style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />}
      {onRemove && (
        <button className="icon-btn" title="첨부 빼기" onClick={onRemove} style={{ position: 'absolute', right: -6, top: -6, width: 18, height: 18, borderRadius: 9, background: 'var(--surface-3)' }}>
          <X size={10} />
        </button>
      )}
    </div>
  )
}

function ToolButtons() {
  const { tool } = useEditor()
  const setTool = (t: 'select' | 'box' | 'pin') => useEditor.setState({ tool: tool === t ? 'select' : t })
  return (
    <div className="row" style={{ gap: 2 }}>
      <button className={`icon-btn${tool === 'box' ? ' active' : ''}`} title="영역 표시 (M) — 화면에 드래그해서 표시해요" onClick={() => setTool('box')}>
        <SquareDashed size={15} />
      </button>
      <button className={`icon-btn${tool === 'pin' ? ' active' : ''}`} title="지점 표시 (P) — 화면을 클릭해서 표시해요" onClick={() => setTool('pin')}>
        <MapPin size={15} />
      </button>
      {tool !== 'select' && <span className="tiny" style={{ color: 'var(--mark)' }}>화면에 표시하세요</span>}
    </div>
  )
}

/** consecutive identical status lines ("영상을 다듬고 있어요" ×4) read better as one */
function collapse(items: ChatItem[]): { item: ChatItem; count: number }[] {
  const out: { item: ChatItem; count: number }[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (prev && it.role === 'status' && prev.item.role === 'status' && prev.item.text === it.text) {
      prev.count++
      prev.item = { ...it, done: it.done }
    } else out.push({ item: it, count: 1 })
  }
  return out
}

function ChatRow({ item, count = 1 }: { item: ChatItem; count?: number }) {
  const { project } = useStore()
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  useEffect(() => {
    if (item.role === 'user' && item.frame) void studio.projects.fileUrl(project!.meta.id, item.frame).then(setFrameUrl)
  }, [item, project])

  switch (item.role) {
    case 'user':
      return (
        <div className="fade-in" style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
          <div style={{ background: 'var(--accent)', color: 'var(--accent-text)', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', whiteSpace: 'pre-wrap', userSelect: 'text', opacity: item.queued ? 0.75 : 1 }}>{item.text}</div>
          {item.queued && (
            <div className="row tiny muted" style={{ justifyContent: 'flex-end', marginTop: 3, gap: 4 }} data-testid="queued-label">
              <Loader2 size={10} className="spin" />
              전달 대기 · Claude가 지금 작업을 마치는 대로 읽어요
            </div>
          )}
          {(item.marks?.length || frameUrl || item.attachments?.length) && (
            <div className="col" style={{ gap: 4, marginTop: 6, alignItems: 'flex-end' }}>
              {frameUrl && <img src={frameUrl} style={{ width: 200, borderRadius: 8, border: '1px solid var(--border)' }} />}
              {!!item.attachments?.length && (
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {item.attachments.map((r) => (
                    <Thumb key={r} rel={r} size={56} />
                  ))}
                </div>
              )}
              {item.marks?.map((m) => (
                <div key={m.id} className="row tiny muted" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className="mark-chip">{m.n}</span>
                  {m.elements[0]?.label ?? '영역'}
                  {m.note ? ` — ${m.note}` : ''}
                  {m.refs?.map((r) => (
                    <Thumb key={r} rel={r} size={32} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    case 'assistant':
      return (
        <div className="fade-in" style={{ alignSelf: 'flex-start', maxWidth: '96%', userSelect: 'text', lineHeight: 1.6 }}>
          <Markdown text={item.text} />
        </div>
      )
    case 'status':
      return (
        <div className="row tiny muted fade-in" style={{ gap: 6 }}>
          {item.done ? <Check size={12} color="var(--success)" /> : <Loader2 size={12} className="spin" />}
          {item.text}
          {count > 1 && <span className="faint">×{count}</span>}
        </div>
      )
    case 'storyboard':
      return <StoryboardCard item={item} />
    case 'generated':
      return <GeneratedCard item={item} />
    case 'error':
      return (
        <div className="card fade-in" style={{ padding: 10, borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
          <div className="row small" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            <AlertCircle size={14} />
            {item.text}
          </div>
          {item.detail && (
            <details className="tiny muted" style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer' }}>자세히</summary>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.detail}</pre>
            </details>
          )}
        </div>
      )
    case 'notice':
      return (
        <div className="row tiny muted" style={{ justifyContent: 'center' }}>
          <Info size={12} />
          {item.text}
        </div>
      )
  }
}

function StoryboardCard({ item }: { item: Extract<ChatItem, { role: 'storyboard' }> }) {
  const { project, toast } = useStore()
  const [approving, setApproving] = useState(false)
  const sb: Storyboard = item.storyboard
  return (
    <div className="card fade-in" style={{ padding: 0, overflow: 'hidden', opacity: item.status === 'superseded' ? 0.55 : 1 }}>
      <div className="row" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
        <Clapperboard size={15} color="var(--accent)" />
        <div className="grow col" style={{ gap: 0 }}>
          <div style={{ fontWeight: 650 }}>콘티 · {sb.title}</div>
          <div className="tiny muted">{sb.duration}초 · 장면 {sb.scenes.length}개</div>
        </div>
        {item.status === 'approved' && <span className="badge success">승인됨</span>}
        {item.status === 'superseded' && <span className="badge">이전 콘티</span>}
      </div>
      <div style={{ padding: '10px 12px' }} className="col">
        <div className="small" style={{ lineHeight: 1.6 }}>{sb.concept}</div>
        {sb.scenes.map((s) => (
          <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div className="mono tiny muted">
              {s.from.toFixed(1)}–{s.to.toFixed(1)}s
            </div>
            <div className="col" style={{ gap: 3 }}>
              <div className="small" style={{ fontWeight: 650 }}>
                {s.n}. {s.title}
              </div>
              <div className="small muted">{s.description}</div>
              {s.texts.length > 0 && <div className="tiny">문구: {s.texts.map((t) => `“${t}”`).join(' · ')}</div>}
              {s.motion && <div className="tiny" style={{ color: 'var(--accent)' }}>모션: {s.motion}</div>}
            </div>
          </div>
        ))}
        {sb.notes && <div className="tiny muted">{sb.notes}</div>}
      </div>
      {item.status === 'pending' && (
        <div className="row" style={{ padding: '0 12px 12px' }}>
          <button
            className="btn primary sm grow"
            disabled={approving}
            onClick={async () => {
              setApproving(true)
              try {
                await studio.agent.approveStoryboard(project!.meta.id, item.id)
              } catch (e) {
                toast(errText(e), 'error')
                setApproving(false)
              }
            }}
          >
            <Check size={13} />
            이대로 만들기
          </button>
          <span className="tiny faint">수정할 점은 아래에 적어 주세요</span>
        </div>
      )}
    </div>
  )
}
