// Filling in a template's slots: new copy for texts, a new file for images / clips,
// a new script (Claude records it in the same voice) or a recording for narration.
import { Check, FileAudio, Film, Image as ImageIcon, Mic, Type, Upload, X } from 'lucide-react'
import type { TemplateSlot, TemplateValues } from '@shared/api'
import { studio, useStore } from '../../store'

const KIND = {
  text: { label: '글자', icon: Type },
  image: { label: '이미지', icon: ImageIcon },
  video: { label: '영상', icon: Film },
  voice: { label: '내레이션', icon: Mic },
} as const

const EXT = {
  image: /\.(png|jpe?g|webp|gif|svg|avif)$/i,
  video: /\.(mp4|mov|webm|m4v)$/i,
  voice: /\.(mp3|wav|m4a|aac|ogg)$/i,
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export function SlotForm({ slots, base, current, values, onChange }: { slots: TemplateSlot[]; base: string; current?: Record<string, string>; values: TemplateValues; onChange(v: TemplateValues): void }) {
  const { toast } = useStore()
  const set = (id: string, patch: TemplateValues[string]) => onChange({ ...values, [id]: { ...values[id], ...patch } })
  const pick = async (s: TemplateSlot) => {
    const [file] = await studio.app.pickFiles('assets')
    if (!file) return
    const re = EXT[s.kind as keyof typeof EXT]
    if (re && !re.test(file)) return toast(`${KIND[s.kind].label} 파일을 골라 주세요.`, 'error')
    set(s.id, { file })
  }
  return (
    <div className="col" style={{ gap: 10 }} data-testid="slot-form">
      {slots.map((s) => {
        const Icon = KIND[s.kind].icon
        const now = current?.[s.id] ?? s.original
        const v = values[s.id] ?? {}
        const media = s.kind !== 'text' ? `${base}composition/${now}` : ''
        const text = v.text ?? now
        const long = s.kind === 'text' && text.length > Math.max(4, Math.round(s.original.length * 1.3))
        return (
          <div key={s.id} className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="slot-row" data-slot={s.id}>
            <div className="row small" style={{ gap: 6 }}>
              <Icon size={13} color="var(--accent)" />
              <b className="grow ellipsis">{s.label}</b>
              <span className="badge">{KIND[s.kind].label}</span>
            </div>
            {s.hint && <div className="tiny muted">{s.hint}</div>}
            {s.kind === 'text' && (
              <>
                <textarea className="textarea" rows={Math.min(4, Math.max(1, text.split('\n').length))} value={text} onChange={(e) => set(s.id, { text: e.target.value })} data-testid="slot-text" />
                <div className="tiny" style={{ color: long ? 'var(--warning)' : 'var(--text-3)' }}>
                  원본 {s.original.length}자 · 지금 {text.length}자{long ? ' · 원본보다 꽤 길어요. 넘치지 않는지 확인해 주세요.' : ''}
                </div>
              </>
            )}
            {(s.kind === 'image' || s.kind === 'video') && (
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 96, height: 64, borderRadius: 6, overflow: 'hidden', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: v.file ? 0.35 : 1 }}>
                  {s.kind === 'image' ? <img src={media} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <video src={media} muted style={{ maxWidth: '100%', maxHeight: '100%' }} />}
                </div>
                <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
                  {v.file ? (
                    <span className="row small" style={{ gap: 4, color: 'var(--success)' }}>
                      <Check size={13} />
                      <span className="ellipsis">{fileName(v.file)}</span>
                    </span>
                  ) : (
                    <span className="tiny muted ellipsis">지금: {fileName(now)}</span>
                  )}
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => void pick(s)} data-testid="slot-pick">
                      <Upload size={12} />
                      {v.file ? '다른 파일' : '파일 바꾸기'}
                    </button>
                    {v.file && (
                      <button className="btn sm ghost" onClick={() => set(s.id, { file: undefined })}>
                        <X size={12} />
                        원래대로
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {s.kind === 'voice' && (
              <>
                <audio src={media} controls style={{ width: '100%', height: 32 }} />
                <textarea
                  className="textarea"
                  rows={2}
                  value={v.script ?? ''}
                  disabled={!!v.file}
                  onChange={(e) => set(s.id, { script: e.target.value })}
                  placeholder={`새 대본 (비워 두면 그대로). Claude가 ${s.voice ? '같은 목소리로' : '어울리는 목소리로'} 다시 녹음해요.`}
                  data-testid="slot-script"
                />
                <div className="row tiny" style={{ gap: 6 }}>
                  <span className="muted grow">{s.voice?.label ? `원래 대본: ${s.voice.label}` : '또는 녹음 파일을 직접 올려도 돼요.'}</span>
                  {v.file ? (
                    <>
                      <span className="row" style={{ gap: 4, color: 'var(--success)' }}>
                        <FileAudio size={12} />
                        {fileName(v.file)}
                      </span>
                      <button className="btn sm ghost" onClick={() => set(s.id, { file: undefined })}>
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <button className="btn sm" onClick={() => void pick(s)}>
                      <Upload size={12} />
                      녹음 파일 올리기
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** only the slots the designer actually changed */
export function changedValues(slots: TemplateSlot[], values: TemplateValues, current?: Record<string, string>): TemplateValues {
  const out: TemplateValues = {}
  for (const s of slots) {
    const v = values[s.id]
    if (!v) continue
    if (s.kind === 'text' && v.text != null && v.text !== (current?.[s.id] ?? s.original)) out[s.id] = { text: v.text }
    else if (v.file) out[s.id] = { file: v.file }
    else if (s.kind === 'voice' && v.script?.trim()) out[s.id] = { script: v.script.trim() }
  }
  return out
}
