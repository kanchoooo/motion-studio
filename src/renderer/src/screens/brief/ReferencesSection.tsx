import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Film, Image as ImageIcon, Link2, Loader2, Plus, Scissors, Trash2, X, MonitorPlay, Info } from 'lucide-react'
import type { ReferenceItem } from '@shared/brief'
import { formatTime } from '../../components/ui'
import { studio, useStore } from '../../store'
import { SectionHeader } from './BriefTab'

const KIND = { video: Film, image: ImageIcon, youtube: MonitorPlay }

export function ReferencesSection() {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [items, setItems] = useState<ReferenceItem[]>([])
  const [base, setBase] = useState('')
  const [url, setUrl] = useState('')
  const [drag, setDrag] = useState(false)

  const load = () => void studio.references.list(pid).then(setItems)
  useEffect(() => {
    load()
    void studio.projects.fileUrl(pid, '').then(setBase)
    return studio.agent.onEvent((e) => {
      if (e.type === 'references-changed' && e.projectId === pid) load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  const addFiles = async (files: string[]) => {
    if (!files.length) return
    const added = await studio.references.addFiles(pid, files)
    if (!added.length) toast('영상(MP4·MOV·WebM)이나 이미지 파일을 넣어 주세요.', 'error')
  }
  const addUrl = async () => {
    try {
      await studio.references.addYoutube(pid, url)
      setUrl('')
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <SectionHeader
        title="레퍼런스"
        desc="참고하고 싶은 영상·이미지를 넣어 주세요. 참고할 구간이나 메모를 남기면 그 부분을 중심으로, 비워 두면 Claude가 좋은 포인트를 직접 찾아 참고해요. 똑같이 베끼는 것은 자동으로 막아요."
      />
      <div className="row small" style={{ gap: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--text)', lineHeight: 1.6 }}>
        <Info size={15} color="var(--accent)" style={{ flex: 'none' }} />
        <span>
          영상 레퍼런스는 Claude가 움직임을 볼 수 있게 <b>0.1초 간격으로 전부</b> 분석해요. 참고하고 싶은 장면만 <b>미리 잘라서</b> 넣으면 분석이 빠르고, Claude도 그 움직임에 더 집중해요. (권장: 한 파일에 30초 이내)
        </span>
      </div>
      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void addFiles([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
        }}
        style={{ padding: 16, borderStyle: 'dashed', borderColor: drag ? 'var(--accent)' : 'var(--border-strong)', background: drag ? 'var(--accent-soft)' : 'var(--surface-2)' }}
      >
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={async () => addFiles(await studio.app.pickFiles('any'))}>
            <Plus size={14} />
            파일 추가
          </button>
          <span className="small muted">또는 파일을 끌어다 놓기</span>
          <div className="grow" />
          <div className="row input" style={{ width: 380, padding: '0 8px', gap: 6 }}>
            <Link2 size={14} color="var(--text-3)" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && addUrl()} placeholder="유튜브 링크 붙여넣기" style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, minWidth: 0 }} />
          </div>
          <button className="btn" disabled={!url.trim()} onClick={addUrl}>
            추가
          </button>
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>유튜브 영상은 분석용으로만 저화질(720p 이하, 10분 이내)로 내려받고, 결과물에는 절대 들어가지 않아요.</div>
      </div>

      {items.map((r) => (
        <ReferenceCard key={r.id} item={r} base={base} />
      ))}
    </div>
  )
}

function ReferenceCard({ item, base }: { item: ReferenceItem; base: string }) {
  const { project } = useStore()
  const pid = project!.meta.id
  const video = useRef<HTMLVideoElement>(null)
  const [mark, setMark] = useState<number | null>(null)
  const [note, setNote] = useState(item.note)
  const Icon = KIND[item.kind]
  const busy = item.status === 'downloading' || item.status === 'analyzing' || item.status === 'pending'
  const setRanges = (ranges: ReferenceItem['ranges']) => studio.references.update(pid, item.id, { ranges })

  return (
    <div className="card fade-in" style={{ padding: 14 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <Icon size={15} color="var(--text-2)" />
        <span className="grow ellipsis" style={{ fontWeight: 650 }}>{item.title}</span>
        {busy && (
          <span className="badge warning">
            <Loader2 size={11} className="spin" />
            {item.status === 'downloading' ? '내려받는 중' : '분석 중'}
          </span>
        )}
        {item.status === 'ready' && (
          <span className="badge success" title="0.1초 간격 움직임 시트(한 장에 2초)">
            분석 완료 · 장면 {item.frames?.length ?? 0}개{item.sheets?.length ? ` · 0.1초 시트 ${item.sheets.length}장` : ''}
          </span>
        )}
        {item.status === 'ready' && (item.meta?.duration ?? 0) > 30 && (
          <span className="badge warning" title="필요한 장면만 잘라서 다시 넣으면 Claude가 그 움직임에 더 집중해요">
            {Math.round(item.meta!.duration!)}초 · 길어요, 필요한 구간만 잘라 주세요
          </span>
        )}
        {item.status === 'error' && (
          <span className="badge danger" title={item.error}>
            <AlertCircle size={11} />
            {item.error ?? '오류'}
          </span>
        )}
        <button className="icon-btn" title="레퍼런스 빼기" onClick={() => studio.references.remove(pid, item.id)}>
          <Trash2 size={15} />
        </button>
      </div>

      {item.file && base && item.kind !== 'image' && (
        <div className="col" style={{ gap: 8 }}>
          <video ref={video} src={base + item.file} controls style={{ width: '100%', maxHeight: 300, background: '#000', borderRadius: 8 }} />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="small muted">참고할 구간</span>
            {mark == null ? (
              <button className="btn sm" onClick={() => setMark(video.current?.currentTime ?? 0)} title="재생 위치를 구간 시작으로">
                <Scissors size={13} />
                여기서 시작
              </button>
            ) : (
              <>
                <span className="badge accent">{formatTime(mark)} ~</span>
                <button
                  className="btn sm primary"
                  onClick={() => {
                    const end = video.current?.currentTime ?? mark + 1
                    const [a, b] = [Math.min(mark, end), Math.max(mark, end)]
                    if (b - a >= 0.2) void setRanges([...item.ranges, { from: +a.toFixed(2), to: +b.toFixed(2) }])
                    setMark(null)
                  }}
                >
                  여기서 끝
                </button>
                <button className="btn sm ghost" onClick={() => setMark(null)}>
                  취소
                </button>
              </>
            )}
            {item.ranges.map((r, i) => (
              <span key={i} className="badge accent" style={{ cursor: 'pointer' }} onClick={() => video.current && (video.current.currentTime = r.from)}>
                {formatTime(r.from)}~{formatTime(r.to)}
                <button className="icon-btn" title="이 구간 빼기" style={{ width: 18, height: 18 }} onClick={(e) => { e.stopPropagation(); void setRanges(item.ranges.filter((_, j) => j !== i)) }}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {!item.ranges.length && mark == null && <span className="tiny faint">비워 두면 Claude가 킥 포인트를 직접 찾아요</span>}
          </div>
        </div>
      )}
      {item.kind === 'image' && item.file && base && <img src={base + item.file} style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8 }} />}

      {item.frames && item.frames.length > 1 && (
        <div className="row" style={{ gap: 4, overflowX: 'auto', margin: '10px 0 4px', paddingBottom: 4 }}>
          {item.frames.map((f) => (
            <div key={f.file} className="col" style={{ gap: 2, flex: 'none', cursor: 'pointer' }} onClick={() => video.current && (video.current.currentTime = f.t)}>
              <img src={base + f.file} style={{ height: 54, borderRadius: 4 }} />
              <span className="tiny faint mono">{f.t.toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="textarea"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== item.note && studio.references.update(pid, item.id, { note })}
        placeholder="참고할 점 (예: 0:03 텍스트가 튕기며 들어오는 느낌, 컷 전환 리듬)"
        style={{ marginTop: 8 }}
      />
    </div>
  )
}
