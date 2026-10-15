// Motion Studio checks on top of HyperFrames' own. Since 0.5 only what breaks the video or
// the designer's work is an error (size, length, missing fonts, duplicate ids, removed locked
// layers); how editable the video is comes afterwards (the app's 편집 정리), so it is only info.
// Messages are written for Claude but phrased so they can also be shown to the designer.
import { CAMERA_ID, isPartId, PART_SEP } from '@shared/overrides'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckFinding } from '@shared/api'
import type { Brief } from '@shared/brief'
import type { Overrides } from '@shared/overrides'
import { makeTimeMap } from '@shared/timeRemap'
import { findFamily, usedFamilies } from './fontcss'
import { hasFont } from './fonts'
import { webFontFamilies } from './webfonts'
import { check as hfCheck } from './hyperframes'

export interface EditorElementInfo {
  id: string
  label: string
  movable: boolean
}

/** what the runtime found in a hidden render of the composition (see audit.ts) */
export interface AuditInfo {
  loose: { id: string; label: string; text: string; images: number }[]
  stale: string[]
  /** every editable element; transformable=false = still placed by flex/grid/flow */
  elements?: { id: string; label: string; transformable?: boolean }[]
}

/** latest element list reported by the editor preview, per project */
export const lastElements = new Map<string, EditorElementInfo[]>()

const REQUIRED_SCRIPTS = ['vendor/gsap.min.js', 'ms/overrides.js', 'ms/runtime.js']
// HyperFrames Studio timeline-lane advice; Motion Studio has its own timeline
const IGNORED_HF_CODES = new Set(['nested_structure_needs_subcomposition'])
const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy'])

const norm = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

export function staticFindings(html: string, brief: Brief, overrides: Overrides, elements?: EditorElementInfo[], audit?: AuditInfo, webFonts: string[] = []): CheckFinding[] {
  const ownFont = (fam: string) => webFonts.some((w) => w.toLowerCase() === fam.toLowerCase())
  const out: CheckFinding[] = []
  const head = html.split(/<\/head>/i)[0] ?? ''

  // 1. app-managed scripts, in order, before any authored script
  let last = -1
  for (const s of REQUIRED_SCRIPTS) {
    const i = head.indexOf(`src="${s}"`)
    if (i < 0) out.push({ severity: 'info', code: 'ms_script_missing', message: `<head>에 <script src="${s}"></script>가 없어요. 턴이 끝나면 앱이 다시 넣어요(지우지 마세요).` })
    else if (i < last) out.push({ severity: 'info', code: 'ms_script_order', message: `앱 스크립트 순서가 바뀌었어요(vendor/gsap.min.js → ms/overrides.js → ms/runtime.js). 턴이 끝나면 앱이 바로잡아요.` })
    last = Math.max(last, i)
  }

  if (!/<link[^>]+href="ms\/fonts\.css"/.test(head)) {
    out.push({ severity: 'info', code: 'ms_fonts_css_missing', message: '<head>에 <link rel="stylesheet" href="ms/fonts.css" />가 없어요. 턴이 끝나면 앱이 다시 넣어요.' })
  }
  for (const fam of usedFamilies(html, overrides)) {
    if (!findFamily(fam) && !ownFont(fam)) out.push({ severity: 'error', code: 'ms_font_missing', message: `"${fam}" 폰트가 이 컴퓨터에 없고 프로젝트에 받아 둔 웹 폰트도 아니에요. get_fonts의 설치된 폰트를 쓰거나 get_web_font로 받아 주세요.` })
  }

  // 2. offline: no network scripts/styles (company networks, determinism)
  const external = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/gi)].map((m) => m[1])
  for (const url of external) {
    if (/\bgsap\b/i.test(url)) continue // the app points CDN GSAP at its local copy (headFix)
    out.push({ severity: 'warning', code: 'ms_network_dependency', message: `외부 주소를 불러와요(${url}). 내보낼 때 인터넷이 필요해요. 파일을 프로젝트에 받아 두면(ai_import, get_web_font) 오프라인에서도 같아요.` })
  }

  // 3. references must never end up in the output
  if (/(\.\.\/)+references\/|\/references\//.test(html)) {
    out.push({ severity: 'error', code: 'ms_reference_leak', message: '첨부 폴더(references/)의 파일을 직접 쓰고 있어요. 내보내기에는 들어가지 않아요. 영상에 쓰려면 use_as_material로 소재함에 넣고 그 경로를 쓰세요.' })
  }

  // 4. editable element ids
  const ids = [...html.matchAll(/data-ms-id="([^"]+)"/g)].map((m) => m[1])
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) out.push({ severity: 'error', code: 'ms_duplicate_id', message: `data-ms-id="${id}"가 두 번 이상 쓰였어요. 요소마다 고유해야 해요.`, elementId: id })
    seen.add(id)
  }
  const tags = [...html.matchAll(/<[a-z][^>]*data-ms-id="([^"]+)"[^>]*>/gi)]
  for (const [tag, id] of tags) {
    if (!/data-ms-label="[^"]+"/.test(tag)) out.push({ severity: 'info', code: 'ms_label_missing', message: `data-ms-id="${id}"에 data-ms-label(디자이너가 볼 한글 이름)이 없어요.`, elementId: id })
  }
  if (!html.includes('data-ms-empty') && ids.length === 0) {
    out.push({ severity: 'info', code: 'ms_no_editables', message: '아직 편집용 이름(data-ms-id)이 붙은 요소가 없어요. 영상이 완성되면 앱이 편집 정리를 요청해요.' })
  }
  // copies of a layer exist only at run time (ms-runtime.js), with what is inside them ("child@copy")
  const copies = new Set((overrides.duplicates ?? []).map((d) => d.id))
  for (const [id, e] of Object.entries(overrides.elements)) {
    if (seen.has(id) || copies.has(id) || copies.has(id.split('@').pop() ?? '')) continue
    // the camera and a character's parts ("<layer>::<part>") are not elements of the file
    if (id === CAMERA_ID || (isPartId(id) && seen.has(id.split(PART_SEP)[0]))) continue
    // a layer the app named inside a group ("<group>~<path>"): it lives as long as the group does
    if (id.includes('~') && seen.has(id.split('~')[0])) continue
    if (e.locked) out.push({ severity: 'error', code: 'ms_locked_removed', message: `디자이너가 잠근 레이어 "${e.label ?? id}"(${id})가 영상에서 사라졌어요. 잠긴 레이어는 지우거나 바꾸면 안 돼요. 같은 data-ms-id로 원래대로 되돌려 주세요.`, elementId: id })
    else out.push({ severity: 'warning', code: 'ms_override_orphan', message: `디자이너가 직접 수정한 요소 "${id}"가 영상에서 사라졌어요. 같은 data-ms-id로 다시 만들어 주세요.`, elementId: id })
  }
  for (const l of audit?.loose ?? []) {
    const what = [l.text && `글자("${l.text}")`, l.images && `이미지 ${l.images}개`].filter(Boolean).join('와 ')
    out.push({
      severity: 'info',
      code: 'ms_group_inner_not_editable',
      message: `"${l.label || l.id}"(${l.id}) 안의 ${what}에 data-ms-id가 없어요. 앱이 임시 이름("${l.id}~…")을 붙여 디자이너가 고칠 수는 있지만, 코드를 바꾸면 그 이름이 달라질 수 있어요. 그룹 안의 문구·이미지·버튼마다 data-ms-id·data-ms-label·data-ms-type을 붙이고, 그룹 안에서 position:absolute로 배치해 주세요.`,
      elementId: l.id,
    })
  }
  for (const key of audit?.stale ?? []) {
    out.push({ severity: 'info', code: 'ms_motion_edit_stale', message: `디자이너가 조정한 모션(${key})이 코드가 바뀌어서 적용되지 않아요. 같은 요소의 모션 순서와 속성을 유지하거나, 바꾼 이유를 알려 주세요.` })
  }

  // 5. canvas matches the brief
  const root = html.match(/<[a-z]+[^>]*data-composition-id="[^"]*"[^>]*>/i)?.[0] ?? ''
  const attr = (n: string) => parseFloat(root.match(new RegExp(`${n}="([\\d.]+)"`))?.[1] ?? 'NaN')
  const o = brief.output
  if (root) {
    const w = attr('data-width')
    const h = attr('data-height')
    // a same-ratio size variation keeps the composition and is scaled at export
    const scaled = (w !== o.width || h !== o.height) && Math.abs(w / h - o.width / o.height) < 0.002
    if ((w !== o.width || h !== o.height) && !scaled) out.push({ severity: 'error', code: 'ms_canvas_size', message: `화면 크기가 브리프(${o.width}×${o.height})와 달라요.` })
    // a speed-matched variation reaches the brief length through section speed
    const authored = Number.isFinite(attr('data-ms-authored-duration')) ? attr('data-ms-authored-duration') : attr('data-duration')
    const effective = makeTimeMap(authored, overrides.timeRemap).length
    // either Claude's own length matches the brief, or the designer's section speed brings it there
    // (a length the designer changed on purpose with "총 길이 변경 허용" is not Claude's to fix)
    if (Math.abs(authored - o.duration) > 0.05 && Math.abs(effective - o.duration) > 0.05) out.push({ severity: 'error', code: 'ms_duration', message: `영상 길이가 브리프(${o.duration}초)와 달라요.` })
  }

  return out
}

export async function fullCheck(projectDir: string, brief: Brief, overrides: Overrides, elements?: EditorElementInfo[], withRuntime = true, audit?: AuditInfo): Promise<CheckFinding[]> {
  const index = join(projectDir, 'composition', 'index.html')
  const html = existsSync(index) ? readFileSync(index, 'utf8') : ''
  const own = webFontFamilies(projectDir)
  const findings = staticFindings(html, brief, overrides, elements, audit, own)
  if (withRuntime && !html.includes('data-ms-empty="true"')) {
    const res = await hfCheck(join(projectDir, 'composition')).catch(() => null)
    for (const i of res?.issues ?? []) {
      if (IGNORED_HF_CODES.has(i.code)) continue
      if (i.code === 'font_family_without_font_face') {
        // HyperFrames only trusts fonts it can embed; installed system fonts render fine locally
        const families = (i.message.match(/declaration: ([^.]+)\./)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        for (const fam of families.filter((x) => !hasFont(x) && !GENERIC_FAMILIES.has(x.toLowerCase()) && !own.some((w) => w.toLowerCase() === x.toLowerCase()))) {
          findings.push({ severity: 'error', code: 'ms_font_missing', message: `"${fam}" 폰트가 이 컴퓨터에 설치되어 있지 않아요. 설치된 폰트로 바꿔 주세요.` })
        }
        continue
      }
      const sev = i.severity.toLowerCase()
      findings.push({
        severity: sev.startsWith('err') ? 'error' : sev.startsWith('info') ? 'info' : 'warning',
        code: `hf_${i.code}`,
        message: i.selector ? `${i.message} (${i.selector})` : i.message,
        time: i.time,
      })
    }
    if (res && !res.ok && !res.issues.length) findings.push({ severity: 'error', code: 'hf_check_failed', message: res.raw.slice(-1500) })
  }
  return findings
}
