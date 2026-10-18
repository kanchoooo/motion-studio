// 일반 판 확인: the regular build (no MS_CONSOLE) must not contain the 관제용 판's code — the web
// connection, the results collection, the hidden start. Run after `electron-vite build`; fails
// (exit 1) when out/ has any of it. (scripts/build-mac.mjs and the CI build run it.)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MARKS = ['web-endpoint.json', 'x-ms-token', 'delete-requests', 'hidden-restart', 'web-uploads', 'ms-web-lost', 'web-file:', 'console.json', 'console-mode', 'console-bridge']
const out = join(import.meta.dirname, '..', 'out')

function* files(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(js|cjs|mjs|html)$/.test(n)) yield p
  }
}

const found = []
for (const f of files(out)) {
  const text = readFileSync(f, 'utf8')
  for (const m of MARKS) if (text.includes(m)) found.push(`${f.slice(out.length + 1)}: ${m}`)
}
if (readdirSync(join(out, 'renderer')).includes('web.html')) found.push('renderer/web.html')
if (found.length) {
  console.error(`일반 판 빌드에 관제용 판 코드가 들어 있어요 (MS_CONSOLE=1 로 빌드한 out/ 인가요?):\n  ${found.join('\n  ')}`)
  process.exit(1)
}
console.log('✓ 일반 판: 관제용 판 코드 없음')
