import { useEffect, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowUpLeft, Box, Eye, EyeOff, Image as ImageIcon, Layers, Lock, Redo2, RotateCcw, Type, Undo2 } from 'lucide-react'
import { FontSelect } from '../../components/FontSelect'
import { ColorField, NumberField, Segmented } from '../../components/ui'
import { useStore } from '../../store'
import { useEditor } from './editorStore'
import { useEditLocked } from './editLock'
import { MotionPanel } from './MotionPanel'
import { MultiEditor } from './MultiEditor'
import { lastSaved, rgbToHex, useOverrides } from './overrides'
import { SoundPanel } from './SoundPanel'

const ICON: Record<string, typeof Type> = { text: Type, image: ImageIcon, shape: Box, video: ImageIcon, group: Layers }

export function Inspector() {
  const { project, fonts, loadFonts } = useStore()
  const { elements, selected, selection, panel, select } = useEditor()
  const { value: ov, load, past, future, undo, redo } = useOverrides()
  const sel = elements.find((e) => e.id === selected)
  const many = selection.length > 1
  const locked = useEditLocked()

  useEffect(() => {
    // take the saved overrides unless the designer has unsaved edits (restore, Claude turn, first open);
    // our own save coming back is skipped so the undo history survives
    if (!project || useOverrides.getState().dirty || project.overrides === lastSaved) return
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
            요소
          </button>
          <button className={panel === 'motion' ? 'on' : ''} onClick={() => useEditor.setState({ panel: 'motion' })}>
            모션
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
        {panel === 'sound' && project?.hasVideo && <SoundPanel />}
        {panel === 'motion' && project?.hasVideo && <MotionPanel />}
        {panel === 'elements' && sel && !many && (
          <div className="row" style={{ marginBottom: 4 }}>
            <button className="icon-btn" title="요소 목록 (Esc)" onClick={() => select(null)} style={{ marginLeft: -6 }}>
              ←
            </button>
            <span className="ellipsis grow" style={{ fontWeight: 650 }}>{sel.label}</span>
            {sel.parent && (
              <button className="btn ghost sm" title="이 요소를 감싸는 그룹을 골라요" onClick={() => select(sel.parent)}>
                <ArrowUpLeft size={12} />
                상위 요소
              </button>
            )}
          </div>
        )}
        {!project?.hasVideo && <div className="small muted">영상이 만들어지면 여기에서 요소와 사운드를 직접 다듬을 수 있어요.</div>}
        {panel === 'elements' && project?.hasVideo && !sel && (
          <>
            <div className="section-label">요소 · 캔버스나 아래 타임라인에서 골라도 돼요 (Shift/⌘ 클릭: 여러 개)</div>
            {elements.length === 0 && <div className="small muted">영상을 멈추면 요소 목록이 보여요.</div>}
            {elements.filter((e) => !['sfx', 'bgm', 'voice'].includes(e.type)).map((e) => {
              const Icon = ICON[e.type] ?? Box
              const edited = !!ov?.elements[e.id]
              return (
                <button
                  key={e.id}
                  className="row"
                  onClick={(ev) => select(e.id, ev.shiftKey || ev.metaKey || ev.ctrlKey)}
                  title="Shift/⌘ 클릭으로 여러 개를 함께 골라요"
                  style={{ height: 30, border: 'none', background: 'transparent', borderRadius: 6, padding: `0 8px 0 ${8 + e.depth * 14}px`, cursor: 'pointer', opacity: e.visible ? 1 : 0.45, color: 'var(--text)' }}
                >
                  <Icon size={13} color="var(--text-3)" />
                  <span className="ellipsis grow" style={{ textAlign: 'left' }}>{e.label}</span>
                  {edited && <Lock size={11} color="var(--accent)" />}
                  {!e.visible && <span className="tiny faint">안 보임</span>}
                </button>
              )
            })}
          </>
        )}
        {panel === 'elements' && (many || sel) && ov && (
          <fieldset className="lock-fieldset" disabled={locked}>
            {many ? <MultiEditor /> : sel && <ElementEditor key={sel.id} id={sel.id} fontsReady={fonts.length > 0} />}
          </fieldset>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
      <div className="section-label">{title}</div>
      {children}
    </div>
  )
}

function ElementEditor({ id }: { id: string; fontsReady: boolean }) {
  const { fonts } = useStore()
  const el = useEditor((s) => s.elements.find((e) => e.id === id))!
  const { value: ov, patchElement, resetElement } = useOverrides()
  const o = ov?.elements[id] ?? {}
  const s = o.style ?? {}
  const t = o.transform ?? {}
  const label = el.label
  const isText = el.type === 'text'
  const computedFamily = el.style.fontFamily.split(',')[0].replace(/["']/g, '').trim()
  const family = s.fontFamily ?? computedFamily
  const fam = fonts.find((f) => f.family === family || f.familyKo === family)
  const [text, setText] = useState(o.text ?? el.text ?? '')
  const textBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setText(o.text ?? el.text ?? ''), [id]) // eslint-disable-line react-hooks/exhaustive-deps
  // undo, 초기화 or Claude changed the copy: show it (unless the designer is typing right now)
  useEffect(() => {
    if (document.activeElement !== textBox.current) setText(o.text ?? el.text ?? '')
  }, [o.text, el.text]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="col" style={{ gap: 6 }}>
      {Object.keys(o).length > 0 && (
        <div className="row tiny" style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Lock size={11} />
          <span className="grow">직접 수정한 값은 Claude가 바꾸지 않아요</span>
          <button className="btn ghost sm" style={{ height: 22 }} title="이 요소의 직접 수정을 모두 되돌려요" onClick={() => resetElement(id, label)}>
            <RotateCcw size={11} />
            초기화
          </button>
        </div>
      )}

      {isText && (
        <Section title="텍스트">
          <textarea
            ref={textBox}
            className="textarea"
            rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== (o.text ?? el.text ?? '') && patchElement(id, label, { text }, ['text'])}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur()
            }}
            placeholder="문구 (⌘/Ctrl+Enter로 적용)"
            style={{ minHeight: 76, fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
          />
          <FontSelect value={family} onChange={(fontFamily) => patchElement(id, label, { style: { fontFamily } }, ['fontFamily'])} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select
              className="select"
              style={{ height: 30 }}
              value={s.fontWeight ?? el.style.fontWeight}
              onChange={(e) => patchElement(id, label, { style: { fontWeight: Number(e.target.value) } }, ['fontWeight'])}
              title="굵기"
            >
              {(fam?.weights.length ? fam.weights : [100, 200, 300, 400, 500, 600, 700, 800, 900]).map((w) => (
                <option key={w} value={w}>
                  {w} {WEIGHT_NAME[w] ?? ''}
                </option>
              ))}
            </select>
            <NumberField title="글자 크기" label="T" unit="px" value={s.fontSize ?? el.style.fontSize} min={4} max={1000} onChange={(fontSize) => patchElement(id, label, { style: { fontSize } }, ['fontSize'])} />
            <NumberField title="자간" label="자간" unit="px" value={s.letterSpacing ?? el.style.letterSpacing} min={-200} max={400} step={0.5} precision={1} onChange={(letterSpacing) => patchElement(id, label, { style: { letterSpacing } }, ['letterSpacing'])} />
            <NumberField title="행간 (글자 크기의 배수)" label="행간" value={s.lineHeight ?? Number(el.style.lineHeight.toFixed(2))} min={0.5} max={4} step={0.05} precision={2} onChange={(lineHeight) => patchElement(id, label, { style: { lineHeight } }, ['lineHeight'])} />
          </div>
          <ColorField value={s.color ?? rgbToHex(el.style.color)} onChange={(color) => patchElement(id, label, { style: { color } }, ['color'])} />
          <Segmented
            full
            value={(s.textAlign ?? (['left', 'center', 'right'].includes(el.style.textAlign) ? el.style.textAlign : 'left')) as 'left' | 'center' | 'right'}
            onChange={(textAlign) => patchElement(id, label, { style: { textAlign } }, ['textAlign'])}
            options={[
              { value: 'left', label: <AlignLeft size={14} /> },
              { value: 'center', label: <AlignCenter size={14} /> },
              { value: 'right', label: <AlignRight size={14} /> },
            ]}
          />
        </Section>
      )}

      <Section title="배치">
        {!el.movable && <div className="tiny" style={{ color: 'var(--warning)' }}>이 요소는 위치를 옮길 수 없게 만들어졌어요. Claude에게 "절대 위치로 바꿔줘"라고 요청해 주세요.</div>}
        {el.movable && !el.transformable && <div className="tiny muted">그룹 안에 줄지어 놓인 요소라 위치만 옮길 수 있어요. 크기·회전도 바꾸려면 Claude에게 "그룹 안에서 절대 위치로 바꿔줘"라고 요청해 주세요.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <NumberField title="가로 이동 (캔버스에서 드래그해도 돼요)" label="X" unit="px" value={t.x ?? 0} onChange={(x) => patchElement(id, label, { transform: { x } }, ['x'])} />
          <NumberField title="세로 이동" label="Y" unit="px" value={t.y ?? 0} onChange={(y) => patchElement(id, label, { transform: { y } }, ['y'])} />
          {el.transformable !== false && (
            <>
              <NumberField title="크기 배율" label="크기" unit="%" value={Math.round((t.scale ?? 1) * 100)} min={5} max={1000} onChange={(v) => patchElement(id, label, { transform: { scale: v / 100 } }, ['scale'])} />
              <NumberField title="회전" label="회전" unit="°" value={t.rotate ?? 0} min={-360} max={360} onChange={(rotate) => patchElement(id, label, { transform: { rotate } }, ['rotate'])} />
            </>
          )}
        </div>
      </Section>

      <Section title="움직임">
        <div className="col" style={{ gap: 6 }}>
          <div className="row tiny muted">
            <span className="grow">애니메이션 속도</span>
            <span className="mono">{(o.animSpeed ?? 1).toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={o.animSpeed ?? 1}
            onChange={(e) => useOverrides.setState({ value: { ...ov!, elements: { ...ov!.elements, [id]: { ...o, animSpeed: Number(e.target.value) } } } })}
            onPointerUp={(e) => patchElement(id, label, { animSpeed: Number((e.target as HTMLInputElement).value) }, ['animSpeed'])}
          />
          <div className="row tiny faint" style={{ justifyContent: 'space-between' }}>
            <span>느리게</span>
            <span>빠르게</span>
          </div>
          <NumberField title="등장 시점을 앞뒤로 옮겨요" label="시점" unit="초" value={o.timing?.shift ?? 0} step={0.1} precision={1} min={-10} max={10} onChange={(shift) => patchElement(id, label, { timing: { shift } }, ['shift'])} />
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => useEditor.setState({ panel: 'motion', selectedMotion: null })}>
            모션 하나하나 조정하기 →
          </button>
        </div>
      </Section>

      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => patchElement(id, label, { hidden: !o.hidden }, ['hidden'])}>
        {o.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
        {o.hidden ? '다시 보이기' : '숨기기'}
      </button>
    </div>
  )
}

const WEIGHT_NAME: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }
