// 템플릿 칸 바꾸기: in a project made from a template, change its slots again
// (texts at once; new files at once; a new narration script goes to Claude).
import { useEffect, useState } from 'react'
import type { TemplateSlot, TemplateValues } from '@shared/api'
import { Modal } from '../../components/ui'
import { studio, useStore } from '../../store'
import { changedValues, SlotForm } from './SlotForm'
import { flushOverrides } from '../editor/overrides'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function TemplateSlotsModal({ onClose }: { onClose(): void }) {
  const { project, setProject, toast } = useStore()
  const pid = project!.meta.id
  const [data, setData] = useState<{ name: string; slots: TemplateSlot[]; current: Record<string, string> } | null>(null)
  const [base, setBase] = useState('')
  const [values, setValues] = useState<TemplateValues>({})
  const [check, setCheck] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void studio.templates.slots(pid).then(setData)
    void studio.projects.fileUrl(pid, '').then(setBase)
  }, [pid])
  const changed = data ? changedValues(data.slots, values, data.current) : {}
  const apply = async () => {
    setBusy(true)
    try {
      await flushOverrides()
      setProject(await studio.templates.apply(pid, changed, check))
      toast(Object.values(changed).some((v) => v.script) || check ? '바꿨어요. 나머지는 Claude가 마무리하고 있어요.' : '템플릿 칸을 바꿨어요', 'success')
      onClose()
    } catch (e) {
      toast(errText(e), 'error')
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`템플릿 칸 바꾸기${data ? ` · ${data.name}` : ''}`}
      onClose={onClose}
      width={680}
      footer={
        <>
          <span className="small muted grow">{Object.keys(changed).length ? `${Object.keys(changed).length}칸을 바꿔요` : '바꿀 칸을 고쳐 주세요'}</span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={busy || !Object.keys(changed).length} onClick={apply} data-testid="slots-apply">
            바꾸기
          </button>
        </>
      }
    >
      {data && base ? (
        <>
          <SlotForm slots={data.slots} base={base} current={data.current} values={values} onChange={setValues} />
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} />
            바꾼 뒤 Claude가 넘침·겹침을 점검해요
          </label>
        </>
      ) : (
        <div className="small muted">불러오는 중…</div>
      )}
    </Modal>
  )
}
