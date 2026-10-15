// 출력 사양 — the only thing set by hand before planning: ratio, size, length, frame rate.
// (File format, quality and sound are chosen when exporting; the safe-zone guide in the editor.)
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { FPS_OPTIONS, OUTPUT_PRESETS, type OutputSpec } from '@shared/brief'
import { Field, NumberField, Segmented } from '../../components/ui'
import { cleanError, studio, useStore } from '../../store'

export function OutputPopup({ onClose }: { onClose(): void }) {
  const { project, setProject, toast } = useStore()
  const pid = project!.meta.id
  const [o, setO] = useState<OutputSpec>(project!.brief.output)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setO(project!.brief.output), [project?.meta.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (box.current && !box.current.contains(t) && !t.closest('[data-testid="brief-nav-output"]')) onClose()
    }
    // (Esc typed into the terminal is the terminal's)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest?.('.xterm') && onClose()
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])

  const set = (patch: Partial<OutputSpec>) => {
    const next = { ...o, ...patch }
    setO(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const saved = await studio.projects.saveOutput(pid, { preset: next.preset, width: next.width, height: next.height, duration: next.duration, fps: next.fps, safeZone: next.safeZone })
        if (useStore.getState().project?.meta.id === pid) setProject(saved)
      } catch (e) {
        toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
      }
    }, 350)
  }

  return (
    <div ref={box} className="popover fade-in col" style={{ left: 244, top: 34, width: 460, gap: 16 }} data-testid="output-popup">
      <div className="row">
        <div className="grow col" style={{ gap: 2 }}>
          <b>출력 사양</b>
          <span className="tiny muted">Claude는 이 크기·길이·프레임 수로 영상을 만들어요. 나머지는 대화로 정해요.</span>
        </div>
        <button className="icon-btn" title="닫기" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <Field label="화면 비율">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {[...OUTPUT_PRESETS, { id: 'custom' as const, label: '직접 입력', ratio: '자유', width: o.width, height: o.height, safeZone: o.safeZone }].map((p) => {
            const on = o.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                className="card"
                onClick={() => (p.id === 'custom' ? set({ preset: 'custom' }) : set({ preset: p.id, width: p.width, height: p.height, safeZone: p.safeZone }))}
                style={{ padding: '8px 4px', cursor: 'pointer', borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'var(--accent-soft)' : 'var(--surface-2)' }}
                data-testid={`preset-${p.id}`}
              >
                <div style={{ fontWeight: 650 }}>{p.ratio}</div>
                <div className="tiny muted">{p.label}</div>
              </button>
            )
          })}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="가로">
          <NumberField value={o.width} onChange={(width) => set({ width, preset: 'custom' })} label="W" unit="px" min={64} max={7680} step={2} />
        </Field>
        <Field label="세로">
          <NumberField value={o.height} onChange={(height) => set({ height, preset: 'custom' })} label="H" unit="px" min={64} max={7680} step={2} />
        </Field>
        <Field label="길이">
          <NumberField value={o.duration} onChange={(duration) => set({ duration })} label="⟷" unit="초" min={1} max={180} precision={1} step={0.5} />
        </Field>
      </div>
      <Field label="프레임 수 (fps)" hint={FPS_OPTIONS.find((f) => Math.abs(f.value - o.fps) < 0.01)?.hint}>
        <Segmented value={String(o.fps)} onChange={(v) => set({ fps: Number(v) })} options={FPS_OPTIONS.map((f) => ({ value: String(f.value), label: f.label }))} />
      </Field>
    </div>
  )
}
