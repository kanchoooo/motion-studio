// The folder tree on the home screen: 최근 작업, 프로젝트 (the top) and its folders, then
// the saved templates. Project cards can be dropped on a folder to move them there.
import { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Folder, FolderOpen, FolderPlus, Home as HomeIcon, LayoutTemplate, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { ProjectSummary } from '@shared/project'
import { NameModal } from '../../components/NameModal'
import { Menu } from '../../components/ui'
import { studio, useStore } from '../../store'
import { childrenOf, depthOf, folderName, parentOf, RECENT, within } from './folders'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** a project card dropped on a folder */
export async function dropProject(e: React.DragEvent, to: string, projects: ProjectSummary[], move: (p: ProjectSummary, to: string) => Promise<void>) {
  e.preventDefault()
  const path = e.dataTransfer.getData('application/x-ms-project')
  const p = projects.find((x) => x.path === path)
  if (p && p.folder !== to) await move(p, to)
}

export function FolderTree({ current, onSelect, onUseTemplate }: { current: string; onSelect(rel: string): void; onUseTemplate(id: string): void }) {
  const { projects, folders, templates, refreshProjects, toast } = useStore()
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ms-home-folded') ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const [menu, setMenu] = useState<string | null>(null)
  const [naming, setNaming] = useState<null | { kind: 'new'; parent: string } | { kind: 'rename'; rel: string } | { kind: 'template'; id: string; name: string }>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  const fold = (rel: string) => {
    const next = folded.includes(rel) ? folded.filter((f) => f !== rel) : [...folded, rel]
    setFolded(next)
    try {
      localStorage.setItem('ms-home-folded', JSON.stringify(next))
    } catch {
      /* private window */
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

  const dropProps = (rel: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes('application/x-ms-project')) return
      e.preventDefault()
      setDropOn(rel)
    },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: React.DragEvent) => {
      setDropOn(null)
      void dropProject(e, rel, projects, move)
    },
  })

  const count = (rel: string) => projects.filter((p) => within(p.folder, rel)).length

  const row = (rel: string, label: string, icon: React.ReactNode, opts: { depth?: number; toggle?: boolean; open?: boolean; menu?: boolean; drop?: boolean; testId?: string } = {}) => (
    <div
      key={rel || 'root'}
      className="tree-row"
      data-on={current === rel ? '1' : undefined}
      data-drop={dropOn === rel ? '1' : undefined}
      style={{ paddingLeft: 8 + (opts.depth ?? 0) * 14 }}
      onClick={() => onSelect(rel)}
      {...(opts.drop ? dropProps(rel) : {})}
      data-testid={opts.testId}
      data-folder={rel}
    >
      {opts.toggle ? (
        <button
          className="tree-toggle"
          onClick={(e) => {
            e.stopPropagation()
            fold(rel)
          }}
          aria-label={opts.open ? '접기' : '펼치기'}
        >
          {opts.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span style={{ width: 16, flex: 'none' }} />
      )}
      {icon}
      <span className="ellipsis grow">{label}</span>
      {rel !== RECENT && <span className="tiny faint">{count(rel)}</span>}
      {opts.menu && (
        <button
          className="tree-more"
          title="폴더 메뉴"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(menu === rel ? null : rel)
          }}
        >
          <MoreHorizontal size={13} />
        </button>
      )}
      {menu === rel && (
        <div onClick={(e) => e.stopPropagation()}>
          <Menu
            style={{ left: 40, top: 26, width: 180 }}
            onClose={() => setMenu(null)}
            items={[
              ...(depthOf(rel) < 4 ? [{ label: '안에 새 폴더', icon: <FolderPlus size={14} />, onClick: () => setNaming({ kind: 'new', parent: rel }) }] : []),
              { label: '이름 바꾸기', icon: <Pencil size={14} />, onClick: () => setNaming({ kind: 'rename', rel }) },
              { label: 'Finder에서 보기', icon: <FolderOpen size={14} />, onClick: () => void studio.app.info().then((i) => studio.app.reveal(`${i.projectsDir}/${rel}`)) },
              {
                label: '폴더 지우기',
                icon: <Trash2 size={14} />,
                danger: true,
                onClick: async () => {
                  if (!confirm(`"${folderName(rel)}" 폴더를 휴지통으로 옮길까요?`)) return
                  try {
                    await studio.folders.remove(rel)
                    if (within(current, rel)) onSelect(parentOf(rel))
                    await refreshProjects()
                  } catch (e) {
                    toast(errText(e), 'error')
                  }
                },
              },
            ]}
          />
        </div>
      )}
    </div>
  )

  const branch = (rel: string, depth: number): React.ReactNode[] =>
    childrenOf(folders, rel).flatMap((f) => {
      const kids = childrenOf(folders, f).length > 0
      const open = !folded.includes(f)
      return [row(f, folderName(f), current === f ? <FolderOpen size={14} color="var(--accent)" /> : <Folder size={14} />, { depth, toggle: kids, open, menu: true, drop: true, testId: 'tree-folder' }), ...(kids && open ? branch(f, depth + 1) : [])]
    })

  const newParent = current === RECENT ? '' : current
  return (
    <div style={{ width: 236, flex: 'none', borderRight: '1px solid var(--border)', overflow: 'auto', padding: '14px 8px', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--surface)' }} data-testid="folder-tree">
      {row(RECENT, '최근 작업', <Clock size={14} />, { testId: 'tree-recent' })}
      {row('', '프로젝트', <HomeIcon size={14} />, { drop: true, testId: 'tree-root' })}
      {branch('', 1)}
      <button className="btn ghost sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={() => setNaming({ kind: 'new', parent: newParent })} data-testid="new-folder" title={newParent ? `${folderName(newParent)} 안에 만들어요` : '맨 위에 만들어요'}>
        <FolderPlus size={14} />
        새 폴더{newParent ? ` (${folderName(newParent)} 안)` : ''}
      </button>

      <div className="section-label" style={{ padding: '18px 8px 6px' }}>템플릿</div>
      {templates.length === 0 && <div className="tiny faint" style={{ padding: '0 8px', lineHeight: 1.6 }}>완성한 영상을 템플릿으로 저장하면 여기서 바로 새 프로젝트를 만들 수 있어요.</div>}
      {templates.map((t) => (
        <div key={t.id} className="tree-row" style={{ paddingLeft: 8 }} onClick={() => onUseTemplate(t.id)} title={`${t.name} · ${t.output.width}×${t.output.height} · ${t.output.duration}초 · 바꿀 칸 ${t.slots.length}개 — 눌러서 이 템플릿으로 새 프로젝트`} data-testid="tree-template">
          {t.cover ? <img src={`${t.url}${t.cover}`} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 3, flex: 'none' }} /> : <LayoutTemplate size={14} />}
          <span className="ellipsis grow">{t.name}</span>
          <span className="tiny faint">{t.slots.length}칸</span>
          <button
            className="tree-more"
            title="템플릿 메뉴"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(menu === `tpl:${t.id}` ? null : `tpl:${t.id}`)
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          {menu === `tpl:${t.id}` && (
            <div onClick={(e) => e.stopPropagation()}>
              <Menu
                style={{ left: 40, top: 26, width: 180 }}
                onClose={() => setMenu(null)}
                items={[
                  { label: '이름 바꾸기', icon: <Pencil size={14} />, onClick: () => setNaming({ kind: 'template', id: t.id, name: t.name }) },
                  {
                    label: '템플릿 지우기',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: async () => {
                      if (!confirm(`"${t.name}" 템플릿을 지울까요?\n이 템플릿으로 만든 프로젝트는 그대로 남아요.`)) return
                      await studio.templates.remove(t.id)
                      await refreshProjects()
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
      ))}

      {naming && (
        <NameModal
          title={naming.kind === 'new' ? (naming.parent ? `${folderName(naming.parent)} 안에 새 폴더` : '새 폴더') : naming.kind === 'rename' ? '폴더 이름 바꾸기' : '템플릿 이름 바꾸기'}
          label={naming.kind === 'new' ? '광고주나 캠페인 이름으로 만들어 두면 찾기 쉬워요. (예: 직방 브랜드 광고)' : undefined}
          initial={naming.kind === 'rename' ? folderName(naming.rel) : naming.kind === 'template' ? naming.name : ''}
          confirm={naming.kind === 'new' ? '만들기' : '바꾸기'}
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            try {
              if (naming.kind === 'new') {
                const rel = await studio.folders.create(naming.parent, name)
                await refreshProjects()
                onSelect(rel)
              } else if (naming.kind === 'rename') {
                const rel = await studio.folders.rename(naming.rel, name)
                await refreshProjects()
                if (within(current, naming.rel)) onSelect(rel + current.slice(naming.rel.length))
              } else {
                await studio.templates.rename(naming.id, name)
                await refreshProjects()
              }
            } catch (e) {
              toast(errText(e), 'error')
              throw e
            }
          }}
        />
      )}
    </div>
  )
}
