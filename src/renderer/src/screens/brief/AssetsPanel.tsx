// 소재: the material library (files from the computer, attachments Claude took in, kept AI
// results), the AI generator (images, clips — also from a start and an end frame) and the
// prompt helper always at hand. Library tiles can be dragged onto storyboard slots.
import { useEffect, useState } from 'react'
import { Film, ImagePlus, Music, Trash2, Upload, Wand2, X } from 'lucide-react'
import type { Asset } from '@shared/brief'
import { formatBytes, Modal } from '../../components/ui'
import { cleanError, studio, useStore } from '../../store'
import { AssetGenerator, assetRequest, CompareModal, PromptHelper, type ReviseTarget } from './AssetGenerator'
import { ASSET_DRAG, useBriefUi } from './briefUi'

export function AssetsPanel({ onClose }: { onClose(): void }) {
  const { project, setProject, toast } = useStore()
  const { intent, clearIntent } = useBriefUi()
  const pid = project!.meta.id
  const brief = project!.brief
  const [base, setBase] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [psdAsk, setPsdAsk] = useState<string[] | null>(null)
  const [compare, setCompare] = useState<string | null>(null)
  const [revise, setRevise] = useState<ReviseTarget | null>(null)
  useEffect(() => {
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  const refresh = (p: Awaited<ReturnType<typeof studio.projects.state>>) => useStore.getState().project?.meta.id === pid && setProject(p)
  const fail = (e: unknown) => toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')

  const importFiles = async (files: string[], psd?: 'flat' | 'layers') => {
    if (!files.length) return
    if (!psd && files.some((f) => f.toLowerCase().endsWith('.psd'))) return setPsdAsk(files)
    setBusy(true)
    try {
      const before = brief.assets.length
      const st = await studio.projects.addToLibrary(pid, files, { psd })
      refresh(st)
      const n = st.brief.assets.length - before
      toast(n ? `소재 ${n}개를 넣었어요` : '지원하지 않는 파일이에요. 이미지·영상·소리 파일을 넣어 주세요.', n ? 'success' : 'error')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="panel-head">
        <ImagePlus size={15} color="var(--accent)" />
        <b className="grow">소재</b>
        <button className="btn sm" disabled={busy} onClick={async () => importFiles(await studio.app.pickFiles('assets'))}>
          <Upload size={13} />
          {busy ? '가져오는 중…' : '파일 가져오기'}
        </button>
        <button className="icon-btn" title="닫기" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gridTemplateRows: 'minmax(0, 1fr)' }}>
        <div className="panel-body col" style={{ padding: 14, gap: 14 }}>
          <div
            className="card"
            data-testid="library"
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes('Files')) return
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void importFiles([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
            }}
            style={{ padding: 12, borderStyle: 'dashed', borderColor: drag ? 'var(--accent)' : 'var(--border-strong)', background: drag ? 'var(--accent-soft)' : 'var(--surface-2)' }}
          >
            <div className="row tiny muted" style={{ marginBottom: brief.assets.length ? 10 : 0 }}>
              <span className="grow">소재함 · 파일을 끌어 놓아 넣어요. 소재를 콘티 칸으로 끌어가면 그 장면에 들어가요.</span>
              <span>{brief.assets.length}개</span>
            </div>
            {brief.assets.length === 0 ? (
              <div className="small muted" style={{ textAlign: 'center', padding: '14px 0' }}>
                로고·제품 사진·영상·음악 파일을 끌어 놓거나, 아래에서 AI로 만들어요.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 2 }} data-testid="library-grid">
                {brief.assets.map((a) => (
                  <AssetTile
                    key={a.id}
                    a={a}
                    base={base}
                    onRemove={async () => {
                      try {
                        refresh(await studio.projects.removeAsset(pid, a.id))
                      } catch (e) {
                        fail(e)
                      }
                    }}
                    onRevise={a.generated && assetRequest(a) ? () => setRevise({ asset: a, nonce: Date.now() }) : undefined}
                    onCompare={a.character ? () => setCompare(a.character!.dir) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          <AssetGenerator
            brief={brief}
            revise={revise}
            intent={intent}
            onIntentDone={clearIntent}
            onAdd={async (a) => {
              try {
                refresh(await studio.projects.addAssets(pid, [a]))
              } catch (e) {
                fail(e)
              }
            }}
            onReplace={async (oldId, a) => {
              try {
                refresh(await studio.projects.replaceAsset(pid, oldId, a))
              } catch (e) {
                fail(e)
              }
            }}
            onApply={async (a) => {
              refresh(await studio.projects.addAssets(pid, [a]))
              if (intent) await studio.agent.assign(pid, intent.material.id, a.file)
            }}
          />
        </div>
        <div style={{ borderLeft: '1px solid var(--border)', minHeight: 0 }}>
          <PromptHelper />
        </div>
      </div>
      {compare && <CompareModal dir={compare} base={base} onClose={() => setCompare(null)} />}
      {psdAsk && (
        <Modal title="PSD 가져오기" onClose={() => setPsdAsk(null)} width={520}>
          <div className="small" style={{ lineHeight: 1.7 }}>
            PSD를 어떻게 가져올까요?
            <br />
            <span className="muted">레이어별로 가져오면 각 레이어가 따로 소재가 되고, 원본 캔버스에서의 위치가 메모로 남아 Claude가 그 배치를 살릴 수 있어요. (숨긴 레이어는 빼요)</span>
          </div>
          <div className="row">
            <button
              className="btn grow"
              onClick={() => {
                const f = psdAsk
                setPsdAsk(null)
                void importFiles(f, 'flat')
              }}
            >
              합쳐서 한 장으로
            </button>
            <button
              className="btn primary grow"
              onClick={() => {
                const f = psdAsk
                setPsdAsk(null)
                void importFiles(f, 'layers')
              }}
            >
              레이어별로 나눠서
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function AssetTile({ a, base, onRemove, onRevise, onCompare }: { a: Asset; base: string; onRemove(): void; onRevise?(): void; onCompare?(): void }) {
  const img = a.meta.mime.startsWith('image/')
  const vid = a.meta.mime.startsWith('video/')
  return (
    <div
      className="col"
      style={{ gap: 4, minWidth: 0 }}
      draggable={img || vid}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG, a.file)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title={`${a.originalName}${a.generated?.prompt ? `\n${a.generated.prompt}` : ''}`}
      data-testid="asset-tile"
    >
      <div style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--canvas)', backgroundImage: 'repeating-conic-gradient(var(--surface-3) 0% 25%, transparent 0% 50%)', backgroundSize: '14px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: img || vid ? 'grab' : 'default' }}>
        {img && base ? (
          <img src={`${base}composition/${a.file}`} draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : vid && base ? (
          <video src={`${base}composition/${a.file}`} muted style={{ maxWidth: '100%', maxHeight: '100%' }} />
        ) : vid ? (
          <Film size={22} color="var(--text-3)" />
        ) : (
          <Music size={22} color="var(--text-3)" />
        )}
        <button className="icon-btn" title="소재함에서 빼기" onClick={onRemove} style={{ position: 'absolute', right: 3, top: 3, width: 22, height: 22, background: 'var(--surface)' }}>
          <Trash2 size={11} />
        </button>
      </div>
      <div className="tiny ellipsis">{a.originalName}</div>
      <div className="tiny faint">
        {a.meta.width ? `${a.meta.width}×${a.meta.height}` : a.meta.duration ? `${a.meta.duration.toFixed(1)}초` : formatBytes(a.meta.bytes)}
      </div>
      {a.character && (
        <button className="btn ghost sm" style={{ height: 20, padding: '0 4px', fontSize: 11, alignSelf: 'flex-start', color: a.character.pass ? 'var(--success)' : 'var(--warning)' }} onClick={onCompare} title={`SVG 도형 ${a.character.shapes ?? '?'}개 · 차이 ${a.character.badPct ?? '?'}% (비교 보기)`}>
          SVG {a.character.pass ? '✓' : '확인'}
        </button>
      )}
      {onRevise && (
        <button className="btn ghost sm" style={{ height: 22, padding: '0 6px', alignSelf: 'flex-start' }} onClick={onRevise} title="고칠 점만 적으면 이 소재를 바탕으로 다시 만들어요" data-testid="asset-revise">
          <Wand2 size={11} />
          다시 만들기
        </button>
      )}
    </div>
  )
}
