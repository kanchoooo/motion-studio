// Templates (템플릿): a finished project saved with chosen fill-in slots (texts, images,
// clips, narration). A new project made from it is a copy with the same motion; only the
// slots change: texts through the designer-edit layer (overrides, so Claude's code stays
// as it was), files by pointing the element at a new file. A new narration script needs
// a new recording, which Claude makes in the new project's session (same voice).
// Templates live in <projects folder>/.templates/<id>/ (hidden from the project list).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import type { Asset, Brief } from '@shared/brief'
import { normalizeOverrides, type Overrides } from '@shared/overrides'
import type { ProjectMeta } from '@shared/project'
import type { TemplateInfo, TemplateSlot, TemplateValues } from '@shared/api'
import { listGenerated } from './ai/generated'
import { folderPath } from './folders'
import * as history from './history'
import { findElements, mediaOf, setAttr, slotKind, textOf } from './htmlSlots'
import { probeMedia } from './media'
import { projectsDir } from './paths'
import { serveFolder } from './preview-server'
import { newId, nowIso, readJson, safeName, uniquePath, writeJson, writeText } from './util'

export const templatesDir = () => join(projectsDir(), '.templates')
const templateDir = (id: string) => join(templatesDir(), id.replace(/[^\w-]/g, ''))
const SKIP = /[\\/](renders|snapshots|\.cache|\.history)([\\/]|$)/

/** the slots a project could offer: every text, image, clip and narration Claude marked as editable */
export function detectSlots(projectDir: string): TemplateSlot[] {
  const index = join(projectDir, 'composition', 'index.html')
  if (!existsSync(index)) throw new Error('아직 영상이 없는 프로젝트예요. 영상을 만든 뒤 템플릿으로 저장해 주세요.')
  const html = readFileSync(index, 'utf8')
  const overrides = normalizeOverrides(readJson<Overrides | null>(join(projectDir, 'overrides.json'), null))
  const made = listGenerated(projectDir)
  const out: TemplateSlot[] = []
  for (const el of findElements(html)) {
    const kind = slotKind(el)
    if (!kind || out.some((s) => s.id === el.id)) continue
    if (kind === 'text') {
      const text = overrides.elements[el.id]?.text ?? textOf(html.slice(el.inner[0], el.inner[1]))
      if (!text) continue
      out.push({ id: el.id, kind, label: el.label || text.slice(0, 20), original: text })
      continue
    }
    const media = mediaOf(html, el)
    if (!media || /^(https?:|data:)/i.test(media.src)) continue
    const slot: TemplateSlot = { id: el.id, kind, label: el.label || basename(media.src), original: media.src }
    // how a narration was made (voice and settings), so a new script can use the same voice
    const g = kind === 'voice' ? made.find((x) => x.file === media.src) : undefined
    if (g) slot.voice = { provider: g.provider, tool: g.tool, args: g.args ?? {}, label: g.label }
    out.push(slot)
  }
  return out
}

function info(dir: string): TemplateInfo | null {
  const t = readJson<Omit<TemplateInfo, 'path' | 'url'> | null>(join(dir, 'template.json'), null)
  if (!t) return null
  return { ...t, path: dir, url: serveFolder(dir) }
}

export function listTemplates(): TemplateInfo[] {
  let names: string[] = []
  try {
    names = readdirSync(templatesDir())
  } catch {
    return []
  }
  return names
    .map((n) => info(join(templatesDir(), n)))
    .filter((t): t is TemplateInfo => !!t)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** saves a finished project as a template with the slots the designer picked */
export function createTemplate(projectDir: string, input: { name: string; slots: TemplateSlot[]; folder?: string }): TemplateInfo {
  if (!input.slots.length) throw new Error('바꿀 칸을 하나 이상 골라 주세요.')
  const meta = readJson<ProjectMeta | null>(join(projectDir, 'project.json'), null)
  const brief = readJson<Brief | null>(join(projectDir, 'brief.json'), null)
  if (!meta || !brief) throw new Error('프로젝트 정보를 읽을 수 없어요.')
  const id = newId()
  const dir = templateDir(id)
  mkdirSync(dir, { recursive: true })
  try {
    cpSync(join(projectDir, 'composition'), join(dir, 'composition'), { recursive: true, filter: (p) => !SKIP.test(p.slice(projectDir.length)) })
    copyFileSync(join(projectDir, 'brief.json'), join(dir, 'brief.json'))
    if (existsSync(join(projectDir, 'overrides.json'))) copyFileSync(join(projectDir, 'overrides.json'), join(dir, 'overrides.json'))
    if (existsSync(join(projectDir, '.studio', 'generated.json'))) cpSync(join(projectDir, '.studio', 'generated.json'), join(dir, 'generated.json'))
    const thumb = join(projectDir, 'thumbnails', 'latest.jpg')
    if (existsSync(thumb)) copyFileSync(thumb, join(dir, 'cover.jpg'))
    const t: Omit<TemplateInfo, 'path' | 'url'> = {
      id,
      name: safeName(input.name, `${meta.name} 템플릿`),
      createdAt: nowIso(),
      sourceName: meta.name,
      folder: input.folder,
      output: { preset: brief.output.preset, width: brief.output.width, height: brief.output.height, duration: brief.output.duration },
      slots: input.slots.map((s) => ({ ...s, label: s.label.trim() || s.id })),
      cover: existsSync(join(dir, 'cover.jpg')) ? 'cover.jpg' : undefined,
    }
    writeJson(join(dir, 'template.json'), t)
    return info(dir)!
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

export function renameTemplate(id: string, name: string): void {
  const dir = templateDir(id)
  const t = readJson<Record<string, unknown> | null>(join(dir, 'template.json'), null)
  if (!t) throw new Error('템플릿을 찾을 수 없어요.')
  writeJson(join(dir, 'template.json'), { ...t, name: safeName(name, String(t.name ?? '템플릿')) })
}

export function removeTemplate(id: string): void {
  rmSync(templateDir(id), { recursive: true, force: true })
}

/** what is left for Claude after the app applied the slots: narration with a new script */
export interface SlotTodo {
  slot: TemplateSlot
  script: string
}

/**
 * Applies slot values to a project folder: texts → designer edits (overrides), files →
 * copied into composition/assets/ and the element points at them (narration length follows
 * the new file). Brief texts / assets that held the old values follow too.
 */
export async function applySlots(projectDir: string, slots: TemplateSlot[], values: TemplateValues): Promise<{ changed: string[]; todo: SlotTodo[] }> {
  const index = join(projectDir, 'composition', 'index.html')
  let html = readFileSync(index, 'utf8')
  const overrides = normalizeOverrides(readJson<Overrides | null>(join(projectDir, 'overrides.json'), null))
  const brief = readJson<Brief>(join(projectDir, 'brief.json'), null as never)
  const changed: string[] = []
  const todo: SlotTodo[] = []
  for (const slot of slots) {
    const v = values[slot.id]
    if (!v) continue
    if (slot.kind === 'text') {
      if (v.text == null) continue
      const before = overrides.elements[slot.id]?.text ?? slot.original
      if (v.text === before) continue
      overrides.elements[slot.id] = { ...overrides.elements[slot.id], text: v.text }
      // a required brief text that was this slot follows the new copy
      brief.texts = brief.texts.map((t) => (t.text.trim() === before.trim() ? { ...t, text: v.text! } : t))
      changed.push(slot.label)
      continue
    }
    if (slot.kind === 'voice' && v.script?.trim() && !v.file) {
      todo.push({ slot, script: v.script.trim() })
      continue
    }
    if (!v.file) continue
    if (!existsSync(v.file)) throw new Error(`"${slot.label}"에 고른 파일을 찾을 수 없어요.`)
    const el = findElements(html).find((e) => e.id === slot.id)
    const media = el ? mediaOf(html, el) : null
    if (!el || !media) throw new Error(`"${slot.label}" 칸을 영상에서 찾지 못했어요.`)
    const assets = join(projectDir, 'composition', 'assets')
    mkdirSync(assets, { recursive: true })
    const ext = extname(v.file).toLowerCase()
    const stem = safeName(basename(v.file, ext), 'file').replace(/\s+/g, '_').slice(0, 40)
    const dst = uniquePath((n) => join(assets, `tpl-${stem}${n ? `_${n + 1}` : ''}${ext}`))
    copyFileSync(v.file, dst)
    const rel = `assets/${basename(dst)}`
    html = setAttr(html, media.at, 'src', rel)
    const meta = await probeMedia(dst)
    if (slot.kind === 'voice' && meta.duration) {
      // the narration plays for its own length
      const again = findElements(html).find((e) => e.id === slot.id)!
      html = setAttr(html, again.open, 'data-duration', meta.duration.toFixed(2))
    }
    // the brief's asset entry for the old file now holds the new one
    brief.assets = brief.assets.map((a: Asset) => (a.file === media.src ? { ...a, file: rel, originalName: basename(v.file!), meta: { ...meta, bytes: statSync(dst).size } } : a))
    changed.push(slot.label)
  }
  writeText(index, html)
  writeJson(join(projectDir, 'overrides.json'), overrides)
  writeJson(join(projectDir, 'brief.json'), brief)
  return { changed, todo }
}

/** a new project from a template, in a folder ('' = top); the caller opens it */
export async function projectFromTemplate(input: { templateId: string; name: string; folder: string; values: TemplateValues }): Promise<{ dir: string; changed: string[]; todo: SlotTodo[]; template: TemplateInfo }> {
  const t = info(templateDir(input.templateId))
  if (!t) throw new Error('템플릿을 찾을 수 없어요.')
  const name = safeName(input.name, t.name)
  const base = folderPath(input.folder)
  mkdirSync(base, { recursive: true })
  const dir = uniquePath((n) => join(base, `${name}${n ? ` ${n + 1}` : ''}.msproj`))
  mkdirSync(dir, { recursive: true })
  try {
    cpSync(join(t.path, 'composition'), join(dir, 'composition'), { recursive: true })
    const brief = readJson<Brief>(join(t.path, 'brief.json'), null as never)
    writeJson(join(dir, 'brief.json'), { ...brief, title: name })
    writeJson(join(dir, 'overrides.json'), readJson(join(t.path, 'overrides.json'), {}))
    writeJson(join(dir, 'chat.json'), [])
    if (existsSync(join(t.path, 'generated.json'))) cpSync(join(t.path, 'generated.json'), join(dir, '.studio', 'generated.json'))
    for (const sub of ['feedback', 'renders', 'thumbnails', 'references', '.studio']) mkdirSync(join(dir, sub), { recursive: true })
    const meta: ProjectMeta = { id: newId(), name, createdAt: nowIso(), updatedAt: nowIso(), appVersion: app.getVersion(), template: { id: t.id, name: t.name } }
    writeJson(join(dir, 'project.json'), meta)
    writeJson(join(dir, 'composition', 'meta.json'), { id: meta.id, name })
    writeJson(join(dir, '.studio', 'template.json'), { id: t.id, name: t.name, slots: t.slots })
    await history.initHistory(dir)
    await history.record(dir, { actor: 'app', summary: `템플릿 "${t.name}"으로 만들었어요` })
    const r = await applySlots(dir, t.slots, input.values)
    if (r.changed.length) await history.record(dir, { actor: 'designer', summary: `템플릿 칸을 채웠어요 (${r.changed.join(', ')})` })
    return { dir, ...r, template: t }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/** the slots of a project made from a template, with their current values */
export function projectSlots(projectDir: string): { name: string; slots: TemplateSlot[]; current: Record<string, string> } | null {
  const t = readJson<{ name: string; slots: TemplateSlot[] } | null>(join(projectDir, '.studio', 'template.json'), null)
  if (!t) return null
  const html = existsSync(join(projectDir, 'composition', 'index.html')) ? readFileSync(join(projectDir, 'composition', 'index.html'), 'utf8') : ''
  const overrides = normalizeOverrides(readJson<Overrides | null>(join(projectDir, 'overrides.json'), null))
  const els = findElements(html)
  const current: Record<string, string> = {}
  for (const s of t.slots) {
    const el = els.find((e) => e.id === s.id)
    if (s.kind === 'text') current[s.id] = overrides.elements[s.id]?.text ?? (el ? textOf(html.slice(el.inner[0], el.inner[1])) : s.original)
    else current[s.id] = (el && mediaOf(html, el)?.src) || s.original
  }
  return { name: t.name, slots: t.slots, current }
}

/** the message that asks Claude to record new narration (and optionally check the layout) */
export function claudeMessage(templateName: string, changed: string[], todo: SlotTodo[], check: boolean): string | null {
  if (!todo.length && !check) return null
  const lines = [`이 프로젝트는 템플릿 "${templateName}"으로 만들었어요. 모션·구성·타이밍은 그대로 두고 아래만 처리해 주세요. 콘티 없이 바로 진행해요.`]
  if (todo.length) {
    lines.push('', '## 새 대본으로 내레이션 다시 녹음')
    for (const t of todo) {
      const how = t.slot.voice ? ` — 원래 녹음: ${t.slot.voice.provider} ${t.slot.voice.tool}, 설정 ${JSON.stringify(t.slot.voice.args)}` : ' — 원래 목소리 정보가 없어요. 브리프의 내레이션 목소리(없으면 어울리는 목소리)로'
      lines.push(`- ${t.slot.label} (data-ms-id="${t.slot.id}", 지금 파일 ${t.slot.original}): "${t.script}"${how}`)
    }
    lines.push('같은 목소리로 녹음해 그 audio 요소의 src와 data-duration만 바꿔 주세요. 새 녹음이 장면보다 길면 억지로 맞추지 말고 저에게 알려 주세요.')
  }
  if (check) {
    lines.push('', `## 바뀐 칸 점검${changed.length ? ` (${changed.join(', ')})` : ''}`, 'look_at_frames로 바뀐 글자·이미지가 넘치거나 잘리거나 겹치지 않는지 확인하고, 문제가 있는 곳만 고쳐 주세요. 글자는 디자이너가 정한 값이라 크기·줄바꿈 조정이 필요하면 먼저 물어봐 주세요.')
  }
  lines.push('', '끝나면 한국어로 짧게 보고해 주세요.')
  return lines.join('\n')
}
