import { Lock, Plus, Trash2, Type } from 'lucide-react'
import { newRequiredText, type Brief, type PositionHint, type RequiredText } from '@shared/brief'
import { FontSelect } from '../../components/FontSelect'
import { POSITION_OPTIONS, TimingField } from '../../components/TimingField'
import { ColorField, Field, NumberField, Segmented, Toggle } from '../../components/ui'
import { SectionHeader } from './BriefTab'

export function TextsSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const setText = (id: string, patch: Partial<RequiredText>) => onChange({ ...brief, texts: brief.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const add = () => onChange({ ...brief, texts: [...brief.texts, newRequiredText(crypto.randomUUID())] })
  const remove = (id: string) => onChange({ ...brief, texts: brief.texts.filter((t) => t.id !== id) })

  return (
    <div className="col" style={{ gap: 16 }}>
      <SectionHeader title="필수 문구" desc="광고주가 꼭 넣어 달라고 한 문구예요. 언제, 어디에, 어떤 모양으로 나와야 하는지 정할 수 있어요." />
      {brief.texts.length === 0 && (
        <div className="card empty">
          <div className="icon">
            <Type size={20} />
          </div>
          <div>아직 필수 문구가 없어요. 심의 문구·고지문처럼 그대로 들어가야 하는 문구는 "원문 고정"을 켜 주세요.</div>
        </div>
      )}
      {brief.texts.map((t, i) => (
        <div key={t.id} className="card fade-in" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="badge accent">문구 {i + 1}</span>
            {t.locked && (
              <span className="badge warning">
                <Lock size={11} />
                원문 고정
              </span>
            )}
            <div className="grow" />
            <button className="icon-btn" title="삭제" onClick={() => remove(t.id)}>
              <Trash2 size={15} />
            </button>
          </div>
          <div className="col" style={{ gap: 14 }}>
            <textarea className="textarea" rows={2} placeholder="예: 봄 신상품 최대 20% 할인" value={t.text} onChange={(e) => setText(t.id, { text: e.target.value })} style={{ fontSize: 15 }} />
            <div className="row">
              <Toggle on={t.locked} onChange={(locked) => setText(t.id, { locked })} />
              <span className="small">원문 고정 — 한 글자도 바꾸지 않고 그대로 넣어요</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr 1fr', gap: 16 }}>
              <Field label="등장 시점">
                <TimingField value={t.timing} onChange={(timing) => setText(t.id, { timing })} duration={brief.output.duration} />
              </Field>
              <Field label="최소 노출 시간">
                <NumberField value={t.minDuration} onChange={(minDuration) => setText(t.id, { minDuration })} label="⟷" unit="초" min={0.3} max={brief.output.duration} step={0.1} precision={1} />
              </Field>
              <Field label="위치">
                <select className="select" value={t.position} onChange={(e) => setText(t.id, { position: e.target.value as PositionHint })}>
                  {POSITION_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="스타일">
              <Segmented
                value={t.style.mode}
                onChange={(mode) => setText(t.id, { style: { ...t.style, mode } })}
                options={[
                  { value: 'auto', label: 'Claude에게 맡기기' },
                  { value: 'custom', label: '직접 지정' },
                ]}
              />
            </Field>
            {t.style.mode === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1.2fr', gap: 12 }}>
                <Field label="폰트">
                  <FontSelect value={t.style.fontFamily} onChange={(fontFamily) => setText(t.id, { style: { ...t.style, fontFamily } })} />
                </Field>
                <Field label="굵기">
                  <NumberField value={t.style.fontWeight ?? 700} onChange={(fontWeight) => setText(t.id, { style: { ...t.style, fontWeight } })} label="B" min={100} max={900} step={100} />
                </Field>
                <Field label="크기">
                  <NumberField value={t.style.fontSize ?? 64} onChange={(fontSize) => setText(t.id, { style: { ...t.style, fontSize } })} label="T" unit="px" min={8} max={600} />
                </Field>
                <Field label="색상">
                  <ColorField value={t.style.color ?? '#ffffff'} onChange={(color) => setText(t.id, { style: { ...t.style, color } })} />
                </Field>
              </div>
            )}
            <Field label="메모 (선택)">
              <input className="input" placeholder="예: 화면 하단에 작게, 마지막 3초 동안 유지" value={t.note} onChange={(e) => setText(t.id, { note: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={add}>
        <Plus size={14} />
        문구 추가
      </button>
    </div>
  )
}
