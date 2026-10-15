// 소재 > AI로 만들기:
//  - 이미지: model + style (look) + kind + framing + ratio + the designer's own prompt (sent
//    as written; only the style / kind sentences are put in front), optional reference
//    assets. Flat characters become SVG right away.
//  - 영상: video model + length + ratio + a motion prompt — made at once, or from a start frame
//    to an end frame made first (① start image → ② end image → ③ clip).
// A storyboard material ("만들기" on a slot) opens it with Claude's prompts; its result can go
// straight into that slot. The prompt helper beside the panel reads this form (useGenHelper).
// Results wait as candidates to be added to the library or discarded.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ArrowLeftRight, Check, ChevronDown, ChevronRight, Film, Image as ImageIcon, ImagePlus, Loader2, MessageCircle, RefreshCw, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import {
  defaultPromptLang,
  FRAMING_LABELS,
  FRAMING_RATIO,
  PROMPT_LANG_LABELS,
  RATIOS,
  STYLE_LABELS,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  type CharacterInfo,
  type Framing,
  type GenCandidate,
  type GenKind,
  type GenRequest,
  type GenStyle,
  type LookStyle,
  type PromptLang,
  type Ratio,
  type VideoGenRequest,
} from '@shared/assetGen'
import { KIND_HINTS, KIND_LABELS, LOOK_HINTS } from '@shared/genStyles'
import type { AiModelRef, Asset, Brief } from '@shared/brief'
import type { HelperReply } from '@shared/api'
import type { GenIntent } from './briefUi'
import { ModelSelect } from '../../components/ai/ModelSelect'
import { Modal, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Media = 'image' | 'video'
type VideoRatio = (typeof VIDEO_RATIOS)[number]

// the designer's last choices (per computer)
const remembered = (() => {
  try {
    return JSON.parse(localStorage.getItem('ms-gen') ?? '{}') as { style?: GenStyle; kind?: GenKind }
  } catch {
    return {}
  }
})()
const remember = (v: { style: GenStyle; kind: GenKind }) => {
  try {
    localStorage.setItem('ms-gen', JSON.stringify(v))
  } catch {
    /* private window */
  }
}

/** which prompt box the helper fills ("프롬프트 칸에 넣기") */
export type PromptTarget = 'image' | 'video' | 'start' | 'end'
export interface HelperCtx {
  media: string
  model: string
  lang: string
  style: string
  kind: string
  framing: string
  prompt: string
  projectId: string
  referenceFiles: string[]
  scene?: string
}
/** the generator's state the resident helper reads, and how its prompt goes back into the form */
export const useGenHelper = create<{ ctx: HelperCtx | null; target: PromptTarget; use: ((p: string) => void) | null }>(() => ({ ctx: null, target: 'image', use: null }))
const TARGET_LABEL: Record<PromptTarget, string> = { image: '이미지 프롬프트', video: '움직임 프롬프트', start: '시작 프레임 프롬프트', end: '끝 프레임 프롬프트' }
export const targetLabel = (t: PromptTarget) => TARGET_LABEL[t]

/** an AI-made asset of the brief the designer wants changed (수정해서 다시 만들기) */
export interface ReviseTarget {
  asset: Asset
  nonce: number
}

const nearestRatio = (w?: number, h?: number): Ratio => {
  if (!w || !h) return '1:1'
  return RATIOS.reduce((best, r) => {
    const [a, b] = r.split(':').map(Number)
    const [x, y] = best.split(':').map(Number)
    return Math.abs(Math.log(a / b / (w / h))) < Math.abs(Math.log(x / y / (w / h))) ? r : best
  })
}

/** the request an AI asset was made with (older assets only kept the main fields) */
export function assetRequest(a: Asset): { image?: GenRequest; video?: VideoGenRequest } | null {
  const g = a.generated
  if (!g) return null
  if (a.meta.mime.startsWith('video/')) {
    if (g.video) return { video: g.video }
    if (g.provider !== 'higgsfield' && g.provider !== 'magnific') return null
    const ratio = (a.meta.width ?? 16) >= (a.meta.height ?? 9) * 1.2 ? '16:9' : (a.meta.height ?? 9) >= (a.meta.width ?? 16) * 1.2 ? '9:16' : '1:1'
    return { video: { provider: g.provider, model: '', modelLabel: g.model, lang: defaultPromptLang(g.model), prompt: g.prompt, ratio, duration: Math.round(a.meta.duration ?? 5) } }
  }
  if (g.request) return { image: g.request }
  if (g.provider !== 'higgsfield' && g.provider !== 'magnific' && g.provider !== 'codex') return null
  return {
    image: { provider: g.provider, model: g.provider === 'codex' ? 'gpt-image' : '', modelLabel: g.model, style: g.style, kind: g.style === 'flat-character' ? 'character' : 'free', framing: g.framing, ratio: nearestRatio(a.meta.width, a.meta.height), lang: defaultPromptLang(g.model), prompt: g.prompt, references: [] },
  }
}

export function AssetGenerator({
  brief,
  onAdd,
  onReplace,
  revise,
  intent,
  onApply,
  onIntentDone,
}: {
  brief: Brief
  onAdd(a: Asset): void
  onReplace?(oldId: string, a: Asset): void
  revise?: ReviseTarget | null
  /** a storyboard material to make */
  intent?: GenIntent | null
  /** a kept result goes into that material's slot */
  onApply?(a: Asset): Promise<void>
  onIntentDone?(): void
}) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const box = useRef<HTMLDivElement>(null)
  const [revising, setRevising] = useState<Asset | null>(null)
  const [open, setOpen] = useState(true)
  const [media, setMedia] = useState<Media>('image')
  const [model, setModel] = useState<AiModelRef | null>(brief.ai.image ?? null)
  const [style, setStyle] = useState<GenStyle>(remembered.style && remembered.style in STYLE_LABELS ? remembered.style : 'flat-character')
  const [kind, setKind] = useState<GenKind>(remembered.kind && remembered.kind in KIND_LABELS ? remembered.kind : 'character')
  const [framing, setFraming] = useState<Framing>('auto')
  const [ratio, setRatio] = useState<Ratio>('1:1')
  const [langs, setLangs] = useState<Record<string, PromptLang>>({})
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [busy, setBusy] = useState<Media | null>(null)
  const [candidates, setCandidates] = useState<GenCandidate[]>([])
  const [target, setTarget] = useState<PromptTarget>('image')
  const [providers, setProviders] = useState<string[]>([])
  const [codexUsable, setCodexUsable] = useState(false)
  const [base, setBase] = useState('')
  // video
  const [vModel, setVModel] = useState<AiModelRef | null>(brief.ai.video ?? null)
  const [vPrompt, setVPrompt] = useState('')
  const [frames, setFrames] = useState<{ start?: string; end?: string }>({})
  const [duration, setDuration] = useState<number>(5)
  const out = brief.output
  const outRatio: VideoRatio = out.width > out.height * 1.2 ? '16:9' : out.height > out.width * 1.2 ? '9:16' : '1:1'
  const [vRatio, setVRatio] = useState<VideoRatio>(outRatio)
  // ① start image → ② end image → ③ clip, or the clip at once
  const [vMode, setVMode] = useState<'direct' | 'frames'>('direct')
  const [startPrompt, setStartPrompt] = useState('')
  const [endPrompt, setEndPrompt] = useState('')
  const [making, setMaking] = useState<'start' | 'end' | null>(null)

  useEffect(() => {
    void studio.ai.candidates(pid).then(setCandidates)
    void studio.ai.settings().then((s) => setLangs(s.promptLangs ?? {}))
    void studio.ai.accounts().then((a) => setProviders([...new Set(a.filter((x) => x.active && !x.needsLogin).map((x) => x.provider))]))
    void studio.ai.codexStatus().then((c) => setCodexUsable(c.usable)).catch(() => null)
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  useEffect(() => remember({ style, kind }), [style, kind])
  useEffect(() => {
    if (!revise) return
    setRevising(revise.asset)
    setOpen(true)
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [revise])
  // a storyboard slot's "만들기": Claude's prompts, the video's proportions
  useEffect(() => {
    if (!intent) return
    const m = intent.material
    setOpen(true)
    setRevising(null)
    if (m.kind === 'image') {
      setMedia('image')
      setStyle('none')
      setKind('free')
      setRatio(nearestRatio(out.width, out.height))
      setPrompt(m.prompt ?? '')
      setTarget('image')
    } else {
      setMedia('video')
      setVPrompt(m.prompt ?? '')
      setStartPrompt(m.startPrompt ?? '')
      setEndPrompt(m.endPrompt ?? '')
      setVMode(m.startPrompt || m.endPrompt ? 'frames' : 'direct')
      setFrames({})
      setVRatio(outRatio)
      setTarget(m.startPrompt ? 'start' : 'video')
    }
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [intent?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const flat = style === 'flat-character'
  const showFraming = flat || kind === 'character'
  // 자동: the active account's service default, else Codex (GPT Image) when it can be used
  const provider = (model?.provider ?? (providers[0] as GenRequest['provider'] | undefined) ?? (codexUsable ? 'codex' : undefined)) as GenRequest['provider'] | undefined
  const videoProviders = providers.filter((p) => p === 'higgsfield' || p === 'magnific') as VideoGenRequest['provider'][]
  const vProvider = (vModel && (vModel.provider === 'higgsfield' || vModel.provider === 'magnific') ? vModel.provider : videoProviders[0]) as VideoGenRequest['provider'] | undefined
  const langOf = (m: AiModelRef | null, p: string | undefined): PromptLang => langs[`${p ?? ''}:${m?.model ?? ''}`] ?? defaultPromptLang(`${m?.model ?? ''} ${m?.label ?? ''}`)
  const lang = media === 'image' ? langOf(model, provider) : langOf(vModel, vProvider)
  const setLang = async (l: PromptLang) => {
    const next = { ...langs, [media === 'image' ? `${provider ?? ''}:${model?.model ?? ''}` : `${vProvider ?? ''}:${vModel?.model ?? ''}`]: l }
    setLangs(next)
    await studio.ai.saveSettings({ promptLangs: next })
  }

  const request = (): GenRequest | null =>
    provider ? { provider, model: model?.model ?? (provider === 'codex' ? 'gpt-image' : ''), modelLabel: model?.label ?? (provider === 'codex' ? 'GPT 이미지 (Codex)' : undefined), style, kind: flat ? 'character' : kind, framing: showFraming ? framing : 'auto', ratio, lang, prompt: prompt.trim(), references: refs } : null

  const generate = async (req = request()) => {
    if (!req || busy) return
    if (!req.prompt) return toast('만들 이미지를 프롬프트 칸에 적어 주세요.', 'error')
    setBusy('image')
    try {
      const c = await studio.ai.generate(pid, req)
      setCandidates((l) => [c, ...l.filter((x) => x.id !== c.id)])
      if (c.character && !c.character.pass) toast('SVG로 바꿨지만 기준에 못 미쳐요. 후보 카드에서 확인해 주세요.', 'info')
      else if (req.revision?.length) toast('고친 후보를 만들었어요. 아래 후보에서 확인해 주세요.', 'success')
      return c
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const videoRequest = (): VideoGenRequest | null =>
    vProvider ? { provider: vProvider, model: vModel?.model ?? '', modelLabel: vModel?.label, lang, prompt: vPrompt.trim(), ratio: vRatio, duration, start: frames.start, end: frames.end } : null

  const generateVideo = async (req = videoRequest()) => {
    if (!req || busy) return
    if (!req.prompt && !req.start) return toast('어떻게 움직일지 프롬프트 칸에 적거나 시작 프레임을 골라 주세요.', 'error')
    if (req.end && !req.start) return toast('끝 프레임을 쓰려면 시작 프레임도 골라 주세요.', 'error')
    setBusy('video')
    try {
      const c = await studio.ai.generateVideo(pid, req)
      setCandidates((l) => [c, ...l.filter((x) => x.id !== c.id)])
      return c
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  /** ① / ② of a clip made from frames: an image at the clip's proportions, set as its start or end frame */
  const generateFrame = async (which: 'start' | 'end') => {
    const text = (which === 'start' ? startPrompt : endPrompt).trim()
    const base = request()
    if (!base) return toast('이미지를 만들 서비스가 없어요. AI 연결에서 힉스필드·매그니픽을 연결하거나 Codex에 로그인해 주세요.', 'error')
    if (!text) return toast(`${which === 'start' ? '시작' : '끝'} 프레임 프롬프트를 적어 주세요.`, 'error')
    setMaking(which)
    try {
      // the end frame follows the start frame's look when the model takes a reference image
      const refsFor = which === 'end' && frames.start?.startsWith('composition/') ? [frames.start.replace(/^composition\//, '')] : []
      const c = await generate({ ...base, style: 'none', kind: 'free', framing: 'auto', ratio: vRatio as Ratio, prompt: text, references: refsFor })
      if (c) setFrames((f) => ({ ...f, [which]: c.file }))
    } finally {
      setMaking(null)
    }
  }

  // 수정해서 다시 만들기: the same request plus the designer's change (and the previous image when the model takes it)
  const fromAsset = (from: string, prev?: string) => (from.startsWith('composition/') ? from : prev)
  const reviseImage = (req: GenRequest, from: string, note: string, useImage: boolean) =>
    generate({ ...req, revision: [...(req.revision ?? []), note], revisedFrom: useImage ? from : undefined, replacesAsset: fromAsset(from, req.replacesAsset) })
  const reviseVideo = (req: VideoGenRequest, from: string, note: string) => generateVideo({ ...req, revision: [...(req.revision ?? []), note], revisedFrom: from, replacesAsset: fromAsset(from, req.replacesAsset) })
  const reviseAsset = (a: Asset, note: string, useImage: boolean) => {
    const r = assetRequest(a)
    if (r?.video) return reviseVideo(r.video, `composition/${a.file}`, note)
    if (r?.image) return reviseImage(r.image, `composition/${a.file}`, note, useImage)
  }
  /** a revision of a brief asset can take that asset's place */
  const replaces = (c: GenCandidate) => {
    const from = c.video ? c.video.request.replacesAsset : c.request.replacesAsset
    return from ? brief.assets.find((a) => from === `composition/${a.file}`) : undefined
  }

  const imageAssets = brief.assets.filter((a) => a.meta.mime.startsWith('image/'))
  // images that can open or close a clip: the brief's own and the image candidates
  const frameChoices = [
    ...candidates.filter((c) => !c.video).map((c) => ({ path: c.file, label: c.request.prompt || '만든 이미지' })),
    ...imageAssets.map((a) => ({ path: `composition/${a.file}`, label: a.originalName })),
  ]
  const useAsFrame = (which: 'start' | 'end', path: string) => {
    setFrames((f) => ({ ...f, [which]: path }))
    setMedia('video')
    setOpen(true)
  }

  // what the resident helper sees, and where its prompt goes
  const scene = intent ? `장면 ${intent.scene} 「${intent.sceneTitle}」: ${intent.sceneDescription} · 필요한 소재: ${intent.material.label} (${intent.material.kind === 'video' ? '영상' : '이미지'}) · 영상 비율 ${out.width}×${out.height}` : undefined
  const frameRefs = [frames.start, frames.end].filter(Boolean).map((f) => f!.replace(/^composition\//, ''))
  const helperCtx: HelperCtx =
    media === 'image' || target === 'start' || target === 'end'
      ? {
          media: target === 'start' ? '시작 프레임 이미지' : target === 'end' ? '끝 프레임 이미지' : '이미지',
          model: model?.label ?? model?.model ?? '자동',
          lang: PROMPT_LANG_LABELS[langOf(model, provider)],
          style: media === 'image' ? STYLE_LABELS[style] : '스타일 없음',
          kind: media === 'image' ? KIND_LABELS[flat ? 'character' : kind] : '자유',
          framing: media === 'image' && showFraming ? FRAMING_LABELS[framing] : '-',
          prompt: target === 'start' ? startPrompt : target === 'end' ? endPrompt : prompt,
          projectId: pid,
          referenceFiles: media === 'image' ? refs : target === 'end' ? frameRefs.slice(0, 1) : [],
          scene,
        }
      : {
          media: '영상',
          model: vModel?.label ?? vModel?.model ?? '자동',
          lang: PROMPT_LANG_LABELS[lang],
          style: '-',
          kind: '-',
          framing: `시작 프레임 ${frames.start ? '있음' : '없음'} · 끝 프레임 ${frames.end ? '있음' : '없음'} · ${duration}초 · ${vRatio}`,
          prompt: vPrompt,
          projectId: pid,
          referenceFiles: frameRefs,
          scene,
        }
  const helperKey = JSON.stringify(helperCtx) + target
  useEffect(() => {
    const t = media === 'image' ? 'image' : target === 'image' ? 'video' : target
    useGenHelper.setState({
      ctx: helperCtx,
      target: t,
      use: (p: string) => {
        if (t === 'image') setPrompt(p)
        else if (t === 'start') setStartPrompt(p)
        else if (t === 'end') setEndPrompt(p)
        else setVPrompt(p)
      },
    })
  }, [helperKey, media]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => useGenHelper.setState({ ctx: null, use: null }), [])

  return (
    <div ref={box} className="card gen-card" style={{ padding: 0, overflow: 'hidden' }} data-testid="asset-generator">
      <button className="row" style={{ width: '100%', padding: '12px 14px', border: 'none', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--text)' }} onClick={() => setOpen(!open)} data-testid="gen-toggle" aria-expanded={open}>
        <Sparkles size={15} color="var(--accent)" />
        <span style={{ fontWeight: 650, textAlign: 'left' }} className="grow">
          AI로 만들기
        </span>
        {!open && candidates.length > 0 && <span className="badge accent">후보 {candidates.length}개</span>}
        <span className="tiny muted">이미지·영상을 만들어 소재함에 넣어요</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <div className="col" style={{ gap: 12, padding: 14 }}>
          {intent && (
            <div className="card row" style={{ padding: '8px 10px', gap: 8, borderColor: 'var(--accent)', background: 'var(--accent-soft)' }} data-testid="gen-intent">
              <Sparkles size={13} color="var(--accent)" />
              <span className="small grow">
                <b>장면 {intent.scene} · {intent.material.label}</b> 소재를 만들어요. 만든 결과에서 <b>이 장면에 넣기</b>를 누르면 콘티 칸에 바로 들어가요.
              </span>
              <button className="btn ghost sm" onClick={onIntentDone}>
                그만 만들기
              </button>
            </div>
          )}
          {revising && (
            <div className="card" style={{ padding: 10, display: 'grid', gridTemplateColumns: '84px 1fr', gap: 12, borderColor: 'var(--accent)', background: 'var(--accent-soft)' }} data-testid="revise-asset">
              <div style={{ width: 84, height: 84, borderRadius: 6, overflow: 'hidden', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {base && (revising.meta.mime.startsWith('video/') ? <video src={`${base}composition/${revising.file}`} muted style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <img src={`${base}composition/${revising.file}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />)}
              </div>
              <div className="col" style={{ gap: 6, minWidth: 0 }}>
                <div className="row small" style={{ gap: 6 }}>
                  <Wand2 size={13} color="var(--accent)" />
                  <b className="grow ellipsis">고칠 소재 · {revising.originalName}</b>
                </div>
                <div className="tiny muted ellipsis" title={revising.generated?.prompt}>
                  처음 프롬프트: {revising.generated?.prompt || '(없음)'}
                </div>
                {assetRequest(revising) ? (
                  <ReviseForm
                    video={revising.meta.mime.startsWith('video/')}
                    busy={!!busy}
                    onSubmit={(note, useImage) => void reviseAsset(revising, note, useImage)}
                    onCancel={() => setRevising(null)}
                  />
                ) : (
                  <div className="tiny" style={{ color: 'var(--warning)' }}>이 소재는 만든 서비스 정보가 없어 다시 만들 수 없어요. 아래에서 새로 만들어 주세요.</div>
                )}
              </div>
            </div>
          )}
          <Segmented
            value={media}
            onChange={setMedia}
            options={[
              { value: 'image', label: <span className="row" style={{ gap: 5 }}><ImageIcon size={13} />이미지</span> },
              { value: 'video', label: <span className="row" style={{ gap: 5 }}><Film size={13} />영상</span> },
            ]}
          />
          {media === 'image' && !providers.length && !codexUsable && (
            <div className="small" style={{ color: 'var(--warning)' }}>
              먼저 홈의 <b>AI 연결</b>에서 힉스필드나 매그니픽 계정을 연결하거나, 이 컴퓨터의 Codex CLI에 로그인해 주세요.
            </div>
          )}
          {media === 'video' && !videoProviders.length && (
            <div className="small" style={{ color: 'var(--warning)' }} data-testid="video-needs-account">
              영상은 <b>힉스필드</b>나 <b>매그니픽</b> 계정으로 만들어요. 홈의 <b>AI 연결</b>에서 연결해 주세요. (Codex는 이미지 전용이에요)
            </div>
          )}

          {media === 'image' ? (
            <>
              <div className="gen-grid" style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center' }}>
                <span className="small muted">이미지 모델</span>
                <div className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <ModelSelect kind="image" value={model} onChange={setModel} autoLabel={providers.length || !codexUsable ? '자동 (서비스 기본 모델)' : '자동 (Codex GPT 이미지)'} />
                  </div>
                  <LangPick lang={lang} onChange={(l) => void setLang(l)} />
                </div>
                <span className="small muted">스타일</span>
                <div className="col" style={{ gap: 4 }}>
                  <select className="select" value={style} onChange={(e) => setStyle(e.target.value as GenStyle)} data-testid="gen-style">
                    {(Object.keys(STYLE_LABELS) as GenStyle[]).map((s) => (
                      <option key={s} value={s}>
                        {STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {style !== 'none' && !flat && <span className="tiny muted">{LOOK_HINTS[style as LookStyle]}</span>}
                </div>
                <span className="small muted">종류</span>
                <div className="col" style={{ gap: 4 }}>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} data-testid="gen-kind">
                    {(Object.keys(KIND_LABELS) as GenKind[]).map((k) => {
                      const on = flat ? k === 'character' : kind === k
                      return (
                        <button
                          key={k}
                          className={`btn sm${on ? ' primary' : ''}`}
                          disabled={flat && k !== 'character'}
                          title={KIND_HINTS[k]}
                          onClick={() => {
                            setKind(k)
                            if (k === 'background' || k === 'scene') setRatio(out.width >= out.height ? '16:9' : '9:16')
                            else if (k !== 'free') setRatio(k === 'character' ? FRAMING_RATIO[framing] : '1:1')
                          }}
                        >
                          {KIND_LABELS[k]}
                        </button>
                      )
                    })}
                  </div>
                  <span className="tiny muted">{flat ? '플랫 캐릭터는 인물·캐릭터로만 만들어요.' : KIND_HINTS[kind]}</span>
                </div>
                {showFraming && (
                  <>
                    <span className="small muted">구도</span>
                    <Segmented
                      value={framing}
                      onChange={(f) => {
                        setFraming(f)
                        setRatio(FRAMING_RATIO[f])
                      }}
                      options={(Object.keys(FRAMING_LABELS) as Framing[]).map((f) => ({ value: f, label: FRAMING_LABELS[f] }))}
                    />
                  </>
                )}
                <span className="small muted">비율</span>
                <Segmented value={ratio} onChange={setRatio} options={RATIOS.map((r) => ({ value: r, label: r }))} />
              </div>
              {flat && (
                <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                  단색 면·외곽선 없는 캐릭터로 만들고 바로 SVG로 바꿔요. Claude가 이 캐릭터를 쓸 때 부위별로 나눠 깜빡임·놀람·울음 같은 연기를 만들어요. 표정은 모션에서 만들어지니 프롬프트에는 인상·옷·소품·배경색을 적어 주세요.
                </div>
              )}

              <div className="col" style={{ gap: 6 }}>
                <div className="row">
                  <span className="small muted grow">프롬프트 · 적은 그대로 보내요{style !== 'none' || kind !== 'free' ? ' (스타일·종류 문장만 앞에 붙어요)' : ''}</span>
                  <span className="tiny faint">
                    <MessageCircle size={11} /> 오른쪽 도우미가 함께 써 줘요
                  </span>
                </div>
                <textarea className="textarea" rows={4} value={prompt} onFocus={() => setTarget('image')} onChange={(e) => setPrompt(e.target.value)} placeholder={PLACEHOLDER[flat ? 'character' : kind]} data-testid="gen-prompt" />
              </div>

              {imageAssets.length > 0 && (
                <div className="col" style={{ gap: 6 }}>
                  <span className="small muted">참고 소재 (선택)</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {imageAssets.map((a) => {
                      const on = refs.includes(a.file)
                      return (
                        <button
                          key={a.id}
                          title={a.originalName}
                          onClick={() => setRefs(on ? refs.filter((r) => r !== a.file) : [...refs, a.file])}
                          style={{ position: 'relative', width: 54, height: 54, padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--canvas)' }}
                        >
                          {base && <img src={`${base}composition/${a.file}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          {on && <Check size={14} color="#fff" style={{ position: 'absolute', right: 2, top: 2, background: 'var(--accent)', borderRadius: 7 }} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="row">
                <span className="tiny faint grow">{provider === 'codex' ? '이 컴퓨터 Codex의 ChatGPT 한도에서 써요. 한 장에 1분쯤 걸려요.' : '만들 때마다 고른 계정의 크레딧을 써요.'}</span>
                <button className="btn primary" disabled={!!busy || !provider || !prompt.trim()} onClick={() => void generate()} data-testid="gen-run">
                  {busy === 'image' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                  {busy === 'image' ? (flat ? '만들고 SVG로 바꾸는 중…' : '만드는 중…') : '만들기'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="gen-grid" style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center' }}>
                <span className="small muted">영상 모델</span>
                <div className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <ModelSelect kind="video" value={vModel} onChange={setVModel} autoLabel="자동 (서비스 기본 모델)" />
                  </div>
                  <LangPick lang={lang} onChange={(l) => void setLang(l)} />
                </div>
                <span className="small muted">길이</span>
                <Segmented value={String(duration)} onChange={(v) => setDuration(Number(v))} options={VIDEO_DURATIONS.map((d) => ({ value: String(d), label: `${d}초` }))} />
                <span className="small muted">비율</span>
                <Segmented value={vRatio} onChange={setVRatio} options={VIDEO_RATIOS.map((r) => ({ value: r, label: r }))} />
              </div>

              <Segmented
                value={vMode}
                onChange={(v) => {
                  setVMode(v)
                  setTarget(v === 'frames' && !frames.start ? 'start' : 'video')
                }}
                options={[
                  { value: 'direct', label: '바로 만들기' },
                  { value: 'frames', label: '시작·끝 프레임 먼저' },
                ]}
              />
              {vMode === 'frames' ? (
                <div className="col" style={{ gap: 10 }} data-testid="frame-steps">
                  {(['start', 'end'] as const).map((which, i) => (
                    <div key={which} className="card" style={{ padding: 10, display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, background: 'var(--surface-2)' }}>
                      <FrameSlot label={which === 'start' ? '시작 프레임' : '끝 프레임'} value={frames[which]} base={base} choices={frameChoices} onChange={(v) => setFrames((f) => ({ ...f, [which]: v }))} testId={`frame-${which}`} />
                      <div className="col" style={{ gap: 6, minWidth: 0 }}>
                        <span className="small">
                          <b>{i === 0 ? '①' : '②'}</b> {which === 'start' ? '시작' : '끝'} 프레임 이미지{which === 'end' ? ' (선택 · 받는 모델만, 예: Kling)' : ''}
                        </span>
                        <textarea
                          className="textarea"
                          rows={3}
                          value={which === 'start' ? startPrompt : endPrompt}
                          onFocus={() => setTarget(which)}
                          onChange={(e) => (which === 'start' ? setStartPrompt : setEndPrompt)(e.target.value)}
                          placeholder={which === 'start' ? '첫 장면 그림을 적어요. 예) 아침 햇살이 드는 주방, 식탁 위 민트색 텀블러' : '마지막 장면 그림을 적어요. 예) 같은 주방, 텀블러를 든 손이 화면 앞으로'}
                          data-testid={`${which}-prompt`}
                        />
                        <div className="row" style={{ gap: 6 }}>
                          <span className="tiny faint grow">이미지 모델: {model?.label ?? (provider === 'codex' ? 'GPT 이미지 (Codex)' : '자동')} · {vRatio}</span>
                          <button className="btn sm" disabled={!!busy || !provider} onClick={() => void generateFrame(which)} data-testid={`${which}-make`}>
                            {making === which ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                            {making === which ? '만드는 중…' : frames[which] ? '다시 만들기' : '이미지 만들기'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="col" style={{ gap: 6 }}>
                  <span className="small muted">시작·끝 프레임 · 이 이미지에서 시작해 저 이미지로 끝나요 (선택)</span>
                  <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
                    <FrameSlot label="시작 프레임" value={frames.start} base={base} choices={frameChoices} onChange={(v) => setFrames((f) => ({ ...f, start: v }))} testId="frame-start" />
                    <button className="icon-btn" style={{ alignSelf: 'center' }} title="시작·끝 바꾸기" disabled={!frames.start && !frames.end} onClick={() => setFrames((f) => ({ start: f.end, end: f.start }))}>
                      <ArrowLeftRight size={14} />
                    </button>
                    <FrameSlot label="끝 프레임" value={frames.end} base={base} choices={frameChoices} onChange={(v) => setFrames((f) => ({ ...f, end: v }))} testId="frame-end" />
                  </div>
                  <span className="tiny muted">이미지 탭에서 만든 후보나 소재함의 이미지를 고를 수 있어요. 끝 프레임은 받는 모델만 써요(예: Kling 3.0).</span>
                </div>
              )}

              <div className="col" style={{ gap: 6 }}>
                <div className="row">
                  <span className="small muted grow">
                    {vMode === 'frames' ? <b>③ </b> : null}움직임 프롬프트 · 적은 그대로 보내요
                  </span>
                </div>
                <textarea className="textarea" rows={3} value={vPrompt} onFocus={() => setTarget('video')} onChange={(e) => setVPrompt(e.target.value)} placeholder="예) 카메라가 천천히 다가가고, 캐릭터가 고개를 들어 손을 흔든다. 부드럽고 경쾌한 리듬." data-testid="video-prompt" />
              </div>

              <div className="row">
                <span className="tiny faint grow">고른 계정의 크레딧을 써요. 한 편에 몇 분 걸려요.</span>
                <button className="btn primary" disabled={!!busy || !vProvider} onClick={() => void generateVideo()} data-testid="video-run">
                  {busy === 'video' ? <Loader2 size={14} className="spin" /> : <Film size={14} />}
                  {busy === 'video' ? '영상을 만드는 중… (몇 분 걸려요)' : '영상 만들기'}
                </button>
              </div>
            </>
          )}

          {candidates.length > 0 && (
            <div className="col" style={{ gap: 8 }}>
              <span className="section-label">만든 후보 · 소재에 넣을 것을 골라요</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {candidates.map((c) => (
                  <CandidateCard
                    key={c.id}
                    c={c}
                    base={base}
                    onKeep={async () => {
                      try {
                        onAdd(await studio.ai.keepCandidate(pid, c.id))
                        setCandidates((l) => l.filter((x) => x.id !== c.id))
                        setFrames((f) => ({ start: f.start === c.file ? undefined : f.start, end: f.end === c.file ? undefined : f.end }))
                        toast('소재에 넣었어요', 'success')
                      } catch (e) {
                        toast(errText(e), 'error')
                      }
                    }}
                    onDiscard={async () => {
                      setFrames((f) => ({ start: f.start === c.file ? undefined : f.start, end: f.end === c.file ? undefined : f.end }))
                      setCandidates(await studio.ai.discardCandidate(pid, c.id))
                    }}
                    onAgain={() => void (c.video ? generateVideo(c.video.request) : generate(c.request))}
                    onRevise={(note, useImage) => void (c.video ? reviseVideo(c.video.request, c.file, note) : reviseImage(c.request, c.file, note, useImage))}
                    replaces={onReplace ? replaces(c) : undefined}
                    onReplace={async () => {
                      const old = replaces(c)
                      if (!old || !onReplace) return
                      try {
                        const a = await studio.ai.keepCandidate(pid, c.id)
                        // the new picture takes the old one's place, role and notes — in the brief and in the video
                        onReplace(old.id, { ...a, kind: old.kind, required: old.required, timing: old.timing, position: old.position, transform: old.transform, note: old.note })
                        const used = await studio.projects.replaceAssetFile(pid, old.file, a.file)
                        setCandidates((l) => l.filter((x) => x.id !== c.id))
                        setRevising(null)
                        toast(used ? '소재를 고친 것으로 바꿨어요. 영상 속 그림도 바뀌었어요.' : '소재를 고친 것으로 바꿨어요', 'success')
                      } catch (e) {
                        toast(errText(e), 'error')
                      }
                    }}
                    onFrame={c.video ? undefined : (which) => useAsFrame(which, c.file)}
                    onApply={
                      intent && onApply && (intent.material.kind === 'video') === !!c.video
                        ? async () => {
                            try {
                              const a = await studio.ai.keepCandidate(pid, c.id)
                              await onApply(a)
                              setCandidates((l) => l.filter((x) => x.id !== c.id))
                              toast(`장면 ${intent.scene}의 「${intent.material.label}」에 넣었어요`, 'success')
                              onIntentDone?.()
                            } catch (e) {
                              toast(errText(e), 'error')
                            }
                          }
                        : undefined
                    }
                    onReconvert={async () => {
                      try {
                        const info = await studio.ai.reconvert(pid, c.character!.dir, c.request.framing, Math.max(6, (c.character!.colors ?? 14) - 4))
                        setCandidates((l) => l.map((x) => (x.id === c.id ? { ...x, character: info } : x)))
                      } catch (e) {
                        toast(errText(e), 'error')
                      }
                    }}
                    busy={!!busy}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER: Record<GenKind, string> = {
  free: '예) 비 오는 밤 네온사인이 비치는 골목, 젖은 바닥에 번지는 불빛',
  character: '예) 초록 야구모자를 살짝 비스듬히 쓴 여덟 살 개구쟁이 소년, 주황 후드티, 따뜻한 노란 배경',
  object: '예) 민트색 무광 보온 텀블러, 뚜껑은 크림색, 연한 하늘색 배경',
  element: '예) 반짝이는 금색 코인, 가운데 별 무늬, 연한 남색 배경',
  background: '예) 아침 햇살이 드는 아늑한 카페 내부, 따뜻한 베이지 톤, 가운데는 비워 두기',
  scene: '예) 카페 카운터에서 바리스타가 웃으며 손님에게 커피를 건네는 장면',
}

function LangPick({ lang, onChange }: { lang: PromptLang; onChange(l: PromptLang): void }) {
  return (
    <>
      <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
        프롬프트 언어
      </span>
      <Segmented value={lang} onChange={onChange} options={(['en', 'zh', 'ko'] as const).map((l) => ({ value: l, label: PROMPT_LANG_LABELS[l] }))} />
    </>
  )
}

/** a first / last frame: one of the images, or none */
function FrameSlot({ label, value, base, choices, onChange, testId }: { label: string; value?: string; base: string; choices: { path: string; label: string }[]; onChange(v?: string): void; testId: string }) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="col grow" style={{ gap: 6, minWidth: 0 }} data-testid={testId}>
      <button
        onClick={() => setPicking(!picking)}
        style={{ position: 'relative', height: 120, padding: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', border: `1.5px ${value ? 'solid var(--accent)' : 'dashed var(--border)'}`, background: 'var(--canvas)', color: 'var(--text-3)' }}
        title={value ? '다른 이미지로 바꾸기' : '이미지 고르기'}
      >
        {value && base ? <img src={`${base}${value}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="small">{label} 고르기</span>}
        <span className="badge" style={{ position: 'absolute', left: 6, top: 6 }}>
          {label}
        </span>
      </button>
      {value && (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(undefined)}>
          <X size={12} />
          빼기
        </button>
      )}
      {picking && (
        <div className="card" style={{ padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6, maxHeight: 220, overflow: 'auto' }} data-testid={`${testId}-choices`}>
          {choices.length === 0 && <span className="tiny muted" style={{ gridColumn: '1 / -1' }}>이미지 탭에서 먼저 만들거나, 브리프 소재에 이미지를 올려 주세요.</span>}
          {choices.map((c) => (
            <button
              key={c.path}
              title={c.label}
              onClick={() => {
                onChange(c.path)
                setPicking(false)
              }}
              style={{ aspectRatio: '1', padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${c.path === value ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--canvas)' }}
            >
              {base && <img src={`${base}${c.path}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CandidateCard({ c, base, busy, onKeep, onDiscard, onAgain, onRevise, onReconvert, onFrame, replaces, onReplace, onApply }: { c: GenCandidate; base: string; busy: boolean; onKeep(): void; onDiscard(): void; onAgain(): void; onRevise(note: string, useImage: boolean): void; onReconvert(): Promise<void>; onFrame?(which: 'start' | 'end'): void; replaces?: Asset; onReplace?(): void; onApply?(): void }) {
  const [compare, setCompare] = useState(false)
  const [working, setWorking] = useState(false)
  const [revising, setRevising] = useState(false)
  const notes = (c.video ? c.video.request.revision : c.request.revision) ?? []
  return (
    <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="gen-candidate">
      <div style={{ aspectRatio: '1', background: 'var(--canvas)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {base && c.video && <video src={`${base}${c.file}`} poster={`${base}${c.video.poster}`} controls muted loop playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} data-testid="gen-video" />}
        {base && !c.video && <img src={`${base}${c.file}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        {c.video && (
          <span className="badge" style={{ position: 'absolute', left: 6, top: 6 }}>
            <Film size={11} />
            영상{c.video.duration ? ` · ${c.video.duration.toFixed(1)}초` : ''}
          </span>
        )}
      </div>
      <div className="tiny muted ellipsis" title={c.request.prompt}>
        {[c.request.style !== 'none' && !c.video ? STYLE_LABELS[c.request.style] : '', c.request.kind && c.request.kind !== 'free' ? KIND_LABELS[c.request.kind] : '', c.request.prompt].filter(Boolean).join(' · ')}
      </div>
      {notes.length > 0 && (
        <div className="tiny" style={{ color: 'var(--accent)' }} title={notes.join('\n')} data-testid="candidate-revision">
          고친 점: {notes[notes.length - 1]}
          {notes.length > 1 ? ` (${notes.length}번째 수정)` : ''}
        </div>
      )}
      {c.character && <CharacterLine info={c.character} onCompare={() => setCompare(true)} />}
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {replaces && onReplace && (
          <button className="btn sm primary" onClick={onReplace} title={`브리프의 "${replaces.originalName}" 자리에 넣어요`} data-testid="candidate-replace">
            <RefreshCw size={12} />
            기존 소재와 바꾸기
          </button>
        )}
        {onApply && (
          <button className="btn sm primary" onClick={onApply} title="소재함에 넣고 콘티의 그 칸에 바로 넣어요" data-testid="candidate-apply">
            <Check size={12} />
            이 장면에 넣기
          </button>
        )}
        <button className={`btn sm${replaces || onApply ? '' : ' primary'}`} onClick={onKeep}>
          <ImagePlus size={12} />
          소재에 추가
        </button>
        <button className="btn sm ghost" onClick={onDiscard} title="버리기">
          <Trash2 size={12} />
        </button>
        <div className="grow" />
        {c.character && c.character.status === 'done' && !c.character.pass && (
          <button
            className="btn sm"
            disabled={working}
            title="색 수를 줄여 다시 바꿔요"
            onClick={async () => {
              setWorking(true)
              await onReconvert()
              setWorking(false)
            }}
          >
            {working ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            다시 변환
          </button>
        )}
        <button className={`btn sm${revising ? ' primary' : ' ghost'}`} disabled={busy} onClick={() => setRevising(!revising)} title="고칠 점을 적어 다시 만들어요" data-testid="candidate-revise">
          <Wand2 size={12} />
          다시 만들기
        </button>
      </div>
      {revising && (
        <ReviseForm
          video={!!c.video}
          busy={busy}
          onSubmit={(note, useImage) => {
            setRevising(false)
            onRevise(note, useImage)
          }}
          onSame={() => {
            setRevising(false)
            onAgain()
          }}
          onCancel={() => setRevising(false)}
        />
      )}
      {onFrame && (
        <div className="row tiny" style={{ gap: 4 }}>
          <Film size={11} color="var(--text-3)" />
          <span className="muted grow">영상으로</span>
          <button className="btn ghost sm" style={{ height: 22 }} onClick={() => onFrame('start')} data-testid="as-start-frame">
            시작 프레임
          </button>
          <button className="btn ghost sm" style={{ height: 22 }} onClick={() => onFrame('end')} data-testid="as-end-frame">
            끝 프레임
          </button>
        </div>
      )}
      {compare && c.character && <CompareModal dir={c.character.dir} base={base} onClose={() => setCompare(false)} />}
    </div>
  )
}

/** what to change in an image / clip the designer did not like: only the change is written, the rest of the request stays */
function ReviseForm({ video, busy, onSubmit, onSame, onCancel }: { video: boolean; busy: boolean; onSubmit(note: string, useImage: boolean): void; onSame?(): void; onCancel(): void }) {
  const [note, setNote] = useState('')
  const [useImage, setUseImage] = useState(true)
  const submit = () => note.trim() && !busy && onSubmit(note.trim(), useImage)
  return (
    <div className="col" style={{ gap: 6 }} data-testid="revise-form">
      <textarea
        className="textarea"
        rows={2}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
        placeholder={video ? '어떻게 고칠까요? 예) 카메라를 더 천천히, 마지막에 제품 쪽으로 다가가게' : '어떻게 고칠까요? 예) 머리를 더 짧게, 배경은 연한 하늘색으로'}
        data-testid="revise-note"
      />
      {!video && (
        <label className="row tiny muted" style={{ gap: 6, cursor: 'pointer' }} title="이미지를 받는 모델이면 지금 그림을 함께 보내 그대로 두고 고친 점만 바꿔요. 받지 않는 모델이면 글로만 고쳐요.">
          <input type="checkbox" checked={useImage} onChange={(e) => setUseImage(e.target.checked)} />
          지금 그림을 바탕으로 고치기
        </label>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm primary" disabled={busy || !note.trim()} onClick={submit} data-testid="revise-run">
          {busy ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
          고쳐서 다시 만들기
        </button>
        {onSame && (
          <button className="btn sm ghost" disabled={busy} onClick={onSame} title="고칠 점 없이 같은 설정으로 한 번 더 만들어요">
            같은 설정으로 다시
          </button>
        )}
        <div className="grow" />
        <button className="btn sm ghost" onClick={onCancel}>
          닫기
        </button>
      </div>
    </div>
  )
}

/** "SVG 도형 26개 · 차이 0.3% ✓" with the reasons when it fails */
export function CharacterLine({ info, onCompare }: { info: CharacterInfo; onCompare?(): void }) {
  if (info.status === 'converting')
    return (
      <div className="row tiny muted" style={{ gap: 4 }}>
        <Loader2 size={11} className="spin" />
        SVG로 바꾸는 중
      </div>
    )
  if (info.status === 'failed') return <div className="tiny" style={{ color: 'var(--danger)' }}>{info.message ?? 'SVG로 바꾸지 못했어요.'}</div>
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="row tiny" style={{ gap: 4, color: info.pass ? 'var(--success)' : 'var(--warning)' }}>
        {info.pass ? <Check size={11} /> : <X size={11} />}
        <span className="grow">
          SVG 도형 {info.shapes}개 · 차이 {info.badPct}%{info.tagged ? ' · 부위 나눔 완료' : ''}
        </span>
        {onCompare && (
          <button className="btn ghost sm" style={{ height: 20, padding: '0 6px', fontSize: 11 }} onClick={onCompare}>
            비교 보기
          </button>
        )}
      </div>
      {!info.pass && info.reasons?.map((r) => (
        <div key={r} className="tiny muted">
          {r}
        </div>
      ))}
      {!info.pass && <div className="tiny muted">색을 줄여 다시 변환하거나, 단색 배경·외곽선 없는 그림으로 다시 만들어 보세요.</div>}
    </div>
  )
}

export function CompareModal({ dir, base, onClose }: { dir: string; base: string; onClose(): void }) {
  return (
    <Modal title="SVG 변환 확인 · 원본 | SVG | 차이" onClose={onClose} width={980}>
      <img src={`${base}${dir}/vector_compare.png?v=${Date.now()}`} style={{ width: '100%', borderRadius: 6, background: 'var(--canvas)' }} />
      <div className="tiny muted">빨간 곳이 원본과 많이 다른 부분이에요. 1% 이하면 깔끔하게 바뀐 거예요.</div>
    </Modal>
  )
}

interface HelperMsg {
  role: 'user' | 'helper'
  text: string
  reply?: HelperReply
}

/**
 * The prompt helper (Haiku 5.5), always beside the 소재 panel: it reads the generator's form
 * (useGenHelper) and its prompt goes into the prompt box last focused with one click. Images
 * dropped on it (from the computer, the library or a storyboard sketch) are looked at too.
 */
export function PromptHelper() {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const { ctx, target, use } = useGenHelper()
  const [sid, setSid] = useState(() => crypto.randomUUID())
  const [msgs, setMsgs] = useState<HelperMsg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropped, setDropped] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [base, setBase] = useState('')
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [msgs.length, busy])
  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setMsgs((m) => [...m, { role: 'user', text: t }])
    setBusy(true)
    try {
      const c = ctx ?? { media: '이미지', model: '자동', lang: '영어', style: '스타일 없음', kind: '자유', framing: '-', prompt: '', projectId: pid, referenceFiles: [] }
      const r = await studio.ai.askHelper(sid, t, { ...c, referenceFiles: [...c.referenceFiles, ...dropped] } as never)
      setMsgs((m) => [...m, { role: 'helper', text: r.text, reply: r }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'helper', text: errText(e) }])
    } finally {
      setBusy(false)
    }
  }
  /** images from the computer are copied into the project (feedback/refs) so the helper may read them */
  const addFiles = async (paths: string[]) => {
    const imgs = paths.filter((p) => /\.(png|jpe?g|webp|gif)$/i.test(p))
    if (!imgs.length) return toast('참고할 이미지(png·jpg·webp)를 넣어 주세요.', 'error')
    const rels: string[] = []
    for (const f of imgs.slice(0, 4)) rels.push(await studio.projects.addFeedbackImage(pid, f))
    setDropped((d) => [...d, ...rels].slice(-4))
  }
  const url = (rel: string) => (/^(\.studio|feedback|references)\//.test(rel) ? base + rel : `${base}composition/${rel}`)
  const all = [...(ctx?.referenceFiles ?? []), ...dropped]
  return (
    <div
      className="col"
      style={{ height: '100%', gap: 8, padding: 12, background: 'var(--surface-2)', outline: over ? '2px dashed var(--accent)' : 'none', outlineOffset: -4 }}
      data-testid="prompt-helper"
      onDragOver={(e) => {
        const types = [...e.dataTransfer.types]
        if (!types.includes('Files') && !types.includes(ASSET_DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const asset = e.dataTransfer.getData(ASSET_DRAG_TYPE)
        if (asset) {
          if (!/\.(png|jpe?g|webp|gif)$/i.test(asset)) return toast('이미지 소재만 참고할 수 있어요.', 'error')
          return setDropped((d) => [...d.filter((x) => x !== asset), asset].slice(-4))
        }
        void addFiles([...e.dataTransfer.files].map((f) => studio.app.pathForFile(f)).filter(Boolean))
      }}
    >
      <div className="row" style={{ gap: 6 }}>
        <MessageCircle size={14} color="var(--accent)" />
        <b className="grow">프롬프트 도우미</b>
        <span className="tiny faint">Haiku 5.5</span>
        <button
          className="btn ghost sm"
          style={{ height: 22 }}
          onClick={() => {
            setSid(crypto.randomUUID())
            setMsgs([])
            setDropped([])
          }}
        >
          새 대화
        </button>
      </div>
      <div className="tiny muted" style={{ lineHeight: 1.5 }}>
        지금 쓰는 칸: {targetLabel(target)}. 원하는 그림이나 움직임을 말하면 프롬프트를 써 줘요. 참고 이미지는 여기로 끌어 놓으세요.
        {ctx?.scene ? ` · ${ctx.scene.split(' · ')[0]}` : ''}
      </div>
      {all.length > 0 && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {all.map((r) => (
            <div key={r} style={{ position: 'relative', width: 40, height: 40 }}>
              {base && <img src={url(r)} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--border)' }} />}
              {dropped.includes(r) && (
                <button className="icon-btn" title="빼기" onClick={() => setDropped((d) => d.filter((x) => x !== r))} style={{ position: 'absolute', right: -6, top: -6, width: 16, height: 16, borderRadius: 8, background: 'var(--surface-3)' }}>
                  <X size={9} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div ref={list} className="col grow" style={{ gap: 8, overflow: 'auto', minHeight: 0 }}>
        {msgs.length === 0 && <div className="tiny faint">예) 비 오는 밤 골목의 네온, 영어로 · 첫 프레임은 텀블러 클로즈업으로</div>}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="small" style={{ alignSelf: 'flex-end', background: 'var(--accent)', color: '#fff', padding: '6px 10px', borderRadius: 10, maxWidth: '88%' }}>
              {m.text}
            </div>
          ) : (
            <div key={i} className="col" style={{ gap: 6, background: 'var(--surface)', padding: '8px 10px', borderRadius: 10, maxWidth: '96%' }}>
              {m.reply?.prompt ? (
                <>
                  <div className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, userSelect: 'text' }}>{m.reply.prompt}</div>
                  {m.reply.memo && <div className="tiny muted" style={{ whiteSpace: 'pre-wrap' }}>{m.reply.memo}</div>}
                  <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} disabled={!use} onClick={() => use?.(m.reply!.prompt!)} data-testid="helper-use">
                    {targetLabel(target)} 칸에 넣기
                  </button>
                </>
              ) : (
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="row tiny muted" style={{ gap: 6 }}>
            <Loader2 size={12} className="spin" />
            도우미가 쓰는 중
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input grow"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send()}
          placeholder="원하는 그림이나 움직임을 말해 주세요"
          data-testid="helper-input"
        />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

const ASSET_DRAG_TYPE = 'application/x-ms-asset'
