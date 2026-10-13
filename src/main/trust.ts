// Claude Code remembers folder trust in its global config (~/.claude.json →
// projects[path].hasTrustDialogAccepted), and a trusted folder covers every
// folder below it. Motion Studio only READS this to know whether the designer
// still has to answer the trust prompt; it never writes Claude's config.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function claudeConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR
  if (dir && existsSync(join(dir, '.claude.json'))) return join(dir, '.claude.json')
  return join(homedir(), '.claude.json')
}

function trustedPaths(): Set<string> {
  try {
    const cfg = JSON.parse(readFileSync(claudeConfigPath(), 'utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> }
    return new Set(Object.entries(cfg.projects ?? {}).filter(([, v]) => v?.hasTrustDialogAccepted).map(([k]) => resolve(k).normalize('NFC')))
  } catch {
    return new Set()
  }
}

/** true when the folder or any of its parents has been trusted in Claude Code */
export function isTrusted(folder: string): boolean {
  const trusted = trustedPaths()
  let dir: string
  try {
    dir = realpathSync(folder)
  } catch {
    dir = resolve(folder)
  }
  for (let i = 0; i < 40; i++) {
    if (trusted.has(dir.normalize('NFC')) || trusted.has(resolve(folder).normalize('NFC'))) return true
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return false
}
