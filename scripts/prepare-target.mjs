#!/usr/bin/env node
// Makes node_modules contain the native packages for a packaging target, so an
// Intel Mac can also produce the Apple Silicon build (and vice versa).
//   node scripts/prepare-target.mjs --target darwin-arm64
// npm only installs optional platform packages for the current machine; this
// adds the target's ones without touching package.json / the lockfile.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ti = process.argv.indexOf('--target')
const target = ti > 0 ? process.argv[ti + 1] : `${process.platform}-${process.arch}`
const [os, cpu] = target.split('-')
const version = (p) => JSON.parse(readFileSync(join(root, 'node_modules', ...p.split('/'), 'package.json'), 'utf8')).version
const sharp = JSON.parse(readFileSync(join(root, 'node_modules', 'sharp', 'package.json'), 'utf8')).optionalDependencies

const pkgs = [`@anthropic-ai/claude-agent-sdk-${target}@${version('@anthropic-ai/claude-agent-sdk')}`]
for (const name of [`@img/sharp-${target}`, `@img/sharp-libvips-${target}`]) if (sharp[name]) pkgs.push(`${name}@${sharp[name]}`)

console.log(`[${target}] ${pkgs.join(' ')}`)
const r = spawnSync('npm', ['install', '--no-save', '--ignore-scripts', `--os=${os}`, `--cpu=${cpu}`, ...pkgs], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
// --ignore-scripts skipped our postinstall; restore node-pty's spawn-helper bit
spawnSync(process.execPath, [join(root, 'scripts', 'postinstall.mjs')], { stdio: 'inherit' })
process.exit(r.status ?? 0)
