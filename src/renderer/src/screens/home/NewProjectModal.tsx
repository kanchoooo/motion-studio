// 새 프로젝트: from scratch (name, ratio, length) or from a template (pick one, fill in
// its slots). Either way it is made in the chosen folder.
import { useRef, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { OUTPUT_PRESETS, type OutputPresetId } from '@shared/brief'
import type { TemplateValues } from '@shared/api'
import { Modal, NumberField, Segmented } from '../../components/ui'
import { studio, useStore } from '../../store'
import { changedValues, SlotForm } from '../templates/SlotForm'
import { folderOptions } from './folders'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function NewProjectModal({ folder: initialFolder, templateId, onClose }: { folder: string; templateId?: string; onClose: () => void }) {
  const { toast, openProject, folders, templates } = useStore()
  const [mode, setMode] = useState<'blank' | 'template'>(templateId ? 'template' : 'blank')
  const [folder, setFolder] = useState(initialFolder)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<OutputPresetId>('youtube-16x9')
  const [duration, setDuration] = useState(15)
  const [tplId, setTplId] = useState(templateId ?? templates[0]?.id ?? '')
  const [values, setValues] = useState<TemplateValues>({})
  const [check, setCheck] = useState(false)
  const [busy, setBusy] = useState(false)
  const tpl = templates.find((t) => t.id === tplId)

  const inFlight = useRef(false)
  const create = async () => {
    // Enter while finishing a Hangul syllable can fire twice (a ref, not state: both fire in the same tick)
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      if (mode === 'blank') {
        const p = await studio.projects.create({ name: name.trim() || '새 프로젝트', presetId: preset, duration, folder })
        onClose()
        await openProject(p.path)
      } else {
        if (!tpl) throw new Error('템플릿을 골라 주세요.')
        const changed = changedValues(tpl.slots, values)
        const path = await studio.templates.createProject({ templateId: tpl.id, name: name.trim() || tpl.name, folder, values: changed, check })
        onClose()
        await openProject(path)
        if (Object.values(changed).some((v) => v.script) || check) toast('Claude가 바뀐 칸을 마무리하고 있어요. 대화창에서 확인해 주세요.', 'info')
      }
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
      inFlight.current = false
    }
  }

  return (
    <Modal
      title="새 프로젝트"
      onClose={onClose}
      width={mode === 'template' ? 720 : 600}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={busy || (mode === 'template' && !tpl)} onClick={create} data-testid="create-project">
            {mode === 'template' ? '템플릿으로 만들기' : '만들기'}
          </button>
        </>
      }
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'blank', label: '처음부터' },
          { value: 'template', label: <span className="row" style={{ gap: 5 }}><LayoutTemplate size={13} />템플릿으로{templates.length ? ` (${templates.length})` : ''}</span> },
        ]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>프로젝트 이름</label>
          <input className="input" autoFocus placeholder={mode === 'template' && tpl ? tpl.name : '예: 봄 시즌 신제품 15초'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => mode === 'blank' && e.key === 'Enter' && !e.nativeEvent.isComposing && create()} data-testid="project-name" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>폴더</label>
          <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="project-folder">
            {folderOptions(folders).map((o) => (
              <option key={o.value || 'root'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'blank' ? (
        <>
          <div className="field">
            <label>화면 비율</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {OUTPUT_PRESETS.map((p) => {
                const on = p.id === preset
                const w = p.width >= p.height ? 56 : (56 * p.width) / p.height
                const h = p.width >= p.height ? (56 * p.height) / p.width : 56
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className="card"
                    style={{ padding: '14px 8px 10px', cursor: 'pointer', borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--accent-soft)' : 'var(--surface-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                  >
                    <div style={{ height: 60, display: 'flex', alignItems: 'center' }}>
                      <div style={{ width: w, height: h, border: `2px solid ${on ? 'var(--accent)' : 'var(--text-3)'}`, borderRadius: 4 }} />
                    </div>
                    <div style={{ fontWeight: 650 }}>{p.ratio}</div>
                    <div className="tiny muted" style={{ textAlign: 'center' }}>{p.label}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label>길이</label>
            <NumberField value={duration} onChange={setDuration} label="⟷" unit="초" min={1} max={180} />
            <div className="hint">브리프에서 언제든 바꿀 수 있어요.</div>
          </div>
        </>
      ) : templates.length === 0 ? (
        <div className="card empty" style={{ padding: 28 }}>
          <div>아직 템플릿이 없어요. 홈의 <b>템플릿 만들기</b>로 완성한 영상을 템플릿으로 저장해 보세요.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }} data-testid="template-choices">
            {templates.map((t) => {
              const on = t.id === tplId
              return (
                <button
                  key={t.id}
                  type="button"
                  className="card"
                  onClick={() => {
                    setTplId(t.id)
                    setValues({})
                  }}
                  style={{ padding: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--accent-soft)' : 'var(--surface-2)' }}
                  data-testid="template-choice"
                >
                  <div style={{ aspectRatio: '16 / 9', background: 'var(--canvas)', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.cover ? <img src={`${t.url}${t.cover}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <LayoutTemplate size={18} color="var(--text-3)" />}
                  </div>
                  <span className="small ellipsis" style={{ fontWeight: 650 }}>{t.name}</span>
                  <span className="tiny faint">
                    {t.output.width}×{t.output.height} · {t.output.duration}초 · {t.slots.length}칸
                  </span>
                </button>
              )
            })}
          </div>
          {tpl && (
            <>
              <div className="small muted">모션과 구성은 템플릿 그대로예요. 바꿀 칸만 채우세요 (비워 두면 원래대로).</div>
              <SlotForm slots={tpl.slots} base={tpl.url} values={values} onChange={setValues} />
              <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} data-testid="template-check" />
                만든 뒤 Claude가 바뀐 글자·이미지가 넘치거나 겹치지 않는지 점검해요
              </label>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
