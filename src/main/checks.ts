// Motion Studio rules on top of HyperFrames' own checks. Messages are written
// for Claude (fixable) but phrased so they can also be shown to the designer.
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
    if (i < 0) out.push({ severity: 'error', code: 'ms_script_missing', message: `<head>에 <script src="${s}"></script>가 없어요. 필수 스크립트 3개(gsap → overrides → runtime)를 이 순서로 넣어 주세요.` })
    else if (i < last) out.push({ severity: 'error', code: 'ms_script_order', message: `필수 스크립트 순서가 바뀌었어요. vendor/gsap.min.js → ms/overrides.js → ms/runtime.js 순서여야 해요.` })
    last = Math.max(last, i)
  }

  if (!/<link[^>]+href="ms\/fonts\.css"/.test(head)) {
    out.push({ severity: 'error', code: 'ms_fonts_css_missing', message: '<head>에 <link rel="stylesheet" href="ms/fonts.css" />가 없어요. 시스템 폰트 선언 파일이라 꼭 필요해요.' })
  }
  for (const fam of usedFamilies(html, overrides)) {
    if (!findFamily(fam) && !ownFont(fam)) out.push({ severity: 'error', code: 'ms_font_missing', message: `"${fam}" 폰트가 이 컴퓨터에 없고 프로젝트에 받아 둔 웹 폰트도 아니에요. get_fonts의 설치된 폰트를 쓰거나 get_web_font로 받아 주세요.` })
  }

  // 2. offline: no network scripts/styles (company networks, determinism)
  const external = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/gi)].map((m) => m[1])
  for (const url of external) {
    out.push({ severity: 'warning', code: 'ms_network_dependency', message: `외부 주소를 불러와요(${url}). 오프라인에서도 동작하도록 빼 주세요. GSAP은 vendor/gsap.min.js를 쓰고, 폰트는 시스템 폰트 이름을 쓰세요.` })
  }

  // 3. references must never end up in the output
  if (/(\.\.\/)+references\/|\/references\//.test(html)) {
    out.push({ severity: 'error', code: 'ms_reference_leak', message: '레퍼런스 파일을 직접 사용하고 있어요. 레퍼런스는 참고만 하고 결과물에 넣으면 안 돼요.' })
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
    if (!/data-ms-label="[^"]+"/.test(tag)) out.push({ severity: 'warning', code: 'ms_label_missing', message: `data-ms-id="${id}"에 data-ms-label(디자이너가 볼 한글 이름)이 없어요.`, elementId: id })
  }
  if (!html.includes('data-ms-empty') && ids.length === 0) {
    out.push({ severity: 'error', code: 'ms_no_editables', message: '디자이너가 수정할 수 있는 요소(data-ms-id)가 하나도 없어요. 텍스트, 이미지, 도형마다 data-ms-id와 data-ms-label을 붙여 주세요.' })
  }
  for (const id of Object.keys(overrides.elements)) {
    if (!seen.has(id)) out.push({ severity: 'warning', code: 'ms_override_orphan', message: `디자이너가 직접 수정한 요소 "${id}"가 영상에서 사라졌어요. 같은 data-ms-id로 다시 만들어 주세요.`, elementId: id })
  }
  for (const e of elements ?? []) {
    if (!e.movable) out.push({ severity: 'warning', code: 'ms_not_absolute', message: `"${e.label}"(${e.id})가 position:absolute가 아니라서 디자이너가 위치를 옮길 수 없어요. 절대 위치로 배치해 주세요.`, elementId: e.id })
  }
  // groups (phone mockups, cards, UI screens): everything inside must be editable on its own
  // 편집 준비: elements still placed by the layout can only be moved, not scaled / rotated on their own
  const flow = (audit?.elements ?? []).filter((e) => e.transformable === false)
  if (flow.length)
    out.push({
      severity: 'warning',
      code: 'ms_not_edit_ready',
      message: `편집 준비 전이에요: 흐름 배치(flex·grid 등)로 놓인 편집 요소 ${flow.length}개 (${flow.slice(0, 12).map((e) => e.label || e.id).join(', ')}${flow.length > 12 ? ' …' : ''}). 마지막 단계에서 layout_snapshot(before) → measure_layout 값으로 절대 위치 → layout_snapshot(after)로 바꿔 주세요.`,
    })
  for (const l of audit?.loose ?? []) {
    const what = [l.text && `글자("${l.text}")`, l.images && `이미지 ${l.images}개`].filter(Boolean).join('와 ')
    out.push({
      severity: 'error',
      code: 'ms_group_inner_not_editable',
      message: `"${l.label || l.id}"(${l.id}) 안의 ${what}를 디자이너가 따로 고칠 수 없어요. 그룹 안의 문구·이미지·버튼마다 data-ms-id·data-ms-label·data-ms-type을 붙이고, 그룹 안에서 position:absolute로 배치해 주세요.`,
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

  // 6. required texts (verbatim when locked)
  const body = norm(html.split(/<body[^>]*>/i)[1] ?? html)
  const edited = Object.values(overrides.elements).map((e) => e.text).filter(Boolean).map((t) => norm(String(t)))
  for (const t of brief.texts) {
    if (!t.text.trim()) continue
    const want = norm(t.text)
    const present = body.includes(want) || edited.some((e) => e.includes(want))
    if (!present) {
      out.push({
        severity: t.locked ? 'error' : 'warning',
        code: 'ms_required_text',
        message: t.locked ? `필수 문구 "${t.text}"가 원문 그대로 들어가 있지 않아요. 한 글자도 바꾸지 말고 넣어 주세요.` : `필수 문구 "${t.text}"가 보이지 않아요.`,
      })
    }
  }

  // 7. required assets
  for (const a of brief.assets) {
    if (a.required && !html.includes(a.file)) {
      out.push({ severity: 'error', code: 'ms_required_asset', message: `필수 소재 "${a.originalName}"(${a.file})를 사용하지 않았어요.` })
    }
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
