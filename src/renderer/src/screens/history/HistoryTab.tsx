import { useEffect, useState } from 'react'
import { Bookmark, Bot, Columns2, FolderOpen, HardDrive, MoreHorizontal, Play, RotateCcw, Sparkles, Star, Trash2, User } from 'lucide-react'
import type { HistoryEntry, RenderRecord } from '@shared/project'
import { formatBytes, Menu, Modal, relativeTime } from '../../components/ui'
import { CompareModal } from './CompareModal'
import { StorageModal } from './StorageModal'
import { studio, useStore } from '../../store'

const ACTOR = {
  designer: { icon: User, label: '디자이너', color: 'var(--accent)' },
  claude: { icon: Bot, label: 'Claude', color: 'var(--success)' },
  app: { icon: Sparkles, label: '자동', color: 'var(--text-3)' },
}

export function HistoryTab() {
  const { project, historyNonce, toast, setProject, setTab } = useStore()
  const pid = project!.meta.id
  const [renders, setRenders] = useState<RenderRecord[]>([])
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [base, setBase] = useState('')
  const [playing, setPlaying] = useState<RenderRecord | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'starred' | 'versions'>('all')
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [storage, setStorage] = useState(false)
  const [usage, setUsage] = useState<number | null>(null)

  const load = async () => {
    const [r, h, b] = await Promise.all([studio.renders.list(pid), studio.history.list(pid), studio.projects.fileUrl(pid, '')])
    setRenders(r)
    setEntries(h)
    setBase(b)
    void studio.projects.diskUsage(pid).then((u) => setUsage(u.total))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, historyNonce])

  const restore = async (entryId: string, label: string) => {
    if (!confirm(`"${label}" 상태로 되돌릴까요?\n지금 상태도 이력에 남아서 언제든 다시 돌아올 수 있어요.`)) return
    try {
      setProject(await studio.history.restore(pid, entryId))
      toast('되돌렸어요. 편집 화면에서 확인해 보세요.', 'success')
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const restorePart = async (entryId: string, scope: 'composition' | 'overrides' | 'brief', label: string) => {
    const what = { composition: '영상', overrides: '직접 수정값', brief: '브리프' }[scope]
    if (!confirm(`"${label}" 시점의 ${what}만 되돌릴까요?\n나머지는 지금 상태 그대로 두고, 지금 상태도 이력에 남아요.`)) return
    setProject(await studio.history.restorePartial(pid, entryId, scope))
    toast(`${what}만 되돌렸어요`, 'success')
    void load()
  }

  const toggleStar = async (r: RenderRecord) => {
    await studio.renders.update(pid, r.id, { starred: !r.starred })
    void load()
  }

  const shown = entries.filter((e) => filter === 'all' || (filter === 'starred' ? e.starred : !!e.versionName))

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 32px 80px' }} className="col">
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <div className="h2">결과물</div>
            <div className="muted small">내보낸 영상이 모두 보관돼요. 이전 결과물이 더 마음에 들면 그 상태로 되돌릴 수 있어요.</div>
          </div>
          <button className="btn ghost" onClick={() => setStorage(true)} title="저장 공간 관리">
            <HardDrive size={14} />
            {usage != null ? formatBytes(usage) : '용량'}
          </button>
          {renders.length > 1 && (
            <button
              className={`btn${comparing ? ' primary' : ''}`}
              onClick={() => {
                setComparing(!comparing)
                setPicked([])
              }}
            >
              <Columns2 size={14} />
              {comparing ? `비교할 결과물 ${picked.length}/2` : '나란히 비교'}
            </button>
          )}
          <button className="btn" disabled={saving} onClick={async () => {
            const name = prompt('이 상태를 어떤 이름으로 저장할까요?', '광고주 1차 시안')
            if (!name?.trim()) return
            setSaving(true)
            await studio.history.saveVersion(pid, name.trim())
            setSaving(false)
            toast(`"${name.trim()}"(으)로 저장했어요`, 'success')
            void load()
          }}>
            <Bookmark size={14} />
            지금 상태 저장
          </button>
        </div>

        {renders.length === 0 ? (
          <div className="card empty">
            <div>아직 내보낸 영상이 없어요. 오른쪽 위 <b>내보내기</b>로 첫 결과물을 만들어 보세요.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
            {renders.map((r) => (
              <div key={r.id} className="card" style={{ overflow: 'hidden', position: 'relative', borderColor: picked.includes(r.id) ? 'var(--accent)' : undefined, boxShadow: picked.includes(r.id) ? '0 0 0 2px var(--accent)' : undefined }}>
                <div
                  onClick={() => {
                    if (!comparing) return setPlaying(r)
                    setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id].slice(-2)))
                  }}
                  style={{ aspectRatio: '16 / 9', background: 'var(--canvas)', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {r.thumbnail && base ? <img src={`${base}${r.thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Play size={22} color="var(--text-3)" />}
                  {r.versionName && <span className="badge accent" style={{ position: 'absolute', left: 8, top: 8 }}>{r.versionName}</span>}
                </div>
                <div className="row" style={{ padding: '8px 10px' }}>
                  <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <div className="small ellipsis" style={{ fontWeight: 600 }} title={r.fileName}>{r.fileName}</div>
                    <div className="tiny faint">
                      {relativeTime(r.createdAt)} · {r.width}×{r.height} · {r.duration.toFixed(1)}초{r.bytes ? ` · ${formatBytes(r.bytes)}` : ''}
                    </div>
                  </div>
                  <button className="icon-btn" title="별표" onClick={() => toggleStar(r)}>
                    <Star size={15} fill={r.starred ? 'var(--warning)' : 'none'} color={r.starred ? 'var(--warning)' : 'currentColor'} />
                  </button>
                  <button className="icon-btn" onClick={() => setMenu(menu === r.id ? null : r.id)}>
                    <MoreHorizontal size={15} />
                  </button>
                </div>
                {menu === r.id && (
                  <Menu
                    style={{ right: 8, bottom: 46 }}
                    onClose={() => setMenu(null)}
                    items={[
                      { label: '재생', icon: <Play size={14} />, onClick: () => setPlaying(r) },
                      { label: '이 결과물 상태로 되돌리기', icon: <RotateCcw size={14} />, onClick: () => restore(r.historyId, r.versionName ?? r.fileName) },
                      { label: '폴더에서 보기', icon: <FolderOpen size={14} />, onClick: () => studio.app.reveal(`${project!.path}/${r.file}`) },
                      {
                        label: '삭제',
                        icon: <Trash2 size={14} />,
                        danger: true,
                        onClick: async () => {
                          if (!confirm(`${r.fileName}을(를) 삭제할까요?`)) return
                          await studio.renders.remove(pid, r.id)
                          void load()
                        },
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 28, marginBottom: 6 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <div className="h2">작업 이력</div>
            <div className="muted small">Claude의 작업, 직접 수정, 브리프 변경이 자동으로 기록돼요.</div>
          </div>
          <div className="seg">
            {(['all', 'versions', 'starred'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {{ all: '전체', versions: '저장한 버전', starred: '별표' }[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: 4 }}>
          {shown.length === 0 && <div className="small muted" style={{ padding: 16 }}>표시할 이력이 없어요.</div>}
          {shown.map((e, i) => {
            const a = ACTOR[e.actor] ?? ACTOR.app
            const Icon = a.icon
            return (
              <div key={e.id} className="row" style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 'none', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  <Icon size={14} color={a.color} />
                </div>
                {e.thumbnail && base && <img src={`${base}${e.thumbnail}`} style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4, flex: 'none' }} />}
                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    {e.versionName && <span className="badge accent">{e.versionName}</span>}
                    <span className="small ellipsis">{e.summary}</span>
                  </div>
                  <div className="tiny faint">
                    {a.label} · {relativeTime(e.at)}
                    {i === 0 && filter === 'all' ? ' · 현재 상태' : ''}
                  </div>
                </div>
                <button className="icon-btn" title="별표" onClick={async () => {
                  await studio.history.star(pid, e.id, !e.starred)
                  void load()
                }}>
                  <Star size={14} fill={e.starred ? 'var(--warning)' : 'none'} color={e.starred ? 'var(--warning)' : 'currentColor'} />
                </button>
                {!(i === 0 && filter === 'all') && (
                  <div style={{ position: 'relative' }} className="row">
                    <button className="btn sm" onClick={() => restore(e.id, e.versionName ?? e.summary)}>
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
                          { label: '영상(Claude 작업)만 되돌리기', onClick: () => restorePart(e.id, 'composition', e.versionName ?? e.summary) },
                          { label: '직접 수정값만 되돌리기', onClick: () => restorePart(e.id, 'overrides', e.versionName ?? e.summary) },
                          { label: '브리프만 되돌리기', onClick: () => restorePart(e.id, 'brief', e.versionName ?? e.summary) },
                        ]}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {comparing && picked.length === 2 && (
        <CompareModal
          a={renders.find((r) => r.id === picked[0])!}
          b={renders.find((r) => r.id === picked[1])!}
          base={base}
          onClose={() => {
            setPicked([])
            setComparing(false)
          }}
          onRestore={(r) => restore(r.historyId, r.versionName ?? r.fileName)}
        />
      )}
      {storage && (
        <StorageModal
          renders={renders}
          onClose={() => {
            setStorage(false)
            void load()
          }}
        />
      )}
      {playing && (
        <Modal title={playing.fileName} onClose={() => setPlaying(null)} width={960}>
          <video src={`${base}${playing.file}`} controls autoPlay style={{ width: '100%', borderRadius: 8, background: '#000' }} />
          <div className="row">
            <textarea
              className="textarea grow"
              rows={2}
              defaultValue={playing.note}
              placeholder="메모 (예: 광고주가 좋아한 버전)"
              onBlur={async (ev) => {
                await studio.renders.update(pid, playing.id, { note: ev.target.value })
                void load()
              }}
            />
          </div>
          <div className="row">
            <button className="btn" onClick={() => studio.app.reveal(`${project!.path}/${playing.file}`)}>
              <FolderOpen size={14} />
              폴더에서 보기
            </button>
            <div className="grow" />
            <button className="btn primary" onClick={async () => {
              await restore(playing.historyId, playing.versionName ?? playing.fileName)
              setPlaying(null)
              setTab('editor')
            }}>
              <RotateCcw size={14} />
              이 결과물 상태로 되돌리기
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
