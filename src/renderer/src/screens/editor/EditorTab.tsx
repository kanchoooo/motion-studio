import { useEffect } from 'react'
import { ChevronsLeft, History, MessageSquare } from 'lucide-react'
import { Splitter } from '../../components/Splitter'
import { useStore } from '../../store'
import { HistoryPanel } from '../history/HistoryPanel'
import { ChatPanel } from './ChatPanel'
import { useEditor } from './editorStore'
import { Inspector } from './Inspector'
import { clampSize, LAYOUT_DEFAULTS, useLayout } from './layout'
import { Preview } from './Preview'
import { useOverrides } from './overrides'
import { Timeline } from './Timeline'

export function EditorTab({ active }: { active: boolean }) {
  const { project } = useStore()
  const L = useLayout()

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
    <div style={{ height: '100%', display: 'flex', overflow: 'clip' }} data-testid="editor">
      {L.chatOpen ? (
        <>
          <div style={{ width: L.chatW, flex: 'none', minWidth: 0, position: 'relative' }} data-testid="chat-panel">
            <ChatPanel onFold={() => L.set({ chatOpen: false })} />
          </div>
          <Splitter dir="x" value={L.chatW} onChange={(v) => L.set({ chatW: clampSize('chatW', v) })} onReset={() => L.set({ chatW: LAYOUT_DEFAULTS.chatW })} />
        </>
      ) : (
        <div className="rail" style={{ borderLeft: 'none', borderRight: '1px solid var(--border)' }}>
          <button className="rail-btn" title="대화 펼치기" onClick={() => L.set({ chatOpen: true })}>
            <MessageSquare size={14} />
            Claude와 대화
          </button>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, background: 'var(--bg)', display: 'flex' }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative', margin: 12, background: 'var(--canvas)', borderRadius: 10, overflow: 'clip' }}>
              <Preview active={active} />
            </div>
          </div>
          <Splitter dir="x" invert value={L.inspectorW} onChange={(v) => L.set({ inspectorW: clampSize('inspectorW', v) })} onReset={() => L.set({ inspectorW: LAYOUT_DEFAULTS.inspectorW })} />
          <div style={{ width: L.inspectorW, flex: 'none', minWidth: 0, display: 'flex' }} data-testid="inspector">
            <Inspector />
          </div>
          {L.historyOpen && (
            <>
              <Splitter dir="x" invert value={L.historyW} onChange={(v) => L.set({ historyW: clampSize('historyW', v) })} onReset={() => L.set({ historyW: LAYOUT_DEFAULTS.historyW })} />
              <div style={{ width: L.historyW, flex: 'none', minWidth: 0 }}>
                <HistoryPanel onClose={() => L.set({ historyOpen: false })} />
              </div>
            </>
          )}
          {!L.historyOpen && (
            <div className="rail">
              <button className="rail-btn" title="작업 이력 펼치기" onClick={() => L.set({ historyOpen: true })} data-testid="history-toggle">
                <History size={14} />
                이력
                <ChevronsLeft size={12} />
              </button>
            </div>
          )}
        </div>
        <Splitter dir="y" invert value={L.timelineH} onChange={(v) => L.set({ timelineH: clampSize('timelineH', v) })} onReset={() => L.set({ timelineH: LAYOUT_DEFAULTS.timelineH })} />
        <div style={{ height: L.timelineH, flex: 'none', borderTop: '1px solid var(--border)', minHeight: 0 }}>
          <Timeline />
        </div>
      </div>
    </div>
  )
}
