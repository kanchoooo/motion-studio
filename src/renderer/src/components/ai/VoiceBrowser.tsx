// Voice finder for narration (TTS): the whole catalogue of the connected
// services, narrowed by Korean search ("차분한 여성 내레이션"), language, gender,
// age and feeling chips. Free previews play right away (Higgsfield); voices
// without one get a short sample made once (Magnific, uses credits) and kept.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Pause, Play, RotateCcw, Search, Sparkles } from 'lucide-react'
import { AI_PROVIDERS, type AiAccountInfo, type AiConnectProvider, type AiVoiceInfo } from '@shared/ai'
import { AGE_LABEL, filterVoices, GENDER_LABEL, languageLabel, VOICE_FEELINGS, VOICE_LANGUAGES, voiceTags, type VoiceFilter } from '@shared/voiceSearch'
import { studio, useStore } from '../../store'

const SAMPLE_KO = '안녕하세요. 봄을 담은 한 잔, 지금 만나 보세요.'
const SAMPLE_EN = 'Hello. Discover the taste of spring, starting today.'
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const PAGE = 60

let audio: HTMLAudioElement | null = null
let sampleOk = false // asked once per app run before spending credits on samples

/** onPick(null): the chosen voice was clicked again (choice cleared) */
export function VoiceBrowser({ selected, onPick, height = 320 }: { selected?: { provider?: string; voiceId?: string }; onPick?(v: AiVoiceInfo | null): void; height?: number }) {
  const { toast } = useStore()
  const [accounts, setAccounts] = useState<AiAccountInfo[] | null>(null)
  const [provider, setProvider] = useState<AiConnectProvider | null>(null)
  const [voices, setVoices] = useState<AiVoiceInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState<VoiceFilter>({ query: '', language: 'ko', gender: '', age: '', feelings: [] })
  const [shown, setShown] = useState(PAGE)
  const [playing, setPlaying] = useState<string | null>(null)
  const [making, setMaking] = useState<string | null>(null)
  const [samples, setSamples] = useState<Record<string, string>>({})
  const [nonce, setNonce] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void studio.ai.accounts().then((acc) => {
      setAccounts(acc)
      const usable = (['magnific', 'higgsfield'] as const).filter((p) => acc.some((a) => a.provider === p && a.active && !a.needsLogin))
      const pre = selected?.provider as AiConnectProvider | undefined
      setProvider((cur) => cur ?? (pre && usable.includes(pre) ? pre : (usable[0] ?? null)))
    })
    return () => audio?.pause()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!provider) return
    setVoices(null)
    setError(null)
    studio.ai
      .voices(provider)
      .then(setVoices)
      .catch((e) => {
        setVoices([])
        setError(errText(e))
      })
  }, [provider, nonce])

  const hasLanguages = !!voices?.some((v) => v.languages?.length || v.multilingual)
  const hasAge = !!voices?.some((v) => v.age)
  const result = useMemo(() => (voices ? filterVoices(voices, { ...f, language: hasLanguages ? f.language : '', age: hasAge ? f.age : '' }) : []), [voices, f, hasLanguages, hasAge])
  useEffect(() => {
    setShown(PAGE)
    list.current?.scrollTo({ top: 0 })
  }, [f, provider])

  const play = (key: string, url: string) => {
    audio?.pause()
    if (playing === key) return setPlaying(null)
    audio = new Audio(url)
    audio.onended = () => setPlaying(null)
    audio.onerror = () => {
      setPlaying(null)
      toast('미리듣기를 재생하지 못했어요.', 'error')
    }
    void audio.play().catch(() => setPlaying(null))
    setPlaying(key)
  }

  const listen = async (v: AiVoiceInfo) => {
    const key = `${v.provider}:${v.id}`
    if (v.previewUrl) return play(key, v.previewUrl)
    if (samples[key]) return play(key, samples[key])
    if (!sampleOk && !confirm('이 목소리는 미리듣기가 없어서 짧은 샘플을 한 번 만들어요(서비스 크레딧이 조금 쓰여요). 한 번 만든 샘플은 저장돼서 다시 들을 때는 무료예요. 만들까요?')) return
    sampleOk = true
    setMaking(key)
    try {
      const korean = v.multilingual || v.languages?.some((l) => /korean/i.test(l))
      const url = await studio.ai.ttsSample(v, korean || !v.languages?.length ? SAMPLE_KO : SAMPLE_EN)
      setSamples((s) => ({ ...s, [key]: url }))
      play(key, url)
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setMaking(null)
    }
  }

  if (accounts && !provider) return <div className="small muted">음성(TTS)을 쓰려면 먼저 위쪽 <b>AI 연결</b>에서 매그니픽이나 힉스필드에 로그인해 주세요.</div>

  const providers = (['magnific', 'higgsfield'] as const).filter((p) => accounts?.some((a) => a.provider === p && a.active && !a.needsLogin))
  const chip = (on: boolean) => ({ height: 24, padding: '0 9px', borderRadius: 12, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text-2)', fontSize: 12, cursor: 'pointer' }) as const
  const set = (p: Partial<VoiceFilter>) => setF((x) => ({ ...x, ...p }))

  return (
    <div className="col" style={{ gap: 8 }} data-testid="voice-browser">
      <div className="row" style={{ gap: 6 }}>
        {providers.length > 1 && (
          <div className="seg">
            {providers.map((p) => (
              <button key={p} className={p === provider ? 'on' : ''} onClick={() => setProvider(p)}>
                {AI_PROVIDERS[p].name}
              </button>
            ))}
          </div>
        )}
        <div className="row grow input" style={{ height: 30, padding: '0 8px', gap: 6 }}>
          <Search size={13} color="var(--text-3)" />
          <input
            value={f.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="찾는 목소리를 말로 (예: 차분한 여성 내레이션, 중후한 남성 광고)"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, color: 'var(--text)' }}
          />
        </div>
      </div>

      <div className="col" style={{ gap: 5 }}>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {hasLanguages && (
            <>
              <button style={chip(!f.language)} onClick={() => set({ language: '' })}>모든 언어</button>
              {VOICE_LANGUAGES.map((l) => (
                <button key={l.id} style={chip(f.language === l.id)} onClick={() => set({ language: f.language === l.id ? '' : l.id })}>
                  {l.label}
                </button>
              ))}
              <span style={{ width: 8 }} />
            </>
          )}
          {(['female', 'male'] as const).map((g) => (
            <button key={g} style={chip(f.gender === g)} onClick={() => set({ gender: f.gender === g ? '' : g })}>
              {GENDER_LABEL[g]}
            </button>
          ))}
          {hasAge && (
            <>
              <span style={{ width: 8 }} />
              {(['young', 'middle_aged', 'old'] as const).map((a) => (
                <button key={a} style={chip(f.age === a)} onClick={() => set({ age: f.age === a ? '' : a })}>
                  {AGE_LABEL[a]}
                </button>
              ))}
            </>
          )}
        </div>
        {voices?.some((v) => v.description) && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {VOICE_FEELINGS.map((x) => (
              <button key={x.id} style={chip(f.feelings.includes(x.id))} onClick={() => set({ feelings: f.feelings.includes(x.id) ? f.feelings.filter((i) => i !== x.id) : [...f.feelings, x.id] })}>
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="row tiny muted">
        <span className="grow">
          {voices === null ? '목소리를 불러오고 있어요' : `목소리 ${result.length}개`}
          {provider === 'magnific' && voices?.length ? ' · ▶ 샘플은 처음 한 번 만들어요(크레딧 사용)' : ''}
          {provider === 'higgsfield' && voices?.length ? ' · ▶ 바로 미리듣기' : ''}
        </span>
        {(f.query || f.gender || f.age || f.feelings.length) && (
          <button className="btn ghost sm" style={{ height: 22 }} onClick={() => setF({ query: '', language: f.language, gender: '', age: '', feelings: [] })}>
            <RotateCcw size={11} />
            조건 지우기
          </button>
        )}
      </div>

      <div
        ref={list}
        style={{ maxHeight: height, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 120 && shown < result.length) setShown((n) => n + PAGE)
        }}
      >
        {voices === null && (
          <div className="row small muted" style={{ padding: 12 }}>
            <Loader2 size={13} className="spin" />
            목소리를 불러오고 있어요
          </div>
        )}
        {error && (
          <div className="row small" style={{ padding: 12, color: 'var(--danger)', gap: 8 }}>
            <span className="grow">{error}</span>
            <button className="btn sm" onClick={() => setNonce((n) => n + 1)}>
              다시 시도
            </button>
          </div>
        )}
        {voices && !error && result.length === 0 && <div className="small muted" style={{ padding: 12 }}>조건에 맞는 목소리가 없어요. 조건을 줄여 보세요.</div>}
        {result.slice(0, shown).map((v, i) => {
          const key = `${v.provider}:${v.id}`
          const on = selected?.voiceId === v.id && selected?.provider === v.provider
          const tags = voiceTags(v)
          const meta = [languageLabel(v), v.gender && GENDER_LABEL[v.gender], v.age && AGE_LABEL[v.age]].filter(Boolean)
          return (
            <div key={key} className="row" style={{ padding: '7px 10px', borderTop: i ? '1px solid var(--border)' : 'none', gap: 8, background: on ? 'var(--accent-soft)' : undefined, alignItems: 'flex-start' }} data-voice={v.name}>
              <button
                className="icon-btn"
                title={v.previewUrl || samples[key] ? '미리듣기' : '샘플 만들어 듣기 (처음 한 번 크레딧 사용)'}
                onClick={() => void listen(v)}
                style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--surface-3)', flex: 'none' }}
              >
                {making === key ? <Loader2 size={13} className="spin" /> : playing === key ? <Pause size={13} /> : v.previewUrl || samples[key] ? <Play size={13} /> : <Sparkles size={13} />}
              </button>
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="small" style={{ fontWeight: 600 }}>{v.name}</span>
                  {meta.map((m) => (
                    <span key={m} className="tiny faint">{m}</span>
                  ))}
                  {tags.slice(0, 3).map((t) => (
                    <span key={t} className="badge" style={{ height: 18, fontSize: 10 }}>{t}</span>
                  ))}
                </div>
                {v.description && (
                  <span className="tiny faint" title={v.description} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {v.description}
                  </span>
                )}
              </div>
              {onPick && (
                <button className={`btn sm${on ? ' primary' : ''}`} style={{ flex: 'none' }} title={on ? '다시 누르면 선택을 풀어요' : undefined} onClick={() => onPick(on ? null : v)}>
                  {on ? <Check size={12} /> : null}
                  {on ? '선택됨' : '선택'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
