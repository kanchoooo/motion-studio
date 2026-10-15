// 0.5: planning in conversation, building without a harness. Claude's instructions only say
// what the app offers; the app repairs the head lines itself; the storyboard carries the
// materials each scene needs and the files the designer assigned; attachments are studied as an
// overview and, part by part, frame by frame; get_brief only holds the output spec.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'ms-plan-'))
process.env.MS_PROJECTS_DIR = join(home, 'projects')
vi.mock('electron', () => ({
  app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => home, getAppPath: () => process.cwd() },
  // no windows in unit tests: a storyboard is shown in words
  BrowserWindow: class {
    webContents = { setAudioMuted() {}, executeJavaScript: async () => [], capturePage: async () => ({ toPNG: () => Buffer.alloc(0) }) }
    async loadURL() {
      throw new Error('no window in unit tests')
    }
    isDestroyed() {
      return false
    }
    destroy() {}
  },
}))
const ffmpeg = join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

describe("Claude's instructions", async () => {
  const { STUDIO_PROMPT, TIDY_REQUEST } = await import('../../src/main/agent/prompt')
  it('say what the app offers, not an order of work', () => {
    for (const t of ['show_storyboard', 'get_storyboard', 'start_build', '제작해줘', 'look_at_reference', 'use_as_material', 'make_video', 'show_voice_candidates', 'Artlist', 'ai_import', 'motion-reviewer', 'Korean', 'plain Claude Code'])
      expect(STUDIO_PROMPT).toContain(t)
    // the old harness: mandatory reads, gates, required review, 편집 준비
    for (const t of ['MUST', 'app refuses', 'The app does not let', 'mandatory', '편집 준비', 'END YOUR TURN', 'measure_layout', 'propose_storyboard'])
      expect(STUDIO_PROMPT).not.toContain(t)
    expect(STUDIO_PROMPT.length).toBeLessThan(9000)
  })
  it('편집 정리 only adds names', () => {
    expect(TIDY_REQUEST).toMatch(/Only add attributes/)
    expect(TIDY_REQUEST).toMatch(/Do not convert the layout to absolute/)
  })
})

describe('the app repairs the head lines', async () => {
  const { repairHead, APP_HEAD } = await import('../../src/main/headFix')
  const { starterComposition, compositionHasVideo } = await import('../../src/main/template')
  const { defaultOutput } = await import('@shared/brief')
  const root = '<div id="root" data-composition-id="main" data-duration="5"><h1>안녕</h1></div>'
  const order = (html: string) => APP_HEAD.map((l) => html.indexOf(l))

  it('leaves a composition that has them alone', () => {
    expect(repairHead(starterComposition(defaultOutput()))).toBeNull()
  })

  it('puts missing lines at the top of <head>, before any script', () => {
    const html = `<!doctype html><html><head><meta charset="UTF-8"><script>gsap.to('h1',{x:1})</script></head><body>${root}</body></html>`
    const r = repairHead(html)!
    const at = order(r.html)
    expect(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1]))).toBe(true)
    expect(r.html.indexOf('<meta charset="UTF-8">')).toBeLessThan(at[0])
    expect(at[0]).toBeLessThan(r.html.indexOf('<script>gsap.to'))
    // once is enough
    expect(repairHead(r.html)).toBeNull()
  })

  it('points CDN GSAP and its plugins at local copies, never loading GSAP twice', () => {
    const html = `<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/SplitText.min.js"></script><link href="./ms/fonts.css" rel="stylesheet"></head><body>${root}<script src="./ms/runtime.js" defer></script></body></html>`
    const r = repairHead(html)!
    expect(r.vendor).toEqual(['SplitText.min.js'])
    expect(r.html).toContain('<script src="vendor/SplitText.min.js"></script>')
    expect(r.html).not.toMatch(/cdn\.|cdnjs/)
    expect(r.html.match(/gsap\.min\.js/g)).toHaveLength(1)
    expect(r.html.match(/ms\/runtime\.js/g)).toHaveLength(1)
    expect(r.html.match(/fonts\.css/g)).toHaveLength(1)
    const at = order(r.html)
    expect(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1]))).toBe(true)
    expect(at[0]).toBeLessThan(r.html.indexOf('vendor/SplitText.min.js'))
  })

  it('drops integrity on a localised CDN tag, leaves plugins the app has no copy of on the CDN', () => {
    const html = `<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" integrity="sha512-abc" crossorigin="anonymous" referrerpolicy="no-referrer"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/NoSuchPlugin.min.js"></script></head><body>${root}</body></html>`
    const r = repairHead(html, (f) => f !== 'NoSuchPlugin.min.js')!
    expect(r.html).not.toMatch(/integrity|crossorigin|referrerpolicy/)
    expect(r.html).toContain('https://cdn.jsdelivr.net/npm/gsap@3/dist/NoSuchPlugin.min.js')
    expect(r.vendor).toEqual([])
  })

  it('settles in one pass whatever the head looks like (a script before charset, no </head>)', () => {
    for (const html of [
      `<html><head><script>window.x=1</script><meta charset="utf-8"></head><body>${root}</body></html>`,
      `<html><head><meta charset="utf-8"><title>x</title><body>${root}</body></html>`,
      `${root}`,
    ]) {
      const once = repairHead(html)!.html
      expect(repairHead(once)).toBeNull()
      const at = order(once)
      expect(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]))).toBe(true)
    }
  })

  it('counts a video without any named layer as a video', () => {
    expect(compositionHasVideo(starterComposition(defaultOutput()))).toBe(false)
    expect(compositionHasVideo(`<html><body>${root}</body></html>`)).toBe(true)
    expect(compositionHasVideo('<html><body><div data-composition-id="main"></div><script>const tl = gsap.timeline()</script></body></html>')).toBe(false)
  })
})

describe('storyboard materials', async () => {
  const sb = await import('../../src/main/storyboard')
  const base = {
    title: '봄 신메뉴',
    concept: '따뜻한 봄',
    duration: 10,
    scenes: [
      { n: 1, from: 0, to: 4, title: '오프닝', description: '컵이 등장', texts: ['봄이 왔어요'], assets: [], motion: '', materials: [{ id: '', kind: 'image' as const, label: '컵 클로즈업', prompt: 'a mint cup' }] },
      { n: 2, from: 4, to: 10, title: '엔딩', description: '로고', texts: [], assets: [], motion: '', materials: [{ id: 'clip', kind: 'video' as const, label: '배경 영상', prompt: 'slow push in', startPrompt: 'kitchen', endPrompt: 'cup close' }, { id: 'clip', kind: 'image' as const, label: '로고' }] },
    ],
  }

  it('gives every material a stable, unique id', () => {
    const s = sb.withMaterialIds(base)
    expect(s.scenes.flatMap((x) => x.materials!.map((m) => m.id))).toEqual(['s1-m1', 'clip', 's2-m2'])
  })

  it('keeps what the designer assigned when Claude shows a revised storyboard', () => {
    const prev = sb.withMaterialIds(base)
    prev.scenes[0].materials![0].file = 'assets/cup.png'
    prev.scenes[1].materials![0].file = 'assets/kitchen.mp4'
    const next = sb.withMaterialIds({ ...base, scenes: [{ ...base.scenes[0], materials: [{ id: 'cup', kind: 'image', label: '컵 클로즈업' }] }, base.scenes[1]] })
    const kept = sb.carryAssignments(next, prev)
    expect(kept.scenes[0].materials![0].file).toBe('assets/cup.png') // same scene + label
    expect(kept.scenes[1].materials![0].file).toBe('assets/kitchen.mp4') // same id
    expect(kept.scenes[1].materials![1].file).toBeUndefined()
  })

  it('assigns files, tells Claude the changes after approval, lists empty slots', () => {
    const dir = mkdtempSync(join(home, 'sb-'))
    sb.writeStoryboard(dir, { itemId: 'i1', status: 'pending', storyboard: sb.withMaterialIds(base) })
    let cur = sb.assignMaterial(dir, 's1-m1', 'assets/cup.png')
    expect(cur.changed).toBeUndefined()
    expect(sb.emptyMaterials(cur.storyboard)).toEqual([{ scene: 2, label: '배경 영상' }, { scene: 2, label: '로고' }])
    expect(sb.assignmentLines(cur.storyboard)[0]).toMatch(/장면 1 · 컵 클로즈업 \(이미지, s1-m1\): assets\/cup\.png/)
    expect(sb.assignmentLines(cur.storyboard)[1]).toMatch(/비어 있음 — 알아서 채워요/)
    sb.writeStoryboard(dir, { ...cur, status: 'approved' })
    cur = sb.assignMaterial(dir, 'clip', 'assets/clip.mp4')
    cur = sb.assignMaterial(dir, 'clip', 'assets/clip2.mp4')
    expect(cur.changed).toEqual(['장면 2 · 배경 영상: assets/clip2.mp4 로 바꿨어요'])
    expect(() => sb.assignMaterial(dir, 'nope', null)).toThrow(/소재 칸/)
  })
})

describe('attachments: an overview, then a part frame by frame', async () => {
  const refs = await import('../../src/main/references')
  const dir = mkdtempSync(join(home, 'refs-'))
  mkdirSync(join(dir, 'composition', 'assets'), { recursive: true })
  const clip = join(home, 'clip.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-pix_fmt', 'yuv420p', clip])

  it('steps of the overview grow with the length', () => {
    expect(refs.overviewStep(30)).toBe(1)
    expect(refs.overviewStep(120)).toBe(1)
    expect(refs.overviewStep(600)).toBe(5)
  })

  it('analyses an attached video into an overview and makes 0.1 s sheets of a part on request', async () => {
    const [item] = refs.addReferenceFiles(dir, [clip], () => {})
    for (let i = 0; i < 900 && refs.listReferences(dir)[0].status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100))
    const r = refs.listReferences(dir)[0]
    expect(r.status).toBe('ready')
    expect(r.sheetStep).toBe(1)
    expect(r.sheets!.length).toBe(1)
    const part = await refs.rangeSheets(dir, item.id, 1, 3.5)
    expect(part.step).toBe(0.1)
    expect(part.sheets).toHaveLength(2) // 25 frames, 20 per sheet
    expect(part.sheets.every((s) => existsSync(join(dir, s.file)))).toBe(true)
    expect(part.sheets[0].from).toBe(1)
    // the same part again comes from the cache
    expect((await refs.rangeSheets(dir, item.id, 1, 3.5)).sheets).toEqual(part.sheets)
    // too long for one call: cut at 200 frames
    const long = await refs.rangeSheets(dir, item.id, 0, 6, 0.04)
    expect(long.clipped).toBe(false)
    expect((await refs.rangeSheets(dir, item.id, 0, 600, 0.04)).to).toBeLessThanOrEqual(6)
  }, 120000)

  it('YouTube stays reference-only', () => {
    const list = refs.listReferences(dir)
    writeFileSync(join(dir, 'references', 'index.json'), JSON.stringify([...list, { id: 'yt1', kind: 'youtube', title: '유튜브', ranges: [], note: '', status: 'ready', file: list[0].file }]))
    expect(() => refs.referenceSource(dir, 'yt1')).toThrow(/참고용/)
    expect(refs.referenceSource(dir, list[0].id).path).toMatch(/source\.mp4$/)
  })
})

describe('studio tools for planning', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const projects = await import('../../src/main/projects')
  const refs = await import('../../src/main/references')
  const { buildStudioServer } = await import('../../src/main/agent/tools')
  const sb = await import('../../src/main/storyboard')
  const p = await projects.createProject({ name: '대화 기획', presetId: 'shorts-9x16', duration: 12 })
  const shown: unknown[] = []
  const voices: unknown[] = []
  let builds = 0
  const server = buildStudioServer(p.meta.id, { onStoryboard: (_id, s) => shown.push(s), onAudioCandidates() {}, onGenerated() {}, onVoices: (_id, v) => voices.push(v), onBuildStart: () => builds++ })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(b)
  const call = async (name: string, args: Record<string, unknown> = {}) => ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text

  it('get_brief: the output spec and the library, older notes only when there are some', async () => {
    const r = JSON.parse(await call('get_brief'))
    expect(r.output).toMatchObject({ width: 1080, height: 1920, duration: 12, dataFpsAttribute: 30 })
    expect(r.library).toEqual([])
    expect(r.olderBrief).toBeUndefined()
    expect(r.requiredTexts).toBeUndefined()
    const brief = projects.state(p.meta.id).brief
    await projects.saveBrief(p.meta.id, { ...brief, tone: '따뜻하고 산뜻하게' })
    expect(JSON.parse(await call('get_brief')).olderBrief.lines).toEqual(['톤앤매너: 따뜻하고 산뜻하게'])
  })

  it('show_storyboard hands the scenes and materials to the app (in words without a sketch window)', async () => {
    const t = await call('show_storyboard', { title: '콘티', concept: '봄', duration: 12, scenes: [{ from: 0, to: 6, title: '첫 장면', description: '컵', materials: [{ kind: 'video', label: '컵 영상', prompt: 'push in', start_prompt: 'a cup', end_prompt: 'the cup close' }] }, { from: 6, to: 12, title: '엔딩', description: '로고' }] })
    expect(t).toMatch(/장면 2개, 시안 그림 0장/)
    const s = shown[0] as { scenes: { materials: { kind: string; startPrompt?: string }[]; frame?: string }[] }
    expect(s.scenes[0].materials[0]).toMatchObject({ kind: 'video', startPrompt: 'a cup', endPrompt: 'the cup close' })
    expect(s.scenes[1].materials).toEqual([])
    expect(await call('get_storyboard')).toMatch(/아직 콘티가 없어요/)
    sb.writeStoryboard(p.path, { itemId: 'x', status: 'pending', storyboard: sb.withMaterialIds(s as never) })
    expect(JSON.parse(await call('get_storyboard')).scenes[0].materials[0].id).toBe('s1-m1')
  })

  it('start_build (the designer said go in the conversation): the assigned materials, the storyboard approved, the editor opens', async () => {
    const cur = sb.readStoryboard(p.path)!
    sb.assignMaterial(p.path, 's1-m1', 'assets/clip.mp4')
    const t = await call('start_build')
    expect(t).toMatch(/장면 1 · 컵 영상 \(영상, s1-m1\): assets\/clip\.mp4 — 이 파일을 써요/)
    expect(builds).toBe(1)
    expect(sb.readStoryboard(p.path)!.status).toBe('approved')
    // a change after approval is remembered for Claude's next message
    expect(sb.assignMaterial(p.path, 's1-m1', 'assets/clip2.mp4').changed).toHaveLength(1)
    void cur
  })

  it('use_as_material copies an attachment into the library', async () => {
    const img = join(home, '참고.png')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=200x100', '-frames:v', '1', img])
    const [r] = refs.addReferenceFiles(p.path, [img], () => {})
    const t = await call('use_as_material', { id: r.id, name: '제품 사진' })
    expect(t).toMatch(/소재함에 넣었어요: assets\//)
    const lib = projects.state(p.meta.id).brief.assets
    expect(lib.map((x) => x.originalName)).toEqual(['제품 사진'])
    expect(lib[0].required).toBe(false)
    expect(existsSync(join(p.path, 'composition', lib[0].file))).toBe(true)
  })

  it('make_video only sends images from inside the project', async () => {
    expect(await call('make_video', { prompt: 'x', start_image: '../../../../etc/hosts' })).toMatch(/프로젝트 안의 이미지/)
    expect(await call('make_video', { prompt: 'x', start_image: 'assets/notes.txt' })).toMatch(/프로젝트 안의 이미지/)
    expect(await call('make_video', { prompt: 'x', start_image: 'assets/none.png' })).toMatch(/찾지 못했어요/)
    expect(await call('make_video', { prompt: 'x', end_image: 'assets/a.png' })).toMatch(/시작 프레임도/)
  })

  it('show_voice_candidates puts a voice card in the chat', async () => {
    await call('show_voice_candidates', { label: '엔딩 내레이션', voices: [{ provider: 'magnific', id: '42', name: '지은', preview_url: 'https://example.com/a.mp3' }] })
    expect(voices[0]).toMatchObject({ label: '엔딩 내레이션', voices: [{ provider: 'magnific', id: '42', name: '지은', previewUrl: 'https://example.com/a.mp3' }] })
  })

  it('check_video: a video without named layers or brief texts is not an error', async () => {
    const index = join(p.path, 'composition', 'index.html')
    // generic families only: an installed font (Pretendard here) is missing on CI machines
    writeFileSync(index, readFileSync(index, 'utf8').replace(/<div id="root"([^>]*)data-ms-empty="true"><\/div>/, '<div id="root"$1><h1 style="font-family: serif">봄</h1><p style="font-family: sans-serif">x</p></div>'))
    const t = await call('check_video')
    expect(t).not.toMatch(/\[error\] ms_/)
  }, 60_000)
})
