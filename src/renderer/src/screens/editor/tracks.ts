// A track is one keyframed property of a layer: one of the designer's properties (props.ts,
// stored in `keys`) or a property of Claude's motion the designer took over ("own:<GSAP
// property>", stored in `own`, played on the element itself instead of Claude's tweens).
import { isKeyProp, PROP, type ElementOverride, type Keyframe, type KeyProp } from '@shared/overrides'
import { propLabel as gsapLabel } from './motionInfo'

export type Track = KeyProp | `own:${string}`
export const isOwn = (t: string): t is `own:${string}` => t.startsWith('own:')
export const ownProp = (t: string) => t.slice(4)
export const ownTrack = (p: string): Track => `own:${p}`

export function trackKeys(o: ElementOverride | undefined, t: Track): Keyframe[] {
  return (isOwn(t) ? o?.own?.[ownProp(t)] : o?.keys?.[t as KeyProp]) ?? []
}

/** the element with a track's keyframes replaced (an empty list removes the track) */
export function withTrack(e: ElementOverride, t: Track, list: Keyframe[]): ElementOverride {
  if (isOwn(t)) {
    const own = { ...(e.own ?? {}) }
    if (list.length) own[ownProp(t)] = list
    else delete own[ownProp(t)]
    return { ...e, own }
  }
  const keys = { ...(e.keys ?? {}) }
  if (list.length) keys[t as KeyProp] = list
  else delete keys[t as KeyProp]
  return { ...e, keys }
}

/** every track of a layer that has keyframes */
export function keyedTracks(o: ElementOverride | undefined): Track[] {
  const out: Track[] = []
  for (const [p, ks] of Object.entries(o?.keys ?? {})) if (ks?.length && isKeyProp(p)) out.push(p)
  for (const [p, ks] of Object.entries(o?.own ?? {})) if (ks?.length) out.push(ownTrack(p))
  return out
}

/** acting parameters of a character (SvgRig): the usual names in Korean */
const RIG_LABEL: Record<string, string> = {
  breathe: '숨쉬기',
  lid: '눈꺼풀',
  'lid-tilt': '눈꺼풀 기울기',
  blink: '눈 깜빡임',
  'eye-open': '눈 뜨기',
  'look-x': '시선 좌우',
  'look-y': '시선 위아래',
  pupil: '눈동자 크기',
  'eye-big': '눈 크게',
  tremble: '떨림',
  tilt: '고개 기울기',
  turn: '고개 돌리기',
  sq: '찌그러짐',
  'head-y': '고개 위아래',
  'head-sq': '머리 눌림',
  'hair-y': '머리카락 위아래',
  'hair-rot': '머리카락 회전',
  shrug: '어깨 들썩',
  sob: '흐느낌',
  'brow-l': '왼쪽 눈썹',
  'brow-r': '오른쪽 눈썹',
  'brow-l-rot': '왼쪽 눈썹 기울기',
  'brow-r-rot': '오른쪽 눈썹 기울기',
  'brow-sad': '슬픈 눈썹',
  'brow-raise': '눈썹 올리기',
  smirk: '비웃기',
  smile: '웃음',
  'm-o': '입 O',
  'mouth-open': '입 벌리기',
  'm-wave': '입 떨림',
  quiver: '입술 떨림',
  'm-wail': '우는 입',
  squeeze: '눈 질끈',
  pool: '눈물 고임',
  tears: '눈물',
  spray: '눈물 튐',
  flush: '홍조',
  sweat: '식은땀',
}

/** a GSAP property Claude animates, in Korean (a character's parameter by its acting name) */
export function propLabel(p: string): string {
  if (p.startsWith('--')) return RIG_LABEL[p.slice(2)] ?? p.slice(2)
  return gsapLabel(p)
}

export function rigLabel(name: string): string {
  return RIG_LABEL[name] ?? name
}

export function trackLabel(t: Track): string {
  return isOwn(t) ? propLabel(ownProp(t)) : PROP[t as KeyProp]?.label ?? t
}
