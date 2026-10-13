// Work history inside the editor (folds away at the right edge): every Claude
// turn, direct edit and brief change, with full or partial restore.
import { useEffect, useState } from 'react'
import { Bookmark, Bot, ChevronsRight, MoreHorizontal, RotateCcw, Sparkles, Star, User } from 'lucide-react'
import type { HistoryEntry } from '@shared/project'
import { Menu, relativeTime } from '../../components/ui'
import { studio, useStore } from '../../store'

const ACTOR = {
  designer: { icon: User, label: '디자이너', color: 'var(--accent)' },
  claude: { icon: Bot, label: 'Claude', color: 'var(--success)' },
  app: { icon: Sparkles, label: '자동', color: 'var(--text-3)' },
}

export function HistoryPanel({ onClose }: { onClose(): void }) {
  const { project, historyNonce, toast, setProject } = useStore()
  const pid = project!.meta.id
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [base, setBase] = useState('')
  const [filter, setFilter] = useState<'all' | 'versions' | 'starred'>('all')
  const [rowMenu, setRowMenu] = useState<string | null>(null)

  const load = async () => {
    const [h, b] = await Promise.all([studio.history.list(pid), studio.projects.fileUrl(pid, '')])
    setEntries(h)
    setBase(b)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, historyNonce])

  const restore = async (e: HistoryEntry) => {
    const label = e.versionName ?? e.summary
    if (!confirm(`"${label}" 상태로 되돌릴까요?\n지금 상태도 이력에 남아서 언제든 다시 돌아올 수 있어요.`)) return
    try {
      setProject(await studio.history.restore(pid, e.id))
      toast('되돌렸어요', 'success')
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }
  const restorePart = async (e: HistoryEntry, scope: 'composition' | 'overrides' | 'brief') => {
    const what = { composition: '영상', overrides: '직접 수정값', brief: '브리프' }[scope]
    if (!confirm(`"${e.versionName ?? e.summary}" 시점의 ${what}만 되돌릴까요?\n나머지는 지금 상태 그대로 두고, 지금 상태도 이력에 남아요.`)) return
    setProject(await studio.history.restorePartial(pid, e.id, scope))
    toast(`${what}만 되돌렸어요`, 'success')
    void load()
  }
  const saveVersion = async () => {
    const name = prompt('이 상태를 어떤 이름으로 저장할까요?', '광고주 1차 시안')
    if (!name?.trim()) return
    await studio.history.saveVersion(pid, name.trim())
    toast(`"${name.trim()}"(으)로 저장했어요`, 'success')
    void load()
  }

  const shown = entries.filter((e) => filter === 'all' || (filter === 'starred' ? e.starred : !!e.versionName))

  return (
    <div className="col" style={{ height: '100%', gap: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)', minWidth: 0 }} data-testid="history-panel">
      <div className="row" style={{ height: 40, padding: '0 6px 0 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span style={{ fontWeight: 650 }} className="grow">작업 이력</span>
        <button className="btn ghost sm" onClick={saveVersion} title="지금 상태에 이름을 붙여 저장해요">
          <Bookmark size={13} />
          저장
        </button>
        <button className="icon-btn" title="이력 접기" onClick={onClose}>
          <ChevronsRight size={15} />
        </button>
      </div>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div className="seg full">
          {(['all', 'versions', 'starred'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {{ all: '전체', versions: '저장한 버전', starred: '별표' }[f]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
        {shown.length === 0 && <div className="small muted" style={{ padding: 14 }}>표시할 이력이 없어요.</div>}
        {shown.map((e, i) => {
          const a = ACTOR[e.actor] ?? ACTOR.app
          const Icon = a.icon
          const current = i === 0 && filter === 'all'
          return (
            <div key={e.id} className="col" style={{ padding: '9px 8px', borderTop: i ? '1px solid var(--border)' : 'none', gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  <Icon size={12} color={a.color} />
                </div>
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  {e.versionName && <span className="badge accent" style={{ alignSelf: 'flex-start' }}>{e.versionName}</span>}
                  <span className="small" style={{ lineHeight: 1.4, wordBreak: 'keep-all' }}>{e.summary}</span>
                  <span className="tiny faint">
                    {a.label} · {relativeTime(e.at)}
                    {current ? ' · 현재 상태' : ''}
                  </span>
                </div>
                <button className="icon-btn" title="별표" onClick={async () => {
                  await studio.history.star(pid, e.id, !e.starred)
                  void load()
                }}>
                  <Star size={13} fill={e.starred ? 'var(--warning)' : 'none'} color={e.starred ? 'var(--warning)' : 'currentColor'} />
                </button>
              </div>
              {(e.thumbnail || !current) && (
                <div className="row" style={{ gap: 6, paddingLeft: 32 }}>
                  {e.thumbnail && base && <img src={`${base}${e.thumbnail}`} style={{ width: 72, height: 40, objectFit: 'cover', borderRadius: 4 }} />}
                  <div className="grow" />
                  {!current && (
                    <div style={{ position: 'relative' }} className="row">
                      <button className="btn sm" onClick={() => restore(e)}>
                        <RotateCcw size={12} />
                        되돌리기
                      </button>
                      <button className="icon-btn" title="일부만 되돌리기" onClick={() => setRowMenu(rowMenu === e.id ? null : e.id)}>
                        <MoreHorizontal size={14} />
                      </button>
                      {rowMenu === e.id && (
                        <Menu
                          style={{ right: 0, top: 32 }}
                          onClose={() => setRowMenu(null)}
                          items={[
                            { label: '영상(Claude 작업)만 되돌리기', onClick: () => restorePart(e, 'composition') },
                            { label: '직접 수정값만 되돌리기', onClick: () => restorePart(e, 'overrides') },
                            { label: '브리프만 되돌리기', onClick: () => restorePart(e, 'brief') },
                          ]}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
