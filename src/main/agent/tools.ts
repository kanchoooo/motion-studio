// Studio tools for Claude, served over local HTTP MCP (one endpoint per project).
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import sharp from 'sharp'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Storyboard, StoryMaterial } from '@shared/api'
import { AI_PROVIDERS, type AiConnectProvider, type AudioCandidateList, type VoiceChoice } from '@shared/ai'
import { describeTiming, FPS_OPTIONS, OUTPUT_PRESETS } from '@shared/brief'
import { directionForClaude } from '@shared/direction'
import { activeAccount } from '../ai/accounts'
import { codexImage, codexStatus } from '../ai/codex'
import { callTool, connectedProviders, listTools } from '../ai/connect'
import { importUrl, saveResultMedia } from '../ai/media'
import { aiSettings } from '../ai/settings'
import { keptArgs, recordGenerated } from '../ai/generated'
import { sfxLibrary, useBuiltinSfx } from '../audio'
import { listReferences, MAX_RANGE_FRAMES, rangeSheets, referenceFramesAt, referenceSource } from '../references'
import { auditComposition } from '../audit'
import { isKeyProp, PROPS, unsetStatic } from '@shared/overrides'
import { mergeDesignerPatch } from '../designerEdits'
import { fullCheck, lastElements } from '../checks'
import { listFonts } from '../fonts'
import * as history from '../history'
import { snapshot } from '../hyperframes'
import { addRegistryItem, describeItem, registryItems, searchRegistry } from '../registry'
import { bin } from '../paths'
import * as projects from '../projects'
import { characterParts, checkCharacterFolder, embedCharacter, readCharacter, tagCharacter } from '../character/convert'
import { addWebFont, listWebFonts } from '../webfonts'
import { layoutSnapshot, measureLayout } from '../editReady'
import { generateVideoCandidate } from '../ai/generateVideo'
import { discardCandidate } from '../ai/generate'
import { assignmentLines, readStoryboard, shootCells, writeStoryboard } from '../storyboard'

const run = promisify(execFile)
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export interface ToolHooks {
  onStoryboard(projectId: string, sb: Storyboard): void
  /** voices for a narration: the designer listens and picks one */
  onVoices(projectId: string, card: { label?: string; script?: string; voices: VoiceChoice[] }): void
  /** Claude starts building what the designer approved in the conversation: the editor opens */
  onBuildStart(projectId: string): void
  onAudioCandidates(projectId: string, list: AudioCandidateList): void
  /** images / video clips Claude generated: shown to the designer to keep or discard */
  onGenerated(projectId: string, files: { file: string; kind: string }[], label?: string): void
  /** a line in the chat from the app (e.g. the output spec Claude changed with the designer) */
  onNotice?(projectId: string, text: string): void
}

const PROVIDER = z.enum(['higgsfield', 'magnific'])
/** compact JSON schema for Claude (drops noise, keeps names, types, enums, descriptions) */
function compactSchema(s: unknown, depth = 0): unknown {
  if (!s || typeof s !== 'object' || depth > 6) return s
  if (Array.isArray(s)) return s.map((x) => compactSchema(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (['$schema', 'additionalProperties', 'title', 'examples', '$id'].includes(k)) continue
    out[k] = k === 'description' && typeof v === 'string' ? v.slice(0, 300) : compactSchema(v, depth + 1)
  }
  return out
}

/** seconds between cuts (the edit rhythm) */
function shotLengths(cuts: number[], duration: number): number[] {
  const marks = [0, ...cuts.filter((t) => t > 0.05 && t < duration - 0.05), duration]
  return marks.slice(1).map((t, i) => +(t - marks[i]).toFixed(2))
}

/** stretches where the picture changes a lot between frames `step` seconds apart (motion), strongest first */
function movesOf(motion: number[], step = 0.1, from = 0): { from: number; to: number; peak: number }[] {
  const t = (k: number) => +(from + k * step).toFixed(2)
  const sorted = [...motion].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const on = Math.max(1.5, median * 2)
  const out: { from: number; to: number; peak: number }[] = []
  let start = -1
  let peak = 0
  motion.forEach((v, i) => {
    if (v >= on) {
      if (start < 0) start = i
      peak = Math.max(peak, v)
    } else if (start >= 0) {
      out.push({ from: t(start), to: t(i + 1), peak })
      start = -1
      peak = 0
    }
  })
  if (start >= 0) out.push({ from: t(start), to: t(motion.length + 1), peak })
  return out.sort((a, b) => b.peak - a.peak).slice(0, 24).sort((a, b) => a.from - b.from)
}

export function buildStudioServer(projectId: string, hooks: ToolHooks): McpServer {
  const server = new McpServer({ name: 'studio', version: '1.0.0' })
  const dir = () => projects.pathOf(projectId)
  const st = () => projects.state(projectId)

  server.registerTool(
    'get_brief',
    { description: "The video's output spec (size, length, fps — set by the designer in the app), the designer's material library (소재함: files you may use), whether a video exists, and notes from an older brief if the project has one. Everything else is planned in conversation." },
    async () => {
      const { brief, hasVideo } = st()
      const o = brief.output
      const older = [
        brief.tone.trim() ? `톤앤매너: ${brief.tone.trim()}` : '',
        ...brief.texts.map((t) => `문구${t.locked ? '(글자 그대로)' : ''}: "${t.text}"${t.timing.mode !== 'any' ? ` · ${describeTiming(t.timing)}` : ''}${t.note ? ` · ${t.note}` : ''}`),
        ...(directionForClaude(brief.tempo, brief.styles) ? [`템포·스타일: ${[directionForClaude(brief.tempo, brief.styles)!.tempo, ...(directionForClaude(brief.tempo, brief.styles)!.styles ?? [])].filter(Boolean).join(' / ')}`] : []),
        ...brief.storyboard.map((s, i) => `디자이너 장면 ${i + 1}: ${[s.title, s.description, ...s.texts.map((t) => `"${t.text}"`)].filter(Boolean).join(' · ')}`),
        brief.brand ? `브랜드: ${brief.brand.name} · 색 ${brief.brand.colors.map((c) => `${c.name} ${c.hex}`).join(', ') || '-'} · 글꼴 ${[brief.brand.fonts.headline, brief.brand.fonts.body].filter(Boolean).join(' / ') || '-'}` : '',
        brief.ai.narration.enabled ? `내레이션: ${brief.ai.narration.voiceName ?? '목소리 미정'}${brief.ai.narration.script ? ` · 대본 "${brief.ai.narration.script}"` : ''}` : '',
        o.background === 'color' ? `배경색: ${o.backgroundColor}` : o.background === 'transparent' ? '배경: 투명(투명 형식으로 내보냄)' : '',
      ].filter(Boolean)
      return text(
        JSON.stringify(
          {
            hasVideo,
            output: { width: o.width, height: o.height, duration: o.duration, fps: o.fps, dataFpsAttribute: Math.round(o.fps), fpsNote: 'Write data-fps as the integer dataFpsAttribute; the app renders at the exact rate (e.g. 29.97).', safeZone: o.safeZone !== 'none' ? o.safeZone : undefined },
            library: brief.assets.map((a) => ({
              file: a.file,
              name: a.originalName,
              kind: a.kind,
              size: a.meta.width ? `${a.meta.width}x${a.meta.height}` : undefined,
              duration: a.meta.duration,
              note: a.note || undefined,
              generated: a.generated ? { prompt: a.generated.prompt, style: a.generated.style } : undefined,
              character: a.character
                ? { folder: a.character.dir.replace(/^composition\//, ''), svg: a.character.status === 'done', shapes: a.character.shapes, tagged: !!a.character.tagged, note: 'An SVG character that can act part by part: skill svg-character-motion, tools character_*.' }
                : undefined,
            })),
            olderBrief: older.length ? { note: 'Written in an older version of the app, before planning moved into the conversation: background for you, not rules.', lines: older } : undefined,
          },
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'set_output',
    {
      description:
        "Change the app's output spec (출력 사양: length, fps, size) to a value agreed with the designer in this conversation. When what they say about the video (\"15초짜리\", \"세로 영상\", …) differs from get_brief's output, ask which one they want first — sound, music cuts and narration are timed to this length — and call this only after they answered. Then make the composition match it (root data-duration / data-width / data-height / data-fps).",
      inputSchema: {
        duration: z.number().min(1).max(180).optional().describe('seconds'),
        fps: z.number().optional().describe('one of 23.976, 24, 25, 29.97, 30, 59.94, 60'),
        width: z.number().int().min(64).max(7680).optional(),
        height: z.number().int().min(64).max(7680).optional(),
        agreed: z.string().describe("the designer's answer that settled it, quoted (e.g. \"15초로 할게요\")"),
      },
    },
    async ({ duration, fps, width, height, agreed }) => {
      const before = st().brief.output
      const patch: Record<string, unknown> = {}
      if (duration != null) patch.duration = Math.round(duration * 10) / 10
      if (fps != null) {
        const f = FPS_OPTIONS.find((x) => Math.abs(x.value - fps) < 0.01)
        if (!f) return text(`fps ${fps} is not offered: use one of ${FPS_OPTIONS.map((x) => x.value).join(', ')}.`)
        patch.fps = f.value
      }
      if ((width == null) !== (height == null)) return text('Give width and height together.')
      if (width != null && height != null) {
        if (width % 2 || height % 2) return text('Width and height must be even numbers (video encoders need it).')
        patch.width = width
        patch.height = height
        patch.preset = OUTPUT_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom'
      }
      if (!Object.keys(patch).length) return text('Nothing to change: give duration, fps or width + height.')
      projects.saveOutput(projectId, patch)
      const o = st().brief.output
      const changes = [
        o.duration !== before.duration ? `길이 ${before.duration}초 → ${o.duration}초` : '',
        o.fps !== before.fps ? `fps ${before.fps} → ${o.fps}` : '',
        o.width !== before.width || o.height !== before.height ? `크기 ${before.width}×${before.height} → ${o.width}×${o.height}` : '',
      ].filter(Boolean)
      if (changes.length) hooks.onNotice?.(projectId, `대화에서 정한 대로 출력 사양을 바꿨어요: ${changes.join(' · ')}`)
      return text(
        `${changes.length ? `Output spec changed (${changes.join(', ')}); agreed: ${agreed}.` : 'The output spec already had these values.'} Now: ${o.width}x${o.height}, ${o.duration}s, ${o.fps}fps (data-fps ${Math.round(o.fps)}).` +
          (st().hasVideo ? ' The composition exists: update the root data-duration / data-width / data-height / data-fps to match and re-time what depends on the length (music cut, narration, end card) — unless the root has data-ms-authored-duration (the designer re-timed sections), then ask the designer first.' : ''),
      )
    },
  )

  server.registerTool(
    'get_designer_edits',
    {
      description:
        "Read what the designer did by hand, After Effects style, on top of your composition: locked layers (never change them), edits to your layers (fixed values and keyframes of any property, effects, masks, in-out, text, font, wiggle, counters…), properties of your motion they took over (own), character parts they posed (\"<layer>::<part>\"), the camera (\"__camera\"), layers they added (the ms:layers block), copies, deleted layers, stacking order, groups set free, section speed — and the editable elements detected in the preview.",
    },
    async () => {
      const { overrides } = st()
      const keyed = (e: (typeof overrides.elements)[string]) => Object.entries(e.keys ?? {}).filter(([, k]) => k?.length).map(([p, k]) => `${p}: ${k!.length} keys`)
      const owned = (e: (typeof overrides.elements)[string]) => Object.entries(e.own ?? {}).filter(([, k]) => k?.length).map(([p, k]) => `${p}: ${k!.length} keys`)
      return text(
        JSON.stringify(
          {
            rules: [
              'LOCKED layers (locked list) are final: never change, move, retime, restyle, remove or re-create them, in code or CSS, and do not touch what is inside them (their parts and children too). If the designer asks for a change to a locked layer, say it is locked and ask them to unlock it in the timeline.',
              "The designer's edits sit on top of your code (the app wraps each data-ms-id element). Keep each data-ms-id so they keep applying.",
              "Never throw the designer's work away to make your change. When what you must change is a value the designer set (it is in edits: a fixed value, keyframes, an own property, a wiggle, a counter, a mask…), change THAT value with update_designer_edits; change your code for everything else. clear_designer_edits is only for when the designer asks you to redo a layer from scratch or to hand it (or some of its properties) back to your code.",
              "own: properties of YOUR motion the designer took over (GSAP property names on the element itself). They play from the designer's absolute keyframes; your tweens of those properties are ignored. Adjust them with update_designer_edits (own), or hand them back (clear_designer_edits with props) only when asked.",
              "Character parts are layers \"<character layer>::<part id>\" (x, y in drawing units, rotate about the part's data-pivot, scale): added on top of your acting. A character's acting parameters (--lid, --look-x…) can be owned too.",
              'The camera ("__camera") moves, zooms (scaleX/scaleY), turns and shakes (wiggle) the whole picture.',
              'Layers the designer added live in the <!-- ms:layers --> block of index.html, which the app rewrites: never edit that block. Change them with update_designer_edits (layer: text, box, src…; patch: style, keys, effects…).',
              'freeze: groups the designer set free — their children are placed absolutely by the app at the listed boxes; do not rely on flex/grid flow for them.',
              'Copies of your layers (duplicates) are made by the app at run time with the original\'s motion; deleted layers are hidden by the app.',
              'Keyframes: { t: output seconds, v: number or colour, e: ease of the segment that starts here ("linear", "hold", a GSAP ease name, "cubic-bezier(…)") }. Designer properties: see propertyCatalog (x/y are px offsets from where your code places the layer).',
            ],
            propertyCatalog: PROPS.map((p) => ({ id: p.id, label: p.label, unit: p.shownUnit ?? p.unit, default: p.def })),
            locked: Object.entries(overrides.elements).filter(([, e]) => e.locked).map(([id, e]) => ({ id, label: e.label })),
            edits: Object.fromEntries(
              Object.entries(overrides.elements).map(([id, e]) => [
                id,
                { ...e, keys: undefined, own: undefined, keyframes: keyed(e).length ? keyed(e) : undefined, ownedFromYourCode: owned(e).length ? owned(e) : undefined },
              ]),
            ),
            designerLayers: overrides.layers.map((l) => ({ id: l.id, kind: l.kind, label: l.label, box: [l.x, l.y, l.w, l.h], text: l.text, src: l.src })),
            duplicates: overrides.duplicates,
            deleted: Object.entries(overrides.elements).filter(([, e]) => e.deleted).map(([id]) => id),
            stackingOrder: overrides.order,
            freeze: overrides.freeze ?? {},
            sectionSpeed: overrides.timeRemap,
            keepTotalDuration: overrides.keepTotalDuration,
            markers: overrides.markers,
            editableElementsInPreview: lastElements.get(projectId) ?? 'not reported yet',
          },
          null,
          1,
        ).slice(0, 60_000),
      )
    },
  )

  server.registerTool(
    'update_designer_edits',
    {
      description:
        "Change the designer's own edits of one layer instead of throwing them away: fixed values (transform, style, effects, mask…), keyframes (keys: designer properties; own: properties of your motion they took over), loops, wiggle, a number counter, in/out, text… The patch is merged (a property's keyframe list is replaced as a whole; null removes a field). For a layer the designer added, `layer` changes its text, box or file. Locked layers are refused. Use it to adjust what the designer set, or to animate a layer the designer added.",
      inputSchema: {
        id: z.string().describe('data-ms-id, "<layer>::<part>" for a character part, or "__camera"'),
        patch: z.record(z.string(), z.unknown()).default({}).describe('ElementOverride fields: transform, style, effects, mask, keys, own, loops, wiggle, counter, trim, textAnim, inPoint, outPoint, hidden, label, text, src'),
        layer: z.record(z.string(), z.unknown()).optional().describe('for a layer the designer added: text, x, y, w, h, src, fit, shape, mediaStart, muted'),
        reason: z.string().describe('one short Korean line for the history, e.g. "디자이너가 넣은 문구에 등장 모션 추가"'),
      },
    },
    async ({ id, patch, layer, reason }) => {
      const cur = st().overrides
      if (cur.elements[id]?.locked) return text(`Refused: "${id}" is locked by the designer. Ask them to unlock it in the timeline.`)
      const next = structuredClone(cur)
      const { merged, problems } = mergeDesignerPatch(next.elements[id] ?? {}, patch)
      next.elements[id] = merged
      if (layer) {
        const at = next.layers.findIndex((l) => l.id === id)
        if (at < 0) problems.push(`"${id}" is not a layer the designer added: layer fields ignored`)
        else {
          const allowed = ['text', 'x', 'y', 'w', 'h', 'src', 'fit', 'shape', 'mediaStart', 'muted', 'label']
          next.layers[at] = { ...next.layers[at], ...Object.fromEntries(Object.entries(layer).filter(([k]) => allowed.includes(k))) }
        }
      }
      await projects.saveOverrides(projectId, next, `Claude가 직접 수정 값을 고쳤어요: ${reason}`, 'claude')
      return text([`Updated the designer's edits of ${id}.`, ...problems].join('\n'))
    },
  )

  server.registerTool(
    'clear_designer_edits',
    {
      description:
        "Hand a layer (or some of its properties) back to your code: removes the designer's manual edits on these layers (and removes layers / copies the designer added), or with `props` only those properties (designer properties like x, color, blur, or properties of your motion they took over like y, rotation, --mouth-open). Use it only when the designer asks for it. Locked layers are refused.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(100),
        props: z.array(z.string()).optional().describe('only these properties (otherwise every edit of the layer)'),
        reason: z.string().describe('one short Korean line for the history, e.g. "로고 위치를 다시 잡으려고"'),
      },
    },
    async ({ ids, props, reason }) => {
      const cur = st().overrides
      const refused = ids.filter((id) => cur.elements[id]?.locked)
      const take = new Set(ids.filter((id) => !refused.includes(id)))
      const next = structuredClone(cur)
      if (props?.length) {
        for (const id of take) {
          const e = next.elements[id]
          if (!e) continue
          const out = unsetStatic(e, props.filter(isKeyProp))
          for (const p of props) {
            if (out.own) delete out.own[p]
            if (out.loops) delete out.loops[`own:${p}` as keyof NonNullable<typeof out.loops>]
            if (out.wiggle) delete (out.wiggle as Record<string, unknown>)[p]
          }
          next.elements[id] = out
        }
      } else {
        for (const id of take) delete next.elements[id]
        next.layers = next.layers.filter((l) => !take.has(l.id))
        next.duplicates = next.duplicates.filter((d) => !take.has(d.id))
        for (const k of Object.keys(next.order)) next.order[k] = next.order[k].filter((id) => !take.has(id) || !cur.layers.some((l) => l.id === id))
        for (const key of Object.keys(next.motions)) if (take.has(key.slice(0, key.lastIndexOf('#')))) delete next.motions[key]
      }
      if (take.size) await projects.saveOverrides(projectId, next, `Claude가 직접 수정을 넘겨받았어요: ${reason}`, 'claude')
      return text(
        [
          take.size ? (props?.length ? `Cleared ${props.join(', ')} on ${[...take].join(', ')}. Your code decides these properties again.` : `Cleared: ${[...take].join(', ')}. Your code decides these layers again.`) : '',
          refused.length ? `Refused (locked by the designer): ${refused.join(', ')}. Ask them to unlock in the timeline if this is really what they want.` : '',
        ]
          .filter(Boolean)
          .join('\n'),
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

  const MATERIAL = z.object({
    id: z.string().optional().describe('stable id within the storyboard, e.g. "s2-product"'),
    kind: z.enum(['image', 'video']),
    label: z.string().describe('what it is, in Korean'),
    prompt: z.string().optional().describe('image: the image prompt · video: the motion prompt'),
    start_prompt: z.string().optional().describe('video clips that matter: prompt for the first frame image'),
    end_prompt: z.string().optional().describe('video clips that matter: prompt for the last frame image'),
    file: z.string().optional().describe('a file already in the library (assets/…) when one fits'),
  })
  server.registerTool(
    'show_storyboard',
    {
      description:
        'Show a storyboard (콘티) to the designer as a card in the chat and in the app\'s storyboard panel. Sketch composition/storyboard.html first — one cell per scene with id="frame-NN" (frame-01 …) at the video\'s aspect ratio, real fonts, colours and copy, image/video spots as plain labelled boxes — the app photographs each cell. List per scene the materials it needs (images, video clips with their prompts); the designer can assign files, generate them in the 소재 panel, or leave them to you, then approves with 제작 승인. Showing it again replaces the card (assignments with the same id or label are kept).',
      inputSchema: {
        title: z.string(),
        concept: z.string().describe('one or two sentences in Korean: the idea and mood'),
        duration: z.number(),
        html: z.string().default('storyboard.html').describe('the sketch file inside composition/'),
        scenes: z
          .array(
            z.object({
              from: z.number(),
              to: z.number(),
              title: z.string(),
              description: z.string().describe('what we see, in Korean'),
              texts: z.array(z.string()).default([]).describe('on-screen copy in this scene'),
              motion: z.string().default('').describe('motion / transition idea in Korean'),
              materials: z.array(MATERIAL).default([]),
            }),
          )
          .min(1),
        notes: z.string().optional(),
      },
    },
    async (sb) => {
      const shots = await shootCells(dir(), sb.html)
      const storyboard: Storyboard = {
        title: sb.title,
        concept: sb.concept,
        duration: sb.duration,
        notes: sb.notes,
        scenes: sb.scenes.map((s, i) => ({
          n: i + 1,
          from: s.from,
          to: s.to,
          title: s.title,
          description: s.description,
          texts: s.texts,
          motion: s.motion,
          assets: s.materials.flatMap((m) => (m.file ? [m.file] : [])),
          frame: shots[i + 1],
          materials: s.materials.map((m): StoryMaterial => ({ id: m.id ?? '', kind: m.kind, label: m.label, prompt: m.prompt, startPrompt: m.start_prompt, endPrompt: m.end_prompt, file: m.file })),
        })),
      }
      hooks.onStoryboard(projectId, storyboard)
      const pictured = Object.keys(shots).length
      return text(
        `콘티를 디자이너에게 보여줬어요 (장면 ${storyboard.scenes.length}개, 시안 그림 ${pictured}장${pictured ? '' : ' — storyboard.html에 id="frame-NN" 칸이 없거나 열리지 않아 글로만 보여요'}). 디자이너가 소재 칸을 채우거나 의견을 줘요. 대화로 제작을 승인하면(제작해줘·진행해 등) start_build를 부르고 만드세요. 이번 턴은 여기서 마무리하세요.`,
      )
    },
  )

  server.registerTool(
    'start_build',
    {
      description:
        'Call this when the designer agrees to build in the conversation ("제작해줘", "승인", "진행해", "이대로 만들어 줘", "좋아요 시작해요" …), right before you start writing the video. Returns the storyboard\'s materials with the files the designer assigned (empty ones are yours to make or generate), marks the storyboard approved and opens the editor, where the designer watches you build. Not needed for later changes to a finished video.',
    },
    async () => {
      const cur = readStoryboard(dir())
      if (cur) writeStoryboard(dir(), { ...cur, status: 'approved', changed: undefined })
      hooks.onBuildStart(projectId)
      if (!cur) return text('콘티 없이 대화에서 정한 기획대로 만드세요. 디자이너에게 편집 화면이 열렸어요.')
      return text(
        [`승인한 콘티: ${cur.storyboard.title} — ${cur.storyboard.concept}`, '', '장면별 소재:', ...(assignmentLines(cur.storyboard).length ? assignmentLines(cur.storyboard) : ['- (소재 칸 없음)']), '', '이 콘티대로 만드세요. 비어 있는 소재는 직접 만들거나 생성해서 채워요. 디자이너에게 편집 화면이 열렸어요.'].join('\n'),
      )
    },
  )

  server.registerTool(
    'get_storyboard',
    { description: 'The storyboard the designer is working with: scenes, the materials each scene needs, the files the designer assigned to them, and whether it was approved.' },
    async () => {
      const cur = readStoryboard(dir())
      if (!cur) return text('아직 콘티가 없어요.')
      return text(JSON.stringify({ status: cur.status, title: cur.storyboard.title, concept: cur.storyboard.concept, duration: cur.storyboard.duration, scenes: cur.storyboard.scenes.map((s) => ({ n: s.n, from: s.from, to: s.to, title: s.title, description: s.description, texts: s.texts, motion: s.motion, materials: s.materials })) }, null, 1))
    },
  )

  server.registerTool(
    'get_references',
    { description: "The images, videos and YouTube links the designer attached in the chat (references/<id>): kind, title, size, the part they chose, keyframes at scene cuts, an overview of each video (frames every sheetStep seconds, 20 per sheet with seconds under each frame — project-relative jpgs to open with Read), cuts, shot lengths and where the picture moves most. Study a part closely with look_at_reference." },
    async () => {
      const refs = listReferences(dir())
      if (!refs.length) return text('첨부가 없어요.')
      return text(
        JSON.stringify(
          refs.map((r) => {
            const step = r.sheetStep ?? 0.1
            return {
              id: r.id,
              kind: r.kind,
              title: r.title,
              status: r.status,
              file: r.kind === 'image' ? r.file : undefined,
              note: r.note || undefined,
              ranges: r.ranges.length ? r.ranges : undefined,
              duration: r.meta?.duration,
              size: r.meta?.width ? `${r.meta.width}x${r.meta.height}` : undefined,
              keyframes: r.kind === 'image' ? undefined : r.frames?.map((f) => ({ t: f.t, file: f.file })),
              overview: r.sheets?.length ? { every: `${step}s`, perSheet: '20 frames, 5×4, read left→right, top→bottom', sheets: r.sheets } : undefined,
              cuts: r.cuts?.length ? r.cuts : undefined,
              shotLengths: r.cuts?.length ? shotLengths(r.cuts, r.meta?.duration ?? 0) : undefined,
              moves: r.motion?.length ? movesOf(r.motion, step) : undefined,
              useInVideo: r.kind === 'youtube' ? 'reference only (YouTube)' : 'use_as_material copies it into the library when the designer wants it in the video',
            }
          }),
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'look_at_reference',
    {
      description: `Look closely at a reference video. With from/to: frames from \`from\` to \`to\` seconds, one every \`every\` seconds (default 0.1 — read a motion: how far things travel per frame, easing, staggers, holds), as sheets of 20 with the second under each frame (at most ${MAX_RANGE_FRAMES} frames per call). With times: single large frames at those seconds (max 8).`,
      inputSchema: {
        id: z.string(),
        from: z.number().min(0).optional(),
        to: z.number().min(0).optional(),
        every: z.number().min(0.04).max(5).optional(),
        times: z.array(z.number().min(0)).min(1).max(8).optional(),
      },
    },
    async ({ id, from, to, every, times }) => {
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = []
      if (from != null && to != null) {
        const r = await rangeSheets(dir(), id, from, to, every ?? 0.1)
        content.push({ type: 'text', text: `${r.from}~${r.to}초, ${r.step}초 간격 ${r.sheets.length}장${r.clipped ? ` (한 번에 ${MAX_RANGE_FRAMES}프레임까지라 ${r.to}초에서 끊었어요 — 나머지는 다시 부르세요)` : ''}. 움직임이 큰 곳: ${JSON.stringify(movesOf(r.motion, r.step, r.from).slice(0, 8))}` })
        for (const sh of r.sheets.slice(0, 4)) {
          content.push({ type: 'text', text: `${sh.from}~${sh.to}초 (${sh.file})` })
          content.push({ type: 'image', data: readFileSync(join(dir(), sh.file)).toString('base64'), mimeType: 'image/jpeg' })
        }
        if (r.sheets.length > 4) content.push({ type: 'text', text: `나머지 시트는 Read로 열어 보세요: ${r.sheets.slice(4).map((x) => x.file).join(', ')}` })
        return { content }
      }
      const frames = await referenceFramesAt(dir(), id, times ?? [from ?? 0])
      if (!frames.length) return text('그 레퍼런스를 찾지 못했어요.')
      for (const f of frames) {
        content.push({ type: 'text', text: `${f.t}초` })
        content.push({ type: 'image', data: readFileSync(f.file).toString('base64'), mimeType: 'image/jpeg' })
      }
      return { content }
    },
  )

  server.registerTool(
    'use_as_material',
    {
      description: "Copy an attachment (an image or video the designer attached in the chat) into the material library (composition/assets) to use it in the video. Returns its composition path. YouTube videos are reference-only.",
      inputSchema: { id: z.string(), name: z.string().optional().describe('a short Korean name for the library') },
    },
    async ({ id, name }) => {
      const { path, item } = referenceSource(dir(), id)
      const { added } = await projects.addToLibrary(projectId, [path])
      if (!added.length) return text('이 파일은 소재로 넣을 수 없는 형식이에요.')
      const a = { ...added[0], originalName: name || item.title || added[0].originalName }
      projects.replaceAsset(projectId, added[0].id, a)
      return text(`소재함에 넣었어요: ${a.file} (${a.meta.width ? `${a.meta.width}x${a.meta.height}` : ''}${a.meta.duration ? ` ${a.meta.duration.toFixed(1)}s` : ''}). 영상에서는 이 경로를 쓰세요.`)
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
    { description: 'Run HyperFrames checks plus the app\'s checks (size and length, fonts, ids, the designer\'s locked layers) on composition/. Errors break the video or the designer\'s work; info lines are notes.' },
    async () => {
      projects.refreshFontCss(dir())
      const { brief, overrides, hasVideo } = st()
      // a fresh hidden render knows the current element tree even when the editor has not reloaded yet
      const audit = hasVideo ? await auditComposition(dir(), brief.output) : null
      const elements = audit ? audit.elements : lastElements.get(projectId)
      const findings = await fullCheck(dir(), brief, overrides, elements, true, audit ?? undefined)
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

  // ---- the HyperFrames registry shipped with the app (blocks + components, with pictures) ----

  server.registerTool(
    'find_blocks',
    {
      description:
        'Search the HyperFrames registry that ships inside the app (~450 ready-made blocks and components: transitions, text effects, overlays, light leaks, charts, device mockups, shader backgrounds …) for a look, in plain English ("light leak warm glow", "kinetic typography slam", "logo outro"). Returns one line per match (name, kind, size, length, what it does) and a picture of each match that has a preview — three moments of its motion side by side, left to right. Use it before hand-building any named look, then add_block the one that fits.',
      inputSchema: {
        query: z.string().min(2).describe('the look in plain English words'),
        kind: z.enum(['block', 'component']).optional().describe('block = its own scene/sub-composition with size and length; component = an effect snippet merged into your HTML'),
        limit: z.number().int().min(1).max(10).optional().describe('default 6'),
      },
    },
    async ({ query, kind, limit }) => {
      if (!registryItems().length) return text('The registry copy is missing in this app. Use `hyperframes catalog --query "…" --json` instead.')
      const found = searchRegistry(query, { kind, limit: limit ?? 6 })
      if (!found.length) return text(`Nothing in the registry matches "${query}". Try other words (what it looks like, not the product), or build it from the hyperframes-animation rules.`)
      const { brief } = st()
      const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
        { type: 'text', text: `${found.length} match(es) for "${query}" (this video: ${brief.output.width}x${brief.output.height}; a block of another size must be scaled or adapted):\n${found.map(describeItem).join('\n')}` },
      ]
      for (const item of found) {
        if (!item.preview) continue
        content.push({ type: 'text', text: `${item.name} — preview` })
        content.push({ type: 'image', data: readFileSync(item.preview).toString('base64'), mimeType: 'image/jpeg' })
      }
      return { content }
    },
  )

  server.registerTool(
    'add_block',
    {
      description:
        'Install a registry block or component (a name from find_blocks) into composition/: from the copy inside the app, at once, without the network or the clipboard. Returns the files written. Then wire it: a block is a sub-composition — include it with data-composition-src (Read the file for its data-composition-id, size and length); a component is a snippet — Read it and merge its HTML, CSS and JS into your composition (see the hyperframes-registry skill).',
      inputSchema: { name: z.string().min(2) },
    },
    async ({ name }) => {
      const item = registryItems().find((i) => i.name === name)
      if (registryItems().length && !item) return text(`No registry item is called "${name}". Use find_blocks to get the exact name.`)
      if (item?.kind === 'example') return text(`"${name}" is an example project, not something to add. Pick a block or component.`)
      const r = await addRegistryItem(join(dir(), 'composition'), name)
      if (!r.ok) return text(`Install failed: ${r.error ?? 'unknown error'}`)
      const size = item?.width && item.height ? ` (${item.width}x${item.height}${item.duration ? `, ${item.duration}s` : ''})` : ''
      return text(
        [
          `Installed ${name}${item ? ` — a ${item.kind}${size}` : ''}. Files:`,
          ...r.written.map((f) => `  ${f}`),
          r.snippet ? `Snippet: ${r.snippet}` : '',
          ...r.warnings.map((w) => `Warning: ${w}`),
          item?.kind === 'block' ? 'Wire it with data-composition-src; Read the file first for its data-composition-id.' : 'Read the file and merge its HTML / CSS / JS into your composition.',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    },
  )

  // ---- AI generation (Higgsfield / Magnific through the app) and sound search (Artlist) ----

  server.registerTool(
    'ai_status',
    { description: "What AI generation is available right now: connected services (Higgsfield, Magnific: images, video clips, text-to-speech) with the active account, the designer's Codex CLI (GPT Image, images only), the brief defaults (models, narration), and whether Artlist (music / sound effects) is on. Call this before generating anything." },
    async () => {
      const { brief } = st()
      const connected = connectedProviders()
      const cx = await codexStatus().catch(() => null)
      return text(
        JSON.stringify(
          {
            services: (['higgsfield', 'magnific'] as const).map((p) => ({
              id: p,
              name: AI_PROVIDERS[p].name,
              connected: connected.includes(p),
              account: activeAccount(p)?.label,
            })),
            codex: cx?.installed
              ? cx.usable
                ? { usable: true, use: 'codex_image (images only; GPT Image on the designer\'s own ChatGPT quota)', limits: cx.limits }
                : { usable: false, why: cx.reason }
              : 'not installed',
            artlist: aiSettings().artlist
              ? 'enabled: use the mcp__artlist__* tools directly (search music, sound effects, voice-over). If they are missing, Artlist is not signed in yet — tell the designer to sign in from the Claude terminal (/mcp).'
              : 'off (the designer can turn it on in AI 연결)',
            briefDefaults: brief.ai,
            cheatsheet: {
              magnific: {
                imageModels: 'images_models_list {search?} → slug; generate: images_generate {prompt, mode: <slug>, aspectRatio, count}',
                videoModels: 'video_models_list {search?} → slug (plan-blocked slugs are listed under unavailableToThisAccount: tell the designer); generate: video_generate {prompt, slug, duration, aspectRatio}',
                voices: 'audio_voices_list {search?} → integer id; speech: audio_tts {text, voiceId: <int>, source: "catalog"|"mine"} (call audio_tts_direction first for tags/pauses)',
                results: 'generation tools return creation identifiers: creations_wait {identifiers} until done, then creations_get {identifiers} — that call\'s file URLs are saved into the project',
              },
              higgsfield: {
                models: 'models_explore {action:"list"|"search"|"recommend", type:"image"|"video"|"audio", query?} → id',
                generate: 'generate_image / generate_video {params:{model, prompt, aspect_ratio, …}}; speech: generate_audio {params:{model:"seed_audio", prompt:<script>, voice_type, voice_id}}',
                voices: 'list_voices {size, cursor} → voice_id + voice_type',
                results: 'jobs_wait {jobs:[…]} (or job_status) until done; the result URLs are saved into the project',
              },
            },
            how: [
              'Use ai_tools(provider, filter) for exact parameters, then ai_call. Generated files are saved into the project automatically and their composition paths are returned.',
              'Plan or daily-limit errors: stop and tell the designer in Korean (which service, what to do) instead of retrying.',
              'What the designer asked in the chat wins over the brief defaults. If neither names a model, choose a suitable one and say which.',
              'Generation costs the designer\'s credits: generate only what you will use, one or two candidates at most unless asked.',
              'Text-to-speech: write the script in natural Korean unless told otherwise; place the narration as <audio data-ms-type="voice" data-ms-label="내레이션 · …"> on the root with its exact length.',
            ],
          },
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'measure_layout',
    {
      description:
        "Every named element's box (data-ms-id) relative to its PARENT element at second `at`, read with transforms switched off — the layout your CSS produces. inFlow=true marks the ones placed by flex/grid/flow. Only needed if you choose to convert a layout to absolute positions yourself (the app sets groups free when the designer moves them).",
      inputSchema: { at: z.number().min(0).optional().describe('seconds (default: the middle of the video)') },
    },
    async ({ at }) => {
      const { brief } = st()
      const boxes = await measureLayout(dir(), brief.output, at ?? brief.output.duration / 2)
      return text(JSON.stringify({ at: at ?? brief.output.duration / 2, inFlow: boxes.filter((b) => b.inFlow).length, boxes }, null, 1).slice(0, 60_000))
    },
  )

  server.registerTool(
    'layout_snapshot',
    {
      description:
        "Before / after check of a change that must not alter the picture: call with label 'before' first (photographs moments of the video), then with label 'after' when done — it photographs the same moments and reports how many pixels changed per moment (a changed moment comes with a red-marked image you can Read).",
      inputSchema: { label: z.enum(['before', 'after']), times: z.array(z.number().min(0)).max(16).optional() },
    },
    async ({ label, times }) => {
      const { brief } = st()
      const r = await layoutSnapshot(dir(), brief.output, label, times)
      if (label === 'before') return text(`Photographed ${r.times.length} moments (${r.times.join(', ')}s). Change the layout, then call layout_snapshot with label 'after'.`)
      return text(JSON.stringify(r.results, null, 1))
    },
  )

  server.registerTool(
    'get_web_font',
    {
      description:
        "Download a free web font into the project (composition/fonts/) when the brief and the designer did not name a font: any Google Fonts family (exact name, e.g. 'Noto Sans KR', 'Gothic A1', 'Black Han Sans', 'Do Hyeon', 'Gowun Dodum', 'Nanum Myeongjo', 'IBM Plex Sans KR', 'Hahmlet', 'Orbit', 'Montserrat', 'Bebas Neue') or 'Pretendard'. Then put <link rel=\"stylesheet\" href=\"fonts/web-fonts.css\" /> in <head> right after ms/fonts.css and use font-family: '<family>'. The files stay in the project, so preview and export work offline.",
      inputSchema: { family: z.string(), weights: z.array(z.number().int().min(100).max(900)).default([400, 700]) },
    },
    async ({ family, weights }) => {
      const f = await addWebFont(dir(), family, weights)
      return text(`Ready: font-family '${f.family}' (weights ${f.weights.join(', ')}). <head>: <link rel="stylesheet" href="fonts/web-fonts.css" /> after ms/fonts.css. Fonts in the project now: ${listWebFonts(dir()).map((x) => x.family).join(', ')}.`)
    },
  )

  server.registerTool(
    'codex_image',
    {
      description:
        "Make ONE image with the designer's Codex CLI (GPT Image through Codex's built-in image tool, on the designer's own ChatGPT quota). Use it when the brief's image model is Codex (provider \"codex\") or the designer asks for Codex / GPT 이미지. The prompt is sent as written. references: composition paths of images to follow (style, character, layout). The PNG is saved into composition/assets/generated/ and shown to the designer as a review card. Takes about a minute.",
      inputSchema: {
        prompt: z.string(),
        ratio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).default('1:1'),
        references: z.array(z.string()).default([]),
        label: z.string().optional().describe('short Korean description (shown on the card)'),
      },
    },
    async ({ prompt, ratio, references, label }) => {
      const work = join(dir(), '.studio', 'codex', `${Date.now()}`)
      // only pictures inside the composition go to Codex
      const refs = references.map((r) => resolvePath(dir(), 'composition', r)).filter((f) => !relative(join(dir(), 'composition'), f).startsWith('..') && /\.(png|jpe?g|webp)$/i.test(f) && existsSync(f))
      const made = await codexImage({ prompt, ratio, references: refs, workDir: work })
      const name = `codex-${Date.now().toString(36)}.png`
      mkdirSync(join(dir(), 'composition', 'assets', 'generated'), { recursive: true })
      const meta = await sharp(made).rotate().png().toFile(join(dir(), 'composition', 'assets', 'generated', name))
      rmSync(work, { recursive: true, force: true })
      const file = `assets/generated/${name}`
      recordGenerated(dir(), [{ file, kind: 'image', provider: 'codex', tool: 'image_gen', label: label ?? prompt.slice(0, 80) }])
      hooks.onGenerated(projectId, [{ file, kind: 'image' }], label)
      return text(`Saved: ${file} (${meta.width}x${meta.height}). Read it to check it. It is shown to the designer as a card; unless they asked you to place it straight away, say in one Korean line what you made and end your turn.`)
    },
  )

  server.registerTool(
    'make_video',
    {
      description:
        "Make one video clip with the designer's Higgsfield / Magnific account in one call: a motion prompt, optionally from a start frame to an end frame (composition paths of images, e.g. assets/generated/… made first with ai_call or codex_image). The app picks the right parameters for the model. The clip is saved into composition/assets/generated/ and shown to the designer as a card. Takes a few minutes; spends credits.",
      inputSchema: {
        prompt: z.string().describe('the motion: camera, action and order, pace, mood'),
        start_image: z.string().optional(),
        end_image: z.string().optional().describe('only models that take an end frame (e.g. Kling); needs start_image'),
        duration: z.number().min(1).max(20).default(5),
        ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        provider: PROVIDER.optional(),
        model: z.string().optional().describe('model id / slug (ai_tools lists them); empty = the brief default or the service default'),
        label: z.string().optional().describe('short Korean description (shown on the card)'),
      },
    },
    async ({ prompt, start_image, end_image, duration, ratio, provider, model, label }) => {
      if (end_image && !start_image) return text('끝 프레임을 쓰려면 시작 프레임도 주세요.')
      const frame = (f?: string) => (f ? (f.startsWith('composition/') || f.startsWith('.studio/') ? f : `composition/${f.replace(/^\.\//, '')}`) : undefined)
      for (const f of [start_image, end_image]) {
        if (!f) continue
        // only an image inside the project goes to the service
        const abs = resolvePath(dir(), frame(f)!)
        const rel = relative(dir(), abs)
        if (rel.startsWith('..') || isAbsolute(rel) || !/\.(png|jpe?g|webp)$/i.test(rel)) return text(`프로젝트 안의 이미지(png·jpg·webp)만 프레임으로 쓸 수 있어요: ${f}`)
        if (!existsSync(abs)) return text(`이미지를 찾지 못했어요: ${f}`)
      }
      const { brief } = st()
      const connected = connectedProviders().filter((p) => p === 'higgsfield' || p === 'magnific') as ('higgsfield' | 'magnific')[]
      const def = brief.ai.video && (brief.ai.video.provider === 'higgsfield' || brief.ai.video.provider === 'magnific') ? brief.ai.video : null
      const p = provider ?? def?.provider ?? connected[0]
      if (!p || !connected.includes(p as never)) return text('영상을 만들 서비스(힉스필드·매그니픽)가 연결돼 있지 않아요. 디자이너에게 AI 연결을 부탁하세요.')
      const o = brief.output
      const c = await generateVideoCandidate(dir(), {
        provider: p as 'higgsfield' | 'magnific',
        model: model ?? (def?.provider === p ? def.model : ''),
        modelLabel: model ?? (def?.provider === p ? def.label : undefined),
        lang: 'en',
        prompt,
        ratio: ratio ?? (o.width > o.height * 1.2 ? '16:9' : o.height > o.width * 1.2 ? '9:16' : '1:1'),
        duration,
        start: frame(start_image),
        end: frame(end_image),
      })
      const name = `video-${Date.now().toString(36)}.mp4`
      mkdirSync(join(dir(), 'composition', 'assets', 'generated'), { recursive: true })
      copyFileSync(join(dir(), c.file), join(dir(), 'composition', 'assets', 'generated', name))
      discardCandidate(dir(), c.id)
      const file = `assets/generated/${name}`
      recordGenerated(dir(), [{ file, kind: 'video', provider: p, tool: 'make_video', label: label ?? prompt.slice(0, 80) }])
      hooks.onGenerated(projectId, [{ file, kind: 'video' }], label)
      return text(`Saved: ${file}${c.video?.duration ? ` (${c.video.duration.toFixed(1)}s)` : ''}. It is shown to the designer as a card.`)
    },
  )

  server.registerTool(
    'ai_tools',
    {
      description: "List an AI service's tools with their parameters (Higgsfield or Magnific). Use filter to narrow, e.g. 'image', 'video', 'tts', 'voice', 'model', 'status'.",
      inputSchema: { provider: PROVIDER, filter: z.string().optional() },
    },
    async ({ provider, filter }) => {
      const tools = await listTools(provider as AiConnectProvider)
      const f = filter?.toLowerCase()
      const shown = tools.filter((t) => !f || t.name.toLowerCase().includes(f) || (t.description ?? '').toLowerCase().includes(f))
      return text(JSON.stringify(shown.map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 500), input: compactSchema(t.inputSchema) })), null, 1).slice(0, 60_000))
    },
  )

  server.registerTool(
    'ai_call',
    {
      description: "Run one tool of an AI service (Higgsfield or Magnific) with the designer's active account. Images, video and audio in the result are downloaded into composition/assets/generated/ and their composition paths (e.g. assets/generated/magnific-ab12cd-1.png) are returned: use those paths in the composition, and Read image files to look at them. Set save_media=false for listing/search calls.",
      inputSchema: {
        provider: PROVIDER,
        tool: z.string(),
        arguments: z.record(z.string(), z.unknown()).default({}),
        save_media: z.boolean().default(true),
        label: z.string().optional().describe('short Korean description of what this makes (shown to the designer)'),
      },
    },
    async ({ provider, tool, arguments: args, save_media, label }) => {
      const r = await callTool(provider as AiConnectProvider, tool, args)
      const parts: string[] = []
      for (const c of r.content ?? []) if (c.type === 'text' && c.text) parts.push(c.text)
      if (r.structuredContent) parts.push(JSON.stringify(r.structuredContent))
      let saved: Awaited<ReturnType<typeof saveResultMedia>> = []
      if (save_media && !r.isError) {
        saved = await saveResultMedia(join(dir(), 'composition'), provider, r)
        recordGenerated(dir(), saved.map((m) => ({ file: m.file, kind: m.kind, provider, tool, label: label ?? (typeof args.prompt === 'string' ? args.prompt : typeof args.text === 'string' ? args.text : undefined), args: keptArgs(args) })))
        const visual = saved.filter((m) => m.kind === 'image' || m.kind === 'video')
        if (visual.length) hooks.onGenerated(projectId, visual.map((m) => ({ file: m.file, kind: m.kind })), label)
      }
      const out = [
        r.isError ? '[error] 서비스가 오류를 돌려줬어요.' : '',
        parts.join('\n').slice(0, 8000),
        saved.length ? `\nSaved into the project (use these composition paths):\n${saved.map((m) => `- ${m.file} (${m.kind}, ${Math.round(m.bytes / 1024)}KB)`).join('\n')}` : '',
      ]
      return text(out.filter(Boolean).join('\n'))
    },
  )

  server.registerTool(
    'ai_import',
    {
      description:
        'Download one media URL (an image, video or audio file — a track or sound effect found on Artlist or a free music site) into composition/assets/generated/ and return its composition path. For anything not made by the designer\'s own AI accounts give page_url (where it was found) and license (e.g. "Pixabay Content License", "CC0", "Artlist"): it is shown to the designer before export. Free music must allow commercial use without attribution.',
      inputSchema: { url: z.string().url(), label: z.string().optional(), source: z.string().default('import'), page_url: z.string().optional(), license: z.string().optional() },
    },
    async ({ url, label, source, page_url, license }) => {
      const m = await importUrl(join(dir(), 'composition'), url, source.replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'import')
      recordGenerated(dir(), [{ file: m.file, kind: m.kind, provider: source, tool: 'import', label, source: page_url ?? url, license }])
      return text(`Saved: ${m.file} (${m.kind}, ${Math.round(m.bytes / 1024)}KB)${license ? '' : ' — 출처·라이선스를 모르면 디자이너에게 알려 주세요.'}`)
    },
  )

  // ---- SVG characters (assets made with the flat character style) ----
  /** a character asset folder inside composition/assets (never outside it) */
  const characterFolder = (asset: string) => {
    const rel = asset.replace(/^composition\//, '').replace(/\/(source\.png|vector\.svg|tagged\.svg)$/, '').replace(/\/+$/, '')
    if (!/^assets\/[\w.-]+$/.test(rel)) throw new Error('asset must be a character folder such as assets/gen-ab12cd34')
    return { rel, abs: join(dir(), 'composition', rel) }
  }

  server.registerTool(
    'character_info',
    {
      description:
        'Files and state of an SVG character asset (folder from get_brief, e.g. assets/gen-ab12cd34): Read source.png and vector_shapes.png as images to compare them, vector_shapes.json for each shape\'s colour and bbox. After tagging, also lists the parts of tagged.svg (ids, labels, pivots) for writing motion.',
      inputSchema: { asset: z.string() },
    },
    async ({ asset }) => {
      const f = characterFolder(asset)
      const info = readCharacter(f.abs)
      const files = ['source.png', 'vector.svg', 'vector_shapes.json', 'vector_shapes.png', 'tags.json', 'tagged.svg'].filter((n) => existsSync(join(f.abs, n)))
      return text(
        JSON.stringify(
          {
            folder: f.rel,
            read: files.map((n) => `composition/${f.rel}/${n}`),
            conversion: info ? { shapes: info.shapes, differencePct: info.badPct, pass: info.pass, problems: info.reasons } : 'not converted',
            parts: characterParts(f.abs),
          },
          null,
          1,
        ),
      )
    },
  )

  server.registerTool(
    'character_tag',
    {
      description:
        'Apply part tags (tags.json format of the svg-character-motion skill: parts → children with shapes, clip, pivot, label; AI fill shapes as {svg}) to the character\'s vector.svg. Writes tags.json and tagged.svg in the asset folder and returns the report and how many pixels differ from the untagged SVG at rest (aim for ≤ 0.1%; above that, fix the tags and call again).',
      inputSchema: { asset: z.string(), tags: z.object({ parts: z.array(z.unknown()) }).passthrough() },
    },
    async ({ asset, tags }) => {
      const f = characterFolder(asset)
      const r = await tagCharacter(f.abs, tags)
      // the brief remembers that this character is tagged
      const { brief } = st()
      const mine = (x: (typeof brief.assets)[number]) => x.character?.dir === `composition/${f.rel}`
      for (const x of brief.assets.filter((a) => mine(a) && a.character)) projects.replaceAsset(projectId, x.id, { ...x, character: { ...x.character!, tagged: true } })
      return text(JSON.stringify({ report: r.report, differencePct: r.diffPct, ok: r.diffPct <= 0.1, parts: characterParts(f.abs), next: 'Run character_check before character_embed.' }, null, 1))
    },
  )

  server.registerTool(
    'character_check',
    {
      description:
        'Check the tagged character in motion before using it: every part with a pivot (head, arms, hands, legs, feet, body, hair …) is turned to its largest angle (data-max-rot, else head 8°, limbs 12°, body 3°, hair/ears 6°) both ways, and gaps (red) or pieces left behind (magenta) at the joint are counted; eyes are checked for the eye rig and shown 1.3× with the pupil moved. Writes check_sheet.png in the asset folder: Read it. Fix the tags (eye rig, face cut along the jaw, neck under-hang, follow, layer order, pivots inside the moving part) until ok is true.',
      inputSchema: { asset: z.string() },
    },
    async ({ asset }) => {
      const f = characterFolder(asset)
      const r = await checkCharacterFolder(f.abs)
      return text(JSON.stringify({ ok: r.ok, sheet: `composition/${f.rel}/${r.sheet}`, joints: r.groups, eyes: r.eyes, limits: 'gaps ≤ 12 px and leftover pieces ≤ 40 px per pose; every eye uses the eye rig' }, null, 1))
    },
  )

  server.registerTool(
    'character_embed',
    {
      description:
        'Put the tagged character SVG inline into composition/index.html, inside the element with this data-ms-id (create that empty host element first, e.g. <div data-ms-id="char" data-ms-type="group" data-ms-label="캐릭터" style="position:absolute;…">). Calling it again replaces what it inserted before. extra_defs / extra_svg add expression shapes (eyelids, O mouth, tears …) inside <defs> / on top of the drawing; view_box widens the canvas (e.g. for 16:9). The host\'s size decides the size on screen.',
      inputSchema: { asset: z.string(), element_id: z.string(), extra_defs: z.string().optional(), extra_svg: z.string().optional(), view_box: z.string().optional() },
    },
    async ({ asset, element_id, extra_defs, extra_svg, view_box }) => {
      const f = characterFolder(asset)
      const r = embedCharacter(dir(), f.abs, element_id, { extraDefs: extra_defs, extraSvg: extra_svg, viewBox: view_box })
      return text(`Inserted the character (${Math.round(r.bytes / 1024)}KB) into the element ${element_id}. Its parts keep their ids (#head, #eye-l …). Add <script src="ms/svgrig.js"></script> after ms/runtime.js and drive the parts with SvgRig (see the skill).`)
    },
  )

  server.registerTool(
    'show_audio_candidates',
    {
      description: "Show music or sound-effect candidates (e.g. found on Artlist) to the designer in the Sound panel, where they can audition and pick one. Include preview_url for listening and download_url if the service gives a downloadable file. After calling this, briefly say what you found and END YOUR TURN.",
      inputSchema: {
        query: z.string().describe('what was searched, in Korean'),
        kind: z.enum(['bgm', 'sfx']),
        source: z.string().default('artlist'),
        items: z
          .array(
            z.object({
              id: z.string().optional(),
              title: z.string(),
              artist: z.string().optional(),
              duration: z.number().optional().describe('seconds'),
              bpm: z.number().optional(),
              mood: z.string().optional(),
              preview_url: z.string().optional(),
              download_url: z.string().optional(),
              page_url: z.string().optional(),
            }),
          )
          .min(1)
          .max(30),
      },
    },
    async ({ query, kind, source, items }) => {
      hooks.onAudioCandidates(projectId, {
        id: Math.random().toString(36).slice(2, 10),
        at: new Date().toISOString(),
        query,
        kind,
        items: items.map((it, i) => ({
          id: it.id ?? String(i),
          source,
          kind,
          title: it.title,
          artist: it.artist,
          duration: it.duration,
          bpm: it.bpm,
          mood: it.mood,
          previewUrl: it.preview_url,
          downloadUrl: it.download_url,
          pageUrl: it.page_url,
        })),
      })
      return text('사운드 패널에 후보를 보여줬어요. 디자이너가 듣고 고를 거예요. 이번 턴은 여기서 마무리하세요.')
    },
  )

  server.registerTool(
    'show_voice_candidates',
    {
      description:
        "Show narration voices to the designer as a card in the chat: they listen (preview_url, or the sample of a local voice) and pick one; their pick comes back as a message. Service voices come from the service's voice list (ai_call: Higgsfield list_voices / Magnific audio_voices_list). A voice from an open-source model you ran on this Mac is provider \"local\" with engine (model · licence) and sample (the take you made of the script, a composition path). Service and local voices can be on one card.",
      inputSchema: {
        label: z.string().optional().describe('what the narration is for, in Korean'),
        script: z.string().optional().describe('the narration script so far'),
        voices: z
          .array(
            z.object({
              provider: z.enum(['higgsfield', 'magnific', 'local']),
              id: z.string(),
              name: z.string(),
              engine: z.string().optional().describe('local voices: model and licence, e.g. "MeloTTS-Korean · MIT"'),
              sample: z.string().optional().describe('local voices: the sample take, a composition path (assets/generated/…wav)'),
              description: z.string().optional(),
              gender: z.string().optional(),
              preview_url: z.string().optional(),
              voice_type: z.string().optional(),
              source: z.string().optional(),
            }),
          )
          .min(1)
          .max(12),
      },
    },
    async ({ label, script, voices }) => {
      // a local voice is heard from its sample: a sound file inside the composition
      const bad = voices.find((v) => v.provider === 'local' && !(v.sample && /^[\w./-]+\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(v.sample) && !v.sample.includes('..') && existsSync(join(dir(), 'composition', v.sample))))
      if (bad) return text(`「${bad.name}」: a local voice needs sample = the take you made, a composition path to a sound file that exists (e.g. assets/generated/voice-melo-1.wav).`)
      hooks.onVoices(projectId, {
        label,
        script,
        voices: voices.map((v) => ({ provider: v.provider, id: v.id, name: v.name, description: v.description, gender: v.gender, previewUrl: v.preview_url, voiceType: v.voice_type, source: v.source, engine: v.engine, sample: v.sample })),
      })
      return text('목소리 후보를 디자이너에게 보여줬어요. 들어 보고 고르면 메시지로 알려 줘요. 이번 턴은 여기서 마무리하세요.')
    },
  )

  return server
}

export const STUDIO_TOOL_LABELS: Record<string, string> = {
  mcp__studio__get_brief: '브리프를 확인하고 있어요',
  mcp__studio__set_output: '대화에서 정한 출력 사양을 앱에 반영하고 있어요',
  mcp__studio__get_designer_edits: '직접 수정한 내용을 확인하고 있어요',
  mcp__studio__clear_designer_edits: '직접 수정한 레이어를 넘겨받고 있어요',
  mcp__studio__update_designer_edits: '직접 수정한 값을 고치고 있어요',
  mcp__studio__get_fonts: '사용할 수 있는 폰트를 살펴보고 있어요',
  mcp__studio__show_storyboard: '콘티를 정리하고 있어요',
  mcp__studio__get_storyboard: '콘티를 확인하고 있어요',
  mcp__studio__start_build: '제작을 시작하고 있어요',
  mcp__studio__use_as_material: '첨부를 소재함에 넣고 있어요',
  mcp__studio__make_video: 'AI로 영상을 만들고 있어요',
  mcp__studio__show_voice_candidates: '목소리 후보를 정리하고 있어요',
  mcp__studio__codex_image: 'AI로 이미지를 만들고 있어요',
  mcp__studio__check_video: '결과를 점검하고 있어요',
  mcp__studio__get_history: '작업 이력을 살펴보고 있어요',
  mcp__studio__list_sound_effects: '효과음을 고르고 있어요',
  mcp__studio__get_references: '첨부를 살펴보고 있어요',
  mcp__studio__look_at_reference: '첨부 영상을 자세히 보고 있어요',
  mcp__studio__use_sound_effect: '효과음을 넣고 있어요',
  mcp__studio__get_version: '이전 버전을 살펴보고 있어요',
  mcp__studio__look_at_frames: '장면을 직접 확인하고 있어요',
  mcp__studio__find_blocks: '바로 쓸 수 있는 효과를 찾고 있어요',
  mcp__studio__add_block: '효과 부품을 넣고 있어요',
  mcp__studio__ai_status: 'AI 생성 도구를 확인하고 있어요',
  mcp__studio__ai_tools: 'AI 생성 도구를 확인하고 있어요',
  mcp__studio__ai_call: 'AI로 소재를 만들고 있어요',
  mcp__studio__ai_import: '소재를 가져오고 있어요',
  mcp__studio__show_audio_candidates: '음악 후보를 정리하고 있어요',
  Write: '영상을 만들고 있어요',
  Edit: '영상을 다듬고 있어요',
  Read: '자료를 살펴보고 있어요',
  Glob: '자료를 살펴보고 있어요',
  Grep: '자료를 살펴보고 있어요',
  Skill: '제작 가이드를 참고하고 있어요',
  Agent: '일을 나눠 맡기고 있어요',
  Task: '일을 나눠 맡기고 있어요',
  WebSearch: '웹에서 찾아보고 있어요',
  WebFetch: '웹 자료를 읽고 있어요',
  mcp__studio__layout_snapshot: '화면을 비교하고 있어요',
  mcp__studio__measure_layout: '배치를 재고 있어요',
  mcp__studio__character_info: '캐릭터를 살펴보고 있어요',
  mcp__studio__character_tag: '캐릭터를 부위별로 나누고 있어요',
  mcp__studio__character_check: '캐릭터 움직임을 점검하고 있어요',
  mcp__studio__character_embed: '캐릭터를 영상에 넣고 있어요',
}
