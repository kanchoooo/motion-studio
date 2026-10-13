import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { studio, useStore } from '../store'

export const TERM_THEMES = {
  dark: { background: '#0f0f11', foreground: '#e6e6ea', cursor: '#5b7fff', selectionBackground: 'rgba(91,127,255,0.35)' },
  light: { background: '#fbfbfc', foreground: '#1d1d22', cursor: '#3d63f5', selectionBackground: 'rgba(61,99,245,0.25)', black: '#1d1d22', brightBlack: '#6b6b75' },
}

/** live view of a Claude Code PTY (raw TUI), resized only when the grid actually changes */
export function XTerm({ sessionId, active = true, style }: { sessionId: string; active?: boolean; style?: React.CSSProperties }) {
  const theme = useStore((s) => s.theme)
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!host.current) return
    const t = new Terminal({
      fontFamily: 'Menlo, "SF Mono", Consolas, "D2Coding", "Apple SD Gothic Neo", "Malgun Gothic", monospace',
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 8000,
      allowProposedApi: true,
      theme: TERM_THEMES[useStore.getState().theme],
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new Unicode11Addon())
    t.unicode.activeVersion = '11'
    t.open(host.current)
    term.current = t
    fit.current = f
    void studio.terminal.snapshot(sessionId).then((buf) => buf && t.write(buf))
    const off = studio.agent.onEvent((e) => {
      if (e.type === 'pty-data' && e.projectId === sessionId) t.write(e.data)
    })
    const input = t.onData((d) => studio.terminal.write(sessionId, d))
    let last = ''
    const resize = () => {
      if (!host.current || host.current.clientHeight < 20 || host.current.clientWidth < 20) return
      try {
        f.fit()
      } catch {
        return
      }
      const key = `${t.cols}x${t.rows}`
      if (key !== last) {
        last = key
        studio.terminal.resize(sessionId, t.cols, t.rows)
      }
    }
    const ro = new ResizeObserver(() => requestAnimationFrame(resize))
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      off()
      input.dispose()
      t.dispose()
      term.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (term.current) term.current.options.theme = TERM_THEMES[theme]
  }, [theme])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
        if (term.current) studio.terminal.resize(sessionId, term.current.cols, term.current.rows)
      } catch {
        /* not laid out yet */
      }
      term.current?.focus()
    })
  }, [active, sessionId])

  return <div ref={host} style={{ flex: 1, minHeight: 0, ...style }} />
}
