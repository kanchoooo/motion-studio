// The HyperFrames registry shipped inside the app (scripts/fetch-registry.mjs): searching it
// with pictures (find_blocks) and installing an item (add_block). Installing runs the CLI's
// own `hyperframes add`, which reads the copy through resources/hf-registry/offline-fetch.mjs.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runHf } from './hyperframes'
import { registry } from './paths'

export interface RegistryItem {
  name: string
  kind: 'block' | 'component' | 'example'
  title: string
  description: string
  tags: string[]
  width?: number
  height?: number
  duration?: number
  /** files `add` writes (the html + its assets) */
  files: number
  /** 3 moments of the item's preview video side by side (or its poster) */
  preview?: string
}

const DIRS: Record<string, string> = { 'hyperframes:block': 'blocks', 'hyperframes:component': 'components', 'hyperframes:example': 'examples' }

let cache: { dir: string; items: RegistryItem[] } | null = null

/** every item of the copy ([] when the app has none, e.g. a dev checkout without `npm run registry`) */
export function registryItems(dir = registry.dir()): RegistryItem[] {
  if (cache?.dir === dir) return cache.items
  const root = join(dir, 'mirror', 'registry')
  const items: RegistryItem[] = []
  try {
    const list = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items as { name: string; type: string }[]
    for (const { name, type } of list) {
      const sub = DIRS[type]
      if (!sub) continue
      try {
        const m = JSON.parse(readFileSync(join(root, sub, name, 'registry-item.json'), 'utf8'))
        const preview = join(dir, 'previews', `${name}.jpg`)
        items.push({
          name,
          kind: type.replace('hyperframes:', '') as RegistryItem['kind'],
          title: String(m.title ?? name),
          description: String(m.description ?? ''),
          tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
          width: m.dimensions?.width,
          height: m.dimensions?.height,
          duration: typeof m.duration === 'number' ? m.duration : undefined,
          files: Array.isArray(m.files) ? m.files.length : 0,
          preview: existsSync(preview) ? preview : undefined,
        })
      } catch {
        /* an item without a manifest is skipped */
      }
    }
  } catch {
    /* no copy */
  }
  cache = { dir, items }
  return items
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'with', 'for', 'in', 'on', 'to', 'into', 'from', 'that', 'this', 'by', 'as', 'at', 'is', 'it', 'its', 'like', 'style', 'effect'])

/** lower-case word stems: "petals" → "petal", "burst" stays, "glowing" → "glow" */
export function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => {
      if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
      if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
      if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
      if (w.length > 3 && w.endsWith('es') && /(sh|ch|x|ss|z)es$/.test(w)) return w.slice(0, -2)
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
      return w
    })
}

/**
 * Items for a plain-English look ("falling cherry blossom petals", "glitch text"):
 * words in the name, title or tags weigh more than words in the description, and
 * items matching more of the words come first.
 */
export function searchRegistry(query: string, opts: { kind?: RegistryItem['kind']; limit?: number } = {}, items = registryItems()): RegistryItem[] {
  const words = [...new Set(stems(query))]
  if (!words.length) return []
  const scored: { item: RegistryItem; score: number }[] = []
  for (const item of items) {
    if (opts.kind && item.kind !== opts.kind) continue
    const head = new Set([...stems(item.name), ...stems(item.title)])
    const tags = new Set(item.tags.flatMap(stems))
    const body = new Set(stems(item.description))
    let score = 0
    let hit = 0
    for (const w of words) {
      const near = (set: Set<string>) => [...set].some((s) => s.length >= 4 && w.length >= 4 && (s.startsWith(w) || w.startsWith(s)))
      const s = head.has(w) ? 4 : tags.has(w) ? 3 : body.has(w) ? 1 : near(head) || near(tags) ? 1.5 : near(body) ? 0.5 : 0
      if (s) hit++
      score += s
    }
    // covering more of the asked words beats one strong word; a weak brush with the
    // description alone (half the words, once) is not a match
    const total = score * (hit / words.length)
    if (total < 1) continue
    scored.push({ item, score: total + (item.preview ? 0.1 : 0) })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, opts.limit ?? 8)
    .map((s) => s.item)
}

/** one line Claude reads per result */
export function describeItem(i: RegistryItem): string {
  const size = i.width && i.height ? ` · ${i.width}x${i.height}` : ''
  const dur = i.duration ? ` · ${i.duration}s` : ''
  const files = i.files > 1 ? ` · ${i.files} files` : ''
  return `${i.name} (${i.kind}${size}${dur}${files}) — ${i.title}: ${i.description.slice(0, 260)}${i.tags.length ? ` [${i.tags.slice(0, 8).join(', ')}]` : ''}`
}

export interface AddResult {
  ok: boolean
  written: string[]
  snippet?: string
  warnings: string[]
  error?: string
}

/** `hyperframes add <name>` in a composition folder (from the copy, never the clipboard) */
export async function addRegistryItem(compDir: string, name: string): Promise<AddResult> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { ok: false, written: [], warnings: [], error: `잘못된 이름이에요: ${name}` }
  const r = await runHf(['add', name, '--no-clipboard', '--json'], { cwd: compDir, timeoutMs: 180000 })
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    const rel = (p: string) => (p.startsWith(compDir) ? p.slice(compDir.length + 1).replace(/\\/g, '/') : p)
    return { ok: j.ok !== false && r.code === 0, written: (j.written ?? []).map(rel), snippet: j.snippet, warnings: j.warnings ?? [], error: j.ok === false ? String(j.error ?? j.message ?? '') : undefined }
  } catch {
    return { ok: false, written: [], warnings: [], error: (r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n') }
  }
}
