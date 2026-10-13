import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'ms-access-'))
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => userData } }))
const { hasAccess, normalizePassword, unlock } = await import('../../src/main/access')

describe('access password', () => {
  it('ignores spaces and Unicode composition', () => {
    expect(normalizePassword(' 가 나\t다 ')).toBe('가나다')
    expect(normalizePassword('한'.normalize('NFD'))).toBe('한')
  })

  it('rejects a wrong password and stays locked', async () => {
    expect(await unlock('틀린 암호')).toBe(false)
    expect(hasAccess()).toBe(false)
  })

  // the real password is not in the repository: MS_ACCESS_PASSWORD=… npx vitest run
  it.skipIf(!process.env.MS_ACCESS_PASSWORD)('accepts the real password (also with spaces) and remembers it', async () => {
    const pw = process.env.MS_ACCESS_PASSWORD!
    expect(await unlock(` ${[...pw].join(' ')} `.normalize('NFD'))).toBe(true)
    expect(hasAccess()).toBe(true)
  })
})
