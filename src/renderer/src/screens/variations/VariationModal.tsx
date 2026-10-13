import { useEffect, useMemo, useState } from 'react'
import { Bot, Copy, Gauge, Maximize2, Plus, X } from 'lucide-react'
import type { VariationTargetInput } from '@shared/api'
import { OUTPUT_PRESETS, type OutputPresetId } from '@shared/brief'
import type { HistoryEntry, RenderRecord } from '@shared/project'
import { Field, Modal, NumberField, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'

interface Size {
  preset: OutputPresetId
  width: number
  height: number
  label: string
}

const sameAspect = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width / a.height - b.width / b.height) < 0.002
const ratioOf = (w: number, h: number) => OUTPUT_PRESETS.find((p) => p.width * h === p.height * w)?.ratio ?? `${w}×${h}`

const METHOD = {
  claude: { label: 'Claude가 다시 구성', icon: Bot, cls: 'accent' },
  retime: { label: '속도만 맞춤 (즉시)', icon: Gauge, cls: 'warning' },
  scale: { label: '크기만 변환 (즉시)', icon: Maximize2, cls: 'success' },
} as const

export function VariationModal({ onClose }: { onClose: () => void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const out = project!.brief.output
  const [renders, setRenders] = useState<RenderRecord[]>([])
  const [versions, setVersions] = useState<HistoryEntry[]>([])
  const [base, setBase] = useState('current')
  const [sizes, setSizes] = useState<Size[]>([])
  const [durations, setDurations] = useState<number[]>([out.duration])
  const [custom, setCustom] = useState({ w: 1280, h: 720 })
  const [customDur, setCustomDur] = useState(20)
  const [lengthMethod, setLengthMethod] = useState<'claude' | 'retime'>('claude')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void studio.renders.list(pid).then(setRenders)
    void studio.history.list(pid).then((h) => setVersions(h.filter((e) => e.versionName)))
  }, [pid])

  const presets: Size[] = OUTPUT_PRESETS.map((p) => ({ preset: p.id, width: p.width, height: p.height, label: `${p.ratio} ${p.label.split(' ')[0]}` }))
  const toggleSize = (s: Size) => setSizes((cur) => (cur.some((c) => c.width === s.width && c.height === s.height) ? cur.filter((c) => !(c.width === s.width && c.height === s.height)) : [...cur, s]))
  const toggleDur = (d: number) => setDurations((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)))

  const targets = useMemo(() => {
    const sz = sizes.length ? sizes : [{ preset: out.preset, width: out.width, height: out.height, label: '원본 크기' }]
    const ds = durations.length ? durations : [out.duration]
    const list: (VariationTargetInput & { method: keyof typeof METHOD; label: string })[] = []
    for (const s of sz)
      for (const d of ds) {
        if (s.width === out.width && s.height === out.height && Math.abs(d - out.duration) < 0.01) continue
        const method: keyof typeof METHOD = !sameAspect(s, out) ? 'claude' : Math.abs(d - out.duration) > 0.01 ? lengthMethod : 'scale'
        list.push({ preset: s.preset, width: s.width, height: s.height, duration: d, lengthMethod, method, label: `${ratioOf(s.width, s.height)} · ${s.width}×${s.height} · ${d}초` })
      }
    return list
  }, [sizes, durations, lengthMethod, out])

  const sameRatioLengthChange = targets.some((t) => sameAspect(t, out) && Math.abs(t.duration - out.duration) > 0.01)
  const claudeCount = targets.filter((t) => t.method === 'claude').length

  const create = async () => {
    setBusy(true)
    try {
      const r = renders.find((x) => x.id === base)
      const v = versions.find((x) => x.id === base)
      const b = base === 'current' ? ({ kind: 'current' } as const) : { kind: 'history' as const, id: r?.historyId ?? v!.id, label: r ? (r.versionName ?? r.fileName) : v!.versionName! }
      const created = await studio.variations.create(pid, { base: b, targets: targets.map(({ preset, width, height, duration, lengthMethod: lm }) => ({ preset, width, height, duration, lengthMethod: lm })) })
      toast(
        `베리에이션 ${created.length}개를 만들었어요.${claudeCount ? ` Claude가 ${claudeCount}개를 차례로 다시 구성하고 있어요 — 위쪽 프로젝트 이름을 눌러 진행 상황을 볼 수 있어요.` : ''}`,
        'success',
      )
      useStore.setState({ familyNonce: useStore.getState().familyNonce + 1 })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="베리에이션 만들기"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="small muted grow">{targets.length ? `${targets.length}개를 만들어요${claudeCount ? ` · Claude 재구성 ${claudeCount}개는 하나씩 차례로 진행돼요` : ''}` : '크기나 길이를 골라 주세요'}</span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!targets.length || busy} onClick={create}>
            <Copy size={14} />
            베리에이션 {targets.length || ''}개 만들기
          </button>
        </>
      }
    >
      <div className="small muted">
        지금 영상({ratioOf(out.width, out.height)} · {out.width}×{out.height} · {out.duration}초)을 바탕으로 다른 크기·길이 버전을 만들어요. 만든 베리에이션은 각각 원본처럼 대화하고, 직접 수정하고, 내보낼 수 있어요.
      </div>

      <Field label="기준">
        <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="current">현재 상태</option>
          {versions.length > 0 && (
            <optgroup label="저장한 버전">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.versionName}
                </option>
              ))}
            </optgroup>
          )}
          {renders.length > 0 && (
            <optgroup label="내보낸 결과물">
              {renders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.versionName ? `${r.versionName} · ` : ''}
                  {r.fileName}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>

      <Field label="크기 (여러 개 선택)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {presets.map((p) => {
            const on = sizes.some((s) => s.width === p.width && s.height === p.height)
            const isBase = p.width === out.width && p.height === out.height
            const w = p.width >= p.height ? 44 : (44 * p.width) / p.height
            const h = p.width >= p.height ? (44 * p.height) / p.width : 44
            return (
              <button
                key={p.preset}
                type="button"
                className="card"
                onClick={() => toggleSize(p)}
                style={{ padding: '10px 6px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--accent-soft)' : 'var(--surface-2)' }}
              >
                <div style={{ height: 46, display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: w, height: h, border: `2px solid ${on ? 'var(--accent)' : 'var(--text-3)'}`, borderRadius: 3 }} />
                </div>
                <div className="small" style={{ fontWeight: 650 }}>{p.label}</div>
                <div className="tiny faint">
                  {p.width}×{p.height}
                  {isBase ? ' · 원본' : ''}
                </div>
              </button>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="small muted">직접 입력</span>
          <div style={{ width: 120 }}>
            <NumberField label="W" unit="px" value={custom.w} min={64} max={7680} step={2} onChange={(w) => setCustom({ ...custom, w })} />
          </div>
          <div style={{ width: 120 }}>
            <NumberField label="H" unit="px" value={custom.h} min={64} max={7680} step={2} onChange={(h) => setCustom({ ...custom, h })} />
          </div>
          <button className="btn sm" onClick={() => toggleSize({ preset: 'custom', width: custom.w, height: custom.h, label: `${custom.w}×${custom.h}` })}>
            <Plus size={13} />
            추가
          </button>
          {sizes
            .filter((s) => s.preset === 'custom')
            .map((s) => (
              <span key={`${s.width}x${s.height}`} className="badge accent">
                {s.width}×{s.height}
                <button className="icon-btn" title="이 크기 빼기" style={{ width: 18, height: 18 }} onClick={() => toggleSize(s)}>
                  <X size={11} />
                </button>
              </span>
            ))}
        </div>
      </Field>

      <Field label="길이 (여러 개 선택)">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {[...new Set([out.duration, 6, 10, 15, 20, 30])].sort((a, b) => a - b).map((d) => (
            <button key={d} type="button" className={`btn sm${durations.includes(d) ? ' primary' : ''}`} onClick={() => toggleDur(d)}>
              {d}초{d === out.duration ? ' (원본)' : ''}
            </button>
          ))}
          <div style={{ width: 110 }}>
            <NumberField label="⟷" unit="초" value={customDur} min={1} max={180} precision={1} step={0.5} onChange={setCustomDur} />
          </div>
          <button className="btn sm" onClick={() => toggleDur(customDur)}>
            <Plus size={13} />
            추가
          </button>
        </div>
      </Field>

      {sameRatioLengthChange && (
        <Field label="같은 비율에서 길이를 바꾸는 방법" hint={lengthMethod === 'retime' ? '구성은 그대로 두고 전체 속도만 바꿔요. 짧게 줄일수록 움직임이 빨라져요.' : '길이에 맞게 장면을 압축하거나 늘려요. 품질이 더 좋아요.'}>
          <Segmented
            value={lengthMethod}
            onChange={setLengthMethod}
            options={[
              { value: 'claude', label: 'Claude가 다시 구성 (추천)' },
              { value: 'retime', label: '속도만 맞추기 (즉시)' },
            ]}
          />
        </Field>
      )}

      {targets.length > 0 && (
        <div className="card" style={{ padding: 6 }}>
          {targets.map((t, i) => {
            const m = METHOD[t.method]
            const Icon = m.icon
            return (
              <div key={i} className="row" style={{ padding: '7px 8px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span className="small grow">{t.label}</span>
                <span className={`badge ${m.cls}`}>
                  <Icon size={11} />
                  {m.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
