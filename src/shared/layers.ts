// The layers in one order everywhere (timeline, layer list, ⌘↑ / ⌘↓): stacking order, a group's
// children right under it, the top of each stack first — like After Effects' layer stack.
import { CAMERA_ID } from './overrides'

/** what the order needs of a layer (the editor's RuntimeElement has all of it) */
export interface LayerNode {
  id: string
  type: string
  parent: string | null
  stack: string
  rank: number
  text?: string
}

/** layers in stacking order: a group's children follow it, top of each stack first */
export function stackedTree<T extends LayerNode>(elements: T[]): T[] {
  const layers = elements.filter((e) => !['sfx', 'bgm', 'voice'].includes(e.type))
  const kids = new Map<string | null, T[]>()
  for (const e of layers) {
    const k = e.parent
    if (!kids.has(k)) kids.set(k, [])
    kids.get(k)!.push(e)
  }
  const out: T[] = []
  const walk = (parent: string | null) => {
    const list = kids.get(parent) ?? []
    // siblings that stack together keep their group (in document order), each group top first
    const groups: string[] = []
    for (const e of list) if (!groups.includes(e.stack)) groups.push(e.stack)
    for (const g of groups) {
      for (const e of list.filter((x) => x.stack === g).sort((a, b) => a.rank - b.rank)) {
        out.push(e)
        walk(e.id)
      }
    }
  }
  walk(null)
  // anything whose parent is not listed (should not happen) still shows
  for (const e of layers) if (!out.includes(e)) out.push(e)
  // the camera sits on top, like a camera layer in After Effects
  const cam = out.findIndex((e) => e.id === CAMERA_ID)
  if (cam > 0) out.unshift(...out.splice(cam, 1))
  return out
}

/** layers the designer picks from (sounds and character parts have their own places) */
export const listedLayers = <T extends LayerNode>(elements: T[]) => stackedTree(elements).filter((e) => e.type !== 'part')

/** the layer above / below the given one in that order (wrapping around), for ⌘↑ / ⌘↓ */
export function neighbourLayer(elements: LayerNode[], id: string | null, dir: -1 | 1, skip: (id: string) => boolean = () => false): string | null {
  const list = listedLayers(elements).filter((e) => !skip(e.id))
  if (!list.length) return null
  const i = id ? list.findIndex((e) => e.id === id) : -1
  if (i < 0) return list[dir > 0 ? 0 : list.length - 1].id
  return list[(i + dir + list.length) % list.length].id
}

/** what a search finds: the layer's name, its text, its kind (글자 / 이미지 / 도형 / 영상 / 그룹) */
export const TYPE_NAMES: Record<string, string> = { text: '글자 텍스트', image: '이미지 그림', shape: '도형 상자', video: '영상 동영상', group: '그룹', adjustment: '조정', camera: '카메라' }
export function matchesLayer(e: LayerNode, label: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${label} ${e.text ?? ''} ${e.id} ${TYPE_NAMES[e.type] ?? e.type}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}
