// Motion tab: every authored motion of the selected element, and a detailed
// editor for one motion (start, length, easing with curve preview, values, on/off).
import { AlertTriangle, ArrowLeft, Lock, RotateCcw } from 'lucide-react'
import { NumberField, Toggle } from '../../components/ui'
import { useEditor } from './editorStore'
import { DEFAULT_EASE, EASES, easeLabel, easePath, formatValue, motionLabel, parseValue, propLabel } from './motionInfo'
import { useOverrides } from './overrides'
import type { RuntimeMotion } from './player'

export function MotionPanel() {
  const { motions, selected, selectedMotion, elements, staleMotions } = useEditor()
  const { value: ov, patchMotion } = useOverrides()
  const m = motions.find((x) => x.key === selectedMotion)
  const el = elements.find((e) => e.id === selected)
  const mine = selected ? motions.filter((x) => x.owners.includes(selected)).sort((a, b) => a.start - b.start) : []
  const stale = staleMotions.filter((k) => ov?.motions[k])

  return (
    <div className="col" style={{ gap: 8 }}>
      {stale.length > 0 && (
        <div className="card" style={{ padding: 10, background: 'var(--warning-soft)', borderColor: 'transparent' }}>
          <div className="row small" style={{ color: 'var(--warning)', fontWeight: 600 }}>
            <AlertTriangle size={14} />
            적용되지 않은 모션 조정 {stale.length}개
          </div>
          <div className="tiny muted" style={{ margin: '4px 0 8px' }}>Claude가 그 모션을 다시 만들어서 예전 조정이 맞지 않아요. 새 모션에서 다시 조정해 주세요.</div>
          <button className="btn sm" onClick={() => stale.forEach((k) => patchMotion(k, ov!.motions[k].sig, null, '맞지 않는 모션 조정 정리'))}>
            정리하기
          </button>
        </div>
      )}

      {m ? (
        <MotionEditor key={m.key} m={m} />
      ) : !el ? (
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          캔버스나 타임라인에서 요소를 고르면 그 요소의 모션이 보여요. 타임라인에서 레이어 왼쪽 ▸를 누르면 모션 블록을 직접 끌어서 조정할 수도 있어요.
        </div>
      ) : (
        <>
          <div className="row">
            <span className="ellipsis grow" style={{ fontWeight: 650 }}>{el.label}</span>
            <span className="tiny faint">모션 {mine.length}개</span>
          </div>
          {mine.length === 0 && <div className="small muted">이 요소에는 따로 조정할 모션이 없어요.</div>}
          {mine.map((x) => (
            <button
              key={x.key}
              className="row"
              onClick={() => useEditor.setState({ selectedMotion: x.key, openLayers: [...new Set([...useEditor.getState().openLayers, x.owners[0]])] })}
              style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: 'var(--text)', textAlign: 'left', opacity: x.disabled ? 0.55 : 1 }}
            >
              <svg width={34} height={22} viewBox="0 0 34 22" style={{ flex: 'none' }}>
                <path d={easePath(ov?.motions[x.key]?.ease ?? x.ease, 34, 22)} fill="none" stroke="var(--warning)" strokeWidth={1.6} />
              </svg>
              <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="small ellipsis">{motionLabel(x)}</span>
                <span className="tiny faint">
                  {x.start.toFixed(2)}~{x.end.toFixed(2)}초 · {easeLabel(ov?.motions[x.key]?.ease ?? x.ease)}
                </span>
              </div>
              {x.edited && <Lock size={11} color="var(--accent)" />}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function MotionEditor({ m }: { m: RuntimeMotion }) {
  const { value: ov, patchMotion } = useOverrides()
  const o = ov?.motions[m.key]?.sig === m.sig ? ov.motions[m.key] : undefined
  const label = motionLabel(m)
  const start = m.authoredStart + (o?.shift ?? 0)
  const duration = o?.duration ?? m.duration
  const ease = o?.ease ?? (m.ease || DEFAULT_EASE)
  const off = !!o?.disabled
  const set = (patch: Parameters<typeof patchMotion>[2], what: string) => patchMotion(m.key, m.sig, patch, `${label}: ${what}`)

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <button className="icon-btn" title="모션 목록" style={{ marginLeft: -6 }} onClick={() => useEditor.setState({ selectedMotion: null })}>
          <ArrowLeft size={14} />
        </button>
        <span className="ellipsis grow" style={{ fontWeight: 650 }}>{label}</span>
        {o && (
          <button className="btn ghost sm" title="이 모션의 조정을 모두 되돌려요" onClick={() => patchMotion(m.key, m.sig, null, `${label}: 조정 되돌리기`)}>
            <RotateCcw size={11} />
            초기화
          </button>
        )}
      </div>
      {m.owners.length > 1 && <div className="tiny muted">요소 {m.owners.length}개가 함께 움직이는 모션이에요. 바꾸면 모두 같이 바뀌어요.</div>}
      {m.stagger && <div className="tiny muted">글자·요소마다 차례로 시작하는 모션이에요. 길이는 하나하나의 길이예요.</div>}

      <div className="row small">
        <Toggle on={!off} onChange={(v) => set({ disabled: !v }, v ? '다시 켜기' : '끄기')} />
        <span className="grow">{off ? '꺼짐 — 움직이지 않고 제자리에 있어요' : '이 모션 사용'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, opacity: off ? 0.5 : 1 }}>
        <NumberField title="시작 시점 (원래 시간 기준)" label="시작" unit="초" value={+start.toFixed(2)} step={0.05} precision={2} min={0} onChange={(v) => set({ shift: +(v - m.authoredStart).toFixed(3) }, `시작 ${v.toFixed(2)}초`)} />
        <NumberField title="움직이는 시간" label="길이" unit="초" value={+duration.toFixed(2)} step={0.05} precision={2} min={0} max={30} onChange={(v) => set({ duration: v }, `길이 ${v.toFixed(2)}초`)} />
      </div>

      <div className="col" style={{ gap: 6, opacity: off ? 0.5 : 1 }}>
        <div className="row">
          <span className="section-label grow">속도감 (이징)</span>
          <span className="tiny faint mono">{ease}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 4 }}>
          {[...EASES, ...(EASES.some((e) => e.value === ease) ? [] : [{ value: ease, label: '지금 값' }])].map((e) => {
            const on = e.value === ease
            return (
              <button
                key={e.value}
                title={`${e.label} (${e.value})`}
                onClick={() => set({ ease: e.value }, `속도감 ${e.label}`)}
                className="col"
                style={{ alignItems: 'center', gap: 2, padding: '6px 4px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface-2)', color: 'var(--text)' }}
              >
                <svg width={56} height={30} viewBox="0 0 56 30">
                  <path d={easePath(e.value, 56, 30)} fill="none" stroke={on ? 'var(--accent)' : 'var(--text-3)'} strokeWidth={1.6} />
                </svg>
                <span className="tiny ellipsis" style={{ maxWidth: '100%' }}>{e.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="col" style={{ gap: 6, opacity: off ? 0.5 : 1 }}>
        <div className="section-label">움직임 값</div>
        {m.props.map((p) => (
          <ValueRow key={p.name} m={m} p={p} values={o?.values ?? {}} onChange={(side, v) => set({ values: { [`${side}.${p.name}`]: v } }, `${propLabel(p.name)} ${side === 'from' ? '시작 값' : '끝 값'}`)} />
        ))}
      </div>
    </div>
  )
}

function ValueRow({ m, p, values, onChange }: { m: RuntimeMotion; p: RuntimeMotion['props'][number]; values: Record<string, number | string>; onChange(side: 'from' | 'to', v: number | string): void }) {
  const sides: ('from' | 'to')[] = m.type === 'from' ? ['from'] : m.type === 'to' ? ['to'] : (['from', 'to'] as const).filter((s) => p[s] !== undefined)
  const rest = m.type === 'from' ? '→ 원래 상태' : m.type === 'to' ? '이전 상태 →' : ''
  return (
    <div className="col" style={{ gap: 3 }}>
      <div className="row tiny muted">
        <span className="grow">{propLabel(p.name)}</span>
        {rest && <span className="faint">{rest}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sides.length}, 1fr)`, gap: 6 }}>
        {sides.map((side) => {
          const cur = values[`${side}.${p.name}`] ?? p[side]
          const parsed = p.editable ? parseValue(cur) : null
          if (!parsed) return <div key={side} className="small faint mono" title="코드로 계산되는 값이라 여기서 바꿀 수 없어요">{String(cur ?? '—')}</div>
          return (
            <NumberField
              key={side}
              title={side === 'from' ? '시작 값' : '끝 값'}
              label={sides.length > 1 ? (side === 'from' ? '시작' : '끝') : side === 'from' ? '시작' : '끝'}
              unit={parsed.unit || undefined}
              value={parsed.n}
              step={p.name === 'opacity' || p.name === 'autoAlpha' || p.name.startsWith('scale') ? 0.05 : 1}
              precision={p.name === 'opacity' || p.name === 'autoAlpha' || p.name.startsWith('scale') ? 2 : 1}
              onChange={(n) => onChange(side, formatValue(n, parsed.unit))}
            />
          )
        })}
      </div>
    </div>
  )
}
