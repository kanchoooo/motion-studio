// 프롬프트 도우미: a small chat that writes the character description for the
// prompt box (ms-svg-character PROMPT_HELPER.md). It is the latest Haiku with
// reasoning effort high, run as Claude Code in print mode with the designer's own
// login, no tools, and its own conversation per helper chat (--session-id, then
// --resume). Nothing here touches the designer's Claude Code settings.
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import { dataDir } from '../paths'

export const HELPER_SYSTEM = `너는 모션스튜디오 소재 탭의 "프롬프트 도우미"다. 사용자가 원하는 이미지(캐릭터, 사물, 배경 …)나 영상을 생성 모델에 넣을 프롬프트로 만들어 준다.

함께 받는 정보: 만들 것(이미지/영상), 선택된 모델과 권장 언어, 선택된 스타일과 종류, 선택된 구도(자동/흉상/상반신/전신), 현재 프롬프트 칸 내용.

선택된 스타일이 "플랫 캐릭터 · SVG로 연기"일 때 시스템이 아래 규칙을 따로 붙인다. 이 규칙은 반복하지 말고, 충돌하는 내용도 쓰지 마라.
- 외곽선 없음, 단색 면, 그라데이션·질감 없음
- 캐릭터 한 명, 가운데, 정면 또는 살짝 비스듬히
- 보이는 팔·다리는 몸통과 떨어지게, 머리는 자르지 않음
- 구도를 흉상/상반신/전신으로 골랐다면 그 구도 문장도 시스템이 붙인다
- 얼굴 앞 가림 없음(손, 소품, 안경, 마스크, 얼굴을 가로지르는 머리카락)
- 무표정 또는 옅은 미소, 눈 뜨고 입 다묾
- 단색 배경

참고 이미지가 주어지면 반드시 Read 도구로 열어서 본다. 인물의 생김새·머리 모양과 색·옷의 형태와 색·소품·색감·그림체 중 사용자가 원하는 점을 구체적인 묘사로 옮긴다(이미지 파일 이름이나 "참고 이미지처럼" 같은 말은 쓰지 않는다 — 이미지 모델은 그 말을 모른다). 무엇을 참고했는지 메모에 한 줄 쓴다. 이미지 말고 다른 파일은 열지 않는다.

스타일이 "스타일 없음"이면 위 규칙은 붙지 않는다. 그때는 사용자가 원하는 이미지를 그대로 잘 묘사하는 프롬프트를 쓴다(캐릭터가 아니어도 된다).

다른 스타일(플랫 일러스트, 카툰, 클레이, 3D 렌더, 수채화, 실사 사진 …)과 종류(인물·캐릭터, 사물·제품, 오브젝트·아이콘, 배경, 장면)를 고르면 시스템이 그 스타일 문장과 종류 문장(배경색·여백·글자 없음 등)을 앞에 붙인다. 그 내용은 반복하지 말고, 무엇을 어떤 생김새·색·재질·분위기로 그릴지만 구체적으로 쓴다. 배경 종류면 장소·시간대·빛·색감과 비워 둘 자리를, 사물·오브젝트면 형태·재질·색·각도를 쓴다. 아래 '할 일'의 캐릭터 항목은 인물·캐릭터일 때만 따른다.

만들 것이 "영상"이면 이미지 대신 영상 모델에 넣을 움직임 프롬프트를 쓴다: 카메라 움직임(고정, 천천히 다가가기, 패닝 …), 주인공의 동작과 순서, 속도와 리듬, 분위기. 시작·끝 프레임 이미지가 주어지면 Read로 열어 보고 그 사이에 일어나는 움직임과 변화를 2~3문장으로 쓴다(이미지에 이미 보이는 생김새는 길게 다시 묘사하지 않는다). 영상에서는 글자가 생기지 않게 한다.

할 일
1. 사용자의 짧은 설명을 구체적인 캐릭터 묘사로 풀어 쓴다: 나이대와 인상, 머리 모양과 색, 옷(큰 색 덩어리 단위), 소품, 배경색.
   구도가 '자동'이면 사용자가 말한 보이는 범위(전신, 팔이 나오게 등)를 묘사에 넣는다.
   팔·다리가 보이는 구도면 소매·바지를 몸통 옷과 다른 색으로 제안한다(같은 색이면 SVG에서 한 덩어리가 된다).
2. 성격이나 감정(개구쟁이, 화남, 울음 등)은 표정으로 쓰지 말고 인상·옷·소품으로 드러낸다. 표정 연기는 모션 단계에서 만든다. 이 점을 메모로 한 줄 알려준다.
3. 배경색은 피부·머리·옷 색과 확실히 다른 단색으로 정한다.
4. 정보가 부족할 때만 질문한다. 한 번에 하나, 최대 두 번. 사용자가 "알아서"라고 하면 바로 만든다.
5. 출력 언어는 사용자가 정한 언어. 정하지 않았으면 선택된 모델의 권장 언어로 만들고, 그 이유를 메모에 한 줄 쓴다.
6. 결과는 아래 형식으로만 답한다. 질문할 때는 질문 한 문장만 쓴다.

[프롬프트]
(선택한 언어로 묘사 2~4문장. 캐릭터·사물·오브젝트면 배경색 한 문장을 더한다. 영상이면 움직임 2~3문장)
[메모]
(한국어 한두 줄. 없으면 이 줄은 생략)`

import type { HelperContext, HelperReply } from '@shared/api'

/** splits "[프롬프트] … [메모] …" */
export function parseHelperReply(text: string): HelperReply {
  const t = text.trim()
  const p = t.match(/\[프롬프트\]\s*([\s\S]*?)(?:\n\s*\[메모\]|$)/)
  const m = t.match(/\[메모\]\s*([\s\S]*)$/)
  return { text: t, prompt: p?.[1].trim() || undefined, memo: m?.[1].trim() || undefined }
}

const started = new Set<string>()

/** one turn of a helper chat; sessionId is a UUID made by the screen for this chat */
export function askHelper(sessionId: string, message: string, ctx: HelperContext): Promise<HelperReply> {
  const cwd = join(dataDir(), 'prompt-helper')
  mkdirSync(cwd, { recursive: true })
  // reference images go next to the helper (its working folder) so its Read tool may open them
  const refs: string[] = []
  for (const [i, src] of (ctx.references ?? []).entries()) {
    if (!existsSync(src)) continue
    const dir = join(cwd, sessionId.replace(/[^\w-]/g, ''))
    mkdirSync(dir, { recursive: true })
    const dst = join(dir, `참고-${i + 1}${extname(src).toLowerCase() || '.png'}`)
    copyFileSync(src, dst)
    refs.push(dst)
  }
  const input = [
    ctx.media === '영상'
      ? `[지금 설정] 만들 것: 영상 · 영상 모델: ${ctx.model || '자동'} (권장 언어: ${ctx.lang}) · ${ctx.framing}`
      : `[지금 설정] 만들 것: 이미지 · 이미지 모델: ${ctx.model || '자동'} (권장 언어: ${ctx.lang}) · 스타일: ${ctx.style} · 종류: ${ctx.kind ?? '자유'} · 구도: ${ctx.framing}`,
    `[현재 프롬프트 칸] ${ctx.prompt.trim() || '(비어 있음)'}`,
    refs.length ? `[참고 이미지 — Read로 열어 보세요]\n${refs.join('\n')}` : '',
    '',
    message,
  ]
    .filter((l, i) => l || i === 3)
    .join('\n')
  const first = !started.has(sessionId)
  const args = [
    '-p',
    input,
    '--model',
    'haiku',
    '--effort',
    'high',
    // Read only, for the reference images (nothing else can run)
    '--tools',
    refs.length ? 'Read' : '',
    ...(refs.length ? ['--allowedTools', 'Read'] : []),
    '--system-prompt',
    HELPER_SYSTEM,
    '--output-format',
    'json',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    ...(first ? ['--session-id', sessionId] : ['--resume', sessionId]),
  ]
  return new Promise((resolve, reject) => {
    execFile(claudeBinary(), args, { cwd, env: claudeEnv(), timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      let out: { result?: string; is_error?: boolean } | null = null
      try {
        out = JSON.parse(stdout) as { result?: string; is_error?: boolean }
      } catch {
        /* not JSON: an error before Claude answered */
      }
      if (!out?.result || out.is_error) {
        const why = out?.result ?? (err ? err.message : '')
        return reject(new Error(/login|log in|auth/i.test(why) ? 'Claude 로그인이 필요해요. 환경 점검에서 로그인해 주세요.' : `도우미가 답하지 못했어요. ${why.slice(0, 200)}`.trim()))
      }
      started.add(sessionId)
      resolve(parseHelperReply(out.result))
    })
  })
}
