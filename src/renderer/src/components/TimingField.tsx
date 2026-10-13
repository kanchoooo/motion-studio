import type { PositionHint, TimingSpec } from '@shared/brief'
import { NumberField, Segmented } from './ui'

export function TimingField({ value, onChange, duration }: { value: TimingSpec; onChange: (t: TimingSpec) => void; duration: number }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <Segmented
        value={value.mode}
        onChange={(mode) => onChange({ mode, at: value.at ?? 0, section: value.section ?? 'start' })}
        options={[
          { value: 'exact', label: '정확한 시간' },
          { value: 'section', label: '구간' },
          { value: 'any', label: '무관' },
        ]}
      />
      {value.mode === 'exact' && (
        <div style={{ maxWidth: 160 }}>
          <NumberField value={value.at ?? 0} onChange={(at) => onChange({ ...value, at })} label="@" unit="초" min={0} max={duration} step={0.1} precision={1} />
        </div>
      )}
      {value.mode === 'section' && (
        <Segmented
          value={value.section ?? 'start'}
          onChange={(section) => onChange({ ...value, section })}
          options={[
            { value: 'start', label: '앞부분' },
            { value: 'middle', label: '중간' },
            { value: 'end', label: '끝부분' },
          ]}
        />
      )}
    </div>
  )
}

export const POSITION_OPTIONS: { value: PositionHint; label: string }[] = [
  { value: 'any', label: '무관' },
  { value: 'top', label: '위' },
  { value: 'middle', label: '가운데' },
  { value: 'bottom', label: '아래' },
  { value: 'left', label: '왼쪽' },
  { value: 'right', label: '오른쪽' },
  { value: 'center', label: '정중앙' },
]
