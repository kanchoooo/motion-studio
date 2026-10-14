// 소재 > AI 웹 수집: Claude (the designer's own login, print mode, only WebSearch and
// WebFetch) looks up the advertised company / brand and lists what it found with the
// source of each: the official logo, product and service images, brand colours, key
// facts and slogans. The app downloads the images itself (https, image types only,
// size-limited) into .studio/collect/, so the designer sees local files. The designer
// throws away what they do not want; what is left goes into the brief (images → assets,
// colours → brand colours, facts / copy → brand notes).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { CollectItem } from '@shared/api'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import { dataDir } from '../paths'
import { newId, readJson, writeJson } from '../util'

export const COLLECT_SYSTEM = `너는 모션스튜디오의 "AI 웹 수집" 담당이다. 광고 디자이너가 만들 광고의 회사·브랜드에 대해 웹에서 쓸 만한 자료를 모아 정리한다. 도구는 WebSearch와 WebFetch뿐이다.

찾는 순서
1. 공식 출처를 먼저 찾는다: 공식 홈페이지, 공식 보도자료·뉴스룸, 브랜드 가이드·미디어 킷, 앱스토어·플레이스토어 페이지, 공식 SNS 소개. 그다음 신뢰할 만한 기사와 위키백과.
2. 공식 페이지를 WebFetch로 열어 실제로 본 내용만 쓴다. 이미지 주소는 페이지에서 직접 확인한 것만(og:image, img src, 미디어 킷 다운로드 링크). 주소를 지어내지 않는다.

모을 것 (각 항목에 출처 페이지 주소)
- logo: 공식 로고 이미지 파일 주소(가능하면 SVG·PNG, 투명 배경, 가장 큰 크기). 1~3개.
- image: 제품·서비스·매장·앱 화면·캠페인 비주얼 이미지 파일 주소. 광고에 쓸 만한 깔끔한 것 위주로 최대 10개. 아이콘·작은 썸네일·사람 얼굴 위주 사진·다른 회사 로고는 뺀다.
- color: 브랜드 대표 색(#RRGGBB). 브랜드 가이드나 공식 사이트 CSS·로고에서 확인한 것만. 최대 5개.
- fact: 광고에 쓸 만한 핵심 사실 한 줄씩(무엇을 하는 회사·제품인지, 출시일, 수치, 수상, 특징). 한국어로. 최대 8개.
- copy: 공식 슬로건·캐치프레이즈·캠페인 문구. 원문 그대로. 최대 5개.

디자이너가 원하는 방향(초점)이 주어지면 그쪽을 우선한다.

답은 아래 JSON 하나만, \`\`\`json 코드 블록 안에 쓴다. 다른 설명은 쓰지 않는다.
{"summary":"한국어 두세 문장 요약","items":[{"type":"logo|image|color|fact|copy","title":"짧은 한국어 이름","url":"이미지 파일 주소(logo·image만)","hex":"#RRGGBB(color만)","text":"내용(fact·copy만)","source":"출처 페이지 주소"}]}`

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }
const MAX_BYTES = 15 * 1024 * 1024

const collectDir = (projectDir: string) => join(projectDir, '.studio', 'collect')
const listFile = (projectDir: string) => join(collectDir(projectDir), 'items.json')

export interface CollectResult {
  summary: string
  items: CollectItem[]
  at: string
  query: { brand: string; focus: string }
}

export const listCollected = (projectDir: string) => readJson<CollectResult | null>(listFile(projectDir), null)
export const saveCollected = (projectDir: string, r: CollectResult) => writeJson(listFile(projectDir), r)

/** the JSON block of Claude's answer */
export function parseCollect(text: string): { summary: string; items: Omit<CollectItem, 'id' | 'file'>[] } {
  const block = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let raw: { summary?: unknown; items?: unknown }
  try {
    raw = JSON.parse(block) as typeof raw
  } catch {
    throw new Error('수집 결과를 읽지 못했어요. 다시 시도해 주세요.')
  }
  const str = (v: unknown, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ type: str(x.type, 10) as CollectItem['type'], title: str(x.title, 80), url: str(x.url, 2000), hex: str(x.hex, 9), text: str(x.text, 600), source: str(x.source, 2000) }))
    .filter((x) => {
      if (x.type === 'logo' || x.type === 'image') return /^https:\/\//i.test(x.url)
      if (x.type === 'color') return /^#[0-9a-f]{6}$/i.test(x.hex)
      return (x.type === 'fact' || x.type === 'copy') && !!x.text
    })
    .map((x) => ({ type: x.type, title: x.title || (x.type === 'color' ? x.hex : ''), ...(x.url ? { url: x.url } : {}), ...(x.hex ? { hex: x.hex.toUpperCase() } : {}), ...(x.text ? { text: x.text } : {}), ...(/^https?:\/\//i.test(x.source) ? { source: x.source } : {}) }))
  return { summary: str(raw.summary, 600), items }
}

/** one image from the web into the project (null when it is not a usable image) */
async function download(url: string, folder: string, id: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } })
    if (!r.ok || !r.url.startsWith('https://')) return null
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = IMAGE_TYPES[type] ?? (/\.svg(\?|$)/i.test(url) && type === 'text/plain' ? 'svg' : undefined)
    if (!ext) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_BYTES || buf.length < 200) return null
    if (ext === 'svg') {
      if (!/<svg[\s>]/i.test(buf.toString('utf8', 0, 4096))) return null
    } else {
      // a real picture, not a 1×1 tracker or an icon
      const m = await sharp(buf).metadata()
      if (!m.width || !m.height || Math.max(m.width, m.height) < 120) return null
    }
    const file = `${id}.${ext}`
    writeFileSync(join(folder, file), buf)
    return file
  } catch {
    return null
  }
}

/** the readable progress line for a tool Claude is using */
function progressLine(name: string, input: Record<string, unknown>): string | null {
  if (name === 'WebSearch' && typeof input.query === 'string') return `검색: ${input.query}`
  if (name === 'WebFetch' && typeof input.url === 'string') {
    try {
      return `읽는 중: ${new URL(input.url).hostname}`
    } catch {
      return '페이지를 읽는 중'
    }
  }
  return null
}

let running: { kill(): void } | null = null
export const cancelCollect = () => running?.kill()

/** looks up the brand on the web and keeps what it found (images already downloaded) */
export async function collectBrand(projectDir: string, query: { brand: string; focus: string }, onProgress: (line: string) => void): Promise<CollectResult> {
  const brand = query.brand.trim()
  if (!brand) throw new Error('회사나 브랜드 이름을 적어 주세요.')
  const cwd = join(dataDir(), 'web-collect')
  mkdirSync(cwd, { recursive: true })
  const input = [`[회사·브랜드] ${brand}`, query.focus.trim() ? `[원하는 방향] ${query.focus.trim()}` : '', '이 회사·브랜드의 광고에 쓸 자료를 모아 주세요.'].filter(Boolean).join('\n')
  const args = [
    '-p',
    input,
    '--model',
    'sonnet',
    '--effort',
    'medium',
    // web only: nothing on this computer can be read or run
    '--tools',
    'WebSearch,WebFetch',
    '--allowedTools',
    'WebSearch,WebFetch',
    '--system-prompt',
    COLLECT_SYSTEM,
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ]
  onProgress('Claude가 웹에서 찾기 시작했어요')
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(claudeBinary(), args, { cwd, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    running = { kill: () => child.kill() }
    const limit = setTimeout(() => child.kill(), 8 * 60_000)
    let rest = ''
    let result: { result?: string; is_error?: boolean } | null = null
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      rest += d.toString('utf8')
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        let ev: { type?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] }; result?: string; is_error?: boolean }
        try {
          ev = JSON.parse(line) as typeof ev
        } catch {
          continue
        }
        if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) if (c.type === 'tool_use' && c.name) {
          const p = progressLine(c.name, c.input ?? {})
          if (p) onProgress(p)
        }
        if (ev.type === 'result') result = ev
      }
    })
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString('utf8')).slice(-2000)))
    child.on('close', () => {
      clearTimeout(limit)
      running = null
      if (!result?.result || result.is_error) {
        const why = result?.result ?? err
        return reject(new Error(/login|log in|auth/i.test(why) ? 'Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.' : result ? `수집하지 못했어요. ${why.slice(0, 200)}` : '수집을 멈췄어요.'))
      }
      resolve(result.result)
    })
  })
  const parsed = parseCollect(text)
  onProgress(`찾은 자료 ${parsed.items.length}개 · 이미지를 받는 중`)
  // a new collection replaces the last one
  const folder = collectDir(projectDir)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  const items: CollectItem[] = []
  await Promise.all(
    parsed.items.map(async (x) => {
      const id = newId().slice(0, 10)
      if (x.type === 'logo' || x.type === 'image') {
        const file = await download(x.url!, folder, id)
        if (file) items.push({ ...x, id, file: `.studio/collect/${file}` })
      } else items.push({ ...x, id })
    }),
  )
  const order = ['logo', 'image', 'color', 'copy', 'fact']
  items.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
  const out: CollectResult = { summary: parsed.summary, items, at: new Date().toISOString(), query: { brand, focus: query.focus.trim() } }
  saveCollected(projectDir, out)
  onProgress(`정리했어요 · ${items.length}개`)
  return out
}

/** the designer threw an item away */
export function dropCollected(projectDir: string, ids: string[]): CollectResult | null {
  const r = listCollected(projectDir)
  if (!r) return null
  for (const it of r.items) if (ids.includes(it.id) && it.file && existsSync(join(projectDir, it.file))) rmSync(join(projectDir, it.file), { force: true })
  const next = { ...r, items: r.items.filter((x) => !ids.includes(x.id)) }
  saveCollected(projectDir, next)
  return next
}
