import { useEffect } from 'react'
import { ChevronsLeft, History, Loader2, MessageSquare } from 'lucide-react'
import { Splitter } from '../../components/Splitter'
import { useStore } from '../../store'
import { HistoryPanel } from '../history/HistoryPanel'
import { ChatPanel } from './ChatPanel'
import { useEditLocked, useLockNotice } from './editLock'
import { useEditor } from './editorStore'
import { Inspector } from './Inspector'
import { clampSize, fitLayout, LAYOUT_DEFAULTS, useLayout, useWindowSize } from './layout'
import { Preview } from './Preview'
import { useOverrides } from './overrides'
import { Timeline } from './Timeline'

export function EditorTab({ active }: { active: boolean }) {
  const { project, terminalOpen } = useStore()
  const stored = useLayout()
  const win = useWindowSize()
  // sizes that fit this window (what was chosen on a big monitor shrinks on a laptop)
  const L = { ...stored, ...fitLayout(stored, win, terminalOpen) }

  // designer shortcuts (ignored while typing)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      // typing in a text field, the terminal, or a dialog over the editor: not for the editor
      const typing = t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes((t as HTMLInputElement).type))
      if (typing || t.closest('.xterm') || document.querySelector('.scrim')) return
      // a focused slider would otherwise eat Space/←/→
      if (t.tagName === 'INPUT') (t as HTMLInputElement).blur()
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
      } else if (e.key === 'Escape') {
        // Esc leaves the markup tool first, then clears the selection
        if (ed.tool !== 'select') useEditor.setState({ tool: 'select' })
        else ed.select(null)
      } else if (e.key === 'v' || e.key === 'V') useEditor.setState({ tool: 'select' })
      else if (e.key === 'm' || e.key === 'M') useEditor.setState({ tool: 'box' })
      else if (e.key === 'p' || e.key === 'P') useEditor.setState({ tool: 'pin' })
    }
    // clicking the canvas or timeline while a text field still has focus: commit the text first
    // (the field's editor goes away with the new selection before its blur would run)
    const onDown = (e: PointerEvent) => {
      const a = document.activeElement as HTMLElement | null
      const t = e.target as HTMLElement
      if (!a || !['INPUT', 'TEXTAREA'].includes(a.tagName) || a.contains(t)) return
      if (t.closest('[data-preview-host], [data-testid="timeline"]')) a.blur()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
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
              <EditLockBanner />
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

/** over the canvas while Claude works: look, play and listen, but no edits until the turn ends */
function EditLockBanner() {
  const locked = useEditLocked()
  const at = useLockNotice((s) => s.at)
  const hasVideo = useStore((s) => !!s.project?.hasVideo)
  if (!locked || !hasVideo) return null
  return (
    <div key={at} className={`lock-banner${at && Date.now() - at < 1500 ? ' flash' : ''}`} data-testid="edit-lock">
      <Loader2 size={13} className="spin" color="var(--accent)" />
      <span>
        <b>아직 Claude가 작업 중이에요.</b> 지금은 보기·재생만 되고, 작업이 끝나면 바로 편집할 수 있어요.
      </span>
    </div>
  )
}
