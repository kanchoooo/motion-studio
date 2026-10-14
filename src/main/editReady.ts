// "편집 준비" — the last step of building a video. Claude designs freely (flex, grid,
// transforms), then turns every editable element into an absolutely placed one so the
// designer can move / scale / rotate each on its own. Two helpers make that exact:
//  - measureLayout: each editable element's box relative to its parent element, read
//    with transforms switched off (the layout the CSS produces, not a moment of a move)
//  - layoutSnapshot: frames at the same moments before and after the change, compared
//    pixel by pixel, so a conversion that shifts anything is caught.
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { serveFolder } from './preview-server'

async function open(projectDir: string, size: { width: number; height: number }) {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.setAudioMuted(true)
  const limit = setTimeout(() => win.destroy(), 120_000)
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
  await win.loadURL(`${serveFolder(join(projectDir, 'composition'))}index.html?ms-preview=1`)
  for (let i = 0; i < 80; i++) {
    if (await js<boolean>('!!(window.__player && window.__playerReady)')) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await js('document.fonts ? document.fonts.ready.then(() => true) : true')
  const seek = (t: number) =>
    js(`(async () => { const P = window.__player; P.pause(); P.seek(${t}); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true })()`)
  const close = () => {
    clearTimeout(limit)
    if (!win.isDestroyed()) win.destroy()
  }
  return { win, js, seek, close }
}

export interface MeasuredBox {
  id: string
  label: string
  /** the CSS position it has now */
  position: string
  /** placed by the layout (flex / grid / normal flow) rather than by left/top */
  inFlow: boolean
  /** the parent element its numbers are measured from, and that parent's size */
  parent: string
  parentPosition: string
  parentSize: { width: number; height: number }
  left: number
  top: number
  width: number
  height: number
  visible: boolean
}

/** every editable element's box relative to its parent, at time `at`, transforms off */
export async function measureLayout(projectDir: string, size: { width: number; height: number }, at: number): Promise<MeasuredBox[]> {
  const h = await open(projectDir, size)
  try {
    await h.seek(at)
    return await h.js<MeasuredBox[]>(`(() => {
      const st = document.createElement('style')
      st.textContent = '*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;transition:none!important}'
      document.head.appendChild(st)
      const r2 = (n) => Math.round(n * 100) / 100
      const name = (e) => e.getAttribute('data-ms-id') ? 'data-ms-id=' + e.getAttribute('data-ms-id') : e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')
      const out = []
      for (const el of document.querySelectorAll('[data-ms-id]')) {
        if (el.tagName === 'AUDIO' || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
        // the runtime's invisible edit wrapper fills the real parent: measure from the real one
        let p = el.parentElement
        if (p && p.hasAttribute('data-ms-wrap-for')) p = p.parentElement
        if (!p) continue
        const cs = getComputedStyle(el), pcs = getComputedStyle(p)
        const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect()
        out.push({
          id: el.getAttribute('data-ms-id'),
          label: el.getAttribute('data-ms-label') || '',
          position: cs.position,
          inFlow: cs.position !== 'absolute' && cs.position !== 'fixed',
          parent: name(p),
          parentPosition: pcs.position,
          parentSize: { width: r2(p.clientWidth), height: r2(p.clientHeight) },
          left: r2(r.left - pr.left - p.clientLeft),
          top: r2(r.top - pr.top - p.clientTop),
          width: r2(r.width),
          height: r2(r.height),
          visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        })
      }
      st.remove()
      return out
    })()`)
  } finally {
    h.close()
  }
}

const checkDir = (projectDir: string) => join(projectDir, '.studio', 'layout-check')

/**
 * label 'before': photographs the moments and keeps them. label 'after': photographs the
 * same moments and compares (% of pixels that changed visibly; a red-marked image is
 * saved for every moment that changed).
 */
export async function layoutSnapshot(
  projectDir: string,
  size: { width: number; height: number; duration: number },
  label: 'before' | 'after',
  times?: number[],
): Promise<{ times: number[]; results?: { t: number; changedPct: number; diff?: string }[] }> {
  const dir = checkDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const metaFile = join(dir, 'times.json')
  const ts =
    label === 'after' && existsSync(metaFile)
      ? (JSON.parse(readFileSync(metaFile, 'utf8')) as number[])
      : (times?.length ? times : Array.from({ length: 8 }, (_, i) => +(((i + 0.5) * size.duration) / 8).toFixed(2))).slice(0, 16)
  const h = await open(projectDir, size)
  const shots: Buffer[] = []
  try {
    for (const t of ts) {
      await h.seek(t)
      await new Promise((r) => setTimeout(r, 80))
      shots.push((await h.win.webContents.capturePage()).toPNG())
    }
  } finally {
    h.close()
  }
  if (label === 'before') {
    shots.forEach((png, i) => writeFileSync(join(dir, `before-${i}.png`), png))
    writeFileSync(metaFile, JSON.stringify(ts))
    return { times: ts }
  }
  const results: { t: number; changedPct: number; diff?: string }[] = []
  for (let i = 0; i < ts.length; i++) {
    const beforeFile = join(dir, `before-${i}.png`)
    if (!existsSync(beforeFile)) continue
    const a = await sharp(beforeFile).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const b = await sharp(shots[i]).resize(a.info.width, a.info.height).removeAlpha().raw().toBuffer()
    const marked = Buffer.from(a.data)
    let changed = 0
    for (let k = 0; k < a.data.length; k += 3) {
      const d = Math.abs(a.data[k] - b[k]) + Math.abs(a.data[k + 1] - b[k + 1]) + Math.abs(a.data[k + 2] - b[k + 2])
      if (d > 45) {
        changed++
        marked[k] = 255
        marked[k + 1] = 0
        marked[k + 2] = 0
      }
    }
    const pct = +((changed / (a.data.length / 3)) * 100).toFixed(2)
    let diff: string | undefined
    if (pct > 0.05) {
      diff = `.studio/layout-check/diff-${i}.png`
      await sharp(marked, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toFile(join(projectDir, diff))
    }
    results.push({ t: ts[i], changedPct: pct, diff })
  }
  return { times: ts, results }
}
