import { useEffect } from 'react'
import { useStore } from '../../store'
import { ChatPanel } from './ChatPanel'
import { useEditor } from './editorStore'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { useOverrides } from './overrides'
import { Transport } from './Transport'

export function EditorTab({ active }: { active: boolean }) {
  const { project } = useStore()

  // designer shortcuts (ignored while typing)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.closest('.xterm')) return
      const ed = useEditor.getState()
      const fps = project?.brief.output.fps ?? 30
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useOverrides.getState().redo()
        else useOverrides.getState().undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useOverrides.getState().redo()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        if (ed.playing) ed.player?.pause()
        else ed.player?.play()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        ed.player?.pause()
        ed.player?.seek(Math.max(0, ed.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps)))
      } else if (e.key === 'v' || e.key === 'V' || e.key === 'Escape') useEditor.setState({ tool: 'select' })
      else if (e.key === 'm' || e.key === 'M') useEditor.setState({ tool: 'box' })
      else if (e.key === 'p' || e.key === 'P') useEditor.setState({ tool: 'pin' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, project?.brief.output.fps])

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'var(--panel-left) 1fr var(--panel-right)', gridTemplateRows: '100%', overflow: 'clip' }}>
      <ChatPanel />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', margin: 16, background: 'var(--canvas)', borderRadius: 10, overflow: 'clip' }}>
          <Preview active={active} />
        </div>
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Transport />
        </div>
      </div>
      <Inspector />
    </div>
  )
}
