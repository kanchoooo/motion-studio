// The HyperFrames registry copy inside the app: registry URLs map to its files, the search
// finds looks in plain English, and `hyperframes add` installs from it with no network.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))
const { registryItems, searchRegistry, stems } = await import('../../src/main/registry')
const { registry, hyperframes } = await import('../../src/main/paths')
const { posixShim } = await import('../../src/main/agent/cliShims')

const dir = registry.dir()
const hook = join(dir, 'offline-fetch.mjs')
const haveCopy = existsSync(join(dir, 'mirror', 'registry', 'registry.json'))

describe('registry URLs → the copy', () => {
  it('answers raw GitHub registry paths (any ref) and the CDN assets, nothing else', async () => {
    const { mirrorFile } = await import(pathToFileURL(hook).href)
    const root = mkdtempSync(join(tmpdir(), 'ms-reg-'))
    mkdirSync(join(root, 'registry', 'components', 'confetti'), { recursive: true })
    writeFileSync(join(root, 'registry', 'components', 'confetti', 'confetti.html'), '<div></div>')
    mkdirSync(join(root, 'static.heygen.ai', 'x'), { recursive: true })
    writeFileSync(join(root, 'static.heygen.ai', 'x', 'a b.jpg'), 'jpg')
    expect(mirrorFile('https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/components/confetti/confetti.html', root)).toBe(join(root, 'registry', 'components', 'confetti', 'confetti.html'))
    expect(mirrorFile('https://raw.githubusercontent.com/heygen-com/hyperframes/v0.8.157/registry/components/confetti/confetti.html', root)).toBeTruthy()
    expect(mirrorFile('https://static.heygen.ai/x/a%20b.jpg', root)).toBe(join(root, 'static.heygen.ai', 'x', 'a b.jpg'))
    expect(mirrorFile('https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/components/missing.html', root)).toBeNull()
    expect(mirrorFile('https://raw.githubusercontent.com/someone/else/main/registry/components/confetti/confetti.html', root)).toBeNull()
    expect(mirrorFile('https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/%2e%2e/%2e%2e/etc/passwd', root)).toBeNull()
    expect(mirrorFile('http://static.heygen.ai/x/a%20b.jpg', root)).toBeNull()
  })
})

describe('search', () => {
  it('stems plain English', () => {
    expect(stems('Falling cherry-blossom petals, glowing')).toEqual(['fall', 'cherry', 'blossom', 'petal', 'glow'])
  })
  it.runIf(haveCopy)('finds looks the designer would name, with pictures where the registry has them', () => {
    expect(registryItems().length).toBeGreaterThan(400)
    expect(searchRegistry('confetti burst')[0].name).toBe('confetti')
    expect(searchRegistry('film grain texture').map((i) => i.name)).toContain('grain-overlay')
    expect(searchRegistry('kinetic typography', { kind: 'component' }).every((i) => i.kind === 'component')).toBe(true)
    expect(searchRegistry('liquid glass notification')[0].preview).toMatch(/\.jpg$/)
    expect(searchRegistry('')).toEqual([])
  })
})

describe.runIf(haveCopy)('hyperframes add from the copy', () => {
  it('installs with the network shut off and leaves the clipboard alone', () => {
    const proj = mkdtempSync(join(tmpdir(), 'ms-add-'))
    writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }))
    // any request the copy does not answer fails
    const offline = join(proj, 'offline.mjs')
    writeFileSync(offline, `globalThis.fetch = async (u) => { throw new Error('network used: ' + (u?.url ?? u)) }\n`)
    const home = mkdtempSync(join(tmpdir(), 'ms-home-')) // no registry cache from earlier runs
    const env = { ...process.env, HOME: home, USERPROFILE: home, HYPERFRAMES_TELEMETRY: '0', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1' }
    const cli = (...args: string[]) => execFileSync(process.execPath, ['--import', pathToFileURL(offline).href, '--import', pathToFileURL(hook).href, hyperframes.cli(), ...args], { cwd: proj, env, encoding: 'utf8', timeout: 120000 })
    const out = JSON.parse(cli('add', 'carousel-path-1', '--no-clipboard', '--json'))
    expect(out.ok).toBe(true)
    expect(existsSync(join(proj, 'compositions', 'carousel-path-1.html'))).toBe(true)
    // its pictures live on HeyGen's CDN: they came from the copy too
    expect(out.written.filter((f: string) => /\.jpg$/.test(f)).length).toBeGreaterThan(10)
    expect(JSON.parse(readFileSync(join(proj, 'hyperframes.lock.json'), 'utf8'))['compositions/carousel-path-1.html']).toBeTruthy()
    expect(out.clipboardCopied).toBe(false)
    const found = JSON.parse(cli('catalog', '--query', 'confetti', '--json'))
    expect(found.results.map((r: { name: string }) => r.name)).toContain('confetti')
  })
})

describe.runIf(haveCopy && process.platform !== 'win32')('the hyperframes command in a Claude session', () => {
  it('installs from the copy and never copies to the clipboard', () => {
    const proj = mkdtempSync(join(tmpdir(), 'ms-shim-'))
    writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }))
    const offline = join(proj, 'offline.mjs')
    writeFileSync(offline, `globalThis.fetch = async (u) => { throw new Error('network used: ' + (u?.url ?? u)) }\n`)
    const shim = join(proj, 'hyperframes')
    writeFileSync(shim, posixShim([['HYPERFRAMES_TELEMETRY', '0'], ['HYPERFRAMES_SKIP_SKILLS', '1']], process.execPath, ['--import', pathToFileURL(offline).href, ...registry.nodeArgs()], hyperframes.cli()))
    chmodSync(shim, 0o755)
    const home = mkdtempSync(join(tmpdir(), 'ms-home-'))
    // no --no-clipboard here: the shim adds it to every `add`
    const out = JSON.parse(execFileSync(shim, ['add', 'grain-overlay', '--json'], { cwd: proj, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 120000 }))
    expect(out.ok).toBe(true)
    expect(out.clipboardCopied).toBe(false)
    expect(existsSync(join(proj, 'compositions', 'components', 'grain-overlay.html'))).toBe(true)
  })
})
