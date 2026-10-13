// P0-5: run Claude through the Agent SDK with the logged-in Claude Code account,
// restricted tools, an in-process app tool, and path-scoped write permission.
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { resolve, join } from 'node:path'

const workspace = resolve(process.argv[2])
const compDir = join(workspace, 'composition')
let briefCalls = 0

const studio = createSdkMcpServer({
  name: 'studio',
  version: '0.1.0',
  tools: [
    tool('get_brief', '현재 프로젝트의 브리프(출력 사양, 필수 텍스트)를 읽는다.', {}, async () => {
      briefCalls++
      return { content: [{ type: 'text', text: JSON.stringify({
        output: { width: 1920, height: 1080, duration: 3 },
        requiredTexts: [{ text: '봄 신상품 20% 할인', locked: true, timing: { mode: 'exact', at: 0.5 } }],
      }) }] }
    }),
  ],
})

const inside = (p) => p && resolve(workspace, p).startsWith(compDir + '/')
const t0 = Date.now()
const events = []
const q = query({
  prompt: process.argv[3] || 'get_brief 도구로 브리프를 읽고, composition/index.html 의 #title 텍스트를 필수 텍스트로 정확히 바꿔줘. 다른 건 건드리지 말고, 끝나면 한 줄로 보고해.',
  options: {
    cwd: workspace,
    settingSources: [],
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true },
    tools: ['Read', 'Edit', 'Write', 'Glob'],
    mcpServers: { studio },
    allowedTools: ['mcp__studio__get_brief', 'Read', 'Glob'],
    permissionMode: 'default',
    canUseTool: async (name, input) => {
      events.push(`canUseTool ${name} ${input.file_path ?? ''}`)
      if ((name === 'Edit' || name === 'Write') && inside(input.file_path)) return { behavior: 'allow', updatedInput: input }
      return { behavior: 'deny', message: '이 작업은 모션스튜디오에서 허용되지 않습니다.' }
    },
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'motion-studio/0.1.0' },
    includePartialMessages: true,
  },
})

let streamedChars = 0
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') events.push(`init model=${m.model} apiKeySource=${m.apiKeySource} tools=${m.tools.join(',')} mcp=${m.mcp_servers.map((s) => s.name + ':' + s.status).join(',')}`)
  else if (m.type === 'stream_event') { if (m.event?.delta?.text) streamedChars += m.event.delta.text.length }
  else if (m.type === 'assistant') for (const b of m.message.content) { if (b.type === 'tool_use') events.push(`tool_use ${b.name}`) }
  else if (m.type === 'result') events.push(`result ${m.subtype} turns=${m.num_turns} cost=$${m.total_cost_usd?.toFixed(4)} text=${JSON.stringify(m.result)}`)
  else if (m.type === 'rate_limit_event' || m.type?.includes('rate')) events.push(`rate ${JSON.stringify(m).slice(0, 200)}`)
}
events.push(`streamedChars=${streamedChars} briefCalls=${briefCalls} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(events.join('\n'))
