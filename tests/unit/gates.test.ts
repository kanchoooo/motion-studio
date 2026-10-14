import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildWriteMissing, stopMissing, storyboardMissing } from '../../src/main/agent/gates'
import { briefMarkdown } from '../../src/main/agent/briefDoc'
import { emptyBrief } from '../../src/shared/brief'

const SK = '/app/resources/claude-plugin/skills'
let n = 0
const t = (sec: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, sec)).toISOString()
const user = (sec: number, text: string) => JSON.stringify({ type: 'user', timestamp: t(sec), message: { role: 'user', content: text } })
const tool = (sec: number, name: string, input: Record<string, unknown>, id = `t${++n}`) => JSON.stringify({ type: 'assistant', timestamp: t(sec), message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (sec: number, id: string, text: string) => JSON.stringify({ type: 'user', timestamp: t(sec), message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })

function project(empty: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'ms-gates-'))
  mkdirSync(join(dir, 'composition'), { recursive: true })
  writeFileSync(join(dir, 'composition', 'index.html'), empty ? '<div id="root" data-ms-empty></div>' : '<div id="root"></div>')
  return { dir, comp: join(dir, 'composition'), transcript: join(dir, 's.jsonl') }
}
const touch = (file: string, sec: number) => utimesSync(file, new Date(Date.parse(t(sec))), new Date(Date.parse(t(sec))))

describe('storyboard gate', () => {
  it('asks for the mandatory reads and the design / storyboard files on a new video', () => {
    const p = project(true)
    writeFileSync(p.transcript, [user(0, '브리프대로 콘티 먼저 보여줘'), tool(1, 'Skill', { skill: 'motion-studio-hyperframes:hyperframes' })].join('\n'))
    const missing = storyboardMissing(p.comp, p.transcript)
    expect(missing.length).toBe(6)
    expect(missing.join(' ')).toMatch(/house-style/)
    expect(missing.join(' ')).toMatch(/STORYBOARD\.md/)
  })
  it('is satisfied once they were read and written', () => {
    const p = project(true)
    writeFileSync(join(p.comp, 'DESIGN.md'), '# design')
    writeFileSync(join(p.comp, 'STORYBOARD.md'), '## Frame 1')
    const reads = ['hyperframes-creative/references/house-style.md', 'hyperframes-creative/references/video-composition.md', 'hyperframes-creative/references/typography.md', 'hyperframes-animation/blueprints-index.md']
    writeFileSync(p.transcript, [user(0, '시작'), ...reads.map((r, i) => tool(i + 1, 'Read', { file_path: `${SK}/${r}` }))].join('\n'))
    expect(storyboardMissing(p.comp, p.transcript)).toEqual([])
  })
  it('does not apply once the video exists', () => {
    const p = project(false)
    writeFileSync(p.transcript, user(0, '수정해줘'))
    expect(storyboardMissing(p.comp, p.transcript)).toEqual([])
  })
})

describe('first build write', () => {
  it('needs a cited recipe body read first', () => {
    const p = project(true)
    writeFileSync(join(p.comp, 'STORYBOARD.md'), '## Frame 1')
    writeFileSync(p.transcript, [user(0, '콘티를 승인했어요'), tool(1, 'Read', { file_path: `${SK}/hyperframes-animation/blueprints-index.md` })].join('\n'))
    expect(buildWriteMissing(p.comp, p.transcript)).toMatch(/blueprint/)
    writeFileSync(p.transcript, [user(0, '콘티를 승인했어요'), tool(1, 'Read', { file_path: `${SK}/hyperframes-animation/blueprints/kinetic-type-swap.md` })].join('\n'))
    expect(buildWriteMissing(p.comp, p.transcript)).toBeNull()
  })
})

describe('stop gate', () => {
  it('lets a turn end that did not change the video', () => {
    const p = project(false)
    touch(join(p.comp, 'index.html'), 0)
    writeFileSync(p.transcript, user(5, '이 장면 어때?'))
    expect(stopMissing(p.comp, p.transcript)).toBeNull()
  })
  it('a small edit must be checked and looked at after the last change', () => {
    const p = project(false)
    touch(join(p.comp, 'index.html'), 20)
    writeFileSync(p.transcript, [user(10, '로고를 키워줘'), tool(15, 'Edit', { file_path: join(p.comp, 'index.html') })].join('\n'))
    const missing = stopMissing(p.comp, p.transcript)!
    expect(missing.length).toBe(2)
    writeFileSync(p.transcript, [user(10, '로고를 키워줘'), tool(15, 'Edit', { file_path: join(p.comp, 'index.html') }), tool(25, 'Bash', { command: 'cd composition && hyperframes check' }), tool(26, 'mcp__studio__look_at_frames', { times: [1] })].join('\n'))
    expect(stopMissing(p.comp, p.transcript)).toBeNull()
  })
  it('a build also needs the independent review and 편집 준비', () => {
    const p = project(false)
    touch(join(p.comp, 'index.html'), 20)
    const check = `c${++n}`
    const base = [user(10, '콘티를 승인했어요. 이대로 영상을 만들어 주세요.'), tool(15, 'Write', { file_path: join(p.comp, 'index.html') }), tool(25, 'Bash', { command: 'cd composition && hyperframes check' }), tool(26, 'Read', { file_path: join(p.comp, 'snapshots', 'contact-sheet-1.jpg') })]
    writeFileSync(p.transcript, [...base, tool(27, 'mcp__studio__check_video', {}, check), result(28, check, '[error] ms_not_edit_ready: …')].join('\n'))
    const missing = stopMissing(p.comp, p.transcript)!
    expect(missing.join(' ')).toMatch(/motion-reviewer/)
    expect(missing.join(' ')).toMatch(/편집 준비/)
    const ok = `c${++n}`
    writeFileSync(p.transcript, [...base, tool(27, 'Agent', { subagent_type: 'motion-studio-hyperframes:motion-reviewer', prompt: '…' }), tool(29, 'mcp__studio__check_video', {}, ok), result(30, ok, '통과: 문제가 없어요.')].join('\n'))
    expect(stopMissing(p.comp, p.transcript)).toBeNull()
  })
  it('a variation re-layout needs checks but no review', () => {
    const p = project(false)
    touch(join(p.comp, 'index.html'), 20)
    writeFileSync(p.transcript, [user(10, '이 프로젝트는 "광고"의 베리에이션이에요 (기준: 현재 상태).'), tool(15, 'Write', { file_path: join(p.comp, 'index.html') }), tool(25, 'mcp__studio__check_video', {}), tool(26, 'mcp__studio__look_at_frames', {})].join('\n'))
    expect(stopMissing(p.comp, p.transcript)).toBeNull()
  })
})

describe('BRIEF.md', () => {
  it('routes the official workflow to a companion-flow general-video with a storyboard', () => {
    const b = emptyBrief('봄 신메뉴', 'shorts-9x16', 15)
    b.client = '모션커피'
    b.texts = [{ ...b.texts[0], id: 'x', text: '지금 주문하세요', locked: true, timing: { mode: 'any' } } as never]
    const md = briefMarkdown(b)
    expect(md).toMatch(/^---\nworkflow: general-video\nflow: companion\nstoryboard: yes/)
    expect(md).toMatch(/aspect: 1080x1920/)
    expect(md).toMatch(/length: 15s/)
    expect(md).toMatch(/필수 문구\(글자 그대로\): "지금 주문하세요"/)
  })
})
