// The layer list at the top of the 레이어 panel, there whether or not a layer is picked (After
// Effects' layer stack): the same order as the timeline, groups fold, a search finds a layer by its
// name, its text or its kind, and the picked layer scrolls into view. Pointing at a row outlines the
// layer on the canvas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, ChevronDown, ChevronRight, Contrast, Eye, EyeOff, Film, Image as ImageIcon, Layers, Lock, Search, Type, Unlock, Video, X } from 'lucide-react'
import { labelOf } from './edit'
import { useEditLocked } from './editLock'
import { useEditor } from './editorStore'
import { listedLayers, matchesLayer } from '@shared/layers'
import { useOverrides } from './overrides'

const ICON: Record<string, typeof Type> = { text: Type, image: ImageIcon, shape: Box, video: Film, group: Layers, adjustment: Contrast, camera: Video }
const KINDS: { id: string; label: string; types: string[] }[] = [
  { id: 'all', label: '전체', types: [] },
  { id: 'text', label: '글자', types: ['text'] },
  { id: 'image', label: '이미지', types: ['image'] },
  { id: 'shape', label: '도형', types: ['shape', 'adjustment'] },
  { id: 'video', label: '영상', types: ['video'] },
  { id: 'group', label: '그룹', types: ['group'] },
]

export function LayerList() {
  const { elements, selection, select } = useEditor()
  const ov = useOverrides((s) => s.value)
  const { patchElement, setLocked } = useOverrides()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [folded, setFolded] = useState<string[]>([])
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const locked = useEditLocked()

  const all = useMemo(() => listedLayers(elements).filter((e) => !['sfx', 'bgm', 'voice'].includes(e.type)), [elements])
  const types = KINDS.find((k) => k.id === kind)?.types ?? []
  const filtering = !!q.trim() || kind !== 'all'
  const byId = new Map(all.map((e) => [e.id, e]))
  /** a folded group hides what is inside it (a search shows every match) */
  const hiddenByFold = (id: string) => {
    for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent ?? null) if (folded.includes(p)) return true
    return false
  }
  const rows = all.filter((e) => (filtering ? (!types.length || types.includes(e.type)) && matchesLayer(e, labelOf(e.id), q) : !hiddenByFold(e.id)))
  const hasKids = (id: string) => all.some((e) => e.parent === id)

  // the picked layer is shown: its groups unfold and the row scrolls into view
  const picked = selection[selection.length - 1] ?? null
  useEffect(() => {
    if (!picked) return
    const up: string[] = []
    for (let p = byId.get(picked)?.parent; p; p = byId.get(p)?.parent ?? null) up.push(p)
    if (up.some((g) => folded.includes(g))) setFolded((f) => f.filter((g) => !up.includes(g)))
    requestAnimationFrame(() => box.current?.querySelector(`[data-row="${CSS.escape(picked)}"]`)?.scrollIntoView({ block: 'nearest' }))
  }, [picked]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="col" style={{ gap: 6, marginBottom: 10, flex: 'none' }} data-testid="layer-list">
      <div className="row" style={{ gap: 6 }}>
        <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => setOpen(!open)} title={open ? '레이어 목록 접기' : '레이어 목록 펼치기'}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="section-label grow" style={{ margin: 0 }}>
          레이어 {filtering ? `${rows.length} / ${all.length}` : all.length}
        </span>
        {open && (
          <div className="row" style={{ gap: 4, position: 'relative', width: 150 }}>
            <Search size={11} style={{ position: 'absolute', left: 7, color: 'var(--text-3)' }} />
            <input
              className="input"
              style={{ height: 24, fontSize: 11, paddingLeft: 22, paddingRight: q ? 22 : 6 }}
              placeholder="이름·글자로 찾기"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the first match, Esc clears the search
                if (e.key === 'Enter' && rows[0]) select(rows[0].id)
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQ('')
                }
              }}
              data-testid="layer-search"
            />
            {q && (
              <button className="icon-btn" style={{ position: 'absolute', right: 2, width: 18, height: 18 }} onClick={() => setQ('')} title="검색 지우기">
                <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>
      {open && (
        <>
          <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
            {KINDS.map((k) => (
              <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)} data-testid={`layer-kind-${k.id}`}>
                {k.label}
              </button>
            ))}
          </div>
          <div ref={box} style={{ maxHeight: 'min(320px, 34vh)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }} onMouseLeave={() => useEditor.setState({ peek: null })}>
            {elements.length === 0 && <div className="small muted" style={{ padding: 8 }}>영상을 멈추면 레이어 목록이 보여요.</div>}
            {elements.length > 0 && !rows.length && <div className="small muted" style={{ padding: 8 }}>찾는 레이어가 없어요.</div>}
            {rows.map((e) => {
              const Icon = ICON[e.type] ?? Box
              const o = ov?.elements[e.id]
              const label = labelOf(e.id)
              const isSel = selection.includes(e.id)
              const kids = !filtering && hasKids(e.id)
              const parentLabel = filtering && e.parent ? labelOf(e.parent) : ''
              const textHint = e.type === 'text' && e.text && !label.includes(e.text.slice(0, 8)) ? e.text : ''
              return (
                <div
                  key={e.id}
                  data-row={e.id}
                  className={`row layer-item${isSel ? ' sel' : ''}`}
                  style={{ paddingLeft: 4 + (filtering ? 0 : e.depth * 12), opacity: e.visible ? 1 : 0.5, borderRadius: 6, background: isSel ? 'var(--accent-soft)' : undefined }}
                  onMouseEnter={() => useEditor.setState({ peek: e.id })}
                  data-testid="layer-row"
                >
                  <button className="icon-btn" style={{ width: 16, height: 18, visibility: kids ? 'visible' : 'hidden' }} onClick={() => setFolded(folded.includes(e.id) ? folded.filter((x) => x !== e.id) : [...folded, e.id])} title="그룹 접기/펼치기">
                    {folded.includes(e.id) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  </button>
                  {renaming === e.id ? (
                    <input
                      autoFocus
                      className="input grow"
                      style={{ height: 22, fontSize: 12, padding: '0 4px' }}
                      defaultValue={label}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
                        if (ev.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={(ev) => {
                        const v = ev.target.value.trim()
                        if (v && v !== label) patchElement(e.id, label, { label: v }, ['label'])
                        setRenaming(null)
                      }}
                    />
                  ) : (
                    <button
                      className="row grow"
                      onClick={(ev) => select(e.id, ev.shiftKey || ev.metaKey || ev.ctrlKey)}
                      onDoubleClick={() => !locked && setRenaming(e.id)}
                      title={`${label}${e.text ? `\n${e.text}` : ''}\n클릭: 고르기 · Shift/⌘: 여러 개 · 더블클릭: 이름 바꾸기`}
                      style={{ height: 26, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text)', minWidth: 0, gap: 6, padding: 0, textDecoration: o?.deleted ? 'line-through' : undefined }}
                    >
                      <Icon size={13} color={e.designer ? 'var(--accent)' : 'var(--text-3)'} style={{ flex: 'none' }} />
                      <span className="ellipsis" style={{ textAlign: 'left', minWidth: 0 }}>{label}</span>
                      {(parentLabel || textHint) && (
                        <span className="tiny faint ellipsis" style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                          {parentLabel ? `· ${parentLabel}` : `“${textHint}”`}
                        </span>
                      )}
                    </button>
                  )}
                  <button className="icon-btn" style={{ width: 22, height: 22 }} disabled={locked} title={o?.hidden ? '보이기' : '숨기기'} onClick={() => patchElement(e.id, label, { hidden: !o?.hidden }, ['hidden'])}>
                    {o?.hidden ? <EyeOff size={12} /> : <Eye size={12} color="var(--text-3)" />}
                  </button>
                  <button className={`icon-btn${o?.locked ? ' active' : ''}`} style={{ width: 22, height: 22 }} disabled={locked} title={o?.locked ? '잠금 해제' : '잠그기'} onClick={() => setLocked([{ id: e.id, label }], !o?.locked)}>
                    {o?.locked ? <Lock size={12} /> : <Unlock size={12} color="var(--text-3)" />}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
