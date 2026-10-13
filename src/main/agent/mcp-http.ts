// Stateless Streamable-HTTP MCP endpoint per project: /mcp/<token>.
// Claude Code (running in the PTY) connects with --mcp-config.
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildStudioServer, type ToolHooks } from './tools'

const tokens = new Map<string, string>() // token -> projectId
const byProject = new Map<string, string>()
let hooks: ToolHooks | null = null

export function setToolHooks(h: ToolHooks) {
  hooks = h
}

export function mcpTokenFor(projectId: string): string {
  let t = byProject.get(projectId)
  if (!t) {
    t = randomBytes(16).toString('hex')
    byProject.set(projectId, t)
    tokens.set(t, projectId)
  }
  return t
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/** returns true when the request was an MCP request (handled or rejected) */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/mcp\/([a-f0-9]+)$/)
  if (!m) return false
  const projectId = tokens.get(m[1])
  if (!projectId || !hooks) {
    res.writeHead(404).end()
    return true
  }
  if (req.method !== 'POST') {
    // stateless server: no SSE stream / session deletion
    res.writeHead(405, { Allow: 'POST' }).end()
    return true
  }
  try {
    const body = await readBody(req)
    const server = buildStudioServer(projectId, hooks)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e instanceof Error ? e.message : String(e) }, id: null }))
  }
  return true
}
