// The plan Claude shows as a storyboard (콘티): the sketch cells it drew in
// composition/storyboard.html (one per scene, id="frame-NN"), photographed by the app, and the
// materials each scene needs. The designer assigns files to those materials; the current
// storyboard lives in <project>/storyboard.json (the app's own file).
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CurrentStoryboard, Storyboard, StoryMaterial } from '@shared/api'
import { serveFolder } from './preview-server'
import { readJson, writeJson } from './util'

const file = (projectDir: string) => join(projectDir, 'storyboard.json')

export const readStoryboard = (projectDir: string): CurrentStoryboard | null => readJson<CurrentStoryboard | null>(file(projectDir), null)
export const writeStoryboard = (projectDir: string, cur: CurrentStoryboard) => writeJson(file(projectDir), cur)

/** every material gets a stable id ("s<scene>-m<k>"); ids Claude gave are kept when unique */
export function withMaterialIds(sb: Storyboard): Storyboard {
  const seen = new Set<string>()
  return {
    ...sb,
    scenes: sb.scenes.map((s, i) => {
      const n = s.n || i + 1
      return {
        ...s,
        n,
        materials: (s.materials ?? []).map((m, k) => {
          let id = (m.id ?? '').replace(/[^\w-]/g, '').slice(0, 24)
          for (let j = 1; !id || seen.has(id); j++) id = `s${n}-m${k + j}`
          seen.add(id)
          return { ...m, id }
        }),
      }
    }),
  }
}

/** keeps the designer's assignments when Claude shows a revised storyboard (same material id or same label) */
export function carryAssignments(next: Storyboard, prev: Storyboard | null | undefined): Storyboard {
  if (!prev) return next
  const old = prev.scenes.flatMap((s) => (s.materials ?? []).map((m) => ({ scene: s.n, m })))
  return {
    ...next,
    scenes: next.scenes.map((s) => ({
      ...s,
      materials: (s.materials ?? []).map((m) => {
        if (m.file) return m
        const hit = old.find((o) => o.m.file && o.m.kind === m.kind && (o.m.id === m.id || (o.scene === s.n && o.m.label === m.label)))
        return hit ? { ...m, file: hit.m.file } : m
      }),
    })),
  }
}

export function findMaterial(sb: Storyboard, id: string): { scene: number; material: StoryMaterial } | null {
  for (const s of sb.scenes) for (const m of s.materials ?? []) if (m.id === id) return { scene: s.n, material: m }
  return null
}

/** assigns (or clears) a file; after approval the change is remembered for Claude's next message */
export function assignMaterial(projectDir: string, materialId: string, fileRel: string | null): CurrentStoryboard {
  const cur = readStoryboard(projectDir)
  if (!cur) throw new Error('콘티가 아직 없어요.')
  const hit = findMaterial(cur.storyboard, materialId)
  if (!hit) throw new Error('이 소재 칸을 찾을 수 없어요. 콘티가 바뀌었을 수 있어요.')
  const next: CurrentStoryboard = {
    ...cur,
    storyboard: {
      ...cur.storyboard,
      scenes: cur.storyboard.scenes.map((s) => ({ ...s, materials: (s.materials ?? []).map((m) => (m.id === materialId ? { ...m, file: fileRel ?? undefined } : m)) })),
    },
  }
  if (cur.status === 'approved') {
    const line = `장면 ${hit.scene} · ${hit.material.label}: ${fileRel ? `${fileRel} 로 바꿨어요` : '디자이너가 비웠어요(알아서 채워 주세요)'}`
    next.changed = [...(cur.changed ?? []).filter((l) => !l.startsWith(`장면 ${hit.scene} · ${hit.material.label}:`)), line]
  }
  writeStoryboard(projectDir, next)
  return next
}

/** the materials of every scene, for Claude: assigned files and empty slots */
export function assignmentLines(sb: Storyboard): string[] {
  const out: string[] = []
  for (const s of sb.scenes)
    for (const m of s.materials ?? [])
      out.push(`- 장면 ${s.n} · ${m.label} (${m.kind === 'video' ? '영상' : '이미지'}, ${m.id}): ${m.file ? `${m.file} — 이 파일을 써요` : '비어 있음 — 알아서 채워요(직접 만들거나 생성)'}`)
  return out
}

export const emptyMaterials = (sb: Storyboard) => sb.scenes.flatMap((s) => (s.materials ?? []).filter((m) => !m.file).map((m) => ({ scene: s.n, label: m.label })))

/**
 * Photographs each cell (id="frame-NN") of composition/storyboard.html. Returns frame number →
 * project-relative png. Cells are drawn at the video's aspect ratio by Claude; the window is
 * wide enough for a three-column sheet.
 */
export async function shootCells(projectDir: string, htmlRel = 'storyboard.html', stamp = `${Date.now()}`): Promise<Record<number, string>> {
  const src = join(projectDir, 'composition', htmlRel)
  if (!/^[\w./-]+\.html$/.test(htmlRel) || htmlRel.includes('..') || !existsSync(src)) return {}
  const win = new BrowserWindow({ show: false, width: 1800, height: 2400, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setAudioMuted(true)
  const limit = setTimeout(() => !win.isDestroyed() && win.destroy(), 60_000)
  const out: Record<number, string> = {}
  try {
    await win.loadURL(`${serveFolder(join(projectDir, 'composition'))}${htmlRel}`)
    const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
    await js('document.fonts ? document.fonts.ready.then(() => true) : true')
    await new Promise((r) => setTimeout(r, 300))
    const ids = await js<string[]>(`[...document.querySelectorAll('[id^="frame-"]')].map((e) => e.id).filter((id) => /^frame-\\d+$/.test(id))`)
    const dirRel = join('.studio', 'storyboard', stamp)
    mkdirSync(join(projectDir, dirRel), { recursive: true })
    for (const id of ids.slice(0, 40)) {
      const rect = await js<{ x: number; y: number; width: number; height: number } | null>(`(() => {
        const el = document.getElementById(${JSON.stringify(id)})
        if (!el) return null
        el.scrollIntoView({ block: 'start', inline: 'nearest' })
        const r = el.getBoundingClientRect()
        return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(Math.min(r.width, innerWidth)), height: Math.ceil(Math.min(r.height, innerHeight)) }
      })()`)
      if (!rect || rect.width < 8 || rect.height < 8) continue
      await new Promise((r) => setTimeout(r, 60))
      const png = (await win.webContents.capturePage(rect)).toPNG()
      const n = Number(id.slice(6))
      const rel = join(dirRel, `frame-${String(n).padStart(2, '0')}.png`).replace(/\\/g, '/')
      writeFileSync(join(projectDir, rel), png)
      out[n] = rel
    }
  } catch {
    /* no sketch pictures: the card shows the scenes in words */
  } finally {
    clearTimeout(limit)
    if (!win.isDestroyed()) win.destroy()
  }
  return out
}
