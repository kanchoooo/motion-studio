#!/usr/bin/env node
// Makes node_modules contain the native packages for a packaging target, so an
// Intel Mac can also produce the Apple Silicon build (and vice versa).
//   node scripts/prepare-target.mjs --target darwin-arm64
// npm refuses to install another CPU's optional packages, so the exact versions
// are fetched with `npm pack` and unpacked next to the current ones. Nothing else
// in node_modules (or package.json / the lockfile) is touched.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ti = process.argv.indexOf('--target')
const target = ti > 0 ? process.argv[ti + 1] : `${process.platform}-${process.arch}`
const win = process.platform === 'win32'
const pkgJson = (p) => JSON.parse(readFileSync(join(root, 'node_modules', ...p.split('/'), 'package.json'), 'utf8'))
const sharpOpt = pkgJson('sharp').optionalDependencies ?? {}

const wanted = [[`@anthropic-ai/claude-agent-sdk-${target}`, pkgJson('@anthropic-ai/claude-agent-sdk').version]]
for (const name of [`@img/sharp-${target}`, `@img/sharp-libvips-${target}`]) if (sharpOpt[name]) wanted.push([name, sharpOpt[name]])

for (const [name, version] of wanted) {
  const dest = join(root, 'node_modules', ...name.split('/'))
  if (existsSync(join(dest, 'package.json')) && pkgJson(name).version === version) {
    console.log(`  ✓ ${name}@${version} (이미 있음)`)
    continue
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ms-pack-'))
  try {
    const out = execFileSync(win ? 'npm.cmd' : 'npm', ['pack', `${name}@${version}`, '--pack-destination', tmp, '--json'], { cwd: tmp, encoding: 'utf8', shell: win })
    const file = JSON.parse(out)[0].filename.replace(/^@[^/]+\//, '').replace(/\//g, '-')
    execFileSync('tar', ['-xzf', join(tmp, file), '-C', tmp])
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    renameSync(join(tmp, 'package'), dest)
    console.log(`  ↓ ${name}@${version}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
// restore node-pty's spawn-helper executable bit as postinstall would
execFileSync(process.execPath, [join(root, 'scripts', 'postinstall.mjs')], { stdio: 'inherit' })
