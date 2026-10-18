// 관제용 웹 연결: the console (the user's own dashboard on this Mac) shows Motion Studio in a
// browser. Off unless console.json says {"web": true}; Windows and other Macs never have it.
//
// A local server on 127.0.0.1 (random port). The console reads <userData>/web-endpoint.json
// (user-only, a new token every start, removed on quit) and relays the pages under its own path,
// adding the X-MS-Token header; a request without the token gets 403. Everything here is
// relative, so the relay path does not matter.
//   GET  /                 the app's screens (the renderer's web.html; a web shim stands in for the preload)
//   GET  /assets/…         the renderer's files
//   POST /api/invoke       {channel, args} → the same handlers as the window (ipc.ts)
//   POST /api/send         terminal:write / terminal:resize
//   GET  /api/events       the window's events (server-sent events)
//   POST /api/upload       raw bytes → a file the handlers can take (≤ 4 GB)
//   GET  /api/file         download (inside the projects, the collection or the uploads only)
//   GET  /preview/…        the preview server's pages (/p/… and the runtime only), sandboxed
//   GET  /api/status · POST /api/quit · POST /api/show
// Through terminal:write this is remote control of the app: the console relays it only behind
// its own IP restriction.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import { Zip, ZipPassThrough } from 'fflate'
import type { SendMessageInput } from '@shared/api'
import { collectDir } from './collect'
import { mimeOf } from './media'
import { projectsDir } from './paths'
import { previewBase } from './preview-server'
import * as projects from './projects'
import { SHARE_EXT } from './share'
import { invokeHandlers, onWebEvent, sendHandlers } from './console-bridge'
import { annotatedFrame } from './web-frame'

export interface WebHooks {
  /** Claude sessions at work and exports running (the quit and update guards) */
  status(): { busy: string[]; exporting: number }
  /** quits without asking (the caller checked) */
  quit(): void
  /** shows the window on the Mac */
  show(): void
  /** started hidden by the console and not shown since */
  hidden(): boolean
  /** before the console installs an update: null when it may (the app then restarts as it is, hidden or not) */
  prepareInstall(): string | null
}

const MAX_UPLOAD = 4 * 1024 ** 3
const MAX_JSON = 64 * 1024 ** 2
const MAC_ONLY = '로그인은 맥에서 해 주세요. (웹에서는 쓸 수 없어요)'
const NOT_ON_WEB = '웹에서는 쓸 수 없는 기능이에요.'
/** channels a browser never calls: Mac dialogs and windows, sign-ins */
const BLOCKED: Record<string, string> = {
  'app:login': MAC_ONLY,
  'ai:login': MAC_ONLY,
  'ai:artlistLogin': MAC_ONLY,
  'ai:artlistLoginDone': MAC_ONLY,
  'app:pickFiles': NOT_ON_WEB,
  'app:pickFolder': NOT_ON_WEB,
  'app:reveal': NOT_ON_WEB,
  'app:openExternal': NOT_ON_WEB,
  'app:capture': NOT_ON_WEB,
}

let server: Server | null = null
let token = ''
let port = 0
let startedAt = ''
let hooks: WebHooks | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let lastUse = 0
const clients = new Set<ServerResponse>()

export const endpointFile = () => join(app.getPath('userData'), 'web-endpoint.json')
const uploadsDir = () => join(app.getPath('userData'), 'web-uploads')
const rendererDir = () => join(import.meta.dirname, '../renderer')
export const webRunning = () => !!server
/** nobody used the web connection for this long (the hidden app's update waits for a quiet moment) */
export const webQuietFor = (ms: number) => Date.now() - lastUse >= ms

function writeEndpoint() {
  if (!server || !hooks) return
  const file = endpointFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ port, token, pid: process.pid, version: app.getVersion(), startedAt, hidden: hooks.hidden() }), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}
/** the window was shown (or hidden): the console reads it from the endpoint file */
export const refreshEndpoint = () => writeEndpoint()

export function startWeb(h: WebHooks): Promise<void> {
  if (server) return Promise.resolve()
  hooks = h
  token = randomBytes(32).toString('hex')
  startedAt = new Date().toISOString()
  cleanUploads()
  const s = createServer((req, res) => {
    route(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false, error: '요청을 처리하지 못했어요.' })
      else res.destroy()
    })
  })
  // an upload of a few GB through the relay takes its time
  s.requestTimeout = 0
  s.on('clientError', (_e, socket) => socket.destroy())
  server = s
  return new Promise((resolve, reject) => {
    s.once('error', (e) => {
      server = null
      reject(e)
    })
    s.listen(0, '127.0.0.1', () => {
      port = (s.address() as AddressInfo).port
      onWebEvent(broadcast)
      heartbeat = setInterval(() => {
        for (const c of clients) c.write(': ping\n\n')
      }, 15_000)
      try {
        writeEndpoint()
      } catch {
        /* the console finds no endpoint and says so */
      }
      resolve()
    })
  })
}

export function stopWeb() {
  if (!server) return
  onWebEvent(null)
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  for (const c of clients) c.end()
  clients.clear()
  server.close()
  server.closeAllConnections()
  server = null
  // only the file this run wrote (a newer run may have written its own)
  try {
    const f = endpointFile()
    if (existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).token === token) unlinkSync(f)
  } catch {
    /* gone already */
  }
  token = ''
}

// ---- helpers ----

function json(res: ServerResponse, code: number, body: unknown) {
  const text = toWeb(JSON.stringify(body) ?? 'null')
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function authorized(req: IncomingMessage): boolean {
  const got = req.headers['x-ms-token']
  if (typeof got !== 'string' || !token) return false
  const a = Buffer.from(got)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** preview URLs (the preview server's own port) → ./preview/… under this server (the shim makes them absolute) */
function toWeb(text: string): string {
  const base = previewBase()
  return base ? text.split(`"${base}/`).join('"./preview/') : text
}
function fromWeb(text: string): string {
  const base = previewBase()
  return base ? text.split('"./preview/').join(`"${base}/`) : text
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    n += c.length
    if (n > limit) throw new Error('too large')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const isInside = (p: string, root: string) => {
  const r = relative(root, p)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** a file name from the browser: no folders, no control characters */
export function safeUploadName(name: string | null): string {
  let n = basename(String(name ?? '').replace(/\\/g, '/'))
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/:]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  if (n.length > 180) {
    const ext = extname(n).slice(0, 20)
    n = n.slice(0, 160 - ext.length) + ext
  }
  return n || 'file'
}

/** uploads older than a day are gone (the handlers copy what they keep into the project) */
function cleanUploads() {
  try {
    const dir = uploadsDir()
    if (!existsSync(dir)) return
    for (const d of readdirSync(dir)) {
      const p = join(dir, d)
      if (Date.now() - statSync(p).mtimeMs > 24 * 3600_000) rmSync(p, { recursive: true, force: true })
    }
  } catch {
    /* next start */
  }
}

// ---- routes ----

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' }).end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const get = req.method === 'GET' || req.method === 'HEAD'
  if (get && (path === '/' || path === '/index.html')) return sendApp(req, res)
  if (get && path.startsWith('/assets/')) return sendAsset(req, res, path)
  if (get && path.startsWith('/preview/')) return proxyPreview(req, res, url)
  if (get && path === '/api/events') return events(req, res)
  if (get && path === '/api/status') return json(res, 200, status())
  if (get && path === '/api/file') return download(req, res, url.searchParams.get('path'))
  if (req.method === 'POST') {
    // only what a page of this app sends: a cross-site form or a sandboxed preview cannot
    // (a JSON or octet-stream body needs a CORS preflight, which this server never answers)
    const type = String(req.headers['content-type'] ?? '')
    if (path === '/api/upload') {
      if (!/^application\/octet-stream/i.test(type)) return json(res, 415, { ok: false, error: 'application/octet-stream' })
      return upload(req, res, url.searchParams.get('name'))
    }
    if (!/^application\/json/i.test(type)) return json(res, 415, { ok: false, error: 'application/json' })
    let body: Record<string, unknown>
    try {
      const text = await readBody(req, MAX_JSON)
      body = text.trim() ? JSON.parse(fromWeb(text)) : {}
    } catch {
      return json(res, 400, { ok: false, error: '요청을 읽지 못했어요.' })
    }
    if (path === '/api/invoke') return invoke(res, body)
    if (path === '/api/send') return send(res, body)
    if (path === '/api/quit') return quit(res, body)
    if (path === '/api/show') {
      hooks?.show()
      return json(res, 200, { ok: true })
    }
  }
  json(res, 404, { ok: false, error: 'not found' })
}

function status() {
  const s = hooks?.status() ?? { busy: [], exporting: 0 }
  return { version: app.getVersion(), pid: process.pid, hidden: hooks?.hidden() ?? false, busy: s.busy, exporting: s.exporting }
}

// the app's own page: the same rules as in the window (Electron's CSP), the preview is under ./preview
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; frame-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'"

function sendApp(req: IncomingMessage, res: ServerResponse) {
  // web.html: the renderer with the web shim first (src/renderer/web.html)
  const file = join(rendererDir(), 'web.html')
  if (!existsSync(file)) return json(res, 404, { ok: false, error: 'not built' })
  const html = readFileSync(file)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': APP_CSP, 'X-Content-Type-Options': 'nosniff', 'Content-Length': html.length })
  res.end(req.method === 'HEAD' ? undefined : html)
}

function sendAsset(req: IncomingMessage, res: ServerResponse, path: string) {
  const root = join(rendererDir(), 'assets')
  const file = join(rendererDir(), decodeURIComponent(path))
  if (!isInside(file, root) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { ok: false, error: 'not found' })
  // hashed names: a new build has new names
  sendFile(req, res, file, { 'Cache-Control': 'public, max-age=31536000, immutable' })
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, extra: Record<string, string>) {
  const size = statSync(file).size
  const headers: Record<string, string | number> = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...extra }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range && (range[1] || range[2])) {
    const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10))
    const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

async function invoke(res: ServerResponse, body: Record<string, unknown>) {
  const channel = String(body.channel ?? '')
  const args = Array.isArray(body.args) ? body.args : []
  const fn = invokeHandlers.get(channel)
  if (!fn) return json(res, 404, { ok: false, error: `알 수 없는 요청이에요 (${channel.slice(0, 60)}).` })
  if (BLOCKED[channel]) return json(res, 200, { ok: false, error: BLOCKED[channel] })
  lastUse = Date.now()
  try {
    // a shared project file is made for download (the window asks where to save it)
    if (channel === 'projects:exportShare' && !args[2]) {
      const name = safeUploadName(`${projects.state(String(args[0])).meta.name}.${SHARE_EXT}`)
      args[2] = join(uploadsDir(), randomBytes(8).toString('hex'), name)
      mkdirSync(join(String(args[2]), '..'), { recursive: true })
    }
    if (channel === 'projects:importShare' && !args[0]) throw new Error('공유 파일을 올려 주세요.')
    // the console's 업데이트 확인: never in the middle of Claude's work or an export
    if (channel === 'app:installUpdate') {
      const why = hooks?.prepareInstall()
      if (why) throw new Error(why)
    }
    // marks on the canvas: the app draws the frame (a browser cannot capture the preview)
    if (channel === 'agent:send') {
      const input = args[0] as SendMessageInput
      if (input?.marks?.length && !input.annotatedFrame) {
        const t = input.time ?? input.marks[0].time ?? 0
        input.annotatedFrame = await annotatedFrame(input.projectId, input.marks, t).catch(() => undefined)
      }
    }
    const result = await fn(...args)
    json(res, 200, { ok: true, result })
  } catch (e) {
    json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

function send(res: ServerResponse, body: Record<string, unknown>) {
  const fn = sendHandlers.get(String(body.channel ?? ''))
  if (!fn) return json(res, 404, { ok: false, error: 'not found' })
  lastUse = Date.now()
  try {
    fn(...(Array.isArray(body.args) ? body.args : []))
  } catch {
    /* a session that is gone */
  }
  json(res, 200, { ok: true })
}

function quit(res: ServerResponse, body: Record<string, unknown>) {
  const s = hooks?.status() ?? { busy: [], exporting: 0 }
  if ((s.busy.length || s.exporting) && body.force !== true) return json(res, 200, { ok: false, busy: s.busy, exporting: s.exporting })
  json(res, 200, { ok: true })
  setTimeout(() => hooks?.quit(), 100)
}

function events(req: IncomingMessage, res: ServerResponse) {
  req.socket.setNoDelay(true)
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.write(': connected\n\n')
  clients.add(res)
  const drop = () => clients.delete(res)
  req.on('close', drop)
  res.on('close', drop)
}

function broadcast(channel: string, payload: unknown) {
  if (!clients.size) return
  const msg = `event: ${channel}\ndata: ${toWeb(JSON.stringify(payload ?? null))}\n\n`
  for (const c of clients) {
    // a browser that stopped reading is dropped (it reconnects and reloads)
    if (c.writableLength > 32 * 1024 ** 2) {
      clients.delete(c)
      c.destroy()
      continue
    }
    c.write(msg)
  }
}

async function upload(req: IncomingMessage, res: ServerResponse, name: string | null) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) return json(res, 413, { ok: false, error: '4GB보다 큰 파일은 올릴 수 없어요.' })
  lastUse = Date.now()
  const dir = join(uploadsDir(), randomBytes(8).toString('hex'))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, safeUploadName(name))
  let n = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length
      lastUse = Date.now()
      cb(n > MAX_UPLOAD ? new Error('too large') : null, chunk)
    },
  })
  try {
    await pipeline(req, count, createWriteStream(file, { mode: 0o600 }))
    json(res, 200, { ok: true, path: file, bytes: n })
  } catch {
    rmSync(dir, { recursive: true, force: true })
    if (!res.headersSent) json(res, n > MAX_UPLOAD ? 413 : 400, { ok: false, error: n > MAX_UPLOAD ? '4GB보다 큰 파일은 올릴 수 없어요.' : '파일을 받지 못했어요.' })
  }
}

/** a file (or a folder, as a zip) inside the projects, the collection or the uploads */
async function download(req: IncomingMessage, res: ServerResponse, raw: string | null) {
  const target = raw && isAbsolute(raw) ? real(raw.normalize('NFC')) ?? real(raw) : null
  const roots = [projectsDir(), collectDir(), uploadsDir()].filter((r): r is string => !!r).map(real).filter((r): r is string => !!r)
  if (!target || !roots.some((r) => isInside(target, r))) return json(res, 404, { ok: false, error: '내려받을 수 없는 파일이에요.' })
  const st = statSync(target)
  if (st.isFile()) return sendFile(req, res, target, { 'Cache-Control': 'no-store', 'Content-Disposition': disposition(basename(target)) })
  if (!st.isDirectory()) return json(res, 404, { ok: false, error: '내려받을 수 없는 파일이에요.' })
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': disposition(`${basename(target)}.zip`) })
  if (req.method === 'HEAD') return void res.end()
  await zipFolder(res, target)
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile()) yield p
  }
}

async function zipFolder(res: ServerResponse, dir: string) {
  let wait: Promise<void> | null = null
  const zip = new Zip((err, chunk, final) => {
    if (err) return void res.destroy()
    if (!res.write(chunk) && !wait) wait = new Promise((r) => res.once('drain', () => ((wait = null), r())))
    if (final) res.end()
  })
  const top = basename(dir)
  for (const f of walk(dir)) {
    if (res.destroyed) return
    const entry = new ZipPassThrough(`${top}/${relative(dir, f).split(sep).join('/')}`)
    zip.add(entry)
    for await (const chunk of createReadStream(f) as AsyncIterable<Buffer>) {
      entry.push(chunk)
      if (wait) await wait
      if (res.destroyed) return
    }
    entry.push(new Uint8Array(0), true)
  }
  zip.end()
}

// ---- the preview ----
// Only its pages (/p/<token>/…) and the runtime; never the MCP or the permission hooks. The pages
// are sandboxed (an opaque origin: a composition cannot reach the app's page or the API through
// the relay); fonts and fetches from that origin need the CORS header.
const RUNTIME = new Set(['/__ms/hf-runtime.js', '/__ms/player.js'])

function proxyPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  // url.pathname is normalized (no ../): what is checked is what is asked
  const sub = url.pathname.slice('/preview'.length)
  if (!/^\/p\/[a-f0-9]+\//.test(sub) && !RUNTIME.has(sub)) return json(res, 404, { ok: false, error: 'not found' })
  const base = previewBase()
  if (!base) return json(res, 503, { ok: false, error: 'no preview' })
  const headers: Record<string, string> = {}
  for (const h of ['range', 'if-range', 'accept']) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string
  const up = httpRequest({ host: '127.0.0.1', port: new URL(base).port, method: req.method, path: sub + url.search, headers }, (pres) => {
    const out: Record<string, string | string[]> = {}
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
      const v = pres.headers[h]
      if (v !== undefined) out[h] = v as string
    }
    Object.assign(out, { 'Cache-Control': 'no-store', 'Content-Security-Policy': 'sandbox allow-scripts', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
    const code = pres.statusCode ?? 502
    if (code === 200 && /text\/html/i.test(String(pres.headers['content-type'] ?? '')) && req.method !== 'HEAD') {
      // the runtime the preview server puts in a page is at its root: here it is under /preview/
      const chunks: Buffer[] = []
      pres.on('data', (c: Buffer) => chunks.push(c))
      pres.on('end', () => {
        const up = '../'.repeat(sub.split('/').length - 2)
        const html = Buffer.from(Buffer.concat(chunks).toString('utf8').split('<script src="/__ms/hf-runtime.js"></script>').join(`<script src="${up}__ms/hf-runtime.js"></script>`))
        res.writeHead(200, { ...out, 'content-length': String(html.length) })
        res.end(html)
      })
      pres.on('error', () => res.destroy())
      return
    }
    res.writeHead(code, out)
    pres.pipe(res)
  })
  up.on('error', () => (res.headersSent ? res.destroy() : json(res, 502, { ok: false, error: 'preview' })))
  res.on('close', () => up.destroy())
  up.end()
}
