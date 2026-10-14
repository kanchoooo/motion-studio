// "애프터이펙트 패키지" (experimental): a folder the designer opens in After Effects
// with File > Scripts > Run Script File… (build.jsx). The script rebuilds the video
// as a comp: live text layers, transparent PNG layers for everything else (an image
// sequence when the inside of an element changes over time, e.g. an SVG character
// acting), video and audio footage, and position / scale / rotation / opacity
// keyframes sampled every frame from the running composition (then thinned out).
// .aep itself is an undocumented binary format, so it is not written directly.
import { BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import type { FontFamily } from '@shared/api'
import { listFonts } from '../fonts'
import { serveFolder } from '../preview-server'
import * as projects from '../projects'
import { safeName, uniquePath } from '../util'
import { AE_PROBE } from './probe'

export interface AeProgress {
  phase: 'measuring' | 'capturing' | 'writing' | 'done' | 'error'
  percent: number
  message: string
  folder?: string
}

interface ProbeLayer {
  index: number
  id: string
  label: string
  kind: 'text' | 'raster' | 'video'
  w: number
  h: number
  src: string | null
  videoW: number
  videoH: number
  rate: number
  mediaStart: number
  text: {
    text: string
    /** where the letters are, from the element's origin */
    bounds: { x: number; y: number; w: number; h: number }
    /** the element also paints a box (background, border, shadow) */
    paints: boolean
    family: string
    weight: number
    italic: boolean
    size: number
    letterSpacing: number
    lineHeight: number
    color: string
    align: string
  } | null
}
type Sample = [number, number, number, number, number, number, number]

/** keeps the samples that matter: the rest is within `tol` of a straight line between kept ones */
export function thin(values: number[], tol: number): number[] {
  const n = values.length
  if (n <= 2) return [...Array(n).keys()]
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let gap = tol
    for (let i = a + 1; i < b; i++) {
      const v = values[a] + ((values[b] - values[a]) * (i - a)) / (b - a)
      const d = Math.abs(values[i] - v)
      if (d > gap) {
        gap = d
        worst = i
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return [...keep.keys()].filter((i) => keep[i])
}

/** CSS matrix → After Effects transform (anchor at the element's own origin) */
export function decompose([a, b, c, d, e, f]: number[]): { x: number; y: number; sx: number; sy: number; rot: number } {
  const sx = Math.hypot(a, b)
  const rot = (Math.atan2(b, a) * 180) / Math.PI
  const sy = sx ? (a * d - b * c) / sx : Math.hypot(c, d)
  return { x: e, y: f, sx: sx * 100, sy: sy * 100, rot }
}

const rgb = (css: string) => {
  const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255].map((v) => +v.toFixed(4)) : [0, 0, 0]
}

/** PostScript name AE needs, from the installed font list */
function postscriptOf(fonts: FontFamily[], family: string, weight: number, italic: boolean): string {
  const fam = fonts.find((f) => f.family === family || f.familyKo === family)
  if (!fam?.faces.length) return family.replace(/\s+/g, '')
  const faces = fam.faces.filter((x) => x.italic === italic).length ? fam.faces.filter((x) => x.italic === italic) : fam.faces
  return faces.reduce((best, x) => (Math.abs(x.weight - weight) < Math.abs(best.weight - weight) ? x : best)).postscript
}

/** JSON with every non-ASCII character escaped (ExtendScript reads the file as plain text) */
const lit = (v: unknown) => JSON.stringify(v)

export async function exportAePackage(projectId: string, opts: { name: string; copyTo?: string }, emit: (p: AeProgress) => void): Promise<string> {
  const dir = projects.pathOf(projectId)
  const { brief } = projects.state(projectId)
  const { width, height, fps } = brief.output
  const parent = opts.copyTo && existsSync(opts.copyTo) ? opts.copyTo : join(dir, 'renders')
  mkdirSync(parent, { recursive: true })
  const folder = uniquePath((n) => join(parent, `${safeName(opts.name, '모션스튜디오').replace(/\s+/g, '-')}-AE${n ? `-${n + 1}` : ''}`))
  const assets = join(folder, 'assets')
  mkdirSync(assets, { recursive: true })

  // the capture window leaves room around the canvas for what lies past its edges
  const M = Math.round(Math.max(width, height) * 0.25)
  const W = width + 2 * M
  const H = height + 2 * M
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.setAudioMuted(true)
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
  try {
    emit({ phase: 'measuring', percent: 2, message: '영상을 불러오고 있어요' })
    await win.loadURL(`${serveFolder(join(dir, 'composition'))}index.html?ms-preview=1`)
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await js<boolean>('!!(window.__player && window.__playerReady)')
      if (!ready) await new Promise((r) => setTimeout(r, 100))
    }
    if (!ready) throw new Error('영상을 불러오지 못했어요.')
    await js('document.fonts ? document.fonts.ready.then(() => true) : true')
    await js(AE_PROBE)
    const layers = await js<ProbeLayer[]>('window.__msAe.layers()')
    const duration = await js<number>('window.__player.getDuration()')
    const frames = Math.max(1, Math.round(duration * fps))
    const seek = (f: number) =>
      js(`(async () => { const P = window.__player; P.pause(); P.seek(${(f / fps).toFixed(5)}); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true })()`)

    // ---- every frame: where each layer is and how opaque ----
    const samples: Sample[][] = []
    for (let f = 0; f < frames; f++) {
      await seek(f)
      samples.push(await js<Sample[]>('window.__msAe.sample()'))
      if (f % 15 === 0) emit({ phase: 'measuring', percent: 2 + Math.round((f / frames) * 38), message: `움직임을 읽고 있어요 (${f}/${frames} 프레임)` })
    }

    // ---- pictures: one transparent PNG, or a sequence when the inside changes ----
    // the whole canvas is captured (glows, blurs and shadows reach far beyond an element's box), then
    // trimmed to what is painted; anchor = where the element's own origin is inside the picture
    /** the painted area of a bitmap (BGRA), or null when nothing is painted */
    const paintedBox = (bmp: Buffer, w: number, h: number) => {
      let x0 = w
      let y0 = h
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (bmp[(y * w + x) * 4 + 3] > 0) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
    }
    /** layer i alone on a transparent window larger than the canvas; o = its origin there */
    const shoot = async (i: number, f: number, noText: boolean) => {
      await seek(f)
      const o = await js<{ ox: number; oy: number }>(`window.__msAe.isolate(${i}, ${noText}, ${M})`)
      await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })
      await js('window.__msAe.release()')
      return { img, o }
    }
    // trimmed to what is painted; anchor = where the element's own origin is inside the picture
    const capture = async (i: number, f: number, noText = false) => {
      const { img, o } = await shoot(i, f, noText)
      const size = img.getSize()
      const box = paintedBox(img.toBitmap(), size.width, size.height)
      if (!box) return { png: Buffer.alloc(0), ax: 0, ay: 0, painted: false }
      return { png: img.crop(box).toPNG(), ax: o.ox - box.x, ay: o.oy - box.y, painted: true }
    }

    let fonts: FontFamily[] = []
    try {
      fonts = await listFonts()
    } catch {
      /* PostScript names fall back to the family name */
    }
    const used = new Map<string, string>()
    const out: Record<string, unknown>[] = []
    for (const L of layers) {
      emit({ phase: 'capturing', percent: 40 + Math.round((L.index / Math.max(1, layers.length)) * 50), message: `레이어를 만들고 있어요: ${L.label}` })
      const series = samples.map((s) => s[L.index])
      const vis = series.map((s) => s[6] > 0.001)
      const first = vis.indexOf(true)
      const last = vis.lastIndexOf(true)
      if (first < 0) continue
      const range = series.slice(first, last + 1)
      const tf = range.map((s) => decompose(s))
      // rotation without jumps at ±180°
      for (let k = 1; k < tf.length; k++) while (tf[k].rot - tf[k - 1].rot > 180) tf[k].rot -= 360
      for (let k = 1; k < tf.length; k++) while (tf[k].rot - tf[k - 1].rot < -180) tf[k].rot += 360
      const base: Record<string, unknown> = { name: L.label, in: first, out: last + 1 }
      /** keyframe tracks (thinned) for this layer; kx/ky: extra scale (video footage → element size) */
      const motionKeys = (kx: number, ky: number) => {
        const keys = (vals: number[], tol: number) => {
          const idx = thin(vals, tol)
          return idx.length === 1 || vals.every((v) => Math.abs(v - vals[0]) <= tol) ? [[first], [+vals[0].toFixed(3)]] : [idx.map((i) => first + i), idx.map((i) => +vals[i].toFixed(3))]
        }
        return {
          x: keys(tf.map((t) => t.x), 0.25),
          y: keys(tf.map((t) => t.y), 0.25),
          sx: keys(tf.map((t) => t.sx * kx), 0.25),
          sy: keys(tf.map((t) => t.sy * ky), 0.25),
          rot: keys(tf.map((t) => t.rot), 0.1),
          op: keys(range.map((s) => s[6] * 100), 0.5),
        }
      }
      let kx = 1
      let ky = 1

      let kind: ProbeLayer['kind'] | 'sequence' = L.kind
      let still: Awaited<ReturnType<typeof capture>> | null = null
      if (kind !== 'video') {
        // does the inside change over time? compare a few moments
        const probes = [...new Set([first, Math.round(first + (last - first) / 3), Math.round(first + ((last - first) * 2) / 3), last])]
        const shots: Awaited<ReturnType<typeof capture>>[] = []
        for (const f of probes) shots.push(await capture(L.index, f))
        const changes = shots.some((s) => !s.png.equals(shots[0].png))
        if (changes) kind = 'sequence'
        else if (kind === 'raster') {
          still = shots[0]
          if (!still.painted) continue
        }
      }

      if (kind === 'text' && L.text?.paints) {
        // the text element's own box (chip background etc.) goes underneath as a picture
        const boxShot = await capture(L.index, first, true)
        if (boxShot.painted) {
          const name = `${String(out.length + 1).padStart(2, '0')}-${safeName(L.id, 'layer')}-box.png`
          writeFileSync(join(assets, name), boxShot.png)
          out.push({ ...base, name: `${L.label} · 배경`, type: 'footage', file: name, anchor: [boxShot.ax, boxShot.ay], ...motionKeys(1, 1) })
        }
      }
      if (kind === 'text' && L.text) {
        const t = L.text
        const ps = postscriptOf(fonts, t.family, t.weight, t.italic)
        used.set(`${t.family} ${t.weight}`, ps)
        Object.assign(base, {
          type: 'text',
          text: t.text.replace(/\r?\n/g, '\r'),
          // a box just around the letters (+ a little so AE does not wrap differently); offset = where it starts
          box: [Math.ceil(t.bounds.w) + 6, Math.ceil(t.bounds.h) + 4],
          offset: [+t.bounds.x.toFixed(2), +t.bounds.y.toFixed(2)],
          font: ps,
          // the CSS face too (for the readme and for checking the package against the video)
          family: t.family,
          weight: t.weight,
          size: +t.size.toFixed(2),
          color: rgb(t.color),
          // AE tracking is in 1/1000 em, leading in px
          tracking: Math.round((t.letterSpacing / Math.max(1, t.size)) * 1000),
          leading: +t.lineHeight.toFixed(2),
          align: t.align === 'center' ? 'center' : t.align === 'right' || t.align === 'end' ? 'right' : 'left',
        })
      } else if (kind === 'video' && L.src) {
        const src = join(dir, 'composition', L.src)
        if (!existsSync(src)) continue
        const name = `${String(out.length + 1).padStart(2, '0')}-${basename(src)}`
        copyFileSync(src, join(assets, name))
        kx = L.videoW ? L.w / L.videoW : 1
        ky = L.videoH ? L.h / L.videoH : 1
        Object.assign(base, { type: 'footage', file: name, anchor: [0, 0], stretch: +(100 / (L.rate || 1)).toFixed(3) })
      } else if (kind === 'sequence') {
        const sub = `${String(out.length + 1).padStart(2, '0')}-${safeName(L.id, 'layer')}`
        mkdirSync(join(assets, sub), { recursive: true })
        let anchor: [number, number] | null = null
        // all frames share one picture area: the union of what any frame paints
        let union: { x: number; y: number; x1: number; y1: number } | null = null
        const files: string[] = []
        for (let f = first; f <= last; f++) {
          const { img, o } = await shoot(L.index, f, false)
          const size = img.getSize()
          const box = paintedBox(img.toBitmap(), size.width, size.height)
          if (box) union = union ? { x: Math.min(union.x, box.x), y: Math.min(union.y, box.y), x1: Math.max(union.x1, box.x + box.width), y1: Math.max(union.y1, box.y + box.height) } : { x: box.x, y: box.y, x1: box.x + box.width, y1: box.y + box.height }
          anchor ??= [o.ox, o.oy]
          const file = join(assets, sub, `frame_${String(f - first + 1).padStart(5, '0')}.png`)
          writeFileSync(file, img.toPNG())
          files.push(file)
          if ((f - first) % 20 === 0) emit({ phase: 'capturing', percent: 40 + Math.round((L.index / Math.max(1, layers.length)) * 50), message: `${L.label}: 프레임 ${f - first + 1}/${last - first + 1}` })
        }
        if (!anchor || !union) continue
        const u = union
        for (const file of files) {
          const cut = await sharp(file).extract({ left: u.x, top: u.y, width: u.x1 - u.x, height: u.y1 - u.y }).png().toBuffer()
          writeFileSync(file, cut)
        }
        Object.assign(base, { type: 'sequence', file: `${sub}/frame_00001.png`, anchor: [anchor[0] - u.x, anchor[1] - u.y] })
      } else if (still) {
        const name = `${String(out.length + 1).padStart(2, '0')}-${safeName(L.id, 'layer')}.png`
        writeFileSync(join(assets, name), still.png)
        Object.assign(base, { type: 'footage', file: name, anchor: [still.ax, still.ay] })
      } else continue

      Object.assign(base, motionKeys(kx, ky))
      out.push(base)
    }

    // ---- sound ----
    emit({ phase: 'writing', percent: 92, message: '소리와 스크립트를 쓰고 있어요' })
    const audio = await js<{ src: string; label: string; start: number; duration: number | null; mediaStart: number; volume: number }[]>('window.__msAe.audio()')
    const sounds: Record<string, unknown>[] = []
    for (const a of audio) {
      const src = join(dir, 'composition', a.src)
      if (!existsSync(src)) continue
      const name = `snd-${String(sounds.length + 1).padStart(2, '0')}${extname(src)}`
      copyFileSync(src, join(assets, name))
      sounds.push({ name: a.label, file: name, start: a.start, duration: a.duration, mediaStart: a.mediaStart, db: a.volume > 0 ? +(20 * Math.log10(a.volume)).toFixed(2) : -96 })
    }

    const data = { name: opts.name, width, height, fps, duration: frames / fps, frames, layers: out, sounds }
    writeFileSync(join(folder, 'build.jsx'), buildScript(data))
    writeFileSync(join(folder, 'data.json'), JSON.stringify(data, null, 1))
    writeFileSync(join(folder, '안내.txt'), readme(data, used))
    emit({ phase: 'done', percent: 100, message: 'AE 패키지를 만들었어요', folder })
    return folder
  } catch (e) {
    emit({ phase: 'error', percent: 0, message: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function readme(data: { width: number; height: number; fps: number; duration: number; layers: Record<string, unknown>[] }, fonts: Map<string, string>) {
  return [
    '모션스튜디오 → 애프터이펙트 패키지 (실험)',
    '',
    '여는 법',
    '1. 이 폴더를 통째로 두고(옮겨도 되지만 폴더 안 구성은 그대로),',
    '2. 애프터이펙트에서 파일 > 스크립트 > 스크립트 파일 실행… 으로 build.jsx 를 고릅니다.',
    `3. 새 컴포지션(${data.width}×${data.height}, ${data.fps}fps, ${data.duration.toFixed(2)}초)이 만들어집니다.`,
    '',
    '들어가는 것',
    '- 텍스트: 살아 있는 텍스트 레이어(폰트·크기·자간·행간·색·정렬)',
    '- 이미지·도형: 투명 PNG 레이어. 안쪽이 바뀌는 요소(캐릭터 연기 등)는 PNG 연속 이미지',
    '- 영상·배경음악·효과음·내레이션: 원본 파일 레이어',
    '- 움직임: 위치(X·Y 분리)·크기·회전·투명도 키프레임(매 프레임 읽은 뒤 꼭 필요한 것만 남김)',
    '',
    '알아 둘 것',
    '- 같은 폰트가 이 컴퓨터에 있어야 글자가 똑같이 보여요. 쓰인 폰트:',
    ...[...fonts].map(([k, v]) => `    ${k} → ${v}`),
    '- 한 텍스트 안에서 글자마다 색이 다르거나 글자별로 움직이는 효과는 텍스트 한 덩어리로 들어가요.',
    '- 마스크·블렌드·블러 같은 효과는 PNG에 그려진 모습 그대로 들어가요.',
    '- 레이어 순서는 화면에 그려지는 순서를 따라요.',
  ].join('\r\n')
}

/**
 * The After Effects script. ExtendScript is ES3 (no let/const, arrows or JSON) and
 * reads the file as plain text, so every non-ASCII character is escaped; property
 * names are AE match names, which stay the same in every AE language.
 */
export function buildScript(data: Record<string, unknown>): string {
  return escapeText(`// Motion Studio -> After Effects (experimental). File > Scripts > Run Script File
(function () {
  var D = ${lit(data)};
  var here = new File($.fileName).parent.fsName;
  var missing = [];
  app.beginUndoGroup('MotionStudio import');
  var folder = app.project.items.addFolder(D.name);
  var comp = app.project.items.addComp(D.name, D.width, D.height, 1, D.duration, D.fps);
  comp.parentFolder = folder;
  function file(rel) { return new File(here + '/assets/' + rel); }
  function importStill(rel) { var it = app.project.importFile(new ImportOptions(file(rel))); it.parentFolder = folder; return it; }
  function importSequence(rel) {
    var io = new ImportOptions(file(rel));
    io.sequence = true;
    io.forceAlphabetical = true;
    var it = app.project.importFile(io);
    it.mainSource.conformFrameRate = D.fps;
    it.parentFolder = folder;
    return it;
  }
  function tr(L) { return L.property('ADBE Transform Group'); }
  function put(prop, k) {
    var times = [], i;
    if (k[0].length === 1) { prop.setValue(k[1][0]); return; }
    for (i = 0; i < k[0].length; i++) times.push(k[0][i] / D.fps);
    prop.setValuesAtTimes(times, k[1]);
  }
  function motion(L, d) {
    var T = tr(L), pos = T.property('ADBE Position'), sc = [], i, sx = d.sx, sy = d.sy;
    pos.dimensionsSeparated = true;
    put(T.property('ADBE Position_0'), d.x);
    put(T.property('ADBE Position_1'), d.y);
    put(T.property('ADBE Rotate Z'), d.rot);
    put(T.property('ADBE Opacity'), d.op);
    // scale is 2D: both axes on the union of their keyframe times
    var times = [], seen = {}, list = sx[0].concat(sy[0]);
    for (i = 0; i < list.length; i++) if (!seen[list[i]]) { seen[list[i]] = 1; times.push(list[i]); }
    times.sort(function (a, b) { return a - b; });
    function at(k, f) {
      var j;
      if (k[0].length === 1 || f <= k[0][0]) return k[1][0];
      for (j = 1; j < k[0].length; j++) if (f <= k[0][j]) return k[1][j - 1] + (k[1][j] - k[1][j - 1]) * (f - k[0][j - 1]) / (k[0][j] - k[0][j - 1]);
      return k[1][k[1].length - 1];
    }
    if (times.length === 1) T.property('ADBE Scale').setValue([at(sx, times[0]), at(sy, times[0])]);
    else {
      var ts = [];
      for (i = 0; i < times.length; i++) { ts.push(times[i] / D.fps); sc.push([at(sx, times[i]), at(sy, times[i])]); }
      T.property('ADBE Scale').setValuesAtTimes(ts, sc);
    }
  }
  var i, d, L, item;
  for (i = 0; i < D.layers.length; i++) {
    d = D.layers[i];
    if (d.type === 'text') {
      L = comp.layers.addBoxText(d.box, d.text);
      var prop = L.property('ADBE Text Properties').property('ADBE Text Document');
      var doc = prop.value;
      try { doc.resetCharStyle(); } catch (e0) {}
      doc.font = d.font;
      doc.fontSize = d.size;
      doc.applyFill = true;
      doc.fillColor = d.color;
      doc.applyStroke = false;
      doc.tracking = d.tracking;
      try { doc.autoLeading = false; doc.leading = d.leading; } catch (e1) {}
      doc.justification = d.align === 'center' ? ParagraphJustification.CENTER_JUSTIFY : d.align === 'right' ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY;
      prop.setValue(doc);
      if (prop.value.font !== d.font) missing.push(d.font);
      // the box's top-left sits where the letters start inside the element
      var r = L.sourceRectAtTime(0, false);
      tr(L).property('ADBE Anchor Point').setValue([r.left - d.offset[0], r.top - d.offset[1]]);
    } else {
      item = d.type === 'sequence' ? importSequence(d.file) : importStill(d.file);
      L = comp.layers.add(item);
      tr(L).property('ADBE Anchor Point').setValue(d.anchor);
      if (d.stretch && d.stretch !== 100) L.stretch = d.stretch;
    }
    L.name = d.name;
    motion(L, d);
    if (d.type === 'sequence') L.startTime = d['in'] / D.fps;
    L.inPoint = d['in'] / D.fps;
    L.outPoint = d.out / D.fps;
  }
  for (i = 0; i < D.sounds.length; i++) {
    d = D.sounds[i];
    item = importStill(d.file);
    L = comp.layers.add(item);
    L.name = d.name;
    L.startTime = d.start - d.mediaStart;
    L.inPoint = d.start;
    if (d.duration) L.outPoint = d.start + d.duration;
    try { L.property('ADBE Audio Group').property('ADBE Audio Levels').setValue([d.db, d.db]); } catch (e2) {}
  }
  app.endUndoGroup();
  comp.openInViewer();
  if (missing.length) alert('이 컴퓨터에 없는 폰트가 있어서 다른 폰트로 보여요:\\n' + missing.join('\\n'));
})();
`)
}

const escapeText = (s: string) => s.replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
