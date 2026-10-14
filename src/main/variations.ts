// Variations: new sizes / lengths made from a finished video. Each variation is a
// full project of its own (chat, direct edits, sound, history, export), linked to
// its family. Re-layouts are done by Claude one at a time; same-ratio length
// changes can be a plain speed change, same-ratio size changes a scale at export.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import git from 'isomorphic-git'
import fs from 'node:fs'
import { app } from 'electron'
import { OUTPUT_PRESETS, type Brief, type OutputPresetId } from '@shared/brief'
import { normalizeOverrides, type Overrides } from '@shared/overrides'
import type { FamilyInfo, ProjectMeta, ProjectState, VariationMethod } from '@shared/project'
import * as history from './history'
import * as projects from './projects'
import { isInside } from './folders'
import { projectsDir } from './paths'
import { newId, nowIso, readJson, safeName, uniquePath, writeJson } from './util'

export interface VariationTarget {
  preset: OutputPresetId
  width: number
  height: number
  duration: number
  /** only used when the aspect ratio is unchanged and the length changes */
  lengthMethod?: 'claude' | 'retime'
  /** what else the designer wants in this variation (always done by Claude) */
  note?: string
}

export interface VariationRequest {
  base: { kind: 'current' } | { kind: 'history'; id: string; label: string }
  targets: VariationTarget[]
}

const sameAspect = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width / a.height - b.width / b.height) < 0.002

export function ratioLabel(w: number, h: number): string {
  return OUTPUT_PRESETS.find((p) => p.width * h === p.height * w)?.ratio ?? `${w}×${h}`
}

export function methodFor(base: { width: number; height: number; duration: number }, t: VariationTarget): VariationMethod {
  if (!sameAspect(base, t) || t.note?.trim()) return 'claude'
  if (Math.abs(base.duration - t.duration) > 0.01) return t.lengthMethod ?? 'claude'
  return 'scale'
}

/** carries the designer's edits over where they still make sense */
export function adaptOverrides(o: Overrides, base: Brief['output'], t: VariationTarget, method: VariationMethod): Overrides {
  const next = normalizeOverrides(structuredClone(o))
  const relayout = method === 'claude' && !sameAspect(base, t)
  if (relayout) {
    // positions and sizes were tuned for the old frame; typography choices still apply
    for (const e of Object.values(next.elements)) {
      delete e.transform
      if (e.style) delete e.style.fontSize
    }
  }
  if (method === 'claude' || Math.abs(base.duration - t.duration) > 0.01) next.timeRemap = []
  if (method === 'retime') {
    next.timeRemap = [{ from: 0, to: base.duration, speed: base.duration / t.duration }]
    next.keepTotalDuration = false
  }
  // music follows the new length
  const k = t.duration / base.duration
  next.bgm = next.bgm
    .map((b) => (method === 'retime' ? { ...b, start: b.start * k, end: Math.min(t.duration, b.end * k) } : { ...b, end: Math.min(t.duration, b.end) }))
    .filter((b) => b.end > b.start + 0.1)
  return next
}

/** copies the composition (and brief/overrides) of `src` at the requested point into `dst` */
async function copyBase(src: string, dst: string, base: VariationRequest['base']) {
  mkdirSync(dst, { recursive: true })
  cpSync(join(src, 'composition'), join(dst, 'composition'), {
    recursive: true,
    filter: (p) => !/[\\/](renders|snapshots|\.cache)([\\/]|$)/.test(p.slice(src.length)),
  })
  let brief = readJson<Brief>(join(src, 'brief.json'), null as never)
  let overrides = normalizeOverrides(readJson<Overrides | null>(join(src, 'overrides.json'), null))
  if (base.kind === 'history') {
    const files = (await git.listFiles({ fs, dir: src, gitdir: join(src, '.history'), ref: base.id })).filter(history.isTracked)
    for (const f of files) {
      const content = await history.readFileAt(src, base.id, f)
      if (content == null) continue
      if (f === 'brief.json') brief = JSON.parse(content) as Brief
      else if (f === 'overrides.json') overrides = normalizeOverrides(JSON.parse(content) as Overrides)
      else if (f.startsWith('composition/')) {
        mkdirSync(join(dst, f, '..'), { recursive: true })
        writeFileSync(join(dst, f), content)
      }
    }
  }
  return { brief, overrides }
}

function adaptationMessage(parent: ProjectState, baseBrief: Brief, t: VariationTarget, o: Overrides, basedOn: string): string {
  const b = baseBrief.output
  const edits = Object.entries(o.elements)
    .map(([id, e]) => {
      const parts = [e.text != null ? `문구 "${e.text}"` : '', e.style ? Object.entries(e.style).map(([k, v]) => `${k}:${v}`).join(', ') : '', e.hidden ? '숨김' : '']
      return parts.filter(Boolean).length ? `- ${id}: ${parts.filter(Boolean).join(' / ')}` : ''
    })
    .filter(Boolean)
  const ratioChanged = !sameAspect(b, t)
  return [
    `이 프로젝트는 "${parent.meta.name}"의 베리에이션이에요 (기준: ${basedOn}).`,
    `원본: ${b.width}×${b.height} (${ratioLabel(b.width, b.height)}), ${b.duration}초`,
    `새 사양: ${t.width}×${t.height} (${ratioLabel(t.width, t.height)}), ${t.duration}초 — 브리프의 출력 사양도 이미 바꿔 두었어요.`,
    '',
    '지금 composition/index.html은 원본 그대로예요. 이것을 새 사양에 맞게 고쳐 주세요.',
    '- 원본의 콘셉트, 톤, 컬러, 타이포, 모션 스타일, 필수 문구와 소재를 그대로 유지',
    ratioChanged
      ? '- 새 화면 비율에 맞게 레이아웃을 다시 구성 (세이프존 안에 핵심 내용, 글자 크기는 새 화면에서 읽기 좋게)'
      : '- 화면 비율은 같아요. 레이아웃은 최대한 유지',
    t.duration < b.duration
      ? `- ${t.duration}초에 맞게 핵심 장면 위주로 압축 (엔드카드·로고·필수 문구는 반드시 유지)`
      : t.duration > b.duration
        ? `- ${t.duration}초에 맞게 여유 있게 늘리기 (장면 호흡을 늘리거나 장면 추가)`
        : '- 길이는 같아요',
    '- 루트의 data-width / data-height / data-duration과 html·body·#root 크기를 새 사양으로 변경',
    '- data-ms-id는 원본과 같은 요소에 그대로 유지',
    ...(t.note?.trim() ? ['', `디자이너의 추가 요청 (이 베리에이션에만 적용): ${t.note.trim()}`] : []),
    '- 콘티 승인 없이 바로 만들고, hyperframes snapshot 시트와 look_at_frames로 장면마다 확인해 원본과 같은 브랜드·톤인지 보고 check_video로 검사하고 한국어로 짧게 보고',
    ...(edits.length ? ['', '원본에서 디자이너가 직접 정한 값 (그대로 적용되고 있어요. 레이아웃에 맞게 어울리도록 구성해 주세요):', ...edits] : []),
  ].join('\n')
}

export async function createVariations(projectId: string, req: VariationRequest): Promise<{ created: ProjectState[]; messages: { projectId: string; text: string }[] }> {
  const parent = projects.state(projectId)
  const rootId = parent.meta.family?.rootId ?? parent.meta.id
  const rootName = parent.meta.family ? parent.meta.name.split(' · ')[0] : parent.meta.name
  const basedOn = req.base.kind === 'current' ? '현재 상태' : req.base.label
  const created: ProjectState[] = []
  const messages: { projectId: string; text: string }[] = []

  for (const t of req.targets) {
    const label = `${ratioLabel(t.width, t.height)} · ${+t.duration.toFixed(2)}초${t.note?.trim() ? ` · ${t.note.trim().replace(/\s+/g, ' ').slice(0, 12)}` : ''}`
    // display name keeps "9:16"; the folder name can't contain ":" (Windows/macOS)
    const name = `${rootName} · ${label}`
    const folder = safeName(name.replace(/(\d+):(\d+)/g, '$1x$2'))
    // next to the original (in the same project folder); an original kept outside the projects folder gets them in the projects folder
    const home = isInside(parent.path, projectsDir()) ? dirname(parent.path) : projectsDir()
    const dir = uniquePath((n) => join(home, `${folder}${n ? ` (${n + 1})` : ''}.msproj`))
    const { brief: baseBrief, overrides: baseOverrides } = await copyBase(parent.path, dir, req.base)
    const method = methodFor(baseBrief.output, t)
    const preset = OUTPUT_PRESETS.find((p) => p.id === t.preset)
    const brief: Brief = {
      ...baseBrief,
      title: name,
      output: { ...baseBrief.output, preset: t.preset, width: t.width, height: t.height, duration: t.duration, safeZone: preset?.safeZone ?? baseBrief.output.safeZone },
    }
    const overrides = adaptOverrides(baseOverrides, baseBrief.output, t, method)
    const family: FamilyInfo = { rootId, parentId: parent.meta.id, label, basedOn, method, status: method === 'claude' ? 'queued' : 'done' }
    const meta: ProjectMeta = { id: newId(), name, createdAt: nowIso(), updatedAt: nowIso(), appVersion: app.getVersion(), family }
    writeJson(join(dir, 'project.json'), meta)
    writeJson(join(dir, 'brief.json'), brief)
    writeJson(join(dir, 'overrides.json'), overrides)
    writeJson(join(dir, 'chat.json'), [])
    for (const sub of ['feedback', 'renders', 'thumbnails', 'references']) mkdirSync(join(dir, sub), { recursive: true })
    if (existsSync(join(parent.path, 'thumbnails', 'latest.jpg')) && method !== 'claude') cpSync(join(parent.path, 'thumbnails', 'latest.jpg'), join(dir, 'thumbnails', 'latest.jpg'))
    await history.initHistory(dir)
    const state = projects.openProject(dir, { remember: false })
    await history.record(dir, { actor: 'app', summary: `베리에이션을 만들었어요 (${label}, 기준: ${basedOn})` })
    created.push(state)
    if (method === 'claude') messages.push({ projectId: meta.id, text: adaptationMessage(parent, baseBrief, t, baseOverrides, basedOn) })
  }
  return { created, messages }
}

export function setFamilyStatus(projectId: string, status: FamilyInfo['status']) {
  const s = projects.state(projectId)
  if (!s.meta.family) return
  projects.touch(projectId, { family: { ...s.meta.family, status } })
}

/** removes a half-created variation folder (used when creation fails midway) */
export function discard(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export { sameAspect, readFileSync }
