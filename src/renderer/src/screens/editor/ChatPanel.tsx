import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, Check, Clapperboard, Info, Loader2, MapPin, Square, SquareDashed, X } from 'lucide-react'
import type { ChatItem, Storyboard } from '@shared/api'
import { Markdown } from '../../components/Markdown'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { captureAnnotatedFrame } from './Preview'

const QUICK = ['브리프대로 콘티 먼저 보여줘', '전체적으로 더 경쾌하게', '타이틀이 더 크게 들어왔으면 좋겠어']

export function ChatPanel() {
  const { project, chat, session, toast, setTerminal } = useStore()
  const { marks, markTime, removeMark, updateMark, clearMarks, player } = useEditor()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const pid = project!.meta.id
  const busy = session.status === 'busy'

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length, chat[chat.length - 1]])

  const send = async (override?: string) => {
    const body = (override ?? text).trim()
    if (!body && !marks.length) return
    setSending(true)
    try {
      let annotatedFrame: string | undefined
      if (marks.length) {
        player?.pause()
        if (markTime != null) player?.seek(markTime)
        await new Promise((r) => setTimeout(r, 250))
        annotatedFrame = await captureAnnotatedFrame()
      }
      await studio.agent.send({ projectId: pid, text: body || '표시한 부분을 확인하고 고쳐 주세요.', marks: marks.length ? marks : undefined, annotatedFrame, time: markTime ?? undefined })
      setText('')
      clearMarks()
      useEditor.setState({ tool: 'select' })
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
      toast(msg, 'error')
      if (/신뢰|터미널/.test(msg)) setTerminal(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div className="row" style={{ height: 40, padding: '0 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span style={{ fontWeight: 650 }}>Claude와 대화</span>
        <div className="grow" />
        {busy && (
          <button className="btn sm" onClick={() => studio.agent.interrupt(pid)} title="지금 하던 작업을 멈춰요 (Esc)">
            <Square size={11} fill="currentColor" />
            멈추기
          </button>
        )}
      </div>

      <div ref={list} style={{ flex: 1, overflow: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {chat.length === 0 && (
          <div className="col" style={{ gap: 10, padding: '20px 4px' }}>
            <div className="title">무엇을 만들까요?</div>
            <div className="small muted">브리프를 정리했다면 아래처럼 시작해 보세요. 영상 화면에 직접 표시해서 수정을 요청할 수도 있어요.</div>
            {QUICK.map((q) => (
              <button key={q} className="btn sm" style={{ justifyContent: 'flex-start' }} onClick={() => send(q)}>
                {q}
              </button>
            ))}
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
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--border)', flex: 'none' }} className="col">
        {marks.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <div className="row tiny muted">
              <span>{markTime?.toFixed(2)}초 화면에 표시 {marks.length}개</span>
              <div className="grow" />
              <button className="btn ghost sm" onClick={clearMarks}>
                모두 지우기
              </button>
            </div>
            {marks.map((m) => (
              <div key={m.id} className="row" style={{ gap: 6 }}>
                <span className="mark-chip">{m.n}</span>
                <span className="tiny muted" style={{ width: 64, flex: 'none' }} title={m.elements.map((e) => e.label).join(', ')}>
                  {m.elements[0]?.label ?? (m.kind === 'pin' ? '지점' : '영역')}
                </span>
                <input className="input" style={{ height: 28 }} placeholder={`${m.n}번에 대한 요청 (선택)`} value={m.note} onChange={(e) => updateMark(m.id, { note: e.target.value })} />
                <button className="icon-btn" onClick={() => removeMark(m.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="card" style={{ padding: 8, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={marks.length ? '표시한 부분을 어떻게 바꿀지 말해 주세요' : 'Claude에게 요청하기 (Shift+Enter 줄바꿈)'}
            rows={3}
            style={{ border: 'none', outline: 'none', background: 'transparent', resize: 'none', minHeight: 54 }}
          />
          <div className="row">
            <ToolButtons />
            <div className="grow" />
            <button className="btn primary sm" disabled={sending || (!text.trim() && !marks.length)} onClick={() => send()} style={{ width: 32, padding: 0 }} title="보내기 (Enter)">
              {sending ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
        </div>
      </div>
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
          <div style={{ background: 'var(--accent)', color: 'var(--accent-text)', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', whiteSpace: 'pre-wrap', userSelect: 'text' }}>{item.text}</div>
          {(item.marks?.length || frameUrl) && (
            <div className="col" style={{ gap: 4, marginTop: 6, alignItems: 'flex-end' }}>
              {frameUrl && <img src={frameUrl} style={{ width: 200, borderRadius: 8, border: '1px solid var(--border)' }} />}
              {item.marks?.map((m) => (
                <div key={m.id} className="row tiny muted">
                  <span className="mark-chip">{m.n}</span>
                  {m.elements[0]?.label ?? '영역'}
                  {m.note ? ` — ${m.note}` : ''}
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
  const { project } = useStore()
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
          <button className="btn primary sm grow" onClick={() => studio.agent.approveStoryboard(project!.meta.id, item.id)}>
            <Check size={13} />
            이대로 만들기
          </button>
          <span className="tiny faint">수정할 점은 아래에 적어 주세요</span>
        </div>
      )}
    </div>
  )
}
