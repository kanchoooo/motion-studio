import { useEffect, useState } from 'react'
import { ChevronsLeft, History, Loader2, MessageSquare, Wand2 } from 'lucide-react'
import { Splitter } from '../../components/Splitter'
import { cleanError, studio, useStore } from '../../store'
import { HistoryPanel } from '../history/HistoryPanel'
import { ChatPanel } from './ChatPanel'
import { useEditLocked, useLockNotice, useViewOnly } from './editLock'
import { useEditor } from './editorStore'
import { Inspector } from './Inspector'
import { listedLayers, neighbourLayer } from '@shared/layers'
import { clampSize, fitLayout, LAYOUT_DEFAULTS, useLayout, useWindowSize } from './layout'
import { Preview } from './Preview'
import { EASY_EASE } from '@shared/overrides'
import { copySelection, deleteSelection, duplicateSelection, isLocked, jumpKey, labelOf, nudge, paste, reorder, splitAtPlayhead, toggleLockSelection, trimToPlayhead } from './edit'
import { useOverrides } from './overrides'
import { canvasView } from './Preview'
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
      const cmd = e.metaKey || e.ctrlKey
      // letters by the key pressed, not the character typed: with the Korean keyboard on, V is "ㅍ"
      const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()
      const go = (t: number) => {
        ed.player?.pause()
        const at = Math.max(0, Math.min(ed.duration || t, t))
        ed.player?.seek(at)
        useEditor.setState({ time: at })
      }
      const done = () => e.preventDefault()
      // ---- history ----
      if (cmd && key === 'z') {
        done()
        if (e.shiftKey) useOverrides.getState().redo()
        else useOverrides.getState().undo()
        return
      }
      if (cmd && key === 'y') return done(), useOverrides.getState().redo()
      // ---- layers (After Effects shortcuts) ----
      if (cmd && e.shiftKey && key === 'd') return done(), splitAtPlayhead()
      if (cmd && key === 'd') return done(), duplicateSelection()
      if (cmd && key === 'c') return void copySelection()
      if (cmd && key === 'x') return copySelection() && deleteSelection()
      if (cmd && key === 'v') return done(), paste()
      if (cmd && key === 'a') {
        done()
        // every layer on screen — not the camera, not a character's parts (they move with their character)
        const all = ed.elements.filter((x) => !['sfx', 'bgm', 'voice', 'camera', 'part'].includes(x.type) && x.visible && !isLocked(x.id)).map((x) => x.id)
        return useEditor.setState({ selection: all, selected: all[0] ?? null })
      }
      if (cmd && key === 'l') return done(), toggleLockSelection()
      if (cmd && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        done()
        return reorder(ed.selection, e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'up') : e.shiftKey ? 'back' : 'down')
      }
      if (e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) return done(), trimToPlayhead(e.code === 'BracketLeft' ? 'in' : 'out')
      if (e.key === 'Delete' || e.key === 'Backspace') {
        done()
        if (ed.selectedKeys.length) {
          const st = useOverrides.getState()
          for (const id of [...new Set(ed.selectedKeys.map((k) => k.id))]) st.removeKeys(id, labelOf(id), ed.selectedKeys.filter((k) => k.id === id))
          return useEditor.setState({ selectedKeys: [] })
        }
        return deleteSelection()
      }
      // ---- keyframes ----
      if (e.key === 'F9' && ed.selectedKeys.length) {
        done()
        const st = useOverrides.getState()
        for (const id of [...new Set(ed.selectedKeys.map((k) => k.id))]) st.setKeyEase(id, labelOf(id), ed.selectedKeys.filter((k) => k.id === id), EASY_EASE)
        return
      }
      if (!cmd && key === 'j') return done(), jumpKey(-1)
      if (!cmd && key === 'k') return done(), jumpKey(1)
      if (!cmd && key === 'u' && ed.selection.length) {
        done()
        const open = ed.selection.every((id) => ed.openLayers.includes(id))
        return useEditor.setState({ openLayers: open ? ed.openLayers.filter((id) => !ed.selection.includes(id)) : [...new Set([...ed.openLayers, ...ed.selection])] })
      }
      // ---- time ----
      if (e.code === 'Space') {
        done()
        if (ed.playing) ed.player?.pause()
        else ed.player?.play()
        return
      }
      if (e.key === 'Home') return done(), go(0)
      if (e.key === 'End') return done(), go(ed.duration)
      if (e.key === 'PageUp' || e.key === 'PageDown' || (cmd && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
        done()
        const dir = e.key === 'PageUp' || e.key === 'ArrowLeft' ? -1 : 1
        return go(ed.time + (dir * (e.shiftKey ? 10 : 1)) / fps)
      }
      if (!cmd && key === 'b') return done(), useEditor.setState({ workArea: { a: ed.time, b: Math.max(ed.time + 0.1, ed.workArea?.b ?? ed.duration) } })
      if (!cmd && key === 'n') return done(), useEditor.setState({ workArea: { a: Math.min(ed.workArea?.a ?? 0, ed.time - 0.1), b: ed.time } })
      if (e.key === '*') return done(), useOverrides.getState().addMarker(ed.time)
      // ⌘↑ / ⌘↓: the layer above / below (After Effects); with ⇧ the group it is in / the first layer in it
      if (cmd && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        done()
        const cur = ed.elements.find((x) => x.id === ed.selected)
        if (e.shiftKey) {
          const next = e.key === 'ArrowUp' ? cur?.parent : listedLayers(ed.elements).find((x) => x.parent === cur?.id)?.id
          if (next) ed.select(next)
          return
        }
        const next = neighbourLayer(ed.elements, ed.selected, e.key === 'ArrowUp' ? -1 : 1, (id) => isLocked(id))
        return void (next && ed.select(next))
      }
      if (e.key.startsWith('Arrow')) {
        done()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        // a selected layer moves by whole pixels; with nothing selected ← → step frames
        if (ed.selection.length && ed.tool === 'select') return nudge(dx * (e.shiftKey ? 10 : 1), dy * (e.shiftKey ? 10 : 1))
        if (dx) go(ed.time + dx * (e.shiftKey ? 1 : 1 / fps))
        return
      }
      // ---- canvas view ----
      if (cmd && (e.key === '=' || e.key === '+')) return done(), canvasView.zoomBy(1.25)
      if (cmd && e.key === '-') return done(), canvasView.zoomBy(0.8)
      if (cmd && e.key === '0') return done(), canvasView.fit()
      if (cmd && e.key === '1') return done(), canvasView.actual()
      if (cmd && key === 'r') return done(), useLayout.getState().set({ rulers: !useLayout.getState().rulers })
      if (cmd && e.code === 'Semicolon') return done(), useLayout.getState().set({ showGuides: !useLayout.getState().showGuides })
      // ---- tools ----
      if (e.key === 'Escape') {
        // Esc leaves mask drawing and the markup tools first, then clears the selection
        if (ed.maskDraw) return useEditor.setState({ maskDraw: null })
        if (ed.tool !== 'select') return useEditor.setState({ tool: 'select' })
        useEditor.setState({ selectedKeys: [] })
        return ed.select(null)
      }
      if (cmd || e.altKey) return
      if (key === 'v') useEditor.setState({ tool: 'select' })
      else if (key === 'm') useEditor.setState({ tool: 'box' })
      else if (key === 'p') useEditor.setState({ tool: 'pin' })
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

/**
 * Over the canvas: while Claude works (look, play and listen; no edits until the turn ends), and
 * before 편집 활성화 (the video is refined in the conversation; the button opens hand edits).
 */
function EditLockBanner() {
  const locked = useEditLocked()
  const viewOnly = useViewOnly()
  const at = useLockNotice((s) => s.at)
  const { project, session, toast, setProject } = useStore()
  const [asking, setAsking] = useState(false)
  if (!locked || !project?.hasVideo) return null
  const busy = session.status === 'busy'
  const flash = at && Date.now() - at < 1500 ? ' flash' : ''
  if (viewOnly && !busy)
    return (
      <div key={at} className={`lock-banner activate${flash}`} data-testid="edit-activate-banner">
        <span>
          <b>지금은 보기 모드예요.</b> 마음에 들 때까지 대화로 고치고, 손으로 다듬고 싶어지면 편집을 켜 주세요.
        </span>
        <button
          className="btn primary sm"
          disabled={asking || session.status !== 'ready'}
          title={session.status !== 'ready' ? 'Claude가 대기 중일 때 누를 수 있어요' : '레이어를 하나하나 고를 수 있게 정리해요 (화면은 그대로)'}
          onClick={async () => {
            setAsking(true)
            try {
              const r = await studio.agent.activateEditing(project.meta.id)
              if (r === 'ready') setProject(await studio.projects.state(project.meta.id))
              else toast('편집할 수 있게 정리하고 있어요. 끝나면 바로 편집할 수 있어요.', 'info')
            } catch (e) {
              toast(cleanError(e instanceof Error ? e.message : String(e)), 'error')
            } finally {
              setAsking(false)
            }
          }}
          data-testid="edit-activate"
        >
          {asking ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
          {asking ? '준비하는 중…' : '편집 활성화'}
        </button>
      </div>
    )
  return (
    <div key={at} className={`lock-banner${flash}`} data-testid="edit-lock">
      <Loader2 size={13} className="spin" color="var(--accent)" />
      <span>
        <b>아직 Claude가 작업 중이에요.</b> 지금은 보기·재생만 되고, 작업이 끝나면 {viewOnly ? '편집을 켤 수 있어요.' : '바로 편집할 수 있어요.'}
      </span>
    </div>
  )
}
