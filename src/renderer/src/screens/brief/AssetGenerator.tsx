// 소재 > AI로 만들기: image model + style + framing + ratio + the designer's own
// prompt (sent as written; only the style's sentences are put in front), optional
// reference assets, and a small prompt helper chat. Results wait as candidates to
// be added to the brief's assets or discarded. Flat characters are converted to
// SVG right away and show how clean the conversion is.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ImagePlus, Loader2, MessageCircle, RefreshCw, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import {
  defaultPromptLang,
  FRAMING_LABELS,
  FRAMING_RATIO,
  PROMPT_LANG_LABELS,
  RATIOS,
  STYLE_LABELS,
  type CharacterInfo,
  type Framing,
  type GenCandidate,
  type GenRequest,
  type GenStyle,
  type PromptLang,
  type Ratio,
} from '@shared/assetGen'
import type { AiModelRef, Asset, Brief } from '@shared/brief'
import type { HelperReply } from '@shared/api'
import { ModelSelect } from '../../components/ai/ModelSelect'
import { Modal, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function AssetGenerator({ brief, onAdd }: { brief: Brief; onAdd(a: Asset): void }) {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const [open, setOpen] = useState(true)
  const [model, setModel] = useState<AiModelRef | null>(brief.ai.image ?? null)
  const [style, setStyle] = useState<GenStyle>('flat-character')
  const [framing, setFraming] = useState<Framing>('auto')
  const [ratio, setRatio] = useState<Ratio>('1:1')
  const [langs, setLangs] = useState<Record<string, PromptLang>>({})
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<GenCandidate[]>([])
  const [helper, setHelper] = useState(false)
  const [providers, setProviders] = useState<string[]>([])
  const [codexUsable, setCodexUsable] = useState(false)
  const [base, setBase] = useState('')

  useEffect(() => {
    void studio.ai.candidates(pid).then(setCandidates)
    void studio.ai.settings().then((s) => setLangs(s.promptLangs ?? {}))
    void studio.ai.accounts().then((a) => setProviders([...new Set(a.filter((x) => x.active && !x.needsLogin).map((x) => x.provider))]))
    void studio.ai.codexStatus().then((c) => setCodexUsable(c.usable)).catch(() => null)
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])

  // 자동: the active account's service default, else Codex (GPT Image) when it can be used
  const provider = (model?.provider ?? (providers[0] as GenRequest['provider'] | undefined) ?? (codexUsable ? 'codex' : undefined)) as GenRequest['provider'] | undefined
  const modelKey = `${provider ?? ''}:${model?.model ?? ''}`
  const lang: PromptLang = langs[modelKey] ?? defaultPromptLang(`${model?.model ?? ''} ${model?.label ?? ''}`)
  const setLang = async (l: PromptLang) => {
    const next = { ...langs, [modelKey]: l }
    setLangs(next)
    await studio.ai.saveSettings({ promptLangs: next })
  }

  const request = (): GenRequest | null =>
    provider ? { provider, model: model?.model ?? (provider === 'codex' ? 'gpt-image' : ''), modelLabel: model?.label ?? (provider === 'codex' ? 'GPT 이미지 (Codex)' : undefined), style, framing, ratio, lang, prompt: prompt.trim(), references: refs } : null

  const generate = async (req = request()) => {
    if (!req || busy) return
    if (!req.prompt) return toast('만들 이미지를 프롬프트 칸에 적어 주세요.', 'error')
    setBusy(true)
    try {
      const c = await studio.ai.generate(pid, req)
      setCandidates((l) => [c, ...l.filter((x) => x.id !== c.id)])
      if (c.character && !c.character.pass) toast('SVG로 바꿨지만 기준에 못 미쳐요. 후보 카드에서 확인해 주세요.', 'info')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const imageAssets = brief.assets.filter((a) => a.meta.mime.startsWith('image/'))

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }} data-testid="asset-generator">
      <button className="row" style={{ width: '100%', padding: '12px 14px', border: 'none', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--text)' }} onClick={() => setOpen(!open)}>
        <Sparkles size={15} color="var(--accent)" />
        <span style={{ fontWeight: 650, textAlign: 'left' }} className="grow">
          AI로 만들기
        </span>
        <span className="tiny muted">이미지 모델로 소재를 만들어 바로 소재에 넣어요</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && (
        <div className="col" style={{ gap: 12, padding: 14 }}>
          {!providers.length && !codexUsable && (
            <div className="small" style={{ color: 'var(--warning)' }}>
              먼저 홈의 <b>AI 연결</b>에서 힉스필드나 매그니픽 계정을 연결하거나, 이 컴퓨터의 Codex CLI에 로그인해 주세요.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '10px 12px', alignItems: 'center' }}>
            <span className="small muted">이미지 모델</span>
            <div className="row" style={{ gap: 8 }}>
              <div className="grow">
                <ModelSelect kind="image" value={model} onChange={setModel} autoLabel={providers.length || !codexUsable ? '자동 (서비스 기본 모델)' : '자동 (Codex GPT 이미지)'} />
              </div>
              <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                프롬프트 언어
              </span>
              <Segmented value={lang} onChange={(l) => void setLang(l)} options={(['en', 'zh', 'ko'] as const).map((l) => ({ value: l, label: PROMPT_LANG_LABELS[l] }))} />
            </div>
            <span className="small muted">스타일</span>
            <select className="select" value={style} onChange={(e) => setStyle(e.target.value as GenStyle)} data-testid="gen-style">
              {(Object.keys(STYLE_LABELS) as GenStyle[]).map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s]}
                </option>
              ))}
            </select>
            {style === 'flat-character' && (
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
          {style === 'flat-character' && (
            <div className="tiny muted" style={{ lineHeight: 1.6 }}>
              단색 면·외곽선 없는 캐릭터로 만들고 바로 SVG로 바꿔요. Claude가 이 캐릭터를 쓸 때 부위별로 나눠 깜빡임·놀람·울음 같은 연기를 만들어요. 표정은 모션에서 만들어지니 프롬프트에는 인상·옷·소품·배경색을 적어 주세요.
            </div>
          )}

          <div className="col" style={{ gap: 6 }}>
            <div className="row">
              <span className="small muted grow">프롬프트 · 적은 그대로 보내요{style === 'flat-character' ? ' (스타일 문장만 앞에 붙어요)' : ''}</span>
              <button className={`btn sm${helper ? ' primary' : ''}`} onClick={() => setHelper(!helper)} data-testid="helper-toggle">
                <MessageCircle size={13} />
                프롬프트 도우미
              </button>
            </div>
            <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="예) 초록 야구모자를 살짝 비스듬히 쓴 여덟 살 개구쟁이 소년, 주황 후드티, 따뜻한 노란 배경" data-testid="gen-prompt" />
          </div>
          {helper && (
            <PromptHelper
              ctx={{ model: model?.label ?? model?.model ?? '자동', lang: PROMPT_LANG_LABELS[lang], style: STYLE_LABELS[style], framing: style === 'flat-character' ? FRAMING_LABELS[framing] : '-', prompt, projectId: pid, referenceFiles: refs }}
              refsCount={refs.length}
              onUse={setPrompt}
            />
          )}

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
            <button className="btn primary" disabled={busy || !provider || !prompt.trim()} onClick={() => void generate()} data-testid="gen-run">
              {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              {busy ? (style === 'flat-character' ? '만들고 SVG로 바꾸는 중…' : '만드는 중…') : '만들기'}
            </button>
          </div>

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
                        toast('소재에 넣었어요', 'success')
                      } catch (e) {
                        toast(errText(e), 'error')
                      }
                    }}
                    onDiscard={async () => setCandidates(await studio.ai.discardCandidate(pid, c.id))}
                    onAgain={() => void generate(c.request)}
                    onReconvert={async () => {
                      try {
                        const info = await studio.ai.reconvert(pid, c.character!.dir, c.request.framing, Math.max(6, (c.character!.colors ?? 14) - 4))
                        setCandidates((l) => l.map((x) => (x.id === c.id ? { ...x, character: info } : x)))
                      } catch (e) {
                        toast(errText(e), 'error')
                      }
                    }}
                    busy={busy}
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

function CandidateCard({ c, base, busy, onKeep, onDiscard, onAgain, onReconvert }: { c: GenCandidate; base: string; busy: boolean; onKeep(): void; onDiscard(): void; onAgain(): void; onReconvert(): Promise<void> }) {
  const [compare, setCompare] = useState(false)
  const [working, setWorking] = useState(false)
  return (
    <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="gen-candidate">
      <div style={{ aspectRatio: '1', background: 'var(--canvas)', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {base && <img src={`${base}${c.file}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
      </div>
      <div className="tiny muted ellipsis" title={c.request.prompt}>
        {c.request.prompt}
      </div>
      {c.character && <CharacterLine info={c.character} onCompare={() => setCompare(true)} />}
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button className="btn sm primary" onClick={onKeep}>
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
        <button className="btn sm ghost" disabled={busy} onClick={onAgain} title="같은 설정으로 다시 만들어요">
          다시 만들기
        </button>
      </div>
      {compare && c.character && <CompareModal dir={c.character.dir} base={base} onClose={() => setCompare(false)} />}
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

/** mini chat with the prompt helper (latest Haiku); its prompt goes into the box with one click */
function PromptHelper({ ctx, refsCount, onUse }: { ctx: { model: string; lang: string; style: string; framing: string; prompt: string; projectId: string; referenceFiles: string[] }; refsCount: number; onUse(p: string): void }) {
  const [sid, setSid] = useState(() => crypto.randomUUID())
  const [msgs, setMsgs] = useState<HelperMsg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef<HTMLDivElement>(null)
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
      const r = await studio.ai.askHelper(sid, t, ctx)
      setMsgs((m) => [...m, { role: 'helper', text: r.text, reply: r }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'helper', text: errText(e) }])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card" style={{ padding: 10, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="prompt-helper">
      <div className="row tiny muted">
        <MessageCircle size={12} />
        <span className="grow">
          원하는 이미지와 언어(영어·중국어 …)를 말하면 프롬프트를 만들어 줘요. 최신 Haiku · 추론 높음
          {refsCount > 0 ? ` · 고른 참고 소재 ${refsCount}개를 보고 써요` : ' · 아래 참고 소재를 고르면 그 이미지도 보고 써요'}
        </span>
        <button
          className="btn ghost sm"
          style={{ height: 22 }}
          onClick={() => {
            setSid(crypto.randomUUID())
            setMsgs([])
          }}
        >
          새 대화
        </button>
      </div>
      <div ref={list} className="col" style={{ gap: 8, maxHeight: 260, overflow: 'auto' }}>
        {msgs.length === 0 && <div className="tiny faint">예) 귀여운 개구쟁이 초록 모자 소년, 영어로</div>}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="small" style={{ alignSelf: 'flex-end', background: 'var(--accent)', color: '#fff', padding: '6px 10px', borderRadius: 10, maxWidth: '85%' }}>
              {m.text}
            </div>
          ) : (
            <div key={i} className="col" style={{ gap: 6, background: 'var(--surface)', padding: '8px 10px', borderRadius: 10, maxWidth: '92%' }}>
              {m.reply?.prompt ? (
                <>
                  <div className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{m.reply.prompt}</div>
                  {m.reply.memo && <div className="tiny muted" style={{ whiteSpace: 'pre-wrap' }}>{m.reply.memo}</div>}
                  <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={() => onUse(m.reply!.prompt!)} data-testid="helper-use">
                    프롬프트 칸에 넣기
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
          placeholder="원하는 이미지를 말해 주세요"
          data-testid="helper-input"
        />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}
