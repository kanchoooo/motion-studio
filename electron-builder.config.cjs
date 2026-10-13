// Installer build configuration. Signing is chosen automatically:
//   1. CSC_NAME (explicit identity) if set
//   2. a "Developer ID Application" certificate in the keychain  → distributable
//   3. MS_SIGN_DEV=1 → the "Apple Development" certificate      → this Mac / testing only
//   4. otherwise unsigned (right-click → 열기 on first launch)
// Notarization runs when a Developer ID identity is used AND Apple credentials are
// in the environment: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID,
// or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.
const { execFileSync } = require('node:child_process')
const base = require('js-yaml').load(require('node:fs').readFileSync(require('node:path').join(__dirname, 'electron-builder.yml'), 'utf8'))

function identities() {
  if (process.platform !== 'darwin') return []
  try {
    return execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.match(/"(.+)"/)?.[1])
      .filter(Boolean)
  } catch {
    return []
  }
}

const ids = identities()
const developerId = ids.find((n) => n.startsWith('Developer ID Application'))
const appleDev = ids.find((n) => n.startsWith('Apple Development'))
const identity = process.env.CSC_NAME || developerId || (process.env.MS_SIGN_DEV === '1' ? appleDev : null) || null
const canNotarize =
  !!identity?.startsWith('Developer ID Application') &&
  !!((process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
    (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER))

if (process.platform === 'darwin') console.log(`[sign] identity: ${identity ?? '(unsigned)'} · notarize: ${canNotarize ? 'yes' : 'no'}`)

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    identity: identity ? identity.replace(/^(Developer ID Application|Apple Development): /, '') : null,
    hardenedRuntime: !!identity,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // keep Anthropic's own signature on the bundled Claude Code binary (it must stay unmodified)
    signIgnore: ['claude-agent-sdk-darwin-[^/]+/claude$'],
    notarize: canNotarize,
  },
}
