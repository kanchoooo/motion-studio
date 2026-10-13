// Find / make sound: Artlist search through Claude (results to audition and use),
// narration voices (TTS) and audio the AI tools already made for this project.
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, Mic, Music, Pause, Play, Search, Sparkles } from 'lucide-react'
import type { AiVoiceInfo, AudioCandidate } from '@shared/ai'
import type { BgmTrack } from '@shared/overrides'
import { ConnectionsModal } from '../../components/ai/ConnectionsModal'
import { VoiceBrowser } from '../../components/ai/VoiceBrowser'
import { Menu, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { useOverrides } from './overrides'

let player: HTMLAudioElement | null = null
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const mmss = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

export function SoundFinder() {
  const [tab, setTab] = useState<'artlist' | 'voice' | 'made'>('artlist')
  return (
    <div className="card col" style={{ padding: 10, gap: 10, background: 'var(--surface-2)' }} data-testid="sound-finder">
      <Segmented
        full
        value={tab}
        onChange={setTab}
        options={[
          { value: 'artlist', label: '아트리스트' },
          { value: 'voice', label: '내레이션' },
          { value: 'made', label: 'AI로 만든 소리' },
        ]}
      />
      {tab === 'artlist' && <ArtlistSearch />}
      {tab === 'voice' && <Narration />}
      {tab === 'made' && <MadeAudio />}
    </div>
  )
}

function usePlayer() {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => player?.pause(), [])
  const toggle = (key: string, url: string) => {
    player?.pause()
    if (playing === key) return setPlaying(null)
    player = new Audio(url)
    player.onended = () => setPlaying(null)
    void player.play().catch(() => setPlaying(null))
    setPlaying(key)
  }
  return { playing, toggle }
}

function ArtlistSearch() {
  const { project, toast, audioCandidates, session } = useStore()
  const pid = project!.meta.id
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'bgm' | 'sfx'>('bgm')
  const [connections, setConnections] = useState(false)
  const [using, setUsing] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const { playing, toggle } = usePlayer()
  const { value: ov, setBgm, setSfxGroup } = useOverrides()
  const { audio } = useEditor()
  const asked = useRef(false)

  useEffect(() => {
    void studio.ai.settings().then((s) => setEnabled(s.artlist))
    void studio.ai.audioCandidates(pid).then((list) => list && useStore.setState({ audioCandidates: list }))
  }, [pid, connections])

  const search = async () => {
    if (!query.trim()) return
    try {
      asked.current = true
      await studio.ai.searchAudio(pid, { query, kind })
      toast('Claude가 아트리스트에서 찾고 있어요. 찾으면 여기에 보여요.', 'info')
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  const use = async (it: AudioCandidate, target?: { group: string }) => {
    setUsing(it.id)
    try {
      const file = await studio.ai.useAudioCandidate(pid, it)
      if (it.kind === 'bgm' && !target) {
        const d = project!.brief.output.duration
        const track: BgmTrack = { id: `bgm-${crypto.randomUUID().slice(0, 8)}`, label: it.title, src: file, start: 0, end: Math.min(d, it.duration ?? d), mediaStart: 0, volume: 0.7, fadeIn: 0.3, fadeOut: 1, loop: (it.duration ?? d) < d }
        setBgm([...(ov?.bgm ?? []), track], `배경음악 추가: ${it.title} (아트리스트)`)
        toast('배경음악으로 넣었어요. 구간·볼륨은 아래에서 조절해요.', 'success')
      } else if (target) {
        setSfxGroup(target.group, { src: file }, `효과음 일괄 변경: ${target.group} → ${it.title}`)
        toast('효과음을 바꿨어요', 'success')
      } else {
        await studio.agent.send({ projectId: pid, text: `아트리스트에서 고른 효과음 "${it.title}"(${file})을 어울리는 장면에 넣어 주세요.` })
        toast('Claude에게 넣어 달라고 했어요', 'success')
      }
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setUsing(null)
    }
  }

  if (enabled === false)
    return (
      <div className="col small muted" style={{ gap: 8 }}>
        아트리스트가 꺼져 있어요. AI 연결에서 켜고 로그인하면 Claude가 배경음악·효과음을 찾아 여기에 보여줘요.
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConnections(true)}>
          AI 연결 열기
        </button>
        {connections && <ConnectionsModal onClose={() => setConnections(false)} />}
      </div>
    )

  const list = audioCandidates
  const groups = [...new Set(audio.filter((a) => a.kind === 'sfx').map((a) => a.group ?? '기타'))]
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'bgm', label: '배경음악' }, { value: 'sfx', label: '효과음' }]} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        <div className="row grow input" style={{ height: 30, padding: '0 8px', gap: 6 }}>
          <Search size={13} color="var(--text-3)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void search()}
            placeholder={kind === 'bgm' ? '예: 밝고 경쾌한 시티팝, 120BPM' : '예: 부드러운 휙, 팝 효과음'}
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, color: 'var(--text)' }}
          />
        </div>
        <button className="btn sm primary" onClick={search} disabled={!query.trim()}>
          찾기
        </button>
      </div>
      {session.status === 'busy' && asked.current && (
        <div className="row tiny muted">
          <Loader2 size={12} className="spin" />
          Claude가 찾고 있어요
        </div>
      )}
      {list && (
        <div className="col" style={{ gap: 2 }}>
          <div className="tiny muted">
            “{list.query}” {list.kind === 'bgm' ? '배경음악' : '효과음'} 후보 {list.items.length}개
          </div>
          {list.items.map((it) => {
            const key = `${list.id}:${it.id}`
            return (
              <div key={key} className="row" style={{ gap: 6, padding: '6px 4px', borderTop: '1px solid var(--border)', position: 'relative' }} data-candidate={it.title}>
                <button className="icon-btn" disabled={!it.previewUrl} title={it.previewUrl ? '미리듣기' : '미리듣기 없음'} onClick={() => it.previewUrl && toggle(key, it.previewUrl)} style={{ width: 26, height: 26, borderRadius: 13, background: 'var(--surface-3)' }}>
                  {playing === key ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
                  <span className="small ellipsis" style={{ fontWeight: 600 }}>{it.title}</span>
                  <span className="tiny faint ellipsis">{[it.artist, mmss(it.duration), it.bpm && `${it.bpm}BPM`, it.mood].filter(Boolean).join(' · ')}</span>
                </div>
                {it.pageUrl && (
                  <button className="icon-btn" title="아트리스트에서 보기" onClick={() => studio.app.openExternal(it.pageUrl!)}>
                    <ExternalLink size={12} />
                  </button>
                )}
                <button
                  className="btn sm"
                  disabled={using === it.id || (!it.downloadUrl && !it.previewUrl)}
                  onClick={() => (it.kind === 'sfx' ? setMenu(menu === key ? null : key) : void use(it))}
                  title={it.downloadUrl ? '' : '미리듣기 파일로 넣어요. 최종본은 아트리스트에서 라이선스 받은 파일로 바꿔 주세요.'}
                >
                  {using === it.id ? <Loader2 size={12} className="spin" /> : null}
                  사용
                </button>
                {menu === key && (
                  <Menu
                    style={{ right: 0, top: 34 }}
                    onClose={() => setMenu(null)}
                    items={[
                      { label: 'Claude에게 어울리는 곳에 넣어 달라고 하기', onClick: () => void use(it) },
                      ...groups.map((g) => ({ label: `"${g}" 효과음 모두 이걸로 바꾸기`, onClick: () => void use(it, { group: g }) })),
                    ]}
                  />
                )}
              </div>
            )
          })}
          {list.items.some((i) => !i.downloadUrl) && <div className="tiny faint">미리듣기 파일로 넣은 곡은 납품 전에 아트리스트에서 라이선스를 받은 파일로 바꿔 주세요.</div>}
        </div>
      )}
    </div>
  )
}

function Narration() {
  const { project, toast } = useStore()
  const [voice, setVoice] = useState<AiVoiceInfo | null>(null)
  return (
    <div className="col" style={{ gap: 8 }}>
      <VoiceBrowser selected={voice ? { provider: voice.provider, voiceId: voice.id } : undefined} onPick={setVoice} height={300} />
      <button
        className="btn sm primary"
        disabled={!voice}
        onClick={async () => {
          const v = voice!
          const ref = v.provider === 'magnific' ? `매그니픽 audio_tts voiceId ${v.id}, source ${v.source ?? 'catalog'}` : `힉스필드 generate_audio voice_type ${v.voiceType ?? 'preset'}, voice_id ${v.id}`
          await studio.agent.send({ projectId: project!.meta.id, text: `"${v.name}" 목소리(${ref})로 내레이션을 만들어 영상에 넣어 주세요. 대본은 브리프와 장면에 맞춰 써 주세요.` })
          toast('Claude에게 내레이션을 부탁했어요', 'success')
        }}
      >
        <Mic size={13} />
        이 목소리로 내레이션 넣어 달라고 하기
      </button>
    </div>
  )
}

function MadeAudio() {
  const { project, historyNonce } = useStore()
  const pid = project!.meta.id
  const [items, setItems] = useState<{ file: string; kind: string; provider: string; label?: string; at: string }[]>([])
  const { playing, toggle } = usePlayer()
  const { value: ov, setBgm } = useOverrides()
  useEffect(() => {
    void studio.ai.generated(pid).then((g) => setItems(g.filter((x) => x.kind === 'audio')))
  }, [pid, historyNonce])
  if (!items.length) return <div className="small muted">아직 AI로 만들거나 가져온 소리가 없어요. 내레이션이나 아트리스트 음악을 쓰면 여기에 모여요.</div>
  return (
    <div className="col" style={{ gap: 2 }}>
      {items.map((it) => (
        <div key={it.file} className="row" style={{ gap: 6, padding: '6px 4px', borderTop: '1px solid var(--border)' }}>
          <button
            className="icon-btn"
            onClick={async () => toggle(it.file, await studio.projects.fileUrl(pid, `composition/${it.file}`))}
            style={{ width: 26, height: 26, borderRadius: 13, background: 'var(--surface-3)' }}
          >
            {playing === it.file ? <Pause size={12} /> : <Play size={12} />}
          </button>
          {it.provider === 'artlist' ? <Music size={12} /> : <Sparkles size={12} />}
          <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
            <span className="small ellipsis">{it.label ?? it.file.split('/').pop()}</span>
            <span className="tiny faint">{it.provider}</span>
          </div>
          <button
            className="btn ghost sm"
            title="배경음악으로 넣기"
            onClick={() => {
              const d = project!.brief.output.duration
              setBgm([...(ov?.bgm ?? []), { id: `bgm-${crypto.randomUUID().slice(0, 8)}`, label: it.label?.slice(0, 40) ?? 'AI 소리', src: it.file, start: 0, end: d, mediaStart: 0, volume: 0.8, fadeIn: 0, fadeOut: 0.5, loop: false }], `소리 추가: ${it.label ?? it.file}`)
            }}
          >
            BGM으로
          </button>
        </div>
      ))}
    </div>
  )
}
