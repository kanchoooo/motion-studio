// One environment for every Claude Code process the app starts (live sessions,
// sign-in, status checks), so they all use the same keychain sign-in.
//
// Known ways the sign-in "disappeared" before (관제센터 notes, Electron issues):
//  - CLAUDE_CODE_OAUTH_TOKEN in the environment overrides the keychain login, and
//    that long-lived token is inference-only, so Remote Control is refused.
//  - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN switch Claude Code to API billing.
//  - A parent Claude Code session's CLAUDE_CODE_* markers turn transcripts off.
// None of these are passed on; CLAUDE_CONFIG_DIR is kept so a custom config
// folder (and its keychain entry) stays the same one the user signed in with.
const DROP = /^(CLAUDE|ANTHROPIC_)/

export function claudeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    if (DROP.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue
    if (k === 'CI' || k === 'NO_COLOR' || k === 'TERM_PROGRAM' || k === 'ELECTRON_RUN_AS_NODE') continue
    env[k] = v
  }
  // the app ships its own Claude Code: it never updates the one installed on the computer (an update
  // started from a session failed half-way once and left the computer's own `claude` broken)
  env.DISABLE_AUTOUPDATER = '1'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  if (process.platform !== 'win32' && !env.LANG) env.LANG = 'ko_KR.UTF-8'
  return { ...env, ...extra }
}

/** credential-related variables present in the app's own environment (reported, never used) */
export function ignoredCredentialVars(): string[] {
  return ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter((k) => process.env[k])
}
