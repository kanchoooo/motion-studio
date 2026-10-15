// 스토리보드: the storyboard Claude showed in the chat, scene by scene — its sketch, copy,
// motion and the materials each scene needs. Drop files from the computer or tiles from the
// 소재 panel onto a material to assign it; 만들기 opens the generator with Claude's prompts.
// What a scene shows is changed by talking to Claude.
import { useEffect, useState } from 'react'
import { Clapperboard, Film, FolderOpen, Image as ImageIcon, Sparkles, X } from 'lucide-react'
import type { StoryboardScene, StoryMaterial } from '@shared/api'
import { cleanError, studio, useStore } from '../../store'
import { ASSET_DRAG, useBriefUi } from './briefUi'

const IMAGE = /\.(png|jpe?g|webp|gif|svg|avif)$/i
const VIDEO = /\.(mp4|mov|webm|m4v)$/i

export function StoryboardPanel({ onClose }: { onClose(): void }) {
  const { project, storyboard } = useStore()
  const [base, setBase] = useState('')
  const pid = project!.meta.id
  useEffect(() => {
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  const o = project!.brief.output
  const sb = storyboard?.storyboard

  return (
    <>
      <div className="panel-head">
        <Clapperboard size={15} color="var(--accent)" />
        <b className="grow ellipsis">{sb ? `스토리보드 · ${sb.title}` : '스토리보드'}</b>
        {storyboard?.status === 'approved' && <span className="badge success">제작 승인함</span>}
        <button className="icon-btn" title="닫기" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="panel-body" style={{ padding: 16 }}>
        {!sb ? (
          <div className="col" style={{ gap: 8, padding: '40px 12px', alignItems: 'center', textAlign: 'center' }} data-testid="storyboard-empty">
            <Film size={26} color="var(--text-3)" />
            <b>아직 콘티가 없어요</b>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              대화로 기획을 나눈 뒤 "콘티로 보여줘"라고 하면 Claude가 장면별 시안을 그려서 보여 줘요.
              <br />
              장면마다 필요한 소재 칸이 생기고, 여기서 파일을 넣거나 AI로 만들 수 있어요.
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 14 }}>
            <div className="small" style={{ lineHeight: 1.65 }}>{sb.concept}</div>
            {sb.scenes.map((s) => (
              <SceneRow key={s.n} scene={s} base={base} ratio={o.width / o.height} />
            ))}
            {sb.notes && <div className="tiny muted">{sb.notes}</div>}
          </div>
        )}
      </div>
      {sb && <LibraryStrip base={base} />}
      {sb && (
        <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', gap: 10 }}>
          <span className="tiny muted grow">장면을 바꾸고 싶으면 대화로 말해 주세요. 소재 칸은 비워 두면 Claude가 채워요. 좋으면 대화에 "제작해줘"라고 말하면 만들기 시작해요.</span>
        </div>
      )}
    </>
  )
}

/** the library at hand: drag a picture or a clip onto a material slot */
function LibraryStrip({ base }: { base: string }) {
  const { project } = useStore()
  const media = project!.brief.assets.filter((a) => IMAGE.test(a.file) || VIDEO.test(a.file))
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', background: 'var(--surface-2)' }} data-testid="library-strip">
      <div className="row tiny muted" style={{ marginBottom: media.length ? 6 : 0 }}>
        <span className="grow">소재함 · 끌어서 소재 칸에 넣어요</span>
        <button className="btn ghost sm" style={{ height: 22 }} onClick={() => useBriefUi.setState({ panel: 'assets' })}>
          소재 패널 열기
        </button>
      </div>
      {media.length > 0 && (
        <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {media.map((a) => (
            <div
              key={a.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG, a.file)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={a.originalName}
              style={{ width: 56, height: 56, flex: 'none', borderRadius: 6, overflow: 'hidden', background: 'var(--canvas)', border: '1px solid var(--border)', cursor: 'grab' }}
              data-testid="strip-asset"
            >
              {base && (VIDEO.test(a.file) ? <video src={`${base}composition/${a.file}`} muted style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} /> : <img src={`${base}composition/${a.file}`} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SceneRow({ scene: s, base, ratio }: { scene: StoryboardScene; base: string; ratio: number }) {
  const portrait = ratio < 1
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: `${portrait ? 120 : 220}px 1fr`, gap: 14 }} data-testid={`scene-${s.n}`}>
      <div style={{ aspectRatio: String(ratio), borderRadius: 8, overflow: 'hidden', background: 'var(--canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {s.frame && base ? <img src={base + s.frame} style={{ width: '100%', height: '100%', objectFit: 'contain' }} data-testid="scene-frame" /> : <span className="tiny faint">시안 없음</span>}
      </div>
      <div className="col" style={{ gap: 6, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <b className="grow">
            {s.n}. {s.title}
          </b>
          <span className="mono tiny muted">
            {s.from.toFixed(1)}–{s.to.toFixed(1)}s
          </span>
        </div>
        <div className="small muted" style={{ lineHeight: 1.6 }}>{s.description}</div>
        {s.texts.length > 0 && <div className="tiny">문구: {s.texts.map((t) => `“${t}”`).join(' · ')}</div>}
        {s.motion && <div className="tiny" style={{ color: 'var(--accent)' }}>모션: {s.motion}</div>}
        {!!s.materials?.length && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 4 }}>
            {s.materials.map((m) => (
              <MaterialSlot key={m.id} m={m} scene={s} base={base} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function MaterialSlot({ m, scene, base, compact }: { m: StoryMaterial; scene: StoryboardScene; base: string; compact?: boolean }) {
  const { project, toast, setProject } = useStore()
  const pid = project!.meta.id
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const fits = (f: string) => (m.kind === 'video' ? VIDEO.test(f) : IMAGE.test(f))
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setProject(await studio.projects.state(pid))
    } catch (e) {
      toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  const files = async (paths: string[]) => {
    const ok = paths.filter(fits)
    if (!ok.length) return toast(m.kind === 'video' ? '영상 파일(mp4·mov·webm)을 넣어 주세요.' : '이미지 파일(png·jpg·webp·svg)을 넣어 주세요.', 'error')
    await run(() => studio.agent.assignFiles(pid, m.id, ok.slice(0, 1)))
  }
  const prompts = [m.prompt && `${m.kind === 'video' ? '영상' : '이미지'} 프롬프트: ${m.prompt}`, m.startPrompt && `시작 프레임: ${m.startPrompt}`, m.endPrompt && `끝 프레임: ${m.endPrompt}`].filter(Boolean) as string[]
  return (
    <div
      className={`slot${m.file ? ' filled' : ''}${over ? ' over' : ''}`}
      data-testid={`slot-${m.id}`}
      onDragOver={(e) => {
        const types = [...e.dataTransfer.types]
        if (!types.includes('Files') && !types.includes(ASSET_DRAG)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const asset = e.dataTransfer.getData(ASSET_DRAG)
        if (asset) {
          if (!fits(asset)) return toast(m.kind === 'video' ? '이 칸에는 영상 소재를 넣어 주세요.' : '이 칸에는 이미지 소재를 넣어 주세요.', 'error')
          return void run(() => studio.agent.assign(pid, m.id, asset))
        }
        void files([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
      }}
    >
      <div className="row tiny" style={{ gap: 6 }}>
        {m.kind === 'video' ? <Film size={12} color="var(--text-3)" /> : <ImageIcon size={12} color="var(--text-3)" />}
        <b className="grow ellipsis" title={m.label}>
          {m.label}
        </b>
        <span className="faint">{m.kind === 'video' ? '영상' : '이미지'}</span>
      </div>
      {m.file ? (
        <div className="row" style={{ gap: 8 }}>
          <div style={{ width: compact ? 56 : 72, height: compact ? 56 : 72, borderRadius: 6, overflow: 'hidden', background: 'var(--canvas)', flex: 'none' }}>
            {base && (VIDEO.test(m.file) ? <video src={`${base}composition/${m.file}`} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={`${base}composition/${m.file}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
          </div>
          <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
            <span className="tiny muted ellipsis" title={m.file}>
              {m.file.split('/').pop()}
            </span>
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start', height: 22 }} disabled={busy} onClick={() => void run(() => studio.agent.assign(pid, m.id, null))}>
              비우기
            </button>
          </div>
        </div>
      ) : (
        <>
          {!compact && prompts.length > 0 && (
            <div className="tiny muted" style={{ lineHeight: 1.5, maxHeight: 64, overflow: 'auto', whiteSpace: 'pre-wrap' }} title={prompts.join('\n')}>
              {prompts.join('\n')}
            </div>
          )}
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            <button className="btn sm primary" style={{ height: 24 }} disabled={busy} onClick={() => useBriefUi.getState().makeFor({ material: m, scene: scene.n, sceneTitle: scene.title, sceneDescription: scene.description })} data-testid="slot-make">
              <Sparkles size={12} />
              만들기
            </button>
            <button className="btn sm" style={{ height: 24 }} disabled={busy} onClick={async () => files(await studio.app.pickFiles(m.kind === 'video' ? 'assets' : 'images'))} title="컴퓨터에서 파일 고르기 (끌어놓아도 돼요)">
              <FolderOpen size={12} />
              파일
            </button>
          </div>
          <span className="tiny faint">파일·소재를 끌어놓으면 바로 들어가요</span>
        </>
      )}
    </div>
  )
}
