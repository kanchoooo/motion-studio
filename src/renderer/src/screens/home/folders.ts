// Small helpers for the home screen's folder tree ("직방/숏츠" relative paths, '' = the top).

export const RECENT = '__recent__'

export const folderName = (rel: string) => (rel === RECENT ? '최근 작업' : rel ? rel.split('/').pop()! : '프로젝트')
export const parentOf = (rel: string) => rel.split('/').slice(0, -1).join('/')
export const depthOf = (rel: string) => (rel ? rel.split('/').length : 0)
/** direct sub-folders of a folder */
export const childrenOf = (folders: string[], rel: string) => folders.filter((f) => parentOf(f) === rel)
/** a folder and everything below it */
export const within = (path: string, rel: string) => !rel || path === rel || path.startsWith(`${rel}/`)

/** the folder the home screen shows (remembered per computer) */
export function rememberedFolder(): string {
  try {
    return localStorage.getItem('ms-home-folder') ?? ''
  } catch {
    return ''
  }
}
export function rememberFolder(rel: string) {
  try {
    localStorage.setItem('ms-home-folder', rel)
  } catch {
    /* private window */
  }
}

/** folders as indented options for a <select> ('' first) */
export function folderOptions(folders: string[]): { value: string; label: string }[] {
  const out = [{ value: '', label: '프로젝트 (맨 위)' }]
  const walk = (rel: string, depth: number) => {
    for (const f of childrenOf(folders, rel)) {
      out.push({ value: f, label: `${'　'.repeat(depth)}└ ${folderName(f)}` })
      walk(f, depth + 1)
    }
  }
  walk('', 0)
  return out
}
