import { useEffect, useState } from 'react'
import { Film, ImagePlus, Music, Trash2, Upload } from 'lucide-react'
import { ASSET_KIND_LABELS, type Asset, type AssetKind, type AssetTransform, type Brief, type PositionHint } from '@shared/brief'
import { POSITION_OPTIONS, TimingField } from '../../components/TimingField'
import { Field, formatBytes, Modal, Segmented, Toggle } from '../../components/ui'
import { studio, useStore } from '../../store'
import { SectionHeader } from './BriefTab'

export function AssetsSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [base, setBase] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [psdAsk, setPsdAsk] = useState<string[] | null>(null)

  useEffect(() => {
    void studio.projects.fileUrl(pid, 'composition/').then(setBase)
  }, [pid])

  const importFiles = async (files: string[], psd?: 'flat' | 'layers') => {
    if (!files.length) return
    if (!psd && files.some((f) => f.toLowerCase().endsWith('.psd'))) {
      setPsdAsk(files)
      return
    }
    setBusy(true)
    try {
      const added = await studio.projects.importAssets(pid, files, { psd })
      if (!added.length) toast('지원하지 않는 파일이에요. 이미지·영상·소리 파일을 넣어 주세요.', 'error')
      else {
        onChange({ ...brief, assets: [...brief.assets, ...added] })
        toast(`소재 ${added.length}개를 추가했어요`, 'success')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const set = (id: string, patch: Partial<Asset>) => onChange({ ...brief, assets: brief.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  const remove = (id: string) => onChange({ ...brief, assets: brief.assets.filter((a) => a.id !== id) })

  return (
    <div className="col" style={{ gap: 16 }}>
      <SectionHeader title="소재" desc="광고주가 준 로고, 제품 이미지, 영상, 배경음악을 넣고 어디쯤 나오면 좋을지 정해요. 원본 파일은 프로젝트에 복사돼서 안전하게 보관돼요." />
      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void importFiles([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
        }}
        style={{
          borderStyle: 'dashed',
          borderColor: drag ? 'var(--accent)' : 'var(--border-strong)',
          background: drag ? 'var(--accent-soft)' : 'var(--surface-2)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Upload size={22} color="var(--text-2)" />
        <div style={{ fontWeight: 600 }}>파일을 여기로 끌어다 놓으세요</div>
        <div className="small muted">PNG · JPG · SVG · WebP · GIF · PSD · MP4 · MOV · WebM · MP3 · WAV</div>
        <button className="btn" disabled={busy} onClick={async () => importFiles(await studio.app.pickFiles('assets'))}>
          <ImagePlus size={14} />
          {busy ? '가져오는 중…' : '파일 선택'}
        </button>
      </div>

      {psdAsk && (
        <Modal title="PSD 가져오기" onClose={() => setPsdAsk(null)} width={520}>
          <div className="small" style={{ lineHeight: 1.7 }}>
            PSD를 어떻게 가져올까요?
            <br />
            <span className="muted">레이어별로 가져오면 각 레이어가 따로 소재가 되고, 원본 캔버스에서의 위치가 메모로 남아 Claude가 디자인한 배치를 그대로 살릴 수 있어요. (숨긴 레이어는 빼요)</span>
          </div>
          <div className="row">
            <button className="btn grow" onClick={() => { const f = psdAsk; setPsdAsk(null); void importFiles(f, 'flat') }}>
              합쳐서 한 장으로
            </button>
            <button className="btn primary grow" onClick={() => { const f = psdAsk; setPsdAsk(null); void importFiles(f, 'layers') }}>
              레이어별로 나눠서
            </button>
          </div>
        </Modal>
      )}
      {brief.assets.map((a) => (
        <div key={a.id} className="card fade-in" style={{ padding: 14, display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <div style={{ aspectRatio: '1', background: 'var(--canvas)', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundImage: 'repeating-conic-gradient(var(--surface-3) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
              {a.meta.mime.startsWith('image/') && base ? (
                <img src={base + a.file} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : a.meta.mime.startsWith('video/') && base ? (
                <video src={base + a.file} muted style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : a.meta.mime.startsWith('video/') ? (
                <Film size={28} color="var(--text-3)" />
              ) : (
                <Music size={28} color="var(--text-3)" />
              )}
            </div>
            <div className="tiny muted ellipsis" title={a.originalName}>{a.originalName}</div>
            <div className="tiny faint">
              {a.meta.width ? `${a.meta.width}×${a.meta.height} · ` : ''}
              {a.meta.duration ? `${a.meta.duration.toFixed(1)}초 · ` : ''}
              {formatBytes(a.meta.bytes)}
            </div>
          </div>
          <div className="col" style={{ gap: 12 }}>
            <div className="row">
              <select className="select" style={{ width: 130 }} value={a.kind} onChange={(e) => set(a.id, { kind: e.target.value as AssetKind })}>
                {Object.entries(ASSET_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <div className="row small" style={{ marginLeft: 8 }}>
                <Toggle on={a.required} onChange={(required) => set(a.id, { required })} />
                꼭 사용
              </div>
              <div className="grow" />
              <button className="icon-btn" title="브리프에서 빼기" onClick={() => remove(a.id)}>
                <Trash2 size={15} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
              <Field label="등장 시점">
                <TimingField value={a.timing} onChange={(timing) => set(a.id, { timing })} duration={brief.output.duration} />
              </Field>
              <Field label="위치">
                <select className="select" value={a.position} onChange={(e) => set(a.id, { position: e.target.value as PositionHint })}>
                  {POSITION_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="변형 허용">
              <Segmented
                value={a.transform}
                onChange={(transform: AssetTransform) => set(a.id, { transform })}
                options={[
                  { value: 'free', label: '자유롭게' },
                  { value: 'crop-only', label: '자르기만' },
                  { value: 'none', label: '변형 금지 (로고 등)' },
                ]}
              />
            </Field>
            <input className="input" placeholder="메모 (예: 마지막 엔드카드에 크게)" value={a.note} onChange={(e) => set(a.id, { note: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
  )
}
