import type { Brief } from '@shared/brief'
import { Field } from '../../components/ui'
import { BrandSection } from './BrandSection'
import { SectionHeader } from './BriefTab'

export function ToneSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  return (
    <div className="col" style={{ gap: 18 }}>
      <SectionHeader title="톤앤매너·메모" desc="광고주 정보와 원하는 분위기를 적어 주세요. 자세할수록 Claude가 방향을 잘 잡아요." />
      <BrandSection brief={brief} onChange={onChange} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="광고주 / 브랜드">
          <input className="input" placeholder="예: 모션커피" value={brief.client} onChange={(e) => onChange({ ...brief, client: e.target.value })} />
        </Field>
        <Field label="캠페인">
          <input className="input" placeholder="예: 2027 봄 시즌 런칭" value={brief.campaign} onChange={(e) => onChange({ ...brief, campaign: e.target.value })} />
        </Field>
      </div>
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
