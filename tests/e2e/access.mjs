// Test runs skip the first-launch password by marking the sandbox profile as
// already unlocked (the password itself is not stored in the repository).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function grantAccess(userDataDir) {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'access.json'), JSON.stringify({ ok: true, at: new Date().toISOString() }))
}

/** past the environment check to Home (a fresh profile stops there while the workspace is not trusted) */
export async function toHome(win) {
  const home = win.getByText('브리프를 정리하고 Claude와 대화하면서 영상을 만들어요.')
  const start = win.getByRole('button', { name: '시작하기' })
  await Promise.race([home.waitFor({ timeout: 90000 }), start.and(win.locator(':enabled')).waitFor({ timeout: 90000 })])
  if (!(await home.isVisible())) await start.click()
  await home.waitFor({ timeout: 20000 })
}
