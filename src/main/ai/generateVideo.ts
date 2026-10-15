// 소재 > AI로 만들기 > 영상: one clip from the designer's video model, optionally between
// a first and a last frame (images from the brief's assets or from image candidates).
// Like images, the tool's own input schema decides the parameter names:
//  - Higgsfield: generate_video {params:{model, prompt, aspect_ratio, duration, …}} with the
//    frames as start_image / end_image (directly, or as medias [{role, value}])
//  - Magnific: video_generate {prompt, slug, duration, aspectRatio, keyframes:{start,end}}
//    with each frame as {type:"image", url} (its catalogue says so for models with a
//    keyframes capability); other schemas: whatever start/first …, end/last/tail … keys they have
// The result waits for the service's queue, is saved as video.mp4 with a poster still in a
// candidate folder (.studio/generations/<id>/), and is kept or discarded like an image.
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { withRevision, type GenCandidate, type VideoGenRequest } from '@shared/assetGen'
import { probeMedia, thumbnailFromVideo } from '../media'
import { newId, nowIso } from '../util'
import { failIfError } from './catalog'
import { callTool, listTools } from './connect'
import { costOf, genDir, isCostOnly, keyOf, listCandidates, nearestOf, pickRatio, referenceValues, toolParams, writeCandidates, type Schema } from './generate'
import { autoHiggsfieldModel, listModels } from './catalog'
import type { AiModelInfo } from '@shared/ai'
import { resultUrl } from './jobs'
import { importUrl } from './media'

const VIDEO_TOOL: Record<VideoGenRequest['provider'], RegExp> = { higgsfield: /^generate_video$/, magnific: /^videos?_generate$/ }
const START_RE = /^(start|first)[_ ]?(frame|image)([_ ]?(image|url))?$|^(image|input_?image|init_?image|source_?image)(_?url)?$/i
const END_RE = /^(end|last|tail)[_ ]?(frame|image)([_ ]?(image|url))?$/i

/** the duration value the schema accepts (nearest enum entry, number or string as declared) */
export function pickDuration(s: Schema | undefined, seconds: number): number | string {
  const options = (s?.enum ?? []).map((x) => (typeof x === 'number' ? x : parseFloat(String(x)))).filter((x) => Number.isFinite(x))
  const best = options.length ? options.reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a)) : seconds
  const raw = s?.enum?.find((x) => parseFloat(String(x)) === best)
  if (raw !== undefined) return raw as number | string
  return s?.type === 'string' ? String(best) : best
}

/** the tool arguments for one clip, following the tool's own schema */
export async function videoArguments(req: VideoGenRequest, frames: { start?: string; end?: string }, tools: { name: string; inputSchema?: unknown }[], catalog: AiModelInfo[] = [], opts: { cost?: boolean; estimate?: boolean } = {}): Promise<{ tool: string; args: Record<string, unknown> }> {
  const tool = tools.find((t) => VIDEO_TOOL[req.provider].test(t.name))
  if (!tool) throw new Error('이 서비스에서 영상 만들기 도구를 찾지 못했어요. AI 연결을 다시 확인해 주세요.')
  // Higgsfield nests the parameters under "params" (an anyOf of an object and a string)
  const { nested, props } = toolParams(tool.inputSchema)
  const free = !Object.keys(props).length
  const a: Record<string, unknown> = {}
  a[keyOf(props, /^prompt$/i) ?? keyOf(props, /prompt/i, /negative/i) ?? 'prompt'] = withRevision(req.prompt, req.lang, req.revision, false)
  const modelKey = keyOf(props, /^(model|slug|mode|model_?id)$/i) ?? (free ? (req.provider === 'magnific' ? 'slug' : 'model') : undefined)
  // Higgsfield needs a model: "자동" = a generator that takes the frames given
  const model = req.model || (req.provider === 'higgsfield' ? autoHiggsfieldModel(catalog, 'video', { start: !!frames.start, end: !!frames.end }) : '') || ''
  // Magnific: no slug = its own auto-select (frames and length rules are then its own)
  const info = catalog.find((m) => m.id === model)
  if (info && frames.start && info.roles && !info.roles.some((r) => r === 'start_image' || r === 'image')) throw new Error(`고른 영상 모델(${info.name})은 시작 프레임 이미지를 받지 않아요. 프레임을 빼거나 다른 모델을 골라 주세요.`)
  if (info && frames.end && info.roles && !info.roles.includes('end_image')) throw new Error(`고른 영상 모델(${info.name})은 끝 프레임을 받지 않아요. 끝 프레임을 빼거나, 시작·끝 프레임을 받는 모델을 골라 주세요.`)
  if (info?.needsImage && !frames.start) throw new Error(`고른 영상 모델(${info.name})은 시작 프레임 이미지가 있어야 해요.`)
  if (model && modelKey) a[modelKey] = model
  const ratioKey = keyOf(props, /aspect/i) ?? (free ? (req.provider === 'magnific' ? 'aspectRatio' : 'aspect_ratio') : undefined)
  if (ratioKey) a[ratioKey] = info?.aspectRatios?.length ? nearestOf(info.aspectRatios, req.ratio) : pickRatio(props[ratioKey], req.ratio)
  const costKey = keyOf(props, /^get_?cost$/i)
  if (opts.cost && costKey) a[costKey] = true
  // Higgsfield: paid from credits (left out, an account with free-trial generations gets a question back and nothing is made)
  const unlimKey = keyOf(props, /^use_?unlim$/i)
  if (unlimKey) a[unlimKey] = false
  const durKey = keyOf(props, /^duration(_?s(ec(onds)?)?)?$/i) ?? (free ? 'duration' : undefined)
  // the length the model allows that is closest to the one wanted
  const allowed = info?.durations?.length ? info.durations : info?.durationRange ? [Math.max(info.durationRange.min, Math.min(info.durationRange.max, req.duration))] : null
  const seconds = allowed ? allowed.reduce((b, x) => (Math.abs(x - req.duration) < Math.abs(b - req.duration) ? x : b)) : req.duration
  if (durKey) a[durKey] = pickDuration(props[durKey], seconds)
  // Magnific requires a resolution for most models: 720p when offered
  const resKey = keyOf(props, /^resolution$/i)
  if (resKey && info?.resolutions?.length) a[resKey] = info.resolutions.find((r) => /^720p$/i.test(r)) ?? info.resolutions.find((r) => !/draft/i.test(r)) ?? info.resolutions[0]

  const wanted = (['start', 'end'] as const).filter((k) => frames[k])
  // an estimate checks what the model takes but uploads nothing (the price is the model's, not the picture's)
  if (wanted.length && !opts.estimate) {
    const keyframesKey = keyOf(props, /^key_?frames$/i) ?? (free && req.provider === 'magnific' ? 'keyframes' : undefined)
    const mediasKey = keyframesKey ? undefined : (keyOf(props, /^medias?$/i) ?? (free && req.provider === 'higgsfield' ? 'medias' : undefined))
    const startKey = keyOf(props, START_RE, /end|last|tail|reference|negative/i)
    const endKey = keyOf(props, END_RE)
    if (!keyframesKey && !mediasKey && !startKey && !endKey && !free) throw new Error('고른 영상 모델은 시작·끝 프레임 이미지를 받지 않아요. 프레임을 빼거나 다른 모델을 골라 주세요.')
    if (frames.end && !keyframesKey && !mediasKey && !endKey && !free) throw new Error('고른 영상 모델은 끝 프레임을 받지 않아요. 끝 프레임을 빼거나, 시작·끝 프레임을 받는 모델(예: Kling 3.0)을 골라 주세요.')
    const files = wanted.map((k) => frames[k]!)
    const kf = keyframesKey ? (props[keyframesKey]?.properties ?? {}) : {}
    const valueProp = (keyframesKey ? (kf.start?.properties?.url ?? kf.start ?? {}) : mediasKey ? props[mediasKey]?.items : props[startKey ?? endKey ?? '']) ?? {}
    const values = await referenceValues(req.provider as 'higgsfield' | 'magnific', files, valueProp, tools)
    const byRole = Object.fromEntries(wanted.map((k, i) => [k, values[i]])) as { start?: string; end?: string }
    if (keyframesKey) {
      // {start:{type:'image', url}, end:{…}}
      a[keyframesKey] = Object.fromEntries(wanted.map((k) => [k, { type: 'image', url: byRole[k] }]))
    } else if (mediasKey) {
      // [{role:'start_image', value}] — the item's own keys when the schema names them
      const item = props[mediasKey]?.items?.properties ?? {}
      const roleKey = keyOf(item, /role|type|kind/i) ?? 'role'
      const valKey = keyOf(item, /value|url|id|image|media/i, /role|type|kind/i) ?? 'value'
      // the start frame's role: start_image, or image for a model that only lists that
      const startRole = info?.roles && !info.roles.includes('start_image') && info.roles.includes('image') ? 'image' : 'start_image'
      a[mediasKey] = wanted.map((k) => ({ [roleKey]: k === 'start' ? startRole : 'end_image', [valKey]: byRole[k] }))
    } else {
      const sk = startKey ?? (free ? 'start_image' : undefined)
      const ek = endKey ?? (free ? 'end_image' : undefined)
      const asValue = (key: string, v: string) => (props[key]?.type === 'array' ? [v] : v)
      if (byRole.start && sk) a[sk] = asValue(sk, byRole.start)
      if (byRole.end && ek) a[ek] = asValue(ek, byRole.end)
    }
  }
  return { tool: tool.name, args: nested ? { params: a } : a }
}

/** what one clip would cost with these settings (Higgsfield's get_cost preflight: nothing is submitted) */
export async function estimateVideo(req: VideoGenRequest): Promise<{ credits: number; adjusted?: string[]; certainty?: string } | null> {
  const tools = (await listTools(req.provider)) as { name: string; inputSchema?: unknown }[]
  const catalog = (await listModels(req.provider, 'video').catch(() => ({ items: [] }))).items
  // frames are not uploaded for an estimate (they only choose the 자동 model and are checked against the chosen one)
  const { tool, args } = await videoArguments({ ...req, prompt: req.prompt || 'estimate' }, { start: req.start, end: req.end }, tools, catalog, { cost: req.provider === 'higgsfield', estimate: true })
  if (req.provider === 'higgsfield' && !isCostOnly(args)) return null
  const r = req.provider === 'magnific' ? await callTool('magnific', 'simulate_cost', { tool, arguments: args }, 60_000) : await callTool('higgsfield', tool, args, 60_000)
  if (r.isError) return null
  const c = costOf(r)
  // the length actually used (the request snaps to what the model allows)
  const used = (tool && (args.params as Record<string, unknown> | undefined)?.duration) ?? args.duration
  if (c && typeof used === 'number' && used !== req.duration && !c.adjusted) c.adjusted = [`길이 ${req.duration}초 → ${used}초`]
  return c
}

/** makes one clip; the card shows its poster still and plays it */
export async function generateVideoCandidate(projectDir: string, req: VideoGenRequest): Promise<GenCandidate> {
  const id = newId()
  const folder = join(genDir(projectDir), id)
  mkdirSync(folder, { recursive: true })
  try {
    const frames = { start: req.start && join(projectDir, req.start), end: req.end && join(projectDir, req.end) }
    const tools = (await listTools(req.provider)) as { name: string; inputSchema?: unknown }[]
    const catalog = (await listModels(req.provider, 'video').catch(() => ({ items: [] }))).items
    const { tool, args } = await videoArguments(req, frames, tools, catalog)
    const r = await callTool(req.provider, tool, args, 600_000)
    failIfError(r)
    // a clip takes minutes (Magnific lists up to 10): followed for ~20 minutes
    const clip = await importUrl(folder, await resultUrl(req.provider, r, 48), 'gen')
    if (clip.kind !== 'video') throw new Error('서비스가 영상이 아닌 파일을 돌려줬어요. 다른 모델을 골라 주세요.')
    renameSync(join(folder, clip.file), join(folder, 'video.mp4'))
    rmSync(join(folder, 'assets'), { recursive: true, force: true })
    const meta = await probeMedia(join(folder, 'video.mp4'))
    await thumbnailFromVideo(join(folder, 'video.mp4'), join(folder, 'poster.jpg'), Math.min(0.5, (meta.duration ?? 1) / 4), 640)
    const candidate: GenCandidate = {
      id,
      at: nowIso(),
      file: `.studio/generations/${id}/video.mp4`,
      request: { provider: req.provider, model: req.model, modelLabel: req.modelLabel, style: 'none', framing: 'auto', ratio: req.ratio, lang: req.lang, prompt: req.prompt, references: [req.start, req.end].filter(Boolean) as string[], revision: req.revision },
      sent: withRevision(req.prompt, req.lang, req.revision, false),
      video: { request: req, poster: `.studio/generations/${id}/poster.jpg`, duration: meta.duration },
    }
    writeCandidates(projectDir, [candidate, ...listCandidates(projectDir)].slice(0, 60))
    return candidate
  } catch (e) {
    rmSync(folder, { recursive: true, force: true })
    throw e
  }
}
