// Text-to-speech voices of the connected services: list, search, listen.
// Voices without a sample can be auditioned by generating a short line (uses credits).
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pause, Play, Search, Sparkles } from 'lucide-react'
import { AI_PROVIDERS, type AiAccountInfo, type AiConnectProvider, type AiVoiceInfo } from '@shared/ai'
import { studio, useStore } from '../../store'

const SAMPLE = '안녕하세요. 모션스튜디오에서 들려드리는 샘플 목소리예요.'

export function VoiceBrowser({ selected, onPick, height = 320 }: { selected?: { provider?: string; voiceId?: string }; onPick?(v: AiVoiceInfo): void; height?: number }) {
  const { toast } = useStore()
  const [accounts, setAccounts] = useState<AiAccountInfo[] | null>(null)
  const [provider, setProvider] = useState<AiConnectProvider | null>(null)
  const [query, setQuery] = useState('')
  const [voices, setVoices] = useState<AiVoiceInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [making, setMaking] = useState<string | null>(null)
  const [samples, setSamples] = useState<Record<string, string>>({})
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    void studio.ai.accounts().then((acc) => {
      setAccounts(acc)
      const usable = (['higgsfield', 'magnific'] as const).filter((p) => acc.some((a) => a.provider === p && a.active && !a.needsLogin))
      setProvider((cur) => cur ?? ((selected?.provider as AiConnectProvider) && usable.includes(selected!.provider as AiConnectProvider) ? (selected!.provider as AiConnectProvider) : usable[0] ?? null))
    })
    return () => audio.current?.pause()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!provider) return
    setVoices(null)
    setError(null)
    const t = setTimeout(() => {
      studio.ai
        .voices(provider, query)
        .then(setVoices)
        .catch((e) => {
          setVoices([])
          setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
        })
    }, 300)
    return () => clearTimeout(t)
  }, [provider, query])

  const play = (key: string, url: string) => {
    audio.current?.pause()
    if (playing === key) return setPlaying(null)
    const a = new Audio(url)
    audio.current = a
    a.onended = () => setPlaying(null)
    a.onerror = () => {
      setPlaying(null)
      toast('미리듣기를 재생하지 못했어요.', 'error')
    }
    void a.play()
    setPlaying(key)
  }

  const sample = async (v: AiVoiceInfo) => {
    const key = `${v.provider}:${v.id}`
    if (samples[key]) return play(key, samples[key])
    if (!confirm('이 목소리는 미리듣기가 없어서 짧은 샘플을 만들어요. 서비스 크레딧이 조금 사용돼요. 만들까요?')) return
    setMaking(key)
    try {
      const url = await studio.ai.ttsSample(v.provider, v.id, SAMPLE)
      setSamples((s) => ({ ...s, [key]: url }))
      play(key, url)
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
    } finally {
      setMaking(null)
    }
  }

  if (accounts && !provider)
    return <div className="small muted">음성(TTS)을 쓰려면 먼저 위쪽 <b>AI 연결</b>에서 힉스필드나 매그니픽에 로그인해 주세요.</div>

  const providers = (['higgsfield', 'magnific'] as const).filter((p) => accounts?.some((a) => a.provider === p && a.active && !a.needsLogin))
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="목소리 검색 (예: 여성, 차분한, 한국어)" style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, color: 'var(--text)' }} />
        </div>
      </div>
      <div style={{ maxHeight: height, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {voices === null && (
          <div className="row small muted" style={{ padding: 12 }}>
            <Loader2 size={13} className="spin" />
            목소리를 불러오고 있어요
          </div>
        )}
        {error && <div className="small" style={{ padding: 12, color: 'var(--danger)' }}>{error}</div>}
        {voices?.length === 0 && !error && <div className="small muted" style={{ padding: 12 }}>찾는 목소리가 없어요.</div>}
        {voices?.map((v, i) => {
          const key = `${v.provider}:${v.id}`
          const on = selected?.voiceId === v.id && selected?.provider === v.provider
          return (
            <div key={key} className="row" style={{ padding: '7px 10px', borderTop: i ? '1px solid var(--border)' : 'none', gap: 8, background: on ? 'var(--accent-soft)' : undefined }} data-voice={v.name}>
              <button
                className="icon-btn"
                title={v.previewUrl ? '미리듣기' : '샘플 만들어 듣기 (크레딧 사용)'}
                onClick={() => (v.previewUrl ? play(key, v.previewUrl) : void sample(v))}
                style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--surface-3)' }}
              >
                {making === key ? <Loader2 size={13} className="spin" /> : playing === key ? <Pause size={13} /> : v.previewUrl || samples[key] ? <Play size={13} /> : <Sparkles size={13} />}
              </button>
              <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 600 }}>{v.name}</span>
                <span className="tiny faint ellipsis">{[v.language, v.gender, v.description, ...(v.tags ?? [])].filter(Boolean).join(' · ')}</span>
              </div>
              {onPick && (
                <button className={`btn sm${on ? ' primary' : ''}`} onClick={() => onPick(v)}>
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
