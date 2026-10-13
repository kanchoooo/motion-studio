#!/usr/bin/env node
// npm strips the executable bit from node-pty's prebuilt spawn-helper on macOS,
// which makes every PTY spawn fail with "posix_spawnp failed". Restore it for
// both Intel and Apple Silicon so any developer machine works after install.
import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const arch of ['darwin-x64', 'darwin-arm64']) {
  const helper = join(root, 'node_modules', 'node-pty', 'prebuilds', arch, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
