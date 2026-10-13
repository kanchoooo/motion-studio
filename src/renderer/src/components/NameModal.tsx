// Small "name it" dialog (window.prompt does not exist in Electron).
import { useState } from 'react'
import { Modal } from './ui'

export function NameModal({ title, label, initial = '', confirm = '저장', onSubmit, onClose }: { title: string; label?: string; initial?: string; confirm?: string; onSubmit(name: string): void | Promise<void>; onClose(): void }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>
            {confirm}
          </button>
        </>
      }
    >
      {label && <div className="small muted">{label}</div>}
      <input
        className="input"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}
      />
    </Modal>
  )
}
