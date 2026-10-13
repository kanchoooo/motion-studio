import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { RenderRecord } from '@shared/project'
import { formatBytes, Modal, relativeTime } from '../../components/ui'
import { studio, useStore } from '../../store'

const LABEL = { renders: '내보낸 결과물', assets: '소재 원본', references: '레퍼런스', history: '작업 이력', cache: '임시 파일' } as const

export function StorageModal({ renders, onClose }: { renders: RenderRecord[]; onClose: () => void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [usage, setUsage] = useState<Record<string, number> | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const load = () => void studio.projects.diskUsage(pid).then(setUsage)
  useEffect(load, [pid])
  const candidates = renders.filter((r) => !r.starred).sort((a, b) => b.bytes - a.bytes)

  return (
    <Modal title="저장 공간" onClose={onClose} width={620}>
      {usage && (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="grow" style={{ fontWeight: 650 }}>이 프로젝트</span>
            <span className="mono">{formatBytes(usage.total)}</span>
          </div>
          {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => (
            <div key={k} className="row small" style={{ padding: '3px 0' }}>
              <span className="grow muted">{LABEL[k]}</span>
              <span className="mono">{formatBytes(usage[k] ?? 0)}</span>
              {k === 'cache' && (usage.cache ?? 0) > 0 && (
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    await studio.projects.clearCache(pid)
                    toast('임시 파일을 정리했어요', 'success')
                    load()
                  }}
                >
                  비우기
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 6 }}>
        <div className="section-label">별표 없는 결과물 · 큰 순서</div>
        {candidates.length === 0 && <div className="small muted">정리할 결과물이 없어요. 별표한 결과물은 여기 나오지 않아요.</div>}
        {candidates.map((r) => (
          <label key={r.id} className="row small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />
            <span className="grow ellipsis">{r.fileName}</span>
            <span className="faint tiny">{relativeTime(r.createdAt)}</span>
            <span className="mono" style={{ width: 70, textAlign: 'right' }}>{formatBytes(r.bytes)}</span>
          </label>
        ))}
      </div>
      {candidates.length > 0 && (
        <div className="row">
          <button className="btn sm ghost" onClick={() => setSel(sel.length === candidates.length ? [] : candidates.map((r) => r.id))}>
            {sel.length === candidates.length ? '선택 해제' : '모두 선택'}
          </button>
          <div className="grow" />
          <button
            className="btn sm danger"
            disabled={!sel.length}
            onClick={async () => {
              const bytes = candidates.filter((r) => sel.includes(r.id)).reduce((n, r) => n + r.bytes, 0)
              if (!confirm(`결과물 ${sel.length}개(${formatBytes(bytes)})를 삭제할까요?\n작업 이력은 남아서 같은 상태를 다시 내보낼 수 있어요.`)) return
              for (const id of sel) await studio.renders.remove(pid, id)
              toast(`${formatBytes(bytes)}를 정리했어요`, 'success')
              onClose()
            }}
          >
            <Trash2 size={13} />
            선택한 결과물 삭제
          </button>
        </div>
      )}
    </Modal>
  )
}
