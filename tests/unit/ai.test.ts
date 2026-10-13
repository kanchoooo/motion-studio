import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'ms-ai-'))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  shell: { openExternal: async () => {} },
}))

const { findUrls, mediaUrls, saveResultMedia, importUrl } = await import('../../src/main/ai/media')
const accounts = await import('../../src/main/ai/accounts')
const { entries, payload } = await import('../../src/main/ai/catalog')

describe('generated media in tool results', () => {
  it('finds URLs in nested JSON text', () => {
    const urls = findUrls([{ type: 'text', text: JSON.stringify({ data: { images: [{ url: 'https://cdn.x.com/a/b.png?sig=1' }] }, page: 'https://x.com/help' }) }])
    expect(urls.map((u) => u.url)).toEqual(['https://cdn.x.com/a/b.png?sig=1', 'https://x.com/help'])
  })

  it('keeps media files and output-like keys, drops web pages and thumbnails', () => {
    const v = { result: { video_url: 'https://cdn.x.com/v/123', thumbnail: 'https://cdn.x.com/t.jpg?w=200', docs: 'https://x.com/docs' }, file: 'https://cdn.x.com/out.mp3' }
    expect(mediaUrls(v)).toEqual(['https://cdn.x.com/v/123', 'https://cdn.x.com/out.mp3'])
  })

  describe('saving', () => {
    let base = ''
    const server = createServer((req, res) => {
      if (req.url === '/img.png') res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.alloc(2048, 7))
      else if (req.url === '/clip') res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(Buffer.alloc(4096, 1))
      else if (req.url === '/page') res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>')
      else res.writeHead(404).end()
    })
    beforeAll(async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterAll(() => server.close())

    it('writes inline images and downloads linked files into assets/generated', async () => {
      const comp = mkdtempSync(join(tmpdir(), 'ms-comp-'))
      const saved = await saveResultMedia(comp, 'magnific', {
        content: [
          { type: 'image', data: Buffer.alloc(100, 3).toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify({ outputs: [`${base}/img.png`], video_url: `${base}/clip`, page_url: `${base}/page` }) },
        ],
      })
      expect(saved.map((s) => s.kind)).toEqual(['image', 'image', 'video'])
      for (const s of saved) {
        expect(s.file.startsWith('assets/generated/magnific-')).toBe(true)
        expect(existsSync(join(comp, s.file))).toBe(true)
      }
      expect(statSync(join(comp, saved[2].file)).size).toBe(4096)
      expect(saved[2].file.endsWith('.mp4')).toBe(true)
    })

    it('refuses non-https imports and non-media pages', async () => {
      const comp = mkdtempSync(join(tmpdir(), 'ms-comp-'))
      await expect(importUrl(comp, `${base}/img.png`, 'artlist')).rejects.toThrow(/https/)
    })
  })
})

describe('catalogue parsing', () => {
  it('reads the largest list of entries from a JSON text result', () => {
    const r = { content: [{ type: 'text', text: JSON.stringify({ meta: { total: 2 }, voices: [{ voice_id: 'v1', name: '민지' }, { voice_id: 'v2', name: '도윤' }], tags: [{ name: 'x' }] }) }] }
    expect(entries(payload(r)).map((e) => e.voice_id)).toEqual(['v1', 'v2'])
  })
})

describe('account store', () => {
  it('keeps several accounts per service, one active, and never exposes tokens', () => {
    const a = accounts.upsertAccount({ provider: 'magnific', label: '회사', tokens: { access_token: 'secret-a', token_type: 'Bearer' } })
    const b = accounts.upsertAccount({ provider: 'magnific', label: '개인', tokens: { access_token: 'secret-b', token_type: 'Bearer' } })
    expect(accounts.activeAccount('magnific')?.id).toBe(a.id)
    accounts.setActive('magnific', b.id)
    expect(accounts.activeAccount('magnific')?.label).toBe('개인')
    const pub = accounts.publicInfo()
    expect(JSON.stringify(pub)).not.toContain('secret')
    expect(pub.find((x) => x.id === b.id)?.active).toBe(true)
    accounts.removeAccount(b.id)
    expect(accounts.activeAccount('magnific')?.id).toBe(a.id)
    const file = join(userData, 'connections.json')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readFileSync(file, 'utf8')).toContain('회사')
  })
})
