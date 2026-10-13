import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Clock, Copy, Download, Loader2 } from 'lucide-react'
import type { ProjectSummary } from '@shared/project'
import { studio, useStore } from '../../store'

const STATUS = {
  queued: { icon: Clock, label: '대기', color: 'var(--text-3)' },
  working: { icon: Loader2, label: 'Claude 작업 중', color: 'var(--accent)' },
  done: { icon: Check, label: '완료', color: 'var(--success)' },
  error: { icon: AlertCircle, label: '오류', color: 'var(--danger)' },
}

/** project name in the title bar: switch between the original and its variations */
export function FamilyMenu({ onCreate }: { onCreate: () => void }) {
  const { project, familyNonce, openProject, toast } = useStore()
  const [open, setOpen] = useState(false)
  const [family, setFamily] = useState<ProjectSummary[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const pid = project!.meta.id

  useEffect(() => {
    void studio.variations.family(pid).then(setFamily)
  }, [pid, familyNonce, open])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const variations = family.filter((f) => f.family)
  const working = variations.filter((v) => v.family!.status === 'working' || v.family!.status === 'queued').length
  const label = project!.meta.family ? project!.meta.family.label : '원본'

  return (
    <div ref={ref} style={{ position: 'relative' }} className="no-drag">
      <button className="row" onClick={() => setOpen(!open)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: 'var(--text)', maxWidth: 340 }}>
        <span className="ellipsis" style={{ fontWeight: 650 }}>{project!.meta.name.split(' · ')[0]}</span>
        {(variations.length > 0 || project!.meta.family) && <span className="badge">{label}</span>}
        {working > 0 && <Loader2 size={13} className="spin" color="var(--accent)" />}
        <ChevronDown size={14} color="var(--text-3)" />
      </button>
      {open && (
        <div className="menu fade-in" style={{ left: 0, top: 36, width: 340, padding: 6 }}>
          <div className="section-label" style={{ padding: '4px 8px 6px' }}>원본과 베리에이션</div>
          {family.map((f) => {
            const st = f.family ? STATUS[f.family.status] : null
            const Icon = st?.icon
            const current = f.id === pid
            return (
              <button
                key={f.id}
                onClick={async () => {
                  setOpen(false)
                  if (!current) await openProject(f.path).catch((e) => toast(String(e), 'error'))
                }}
                style={{ height: 'auto', padding: '7px 8px', background: current ? 'var(--accent-soft)' : undefined }}
              >
                <div style={{ width: 34, height: 24, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: f.width >= f.height ? 30 : (22 * f.width) / f.height, height: f.width >= f.height ? (30 * f.height) / f.width : 22, border: '1.5px solid var(--text-3)', borderRadius: 2 }} />
                </div>
                <span className="col grow" style={{ gap: 0, alignItems: 'flex-start', minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 600 }}>{f.family ? f.family.label : `원본 · ${f.ratio} · ${f.duration}초`}</span>
                  <span className="tiny faint">
                    {f.width}×{f.height}
                    {f.family ? ` · 기준: ${f.family.basedOn}` : ''}
                  </span>
                </span>
                {st && Icon && (
                  <span className="row tiny" style={{ color: st.color, gap: 4 }}>
                    <Icon size={12} className={f.family!.status === 'working' ? 'spin' : ''} />
                    {st.label}
                  </span>
                )}
              </button>
            )
          })}
          <div className="divider" />
          <button
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
          >
            <Copy size={14} />
            베리에이션 만들기…
          </button>
          {family.length > 1 && (
            <button
              onClick={async () => {
                setOpen(false)
                const n = await studio.variations.exportAll(pid, 'standard')
                toast(`${n}개 영상을 차례로 내보내고 있어요. 각 프로젝트의 결과물 보관함에 저장돼요.`, 'success')
              }}
            >
              <Download size={14} />
              모두 내보내기 (표준 품질)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
