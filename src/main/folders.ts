// Project folders (홈의 폴더 트리): plain folders inside the projects folder, so the tree
// is the same in Finder / Explorer. A folder holds projects (*.msproj) and more folders;
// hidden folders (.templates, …) belong to the app and are never listed.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { projectsDir } from './paths'
import { safeName, uniquePath } from './util'

/** folders inside folders, at most this deep */
export const MAX_DEPTH = 4

const isProject = (name: string) => name.toLowerCase().endsWith('.msproj')
const isHidden = (name: string) => name.startsWith('.')

/** "직방/숏츠" → its absolute path; anything outside the projects folder or inside a project is refused */
export function folderPath(rel: string): string {
  const parts = (rel ?? '').split(/[\\/]+/).filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.' || isHidden(p) || isProject(p))) throw new Error('폴더 위치가 올바르지 않아요.')
  if (parts.length > MAX_DEPTH) throw new Error(`폴더는 ${MAX_DEPTH}단계까지 만들 수 있어요.`)
  return join(projectsDir(), ...parts)
}

/** the folder a project is in ('' = the top of the projects folder, or a project kept elsewhere) */
export function folderOf(projectDir: string): string {
  const rel = relative(projectsDir(), dirname(projectDir))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return ''
  return rel.split(sep).join('/')
}

/** every folder (relative, "a/b") and every project folder (absolute) inside the projects folder */
export function scan(): { folders: string[]; projects: string[] } {
  const folders: string[] = []
  const projects: string[] = []
  const walk = (dir: string, rel: string[]) => {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names.sort((a, b) => a.localeCompare(b, 'ko'))) {
      if (isHidden(name)) continue
      const p = join(dir, name)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (isProject(name)) projects.push(p)
      else if (rel.length < MAX_DEPTH) {
        folders.push([...rel, name].join('/'))
        walk(p, [...rel, name])
      }
    }
  }
  walk(projectsDir(), [])
  return { folders, projects }
}

const cleanName = (name: string) => safeName(name, '새 폴더').replace(/\.msproj$/i, '').trim() || '새 폴더'

export function createFolder(parent: string, name: string): string {
  const base = folderPath(parent)
  const n = cleanName(name)
  if (parent.split('/').filter(Boolean).length + 1 > MAX_DEPTH) throw new Error(`폴더는 ${MAX_DEPTH}단계까지 만들 수 있어요.`)
  const p = join(base, n)
  if (existsSync(p)) throw new Error('같은 이름의 폴더가 이미 있어요.')
  mkdirSync(p, { recursive: true })
  return [...parent.split('/').filter(Boolean), n].join('/')
}

/** renames a folder in place; returns its new relative path (callers move open projects along) */
export function renameFolder(rel: string, name: string): { from: string; to: string; rel: string } {
  const from = folderPath(rel)
  if (!rel || !existsSync(from)) throw new Error('폴더를 찾을 수 없어요.')
  const n = cleanName(name)
  const to = join(dirname(from), n)
  if (to === from) return { from, to, rel }
  if (existsSync(to)) throw new Error('같은 이름의 폴더가 이미 있어요.')
  renameSync(from, to)
  return { from, to, rel: [...rel.split('/').filter(Boolean).slice(0, -1), n].join('/') }
}

/** projects anywhere inside a folder */
export function projectsIn(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    let names: string[] = []
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(d, name)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (isProject(name)) out.push(p)
      else if (depth < MAX_DEPTH + 1) walk(p, depth + 1)
    }
  }
  walk(dir, 0)
  return out
}

/** where a project lands when moved into a folder (its own folder name, made unique) */
export function moveTarget(projectDir: string, to: string): string {
  const base = folderPath(to)
  mkdirSync(base, { recursive: true })
  const name = basename(projectDir).replace(/\.msproj$/i, '')
  return uniquePath((n) => join(base, `${name}${n ? ` ${n + 1}` : ''}.msproj`))
}

/** true when `p` is `dir` itself or inside it */
export const isInside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep)
