// The prompt helper (latest Haiku) looks at the picked reference images
// (uses the logged-in Claude account). MS_SANDBOX=<sandbox with "앱 주문 런칭"> node tests/e2e/helper-refs.mjs
import { _electron as electron } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grantAccess, toHome } from './access.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = process.env.MS_SANDBOX
grantAccess(join(sandbox, 'userdata'))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], cwd: root, env: { ...process.env, MS_PROJECTS_DIR: join(sandbox, 'projects'), MS_USER_DATA: join(sandbox, 'userdata') } })
const win = await app.firstWindow()
let failed = 0
try {
  await toHome(win)
  const p = (await win.evaluate(() => window.studio.projects.list())).find((x) => x.name === '앱 주문 런칭')
  const st = await win.evaluate((path) => window.studio.projects.open(path), p.path)
  const man = st.brief.assets.find((a) => a.character)?.file
  if (!man) throw new Error('no character asset in the sandbox project')
  const ctx = { model: 'GPT 이미지 (Codex)', lang: '영어', style: '플랫 무외곽선 캐릭터', framing: '흉상', prompt: '', projectId: st.meta.id, referenceFiles: [man] }
  const r = await win.evaluate(([c]) => window.studio.ai.askHelper(crypto.randomUUID(), '참고 이미지의 남자와 같은 옷차림과 배경색으로, 같은 또래의 여자 캐릭터를 만들고 싶어요. 영어로.', c), [ctx])
  console.log(r.text)
  // the man wears a navy jacket over a white turtleneck, on a red background
  const ok = /navy|dark blue/i.test(r.prompt ?? '') && /red/i.test(r.prompt ?? '') && /turtleneck|white/i.test(r.prompt ?? '')
  console.log(ok ? '✓' : '✗', 'the prompt carries what is in the reference (navy jacket, white turtleneck, red background)')
  if (!ok) failed++
} catch (e) {
  failed++
  console.log('✗', e.message)
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
