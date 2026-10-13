import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react'
import { FORMAT_LABELS, OUTPUT_PRESETS, type OutputFormat, type OutputQuality } from '@shared/brief'
import { Field, Modal, Segmented, Toggle } from '../components/ui'
import { studio, useStore } from '../store'

function defaultName(n: number) {
  const { brief } = useStore.getState().project!
  const ratio = (OUTPUT_PRESETS.find((p) => p.id === brief.output.preset)?.ratio ?? `${brief.output.width}x${brief.output.height}`).replace(':', 'x')
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return [brief.client, brief.campaign || brief.title, ratio, `v${String(n + 1).padStart(2, '0')}`, ymd]
    .filter((x) => x && x.trim())
    .join('_')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const { project, exportProgress, toast, setTab } = useStore()
  const out = project!.brief.output
  const pid = project!.meta.id
  const [format, setFormat] = useState<OutputFormat>(out.format)
  const [quality, setQuality] = useState<OutputQuality>(out.quality)
  const [fileName, setFileName] = useState('')
  const [versionName, setVersionName] = useState('')
  const [copyTo, setCopyTo] = useState<string | null>(null)
  // an export still running when the dialog is opened again is shown, not hidden behind a new form
  const live = exportProgress && exportProgress.projectId === pid && !['done', 'error', 'cancelled'].includes(exportProgress.phase) ? exportProgress : null
  const [renderId, setRenderId] = useState<string | null>(live?.renderId ?? null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void studio.renders.list(pid).then((r) => setFileName(defaultName(r.length)))
    if (!live) useStore.setState({ exportProgress: null })
    useStore.setState({ exportOpen: true })
    return () => useStore.setState({ exportOpen: false })
  }, [pid]) // eslint-disable-line react-hooks/exhaustive-deps

  const p = exportProgress && exportProgress.renderId === renderId ? exportProgress : null
  const running = !!renderId && (!p || !['done', 'error', 'cancelled'].includes(p.phase))
  const steps = useMemo(() => ['preparing', 'capturing', 'encoding', 'finishing'] as const, [])
  const stepLabel = { preparing: '준비', capturing: '프레임 만들기', encoding: '영상 파일로 묶기', finishing: '마무리' }

  const start = async () => {
    if (starting) return
    setStarting(true)
    try {
      const id = await studio.renders.start(pid, { format, quality, fileName, versionName: versionName.trim() || undefined, copyTo: copyTo ?? undefined })
      setRenderId(id)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Modal
      title="내보내기"
      onClose={onClose}
      width={560}
      footer={
        !renderId ? (
          <>
            <button className="btn" onClick={onClose}>
              취소
            </button>
            <button className="btn primary" onClick={start} disabled={!fileName.trim() || starting}>
              내보내기 시작
            </button>
          </>
        ) : running ? (
          <button className="btn" onClick={() => studio.renders.cancel(pid, renderId)}>
            취소
          </button>
        ) : (
          <>
            {p?.phase === 'done' && p.record && (
              <button className="btn" onClick={() => studio.app.reveal(`${project!.path}/${p.record!.file}`)}>
                <FolderOpen size={14} />
                폴더에서 보기
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => {
                onClose()
                if (p?.phase === 'done') setTab('results')
              }}
            >
              {p?.phase === 'done' ? '결과물 보기' : '닫기'}
            </button>
          </>
        )
      }
    >
      {!renderId ? (
        <>
          <Field label="파일 이름">
            <div className="row">
              <input className="input mono" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
          </Field>
          <Field label="형식">
            <select className="select" value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
              {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="품질" hint={quality === 'draft' ? '빠르게 확인할 때 써요. 납품용은 표준 이상을 권해요.' : undefined}>
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'draft', label: '빠른 확인용' },
                { value: 'standard', label: '표준' },
                { value: 'high', label: '최고' },
              ]}
            />
          </Field>
          <Field label="버전 이름 (선택)" hint="예: 광고주 1차 시안 — 이력에서 이 이름으로 찾을 수 있어요.">
            <input className="input" value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="이름 없이 저장" />
          </Field>
          <div className="row">
            <Toggle on={!!copyTo} onChange={async (on) => setCopyTo(on ? await studio.app.pickFolder() : null)} />
            <span className="small">다른 폴더에도 저장</span>
            {copyTo && <span className="tiny faint ellipsis grow" title={copyTo}>{copyTo}</span>}
          </div>
          <div className="tiny faint">
            {out.width}×{out.height} · {out.fps}fps · {out.duration}초 · 결과물은 프로젝트의 결과물 보관함에도 저장돼요.
          </div>
        </>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {p?.phase === 'done' ? (
            <div className="row" style={{ color: 'var(--success)', fontWeight: 650 }}>
              <CheckCircle2 size={18} />
              내보내기를 마쳤어요
            </div>
          ) : p?.phase === 'error' ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="row" style={{ color: 'var(--danger)', fontWeight: 650 }}>
                <AlertCircle size={18} />
                {p.message}
              </div>
              {p.detail && (
                <details className="tiny muted">
                  <summary style={{ cursor: 'pointer' }}>자세히</summary>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{p.detail}</pre>
                </details>
              )}
            </div>
          ) : p?.phase === 'cancelled' ? (
            <div className="muted">내보내기를 취소했어요.</div>
          ) : (
            <>
              <div className="row">
                <Loader2 size={16} className="spin" />
                <span style={{ fontWeight: 600 }}>{p?.message ?? '시작하고 있어요'}</span>
                <div className="grow" />
                <span className="mono small">{Math.round(p?.percent ?? 0)}%</span>
              </div>
              <div className="progress">
                <div style={{ width: `${p?.percent ?? 1}%` }} />
              </div>
              <div className="row tiny" style={{ gap: 14 }}>
                {steps.map((s) => {
                  const idx = steps.indexOf(s)
                  const cur = p ? steps.indexOf(p.phase as (typeof steps)[number]) : 0
                  return (
                    <span key={s} style={{ color: idx < cur ? 'var(--success)' : idx === cur ? 'var(--text)' : 'var(--text-3)' }}>
                      {idx < cur ? '✓ ' : ''}
                      {stepLabel[s]}
                    </span>
                  )
                })}
              </div>
              <div className="tiny faint">영상 길이와 컴퓨터 성능에 따라 몇 분 걸릴 수 있어요. 창을 닫아도 계속 진행돼요.</div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
