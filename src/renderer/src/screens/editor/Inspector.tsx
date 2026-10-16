import { useEffect, useState } from 'react'
import { CAMERA_ID } from '@shared/overrides'
import { Circle, Contrast, Film, Image as ImageIcon, Lock, Redo2, Square, SquareDashed, Type, Undo2 } from 'lucide-react'
import { useStore } from '../../store'
import { addLayer, labelOf } from './edit'
import { useEditor, useEditorStill } from './editorStore'
import { useEditLocked } from './editLock'
import { LayerEditor } from './LayerEditor'
import { LayerList } from './LayerList'
import { MotionPanel } from './MotionPanel'
import { MultiEditor } from './MultiEditor'
import { lastSaved, useOverrides } from './overrides'
import { SoundPanel } from './SoundPanel'

/** "+ 레이어": what the designer can add by hand (Claude makes everything else) */
export const ADD_LAYER: { kind: Parameters<typeof addLayer>[0]; label: string; icon: typeof Type }[] = [
  { kind: 'text', label: '텍스트', icon: Type },
  { kind: 'rect', label: '사각형', icon: Square },
  { kind: 'ellipse', label: '원', icon: Circle },
  { kind: 'image', label: '이미지', icon: ImageIcon },
  { kind: 'video', label: '동영상', icon: Film },
  { kind: 'solid', label: '단색 배경', icon: SquareDashed },
  { kind: 'adjustment', label: '조정 레이어', icon: Contrast },
]

export function Inspector() {
  const { project, loadFonts } = useStore()
  const { elements, selected, selection, panel } = useEditorStill()
  const { value: ov, load, past, future, undo, redo } = useOverrides()
  const sel = elements.find((e) => e.id === selected)
  const many = selection.length > 1
  const locked = useEditLocked()

  useEffect(() => {
    // take the saved overrides unless the designer has unsaved edits (restore, Claude turn, first open);
    // our own save coming back — or the same edits read again from disk — is skipped so the undo history survives
    if (!project || useOverrides.getState().dirty || project.overrides === lastSaved) return
    const cur = useOverrides.getState().value
    if (cur && JSON.stringify(cur) === JSON.stringify(project.overrides)) return
    load(project.overrides)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.meta.id, project?.overrides])
  useEffect(() => {
    void loadFonts()
  }, [loadFonts])

  return (
    <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, minWidth: 0 }}>
      <div className="row" style={{ height: 40, padding: '0 10px 0 14px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div className="seg grow" style={{ marginLeft: -4 }}>
          <button className={panel === 'elements' ? 'on' : ''} onClick={() => useEditor.setState({ panel: 'elements' })}>
            레이어
          </button>
          <button className={panel === 'motion' ? 'on' : ''} onClick={() => useEditor.setState({ panel: 'motion' })}>
            Claude 모션
          </button>
          <button className={panel === 'sound' ? 'on' : ''} onClick={() => useEditor.setState({ panel: 'sound' })}>
            사운드
          </button>
        </div>
        <button className="icon-btn" title="실행 취소 (⌘Z)" disabled={!past.length || locked} onClick={undo}>
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" title="다시 실행 (⇧⌘Z)" disabled={!future.length || locked} onClick={redo}>
          <Redo2 size={15} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }} className="col">
        {locked && project?.hasVideo && (
          <div className="row tiny" style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 4 }} data-testid="inspector-locked">
            <Lock size={11} />
            <span className="grow">Claude가 작업을 마치면 수정할 수 있어요</span>
          </div>
        )}
        {project?.hasVideo && <EditsBanner />}
        {panel === 'sound' && project?.hasVideo && <SoundPanel />}
        {panel === 'motion' && project?.hasVideo && <MotionPanel />}
        {!project?.hasVideo && <div className="small muted">영상이 만들어지면 여기에서 레이어와 사운드를 에펙처럼 다듬을 수 있어요.</div>}
        {/* picking from the list works while Claude works; what changes a layer waits */}
        {panel === 'elements' && project?.hasVideo && <LayerList />}
        {panel === 'elements' && project?.hasVideo && !sel && (
          <fieldset className="lock-fieldset" disabled={locked} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="section-label">레이어 추가</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 10 }}>
              {ADD_LAYER.map(({ kind, label, icon: Icon }) => (
                <button key={kind} className="btn sm" style={{ flexDirection: 'column', height: 46, gap: 2 }} onClick={() => void addLayer(kind)} data-testid={`add-layer-${kind}`} title={`${label} 레이어 추가`}>
                  <Icon size={14} />
                  <span className="tiny">{label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {panel === 'elements' && (many || sel) && ov && (
          <fieldset className="lock-fieldset" disabled={locked}>
            {many ? <MultiEditor /> : sel && <LayerEditor key={sel.id} id={sel.id} />}
          </fieldset>
        )}
      </div>
    </div>
  )
}

/**
 * The designer's edits Claude's latest code no longer has a place for: motion edits whose tween
 * changed, and edits of a layer that disappeared (or got another id) — moved onto another layer
 * or thrown away. Nothing is dropped silently.
 */
function EditsBanner() {
  const { elements, staleMotions, ready } = useEditorStill()
  const ov = useOverrides((s) => s.value)
  const { dropMotionEdits, moveEdits } = useOverrides()
  const [open, setOpen] = useState(false)
  if (!ov || !ready || elements.length < 2) return null
  const stale = staleMotions.filter((k) => ov.motions[k])
  const here = new Set(elements.map((e) => e.id))
  const orphans = Object.keys(ov.elements).filter((id) => id !== CAMERA_ID && !here.has(id) && !ov.layers.some((l) => l.id === id) && Object.keys(ov.elements[id]).some((k) => k !== 'label'))
  if (!stale.length && !orphans.length) return null
  const targets = elements.filter((e) => !['sfx', 'bgm', 'voice', 'camera'].includes(e.type))
  return (
    <div className="col" style={{ gap: 6, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--warning) 14%, transparent)', marginBottom: 8 }} data-testid="edits-banner">
      {stale.length > 0 && (
        <div className="row tiny" style={{ gap: 6 }}>
          <span className="grow">Claude가 코드를 바꿔서 모션 조정 {stale.length}개를 적용하지 못했어요.</span>
          <button className="btn ghost sm" style={{ height: 22 }} onClick={() => dropMotionEdits(stale)} data-testid="drop-stale">
            버리기
          </button>
        </div>
      )}
      {orphans.length > 0 && (
        <>
          <div className="row tiny" style={{ gap: 6 }}>
            <span className="grow">사라진 레이어의 직접 수정 {orphans.length}개가 있어요.</span>
            <button className="btn ghost sm" style={{ height: 22 }} onClick={() => setOpen(!open)} data-testid="orphans-open">
              {open ? '접기' : '보기'}
            </button>
          </div>
          {open &&
            orphans.map((id) => (
              <div key={id} className="row tiny" style={{ gap: 6 }} data-testid={`orphan-${id}`}>
                <span className="ellipsis grow" title={id}>
                  {ov.elements[id].label ?? id}
                </span>
                <select className="select" style={{ height: 24, width: 120 }} value="" onChange={(e) => e.target.value && moveEdits(id, e.target.value)} data-testid={`orphan-move-${id}`}>
                  <option value="">다른 레이어에 붙이기…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {labelOf(t.id)}
                    </option>
                  ))}
                </select>
                <button className="btn ghost sm" style={{ height: 22 }} onClick={() => moveEdits(id, null)}>
                  버리기
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  )
}
