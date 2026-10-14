import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileAudio, Music, Plus, RotateCcw, Trash2, Volume2, VolumeX, Wand2 } from 'lucide-react'
import type { AudioClipInfo, SfxInfo } from '@shared/api'
import type { BgmTrack } from '@shared/overrides'
import { Menu, NumberField, Toggle } from '../../components/ui'
import { studio, useStore } from '../../store'
import { useEditor } from './editorStore'
import { useOverrides } from './overrides'
import { blockedEdit } from './editLock'
import { SoundFinder } from './SoundFinder'

const fileName = (p: string) => p.split('/').pop() ?? p

/** plays a composition-relative file (single shared element); the same file again stops it */
let preview: HTMLAudioElement | null = null
let previewRel: string | null = null
const listeners = new Set<(rel: string | null) => void>()
const announce = () => listeners.forEach((l) => l(previewRel))
export function stopPreview() {
  preview?.pause()
  preview = null
  previewRel = null
  announce()
}
export async function playFile(projectId: string, rel: string) {
  if (previewRel === rel) return stopPreview()
  const url = await studio.projects.fileUrl(projectId, `composition/${rel}`)
  preview?.pause()
  preview = new Audio(url)
  previewRel = rel
  preview.onended = () => stopPreview()
  void preview.play().catch(() => stopPreview())
  announce()
}
/** which file is playing (for ▶/■ buttons); playback stops when the panel goes away */
function usePreview() {
  const [rel, setRel] = useState<string | null>(previewRel)
  useEffect(() => {
    listeners.add(setRel)
    return () => {
      listeners.delete(setRel)
      if (!listeners.size) stopPreview()
    }
  }, [])
  return rel
}

export function SoundPanel() {
  const { project, toast } = useStore()
  const pid = project!.meta.id
  const { audio, selectedAudio } = useEditor()
  const { value: ov, setBgm } = useOverrides()
  const [lib, setLib] = useState<SfxInfo[]>([])
  useEffect(() => {
    void studio.projects.sfxLibrary().then(setLib)
  }, [])
  if (!ov) return null

  const bgmClaude = audio.filter((a) => a.kind === 'bgm' && !a.managed)
  const sfx = audio.filter((a) => a.kind === 'sfx')
  const voice = audio.filter((a) => a.kind === 'voice')
  const groups = [...new Set(sfx.map((s) => s.group ?? '기타'))]
  const sel = audio.find((a) => a.id === selectedAudio)
  const selTrack = ov.bgm.find((t) => t.id === selectedAudio)

  const addBgm = async () => {
    if (blockedEdit()) return
    const files = await studio.app.pickFiles('assets')
    if (!files.length) return
    let added
    try {
      added = (await studio.projects.importAssets(pid, files)).filter((a) => a.meta.mime.startsWith('audio/'))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      return
    }
    if (!added.length) {
      toast('소리 파일(MP3·WAV·M4A 등)을 골라 주세요.', 'error')
      return
    }
    const d = project!.brief.output.duration
    const tracks: BgmTrack[] = added.map((a, i) => ({
      id: `bgm-${crypto.randomUUID().slice(0, 8)}`,
      label: a.originalName.replace(/\.[^.]+$/, ''),
      src: a.file,
      start: 0,
      end: Math.min(d, a.meta.duration ?? d),
      mediaStart: 0,
      volume: 0.7,
      fadeIn: i === 0 ? 0.3 : 0,
      fadeOut: 1,
      loop: (a.meta.duration ?? d) < d,
    }))
    setBgm([...ov.bgm, ...tracks], `배경음악 추가: ${tracks.map((t) => t.label).join(', ')}`)
    useEditor.setState({ selectedAudio: tracks[0].id })
  }

  if (selTrack) return <BgmEditor track={selTrack} />
  if (sel) return <ClipEditor clip={sel} lib={lib} count={sfx.filter((s) => s.group === sel.group).length} />

  return (
    <div className="col" style={{ gap: 14 }}>
      <SoundFinder />
      <div className="col" style={{ gap: 6 }}>
        <div className="row">
          <span className="section-label grow">배경음악</span>
          <button className="btn sm" onClick={addBgm}>
            <Plus size={13} />
            BGM 추가
          </button>
        </div>
        {ov.bgm.length === 0 && bgmClaude.length === 0 && <div className="small muted">배경음악이 없어요. 파일을 추가하면 구간을 정해 여러 곡을 넣을 수 있어요.</div>}
        {ov.bgm.map((t) => (
          <ClipRow key={t.id} icon={<Music size={13} />} label={t.label} sub={`${t.start.toFixed(1)}~${t.end.toFixed(1)}초 · 볼륨 ${Math.round(t.volume * 100)}%`} onClick={() => useEditor.setState({ selectedAudio: t.id })} badge="내가 추가" />
        ))}
        {bgmClaude.map((a) => (
          <ClipRow key={a.id} icon={<Music size={13} />} label={a.label} sub={`${a.start.toFixed(1)}초~ · ${fileName(a.src)}`} onClick={() => useEditor.setState({ selectedAudio: a.id })} badge="Claude" />
        ))}
      </div>

      {voice.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <span className="section-label">내레이션 · {voice.length}개</span>
          {voice.map((a) => (
            <ClipRow key={a.id} icon={<Volume2 size={13} />} label={a.label} sub={`${a.start.toFixed(1)}초~ · ${fileName(a.src)}`} onClick={() => useEditor.setState({ selectedAudio: a.id })} muted={a.volume === 0} />
          ))}
        </div>
      )}

      <div className="col" style={{ gap: 6 }}>
        <span className="section-label">효과음 {sfx.length ? `· ${sfx.length}개` : ''}</span>
        {sfx.length === 0 && <div className="small muted">Claude가 넣은 효과음이 여기에 보여요. 재생바 아래 표시를 눌러도 골라져요.</div>}
        {groups.map((g) => (
          <SfxGroup key={g} group={g} clips={sfx.filter((s) => (s.group ?? '기타') === g)} lib={lib} />
        ))}
      </div>
    </div>
  )
}

function ClipRow({ icon, label, sub, onClick, badge, muted }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; badge?: string; muted?: boolean }) {
  return (
    <button className="row card" onClick={onClick} style={{ padding: '8px 10px', cursor: 'pointer', textAlign: 'left', background: 'var(--surface-2)', opacity: muted ? 0.5 : 1 }}>
      <span style={{ color: 'var(--text-2)' }}>{icon}</span>
      <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
        <span className="small ellipsis" style={{ fontWeight: 600 }}>{label}</span>
        <span className="tiny faint ellipsis">{sub}</span>
      </span>
      {badge && <span className="badge">{badge}</span>}
    </button>
  )
}

function SfxGroup({ group, clips, lib }: { group: string; clips: AudioClipInfo[]; lib: SfxInfo[] }) {
  const { project } = useStore()
  const { value: ov, setSfxGroup } = useOverrides()
  const [menu, setMenu] = useState(false)
  const name = lib.find((l) => l.id === group)?.label ?? group
  const replaced = ov?.sfxGroups[group]
  const replaceWith = async (src: string, how: string) => setSfxGroup(group, { src, volume: replaced?.volume }, `효과음 일괄 변경: ${name} ${clips.length}개 → ${how}`)
  return (
    <div className="card" style={{ padding: 8, background: 'var(--surface-2)' }}>
      <div className="row" style={{ position: 'relative' }}>
        <Volume2 size={13} color="var(--text-2)" />
        <span className="small grow" style={{ fontWeight: 650 }}>
          {name} <span className="faint">×{clips.length}</span>
        </span>
        {replaced && <span className="badge accent" title={replaced.src}>바꿈</span>}
        <button className="btn sm" onClick={() => setMenu(!menu)} title={`${name} 효과음 ${clips.length}개를 한 번에 바꿔요`}>
          모두 바꾸기
          <ChevronDown size={12} />
        </button>
        {menu && (
          <Menu
            style={{ right: 0, top: 30 }}
            onClose={() => setMenu(false)}
            items={[
              {
                label: '내 파일로 바꾸기…',
                icon: <FileAudio size={14} />,
                onClick: async () => {
                  if (blockedEdit()) return
                  const files = await studio.app.pickFiles('assets')
                  const a = (await studio.projects.importAssets(project!.meta.id, files.slice(0, 1)))[0]
                  if (a) await replaceWith(a.file, a.originalName)
                },
              },
              ...lib
                .filter((l) => l.id !== group)
                .map((l) => ({
                  label: `기본 효과음: ${l.label}`,
                  icon: <Wand2 size={14} />,
                  onClick: async () => {
                    if (blockedEdit()) return
                    const p = await studio.projects.useSfx(project!.meta.id, l.id)
                    if (p) await replaceWith(p, l.label)
                  },
                })),
              ...(replaced ? [{ label: '원래 효과음으로', icon: <RotateCcw size={14} />, onClick: () => setSfxGroup(group, null, `효과음 일괄 변경 취소: ${name}`) }] : []),
            ]}
          />
        )}
      </div>
      <div className="col" style={{ gap: 2, marginTop: 6 }}>
        {clips.map((c) => (
          <button key={c.id} className="row" onClick={() => useEditor.setState({ selectedAudio: c.id })} style={{ border: 'none', background: 'transparent', padding: '4px 4px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', opacity: c.volume === 0 ? 0.45 : 1 }}>
            <span className="mono tiny faint" style={{ width: 44, textAlign: 'left' }}>{c.start.toFixed(2)}s</span>
            <span className="small ellipsis grow" style={{ textAlign: 'left' }}>{c.label}</span>
            {c.volume === 0 && <VolumeX size={12} />}
          </button>
        ))}
      </div>
    </div>
  )
}

function ClipEditor({ clip, lib, count }: { clip: AudioClipInfo; lib: SfxInfo[]; count: number }) {
  const { project } = useStore()
  const pid = project!.meta.id
  const { value: ov, patchAudio, setSfxGroup } = useOverrides()
  const playing = usePreview()
  const e = ov?.audio[clip.id] ?? {}
  const [all, setAll] = useState(false)
  const [menu, setMenu] = useState(false)
  const kindName = clip.kind === 'sfx' ? (lib.find((l) => l.id === clip.group)?.label ?? clip.group ?? '효과음') : '배경음악'
  const replace = async (src: string, how: string) => {
    if (all && clip.group) setSfxGroup(clip.group, { src }, `효과음 일괄 변경: ${kindName} ${count}개 → ${how}`)
    else patchAudio(clip.id, { src }, `${clip.label}: 소리 바꾸기 → ${how}`)
  }
  const muted = !!e.muted
  return (
    <div className="col" style={{ gap: 12 }}>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => useEditor.setState({ selectedAudio: null })}>
        ← 사운드 목록
      </button>
      <div className="col" style={{ gap: 2 }}>
        <div style={{ fontWeight: 650 }}>{clip.label}</div>
        <div className="tiny faint">
          {kindName} · {clip.start.toFixed(2)}초 · {fileName(clip.src)}
        </div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => void playFile(pid, clip.src)} title={playing === clip.src ? '멈추기' : '들어보기'}>
          <Volume2 size={13} />
          {playing === clip.src ? '멈추기' : '들어보기'}
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn sm primary" onClick={() => setMenu(!menu)}>
            소리 바꾸기
            <ChevronDown size={12} />
          </button>
          {menu && (
            <Menu
              style={{ left: 0, top: 30, maxHeight: 320, overflow: 'auto' }}
              onClose={() => setMenu(false)}
              items={[
                {
                  label: '내 파일로 바꾸기…',
                  icon: <FileAudio size={14} />,
                  onClick: async () => {
                    if (blockedEdit()) return
                    const files = await studio.app.pickFiles('assets')
                    const a = (await studio.projects.importAssets(pid, files.slice(0, 1)))[0]
                    if (a) await replace(a.file, a.originalName)
                  },
                },
                ...lib.map((l) => ({
                  label: `기본 효과음: ${l.label}`,
                  icon: <Wand2 size={14} />,
                  onClick: async () => {
                    if (blockedEdit()) return
                    const p = await studio.projects.useSfx(pid, l.id)
                    if (p) await replace(p, l.label)
                  },
                })),
              ]}
            />
          )}
        </div>
      </div>
      {clip.kind === 'sfx' && count > 1 && (
        <label className="row small" style={{ cursor: 'pointer' }}>
          <Toggle on={all} onChange={setAll} />
          같은 효과음({kindName}) {count}개 모두 바꾸기
        </label>
      )}
      <div className="col" style={{ gap: 6 }}>
        <div className="row tiny muted">
          <span className="grow">볼륨</span>
          <span className="mono">{muted ? '음소거' : `${Math.round((e.volume ?? clip.volume) * 100)}%`}</span>
        </div>
        <VolumeSlider value={e.volume ?? clip.volume} onCommit={(volume) => patchAudio(clip.id, { volume, muted: false }, `${clip.label}: 볼륨`)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        <NumberField title="이 소리가 나오는 시점" label="시점" unit="초" value={e.start ?? clip.start} step={0.05} precision={2} min={0} onChange={(start) => patchAudio(clip.id, { start }, `${clip.label}: 시점`)} />
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => patchAudio(clip.id, { muted: !muted }, `${clip.label}: ${muted ? '소리 켜기' : '음소거'}`)}>
          {muted ? <Volume2 size={13} /> : <VolumeX size={13} />}
          {muted ? '소리 켜기' : '음소거'}
        </button>
        {ov?.audio[clip.id] && (
          <button className="btn sm ghost" onClick={() => patchAudio(clip.id, null, `${clip.label}: 원래대로`)}>
            <RotateCcw size={13} />
            원래대로
          </button>
        )}
      </div>
    </div>
  )
}

function VolumeSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) setV(value)
    last.current = value
  }, [value])
  return <input type="range" min={0} max={1.5} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)} />
}

function BgmEditor({ track }: { track: BgmTrack }) {
  const { project } = useStore()
  const pid = project!.meta.id
  const d = project!.brief.output.duration
  const { value: ov, setBgm } = useOverrides()
  const update = (patch: Partial<BgmTrack>, what: string) => setBgm(ov!.bgm.map((t) => (t.id === track.id ? { ...t, ...patch } : t)), `${track.label}: ${what}`)
  const playing = usePreview()
  // the name is saved when typing ends (each save reloads the preview)
  const [label, setLabel] = useState(track.label)
  useEffect(() => setLabel(track.label), [track.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ gap: 12 }}>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => useEditor.setState({ selectedAudio: null })}>
        ← 사운드 목록
      </button>
      <input
        className="input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() && label !== track.label && update({ label: label.trim() }, '이름')}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
      />
      <div className="tiny faint">{fileName(track.src)}</div>
      <div className="row">
        <button className="btn sm" onClick={() => void playFile(pid, track.src)} title={playing === track.src ? '멈추기' : '들어보기'}>
          <Volume2 size={13} />
          {playing === track.src ? '멈추기' : '들어보기'}
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            if (blockedEdit()) return
            const files = await studio.app.pickFiles('assets')
            const a = (await studio.projects.importAssets(pid, files.slice(0, 1)))[0]
            if (a) update({ src: a.file, label: a.originalName.replace(/\.[^.]+$/, '') }, '파일 바꾸기')
          }}
        >
          <FileAudio size={13} />
          파일 바꾸기
        </button>
      </div>
      <div className="section-label">나오는 구간</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberField title="영상에서 음악이 시작되는 시점" label="시작" unit="초" value={track.start} min={0} max={d} step={0.1} precision={1} onChange={(start) => update({ start: Math.min(start, track.end - 0.1) }, '구간')} />
        <NumberField title="영상에서 음악이 끝나는 시점" label="끝" unit="초" value={track.end} min={0} max={d} step={0.1} precision={1} onChange={(end) => update({ end: Math.max(end, track.start + 0.1) }, '구간')} />
      </div>
      <NumberField title="음악 파일의 몇 초 지점부터 쓸지 (하이라이트 부분 고르기)" label="음악 시작 위치" unit="초" value={track.mediaStart} min={0} step={0.5} precision={1} onChange={(mediaStart) => update({ mediaStart }, '음악 시작 위치')} />
      <div className="col" style={{ gap: 6 }}>
        <div className="row tiny muted">
          <span className="grow">볼륨</span>
          <span className="mono">{Math.round(track.volume * 100)}%</span>
        </div>
        <VolumeSlider value={track.volume} onCommit={(volume) => update({ volume }, '볼륨')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberField title="서서히 커지는 시간" label="페이드 인" unit="초" value={track.fadeIn} min={0} max={10} step={0.1} precision={1} onChange={(fadeIn) => update({ fadeIn }, '페이드 인')} />
        <NumberField title="서서히 작아지는 시간" label="페이드 아웃" unit="초" value={track.fadeOut} min={0} max={10} step={0.1} precision={1} onChange={(fadeOut) => update({ fadeOut }, '페이드 아웃')} />
      </div>
      <label className="row small" style={{ cursor: 'pointer' }}>
        <Toggle on={track.loop} onChange={(loop) => update({ loop }, '반복')} />
        음악이 짧으면 반복 재생
      </label>
      <button
        className="btn sm danger"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          setBgm(ov!.bgm.filter((t) => t.id !== track.id), `배경음악 삭제: ${track.label}`)
          useEditor.setState({ selectedAudio: null })
        }}
      >
        <Trash2 size={13} />
        이 배경음악 빼기
      </button>
    </div>
  )
}
