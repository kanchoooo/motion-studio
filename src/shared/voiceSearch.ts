// Finding a TTS voice in Korean: the services describe voices in English
// ("calm Korean female voice … narration"), so Korean words are mapped to the
// English terms they use, and feelings / uses become clickable filters.
import type { AiVoiceInfo } from './ai'

/** Korean word → English terms found in voice names, descriptions and languages */
const SYNONYMS: [RegExp, string[]][] = [
  [/한국|한글|국내/, ['korean']],
  [/영어|미국|영국|english/, ['english', 'american', 'british']],
  [/일본/, ['japanese']],
  [/중국/, ['chinese', 'mandarin', 'cantonese']],
  [/스페인/, ['spanish']],
  [/프랑스|불어/, ['french']],
  [/독일/, ['german']],
  [/여성|여자/, ['female', 'woman']],
  [/남성|남자/, ['male', 'man']],
  [/젊|청년|20대|어린/, ['young', 'youthful']],
  [/중년|30대|40대|어른/, ['middle_aged', 'middle-aged', 'mature']],
  [/노인|할머니|할아버지|50대|60대|나이 든/, ['old', 'elderly', 'senior']],
  [/아이|어린이|키즈/, ['child', 'kid']],
  [/차분|조용|침착/, ['calm', 'soft', 'gentle', 'soothing', 'steady']],
  [/밝|명랑|쾌활|경쾌/, ['bright', 'cheerful', 'upbeat', 'lively', 'happy']],
  [/따뜻|다정|포근/, ['warm', 'friendly', 'caring', 'tender']],
  [/신뢰|믿음|전문|권위/, ['trust', 'professional', 'authorit', 'confident', 'credible']],
  [/에너지|힘찬|활기|역동/, ['energetic', 'dynamic', 'powerful', 'enthusiastic', 'bold']],
  [/부드러|감성|잔잔/, ['soft', 'smooth', 'gentle', 'emotional', 'tender']],
  [/중후|낮은|저음|굵/, ['deep', 'low', 'rich', 'resonant', 'baritone']],
  [/고음|맑은|청아/, ['clear', 'bright', 'crisp']],
  [/속삭|ASMR/i, ['whisper', 'asmr', 'breathy']],
  [/내레이션|나레이션|해설|낭독/, ['narration', 'narrator', 'storytelling', 'audiobook', 'documentar']],
  [/광고|CF|홍보|커머셜/i, ['commercial', 'advertis', 'promo', 'marketing', 'sales']],
  [/뉴스|아나운서|앵커/, ['news', 'anchor', 'announcer', 'broadcast']],
  [/대화|일상|자연스러/, ['conversational', 'natural', 'casual', 'everyday']],
  [/교육|강의|설명/, ['educational', 'e-learning', 'tutorial', 'explainer', 'informative']],
  [/게임|캐릭터|애니/, ['character', 'game', 'animation', 'cartoon']],
  [/귀여|깜찍/, ['cute', 'playful', 'sweet']],
  [/고급|럭셔리|우아/, ['luxur', 'elegant', 'sophisticated', 'premium']],
]

/** quick filters the designer can tap (each maps to description keywords) */
export const VOICE_FEELINGS: { id: string; label: string; terms: string[] }[] = [
  { id: 'calm', label: '차분한', terms: ['calm', 'soothing', 'steady', 'gentle', 'composed'] },
  { id: 'bright', label: '밝은', terms: ['bright', 'cheerful', 'upbeat', 'lively', 'happy', 'energetic'] },
  { id: 'warm', label: '따뜻한', terms: ['warm', 'friendly', 'caring', 'tender', 'kind'] },
  { id: 'trust', label: '신뢰감', terms: ['trust', 'professional', 'authorit', 'confident', 'credible', 'clear'] },
  { id: 'deep', label: '중후한', terms: ['deep', 'low', 'rich', 'resonant', 'baritone', 'mature'] },
  { id: 'narration', label: '내레이션', terms: ['narrat', 'storytell', 'audiobook', 'documentar'] },
  { id: 'ad', label: '광고', terms: ['commercial', 'advertis', 'promo', 'marketing', 'sales', 'brand'] },
  { id: 'news', label: '뉴스·아나운서', terms: ['news', 'anchor', 'announcer', 'broadcast'] },
  { id: 'casual', label: '대화체', terms: ['conversational', 'casual', 'natural', 'everyday'] },
]

export const VOICE_LANGUAGES: { id: string; label: string; match: string[] }[] = [
  { id: 'ko', label: '한국어', match: ['korean'] },
  { id: 'en', label: '영어', match: ['english'] },
  { id: 'ja', label: '일본어', match: ['japanese'] },
  { id: 'zh', label: '중국어', match: ['chinese', 'mandarin', 'cantonese'] },
]

export interface VoiceFilter {
  query: string
  language: string // '' | VOICE_LANGUAGES id
  gender: string // '' | female | male
  age: string // '' | young | middle_aged | old
  feelings: string[]
}

const hay = (v: AiVoiceInfo) => [v.name, v.description, v.gender, v.age, v.engine, ...(v.languages ?? [])].filter(Boolean).join(' ').toLowerCase()

/** each typed word must match (in Korean or via its English synonyms) */
export function matchesQuery(v: AiVoiceInfo, query: string): boolean {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!words.length) return true
  const h = hay(v)
  return words.every((w) => {
    if (h.includes(w)) return true
    const terms = SYNONYMS.filter(([re]) => re.test(w)).flatMap(([, t]) => t)
    // gender words must not match inside "female"
    return terms.some((t) => (t === 'male' || t === 'man' ? new RegExp(`(^|[^e])${t}\\b`).test(h) : h.includes(t)))
  })
}

export function speaksLanguage(v: AiVoiceInfo, langId: string): boolean | null {
  const lang = VOICE_LANGUAGES.find((l) => l.id === langId)
  if (!lang) return true
  if (v.multilingual) return true
  if (!v.languages?.length) return null // unknown (e.g. Higgsfield presets)
  return v.languages.some((x) => lang.match.some((m) => x.toLowerCase().includes(m)))
}

export function filterVoices(list: AiVoiceInfo[], f: VoiceFilter): AiVoiceInfo[] {
  const out = list.filter((v) => {
    if (f.gender && v.gender !== f.gender) return false
    if (f.age && v.age !== f.age) return false
    if (f.language && speaksLanguage(v, f.language) === false) return false
    if (f.feelings.length) {
      const d = (v.description ?? '').toLowerCase()
      if (!f.feelings.every((id) => VOICE_FEELINGS.find((x) => x.id === id)?.terms.some((t) => d.includes(t)))) return false
    }
    return matchesQuery(v, f.query)
  })
  // voices that clearly speak the chosen language first, then ones with a free preview
  const score = (v: AiVoiceInfo) => (f.language && speaksLanguage(v, f.language) === true && !v.multilingual ? 0 : f.language && v.multilingual ? 1 : 2) * 2 + (v.previewUrl ? 0 : 1)
  return out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
}

/** Korean tags for a voice (from its English description), for the list */
export function voiceTags(v: AiVoiceInfo): string[] {
  const d = (v.description ?? '').toLowerCase()
  return VOICE_FEELINGS.filter((f) => f.terms.some((t) => d.includes(t))).map((f) => f.label)
}

export const GENDER_LABEL: Record<string, string> = { female: '여성', male: '남성', neutral: '중성' }
export const AGE_LABEL: Record<string, string> = { young: '젊은', middle_aged: '중년', old: '노년' }

export function languageLabel(v: AiVoiceInfo): string | undefined {
  if (v.multilingual) return '다국어'
  const l = v.languages?.[0]
  if (!l) return undefined
  const k = VOICE_LANGUAGES.find((x) => x.match.some((m) => l.toLowerCase().includes(m)))
  return k ? k.label : l
}
