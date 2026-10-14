import type { Brief } from '@shared/brief'
import { MAX_STYLES, STYLES, TEMPOS, tempoOf, type StyleId, type TempoId } from '@shared/direction'
import { Field, Segmented } from '../../components/ui'
import { useStore } from '../../store'
import { BrandSection } from './BrandSection'
import { SectionHeader } from './BriefTab'

export function ToneSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  return (
    <div className="col" style={{ gap: 18 }}>
      <SectionHeader title="톤앤매너·스타일" desc="광고주 정보와 원하는 분위기를 적어 주세요. 템포와 스타일을 고르면 Claude가 그 기준으로 콘티를 짜고 검수해요." />
      <BrandSection brief={brief} onChange={onChange} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="광고주 / 브랜드">
          <input className="input" placeholder="예: 모션커피" value={brief.client} onChange={(e) => onChange({ ...brief, client: e.target.value })} />
        </Field>
        <Field label="캠페인">
          <input className="input" placeholder="예: 2027 봄 시즌 런칭" value={brief.campaign} onChange={(e) => onChange({ ...brief, campaign: e.target.value })} />
        </Field>
      </div>
      <DirectionFields brief={brief} onChange={onChange} />
      <Field label="톤앤매너" hint="분위기, 브랜드 컬러, 타깃, 피하고 싶은 것, 참고할 점 등 자유롭게 적어 주세요.">
        <textarea
          className="textarea"
          rows={10}
          placeholder={'예)\n· 밝고 경쾌하게, 20~30대 직장인 타깃\n· 브랜드 컬러: 코랄 #FF6A3D, 크림 #FFF4E6\n· 텍스트는 짧고 굵게, 리듬감 있는 컷 전환\n· 너무 과한 효과는 피하기'}
          value={brief.tone}
          onChange={(e) => onChange({ ...brief, tone: e.target.value })}
        />
      </Field>
    </div>
  )
}

/** 영상 템포 · 스타일 (both optional): numbers and design rules Claude plans and is reviewed against */
function DirectionFields({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const { toast } = useStore()
  const styles = brief.styles ?? []
  const tempo = tempoOf(brief.tempo)
  const toggle = (id: StyleId) => {
    if (styles.includes(id)) return onChange({ ...brief, styles: styles.filter((s) => s !== id) })
    if (styles.length >= MAX_STYLES) return toast(`스타일은 ${MAX_STYLES}개까지 고를 수 있어요. 하나를 빼고 골라 주세요.`, 'info')
    onChange({ ...brief, styles: [...styles, id] })
  }
  return (
    <>
      <Field label="영상 템포 (선택)" hint={tempo ? `${tempo.hint} · 박자 ${tempo.bpm[0]}~${tempo.bpm[1]} BPM` : '고르지 않으면 Claude가 톤앤매너에 맞춰 정해요.'}>
        <div data-testid="brief-tempo">
          <Segmented<TempoId | ''>
            value={brief.tempo ?? ''}
            onChange={(v) => onChange({ ...brief, tempo: v || undefined })}
            options={[{ value: '', label: 'Claude에게 맡기기' }, ...TEMPOS.map((t) => ({ value: t.id, label: t.label }))]}
          />
        </div>
      </Field>
      <Field label={`스타일 (선택, ${MAX_STYLES}개까지)`} hint="먼저 고른 것이 주 스타일이고, 두 번째는 보조로 살짝 섞어요. 고르지 않으면 Claude가 정해요.">
        <div className="style-grid" data-testid="brief-styles">
          {STYLES.map((s) => {
            const i = styles.indexOf(s.id)
            return (
              <button type="button" key={s.id} className={`style-chip${i >= 0 ? ' on' : ''}`} data-testid={`style-${s.id}`} onClick={() => toggle(s.id)}>
                <span className="row" style={{ gap: 6 }}>
                  <b className="grow">{s.label}</b>
                  {i >= 0 && <span className="badge">{i === 0 ? '주' : '보조'}</span>}
                </span>
                <span className="tiny muted">{s.desc}</span>
              </button>
            )
          })}
        </div>
      </Field>
    </>
  )
}
