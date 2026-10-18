import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 프로젝트 공유: one file that carries the video and how it was made, never the conversation
const root = mkdtempSync(join(tmpdir(), 'ms-share-'))
process.env.MS_PROJECTS_DIR = join(root, 'received')
vi.mock('electron', () => ({ app: { getVersion: () => '0.5.0-test', isPackaged: false, getPath: () => root, getAppPath: () => process.cwd() } }))
const { exportShare, importShare, shareFiles } = await import('../../src/main/share')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const proj = join(root, 'sent', '봄 신메뉴.msproj')
const put = (rel: string, body: string | Buffer) => {
  const p = join(proj, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
}
const picture = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256))
put('project.json', JSON.stringify({ id: 'p1', name: '봄 신메뉴', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', appVersion: '0.5.0', agentSessionId: 'secret-session', agentPermission: 'all', agentModel: 'opus', family: { rootId: 'r' }, editable: true }))
put('brief.json', '{"output":{"width":1080}}')
put('overrides.json', '{"elements":{"title":{"text":"봄"}}}')
put('storyboard.json', '{"storyboard":{"title":"봄"}}')
put('chat.json', '[{"role":"error","detail":"내부 오류 메시지"}]')
put('composition/index.html', '<div data-composition-id="main">봄</div>')
put('composition/meta.json', '{"id":"p1"}')
put('composition/assets/라떼 사진.png', picture)
put('composition/assets/.ms-audio/bgm-curve.wav', 'curve')
put('composition/assets/candidates/listen.mp3', 'listening copy')
put('composition/.hyperframes/video-state.json', '{"blobs":"/Users/me/.cache/hyperframes"}')
put('composition/snapshots/a.png', 'snap')
put('feedback/msg-1.md', '디자이너가 쓴 메시지 원문')
put('feedback/msg-1.json', '{"text":"원문"}')
put('.history/objects/ab', 'git object')
put('history-meta.json', '{}')
put('renders/final.mp4', 'video')
put('.studio/system-prompt.md', 'prompt')
put('.studio/generated.json', '[{"file":"assets/라떼 사진.png","license":"CC0"}]')
put('.studio/storyboard/1/frame-01.png', 'sketch')
put('.studio/generations/c1/source.png', 'candidate')
put('.studio/audio-candidates.json', '{}')
put('references/index.json', '[{"note":"이 느낌"}]')
put('references/r1/source.mp4', 'ref video')
put('thumbnails/latest.jpg', 'thumb')
put('thumbnails/turn-1.jpg', 'old thumb')

describe('a project shared as one file', () => {
  it('takes the video and how it was made, never the conversation, history or this machine', () => {
    const files = shareFiles(proj, { references: true, candidates: true })
    for (const want of ['brief.json', 'overrides.json', 'storyboard.json', 'composition/index.html', 'composition/assets/라떼 사진.png', 'composition/assets/.ms-audio/bgm-curve.wav', '.studio/generated.json', '.studio/storyboard/1/frame-01.png', '.studio/generations/c1/source.png', 'references/r1/source.mp4', 'thumbnails/latest.jpg']) expect(files).toContain(want)
    for (const gone of ['chat.json', 'feedback/msg-1.md', 'feedback/msg-1.json', '.history/objects/ab', 'history-meta.json', 'renders/final.mp4', 'composition/.hyperframes/video-state.json', 'composition/snapshots/a.png', 'composition/assets/candidates/listen.mp3', '.studio/system-prompt.md', '.studio/audio-candidates.json', 'thumbnails/turn-1.jpg', 'project.json']) expect(files).not.toContain(gone)
    const lean = shareFiles(proj, { references: false, candidates: false })
    expect(lean.some((f) => f.startsWith('references/'))).toBe(false)
    expect(lean.some((f) => f.startsWith('.studio/generations/'))).toBe(false)
  })

  it('goes out as a zip and comes back as a new project with the memo, a new id and no session', async () => {
    const file = join(root, '봄 신메뉴.msshare')
    const r = await exportShare(proj, file, { references: true, candidates: true, memo: '# 인계 메모\n봄 신메뉴 15초 광고, 핑크 톤.' })
    expect(r.files).toBeGreaterThan(10)
    // a standard zip (names flagged UTF-8, as Windows Explorer and zip libraries read them), Korean names included
    if (process.platform !== 'win32') expect(execFileSync('python3', ['-c', 'import zipfile,sys;print("\\n".join(i.filename for i in zipfile.ZipFile(sys.argv[1]).infolist()))', file], { encoding: 'utf8' })).toContain('composition/assets/라떼 사진.png')
    const dir = await importShare(file)
    expect(dir).toBe(join(root, 'received', '봄 신메뉴.msproj'))
    const meta = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
    expect(meta.id).not.toBe('p1')
    expect(meta.agentSessionId).toBeUndefined()
    expect(meta.agentPermission).toBeUndefined()
    expect(meta.agentModel).toBeUndefined()
    expect(meta.family).toBeUndefined()
    expect(meta.editable).toBe(true)
    expect(meta.sharedFrom?.appVersion).toBe('0.5.0')
    expect(JSON.parse(readFileSync(join(dir, 'composition', 'meta.json'), 'utf8')).id).toBe(meta.id)
    expect(readFileSync(join(dir, '.studio', 'handoff.md'), 'utf8')).toContain('핑크 톤')
    expect(readFileSync(join(dir, 'composition', 'assets', '라떼 사진.png')).equals(picture)).toBe(true)
    expect(readFileSync(join(dir, 'overrides.json'), 'utf8')).toContain('"봄"')
    const chat = JSON.parse(readFileSync(join(dir, 'chat.json'), 'utf8'))
    expect(chat.length).toBe(1)
    expect(chat[0].role).toBe('notice')
    expect(JSON.stringify(chat)).not.toContain('내부 오류')
    for (const gone of ['feedback/msg-1.md', 'renders/final.mp4', 'composition/.hyperframes', 'msshare.json']) expect(existsSync(join(dir, ...gone.split('/')))).toBe(false)
    // its own fresh history, nothing of the sender's
    expect(existsSync(join(dir, '.history'))).toBe(true)
    expect(existsSync(join(dir, '.history', 'objects', 'ab'))).toBe(false)
    // a second copy of the same file: a second project next to it
    const again = await importShare(file)
    expect(again).toBe(join(root, 'received', '봄 신메뉴 2.msproj'))
    expect(JSON.parse(readFileSync(join(again, 'project.json'), 'utf8')).name).toBe('봄 신메뉴 2')
    expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).name).toBe('봄 신메뉴')
    // no half-unpacked folders left behind
    expect(readdirSync(join(root, 'received')).filter((n) => n.startsWith('.import-'))).toEqual([])
  }, 30_000)

  it('refuses a file that is not a share, leaving nothing behind', async () => {
    const bogus = join(root, 'bogus.msshare')
    writeFileSync(bogus, 'not a zip at all')
    await expect(importShare(bogus)).rejects.toThrow()
    expect(readdirSync(join(root, 'received')).filter((n) => n.startsWith('.import-'))).toEqual([])
  })
})
