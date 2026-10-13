// Optional storyboard: the designer plans the video scene by scene (copy with a
// verbatim lock, images that must appear or are described in words, length,
// and how it should move). Claude follows it when present.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, ImagePlus, Lock, Plus, Sparkles, Trash2 } from 'lucide-react'
import { newScene, type Brief, type StoryImage, type StoryScene } from '@shared/brief'
import { ModelSelect } from '../../components/ai/ModelSelect'
import { NumberField, Segmented, Toggle } from '../../components/ui'
import { studio, useStore } from '../../store'
import { SectionHeader } from './BriefTab'

const uid = () => crypto.randomUUID()

export function StoryboardSection({ brief, onChange }: { brief: Brief; onChange: (b: Brief) => void }) {
  const scenes = brief.storyboard
  const set = (next: StoryScene[]) => onChange({ ...brief, storyboard: next })
  const patch = (id: string, p: Partial<StoryScene>) => set(scenes.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...scenes]
    const [s] = next.splice(i, 1)
    next.splice(i + d, 0, s)
    set(next)
  }
  const total = scenes.reduce((a, s) => a + (s.duration ?? 0), 0)
  const undecided = scenes.filter((s) => s.duration == null).length
  const target = brief.output.duration

  return (
    <div className="col" style={{ gap: 16 }} data-testid="storyboard-section">
      <SectionHeader title="스토리보드 (선택)" desc="장면을 미리 구상했다면 씬별로 적어 주세요. 비워 두면 Claude가 브리프를 보고 콘티를 짜요." />
      {scenes.length > 0 && (
        <div className="row small" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)' }}>
          <span className="grow">
            씬 {scenes.length}개 · 정한 길이 합계 <b>{total.toFixed(1)}초</b> / 영상 {target}초
            {undecided > 0 && <span className="muted"> · 길이를 비운 씬 {undecided}개는 Claude가 나눠요</span>}
          </span>
          {Math.abs(total - target) > 0.05 && undecided === 0 && <span style={{ color: 'var(--warning)' }}>합계가 영상 길이와 달라요</span>}
        </div>
      )}
      {scenes.map((s, i) => (
        <SceneCard
          key={s.id}
          n={i + 1}
          scene={s}
          onPatch={(p) => patch(s.id, p)}
          onRemove={() => set(scenes.filter((x) => x.id !== s.id))}
          onDuplicate={() => {
            const copy: StoryScene = { ...structuredClone(s), id: uid(), title: s.title ? `${s.title} (복제)` : '' }
            copy.texts = copy.texts.map((t) => ({ ...t, id: uid() }))
            copy.images = copy.images.map((im) => ({ ...im, id: uid() }))
            const next = [...scenes]
            next.splice(i + 1, 0, copy)
            set(next)
          }}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < scenes.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => set([...scenes, newScene(uid())])}>
        <Plus size={14} />
        씬 추가
      </button>
    </div>
  )
}

function SceneCard({ n, scene: s, onPatch, onRemove, onDuplicate, onUp, onDown }: { n: number; scene: StoryScene; onPatch(p: Partial<StoryScene>): void; onRemove(): void; onDuplicate(): void; onUp?(): void; onDown?(): void }) {
  const setImage = (id: string, p: Partial<StoryImage>) => onPatch({ images: s.images.map((im) => (im.id === id ? { ...im, ...p } : im)) })
  return (
    <div className="card fade-in" style={{ padding: 16 }} data-scene={n}>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <span className="badge accent">씬 {n}</span>
        <input className="input grow" style={{ height: 30 }} placeholder="씬 제목 (예: 오프닝 · 제품 등장)" value={s.title} onChange={(e) => onPatch({ title: e.target.value })} />
        <div className="row" style={{ gap: 4, width: 150 }}>
          <Toggle on={s.duration != null} onChange={(v) => onPatch({ duration: v ? 3 : undefined })} />
          {s.duration != null ? (
            <NumberField value={s.duration} onChange={(duration) => onPatch({ duration })} label="길이" unit="초" min={0.2} max={180} step={0.5} precision={1} />
          ) : (
            <span className="tiny muted">길이 자동</span>
          )}
        </div>
        <button className="icon-btn" title="위로" disabled={!onUp} onClick={onUp}>
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn" title="아래로" disabled={!onDown} onClick={onDown}>
          <ArrowDown size={14} />
        </button>
        <button className="icon-btn" title="복제" onClick={onDuplicate}>
          <Copy size={14} />
        </button>
        <button className="icon-btn" title="삭제" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>

      <div className="col" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="section-label">연출 설명</span>
          <textarea
            className="textarea"
            rows={3}
            placeholder={'예) 검은 화면에서 제품이 천천히 회전하며 등장 → 빛이 지나가며 로고가 드러남.\n카메라는 살짝 줌인, 전환은 화이트 플래시.'}
            value={s.description}
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </div>

        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <span className="section-label grow">문구</span>
            <button className="btn ghost sm" onClick={() => onPatch({ texts: [...s.texts, { id: uid(), text: '', locked: false }] })}>
              <Plus size={12} />
              문구 추가
            </button>
          </div>
          {s.texts.length === 0 && <div className="tiny faint">이 씬에 들어갈 문구가 있으면 추가해 주세요.</div>}
          {s.texts.map((t) => (
            <div key={t.id} className="row" style={{ gap: 8 }}>
              <input className="input grow" style={{ height: 32 }} placeholder="예: 봄을 담은 한 잔" value={t.text} onChange={(e) => onPatch({ texts: s.texts.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)) })} />
              <label className="row tiny" style={{ gap: 4, whiteSpace: 'nowrap', color: t.locked ? 'var(--warning)' : 'var(--text-2)' }} title="한 글자도 바꾸지 않고 그대로 넣어요">
                <Toggle on={t.locked} onChange={(locked) => onPatch({ texts: s.texts.map((x) => (x.id === t.id ? { ...x, locked } : x)) })} />
                {t.locked && <Lock size={11} />}
                원문 고정
              </label>
              <button className="icon-btn" title="문구 삭제" onClick={() => onPatch({ texts: s.texts.filter((x) => x.id !== t.id) })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <span className="section-label grow">이미지</span>
            <button className="btn ghost sm" onClick={() => onPatch({ images: [...s.images, { id: uid(), mode: 'describe', required: false, description: '' }] })}>
              <Plus size={12} />
              이미지 추가
            </button>
          </div>
          {s.images.length === 0 && <div className="tiny faint">첨부할 이미지가 있거나, 필요한 이미지를 말로 설명할 수 있어요.</div>}
          {s.images.map((im) => (
            <SceneImage key={im.id} im={im} onPatch={(p) => setImage(im.id, p)} onRemove={() => onPatch({ images: s.images.filter((x) => x.id !== im.id) })} />
          ))}
        </div>
      </div>
    </div>
  )
}

function SceneImage({ im, onPatch, onRemove }: { im: StoryImage; onPatch(p: Partial<StoryImage>): void; onRemove(): void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (im.file) void studio.projects.fileUrl(pid, `composition/${im.file}`).then(setUrl)
    else setUrl('')
  }, [im.file, pid])
  const attach = async (files: string[]) => {
    const imgs = files.filter((f) => /\.(png|jpe?g|webp|gif|svg|avif|psd)$/i.test(f))
    if (!imgs.length) return toast('이미지 파일을 넣어 주세요.', 'error')
    const [a] = await studio.projects.importAssets(pid, imgs.slice(0, 1), { psd: 'flat' })
    if (a) onPatch({ file: a.file, originalName: a.originalName, mode: 'file' })
  }
  return (
    <div
      className="row"
      style={{ gap: 10, padding: 10, borderRadius: 8, background: 'var(--surface-2)', alignItems: 'flex-start' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void attach([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
      }}
    >
      <div className="col" style={{ gap: 8, flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <Segmented
            value={im.mode}
            onChange={(mode) => onPatch({ mode })}
            options={[
              { value: 'file', label: '첨부' },
              { value: 'describe', label: '말로 설명' },
            ]}
          />
          <label className="row tiny" style={{ gap: 4 }} title="이 이미지가 영상에 꼭 나와야 해요">
            <Toggle on={im.required} onChange={(required) => onPatch({ required })} />
            필수
          </label>
          <div className="grow" />
          <button className="icon-btn" onClick={onRemove} title="삭제">
            <Trash2 size={13} />
          </button>
        </div>
        {im.mode === 'file' ? (
          <div className="row" style={{ gap: 10 }}>
            <div style={{ width: 96, height: 64, borderRadius: 6, background: 'var(--canvas)', overflow: 'hidden', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {url ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImagePlus size={18} color="var(--text-3)" />}
            </div>
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <span className="small ellipsis">{im.originalName ?? '이미지를 끌어 놓거나 골라 주세요'}</span>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => attach(await studio.app.pickFiles('assets'))}>
                <ImagePlus size={12} />
                {im.file ? '바꾸기' : '이미지 고르기'}
              </button>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <textarea className="textarea" rows={2} placeholder="예: 벚꽃잎이 흩날리는 파스텔톤 카페 창가, 테이블 위 라떼 클로즈업" value={im.description} onChange={(e) => onPatch({ description: e.target.value })} />
            <div className="row tiny muted" style={{ gap: 6 }}>
              <Sparkles size={12} />
              <span style={{ whiteSpace: 'nowrap' }}>만들 모델</span>
              <div className="grow">
                <ModelSelect kind="image" value={im.model ?? null} onChange={(model) => onPatch({ model })} autoLabel="브리프 기본값 / Claude가 골라요" />
              </div>
            </div>
          </div>
        )}
        {im.mode === 'file' && (
          <input className="input" style={{ height: 28 }} placeholder="메모 (예: 제품 정면 컷, 오른쪽에 크게)" value={im.description} onChange={(e) => onPatch({ description: e.target.value })} />
        )}
      </div>
    </div>
  )
}
