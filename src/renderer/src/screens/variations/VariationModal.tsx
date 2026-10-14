// 베리에이션 만들기: pick the original (from the home screen: a finished project in the
// folder; in a project: this one) and what it is based on, then add variations one row at a
// time — ratio / size, length, and an optional extra request each. 베리에이션 진행 makes
// them all; the ones Claude re-lays out run side by side, each in its own session.
import { useEffect, useMemo, useState } from 'react'
import { Bot, Copy, Gauge, Maximize2, Plus, X } from 'lucide-react'
import type { VariationTargetInput } from '@shared/api'
import { OUTPUT_PRESETS, type OutputPresetId } from '@shared/brief'
import type { HistoryEntry, ProjectState, RenderRecord } from '@shared/project'
import { Modal, NumberField, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'
import { folderName, within } from '../home/folders'

const sameAspect = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width / a.height - b.width / b.height) < 0.002
const ratioOf = (w: number, h: number) => OUTPUT_PRESETS.find((p) => p.width * h === p.height * w)?.ratio ?? `${w}×${h}`
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const METHOD = {
  claude: { label: 'Claude가 다시 구성', icon: Bot, cls: 'accent' },
  retime: { label: '속도만 맞춤 (즉시)', icon: Gauge, cls: 'warning' },
  scale: { label: '크기만 변환 (즉시)', icon: Maximize2, cls: 'success' },
} as const

interface Row {
  key: number
  preset: OutputPresetId
  width: number
  height: number
  duration: number
  lengthMethod: 'claude' | 'retime'
  note: string
}

let seq = 0

export function VariationModal({ onClose, folder }: { onClose: () => void; folder?: string }) {
  const { project, projects, toast, refreshProjects } = useStore()
  const inProject = folder === undefined && !!project
  // from the home screen: finished projects in this folder first
  const choices = inProject ? [] : projects.filter((p) => p.hasVideo).sort((a, b) => Number(within(b.folder, folder ?? '')) - Number(within(a.folder, folder ?? '')) || b.updatedAt.localeCompare(a.updatedAt))
  const [sourcePath, setSourcePath] = useState(inProject ? project!.path : (choices[0]?.path ?? ''))
  const [source, setSource] = useState<ProjectState | null>(inProject ? project : null)
  const [renders, setRenders] = useState<RenderRecord[]>([])
  const [versions, setVersions] = useState<HistoryEntry[]>([])
  const [base, setBase] = useState('current')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)

  // the original's spec, its saved versions and exports
  useEffect(() => {
    if (!sourcePath) return
    let alive = true
    void (async () => {
      try {
        const s = inProject ? project! : await studio.projects.open(sourcePath)
        if (!alive) return
        setSource(s)
        setBase('current')
        const [r, h] = await Promise.all([studio.renders.list(s.meta.id), studio.history.list(s.meta.id)])
        if (!alive) return
        setRenders(r)
        setVersions(h.filter((e) => e.versionName))
        const o = s.brief.output
        // a first row that is the usual next size: vertical for a wide video, wide for a vertical one
        const next = OUTPUT_PRESETS.find((p) => (o.width >= o.height ? p.height > p.width : p.width > p.height)) ?? OUTPUT_PRESETS[0]
        setRows([{ key: ++seq, preset: next.id, width: next.width, height: next.height, duration: o.duration, lengthMethod: 'claude', note: '' }])
      } catch (e) {
        toast(errText(e), 'error')
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePath])

  const out = source?.brief.output
  const methodOf = (r: Row): keyof typeof METHOD => (!out ? 'claude' : !sameAspect(r, out) || r.note.trim() ? 'claude' : Math.abs(r.duration - out.duration) > 0.01 ? r.lengthMethod : 'scale')
  const same = (r: Row) => !!out && r.width === out.width && r.height === out.height && Math.abs(r.duration - out.duration) < 0.01 && !r.note.trim()
  const valid = rows.filter((r) => !same(r))
  const claudeCount = valid.filter((r) => methodOf(r) === 'claude').length

  const patch = (key: number, p: Partial<Row>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const add = () => {
    if (!out) return
    const used = new Set(rows.map((r) => `${r.width}x${r.height}`))
    const next = OUTPUT_PRESETS.find((p) => !used.has(`${p.width}x${p.height}`) && !(p.width === out.width && p.height === out.height)) ?? OUTPUT_PRESETS[0]
    setRows((l) => [...l, { key: ++seq, preset: next.id, width: next.width, height: next.height, duration: out.duration, lengthMethod: 'claude', note: '' }])
  }

  const create = async () => {
    if (!source || !valid.length) return
    setBusy(true)
    try {
      const r = renders.find((x) => x.id === base)
      const v = versions.find((x) => x.id === base)
      const b = base === 'current' ? ({ kind: 'current' } as const) : { kind: 'history' as const, id: r?.historyId ?? v!.id, label: r ? (r.versionName ?? r.fileName) : v!.versionName! }
      const targets: VariationTargetInput[] = valid.map((x) => ({ preset: x.preset, width: x.width, height: x.height, duration: x.duration, lengthMethod: x.lengthMethod, note: x.note.trim() || undefined }))
      const created = await studio.variations.create(source.meta.id, { base: b, targets })
      toast(
        `베리에이션 ${created.length}개를 만들었어요.${claudeCount ? ` Claude가 ${claudeCount}개를 ${claudeCount > 1 ? '동시에 ' : ''}다시 구성하고 있어요 — ${inProject ? '위쪽 프로젝트 이름' : '원본 카드의 배지'}에서 진행 상황을 볼 수 있어요.` : ''}`,
        'success',
      )
      useStore.setState({ familyNonce: useStore.getState().familyNonce + 1 })
      if (!inProject) void refreshProjects()
      onClose()
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="베리에이션 만들기"
      onClose={onClose}
      width={820}
      footer={
        <>
          <span className="small muted grow">{valid.length ? `${valid.length}개를 만들어요${claudeCount ? ` · Claude 재구성 ${claudeCount}개는 동시에 진행돼요 (한 번에 4개까지)` : ''}` : '베리에이션을 추가해 주세요'}</span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!valid.length || busy || !source} onClick={create} data-testid="variation-run">
            <Copy size={14} />
            베리에이션 진행{valid.length ? ` (${valid.length})` : ''}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: inProject ? '1fr' : '1.2fr 1fr', gap: 12 }}>
        {!inProject && (
          <div className="field" style={{ margin: 0 }}>
            <label>원본 프로젝트</label>
            <select className="select" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} data-testid="variation-source">
              {choices.length === 0 && <option value="">완성한 프로젝트가 없어요</option>}
              {choices.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name} · {p.ratio} · {p.duration}초{p.folder ? ` (${folderName(p.folder)})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label>기준</label>
          <select className="select" value={base} onChange={(e) => setBase(e.target.value)} data-testid="variation-base">
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
        </div>
      </div>
      {out && (
        <div className="small muted">
          원본: {ratioOf(out.width, out.height)} · {out.width}×{out.height} · {out.duration}초. 베리에이션마다 비율·크기·길이를 정하고, 필요하면 추가 요청을 적어요. 만든 베리에이션은 각각 원본처럼 대화하고 직접 수정하고 내보낼 수 있어요.
        </div>
      )}

      <div className="col" style={{ gap: 8 }} data-testid="variation-rows">
        {rows.map((r, i) => {
          const m = METHOD[methodOf(r)]
          const Icon = m.icon
          const custom = r.preset === 'custom'
          const lengthOnly = !!out && sameAspect(r, out) && Math.abs(r.duration - out.duration) > 0.01 && !r.note.trim()
          return (
            <div key={r.key} className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, opacity: same(r) ? 0.6 : 1 }} data-testid="variation-row">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="badge" style={{ minWidth: 26, justifyContent: 'center' }}>{i + 1}</span>
                <select
                  className="select"
                  style={{ width: 200 }}
                  value={r.preset}
                  onChange={(e) => {
                    const id = e.target.value as OutputPresetId
                    const p = OUTPUT_PRESETS.find((x) => x.id === id)
                    patch(r.key, p ? { preset: id, width: p.width, height: p.height } : { preset: 'custom' })
                  }}
                  data-testid="variation-preset"
                >
                  {OUTPUT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ratio} · {p.label} ({p.width}×{p.height})
                    </option>
                  ))}
                  <option value="custom">직접 입력</option>
                </select>
                {custom && (
                  <>
                    <div style={{ width: 110 }}>
                      <NumberField label="W" unit="px" value={r.width} min={64} max={7680} step={2} onChange={(width) => patch(r.key, { width })} />
                    </div>
                    <div style={{ width: 110 }}>
                      <NumberField label="H" unit="px" value={r.height} min={64} max={7680} step={2} onChange={(height) => patch(r.key, { height })} />
                    </div>
                  </>
                )}
                <div style={{ width: 110 }}>
                  <NumberField label="⟷" unit="초" value={r.duration} min={1} max={180} precision={1} step={0.5} onChange={(duration) => patch(r.key, { duration })} />
                </div>
                <div className="grow" />
                <span className={`badge ${m.cls}`}>
                  <Icon size={11} />
                  {same(r) ? '원본과 같아요' : m.label}
                </span>
                <button className="icon-btn" title="이 베리에이션 빼기" disabled={rows.length === 1} onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}>
                  <X size={14} />
                </button>
              </div>
              {lengthOnly && (
                <div className="row tiny muted" style={{ gap: 8 }}>
                  <span>같은 비율에서 길이만 바꿔요:</span>
                  <Segmented
                    value={r.lengthMethod}
                    onChange={(lengthMethod) => patch(r.key, { lengthMethod })}
                    options={[
                      { value: 'claude', label: 'Claude가 다시 구성 (추천)' },
                      { value: 'retime', label: '속도만 맞추기 (즉시)' },
                    ]}
                  />
                </div>
              )}
              <textarea
                className="textarea"
                rows={2}
                value={r.note}
                onChange={(e) => patch(r.key, { note: e.target.value })}
                placeholder="추가 요청 (선택) — 예) 첫 장면은 제품부터, 마지막 문구를 '지금 주문하기'로, 자막을 더 크게"
                data-testid="variation-note"
              />
            </div>
          )
        })}
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={!out} data-testid="variation-add">
          <Plus size={14} />
          베리에이션 추가
        </button>
      </div>
    </Modal>
  )
}
