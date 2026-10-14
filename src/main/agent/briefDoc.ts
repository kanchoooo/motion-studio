// composition/BRIEF.md: the designer's brief in the HyperFrames brief format, so the
// official workflows take their "BRIEF.md exists" path (no interview, companion flow,
// storyboard reviewed before the build). The app owns this file: it is rewritten from
// brief.json when a session starts and whenever the brief is saved; get_brief stays the
// full source of truth.
import { join } from 'node:path'
import { ASSET_KIND_LABELS, describeTiming, OUTPUT_PRESETS, type Brief } from '@shared/brief'
import { directionForClaude, styleLabels } from '@shared/direction'
import { writeText } from '../util'

const DESTINATION: Record<string, string> = { 'youtube-16x9': 'youtube', 'shorts-9x16': 'shorts-reels', 'feed-4x5': 'instagram-feed', 'square-1x1': 'square-feed' }
const q = (s: string) => JSON.stringify(s.replace(/\s+/g, ' ').trim())

export function briefMarkdown(brief: Brief): string {
  const o = brief.output
  const preset = OUTPUT_PRESETS.find((p) => p.id === o.preset)
  const message = brief.campaign || brief.title || brief.client || '광고'
  const lines = [
    '---',
    'workflow: general-video',
    'flow: companion',
    'storyboard: yes',
    `message: ${q(message)}`,
    `destination: ${DESTINATION[o.preset] ?? 'custom'}`,
    `aspect: ${o.width}x${o.height}`,
    'language: ko',
    `length: ${+o.duration.toFixed(2)}s`,
    `fps: ${o.fps}`,
    '---',
    '',
    '<!-- Written by Motion Studio from the designer\'s brief (brief.json). Do not edit: the app rewrites it. get_brief has every detail; record your own decisions in DESIGN.md and STORYBOARD.md. -->',
    '',
    '## Intent',
    '',
    [
      `${[brief.client, brief.campaign].filter(Boolean).join(' · ') || brief.title} — ${preset ? `${preset.ratio} ${preset.label}` : `${o.width}×${o.height}`}, ${+o.duration.toFixed(2)}초 광고 영상.`,
      brief.tone.trim() ? `톤앤매너(디자이너의 말 그대로): ${brief.tone.trim()}` : '',
      'Quality bar: a top brand\'s real paid ad — not "good for code". Arrive as the director with the ceiling treatment.',
    ]
      .filter(Boolean)
      .join('\n'),
  ]
  if (brief.assets.length) {
    lines.push('', '## Assets', '')
    for (const a of brief.assets) {
      const rules = [a.required ? '필수' : '', a.transform === 'none' ? '변형 금지' : a.transform === 'crop-only' ? '자르기만' : '', a.timing.mode !== 'any' ? describeTiming(a.timing) : '', a.note.trim()].filter(Boolean)
      lines.push(`- ${a.file} — ${ASSET_KIND_LABELS[a.kind]} (${a.originalName})${rules.length ? ` · ${rules.join(' · ')}` : ''}`)
    }
  }
  const custom: string[] = []
  for (const t of brief.texts) custom.push(`- 필수 문구${t.locked ? '(글자 그대로)' : ''}: ${q(t.text)}${t.timing.mode !== 'any' ? ` · ${describeTiming(t.timing)}` : ''}`)
  if (brief.storyboard.length) custom.push(`- 디자이너가 짠 장면 ${brief.storyboard.length}개 (get_brief의 storyboard): 순서와 장면 길이, 문구를 따른다.`)
  if (brief.ai.narration.enabled) custom.push(`- 내레이션${brief.ai.narration.voiceName ? ` (${brief.ai.narration.voiceName})` : ''}${brief.ai.narration.script ? `: ${q(brief.ai.narration.script)}` : ' — 대본은 Claude가 쓴다'}`)
  const dir = directionForClaude(brief.tempo, brief.styles)
  if (dir?.tempo) custom.push(`- 템포(디자이너가 고름): ${dir.tempo}`)
  if (dir?.styles) custom.push(`- 스타일(디자이너가 고름, ${styleLabels(brief.styles)}):`, ...dir.styles.map((x) => `  - ${x}`))
  if (dir) custom.push(`  - ${dir.note}`)
  if (brief.brand) custom.push(`- 브랜드 키트 "${brief.brand.name}": 색 ${brief.brand.colors.map((c) => `${c.name} ${c.hex}`).join(', ') || '-'} · 글꼴 ${[brief.brand.fonts.headline, brief.brand.fonts.body].filter(Boolean).join(' / ') || '-'}`)
  if (custom.length) lines.push('', '## Customizations', '', ...custom)
  lines.push(
    '',
    '## Notes',
    '',
    '- Motion Studio app: composition/ is the HyperFrames project and composition/index.html the root. The designer reviews the plan as a storyboard card in the app (propose_storyboard), not storyboard.html or Studio.',
    '- Never run init, render, preview or publish: the app previews live and exports. The designer\'s hand edits (get_designer_edits) always win.',
    o.safeZone !== 'none' ? `- Platform safe zone: ${o.safeZone} — keep copy and key visuals inside it.` : '',
    brief.references.length ? `- The designer added ${brief.references.length} reference(s): study their motion with get_references before planning.` : '- No references were given: research strong real ads for this category before planning.',
    '',
  )
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

/** (re)writes composition/BRIEF.md for a project folder */
export function writeBriefDoc(projectDir: string, brief: Brief): void {
  writeText(join(projectDir, 'composition', 'BRIEF.md'), briefMarkdown(brief))
}
