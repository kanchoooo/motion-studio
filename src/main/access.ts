// Access password asked once on first launch (the app is shared with friends
// only). Only a salted scrypt hash is in the source; the password itself is not.
// This keeps casual users out of a shared installer; it is not DRM: anyone who
// builds the open-source app themselves can remove it.
import { scryptSync, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { dataDir } from './paths'
import { nowIso, readJson, writeJson } from './util'

const SALT = Buffer.from('ec5365bcfbae546c85536872be296309', 'hex')
const HASH = Buffer.from('6b18556a8a10b73274a1ae1c158264da8347caf0223e975da2bbebc9daa9f2a4', 'hex')
const file = () => join(dataDir(), 'access.json')

/** spaces and Unicode composition (NFD from some keyboards) do not matter */
export const normalizePassword = (s: string) => s.normalize('NFC').replace(/\s+/g, '')

export function hasAccess(): boolean {
  return readJson<{ ok?: boolean } | null>(file(), null)?.ok === true
}

export async function unlock(password: string): Promise<boolean> {
  const h = scryptSync(normalizePassword(password), SALT, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const ok = timingSafeEqual(h, HASH)
  if (ok) writeJson(file(), { ok: true, at: nowIso() })
  // a wrong guess costs a moment
  else await new Promise((r) => setTimeout(r, 800))
  return ok
}
