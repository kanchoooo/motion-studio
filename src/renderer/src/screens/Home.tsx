import { useEffect, useRef, useState } from 'react'
import { Clapperboard, FolderOpen, Loader2, MoreHorizontal, Pencil, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { ConnectionsModal } from '../components/ai/ConnectionsModal'
import { NameModal } from '../components/NameModal'
import { OUTPUT_PRESETS, type OutputPresetId } from '@shared/brief'
import type { ProjectSummary } from '@shared/project'
import { Menu, Modal, NumberField, relativeTime } from '../components/ui'
import { studio, useStore } from '../store'
import { AppVersion } from '../components/AppVersion'
import { ThemeSwitch } from '../components/ThemeSwitch'

export function Home() {
  const { projects, refreshProjects, openProject, go, toast, aiOpen } = useStore()
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)

  useEffect(() => {
    void refreshProjects()
    // card pictures made in the background show up as they are ready
    return studio.projects.onChanged(() => void refreshProjects())
  }, [refreshProjects])

  const rename = async (p: ProjectSummary, name: string) => {
    try {
      await studio.projects.renameAt(p.path, name)
      await refreshProjects()
      toast('이름을 바꿨어요', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const open = async (p: ProjectSummary) => {
    try {
      await openProject(p.path)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {aiOpen && <ConnectionsModal onClose={() => useStore.setState({ aiOpen: false })} />}
      {renaming && <NameModal title="프로젝트 이름 바꾸기" initial={renaming.name} confirm="바꾸기" onSubmit={(name) => rename(renaming, name)} onClose={() => setRenaming(null)} />}
      <div className="row drag" style={{ height: 'var(--titlebar)', padding: '0 16px 0 88px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <Clapperboard size={18} color="var(--accent)" />
        <div style={{ fontWeight: 700 }}>모션스튜디오</div>
        <AppVersion />
        <div className="grow" />
        <div className="row no-drag">
          <ThemeSwitch />
          <button className="btn ghost sm" onClick={() => useStore.setState({ aiOpen: true })} title="힉스필드·매그니픽·아트리스트 연결">
            <Sparkles size={14} />
            AI 연결
          </button>
          <button className="btn ghost sm" onClick={() => go('doctor')}>
            <Settings2 size={14} />
            환경 점검
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>
        <div className="row" style={{ marginBottom: 20 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <div className="h1">프로젝트</div>
            <div className="muted">브리프를 정리하고 Claude와 대화하면서 영상을 만들어요.</div>
          </div>
          <button className="btn primary lg" onClick={() => setCreating(true)}>
            <Plus size={16} />새 프로젝트
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="card empty" style={{ padding: 56 }}>
            <div className="icon">
              <Clapperboard size={22} />
            </div>
            <div className="title" style={{ color: 'var(--text)' }}>아직 프로젝트가 없어요</div>
            <div>새 프로젝트를 만들고 광고주 소재와 필수 문구를 넣어 보세요.</div>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={14} />첫 프로젝트 만들기
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {projects.filter((p) => !p.family || !projects.some((r) => r.id === p.family!.rootId)).map((p) => (
              <div key={p.id} className="card" style={{ overflow: 'hidden', cursor: 'pointer', position: 'relative' }} onClick={() => open(p)}>
                <div style={{ aspectRatio: '16 / 9', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.thumbnail ? (
                    <img src={p.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span className="faint small row" style={{ gap: 6 }}>
                      {p.hasVideo ? (
                        <>
                          <Loader2 size={13} className="spin" />
                          미리보기 만드는 중
                        </>
                      ) : (
                        '아직 영상이 없어요'
                      )}
                    </span>
                  )}
                </div>
                <div className="row" style={{ padding: '10px 12px' }}>
                  <div className="col grow" style={{ gap: 2 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</div>
                    <div className="tiny faint">
                      {p.ratio} · {p.duration}초 · {relativeTime(p.updatedAt)}
                    </div>
                    {projects.some((v) => v.family?.rootId === p.id) && (
                      <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {projects
                          .filter((v) => v.family?.rootId === p.id)
                          .map((v) => (
                            <span
                              key={v.id}
                              className={`badge${v.family!.status === 'working' ? ' accent' : ''}`}
                              style={{ cursor: 'pointer' }}
                              title={`${v.width}×${v.height} · 기준: ${v.family!.basedOn}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void open(v)
                              }}
                            >
                              {v.family!.label}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-btn"
                    title="더보기"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenu(menu === p.id ? null : p.id)
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
                {menu === p.id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu
                      style={{ right: 8, bottom: 48 }}
                      onClose={() => setMenu(null)}
                      items={[
                        { label: '이름 바꾸기', icon: <Pencil size={14} />, onClick: () => setRenaming(p) },
                        { label: '폴더에서 보기', icon: <FolderOpen size={14} />, onClick: () => studio.app.reveal(p.path) },
                        {
                          label: '휴지통으로 이동',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: async () => {
                            if (!confirm(`"${p.name}" 프로젝트를 휴지통으로 옮길까요?\n휴지통에서 다시 꺼낼 수 있어요.`)) return
                            await studio.projects.remove(p.path)
                            void refreshProjects()
                          },
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewProject({ onClose }: { onClose: () => void }) {
  const { toast, openProject } = useStore()
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<OutputPresetId>('youtube-16x9')
  const [duration, setDuration] = useState(15)
  const [busy, setBusy] = useState(false)

  const inFlight = useRef(false)
  const create = async () => {
    // Enter while finishing a Hangul syllable can fire twice (a ref, not state: both fire in the same tick)
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const p = await studio.projects.create({ name: name.trim() || '새 프로젝트', presetId: preset, duration })
      onClose()
      await openProject(p.path)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
      inFlight.current = false
    }
  }

  return (
    <Modal
      title="새 프로젝트"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={busy} onClick={create}>
            만들기
          </button>
        </>
      }
    >
      <div className="field">
        <label>프로젝트 이름</label>
        <input className="input" autoFocus placeholder="예: 봄 시즌 신제품 15초" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()} />
      </div>
      <div className="field">
        <label>화면 비율</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {OUTPUT_PRESETS.map((p) => {
            const on = p.id === preset
            const w = p.width >= p.height ? 56 : (56 * p.width) / p.height
            const h = p.width >= p.height ? (56 * p.height) / p.width : 56
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className="card"
                style={{
                  padding: '14px 8px 10px',
                  cursor: 'pointer',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{ height: 60, display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: w, height: h, border: `2px solid ${on ? 'var(--accent)' : 'var(--text-3)'}`, borderRadius: 4 }} />
                </div>
                <div style={{ fontWeight: 650 }}>{p.ratio}</div>
                <div className="tiny muted" style={{ textAlign: 'center' }}>{p.label}</div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="field" style={{ maxWidth: 200 }}>
        <label>길이</label>
        <NumberField value={duration} onChange={setDuration} label="⟷" unit="초" min={1} max={180} />
        <div className="hint">브리프에서 언제든 바꿀 수 있어요.</div>
      </div>
    </Modal>
  )
}
