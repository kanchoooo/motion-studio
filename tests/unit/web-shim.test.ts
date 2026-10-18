import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVENTS, INVOKE, SENDS } from '../../src/shared/web-channels'

// 관제용 웹 연결: the browser's window.studio must offer what the preload offers, on the same channels
const preload = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'index.ts'), 'utf8')
function fromPreload() {
  const invoke: Record<string, Record<string, string>> = {}
  const events: Record<string, Record<string, string>> = {}
  const sends: Record<string, Record<string, string>> = {}
  let ns = ''
  for (const line of preload.split(/\r?\n/)) {
    const open = line.match(/^ {2}(\w+): \{$/)
    if (open) ns = open[1]
    const m = line.match(/^ {4}(\w+): \([^)]*\) => (invoke|subscribe<[^>]+>|ipcRenderer\.send)\('([^']+)'/)
    if (!m || !ns) continue
    const table = m[2] === 'invoke' ? invoke : m[2] === 'ipcRenderer.send' ? sends : events
    ;(table[ns] ??= {})[m[1]] = m[3]
  }
  return { invoke, events, sends }
}

describe('web shim', () => {
  const p = fromPreload()
  it('reads the preload (sanity)', () => {
    expect(Object.keys(p.invoke).length).toBeGreaterThan(10)
    expect(p.invoke.app.checkUpdate).toBe('app:checkUpdate')
    expect(p.sends.terminal.write).toBe('terminal:write')
  })
  it('every preload invoke is in the shim, on the same channel', () => {
    const shim = Object.fromEntries(Object.entries(INVOKE).map(([ns, ms]) => [ns, Object.fromEntries(ms.map((m) => [m, `${ns}:${m}`]))]))
    expect(shim).toEqual(p.invoke)
  })
  it('the same events and fire-and-forget channels', () => {
    expect(EVENTS).toEqual(p.events)
    expect(SENDS).toEqual(p.sends)
  })
})
