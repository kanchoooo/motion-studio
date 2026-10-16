// Several elements picked at once (Shift/⌘ click): the first one picked is the
// reference whose values are shown; a change goes to every picked element.
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Copy,
  Eye,
  EyeOff,
  Lock,
  RotateCcw,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import { valueAt } from '@shared/overrides'
import type { ElementOverride } from '@shared/overrides'
import { FontSelect } from '../../components/FontSelect'
import { ColorField, NumberField, Segmented } from '../../components/ui'
import { useStore } from '../../store'
import { align, deleteSelection, distribute, duplicateSelection, isLocked, labelOf, setProps, toggleLockSelection } from './edit'
import { useEditor, useEditorStill } from './editorStore'
import { rgbToHex, useOverrides } from './overrides'
import type { RuntimeElement } from './player'

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

export function MultiEditor() {
  const { fonts } = useStore()
  const { elements, selection, select } = useEditorStill()
  const { value: ov, patchElements } = useOverrides()
  const picked = selection.map((id) => elements.find((e) => e.id === id)).filter((e): e is RuntimeElement => !!e).map((e) => ({ ...e, label: labelOf(e.id) }))
  // locked layers are shown but not changed (their text styles, 초기화)
  const texts = picked.filter((e) => e.type === 'text' && !isLocked(e.id))
  const scalable = picked.filter((e) => e.movable && e.transformable !== false)
  const o = (id: string) => ov?.elements[id] ?? {}

  // what each element shows now: the designer's value, else what the composition computed
  const style = (e: RuntimeElement) => {
    const s = o(e.id).style ?? {}
    return {
      fontFamily: s.fontFamily ?? e.style.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fontWeight: s.fontWeight ?? e.style.fontWeight,
      fontSize: s.fontSize ?? e.style.fontSize,
      letterSpacing: s.letterSpacing ?? e.style.letterSpacing,
      lineHeight: s.lineHeight ?? Number(e.style.lineHeight.toFixed(2)),
      color: s.color ?? rgbToHex(e.style.color),
      textAlign: s.textAlign ?? (['left', 'center', 'right'].includes(e.style.textAlign) ? e.style.textAlign : 'left'),
    }
  }
  const ref = texts[0]
  const refStyle = ref ? style(ref) : null
  /** true when the picked text elements do not all have the same value */
  const mixed = (k: keyof NonNullable<typeof refStyle>) => texts.some((e) => String(style(e)[k]) !== String(refStyle?.[k]))
  const applyText = (patch: NonNullable<ElementOverride['style']>, key: string) =>
    patchElements(texts.map((e) => ({ id: e.id, label: e.label, patch: { style: patch } })), [key])

  const time = useEditor((s) => s.time)
  const allHidden = picked.every((e) => o(e.id).hidden)
  const fam = refStyle && fonts.find((f) => f.family === refStyle.fontFamily || f.familyKo === refStyle.fontFamily)

  return (
    <div className="col" style={{ gap: 10 }} data-testid="multi-editor">
      <div className="row" style={{ marginBottom: 2 }}>
        <span className="grow" style={{ fontWeight: 650 }}>요소 {picked.length}개 선택</span>
        <button className="btn ghost sm" onClick={() => select(null)} title="선택 해제 (Esc)">
          선택 해제
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {picked.map((e, i) => (
          <span key={e.id} className={`badge${i === 0 ? ' accent' : ''}`} style={{ gap: 4 }} title={i === 0 ? '기준 요소: 이 요소의 값을 보여 줘요' : undefined}>
            {e.label}
            {i === 0 && ' · 기준'}
            <button className="icon-btn" style={{ width: 14, height: 14 }} title="선택에서 빼기" onClick={() => select(e.id, true)}>
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="tiny muted">값을 바꾸면 고른 레이어에 모두 같게 들어가요. 캔버스에서 끌면 함께 움직여요. (Shift/⌘ 클릭으로 더하거나 빼요)</div>

      <div className="col" style={{ gap: 6, paddingBottom: 12, borderBottom: '1px solid var(--border)' }} data-testid="align-tools">
        <div className="section-label">정렬 · 분배</div>
        <div className="row" style={{ gap: 2, flexWrap: 'wrap' }}>
          <button className="icon-btn" title="왼쪽 맞춤" onClick={() => align('left')} data-testid="align-left">
            <AlignStartVertical size={15} />
          </button>
          <button className="icon-btn" title="가로 가운데 맞춤" onClick={() => align('hcenter')}>
            <AlignCenterVertical size={15} />
          </button>
          <button className="icon-btn" title="오른쪽 맞춤" onClick={() => align('right')}>
            <AlignEndVertical size={15} />
          </button>
          <button className="icon-btn" title="위쪽 맞춤" onClick={() => align('top')} data-testid="align-top">
            <AlignStartHorizontal size={15} />
          </button>
          <button className="icon-btn" title="세로 가운데 맞춤" onClick={() => align('vcenter')}>
            <AlignCenterHorizontal size={15} />
          </button>
          <button className="icon-btn" title="아래쪽 맞춤" onClick={() => align('bottom')}>
            <AlignEndHorizontal size={15} />
          </button>
          <span style={{ width: 8 }} />
          <button className="icon-btn" title="가로 간격 똑같이 (3개 이상)" disabled={picked.length < 3} onClick={() => distribute('h')} data-testid="distribute-h">
            <AlignHorizontalDistributeCenter size={15} />
          </button>
          <button className="icon-btn" title="세로 간격 똑같이 (3개 이상)" disabled={picked.length < 3} onClick={() => distribute('v')}>
            <AlignVerticalDistributeCenter size={15} />
          </button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={duplicateSelection} title="복제 (⌘D)">
            <Copy size={12} />
            복제
          </button>
          <button className="btn sm" onClick={deleteSelection} title="삭제 (Delete)">
            <Trash2 size={12} />
            삭제
          </button>
          <button className="btn sm" onClick={toggleLockSelection} title="잠금 (⌘L)">
            {picked.every((e) => o(e.id).locked) ? <Unlock size={12} /> : <Lock size={12} />}
            {picked.every((e) => o(e.id).locked) ? '잠금 해제' : '잠그기'}
          </button>
        </div>
      </div>

      {ref && refStyle && (
        <div className="col" style={{ gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="section-label">텍스트 {texts.length < picked.length ? `· 글자 요소 ${texts.length}개에 적용` : ''}</div>
          <Mixed on={mixed('fontFamily')}>
            <FontSelect value={refStyle.fontFamily} onChange={(fontFamily) => applyText({ fontFamily }, 'fontFamily')} />
          </Mixed>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Mixed on={mixed('fontWeight')}>
              <select className="select" style={{ height: 30, width: '100%' }} value={refStyle.fontWeight} title="굵기" onChange={(e) => applyText({ fontWeight: Number(e.target.value) }, 'fontWeight')}>
                {(fam?.weights.length ? fam.weights : WEIGHTS).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Mixed>
            <Mixed on={mixed('fontSize')}>
              <NumberField title="글자 크기" label="T" unit="px" value={refStyle.fontSize} min={4} max={1000} onChange={(fontSize) => applyText({ fontSize }, 'fontSize')} />
            </Mixed>
            <Mixed on={mixed('letterSpacing')}>
              <NumberField title="자간" label="자간" unit="px" value={refStyle.letterSpacing} min={-200} max={400} step={0.5} precision={1} onChange={(letterSpacing) => applyText({ letterSpacing }, 'letterSpacing')} />
            </Mixed>
            <Mixed on={mixed('lineHeight')}>
              <NumberField title="행간 (글자 크기의 배수)" label="행간" value={refStyle.lineHeight} min={0.5} max={4} step={0.05} precision={2} onChange={(lineHeight) => applyText({ lineHeight }, 'lineHeight')} />
            </Mixed>
          </div>
          <Mixed on={mixed('color')}>
            <ColorField value={refStyle.color} onChange={(color) => applyText({ color }, 'color')} />
          </Mixed>
          <Mixed on={mixed('textAlign')}>
            <Segmented
              full
              value={refStyle.textAlign as 'left' | 'center' | 'right'}
              onChange={(textAlign) => applyText({ textAlign }, 'textAlign')}
              options={[
                { value: 'left', label: <AlignLeft size={14} /> },
                { value: 'center', label: <AlignCenter size={14} /> },
                { value: 'right', label: <AlignRight size={14} /> },
              ]}
            />
          </Mixed>
        </div>
      )}

      {scalable.length > 0 && (
        <div className="col" style={{ gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="section-label">배치 {scalable.length < picked.length ? `· ${scalable.length}개에 적용` : ''}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumberField
              title="크기 배율"
              label="크기"
              unit="%"
              value={Math.round(valueAt(o(scalable[0].id), 'scaleX', time) * 100)}
              min={1}
              max={1000}
              onChange={(v) => setProps(scalable.map((e) => ({ id: e.id, values: { scaleX: v / 100, scaleY: v / 100 } })), ['scaleX'])}
            />
            <NumberField
              title="회전"
              label="회전"
              unit="°"
              value={valueAt(o(scalable[0].id), 'rotate', time)}
              min={-360}
              max={360}
              onChange={(rotate) => setProps(scalable.map((e) => ({ id: e.id, values: { rotate } })), ['rotate'])}
            />
            <NumberField
              title="불투명도"
              label="불투명"
              unit="%"
              value={Math.round(valueAt(o(scalable[0].id), 'opacity', time) * 100)}
              min={0}
              max={100}
              onChange={(p) => setProps(scalable.map((e) => ({ id: e.id, values: { opacity: p / 100 } })), ['opacity'])}
            />
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => patchElements(picked.map((e) => ({ id: e.id, label: e.label, patch: { hidden: !allHidden } })), ['hidden'])}>
          {allHidden ? <Eye size={13} /> : <EyeOff size={13} />}
          {allHidden ? '모두 다시 보이기' : '모두 숨기기'}
        </button>
        <button
          className="btn sm ghost"
          disabled={!picked.some((e) => ov?.elements[e.id])}
          title="고른 요소의 직접 수정을 모두 되돌려요"
          onClick={() => {
            const st = useOverrides.getState()
            for (const e of picked) if (!isLocked(e.id)) st.resetElement(e.id, e.label)
          }}
        >
          <RotateCcw size={12} />
          초기화
        </button>
      </div>
    </div>
  )
}

/** marks a control whose value differs between the picked elements */
function Mixed({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>
  return (
    <div className="col" style={{ gap: 2 }}>
      {children}
      <span className="tiny" style={{ color: 'var(--warning)' }}>서로 달라요 · 기준 요소 값을 보여 줘요</span>
    </div>
  )
}
