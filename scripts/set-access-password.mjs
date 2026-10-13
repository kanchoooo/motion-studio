#!/usr/bin/env node
// Changes the first-launch access password: stores a new salted scrypt hash in
// src/main/access.ts (the password itself never goes into the repository).
//   node scripts/set-access-password.mjs      (type the password, then Enter)
// Already unlocked computers stay unlocked; new installs ask for the new password.
import { randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'access.ts')
const rl = createInterface({ input: process.stdin, output: process.stdout })
const pw = await new Promise((r) => rl.question('새 암호: ', (a) => (rl.close(), r(a))))
const norm = pw.normalize('NFC').replace(/\s+/g, '')
if (norm.length < 4) {
  console.error('4글자 이상으로 정해 주세요.')
  process.exit(1)
}
const salt = randomBytes(16)
const hash = scryptSync(norm, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
const src = readFileSync(file, 'utf8')
  .replace(/const SALT = Buffer\.from\('[0-9a-f]+', 'hex'\)/, `const SALT = Buffer.from('${salt.toString('hex')}', 'hex')`)
  .replace(/const HASH = Buffer\.from\('[0-9a-f]+', 'hex'\)/, `const HASH = Buffer.from('${hash.toString('hex')}', 'hex')`)
writeFileSync(file, src)
console.log('암호를 바꿨어요. 다시 빌드해서 배포해 주세요.')
