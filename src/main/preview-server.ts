// Local HTTP server for the in-app preview. Binds to 127.0.0.1 on a random
// port; each project is reachable only under its own random token.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, normalize, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { handleMcp } from './agent/mcp-http'
import { hyperframes } from './paths'
import { mimeOf } from './media'

const roots = new Map<string, string>() // token -> absolute folder
const tokenOf = new Map<string, string>() // folder -> token
let base = ''

export function serveFolder(folder: string): string {
  let token = tokenOf.get(folder)
  if (!token) {
    token = randomBytes(12).toString('hex')
    tokenOf.set(folder, token)
    roots.set(token, folder)
  }
  return `${base}/p/${token}/`
}

export const previewBase = () => base

function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const size = statSync(file).size
  const headers: Record<string, string | number> = {
    'Content-Type': mimeOf(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : 0
    const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

/** a request error must never reach Electron's main-process error dialog */
function handle(req: IncomingMessage, res: ServerResponse): void {
  try {
    serve(req, res)
  } catch {
    if (!res.headersSent) res.writeHead(400).end()
    else res.destroy()
  }
}

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = decodeURIComponent(url.pathname)
  if (path.startsWith('/mcp/')) {
    void handleMcp(req, res, path)
    return
  }
  if (path === '/__ms/player.js') return sendFile(req, res, hyperframes.playerScript())
  if (path === '/__ms/hf-runtime.js') return sendFile(req, res, hyperframes.runtimeScript())
  const m = path.match(/^\/p\/([a-f0-9]+)\/(.*)$/)
  const root = m ? roots.get(m[1]) : undefined
  if (!m || !root) {
    res.writeHead(404).end()
    return
  }
  const rel = m[2] || 'index.html'
  const abs = normalize(join(root, rel))
  if (abs !== root && !abs.startsWith(root + sep)) {
    res.writeHead(403).end()
    return
  }
  if (!existsSync(abs) || statSync(abs).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  // The editor's iframe is cross-origin to the app shell, so the HyperFrames
  // runtime can't be injected from outside: serve it inside the page instead.
  if (url.searchParams.has('ms-preview') && abs.endsWith('.html')) {
    const html = readFileSync(abs, 'utf8')
    const tag = '<script src="/__ms/hf-runtime.js"></script>'
    const out = html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(out)
    return
  }
  sendFile(req, res, abs)
}

export function startPreviewServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer(handle)
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve(base)
    })
  })
}
