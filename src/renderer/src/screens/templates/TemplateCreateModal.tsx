// 템플릿 만들기: pick a finished project, tick the texts / images / clips / narration that
// can change (with a name and an optional note each), and save it as a template.
import { useEffect, useState } from 'react'
import { Film, Image as ImageIcon, LayoutTemplate, Loader2, Mic, Type } from 'lucide-react'
import type { TemplateSlot } from '@shared/api'
import { Modal } from '../../components/ui'
import { studio, useStore } from '../../store'
import { folderName, within } from '../home/folders'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const ICON = { text: Type, image: ImageIcon, video: Film, voice: Mic } as const
const KIND_LABEL = { text: '글자', image: '이미지', video: '영상', voice: '내레이션' } as const

export function TemplateCreateModal({ folder, sourcePath, onClose }: { folder: string; sourcePath?: string; onClose(): void }) {
  const { projects, toast, refreshProjects } = useStore()
  // finished projects in this folder first, then the rest
  const choices = projects.filter((p) => p.hasVideo).sort((a, b) => Number(within(b.folder, folder)) - Number(within(a.folder, folder)) || b.updatedAt.localeCompare(a.updatedAt))
  const [source, setSource] = useState(sourcePath ?? choices[0]?.path ?? '')
  const [slots, setSlots] = useState<(TemplateSlot & { on: boolean })[]>([])
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const src = projects.find((p) => p.path === source)

  useEffect(() => {
    if (!source) return
    setLoading(true)
    setSlots([])
    void studio.templates
      .detect(source)
      .then((r) => {
        setUrl(r.url)
        // texts, pictures and narration are what usually changes; clips too
        setSlots(r.slots.map((s) => ({ ...s, on: true })))
      })
      .catch((e) => toast(errText(e), 'error'))
      .finally(() => setLoading(false))
    setName(`${projects.find((p) => p.path === source)?.name ?? ''} 템플릿`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const patch = (id: string, p: Partial<TemplateSlot & { on: boolean }>) => setSlots((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const picked = slots.filter((s) => s.on)

  const save = async () => {
    setBusy(true)
    try {
      const t = await studio.templates.create(source, { name: name.trim() || `${src?.name ?? ''} 템플릿`, slots: picked.map(({ on: _on, ...s }) => s), folder: src?.folder })
      await refreshProjects()
      toast(`"${t.name}" 템플릿을 저장했어요. 새 프로젝트 → 템플릿으로에서 쓸 수 있어요.`, 'success')
      onClose()
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="템플릿 만들기"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="small muted grow">{picked.length ? `바꿀 칸 ${picked.length}개` : '바꿀 칸을 골라 주세요'}</span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={busy || !picked.length || !source} onClick={save} data-testid="template-save">
            <LayoutTemplate size={14} />
            템플릿 저장
          </button>
        </>
      }
    >
      <div className="small muted">완성한 영상의 모션은 그대로 두고, 고른 칸(글자·이미지·영상·내레이션)만 바꿔 새 영상을 만들 수 있게 저장해요.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>완성 프로젝트</label>
          <select className="select" value={source} disabled={!!sourcePath} onChange={(e) => setSource(e.target.value)} data-testid="template-source">
            {choices.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name} · {p.ratio} · {p.duration}초{p.folder ? ` (${folderName(p.folder)})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>템플릿 이름</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="template-name" />
        </div>
      </div>
      {loading ? (
        <div className="row small muted" style={{ gap: 6 }}>
          <Loader2 size={13} className="spin" />
          영상에서 바꿀 수 있는 칸을 찾는 중
        </div>
      ) : slots.length === 0 ? (
        <div className="small muted">이 영상에서 바꿀 수 있는 칸을 찾지 못했어요.</div>
      ) : (
        <div className="col" style={{ gap: 6 }} data-testid="template-slots">
          <div className="row tiny muted">
            <span className="grow">체크한 칸만 템플릿에서 바꿀 수 있어요. 이름과 메모는 채우는 사람에게 보여요.</span>
            <button className="btn ghost sm" onClick={() => setSlots((l) => l.map((s) => ({ ...s, on: true })))}>
              모두
            </button>
            <button className="btn ghost sm" onClick={() => setSlots((l) => l.map((s) => ({ ...s, on: false })))}>
              없음
            </button>
          </div>
          {slots.map((s) => {
            const Icon = ICON[s.kind]
            return (
              <div key={s.id} className="card" style={{ padding: 8, display: 'grid', gridTemplateColumns: '22px 64px 1fr', gap: 10, alignItems: 'center', opacity: s.on ? 1 : 0.55 }} data-testid="template-slot">
                <input type="checkbox" checked={s.on} onChange={(e) => patch(s.id, { on: e.target.checked })} />
                <div style={{ width: 64, height: 44, borderRadius: 5, overflow: 'hidden', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {s.kind === 'image' && url ? <img src={`${url}composition/${s.original}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <Icon size={16} color="var(--text-3)" />}
                </div>
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge">{KIND_LABEL[s.kind]}</span>
                    <input className="input grow" style={{ height: 28 }} value={s.label} onChange={(e) => patch(s.id, { label: e.target.value })} placeholder="칸 이름" />
                    <input className="input" style={{ height: 28, width: 180 }} value={s.hint ?? ''} onChange={(e) => patch(s.id, { hint: e.target.value })} placeholder="메모 (예: 10자 안팎)" />
                  </div>
                  <div className="tiny muted ellipsis" title={s.original}>
                    {s.kind === 'text' ? `“${s.original.replace(/\n/g, ' / ')}”` : s.original}
                    {s.kind === 'voice' && s.voice ? ' · 목소리 정보 있음' : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
