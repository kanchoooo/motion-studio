// What a generate call hands back and how it is followed to the finished file, by the services'
// own output schemas (read 2026-10-15):
// - Higgsfield generate_image / generate_video → {results: [{id, status, results: {rawUrl, minUrl}}], error?}
//   job_status {jobId, sync: true} (waits ~25 s) → {generation: {id, status, results: {rawUrl}}}
//   statuses: pending … in_progress, ip_detect · terminal: completed, failed, nsfw, canceled, ip_detected
// - Magnific images_generate / video_generate → {creation: {identifier, status}, creations: [{identifier}]}
//   creations_wait {identifiers, timeoutSeconds ≤ 25} → {results: [{identifier, status, results, failureReason}], allTerminal}
//   creations_get {creationIdentifier} → {url (full size), previewUrl, thumbnailUrl, …}
// A job is followed by its status field, never by words found anywhere in the reply (a prompt may
// say "running"), and the file is the full-size URL the schema names (not a thumbnail, an avatar
// or an input picture echoed back).
import { failIfError, payload } from './catalog'
import { callTool, type ToolResult } from './connect'

/** the first string value (searched deeply) whose key matches */
export function valueAt(v: unknown, re: RegExp): string | undefined {
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

/** the pauses between polls (tests set scale 0) */
export const pace = { scale: 1 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * pace.scale))
const LATE = '아직 만드는 중이에요. 서비스 사이트의 생성 기록에서 확인하거나 잠시 뒤 다시 시도해 주세요. (크레딧은 이미 쓰였을 수 있어요)'

/** why Higgsfield did not take (or finish) a request: its own error field, in words the designer can act on */
export function higgsfieldProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const err = typeof o.error === 'string' ? o.error.trim() : ''
  if (!err && !o.unlim_choice) return null
  const said = err ? ` (${err.slice(0, 160)})` : ''
  if (/credit|balance|insufficient|not enough|top.?up/i.test(err) || o.billing_recovery_context) return `크레딧이 모자라요. 힉스필드 크레딧을 충전하거나 더 싼 모델을 골라 주세요.${said}`
  if (/plan|upgrade|subscri/i.test(err)) return `지금 힉스필드 플랜으로는 이 모델을 쓸 수 없어요.${said}`
  if (!err) return '힉스필드가 무제한 생성분을 쓸지 되물었어요. 다시 시도해 주세요.'
  return `힉스필드: ${err.slice(0, 240)}`
}

const HF_STOPPED: Record<string, string> = {
  failed: '서비스에서 만들기에 실패했어요. 프롬프트나 설정을 조금 바꿔 다시 시도해 주세요.',
  nsfw: '서비스가 부적절한 내용으로 판단해 결과를 막았어요. 프롬프트를 바꿔 주세요.',
  canceled: '서비스에서 만들기가 취소됐어요.',
  ip_detected: '저작권 보호 대상이 감지돼 결과가 잠겼어요. 힉스필드 사이트의 생성 기록에서 권리를 확인하면 받을 수 있어요.',
}

interface HfJob {
  id?: string
  status?: string
  results?: { rawUrl?: string; minUrl?: string } | null
}

/** follows one Higgsfield job to its full-size file URL */
export async function higgsfieldResult(r: ToolResult, rounds: number): Promise<string> {
  const p = payload(r) as { results?: HfJob[]; generation?: HfJob } | null
  const problem = higgsfieldProblem(p)
  if (problem) throw new Error(problem)
  let job = (Array.isArray(p?.results) ? p.results.find((j) => j?.id) : undefined) ?? p?.generation
  if (!job?.id) throw new Error('힉스필드가 작업을 받지 않았어요. 잠시 뒤 다시 시도해 주세요.')
  for (let i = 0; ; i++) {
    const url = job.results?.rawUrl || job.results?.minUrl
    if (job.status === 'completed' && url) return url
    const stopped = job.status ? HF_STOPPED[job.status] : undefined
    if (stopped) throw new Error(stopped)
    if (i >= rounds) throw new Error(LATE)
    const t = Date.now()
    const s = await callTool('higgsfield', 'job_status', { jobId: job.id, sync: true }, 90_000)
    failIfError(s)
    const sp = payload(s) as { generation?: HfJob; poll_after_seconds?: number } | null
    const sProblem = higgsfieldProblem(sp)
    if (sProblem) throw new Error(sProblem)
    if (sp?.generation) job = { ...sp.generation, id: sp.generation.id || job.id }
    // sync waits on the server; when it answers at once, wait as long as it asks
    if (Date.now() - t < 3000) await sleep(Math.min(20, Math.max(3, Number(sp?.poll_after_seconds) || 5)) * 1000)
  }
}

interface MgItem {
  identifier?: string
  status?: string
  results?: unknown
  failureReason?: string | null
}

const MG_DONE = /^(completed?|done|succeeded|success|ready|finished)$/i
const MG_FAILED = /fail|error|cancel|reject|block|nsfw|moderat/i
const mgUrl = (v: unknown) => valueAt(v, /^url$/i) ?? valueAt(v, /^download_?url$/i)

/** follows one Magnific creation to its full-size file URL */
export async function magnificResult(r: ToolResult, rounds: number): Promise<string> {
  const p = payload(r) as { creation?: MgItem; creations?: MgItem[]; partialFailure?: string } | null
  const id = p?.creation?.identifier ?? p?.creations?.find((c) => c?.identifier)?.identifier
  if (!id) throw new Error(p?.partialFailure ? `매그니픽: ${p.partialFailure}` : '매그니픽이 작업을 받지 않았어요. 잠시 뒤 다시 시도해 주세요.')
  for (let i = 0; i < rounds; i++) {
    const t = Date.now()
    const w = await callTool('magnific', 'creations_wait', { identifiers: [id], timeoutSeconds: 25 }, 90_000)
    failIfError(w)
    const wp = payload(w) as { results?: MgItem[]; allTerminal?: boolean } | null
    const item = wp?.results?.find((x) => x?.identifier === id) ?? wp?.results?.[0]
    const status = String(item?.status ?? '')
    if (item?.failureReason || MG_FAILED.test(status)) throw new Error(`매그니픽에서 만들지 못했어요${item?.failureReason ? `: ${item.failureReason}` : ` (${status})`}`)
    if (!(wp?.allTerminal === true || MG_DONE.test(status))) {
      if (Date.now() - t < 3000) await sleep(5000)
      continue
    }
    const direct = mgUrl(item?.results)
    if (direct) return direct
    const got = await callTool('magnific', 'creations_get', { creationIdentifier: id }, 60_000)
    failIfError(got)
    const url = mgUrl(payload(got))
    if (url) return url
    throw new Error('매그니픽에서 결과 파일 주소를 받지 못했어요.')
  }
  throw new Error(LATE)
}

/** the finished file of a generate call (rounds: ~25 s each) */
export const resultUrl = (provider: 'higgsfield' | 'magnific', r: ToolResult, rounds: number) => (provider === 'higgsfield' ? higgsfieldResult(r, rounds) : magnificResult(r, rounds))
