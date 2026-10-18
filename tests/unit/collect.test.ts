import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 결과물 모음 (관제 연동): every export also in one folder the console shows and cleans
const root = mkdtempSync(join(tmpdir(), 'ms-collect-'))
const home = join(root, 'projects')
const collection = join(root, '모션스튜디오 결과물')
const trash = join(root, 'trash')
process.env.MS_PROJECTS_DIR = home
vi.mock('electron', () => ({
  app: { getVersion: () => '0.5.0', isPackaged: false, getPath: () => join(root, 'userdata'), getAppPath: () => process.cwd() },
  shell: {
    // the Trash: moved aside, so the test can see what went there
    trashItem: async (p: string) => {
      const { mkdirSync, renameSync } = await import('node:fs')
      const { basename, join } = await import('node:path')
      mkdirSync(trash, { recursive: true })
      renameSync(p, join(trash, basename(p)))
    },
  },
}))
const collect = await import('../../src/main/collect')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const put = (p: string, body: string | Buffer) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
}
const render = (id: string, file: string, format = 'mp4-h264') => ({ id, file, fileName: file.split('/').pop()!, createdAt: '2026-10-18T00:00:00.000Z', historyId: '', format, width: 1920, height: 1080, duration: 8, bytes: 5, starred: false, note: '' })
function project(dirRel: string, id: string, name: string, renders: ReturnType<typeof render>[]) {
  const dir = join(home, dirRel)
  put(join(dir, 'project.json'), JSON.stringify({ id, name, createdAt: '', updatedAt: '', appVersion: '0.5.0' }))
  put(join(dir, 'brief.json'), JSON.stringify({ output: { width: 1920, height: 1080, duration: 8, fps: 29.97 } }))
  put(join(dir, 'renders', 'index.json'), JSON.stringify(renders))
  return dir
}
const index = () => JSON.parse(readFileSync(join(collection, '.motionstudio', 'index.json'), 'utf8')).items as { path: string; projectId: string; renderId: string; format: string; dir: string; project: string; orphan?: boolean; size: number; fps?: number }[]
const settle = async () => {
  await collect.collectIdle()
  await collect.collectRoundNow()
  await collect.collectIdle()
}

// two projects: one in a folder with a video, a PNG sequence and an AE package; one at the top
const a = project('직방/숏츠/봄 신메뉴.msproj', 'pa', '봄 신메뉴', [render('r1', 'renders/봄-final.mp4'), render('r2', 'renders/seq', 'png-sequence')])
put(join(a, 'renders', '봄-final.mp4'), 'video')
put(join(a, 'renders', 'seq', 'frame-0001.png'), 'png1')
put(join(a, 'renders', 'seq', 'frame-0002.png'), 'png2')
put(join(a, 'renders', '봄-AE', 'data.json'), '{}')
put(join(a, 'renders', '봄-AE', 'assets', 'bg.png'), 'bg')
const b = project('여름.msproj', 'pb', '여름', [render('r9', 'renders/여름.mp4')])
put(join(b, 'renders', '여름.mp4'), 'summer')
// the console's own corner: never touched
put(join(collection, '지난 결과물', 'old.mp4'), 'remotion')

describe('결과물 모음', () => {
  it('fills in every earlier export under folder / project, with an index the console reads', async () => {
    collect.setCollectDir(collection)
    await settle()
    const items = index()
    const paths = items.map((x) => x.path).sort()
    expect(paths).toEqual(['여름/여름.mp4', '직방/숏츠/봄 신메뉴/seq', '직방/숏츠/봄 신메뉴/봄-AE', '직방/숏츠/봄 신메뉴/봄-final.mp4'].sort())
    expect(readFileSync(join(collection, '직방', '숏츠', '봄 신메뉴', '봄-final.mp4'), 'utf8')).toBe('video')
    expect(readFileSync(join(collection, '직방', '숏츠', '봄 신메뉴', 'seq', 'frame-0002.png'), 'utf8')).toBe('png2')
    const seq = items.find((x) => x.renderId === 'r2')!
    expect(seq.format).toBe('png-sequence')
    expect(seq.size).toBe(8)
    expect(items.find((x) => x.renderId === 'ae:봄-AE')?.format).toBe('ae-package')
    expect(items.find((x) => x.renderId === 'r1')?.fps).toBe(29.97)
    // a clone or a link: the same bytes, no copy made where cloning works
    if (process.platform === 'darwin') expect(items.every((x) => !('copied' in x))).toBe(true)
    expect(readFileSync(join(collection, '지난 결과물', 'old.mp4'), 'utf8')).toBe('remotion')
    // filling in twice adds nothing
    collect.setCollectDir(undefined)
    collect.setCollectDir(collection)
    await settle()
    expect(index().length).toBe(4)
  })

  it('takes a new export as it finishes, without overwriting a file of the same name', async () => {
    put(join(b, 'renders', '여름-2.mp4'), 'x')
    const r = render('r10', 'renders/여름-2.mp4')
    put(join(b, 'renders', 'index.json'), JSON.stringify([r, render('r9', 'renders/여름.mp4')]))
    collect.onRender('pb', r)
    await settle()
    expect(index().find((x) => x.renderId === 'r10')?.path).toBe('여름/여름-2.mp4')
  })

  it('follows a rename and a move of the project', async () => {
    const meta = JSON.parse(readFileSync(join(b, 'project.json'), 'utf8'))
    writeFileSync(join(b, 'project.json'), JSON.stringify({ ...meta, name: '여름 이벤트' }))
    const moved = join(home, '이벤트', '여름.msproj')
    mkdirSync(dirname(moved), { recursive: true })
    renameSync(b, moved)
    collect.onProjectsChanged()
    await new Promise((r) => setTimeout(r, 400))
    await settle()
    const mine = index().filter((x) => x.projectId === 'pb')
    expect(mine.map((x) => x.path).sort()).toEqual(['이벤트/여름 이벤트/여름-2.mp4', '이벤트/여름 이벤트/여름.mp4'])
    expect(mine.every((x) => x.project === '여름 이벤트' && x.dir === '이벤트/여름 이벤트')).toBe(true)
    expect(existsSync(join(collection, '이벤트', '여름 이벤트', '여름.mp4'))).toBe(true)
    expect(existsSync(join(collection, '여름'))).toBe(false)
  })

  it('a delete in the console deletes the export in the app too (original to the Trash)', async () => {
    // the console deleted its copy, then asks
    rmSync(join(collection, '직방', '숏츠', '봄 신메뉴', '봄-final.mp4'))
    mkdirSync(join(collection, '.motionstudio', 'delete-requests'), { recursive: true })
    writeFileSync(join(collection, '.motionstudio', 'delete-requests', 'x1.json'), JSON.stringify({ items: [{ path: '직방/숏츠/봄 신메뉴/봄-final.mp4', projectId: 'pa', renderId: 'r1' }, { path: '직방/숏츠/봄 신메뉴/봄-AE', projectId: 'pa', renderId: 'ae:봄-AE' }], requestedAt: '2026-10-18T00:00:00Z' }))
    await settle()
    expect(existsSync(join(a, 'renders', '봄-final.mp4'))).toBe(false)
    expect(existsSync(join(trash, '봄-final.mp4'))).toBe(true)
    expect(existsSync(join(trash, '봄-AE'))).toBe(true)
    expect(JSON.parse(readFileSync(join(a, 'renders', 'index.json'), 'utf8')).map((r: { id: string }) => r.id)).toEqual(['r2'])
    expect(index().some((x) => x.renderId === 'r1' || x.renderId === 'ae:봄-AE')).toBe(false)
    expect(existsSync(join(collection, '직방', '숏츠', '봄 신메뉴', '봄-AE'))).toBe(false)
    expect(existsSync(join(collection, '.motionstudio', 'delete-requests', 'x1.json'))).toBe(false)
  })

  it('a delete in the app takes the copy away; a deleted project leaves its files, marked orphan', async () => {
    collect.onRenderRemoved('pa', 'r2')
    await settle()
    expect(existsSync(join(collection, '직방', '숏츠', '봄 신메뉴', 'seq'))).toBe(false)
    expect(index().some((x) => x.renderId === 'r2')).toBe(false)
    rmSync(join(home, '이벤트'), { recursive: true, force: true })
    collect.onProjectsChanged()
    await new Promise((r) => setTimeout(r, 400))
    await settle()
    const left = index().filter((x) => x.projectId === 'pb')
    expect(left.length).toBe(2)
    expect(left.every((x) => x.orphan)).toBe(true)
    expect(existsSync(join(collection, '이벤트', '여름 이벤트', '여름.mp4'))).toBe(true)
    expect(statSync(join(collection, '.motionstudio', 'index.json')).isFile()).toBe(true)
  })
})
