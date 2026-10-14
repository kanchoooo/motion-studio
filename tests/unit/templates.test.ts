// Templates: finding the fill-in slots of a composition without a browser, and filling
// them in a project folder (texts → designer edits, files → new src, narration length).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))
const { findElements, mediaOf, setAttr, slotKind, textOf } = await import('../../src/main/htmlSlots')
const { applySlots, claudeMessage, detectSlots } = await import('../../src/main/templates')
const { bin } = await import('../../src/main/paths')

const HTML = `<!doctype html><html><head><script src="vendor/gsap.min.js"></script>
<script>const fake = '<div data-ms-id="not-me" data-ms-type="text">no</div>'</script></head>
<body><div id="root" data-composition-id="main">
  <div data-ms-id="title" data-ms-label="메인 타이틀" data-ms-type="text">봄이<br>터졌다 &amp; 끝</div>
  <div data-ms-id="card" data-ms-type="group"><span data-ms-id="price" data-ms-type="text">3,900원</span>
    <div data-ms-id="photo" data-ms-label="제품 사진" data-ms-type="image"><img src="assets/cup.png" alt=""></div></div>
  <img data-ms-id="logo" data-ms-label="로고" data-ms-type="image" src="assets/logo.png" />
  <audio id="vo" data-ms-id="voice-1" data-ms-type="voice" data-ms-label="내레이션" src="assets/generated/vo.mp3" data-start="0.5" data-duration="2.00"></audio>
  <audio data-ms-id="sfx-1" data-ms-type="sfx" src="assets/sfx/pop.wav"></audio>
</div></body></html>`

describe('finding slots in the HTML', () => {
  it('finds the editable elements, not strings inside scripts', () => {
    const els = findElements(HTML)
    expect(els.map((e) => e.id)).toEqual(['title', 'card', 'price', 'photo', 'logo', 'voice-1', 'sfx-1'])
    const title = els.find((e) => e.id === 'title')!
    expect(textOf(HTML.slice(title.inner[0], title.inner[1]))).toBe('봄이\n터졌다 & 끝')
    expect(els.map(slotKind)).toEqual(['text', null, 'text', 'image', 'image', 'voice', null])
    expect(mediaOf(HTML, els.find((e) => e.id === 'photo')!)?.src).toBe('assets/cup.png')
    expect(mediaOf(HTML, els.find((e) => e.id === 'logo')!)?.src).toBe('assets/logo.png')
  })
  it('sets an attribute of an opening tag', () => {
    const logo = findElements(HTML).find((e) => e.id === 'logo')!
    const next = setAttr(HTML, logo.open, 'src', 'assets/tpl-new.png')
    expect(next).toContain('src="assets/tpl-new.png"')
    expect(next.length).toBe(HTML.length + 'assets/tpl-new.png'.length - 'assets/logo.png'.length)
  })
})

describe('filling a template', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-tpl-'))
  mkdirSync(join(dir, 'composition', 'assets', 'generated'), { recursive: true })
  writeFileSync(join(dir, 'composition', 'index.html'), HTML)
  writeFileSync(join(dir, 'overrides.json'), JSON.stringify({ elements: { price: { text: '2,900원' } } }))
  writeFileSync(join(dir, 'brief.json'), JSON.stringify({ texts: [{ id: 't', text: '봄이\n터졌다 & 끝', locked: true }], assets: [{ id: 'a', file: 'assets/cup.png', originalName: 'cup.png', meta: {} }] }))
  const ffmpeg = bin.ffmpeg()
  const haveFfmpeg = existsSync(ffmpeg)

  it('detects text (with the designer’s edit), image and narration slots', () => {
    const slots = detectSlots(dir)
    expect(slots.map((s) => [s.id, s.kind, s.original])).toEqual([
      ['title', 'text', '봄이\n터졌다 & 끝'],
      ['price', 'text', '2,900원'],
      ['photo', 'image', 'assets/cup.png'],
      ['logo', 'image', 'assets/logo.png'],
      ['voice-1', 'voice', 'assets/generated/vo.mp3'],
    ])
  })

  it.runIf(haveFfmpeg)('puts new copy into designer edits, new files into the elements and asks Claude for a new script', async () => {
    const pic = join(dir, 'new cup.png')
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1', pic])
    const voice = join(dir, 'take.mp3')
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.2', voice])
    const slots = detectSlots(dir)
    const r = await applySlots(dir, slots, { title: { text: '여름이\n왔다' }, photo: { file: pic }, logo: { text: 'ignored' } })
    expect(r.changed).toEqual(['메인 타이틀', '제품 사진'])
    const ov = JSON.parse(readFileSync(join(dir, 'overrides.json'), 'utf8'))
    expect(ov.elements.title.text).toBe('여름이\n왔다')
    expect(ov.elements.price.text).toBe('2,900원')
    const html = readFileSync(join(dir, 'composition', 'index.html'), 'utf8')
    expect(html).toMatch(/<img src="assets\/tpl-new_cup\.png"/)
    expect(existsSync(join(dir, 'composition', 'assets', 'tpl-new_cup.png'))).toBe(true)
    const brief = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8'))
    expect(brief.texts[0].text).toBe('여름이\n왔다')
    expect(brief.assets[0].file).toBe('assets/tpl-new_cup.png')
    // narration: a recording takes the slot (its length follows); a script goes to Claude
    const v = await applySlots(dir, slots, { 'voice-1': { file: voice } })
    expect(readFileSync(join(dir, 'composition', 'index.html'), 'utf8')).toMatch(/data-ms-id="voice-1"[^>]*src="assets\/tpl-take\.mp3"[^>]*data-duration="3\.2\d"/)
    expect(v.changed).toEqual(['내레이션'])
    const s = await applySlots(dir, slots, { 'voice-1': { script: '이제 앱으로 주문하세요' } })
    expect(s.todo.map((x) => x.script)).toEqual(['이제 앱으로 주문하세요'])
    const msg = claudeMessage('봄 템플릿', s.changed, s.todo, true)!
    expect(msg).toContain('템플릿 "봄 템플릿"으로 만들었어요')
    expect(msg).toContain('이제 앱으로 주문하세요')
    expect(msg).toContain('look_at_frames')
  })
})
