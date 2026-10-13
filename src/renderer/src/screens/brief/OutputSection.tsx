import { FORMAT_LABELS, FPS_OPTIONS, OUTPUT_PRESETS, type Brief, type OutputFormat, type OutputSpec, type SafeZoneId } from '@shared/brief'
import { ColorField, Field, NumberField, Segmented, Toggle } from '../../components/ui'
import { SectionHeader } from './BriefTab'

const SAFE_ZONES: { id: SafeZoneId; label: string }[] = [
  { id: 'none', label: '표시 안 함' },
  { id: 'youtube', label: '유튜브·TV (가장자리 5%)' },
  { id: 'shorts', label: '유튜브 쇼츠' },
  { id: 'reels', label: '인스타그램 릴스' },
  { id: 'tiktok', label: '틱톡' },
]

export function OutputSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const o = brief.output
  const set = (patch: Partial<OutputSpec>) => onChange({ ...brief, output: { ...o, ...patch } })
  const transparentOk = o.format === 'mov-prores4444' || o.format === 'webm-vp9' || o.format === 'png-sequence'

  return (
    <div className="col" style={{ gap: 24 }}>
      <SectionHeader title="출력 사양" desc="납품할 영상의 크기, 길이, 형식을 정해요. Claude는 이 사양에 맞춰 영상을 만들어요." />

      <Field label="화면 비율">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {[...OUTPUT_PRESETS, { id: 'custom' as const, label: '직접 입력', ratio: '자유', width: o.width, height: o.height, safeZone: o.safeZone }].map((p) => {
            const on = o.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                className="card"
                onClick={() => (p.id === 'custom' ? set({ preset: 'custom' }) : set({ preset: p.id, width: p.width, height: p.height, safeZone: p.safeZone }))}
                style={{ padding: '10px 6px', cursor: 'pointer', borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--accent-soft)' : 'var(--surface-2)' }}
              >
                <div style={{ fontWeight: 650 }}>{p.ratio}</div>
                <div className="tiny muted">{p.label}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <Field label="가로">
          <NumberField value={o.width} onChange={(width) => set({ width, preset: 'custom' })} label="W" unit="px" min={64} max={7680} step={2} />
        </Field>
        <Field label="세로">
          <NumberField value={o.height} onChange={(height) => set({ height, preset: 'custom' })} label="H" unit="px" min={64} max={7680} step={2} />
        </Field>
        <Field label="길이">
          <NumberField value={o.duration} onChange={(duration) => set({ duration })} label="⟷" unit="초" min={1} max={180} precision={1} step={0.5} />
        </Field>
      </div>

      <Field label="프레임 수 (fps)" hint={FPS_OPTIONS.find((f) => Math.abs(f.value - o.fps) < 0.01)?.hint}>
        <Segmented
          value={String(o.fps)}
          onChange={(v) => set({ fps: Number(v) })}
          options={FPS_OPTIONS.map((f) => ({ value: String(f.value), label: f.label }))}
        />
      </Field>

      <Field label="파일 형식" hint={transparentOk ? '이 형식은 투명 배경을 지원해요.' : undefined}>
        <select className="select" value={o.format} onChange={(e) => set({ format: e.target.value as OutputFormat, background: o.background === 'transparent' && !transparentOk ? 'color' : o.background })}>
          {Object.entries(FORMAT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="배경">
          <div className="col" style={{ gap: 8 }}>
            <Segmented
              value={o.background}
              onChange={(background) => set({ background })}
              options={[
                { value: 'auto', label: 'AI 자율' },
                { value: 'color', label: '색상' },
                { value: 'transparent', label: '투명' },
              ]}
            />
            {o.background === 'color' ? (
              <ColorField value={o.backgroundColor} onChange={(backgroundColor) => set({ backgroundColor })} />
            ) : o.background === 'auto' ? (
              <div className="small muted">톤앤매너와 장면에 맞춰 Claude가 배경(색·그라데이션·질감·이미지)을 정해요.</div>
            ) : !['mov-prores4444', 'webm-vp9', 'png-sequence'].includes(o.format) ? (
              <div className="small" style={{ color: 'var(--warning)' }}>투명 배경은 MOV(ProRes 4444), WebM, PNG 시퀀스에서만 유지돼요.</div>
            ) : null}
          </div>
        </Field>
        <Field label="품질">
          <Segmented
            value={o.quality}
            onChange={(quality) => set({ quality })}
            options={[
              { value: 'draft', label: '빠른 확인용' },
              { value: 'standard', label: '표준' },
              { value: 'high', label: '최고' },
            ]}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="세이프존 가이드" hint="편집 화면에 가이드 선으로 표시하고, Claude도 중요한 내용을 이 안에 두어요.">
          <select className="select" value={o.safeZone} onChange={(e) => set({ safeZone: e.target.value as SafeZoneId })}>
            {SAFE_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="소리 포함">
          <div className="row" style={{ height: 32 }}>
            <Toggle on={o.audio} onChange={(audio) => set({ audio })} />
            <span className="muted small">{o.audio ? '배경음악·효과음을 포함해요' : '소리 없이 내보내요'}</span>
          </div>
        </Field>
      </div>
    </div>
  )
}
