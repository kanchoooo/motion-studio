// A stand-in for the Anthropic API (tests only, nothing leaves the computer): answers Claude Code's
// requests on a fake key with a short reply and known token counts, or with the API's own error for
// credits that ran out. mode: 'ok' | 'credit' | 'auth'. Every request is kept in `requests`.
import { createServer } from 'node:http'

export const USAGE = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, output_tokens: 500, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0 } }
const CREDIT = { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }
const AUTH = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }

export function startMock({ key, reply = '확인했어요.', model = 'claude-opus-5-5' } = {}) {
  const state = { mode: 'ok', requests: [] }
  let n = 0
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {}
      const auth = req.headers['x-api-key'] ?? String(req.headers.authorization ?? '').replace(/^Bearer /, '')
      state.requests.push({ method: req.method, url: req.url, key: auth === key ? 'ok' : auth ? 'other' : 'none', stream: !!body.stream, model: body.model })
      const json = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'request-id': `req_${++n}` }).end(JSON.stringify(obj))
      const url = req.url ?? ''
      if (url.startsWith('/v1/models')) return auth === key ? json(200, { data: [{ id: model, type: 'model' }], has_more: false }) : json(401, AUTH)
      if (url.startsWith('/v1/messages/count_tokens')) return json(200, { input_tokens: 100 })
      if (!url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'not here' } })
      if (auth !== key || state.mode === 'auth') return json(401, AUTH)
      if (state.mode === 'credit') return json(400, CREDIT)
      const id = `msg_test_${++n}`
      const m = body.model || model
      if (!body.stream) return json(200, { id, type: 'message', role: 'assistant', model: m, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE })
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': `req_${n}` })
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      ev('message_start', { message: { id, type: 'message', role: 'assistant', model: m, content: [], stop_reason: null, stop_sequence: null, usage: { ...USAGE, output_tokens: 1 } } })
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } })
      ev('content_block_stop', { index: 0 })
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } })
      ev('message_stop', {})
      res.end()
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => server.close(r)) })),
  )
}
