// PSD import: either the flattened image, or every visible layer as its own PNG
// with its position on the original canvas (so Claude can rebuild the layout).
// Pixels are decoded by ag-psd and written as PNG by the bundled FFmpeg.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initializeCanvas, readPsd, type Layer } from 'ag-psd'
import { bin } from './paths'
import { safeName, uniquePath } from './util'

export interface PsdPart {
  file: string
  name: string
  left: number
  top: number
  width: number
  height: number
  canvas: { width: number; height: number }
}

type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

// we only ever use raw pixel buffers (useImageData), never a real canvas
initializeCanvas(
  () => {
    throw new Error('canvas not available')
  },
  ((width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' })) as unknown as Parameters<typeof initializeCanvas>[1],
)

function writePng(px: Pixels, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin.ffmpeg(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${px.width}x${px.height}`, '-i', '-', '-frames:v', '1', out], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg ${code}`))))
    p.stdin.end(Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength))
  })
}

export async function importPsd(src: string, outDir: string, mode: 'flat' | 'layers'): Promise<PsdPart[]> {
  const psd = readPsd(readFileSync(src), { useImageData: true, skipThumbnail: true, skipLayerImageData: mode === 'flat' })
  const canvas = { width: psd.width, height: psd.height }
  const base = safeName(src.split(/[\\/]/).pop()!.replace(/\.psd$/i, ''), 'psd').replace(/\s+/g, '_')
  const parts: PsdPart[] = []
  if (mode === 'flat') {
    if (!psd.imageData) throw new Error('이 PSD에는 합쳐진 이미지가 저장되어 있지 않아요. 포토샵에서 "호환성 최대화"로 저장해 주세요.')
    const out = uniquePath((n) => join(outDir, `${base}${n ? `_${n + 1}` : ''}.png`))
    await writePng(psd.imageData as Pixels, out)
    return [{ file: out, name: base, left: 0, top: 0, width: psd.width, height: psd.height, canvas }]
  }
  const walk = (layers: Layer[] | undefined, prefix: string): Layer[] =>
    (layers ?? []).flatMap((l) => (l.hidden ? [] : l.children ? walk(l.children, `${prefix}${l.name ?? ''}/`) : [{ ...l, name: `${prefix}${l.name ?? 'layer'}` }]))
  const leaves = walk(psd.children, '').filter((l) => l.imageData && (l.right ?? 0) > (l.left ?? 0) && (l.bottom ?? 0) > (l.top ?? 0)).slice(0, 80)
  for (const l of leaves) {
    const name = safeName(l.name!.replace(/\//g, '-'), 'layer').replace(/\s+/g, '_')
    const out = uniquePath((n) => join(outDir, `${base}__${name}${n ? `_${n + 1}` : ''}.png`))
    await writePng(l.imageData as Pixels, out)
    parts.push({ file: out, name: l.name!, left: l.left ?? 0, top: l.top ?? 0, width: (l.right ?? 0) - (l.left ?? 0), height: (l.bottom ?? 0) - (l.top ?? 0), canvas })
  }
  if (!parts.length) throw new Error('가져올 수 있는 보이는 레이어가 없어요.')
  return parts
}
