// Home: the project tree. Folders on the left (plain folders inside the projects folder),
// the open folder's sub-folders and projects on the right, and the three ways to start:
// 새 프로젝트 (from scratch or from a template), 베리에이션 만들기, 템플릿 만들기.
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, ChevronRight, Clapperboard, Clock, Copy, FileDown, FolderInput, FolderOpen, LayoutTemplate, Loader2, MoreHorizontal, Pencil, Plus, Settings2, Share2, Sparkles, Trash2 } from 'lucide-react'
import { ConnectionsModal } from '../components/ai/ConnectionsModal'
import { NameModal } from '../components/NameModal'
import type { ProjectSummary } from '@shared/project'
import { Menu, relativeTime } from '../components/ui'
import { onWeb, studio, useStore } from '../store'
import { AppVersion } from '../components/AppVersion'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { FolderTree, dropProject } from './home/FolderTree'
import { childrenOf, folderName, RECENT, rememberedFolder, rememberFolder, within } from './home/folders'
import { MoveModal } from './home/MoveModal'
import { NewProjectModal } from './home/NewProjectModal'
import { TemplateCreateModal } from './templates/TemplateCreateModal'
import { VariationModal } from './variations/VariationModal'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Home() {
  const { projects, folders, refreshProjects, openProject, go, toast, aiOpen, familyNonce } = useStore()
  const [folder, setFolderState] = useState(rememberedFolder)
  const [creating, setCreating] = useState<null | { templateId?: string }>(null)
  const [varying, setVarying] = useState(false)
  const [templating, setTemplating] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const [moving, setMoving] = useState<ProjectSummary | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  const setFolder = (rel: string) => {
    setFolderState(rel)
    rememberFolder(rel)
  }

  useEffect(() => {
    void refreshProjects()
    // card pictures made in the background show up as they are ready
    return studio.projects.onChanged(() => void refreshProjects())
  }, [refreshProjects])
  // variation progress (대기 → 작업 중 → 완료) shows on the cards
  useEffect(() => {
    if (familyNonce) void refreshProjects()
  }, [familyNonce, refreshProjects])
  // a remembered folder that was removed in Finder
  useEffect(() => {
    if (folder && folder !== RECENT && folders.length && !folders.includes(folder)) setFolder('')
  }, [folder, folders])

  const rename = async (p: ProjectSummary, name: string) => {
    try {
      await studio.projects.renameAt(p.path, name)
      await refreshProjects()
      toast('이름을 바꿨어요', 'success')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  const open = async (p: ProjectSummary) => {
    try {
      await openProject(p.path)
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  const move = async (p: ProjectSummary, to: string) => {
    try {
      await studio.projects.move(p.path, to)
      await refreshProjects()
      toast(`"${p.name}"을(를) ${folderName(to)}(으)로 옮겼어요`, 'success')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  // a variation is shown on its original's card (wherever that is)
  const isShownOnRoot = (p: ProjectSummary) => !!p.family && projects.some((r) => r.id === p.family!.rootId)
  const recent = folder === RECENT
  const subFolders = recent ? [] : childrenOf(folders, folder)
  const list = useMemo(
    () => (recent ? [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((p) => !isShownOnRoot(p)).slice(0, 12) : projects.filter((p) => p.folder === folder && !isShownOnRoot(p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, folder, recent],
  )
  const crumbs = recent ? [RECENT] : ['', ...folder.split('/').filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join('/'))]
  const here = recent ? '' : folder
  /** 공유 파일 열기: a project another designer shared, into this folder (a file dropped here too) */
  const openShare = async (file?: string) => {
    try {
      const st = await studio.projects.importShare(file, here)
      if (!st) return
      await refreshProjects()
      await openProject(st.path)
      toast('공유받은 프로젝트를 열었어요. Claude가 인계 메모를 먼저 읽고 시작해요.', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault()
      }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].map((x) => studio.app.pathForFile(x)).find((x) => /\.msshare$/i.test(x))
        if (!f) return
        e.preventDefault()
        void openShare(f)
      }}
    >
      {aiOpen && <ConnectionsModal onClose={() => useStore.setState({ aiOpen: false })} />}
      {renaming && <NameModal title="프로젝트 이름 바꾸기" initial={renaming.name} confirm="바꾸기" onSubmit={(name) => rename(renaming, name)} onClose={() => setRenaming(null)} />}
      {moving && <MoveModal project={moving} onMove={(to) => move(moving, to)} onClose={() => setMoving(null)} />}
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
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <FolderTree current={folder} onSelect={setFolder} onUseTemplate={(templateId) => setCreating({ templateId })} />
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '28px 36px 60px' }} data-testid="home-main">
          <div className="row" style={{ marginBottom: 18, alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div className="col grow" style={{ gap: 4, minWidth: 260 }}>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} data-testid="breadcrumb">
                {crumbs.map((c, i) => (
                  <span key={c || 'root'} className="row" style={{ gap: 4 }}>
                    {i > 0 && <ChevronRight size={16} color="var(--text-3)" />}
                    <button
                      className={i === crumbs.length - 1 ? 'h1' : 'h2'}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: i === crumbs.length - 1 ? 'default' : 'pointer', color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--text-3)' }}
                      onClick={() => setFolder(c)}
                    >
                      {folderName(c)}
                    </button>
                  </span>
                ))}
              </div>
              <div className="muted small">
                {recent ? '최근에 고친 프로젝트예요. 폴더는 왼쪽에서 골라요.' : folder ? '이 폴더에서 새 프로젝트·베리에이션·템플릿을 만들어요. 프로젝트 카드를 왼쪽 폴더로 끌어 옮길 수 있어요.' : '브리프를 정리하고 Claude와 대화하면서 영상을 만들어요. 광고주·캠페인별로 폴더를 만들어 정리해 보세요.'}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary lg" onClick={() => setCreating({})} data-testid="new-project">
                <Plus size={16} />새 프로젝트
              </button>
              <button className="btn lg" onClick={() => setVarying(true)} disabled={!projects.some((p) => p.hasVideo)} title="완성한 영상으로 다른 비율·길이 버전을 한꺼번에 만들어요" data-testid="new-variation">
                <Copy size={15} />
                베리에이션 만들기
              </button>
              <button className="btn lg" onClick={() => setTemplating(true)} disabled={!projects.some((p) => p.hasVideo)} title="완성한 영상에서 바꿀 글자·이미지·내레이션을 골라 템플릿으로 저장해요" data-testid="new-template">
                <LayoutTemplate size={15} />
                템플릿 만들기
              </button>
              <button className="btn lg" onClick={() => void openShare()} title="다른 디자이너가 보낸 공유 파일(.msshare)을 열어 이어서 작업해요 (이 화면에 끌어 놓아도 돼요)" data-testid="open-share">
                <FileDown size={15} />
                공유 파일 열기
              </button>
            </div>
          </div>

          {subFolders.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 18 }}>
              {subFolders.map((f) => {
                const inside = projects.filter((p) => within(p.folder, f)).length
                return (
                  <div
                    key={f}
                    className="card row"
                    style={{ padding: '12px 14px', cursor: 'pointer', gap: 10, borderColor: dropOn === f ? 'var(--accent)' : undefined, background: dropOn === f ? 'var(--accent-soft)' : undefined }}
                    onClick={() => setFolder(f)}
                    onDragOver={(e) => {
                      if (![...e.dataTransfer.types].includes('application/x-ms-project')) return
                      e.preventDefault()
                      setDropOn(f)
                    }}
                    onDragLeave={() => setDropOn(null)}
                    onDrop={(e) => {
                      setDropOn(null)
                      void dropProject(e, f, projects, move)
                    }}
                    data-testid="folder-card"
                  >
                    <FolderOpen size={20} color="var(--accent)" />
                    <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
                      <span className="ellipsis" style={{ fontWeight: 650 }}>{folderName(f)}</span>
                      <span className="tiny faint">프로젝트 {inside}개</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {list.length === 0 && subFolders.length === 0 ? (
            <div className="card empty" style={{ padding: 56 }}>
              <div className="icon">
                <Clapperboard size={22} />
              </div>
              <div className="title" style={{ color: 'var(--text)' }}>{recent ? '아직 프로젝트가 없어요' : '이 폴더는 비어 있어요'}</div>
              <div>새 프로젝트를 만들고 광고주 소재와 필수 문구를 넣어 보세요.</div>
              <button className="btn primary" onClick={() => setCreating({})}>
                <Plus size={14} />
                {folder && !recent ? `${folderName(folder)}에 새 프로젝트` : '첫 프로젝트 만들기'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {list.map((p) => (
                <div
                  key={p.id}
                  className="card"
                  style={{ overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
                  onClick={() => open(p)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-ms-project', p.path)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  data-testid="project-card"
                >
                  <div style={{ aspectRatio: '16 / 9', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.thumbnail ? (
                      <img src={p.thumbnail} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
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
                    <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="tiny faint ellipsis">
                        {p.ratio} · {p.duration}초 · {relativeTime(p.updatedAt)}
                        {recent && p.folder ? ` · ${folderName(p.folder)}` : ''}
                        {p.template ? ` · 템플릿 ${p.template.name}` : ''}
                      </div>
                      {projects.some((v) => v.family?.rootId === p.id) && (
                        <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {projects
                            .filter((v) => v.family?.rootId === p.id)
                            .map((v) => {
                              const st = v.family!.status
                              return (
                                <span
                                  key={v.id}
                                  className={`badge${st === 'working' || st === 'queued' ? ' accent' : st === 'error' ? ' danger' : ''}`}
                                  style={{ cursor: 'pointer' }}
                                  title={`${v.width}×${v.height} · 기준: ${v.family!.basedOn}${st === 'queued' ? ' · 차례를 기다리는 중' : st === 'working' ? ' · Claude 작업 중' : st === 'error' ? ' · 멈췄어요. 열어서 다시 요청해 주세요' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void open(v)
                                  }}
                                  data-testid="variation-badge"
                                >
                                  {st === 'working' || st === 'queued' ? <Loader2 size={10} className="spin" /> : st === 'error' ? <AlertCircle size={10} /> : <Check size={10} />}
                                  {v.family!.label}
                                </span>
                              )
                            })}
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
                          { label: '다른 폴더로 옮기기', icon: <FolderInput size={14} />, onClick: () => setMoving(p) },
                          ...(onWeb ? [] : [{ label: '폴더에서 보기', icon: <FolderOpen size={14} />, onClick: () => studio.app.reveal(p.path) }]),
                          {
                            label: '공유 파일로 내보내기',
                            icon: <Share2 size={14} />,
                            onClick: async () => {
                              await openProject(p.path)
                              useStore.setState({ shareOpen: true })
                            },
                          },
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
          {recent && projects.length > 12 && (
            <div className="tiny faint row" style={{ marginTop: 14, gap: 6 }}>
              <Clock size={12} />
              최근 12개만 보여요. 나머지는 왼쪽 폴더에서 찾아 주세요.
            </div>
          )}
        </div>
      </div>
      {creating && <NewProjectModal folder={here} templateId={creating.templateId} onClose={() => setCreating(null)} />}
      {varying && <VariationModal folder={here} onClose={() => setVarying(false)} />}
      {templating && <TemplateCreateModal folder={here} onClose={() => setTemplating(false)} />}
    </div>
  )
}

