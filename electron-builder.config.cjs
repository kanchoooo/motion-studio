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
// scripts/build-mac.mjs passes CSC_NAME (Developer ID from the .p12, without prefix) + CSC_KEYCHAIN
const explicit = process.env.CSC_NAME
const identity = explicit || developerId || (process.env.MS_SIGN_DEV === '1' ? appleDev : null) || null
const isDeveloperId = explicit ? !/^Apple Development/.test(explicit) : !!identity?.startsWith('Developer ID Application')
const canNotarize =
  !!identity &&
  isDeveloperId &&
  !!(process.env.APPLE_KEYCHAIN_PROFILE ||
    (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
    (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER))

if (process.platform === 'darwin') console.log(`[sign] identity: ${identity ?? '(unsigned)'} · notarize: ${canNotarize ? 'yes' : 'no'}`)

// Each installer carries only its own OS+CPU native payloads (node_modules may hold
// several after scripts/prepare-target.mjs). The CPU comes from MS_TARGET_ARCH or
// the --arm64/--x64 flag of this electron-builder run.
const arch = process.env.MS_TARGET_ARCH || (process.argv.includes('--arm64') ? 'arm64' : process.argv.includes('--x64') ? 'x64' : process.arch)
const only = (keepOs) => {
  const keep = `${keepOs}-${arch}`
  const all = ['darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'linux-arm', 'linux-x64-musl', 'linux-arm64-musl']
  return [
    ...base.files,
    ...all
      .filter((t) => t !== keep)
      .flatMap((t) => [`!**/node_modules/@anthropic-ai/claude-agent-sdk-${t}/**`, `!**/node_modules/node-pty/prebuilds/${t}/**`, `!**/node_modules/@img/sharp-${t}/**`, `!**/node_modules/@img/sharp-libvips-${t}/**`]),
  ]
}

module.exports = {
  ...base,
  win: { ...base.win, files: only('win32') },
  mac: {
    ...base.mac,
    files: only('darwin'),
    identity: identity ? identity.replace(/^(Developer ID Application|Apple Development): /, '') : null,
    hardenedRuntime: !!identity,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // keep Anthropic's own signature on the bundled Claude Code binary (it must stay unmodified)
    signIgnore: ['claude-agent-sdk-darwin-[^/]+/claude$'],
    notarize: canNotarize,
  },
}

// 관제용 판 (MS_CONSOLE=1; scripts/build-mac.mjs --console, and with every --release): the same app
// (it replaces the regular one on the console's Mac: same name, id and data folder) with the
// console's web connection built in. Its own file names and its own update file (console-mac.yml on
// the newest release, read by src/main/updater.ts); the regular builds never look at it.
if (process.env.MS_CONSOLE === '1') {
  module.exports.artifactName = 'MotionStudio-Console-${version}-${os}-${arch}.${ext}'
  module.exports.directories = { ...base.directories, output: 'release/console' }
  module.exports.publish = { provider: 'generic', url: 'https://github.com/kanchoooo/motion-studio-releases/releases/latest/download', channel: 'console' }
}
