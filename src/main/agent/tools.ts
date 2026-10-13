// Studio tools for Claude, served over local HTTP MCP (one endpoint per project).
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Storyboard } from '@shared/api'
import { describeTiming, SECTION_LABELS } from '@shared/brief'
import { sfxLibrary, useBuiltinSfx } from '../audio'
import { listReferences, nearDuplicates, referenceFramesAt } from '../references'
import { fullCheck, lastElements } from '../checks'
import { listFonts } from '../fonts'
import * as history from '../history'
import { snapshot } from '../hyperframes'
import { bin } from '../paths'
import * as projects from '../projects'

const run = promisify(execFile)
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export interface ToolHooks {
  onStoryboard(projectId: string, sb: Storyboard): void
}

export function buildStudioServer(projectId: string, hooks: ToolHooks): McpServer {
  const server = new McpServer({ name: 'studio', version: '1.0.0' })
  const dir = () => projects.pathOf(projectId)
  const st = () => projects.state(projectId)

  server.registerTool(
    'get_brief',
    { description: 'Read the project brief: output spec, required texts, advertiser assets (with sizes), tone & manner, and whether a video already exists.' },
    async () => {
      const { brief, hasVideo } = st()
      return text(
        JSON.stringify(
          {
            hasVideo,
            title: brief.title,
            client: brief.client,
            campaign: brief.campaign,
            output: { ...brief.output, dataFpsAttribute: Math.round(brief.output.fps), fpsNote: 'Write data-fps as the integer dataFpsAttribute; the app renders at the exact rate (e.g. 29.97).' },
            tone: brief.tone,
            brand: brief.brand ? { ...brief.brand, note: 'Brand kit: use these colours and fonts as the base palette/typography.' } : undefined,
            requiredTexts: brief.texts.map((t) => ({ ...t, timingLabel: describeTiming(t.timing) })),
            assets: brief.assets.map((a) => ({
              file: a.file,
              originalName: a.originalName,
              kind: a.kind,
              required: a.required,
              timing: a.timing,
              timingLabel: describeTiming(a.timing),
              position: a.position,
              transform: a.transform,
              note: a.note,
              size: a.meta.width ? `${a.meta.width}x${a.meta.height}` : undefined,
              duration: a.meta.duration,
            })),
            sections: SECTION_LABELS,
          },
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'get_designer_edits',
    { description: "Read the designer's manual edits (they always win over your code) and the editable elements currently detected in the preview." },
    async () => {
      const { overrides } = st()
      return text(
        JSON.stringify(
          {
            note: 'Values below are applied on top of your composition and must not be fought or duplicated. Keep the same data-ms-id.',
            elements: overrides.elements,
            sectionSpeed: overrides.timeRemap,
            keepTotalDuration: overrides.keepTotalDuration,
            editableElementsInPreview: lastElements.get(projectId) ?? 'not reported yet',
          },
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'get_fonts',
    {
      description: 'List installed system fonts (Korean-capable first). Only these fonts may be used, with the exact family name.',
      inputSchema: { query: z.string().optional().describe('optional filter, e.g. "고딕" or "Pretendard"') },
    },
    async ({ query }) => {
      const q = query?.toLowerCase()
      const fonts = listFonts()
        .filter((f) => !q || f.family.toLowerCase().includes(q) || f.familyKo?.toLowerCase().includes(q))
        .slice(0, q ? 80 : 160)
        .map((f) => `${f.family}${f.familyKo ? ` (${f.familyKo})` : ''}${f.hangul ? ' [한글]' : ''} weights:${f.weights.join(',')}`)
      return text(fonts.join('\n') || '일치하는 폰트가 없어요.')
    },
  )

  server.registerTool(
    'propose_storyboard',
    {
      description: 'Show a storyboard (콘티) to the designer for approval. After calling this, END YOUR TURN and wait.',
      inputSchema: {
        title: z.string(),
        concept: z.string().describe('one or two sentences in Korean: the idea and mood'),
        duration: z.number(),
        scenes: z
          .array(
            z.object({
              from: z.number(),
              to: z.number(),
              title: z.string(),
              description: z.string().describe('what we see, in Korean'),
              texts: z.array(z.string()).describe('on-screen copy in this scene'),
              assets: z.array(z.string()).describe('asset files used, e.g. assets/logo.png'),
              motion: z.string().describe('motion / transition idea in Korean'),
            }),
          )
          .min(1),
        notes: z.string().optional(),
      },
    },
    async (sb) => {
      hooks.onStoryboard(projectId, { ...sb, scenes: sb.scenes.map((s, i) => ({ ...s, n: i + 1 })) })
      return text('콘티를 디자이너에게 보여줬어요. 이번 턴을 여기서 끝내고 승인이나 수정 요청을 기다리세요.')
    },
  )

  server.registerTool(
    'get_references',
    { description: 'List the reference videos/images the designer attached: title, note, ranges to focus on, and keyframes (project-relative jpg paths you can open with Read, with their seconds).' },
    async () => {
      const refs = listReferences(dir())
      if (!refs.length) return text('레퍼런스가 없어요.')
      return text(
        JSON.stringify(
          refs.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            status: r.status,
            note: r.note || undefined,
            focusRanges: r.ranges.length ? r.ranges : 'none — find 2-3 kick points yourself',
            duration: r.meta?.duration,
            size: r.meta?.width ? `${r.meta.width}x${r.meta.height}` : undefined,
            keyframes: r.frames?.map((f) => ({ t: f.t, file: f.file })),
          })),
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'look_at_reference',
    {
      description: 'See frames of a reference at the given seconds (max 8). Use it to study motion, rhythm and transitions around a moment.',
      inputSchema: { id: z.string(), times: z.array(z.number().min(0)).min(1).max(8) },
    },
    async ({ id, times }) => {
      const frames = await referenceFramesAt(dir(), id, times)
      if (!frames.length) return text('그 레퍼런스를 찾지 못했어요.')
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = []
      for (const f of frames) {
        content.push({ type: 'text', text: `${f.t}초` })
        content.push({ type: 'image', data: readFileSync(f.file).toString('base64'), mimeType: 'image/jpeg' })
      }
      return { content }
    },
  )

  server.registerTool(
    'list_sound_effects',
    { description: 'List the built-in sound effects (id, Korean name, when to use, length). Use use_sound_effect to put one in the project.' },
    async () => text(sfxLibrary().map((s) => `${s.id} — ${s.label} (${s.duration}s): ${s.use}`).join('\n')),
  )

  server.registerTool(
    'use_sound_effect',
    {
      description: 'Copy a built-in sound effect into composition/assets/sfx/ and get its path for <audio src>. Mark the element with data-ms-type="sfx" data-ms-sfx="<id>".',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const path = useBuiltinSfx(dir(), id)
      return text(path ? `src="${path}" (data-ms-sfx="${id}")` : `없는 효과음이에요: ${id}. list_sound_effects로 확인하세요.`)
    },
  )

  server.registerTool(
    'get_history',
    { description: 'List recent history entries (newest first): Claude turns, designer edits, saved versions, exports. Use it when the designer refers to an earlier version ("아까 두 번째 버전처럼").' },
    async () => {
      const list = await history.list(dir(), 40)
      return text(
        list
          .map((e, i) => `${i + 1}. id=${e.id.slice(0, 10)} · ${e.at.slice(0, 16).replace('T', ' ')} · ${e.actor}${e.versionName ? ` · [${e.versionName}]` : ''}${e.starred ? ' · ★' : ''} · ${e.summary}`)
          .join('\n') || '이력이 없어요.',
      )
    },
  )

  server.registerTool(
    'get_version',
    {
      description: 'Read a file as it was at an earlier history entry (default composition/index.html) so you can bring back parts of it. Read-only: write the result into composition/ yourself.',
      inputSchema: { id: z.string().describe('history id or its first 10 characters'), file: z.string().optional() },
    },
    async ({ id, file }) => {
      const entry = (await history.list(dir(), 300)).find((e) => e.id.startsWith(id))
      if (!entry) return text('해당 이력을 찾지 못했어요.')
      const content = await history.readFileAt(dir(), entry.id, file ?? 'composition/index.html')
      return text(content ?? '그 시점에는 이 파일이 없었어요.')
    },
  )

  server.registerTool(
    'check_video',
    { description: 'Run HyperFrames checks plus Motion Studio rules and brief compliance on composition/. Fix all errors.' },
    async () => {
      projects.refreshFontCss(dir())
      const { brief, overrides } = st()
      const findings = await fullCheck(dir(), brief, overrides, lastElements.get(projectId))
      // near-identical frames vs. references (inspiration is fine, copies are not)
      if (listReferences(dir()).some((r) => r.status === 'ready')) {
        const d = brief.output.duration
        const times = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((k) => +(d * k).toFixed(2))
        const frames = await snapshot(join(dir(), 'composition'), times, join(dir(), '.cache', 'similarity')).catch(() => [])
        const hits = await nearDuplicates(dir(), frames.map((file, i) => ({ t: times[i], file }))).catch(() => [])
        for (const h of hits) {
          findings.push({ severity: 'error', code: 'ms_reference_copy', message: `${h.t}초 화면이 레퍼런스 "${h.ref}"의 ${h.refT}초 장면과 거의 똑같아요. 참고는 좋지만 그대로 베끼면 안 돼요 — 레이아웃·그래픽·카피를 브랜드에 맞게 새로 구성해 주세요.`, time: h.t })
        }
      }
      if (!findings.length) return text('통과: 문제가 없어요.')
      const order = { error: 0, warning: 1, info: 2 }
      findings.sort((a, b) => order[a.severity] - order[b.severity])
      return text(findings.slice(0, 60).map((f) => `[${f.severity}] ${f.code}: ${f.message}`).join('\n'))
    },
  )

  server.registerTool(
    'look_at_frames',
    {
      description: 'Render frames of the current composition at the given seconds and look at them. Use 3-6 key moments.',
      inputSchema: { times: z.array(z.number().min(0)).min(1).max(8) },
    },
    async ({ times }) => {
      projects.refreshFontCss(dir())
      const outDir = join(dir(), '.cache', 'frames')
      const frames = await snapshot(join(dir(), 'composition'), times, outDir)
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = []
      for (let i = 0; i < frames.length; i++) {
        const jpg = frames[i].replace(/\.png$/, '.jpg')
        await run(bin.ffmpeg(), ['-v', 'error', '-y', '-i', frames[i], '-vf', 'scale=1280:-2', '-q:v', '3', jpg])
        content.push({ type: 'text', text: `${times[i] ?? '?'}초` })
        content.push({ type: 'image', data: readFileSync(jpg).toString('base64'), mimeType: 'image/jpeg' })
      }
      return { content }
    },
  )

  return server
}

export const STUDIO_TOOL_LABELS: Record<string, string> = {
  mcp__studio__get_brief: '브리프를 확인하고 있어요',
  mcp__studio__get_designer_edits: '직접 수정한 내용을 확인하고 있어요',
  mcp__studio__get_fonts: '사용할 수 있는 폰트를 살펴보고 있어요',
  mcp__studio__propose_storyboard: '콘티를 정리하고 있어요',
  mcp__studio__check_video: '결과를 점검하고 있어요',
  mcp__studio__get_history: '작업 이력을 살펴보고 있어요',
  mcp__studio__list_sound_effects: '효과음을 고르고 있어요',
  mcp__studio__get_references: '레퍼런스를 살펴보고 있어요',
  mcp__studio__look_at_reference: '레퍼런스 장면을 보고 있어요',
  mcp__studio__use_sound_effect: '효과음을 넣고 있어요',
  mcp__studio__get_version: '이전 버전을 살펴보고 있어요',
  mcp__studio__look_at_frames: '장면을 직접 확인하고 있어요',
  Write: '영상을 만들고 있어요',
  Edit: '영상을 다듬고 있어요',
  Read: '자료를 살펴보고 있어요',
  Glob: '자료를 살펴보고 있어요',
  Grep: '자료를 살펴보고 있어요',
  Skill: '제작 가이드를 참고하고 있어요',
}
