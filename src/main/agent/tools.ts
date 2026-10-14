// Studio tools for Claude, served over local HTTP MCP (one endpoint per project).
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import sharp from 'sharp'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Storyboard } from '@shared/api'
import { AI_PROVIDERS, type AiConnectProvider, type AudioCandidateList } from '@shared/ai'
import { describeTiming, SECTION_LABELS } from '@shared/brief'
import { activeAccount } from '../ai/accounts'
import { codexImage, codexStatus } from '../ai/codex'
import { callTool, connectedProviders, listTools } from '../ai/connect'
import { importUrl, saveResultMedia } from '../ai/media'
import { aiSettings } from '../ai/settings'
import { recordGenerated } from '../ai/generated'
import { sfxLibrary, useBuiltinSfx } from '../audio'
import { listReferences, nearDuplicates, referenceFramesAt } from '../references'
import { auditComposition } from '../audit'
import { fullCheck, lastElements } from '../checks'
import { listFonts } from '../fonts'
import * as history from '../history'
import { snapshot } from '../hyperframes'
import { bin } from '../paths'
import * as projects from '../projects'
import { characterParts, embedCharacter, readCharacter, tagCharacter } from '../character/convert'
import { addWebFont, listWebFonts } from '../webfonts'

const run = promisify(execFile)
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

export interface ToolHooks {
  onStoryboard(projectId: string, sb: Storyboard): void
  onAudioCandidates(projectId: string, list: AudioCandidateList): void
  /** images / video clips Claude generated: shown to the designer to keep or discard */
  onGenerated(projectId: string, files: { file: string; kind: string }[], label?: string): void
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

/** stretches where the picture changes a lot between 0.1 s frames (motion), strongest first */
function movesOf(motion: number[]): { from: number; to: number; peak: number }[] {
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
      out.push({ from: +(start * 0.1).toFixed(1), to: +((i + 1) * 0.1).toFixed(1), peak })
      start = -1
      peak = 0
    }
  })
  if (start >= 0) out.push({ from: +(start * 0.1).toFixed(1), to: +((motion.length + 1) * 0.1).toFixed(1), peak })
  return out.sort((a, b) => b.peak - a.peak).slice(0, 24).sort((a, b) => a.from - b.from)
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
            background:
              brief.output.background === 'auto'
                ? 'AI 자율: design the background yourself (colour, gradient, texture, shapes or a generated image) to fit the tone and each scene.'
                : brief.output.background === 'transparent'
                  ? 'transparent'
                  : `solid colour ${brief.output.backgroundColor}`,
            storyboard: brief.storyboard.length
              ? {
                  note: 'The designer planned these scenes. Follow their order, timing (seconds; missing = you decide), copy and images. Texts with locked=true must appear verbatim. Images with mode "file" are files to use (required=true: must appear). Images with mode "describe" must be found among the assets or generated with AI (see ai_status; use the image\'s model if set, else the brief default).',
                  totalSeconds: brief.storyboard.reduce((a, s) => a + (s.duration ?? 0), 0) || undefined,
                  scenes: brief.storyboard.map((s, i) => ({ n: i + 1, ...s })),
                }
              : undefined,
            ai: { ...brief.ai, note: 'Defaults for AI generation (null = you choose). What the designer asks in the chat always wins over these.' },
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
              generated: a.generated ? { prompt: a.generated.prompt, style: a.generated.style } : undefined,
              character: a.character
                ? {
                    folder: a.character.dir.replace(/^composition\//, ''),
                    svg: a.character.status === 'done',
                    shapes: a.character.shapes,
                    tagged: !!a.character.tagged,
                    note: 'An SVG character that can act part by part: load the skill svg-character-motion and use character_info / character_tag / character_embed.',
                  }
                : undefined,
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
    { description: 'List the reference videos/images the designer attached: title, note, ranges to focus on, keyframes, and for videos the MOTION SHEETS — the whole video every 0.1 s, 20 frames (2 s) per sheet with seconds under each frame (project-relative jpgs to open with Read) — plus scene cuts, shot lengths and the moments where the picture moves most.' },
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
            motionSheets: r.sheets?.length ? { every: '0.1s', perSheet: '2s (20 frames, 5×4, read left→right, top→bottom)', sheets: r.sheets } : undefined,
            cuts: r.cuts?.length ? r.cuts : undefined,
            shotLengths: r.cuts?.length ? shotLengths(r.cuts, r.meta?.duration ?? 0) : undefined,
            moves: r.motion?.length ? movesOf(r.motion) : undefined,
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
      const { brief, overrides, hasVideo } = st()
      // a fresh hidden render knows the current element tree even when the editor has not reloaded yet
      const audit = hasVideo ? await auditComposition(dir(), brief.output) : null
      const elements = audit ? audit.elements : lastElements.get(projectId)
      const findings = await fullCheck(dir(), brief, overrides, elements, true, audit ?? undefined)
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
      const made = await codexImage({ prompt, ratio, references: references.map((r) => join(dir(), 'composition', r)), workDir: work })
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
        recordGenerated(dir(), saved.map((m) => ({ file: m.file, kind: m.kind, provider, tool, label: label ?? (typeof args.prompt === 'string' ? args.prompt : typeof args.text === 'string' ? args.text : undefined) })))
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
      description: 'Download one media URL (an image, video or audio file, e.g. a track or sound effect found with the Artlist tools) into composition/assets/generated/ and return its composition path.',
      inputSchema: { url: z.string().url(), label: z.string().optional(), source: z.string().default('import') },
    },
    async ({ url, label, source }) => {
      const m = await importUrl(join(dir(), 'composition'), url, source.replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'import')
      recordGenerated(dir(), [{ file: m.file, kind: m.kind, provider: source, tool: 'import', label }])
      return text(`Saved: ${m.file} (${m.kind}, ${Math.round(m.bytes / 1024)}KB)`)
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
      if (brief.assets.some(mine)) await projects.saveBrief(projectId, { ...brief, assets: brief.assets.map((x) => (mine(x) && x.character ? { ...x, character: { ...x.character, tagged: true } } : x)) })
      return text(JSON.stringify({ report: r.report, differencePct: r.diffPct, ok: r.diffPct <= 0.1, parts: characterParts(f.abs) }, null, 1))
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
}
