// 관제용 웹 연결: the annotated frame of a chat message with marks. In the app the window is
// captured with the marks on it; a browser cannot capture the preview (another origin), so the
// app draws it here: the frame at the marked time (the renderer Claude's look_at_frames uses)
// with the boxes, pins and lines on top.
import { join } from 'node:path'
import sharp from 'sharp'
import type { FeedbackMark } from '@shared/project'
import { snapshot } from './hyperframes'
import * as projects from './projects'

const MARK = '#ff4d8d'
const esc = (s: string) => s.replace(/[<&"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' })[c]!)

/** the marks as an SVG the size of the composition */
export function marksSvg(marks: FeedbackMark[], width: number, height: number): string {
  const line = Math.max(3, Math.round(Math.min(width, height) / 300))
  const r = Math.max(12, Math.round(Math.min(width, height) / 45))
  const badge = (x: number, y: number, n: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${MARK}" stroke="#fff" stroke-width="${Math.max(2, line / 2)}"/>` +
    `<text x="${x}" y="${y}" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(r * 1.1)}" text-anchor="middle" dominant-baseline="central">${esc(String(n))}</text>`
  const parts: string[] = []
  for (const m of marks) {
    if (m.points?.length && (m.kind === 'pen' || m.kind === 'arrow')) {
      parts.push(`<polyline points="${m.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${MARK}" stroke-width="${line}" stroke-linecap="round" stroke-linejoin="round"/>`)
      parts.push(badge(m.points[0].x, m.points[0].y, m.n))
    } else if (m.rect && m.kind === 'pin') {
      parts.push(badge(m.rect.x, m.rect.y, m.n))
    } else if (m.rect) {
      parts.push(`<rect x="${m.rect.x}" y="${m.rect.y}" width="${Math.max(1, m.rect.w)}" height="${Math.max(1, m.rect.h)}" fill="${MARK}" fill-opacity="0.08" stroke="${MARK}" stroke-width="${line}"/>`)
      parts.push(badge(m.rect.x, m.rect.y, m.n))
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

/** PNG data URL of the frame at `time` with the marks drawn on it (undefined when it cannot be made) */
export async function annotatedFrame(projectId: string, marks: FeedbackMark[], time: number): Promise<string | undefined> {
  const st = projects.state(projectId)
  const { width, height } = st.brief.output
  projects.refreshFontCss(st.path)
  const [png] = await snapshot(join(st.path, 'composition'), [Math.max(0, time)], join(st.path, '.cache', 'web-frame'))
  if (!png) return undefined
  const out = await sharp(png)
    .resize(width, height, { fit: 'fill' })
    .composite([{ input: Buffer.from(marksSvg(marks, width, height)) }])
    .png()
    .toBuffer()
  return `data:image/png;base64,${out.toString('base64')}`
}
