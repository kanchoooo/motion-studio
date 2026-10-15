import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, Layers, Loader2, X } from 'lucide-react'
import type { AeProgress } from '@shared/api'
import { FORMAT_LABELS, OUTPUT_PRESETS, type OutputFormat, type OutputQuality } from '@shared/brief'
import { Field, Modal, Segmented, Toggle } from '../components/ui'
import { studio, useStore } from '../store'

// the folder chosen last time, remembered on this computer
const DIR_KEY = 'ms-export-dir'
function savedDir(): string | null {
  try {
    return localStorage.getItem(DIR_KEY) || null
  } catch {
    return null
  }
}
function rememberDir(dir: string | null) {
  try {
    if (dir) localStorage.setItem(DIR_KEY, dir)
    else localStorage.removeItem(DIR_KEY)
  } catch {
    /* storage unavailable: asked again next time */
  }
}

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
  const [audio, setAudio] = useState(out.audio)
  // a frame almost identical to a reference, media imported from the web (with their license)
  const [pre, setPre] = useState<Awaited<ReturnType<typeof studio.renders.preflight>> | null>(null)
  const transparentOk = format === 'mov-prores4444' || format === 'webm-vp9' || format === 'png-sequence'
  const [fileName, setFileName] = useState('')
  const [versionName, setVersionName] = useState('')
  const [saveDir, setSaveDir] = useState<string | null>(savedDir)
  const chooseDir = async () => {
    const dir = await studio.app.pickFolder()
    if (!dir) return
    setSaveDir(dir)
    rememberDir(dir)
  }
  // an export still running when the dialog is opened again is shown, not hidden behind a new form
  const live = exportProgress && exportProgress.projectId === pid && !['done', 'error', 'cancelled'].includes(exportProgress.phase) ? exportProgress : null
  const [renderId, setRenderId] = useState<string | null>(live?.renderId ?? null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void studio.renders.list(pid).then((r) => setFileName(defaultName(r.length)))
    void studio.renders.preflight(pid).then(setPre).catch(() => setPre({ copies: [], imports: [] }))
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
      // the choices become the project's defaults (the brief no longer holds them)
      if (format !== out.format || quality !== out.quality || audio !== out.audio) useStore.getState().setProject(await studio.projects.saveOutput(pid, { format, quality, audio }))
      const id = await studio.renders.start(pid, { format, quality, fileName, versionName: versionName.trim() || undefined, copyTo: saveDir ?? undefined })
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
              <button className="btn" onClick={() => studio.app.reveal(p.savedTo ?? `${project!.path}/${p.record!.file}`)}>
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
          <Field label="소리" hint={transparentOk ? '이 형식은 투명 배경도 지원해요 (배경을 투명하게 만들어 달라고 Claude에게 말해 주세요).' : undefined}>
            <div className="row" style={{ height: 32 }}>
              <Toggle on={audio} onChange={setAudio} />
              <span className="muted small">{audio ? '배경음악·효과음·내레이션을 포함해요' : '소리 없이 내보내요'}</span>
            </div>
          </Field>
          <Field label="버전 이름 (선택)" hint="예: 광고주 1차 시안 — 이력에서 이 이름으로 찾을 수 있어요.">
            <input className="input" value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="이름 없이 저장" />
          </Field>
          <Field label="저장 위치" hint="어디에 저장해도 프로젝트의 결과물 탭에 함께 보관돼요. 고른 폴더는 다음에도 기억해요.">
            <div className="row" style={{ gap: 6 }} data-testid="export-dir">
              <div className="input row grow" style={{ gap: 6, height: 34, minWidth: 0, cursor: 'pointer' }} onClick={chooseDir} title={saveDir ?? undefined}>
                <FolderOpen size={14} color="var(--text-3)" style={{ flex: 'none' }} />
                <span className={`ellipsis small${saveDir ? '' : ' muted'}`} style={{ direction: saveDir ? 'rtl' : undefined, textAlign: 'left' }}>
                  {saveDir ?? '결과물 보관함에만 저장'}
                </span>
              </div>
              <button className="btn" onClick={chooseDir}>
                {saveDir ? '바꾸기' : '폴더 고르기'}
              </button>
              {saveDir && (
                <button
                  className="icon-btn"
                  title="폴더에 저장하지 않기"
                  onClick={() => {
                    setSaveDir(null)
                    rememberDir(null)
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </Field>
          <div className="tiny faint">
            {out.width}×{out.height} · {out.fps}fps · {out.duration}초
          </div>
          {!pre ? (
            <div className="row tiny muted" style={{ gap: 6 }}>
              <Loader2 size={11} className="spin" />
              레퍼런스와 비슷한 장면, 외부 소재를 확인하고 있어요
            </div>
          ) : (
            (pre.copies.length > 0 || pre.imports.length > 0) && (
              <div className="card col" style={{ padding: 10, gap: 6, borderColor: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))' }} data-testid="export-preflight">
                {pre.copies.length > 0 && (
                  <div className="col" style={{ gap: 3 }}>
                    <div className="row small" style={{ gap: 6, fontWeight: 650 }}>
                      <AlertTriangle size={14} color="var(--warning)" />
                      레퍼런스와 거의 같은 장면이 있어요
                    </div>
                    {pre.copies.slice(0, 4).map((c, i) => (
                      <div key={i} className="tiny muted">
                        {c.t}초 화면 ↔ 「{c.ref}」 {c.refT}초 — 그대로 베낀 것처럼 보일 수 있어요. 필요하면 Claude에게 바꿔 달라고 하세요.
                      </div>
                    ))}
                  </div>
                )}
                {pre.imports.length > 0 && (
                  <div className="col" style={{ gap: 3 }}>
                    <div className="row small" style={{ gap: 6, fontWeight: 650 }}>
                      <AlertTriangle size={14} color="var(--warning)" />
                      외부에서 가져온 소재 · 사용 조건을 확인해 주세요
                    </div>
                    {pre.imports.slice(0, 8).map((g) => (
                      <div key={g.file} className="row tiny muted" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <span className="ellipsis" style={{ maxWidth: 220 }}>{g.label || g.file.split('/').pop()}</span>
                        <span>· {g.license || '라이선스 모름'}</span>
                        {g.source && /^https?:/.test(g.source) && (
                          <button className="btn ghost sm" style={{ height: 18, padding: '0 4px', fontSize: 11 }} onClick={() => studio.app.openExternal(g.source!)}>
                            <ExternalLink size={10} />
                            출처
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          <AeSection pid={pid} name={fileName} saveDir={saveDir} />
        </>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {p?.phase === 'done' ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="row" style={{ color: 'var(--success)', fontWeight: 650 }}>
                <CheckCircle2 size={18} />
                내보내기를 마쳤어요
              </div>
              {p.savedTo && <div className="small muted" style={{ wordBreak: 'break-all' }}>저장한 곳: {p.savedTo}</div>}
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

/** After Effects package (experimental): build.jsx + assets, opened in AE with File > Scripts */
function AeSection({ pid, name, saveDir }: { pid: string; name: string; saveDir: string | null }) {
  const { toast } = useStore()
  const [p, setP] = useState<AeProgress | null>(null)
  useEffect(() => studio.renders.onAeProgress((e) => e.projectId === pid && setP(e)), [pid])
  const running = !!p && !['done', 'error'].includes(p.phase)
  const start = async () => {
    setP({ projectId: pid, phase: 'measuring', percent: 1, message: '시작하고 있어요' })
    try {
      await studio.renders.exportAe(pid, { name: name.trim() || '모션스튜디오', copyTo: saveDir ?? undefined })
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
      setP(null)
    }
  }
  return (
    <div className="col" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }} data-testid="ae-section">
      <div className="row" style={{ gap: 8 }}>
        <Layers size={15} color="var(--accent)" />
        <span className="grow" style={{ fontWeight: 600 }}>
          애프터이펙트로 가져가기 <span className="badge">실험</span>
        </span>
        <button className="btn sm" disabled={running} onClick={() => void start()} data-testid="ae-start">
          {running ? <Loader2 size={13} className="spin" /> : <Layers size={13} />}
          AE 패키지 만들기
        </button>
      </div>
      <div className="tiny muted" style={{ lineHeight: 1.6 }}>
        글자는 텍스트 레이어, 그림은 투명 PNG 레이어, 움직임은 키프레임으로 담은 폴더를 만들어요. 애프터이펙트에서 <b>파일 › 스크립트 › 스크립트 파일 실행</b>으로 폴더 안 build.jsx를 열면 컴포지션이 만들어져요.
      </div>
      {p && p.phase !== 'done' && p.phase !== 'error' && (
        <div className="col" style={{ gap: 4 }}>
          <div className="tiny">{p.message}</div>
          <div className="progress">
            <div style={{ width: `${p.percent}%` }} />
          </div>
        </div>
      )}
      {p?.phase === 'done' && p.folder && (
        <div className="row small" style={{ gap: 8, color: 'var(--success)' }}>
          <CheckCircle2 size={14} />
          <span className="grow ellipsis" title={p.folder}>
            만들었어요: {p.folder}
          </span>
          <button className="btn sm" onClick={() => studio.app.reveal(p.folder!)}>
            <FolderOpen size={13} />
            폴더에서 보기
          </button>
        </div>
      )}
    </div>
  )
}
