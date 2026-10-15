// Layers the designer adds by hand (텍스트 · 도형 · 이미지 · 동영상 · 단색 · 조정 레이어) are real
// elements in a managed block at the end of the root element of composition/index.html:
// the renderer reads them like anything Claude wrote (a clip is decoded and seeked, a picture
// is loaded before capture) and Claude sees them. The app rewrites the block from
// overrides.layers every time; Claude never edits it. Moving, keyframes, effects and masks
// of these layers go through the same overrides as Claude's layers (ms-runtime.js).
import type { DesignerLayer, Overrides } from '@shared/overrides'
import { closingTagAt } from './htmlSlots'

const BLOCK_START = '<!-- ms:layers:start (모션스튜디오가 관리하는 디자이너 레이어: 수정하지 마세요) -->'
const BLOCK_END = '<!-- ms:layers:end -->'
const BLOCK_RE = /\n?[ \t]*<!-- ms:layers:start[^>]*-->[\s\S]*?<!-- ms:layers:end -->/g

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const escText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const px = (n: number) => `${+(+n || 0).toFixed(2)}px`

/** a project file the layer may show: composition-relative, inside the project */
export function safeSrc(src: string | undefined): string | null {
  if (!src) return null
  const s = src.replace(/\\/g, '/').replace(/^\.\//, '')
  if (/^[a-z]+:/i.test(s) || s.startsWith('/') || s.split('/').includes('..')) return null
  return s
}

export const LAYER_ID = /^L[A-Za-z0-9_-]{2,40}$/

function layerTag(l: DesignerLayer, duration: number, processed?: string): string | null {
  if (!LAYER_ID.test(l.id)) return null
  const base = `position:absolute;left:${px(l.x)};top:${px(l.y)};width:${px(Math.max(1, l.w))};`
  const common = `data-ms-id="${escAttr(l.id)}" data-ms-label="${escAttr(l.label || l.id)}" data-ms-designer="${l.kind}"`
  const fit = l.fit ?? 'cover'
  switch (l.kind) {
    case 'text': {
      const body = escText(l.text ?? '').split('\n').join('<br>')
      return `<div ${common} data-ms-type="text" style="${base}margin:0;font-size:72px;font-weight:700;line-height:1.2;color:#ffffff;text-align:center;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;">${body}</div>`
    }
    case 'shape':
      return `<div ${common} data-ms-type="shape" style="${base}height:${px(Math.max(1, l.h))};background:#7c5cff;${l.shape === 'ellipse' ? 'border-radius:50%;' : ''}"></div>`
    case 'solid':
      return `<div ${common} data-ms-type="shape" style="${base}height:${px(Math.max(1, l.h))};background:#111111;"></div>`
    case 'adjustment':
      return `<div ${common} data-ms-type="adjustment" style="${base}height:${px(Math.max(1, l.h))};pointer-events:none;"></div>`
    case 'image': {
      const src = safeSrc(l.src)
      if (!src) return null
      return `<img ${common} data-ms-type="image" src="${escAttr(src)}" alt="" style="${base}height:${px(Math.max(1, l.h))};object-fit:${fit};" />`
    }
    case 'video': {
      // a speed change / backwards: the processed clip (videoFx.ts)
      const src = safeSrc(processed ?? l.src)
      if (!src) return null
      const muted = l.muted !== false
      // the renderer only finds (and mixes) media that has an id; the clip runs for the whole video,
      // its in/out points show and hide it like any layer
      return `<video id="${escAttr(l.id)}" ${common} data-ms-type="video" src="${escAttr(src)}" data-start="0" data-duration="${(+duration || 1).toFixed(3)}" data-media-start="${Math.max(0, l.mediaStart ?? 0).toFixed(3)}"${muted ? ' muted data-volume="0"' : ''} playsinline style="${base}height:${px(Math.max(1, l.h))};object-fit:${fit};"></video>`
    }
  }
  return null
}

/** the length of the video (output time) from the root tag */
function rootDuration(html: string): number {
  const tag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0] ?? ''
  return parseFloat(tag.match(/\sdata-duration="([^"]*)"/)?.[1] ?? '0') || 0
}

/** returns the HTML with the designer's layers written into their block at the end of the root (idempotent) */
export function applyLayers(html: string, o: Overrides, clips: Record<string, string> = {}): string {
  let out = html.replace(BLOCK_RE, '')
  const tags = (o.layers ?? []).map((l) => layerTag(l, rootDuration(out), clips[l.id])).filter((t): t is string => !!t)
  if (!tags.length) return out
  const open = out.search(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
  if (open < 0) return out
  const close = closingTagAt(out, open)
  if (close < 0) return out
  // no whitespace after the block: removing it gives back exactly the HTML it was put into
  const block = `\n      ${BLOCK_START}\n${tags.map((t) => `      ${t}`).join('\n')}\n      ${BLOCK_END}`
  // trailing whitespace before the closing tag stays outside the block
  let at = close
  while (at > open && /\s/.test(out[at - 1])) at--
  out = out.slice(0, at) + block + out.slice(at)
  return out
}
