// 소재 > AI로 만들기: one image straight from the designer's account, with the
// prompt exactly as built (style + framing + what the designer typed). The tool's
// own input schema decides the parameter names (model / aspect ratio / count /
// negative prompt / reference images), so small service changes do not break it.
// Results wait for the service's queue, are saved as source.png in a candidate
// folder (.studio/generations/<id>/) and, for the flat character style, turned
// into an SVG right away.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { buildPrompt, negativeFor, withRevision, type GenCandidate, type GenRequest, type Ratio } from '@shared/assetGen'
import { convertCharacter } from '../character/convert'
import { newId, nowIso, readJson, writeJson } from '../util'
import { autoHiggsfieldModel, failIfError, listModels, payload } from './catalog'
import { codexImage } from './codex'
import { callTool, listTools, type ToolResult } from './connect'
import { saveResultMedia } from './media'

export type Schema = { type?: string; properties?: Record<string, Schema>; enum?: unknown[]; description?: string; items?: Schema; anyOf?: Schema[] }

/**
 * the parameters a generate tool takes: Higgsfield nests them under "params" (now an anyOf of
 * an object and a string) — the object form is the one to fill
 */
export function toolParams(inputSchema: unknown): { nested: 'params' | null; props: Record<string, Schema> } {
  const top = ((inputSchema as Schema | undefined)?.properties ?? {}) as Record<string, Schema>
  const p = top.params
  const obj = p?.anyOf?.find((x) => x.type === 'object' || x.properties) ?? p
  const nested = p && (obj?.type === 'object' || obj?.properties) ? 'params' : null
  return { nested, props: (nested ? obj!.properties : top) ?? {} }
}
/** services reached through their MCP tools (Codex runs as a local CLI instead) */
export type McpProvider = Exclude<GenRequest['provider'], 'codex'>

const GENERATE_TOOL: Record<McpProvider, RegExp> = { magnific: /^images?_generate$/, higgsfield: /^generate_image$/ }
export const genDir = (projectDir: string) => join(projectDir, '.studio', 'generations')
const listFile = (projectDir: string) => join(genDir(projectDir), 'candidates.json')

export const listCandidates = (projectDir: string) => readJson<GenCandidate[]>(listFile(projectDir), [])
export const writeCandidates = (projectDir: string, list: GenCandidate[]) => writeJson(listFile(projectDir), list)
const saveList = writeCandidates

export const keyOf = (props: Record<string, Schema>, re: RegExp, not?: RegExp) => Object.keys(props).find((k) => re.test(k) && !not?.test(k))

/** the ratio a model lists that is closest to the one wanted ("9:16" when it has it) */
export function nearestOf(options: string[], ratio: string): string {
  const [w, h] = ratio.split(':').map(Number)
  const want = Math.log(w / h)
  let best = options[0]
  for (const o of options) {
    const [a, b] = o.split(':').map(Number)
    if (Math.abs(Math.log(a / b) - want) < Math.abs(Math.log(Number(best.split(':')[0]) / Number(best.split(':')[1])) - want)) best = o
  }
  return best
}

/**
 * the credits a generation would cost — Higgsfield's get_cost preflight ({cost:{credits}}) or
 * Magnific's simulate_cost ({credits, certainty}); nothing is submitted, nothing charged
 */
export function costOf(r: ToolResult): { credits: number; adjusted?: string[]; certainty?: string } | null {
  const p = payload(r) as { credits?: unknown; certainty?: unknown; cost?: { credits?: unknown; credits_exact?: unknown }; adjustments?: Record<string, { requested?: unknown; used?: unknown }> } | null
  // Magnific's auto video mode answers with the most it could cost
  if (p && typeof p.credits === 'number') return { credits: p.credits, certainty: /maximum/i.test(String((p as { reason?: unknown }).reason ?? '')) ? 'max' : typeof p.certainty === 'string' ? p.certainty : undefined }
  const credits = Number(p?.cost?.credits_exact ?? p?.cost?.credits)
  if (!Number.isFinite(credits)) {
    const m = JSON.stringify(r.content ?? '').match(/([\d.]+)\s*credits?/i)
    return m ? { credits: Number(m[1]) } : null
  }
  const adjusted = Object.entries(p?.adjustments ?? {})
    .filter(([k, v]) => k === 'duration' && v && v.requested !== v.used)
    .map(([, v]) => `길이 ${v.requested}초 → ${v.used}초`)
  return { credits, adjusted: adjusted.length ? adjusted : undefined }
}

/**
 * the arguments ask only for the price: Higgsfield's generate tools make the picture unless
 * get_cost is set (an estimate never goes out without it)
 */
export function isCostOnly(args: Record<string, unknown>): boolean {
  const a = (args.params && typeof args.params === 'object' ? args.params : args) as Record<string, unknown>
  return Object.entries(a).some(([k, v]) => /^get_?cost$/i.test(k) && v === true)
}

/** what one image would cost with these settings (no reference images uploaded for the estimate) */
export async function estimateImage(req: GenRequest): Promise<{ credits: number; adjusted?: string[]; certainty?: string } | null> {
  if (req.provider === 'codex') return null
  const mcp = req as GenRequest & { provider: McpProvider }
  const { tool, args } = await argumentsFor(mcp, buildPrompt(req.style, req.framing, req.lang, req.prompt || 'estimate', req.kind), [], { cost: req.provider === 'higgsfield' })
  if (req.provider === 'higgsfield' && !isCostOnly(args)) return null
  const r = req.provider === 'magnific' ? await callTool('magnific', 'simulate_cost', { tool, arguments: args }, 60_000) : await callTool('higgsfield', tool, args, 60_000)
  if (r.isError) return null
  return costOf(r)
}

/** credits left on the active account of a service (read-only) */
export async function balanceOf(provider: McpProvider): Promise<number | null> {
  const r = await callTool(provider, provider === 'magnific' ? 'account_balance' : 'balance', {}, 30_000)
  if (r.isError) return null
  const p = payload(r) as { credits?: unknown } | null
  const c = p?.credits
  const n = typeof c === 'number' ? c : c && typeof c === 'object' ? Number((c as { available?: unknown }).available) : Number(JSON.stringify(r.content ?? '').match(/Credits:\s*([\d.]+)/i)?.[1])
  return Number.isFinite(n) ? n : null
}

/** an aspect-ratio value the schema accepts: "3:4", or the nearest enum entry ("traditional_3_4", …) */
export function pickRatio(s: Schema | undefined, ratio: Ratio): string {
  const [w, h] = ratio.split(':').map(Number)
  const want = w / h
  const options = (s?.enum ?? []).filter((x): x is string => typeof x === 'string')
  if (!options.length) return ratio
  let best = options[0]
  let gap = Infinity
  for (const o of options) {
    const n = o.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
    if (!n) continue
    const g = Math.abs(Math.log(+n[1] / +n[2] / want))
    if (g < gap) {
      gap = g
      best = o
    }
  }
  return best
}

/** creation / job ids in a queued result */
export function queued(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => queued(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (/^(identifiers?|creationIdentifier|job_?ids?|job_?set_?id|request_?id|task_?id)$/i.test(k)) (Array.isArray(x) ? x : [x]).forEach((i) => (typeof i === 'string' || typeof i === 'number') && !out.includes(String(i)) && out.push(String(i)))
      else queued(x, out)
    }
  return out
}

const still = (r: ToolResult) => /in[_ -]?progress|queued|pending|processing|running|poll_after|not[_ ]ready/i.test(JSON.stringify(payload(r)) ?? '')

/** waits for a queued generation and returns the result that holds its files */
export async function waitFor(provider: McpProvider, ids: string[], rounds = 12): Promise<ToolResult | null> {
  // Higgsfield: a direct generation is followed with job_status (jobs_wait is for batch jobs); sync waits ~25 s a call
  if (provider === 'higgsfield') {
    const done: unknown[] = []
    for (const id of ids) {
      let last: ToolResult | null = null
      for (let i = 0; i < rounds * 2; i++) {
        last = await callTool('higgsfield', 'job_status', { jobId: id, sync: true }, 60_000)
        failIfError(last)
        if (!still(last)) break
      }
      if (!last || still(last)) return null
      done.push(payload(last))
    }
    return { content: [{ type: 'text', text: JSON.stringify(done) }], structuredContent: { jobs: done } } as ToolResult
  }
  for (let i = 0; i < rounds; i++) {
    if (provider === 'magnific') {
      const w = await callTool('magnific', 'creations_wait', { identifiers: ids, timeoutSeconds: 25 }, 60_000)
      failIfError(w)
      if (still(w)) continue
      const got = await callTool('magnific', 'creations_get', { identifiers: ids }, 60_000)
      failIfError(got)
      return got
    }
    const w = await callTool('higgsfield', 'jobs_wait', { jobs: ids }, 120_000)
    failIfError(w)
    if (!still(w)) return w
  }
  return null
}

/** reference images in the form the tool takes: base64 when its description says so, else an uploaded URL */
/** the first string value (searched deeply) whose key matches */
function valueAt(v: unknown, re: RegExp): string | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = valueAt(x, re)
      if (f) return f
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (re.test(k) && (typeof x === 'string' || typeof x === 'number')) return String(x)
    for (const x of Object.values(v)) {
      const f = valueAt(x, re)
      if (f) return f
    }
  }
  return undefined
}

const mimeOfImage = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg')

/**
 * images in the form the tool takes: base64 when its description says so, else uploaded
 * with the service's upload tool (the file itself, or a signed upload URL it hands out)
 * and passed on as the URL / id that tool returns
 */
export async function referenceValues(provider: McpProvider, files: string[], prop: Schema, tools: { name: string; inputSchema?: unknown }[]): Promise<string[]> {
  const base64 = /base64/i.test(prop.description ?? '') || /base64/i.test(prop.items?.description ?? '')
  if (base64) return files.map((f) => readFileSync(f).toString('base64'))
  // Magnific: a presigned PUT slot, the bytes, then finalize → a creation identifier the generators take
  const request = tools.find((t) => /^creations_request_upload$/.test(t.name))
  const finalize = tools.find((t) => /^creations_finalize_upload$/.test(t.name))
  if (request && finalize) {
    const out: string[] = []
    for (const f of files) {
      const slot = await callTool(provider, request.name, { mimeType: mimeOfImage(f) }, 60_000)
      failIfError(slot)
      const s = payload(slot)
      const url = valueAt(s, /^(proxy_?upload_?url|upload_?url|url)$/i)
      const path = valueAt(s, /^path$/i)
      if (!url || !path) throw new Error('이미지를 서비스에 올리지 못했어요.')
      const put = await fetch(url, { method: 'PUT', body: readFileSync(f), headers: { 'Content-Type': mimeOfImage(f) } })
      if (!put.ok) throw new Error('이미지를 서비스에 올리지 못했어요.')
      const done = await callTool(provider, finalize.name, { path, fileName: basename(f), visible: false }, 120_000)
      failIfError(done)
      const id = valueAt(payload(done), /^(identifier|creation_?identifier)$/i) ?? valueAt(payload(done), /^(id|creation_?id)$/i)
      if (!id) throw new Error('이미지를 서비스에 올리지 못했어요.')
      out.push(id)
    }
    return out
  }
  const upload = tools.find((t) => /upload/i.test(t.name))
  const props = (upload?.inputSchema as Schema | undefined)?.properties ?? {}
  const dataKey = keyOf(props, /base64|data|content|^file$/i, /name|type|mime|url/i)
  const nameKey = keyOf(props, /name/i)
  if (!upload || (!dataKey && !nameKey)) throw new Error('고른 모델에는 이미지를 함께 보낼 수 없어요. 이미지를 빼거나, 편집 탭 대화에서 Claude에게 부탁해 주세요.')
  const out: string[] = []
  for (const f of files) {
    const args: Record<string, unknown> = {}
    if (dataKey) args[dataKey] = readFileSync(f).toString('base64')
    const mimeKey = keyOf(props, /mime|content_?type/i)
    if (nameKey) args[nameKey] = basename(f)
    if (mimeKey) args[mimeKey] = mimeOfImage(f)
    const r = await callTool(provider, upload.name, args, 120_000)
    failIfError(r)
    const p = payload(r)
    const signed = valueAt(p, /^(upload_?url|put_?url|presigned_?url|signed_?url)$/i)
    const mediaId = valueAt(p, /^(media_?id|id|upload_?id|file_?id)$/i)
    if (signed && !dataKey) {
      const put = await fetch(signed, { method: 'PUT', body: readFileSync(f), headers: { 'Content-Type': mimeOfImage(f) } })
      if (!put.ok) throw new Error('이미지를 서비스에 올리지 못했어요.')
      // Higgsfield: an uploaded file counts once it is confirmed; generations then take its media id
      const confirm = tools.find((t) => /^media_confirm$/i.test(t.name))
      if (confirm && mediaId) {
        failIfError(await callTool(provider, confirm.name, { type: 'image', media_id: mediaId }, 60_000))
        out.push(mediaId)
        continue
      }
    }
    const value = valueAt(p, /^(url|public_?url|file_?url|cdn_?url|media_?url)$/i) ?? mediaId ?? JSON.stringify(p ?? '').match(/https:\/\/[^"\\\s]+/)?.[0]
    if (!value) throw new Error('이미지를 서비스에 올리지 못했어요.')
    out.push(value)
  }
  return out
}

const REF_KEY = /reference|ref_?images?|input_?images?|image_?urls?|init_?image|source_?image|^images?$/i

/** the image tool of a service and its (possibly nested) parameters */
async function imageTool(provider: McpProvider) {
  const tools = (await listTools(provider)) as { name: string; inputSchema?: unknown }[]
  const tool = tools.find((t) => GENERATE_TOOL[provider].test(t.name))
  if (!tool) throw new Error('이 서비스에서 이미지 만들기 도구를 찾지 못했어요. AI 연결을 다시 확인해 주세요.')
  // Higgsfield nests everything under "params"
  const { nested, props } = toolParams(tool.inputSchema)
  return { tools, tool, nested, props }
}

/** whether the chosen image tool takes reference images (else a revision goes as words only) */
async function takesImages(provider: McpProvider): Promise<boolean> {
  const { props } = await imageTool(provider)
  // a tool without a described reference field cannot be sent the picture: the change goes in words
  return !!keyOf(props, REF_KEY, /prompt|negative/i) || !!keyOf(props, /^medias?$/i)
}

/** a reference path: composition-relative (assets/…), or project-relative (.studio/…, composition/…) */
export function referencePath(projectDir: string, rel: string): string {
  const abs = /^(\.studio|composition)\//.test(rel) ? resolve(projectDir, rel) : resolve(projectDir, 'composition', rel)
  const r = relative(projectDir, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('프로젝트 밖의 이미지는 참고로 쓸 수 없어요.')
  return abs
}

/** the tool arguments for one image, following the tool's own schema */
async function argumentsFor(req: GenRequest & { provider: McpProvider }, sent: string, references: string[], opts: { cost?: boolean } = {}): Promise<{ tool: string; args: Record<string, unknown> }> {
  const { tools, tool, nested, props } = await imageTool(req.provider)
  const free = !Object.keys(props).length
  const a: Record<string, unknown> = {}
  a[keyOf(props, /^prompt$/i) ?? keyOf(props, /prompt/i, /negative/i) ?? 'prompt'] = sent
  const modelKey = keyOf(props, /^(model|mode|slug|model_?id)$/i) ?? (free ? (req.provider === 'magnific' ? 'mode' : 'model') : undefined)
  // Higgsfield needs a model: "자동" is its image_auto
  const catalog = req.provider === 'higgsfield' ? (await listModels('higgsfield', 'image').catch(() => ({ items: [] }))).items : []
  const model = req.model || (req.provider === 'higgsfield' ? autoHiggsfieldModel(catalog, 'image') : '') || ''
  const info = catalog.find((m) => m.id === model)
  if (model && modelKey) a[modelKey] = model
  const ratioKey = keyOf(props, /aspect/i) ?? (free ? (req.provider === 'magnific' ? 'aspectRatio' : 'aspect_ratio') : undefined)
  if (ratioKey) a[ratioKey] = info?.aspectRatios?.length ? nearestOf(info.aspectRatios, req.ratio) : pickRatio(props[ratioKey], req.ratio)
  if (opts.cost && keyOf(props, /^get_?cost$/i)) a[keyOf(props, /^get_?cost$/i)!] = true
  const countKey = keyOf(props, /^(count|num_?images|n|batch_?size|number_?of_?images)$/i)
  if (countKey) a[countKey] = 1
  const negKey = keyOf(props, /negative/i)
  const negative = negativeFor(req.style)
  if (negKey && negative) a[negKey] = negative
  const mediasKey = keyOf(props, /^medias?$/i)
  if (references.length && mediasKey) {
    // Higgsfield: [{role, value: media id}], the role the chosen model lists for reference images
    if (info?.roles && !info.roles.some((r) => r === 'image' || r === 'image_references')) throw new Error('고른 모델에는 참고 이미지를 함께 보낼 수 없어요. 참고 소재를 빼거나 다른 모델을 골라 주세요.')
    const role = info?.roles?.includes('image_references') ? 'image_references' : 'image'
    const values = await referenceValues(req.provider, references, props[mediasKey].items?.properties?.value ?? {}, tools)
    a[mediasKey] = values.map((value) => ({ role, value }))
  } else if (references.length) {
    const refKey = keyOf(props, REF_KEY, /prompt|negative/i)
    if (!refKey) throw new Error('고른 모델에는 참고 이미지를 함께 보낼 수 없어요. 참고 소재를 빼거나 다른 모델을 골라 주세요.')
    const values = await referenceValues(req.provider, references, props[refKey], tools)
    // Magnific: references are objects {type: "image", identifier}
    const item = props[refKey].items?.properties
    a[refKey] = props[refKey].type === 'array' ? (item?.identifier ? values.map((identifier) => ({ type: 'image', identifier })) : values) : values[0]
  }
  return { tool: tool.name, args: nested ? { params: a } : a }
}

/** makes one image; with the flat character style it is converted to SVG before it is shown */
export async function generateCandidate(projectDir: string, req: GenRequest): Promise<GenCandidate> {
  const id = newId()
  const folder = join(genDir(projectDir), id)
  mkdirSync(folder, { recursive: true })
  try {
    // 수정해서 다시 만들기: the previous image goes along when the model takes images
    const previous = req.revisedFrom ? referencePath(projectDir, req.revisedFrom) : null
    if (previous && !existsSync(previous)) throw new Error('고칠 이미지를 찾을 수 없어요. 후보가 지워졌다면 처음부터 다시 만들어 주세요.')
    const withImage = !!previous && (req.provider === 'codex' || (await takesImages(req.provider)))
    const sent = withRevision(buildPrompt(req.style, req.framing, req.lang, req.prompt, req.kind), req.lang, req.revision, withImage)
    // the previous picture first: a tool that takes one image gets that one
    const refs = [...(withImage ? [previous!] : []), ...req.references.map((r) => referencePath(projectDir, r))]
    let raw: string
    if (req.provider === 'codex') raw = await codexImage({ prompt: sent, ratio: req.ratio, references: refs, workDir: folder })
    else {
      const mcp = req as GenRequest & { provider: McpProvider }
      const { tool, args } = await argumentsFor(mcp, sent, refs)
      let r = await callTool(mcp.provider, tool, args, 300_000)
      failIfError(r)
      let saved = await saveResultMedia(folder, 'gen', r, 1)
      if (!saved.length) {
        const ids = queued(payload(r))
        const done = ids.length ? await waitFor(mcp.provider, ids.slice(0, 4)) : null
        if (done) {
          r = done
          saved = await saveResultMedia(folder, 'gen', r, 1)
        }
      }
      const img = saved.find((m) => m.kind === 'image')
      if (!img) throw new Error('이미지를 받지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      raw = join(folder, img.file)
    }
    // one format for the next steps (SVG conversion reads it, Claude looks at it)
    await sharp(raw).rotate().png().toFile(join(folder, 'source.png'))
    rmSync(join(folder, 'assets'), { recursive: true, force: true })
    const candidate: GenCandidate = { id, at: nowIso(), file: `.studio/generations/${id}/source.png`, request: req, sent }
    if (req.style === 'flat-character') candidate.character = await convertCharacter(projectDir, folder, req.framing)
    saveList(projectDir, [candidate, ...listCandidates(projectDir)].slice(0, 60))
    return candidate
  } catch (e) {
    rmSync(folder, { recursive: true, force: true })
    throw e
  }
}

/** converts a candidate or asset folder again (e.g. with fewer colours) */
export async function reconvert(projectDir: string, dirRel: string, framing: GenRequest['framing'], colors: number) {
  return convertCharacter(projectDir, join(projectDir, dirRel), framing, colors)
}

export function discardCandidate(projectDir: string, id: string) {
  saveList(
    projectDir,
    listCandidates(projectDir).filter((c) => c.id !== id),
  )
  rmSync(join(genDir(projectDir), id.replace(/[^\w-]/g, '')), { recursive: true, force: true })
}

/** the composition folder a kept candidate moves to (assets/gen-<id>/) */
export function candidateTarget(id: string) {
  return `assets/gen-${id.replace(/[^\w-]/g, '').slice(0, 10)}`
}

export const candidateFolder = (projectDir: string, id: string) => join(genDir(projectDir), id.replace(/[^\w-]/g, ''))
export const isImageFile = (f: string) => /\.(png|jpe?g|webp|gif|avif)$/i.test(extname(f))
