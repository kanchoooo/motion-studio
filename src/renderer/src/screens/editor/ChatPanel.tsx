import { useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, ArrowUp, Check, ChevronsLeft, Clapperboard, Cpu, Film, ImagePlus, Info, Loader2, MapPin, Mic, Pause, Play, Scissors, ShieldCheck, ShieldQuestion, Square, SquareDashed, X, Link2 } from 'lucide-react'
import type { ClaudeUsage } from '@shared/ai'
import type { AgentEffort, AgentModel, AgentPermission, ChatItem, PermissionAsk, Storyboard } from '@shared/api'
import type { ReferenceItem } from '@shared/brief'
import { Markdown } from '../../components/Markdown'
import { Modal } from '../../components/ui'
import { studio, useStore } from '../../store'
import { useBriefUi } from '../brief/briefUi'
import { useEditor } from './editorStore'
import { captureAnnotatedFrame } from './Preview'

const YT = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]+|shorts\/[\w-]+|embed\/[\w-]+)|youtu\.be\/[\w-]+)[^\s]*/gi
const VIDEO_FILE = /\.(mp4|mov|webm|m4v|mkv)$/i

/** something attached to the next message: an image, a video or a YouTube link (references/<id>) */
interface Attach {
  id: string
  kind: ReferenceItem['kind']
  title: string
  status: ReferenceItem['status']
  file?: string
  thumb?: string
  duration?: number
  error?: string
  range?: { from: number; to: number }
}
const toAttach = (r: ReferenceItem, prev?: Attach): Attach => ({ id: r.id, kind: r.kind, title: r.title, status: r.status, file: r.file, thumb: r.kind === 'image' ? r.file : r.frames?.[0]?.file, duration: r.meta?.duration, error: r.error, range: prev?.range })

/**
 * The conversation with Claude. mode "plan" (브리프 탭): planning with attachments and the
 * storyboard; mode "edit" (편집 탭): the same conversation with marks on the video.
 */
export function ChatPanel({ onFold, mode = 'edit' }: { onFold?(): void; mode?: 'plan' | 'edit' }) {
  const { project, chat, session, toast, setTerminal, asks, refsNonce, setTab } = useStore()
  const { marks, markTime, removeMark, updateMark, clearMarks, player } = useEditor()
  const plan = mode === 'plan'
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<Attach[]>([])
  const [ranging, setRanging] = useState<Attach | null>(null)
  const seenLinks = useRef(new Set<string>())
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

  // attachment status (downloading → analysing → ready) follows the main process
  useEffect(() => {
    if (!attachments.length) return
    void studio.references.list(pid).then((all) => setAttachments((list) => list.map((a) => {
      const r = all.find((x) => x.id === a.id)
      return r ? toAttach(r, a) : a
    })))
  }, [refsNonce]) // eslint-disable-line react-hooks/exhaustive-deps
  /** images / videos from the computer → attachments (references/), analysed in the background */
  const addMedia = async (files: string[]) => {
    const ok = files.filter((f) => /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v|mkv)$/i.test(f))
    if (!ok.length) return toast('이미지나 영상 파일을 넣어 주세요.', 'error')
    try {
      const added = await studio.references.addFiles(pid, ok)
      setAttachments((a) => [...a, ...added.map((r) => toAttach(r))])
    } catch (e) {
      toast(errText(e), 'error')
    }
  }
  // a YouTube address typed or pasted into the message is downloaded as an attachment
  useEffect(() => {
    const links = [...new Set(text.match(YT) ?? [])].filter((u) => !seenLinks.current.has(u))
    if (!links.length) return
    const t = setTimeout(() => {
      for (const url of links) {
        seenLinks.current.add(url)
        void studio.references
          .addYoutube(pid, url)
          .then((r) => setAttachments((a) => [...a, toAttach(r)]))
          .catch((e) => toast(errText(e), 'error'))
      }
    }, 500)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = attachments.some((a) => a.status === 'pending' || a.status === 'downloading' || a.status === 'analyzing')
  const removeAttach = (a: Attach) => {
    setAttachments((l) => l.filter((x) => x.id !== a.id))
    void studio.references.remove(pid, a.id).catch(() => {})
  }

  /** copies picked/dropped images into the project and returns their project paths (reference images of marks) */
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
    if (waiting) return toast('첨부를 받거나 분석하는 중이에요. 끝나면 보낼 수 있어요.', 'info')
    setSending(true)
    try {
      let annotatedFrame: string | undefined
      if (marks.length) {
        player?.pause()
        if (markTime != null) player?.seek(markTime)
        await new Promise((r) => setTimeout(r, 250))
        annotatedFrame = await captureAnnotatedFrame()
      }
      const refs = attachments.filter((a) => a.status === 'ready')
      await studio.agent.send({
        projectId: pid,
        text: body || (marks.length ? '표시한 부분을 확인하고 고쳐 주세요.' : '첨부한 자료를 봐 주세요.'),
        marks: marks.length ? marks : undefined,
        annotatedFrame,
        time: markTime ?? undefined,
        references: refs.length ? refs.map((a) => ({ id: a.id, range: a.range })) : undefined,
      })
      setText('')
      setAttachments([])
      seenLinks.current.clear()
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
        void addMedia(droppedFiles(e))
      }}
    >
      <div className="row" style={{ height: 40, padding: '0 8px 0 14px', borderBottom: '1px solid var(--border)', flex: 'none', gap: 8 }}>
        <span style={{ fontWeight: 650 }}>{plan ? 'Claude와 기획' : 'Claude와 대화'}</span>
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
        className="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          if (atBottom.current) setBehind(false)
        }}
        style={{ flex: 1, overflow: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {chat.length === 0 &&
          (plan ? (
            <div className="col" style={{ gap: 10, padding: '24px 6px' }} data-testid="plan-empty">
              <div className="title">무엇을 만들까요?</div>
              <div className="small muted" style={{ lineHeight: 1.75 }}>
                만들고 싶은 영상을 자유롭게 이야기해 주세요. 광고주, 메시지, 분위기, 꼭 들어갈 문구 — 아는 만큼만 말하면 Claude가 물어보며 기획을 채워요.
                <br />
                레퍼런스 영상·이미지를 끌어 놓거나 유튜브 주소를 붙여 넣으면, Claude가 무엇이 좋은지 묻고 그 부분을 자세히 봐요.
                <br />
                기획이 정해지면 <b>"콘티로 보여줘"</b>라고 해 보세요. 장면별 시안과 필요한 소재가 나와요. 좋으면 <b>"제작해줘"</b>라고 말하면 만들기 시작하고 편집 탭으로 넘어가요.
              </div>
            </div>
          ) : (
            <div className="col" style={{ gap: 10, padding: '20px 4px' }}>
              <div className="title">아직 영상이 없어요</div>
              <div className="small muted" style={{ lineHeight: 1.7 }}>브리프 탭에서 Claude와 기획을 나누고 "제작해줘"라고 하면, 여기서 만드는 과정을 보고 바로 다듬을 수 있어요.</div>
              <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('brief')} data-testid="go-plan">
                브리프 탭에서 기획하기
              </button>
            </div>
          ))}
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
        {!plan && marks.length > 0 && (
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
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="attachments">
              {attachments.map((a) => (
                <AttachChip key={a.id} a={a} onRemove={() => removeAttach(a)} onRange={a.kind !== 'image' && a.status === 'ready' ? () => setRanging(a) : undefined} />
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
              await addMedia(files)
            }}
            placeholder={marks.length ? '표시한 부분을 어떻게 바꿀지 말해 주세요' : plan ? '만들고 싶은 영상을 이야기해 주세요 (Shift+Enter 줄바꿈 · 영상·이미지 끌어 놓기 · 유튜브 주소 붙여 넣기)' : 'Claude에게 요청하기 (Shift+Enter 줄바꿈 · 이미지·영상을 끌어 놓아 첨부)'}
            data-testid="chat-input"
            rows={3}
            style={{ border: 'none', outline: 'none', background: 'transparent', resize: 'none', minHeight: 54 }}
          />
          <div className="row">
            {!plan && <ToolButtons />}
            <button className="icon-btn" title="이미지·영상 첨부 (끌어 놓아도 돼요)" onClick={async () => addMedia(await studio.app.pickFiles('media'))} data-testid="attach-media">
              <ImagePlus size={15} />
            </button>
            {waiting && (
              <span className="tiny muted row" style={{ gap: 4 }}>
                <Loader2 size={11} className="spin" />
                첨부 준비 중
              </span>
            )}
            <div className="grow" />
            <button className="btn primary sm" disabled={sending || waiting || (!text.trim() && !marks.length && !attachments.length)} onClick={() => send()} style={{ width: 32, padding: 0 }} title={waiting ? '첨부를 준비하는 중이에요' : '보내기 (Enter)'} data-testid="chat-send">
              {sending ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <ModelPicker />
          <PermissionPicker />
          <UsageBadge />
        </div>
      </div>
      {dropping && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--accent-soft)', border: '2px dashed var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }} className="small">
          이미지·영상을 놓으면 메시지에 첨부돼요
        </div>
      )}
      {ranging && (
        <RangeModal
          a={ranging}
          onClose={() => setRanging(null)}
          onSave={(range) => {
            setAttachments((l) => l.map((x) => (x.id === ranging.id ? { ...x, range } : x)))
            void studio.references.update(pid, ranging.id, { ranges: range ? [range] : [] }).catch(() => {})
            setRanging(null)
          }}
        />
      )}
    </div>
  )
}

/** an attachment waiting in the composer: picture, title, state, the part chosen (videos) */
function AttachChip({ a, onRemove, onRange }: { a: Attach; onRemove(): void; onRange?(): void }) {
  const { project } = useStore()
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (a.thumb) void studio.projects.fileUrl(project!.meta.id, a.thumb).then(setUrl)
  }, [a.thumb, project])
  const busy = a.status === 'pending' || a.status === 'downloading' || a.status === 'analyzing'
  return (
    <div className="attach-chip" data-testid="attach-chip" title={a.error ?? a.title}>
      <div style={{ width: 40, height: 40, borderRadius: 5, overflow: 'hidden', background: 'var(--canvas)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {url ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : a.kind === 'youtube' ? <Link2 size={16} color="var(--text-3)" /> : <Film size={16} color="var(--text-3)" />}
      </div>
      <div className="col" style={{ gap: 1, minWidth: 0 }}>
        <span className="tiny ellipsis" style={{ fontWeight: 600 }}>{a.title}</span>
        <span className="tiny muted row" style={{ gap: 4 }}>
          {busy && <Loader2 size={10} className="spin" />}
          {a.status === 'downloading' ? '받는 중' : a.status === 'analyzing' || a.status === 'pending' ? '분석 중' : a.status === 'error' ? <span style={{ color: 'var(--danger)' }}>못 받았어요</span> : a.kind === 'image' ? '이미지' : `${a.kind === 'youtube' ? '유튜브' : '영상'}${a.duration ? ` ${a.duration.toFixed(1)}초` : ''}`}
        </span>
        {onRange && (
          <button className="btn ghost sm" style={{ height: 18, padding: '0 4px', fontSize: 11, alignSelf: 'flex-start' }} onClick={onRange} data-testid="attach-range">
            <Scissors size={10} />
            {a.range ? `${a.range.from.toFixed(1)}~${a.range.to.toFixed(1)}초` : '구간 지정'}
          </button>
        )}
      </div>
      <button className="icon-btn" title="첨부 빼기" onClick={onRemove} style={{ position: 'absolute', right: 2, top: 2, width: 18, height: 18 }}>
        <X size={10} />
      </button>
    </div>
  )
}

/** the part of an attached video to look at: play, then mark the start and the end */
function RangeModal({ a, onClose, onSave }: { a: Attach; onClose(): void; onSave(r: { from: number; to: number } | undefined): void }) {
  const { project } = useStore()
  const [url, setUrl] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const [from, setFrom] = useState(a.range?.from ?? 0)
  const [to, setTo] = useState(a.range?.to ?? a.duration ?? 0)
  useEffect(() => {
    if (a.file) void studio.projects.fileUrl(project!.meta.id, a.file).then(setUrl)
  }, [a.file, project])
  const now = () => +(video.current?.currentTime ?? 0).toFixed(2)
  return (
    <Modal title={`보여 줄 구간 · ${a.title}`} onClose={onClose} width={640}>
      {url && <video ref={video} src={url} controls style={{ width: '100%', maxHeight: 360, borderRadius: 8, background: '#000' }} data-testid="range-video" />}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => setFrom(now())}>
          여기서 시작 ({from.toFixed(1)}초)
        </button>
        <button className="btn sm" onClick={() => setTo(Math.max(now(), from + 0.1))}>
          여기서 끝 ({to.toFixed(1)}초)
        </button>
        <div className="grow" />
        {a.range && (
          <button className="btn ghost sm" onClick={() => onSave(undefined)}>
            구간 지우기
          </button>
        )}
        <button className="btn primary sm" disabled={to <= from} onClick={() => onSave({ from, to })} data-testid="range-save">
          이 구간으로
        </button>
      </div>
      <div className="tiny muted">Claude가 이 구간을 0.1초 간격으로 자세히 볼 수 있어요. 무엇이 좋은지도 메시지에 같이 적어 주세요.</div>
    </Modal>
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

/** how much of the Claude plan is used (Claude Code's own /usage), asked again after each turn */
function UsageBadge() {
  const status = useStore((s) => s.session.status)
  const [u, setU] = useState<ClaudeUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const load = (force = false) => {
    setBusy(true)
    void studio.app
      .claudeUsage(force)
      .then((r) => r && setU(r))
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(), 5 * 60_000)
    return () => clearInterval(t)
  }, [])
  // a turn just finished: the numbers moved
  useEffect(() => {
    if (status === 'ready') load()
  }, [status])
  if (!u?.session && !u?.week) return busy ? <span className="row tiny faint" style={{ gap: 4 }}><Loader2 size={11} className="spin" />사용량 확인 중</span> : null
  const tone = (pct?: number) => (pct == null ? undefined : pct >= 95 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : undefined)
  const tip = [
    u.session && `현재 세션 ${u.session.pct}%${u.session.resets ? ` · ${u.session.resets} 초기화` : ''}`,
    u.week && `이번 주 (전체 모델) ${u.week.pct}%${u.week.resets ? ` · ${u.week.resets} 초기화` : ''}`,
    ...u.models.map((m) => `이번 주 (${m.name}) ${m.pct}%${m.resets ? ` · ${m.resets} 초기화` : ''}`),
    `${new Date(u.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 확인 · 누르면 다시 확인해요`,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <button className="btn ghost sm tiny" style={{ height: 24, padding: '0 6px', gap: 4, color: 'var(--text-3)' }} title={tip} onClick={() => load(true)} data-testid="claude-usage">
      {busy ? <Loader2 size={11} className="spin" /> : <Activity size={11} />}
      Claude 사용량
      {u.session && <span style={{ color: tone(u.session.pct) }}>세션 {u.session.pct}%</span>}
      {u.week && <span style={{ color: tone(u.week.pct) }}>· 주간 {u.week.pct}%</span>}
    </button>
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
      {url && (VIDEO_FILE.test(rel) ? <video src={url} muted style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--canvas)' }} /> : <img src={url} style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />)}
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
      if (item.fromApp)
        return (
          <div className="row tiny muted fade-in" style={{ justifyContent: 'center', gap: 6 }} data-testid="app-request">
            <Info size={12} />
            앱이 Claude에게: {item.text}
          </div>
        )
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
    case 'voices':
      return <VoicesCard item={item} />
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
  const { project, setTab } = useStore()
  const [base, setBase] = useState('')
  const pid = project!.meta.id
  useEffect(() => {
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  const sb: Storyboard = item.storyboard
  const o = project!.brief.output
  const portrait = o.height > o.width
  const slots = sb.scenes.flatMap((s) => s.materials ?? [])
  const filled = slots.filter((m) => m.file).length
  const openBoard = () => {
    setTab('brief')
    useBriefUi.setState({ panel: 'storyboard' })
  }
  return (
    <div className="card fade-in" style={{ padding: 0, overflow: 'hidden', opacity: item.status === 'superseded' ? 0.55 : 1 }} data-testid="storyboard-card">
      <div className="row" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
        <Clapperboard size={15} color="var(--accent)" />
        <div className="grow col" style={{ gap: 0 }}>
          <div style={{ fontWeight: 650 }}>콘티 · {sb.title}</div>
          <div className="tiny muted">
            {sb.duration}초 · 장면 {sb.scenes.length}개{slots.length ? ` · 소재 ${filled}/${slots.length}` : ''}
          </div>
        </div>
        {item.status === 'approved' && <span className="badge success">제작 승인함</span>}
        {item.status === 'superseded' && <span className="badge">이전 콘티</span>}
      </div>
      <div style={{ padding: '10px 12px' }} className="col">
        <div className="small" style={{ lineHeight: 1.6 }}>{sb.concept}</div>
        {sb.scenes.some((s) => s.frame) && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${portrait ? 96 : 150}px, 1fr))`, gap: 8 }} data-testid="storyboard-frames">
            {sb.scenes.map((s) => (
              <div key={s.n} className="col" style={{ gap: 3 }}>
                <div style={{ aspectRatio: `${o.width} / ${o.height}`, borderRadius: 6, overflow: 'hidden', background: 'var(--canvas)', border: '1px solid var(--border)' }}>
                  {s.frame && base && <img src={base + s.frame} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                </div>
                <span className="tiny muted ellipsis">
                  {s.n}. {s.title}
                </span>
              </div>
            ))}
          </div>
        )}
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
              {!!s.materials?.length && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {s.materials.map((m) => (
                    <span key={m.id} className={`badge${m.file ? ' success' : ''}`} title={[m.prompt, m.startPrompt && `시작: ${m.startPrompt}`, m.endPrompt && `끝: ${m.endPrompt}`].filter(Boolean).join('\n')}>
                      {m.kind === 'video' ? '영상' : '이미지'} · {m.label}
                      {m.file ? ' ✓' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sb.notes && <div className="tiny muted">{sb.notes}</div>}
      </div>
      {item.status === 'pending' && (
        <div className="row" style={{ padding: '0 12px 12px', gap: 6, flexWrap: 'wrap' }}>
          {slots.length > 0 && (
            <button className="btn sm" onClick={openBoard} data-testid="storyboard-open">
              소재 넣기 ({filled}/{slots.length})
            </button>
          )}
          <span className="tiny faint">고칠 점은 대화로, 좋으면 "제작해줘"라고 말해 주세요</span>
        </div>
      )}
    </div>
  )
}

/** narration voices Claude suggests: listen, then pick one (Claude is told) */
function VoicesCard({ item }: { item: Extract<ChatItem, { role: 'voices' }> }) {
  const { project, toast } = useStore()
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  // local voices (an open-source model Claude ran here) are heard from their sample in the project
  const [base, setBase] = useState('')
  useEffect(() => {
    if (item.voices.some((v) => v.sample)) void studio.projects.fileUrl(project!.meta.id, '').then(setBase)
  }, [item.voices, project])
  useEffect(() => () => audio.current?.pause(), [])
  const urlOf = (v: (typeof item.voices)[number]) => (v.sample ? (base ? `${base}composition/${v.sample}` : undefined) : v.previewUrl)
  const play = (id: string, url?: string) => {
    audio.current?.pause()
    if (!url || playing === id) return setPlaying(null)
    const a = new Audio(url)
    audio.current = a
    a.onended = () => setPlaying(null)
    void a.play().catch(() => toast('미리듣기를 재생하지 못했어요.', 'error'))
    setPlaying(id)
  }
  return (
    <div className="card fade-in" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="voices-card">
      <div className="row small" style={{ gap: 6, fontWeight: 650 }}>
        <Mic size={14} color="var(--accent)" />
        <span className="grow">목소리 후보{item.label ? ` · ${item.label}` : ''}</span>
      </div>
      {item.script && <div className="tiny muted" style={{ whiteSpace: 'pre-wrap' }}>대본: {item.script}</div>}
      <div className="col" style={{ gap: 4 }}>
        {item.voices.map((v) => (
          <div key={v.id} className="row" style={{ gap: 8, padding: '4px 6px', borderRadius: 8, background: item.picked === v.id ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
            <button className="icon-btn" disabled={!urlOf(v)} title={urlOf(v) ? '들어 보기' : '미리듣기가 없어요'} onClick={() => play(v.id, urlOf(v))}>
              {playing === v.id ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
              <span className="small ellipsis">{v.name}</span>
              {(v.description || v.gender || v.engine) && <span className="tiny muted ellipsis">{[v.provider === 'local' ? `오픈소스 · ${v.engine ?? '이 Mac에서 만든 샘플'}` : '', v.gender, v.description].filter(Boolean).join(' · ')}</span>}
            </div>
            {item.picked === v.id ? (
              <span className="badge success">골랐어요</span>
            ) : (
              <button
                className="btn sm"
                disabled={busy || !!item.picked}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await studio.agent.pickVoice(project!.meta.id, item.id, v.id)
                  } catch (e) {
                    toast(errText(e), 'error')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                이 목소리로
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
