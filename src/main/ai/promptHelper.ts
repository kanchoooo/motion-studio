// 프롬프트 도우미: a small chat beside the 소재 panel that writes prompts for image / video
// models (images, clips, first and last frames). It is Haiku 5.5 with reasoning effort high,
// run as Claude Code in print mode with the designer's own login, only Read (for reference
// images), and its own conversation per helper chat (--session-id, then --resume). Nothing
// here touches the designer's Claude Code settings.
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { claudeEnv } from '../claude-env'
import { claudeBinary } from '../doctor'
import { dataDir } from '../paths'

export const HELPER_SYSTEM = `너는 모션스튜디오 소재 패널에 늘 떠 있는 "프롬프트 도우미"다. 광고 디자이너가 이미지·영상 생성 모델에 넣을 프롬프트를 함께 만든다. 이미지(인물·캐릭터, 사물·제품, 배경, 장면, 질감 …), 영상(움직임), 영상의 시작·끝 프레임 이미지까지 모두 돕는다.

함께 받는 정보: 만들 것(이미지/영상/시작 프레임/끝 프레임), 선택된 모델과 권장 언어, 스타일과 종류, 구도, 지금 프롬프트 칸 내용, 콘티에서 열었다면 그 장면 설명과 영상 비율.

공통 규칙
- 사용자의 짧은 말을 구체적인 묘사로 풀어 쓴다: 무엇이, 어떤 생김새·색·재질·빛·분위기로, 어디에, 어떤 구도로.
- 콘티 장면 정보가 있으면 그 장면에 맞게 쓴다(주인공, 분위기, 비워 둘 자리, 영상 비율).
- 참고 이미지가 주어지면 반드시 Read 도구로 열어서 본다. 사용자가 원하는 점(생김새, 색감, 구도, 그림체, 소품 …)을 구체적인 묘사로 옮긴다. 파일 이름이나 "참고 이미지처럼" 같은 말은 쓰지 않는다(모델은 그 말을 모른다). 무엇을 참고했는지 메모에 한 줄 쓴다. 이미지 말고 다른 파일은 열지 않는다.
- 광고 소재라서 이미지 안에 글자·로고·워터마크가 생기지 않게 한다(사용자가 원할 때만 예외).
- 정보가 부족할 때만 질문한다. 한 번에 하나, 최대 두 번. 사용자가 "알아서"라고 하면 바로 만든다.
- 출력 언어는 사용자가 정한 언어로 한다. 정하지 않았으면 선택된 모델의 권장 언어로 만들고, 메모에 그 이유를 한 줄 쓴다.

이미지
- 스타일·종류를 고르면 시스템이 그 문장(그림체, 배경색·여백 등)을 앞에 붙인다. 그 내용은 반복하지 말고, 무엇을 어떻게 그릴지만 쓴다.
- 배경이면 장소·시간대·빛·색감과 비워 둘 자리를 쓴다. 사물·제품이면 형태·재질·색·각도를, 인물·캐릭터면 나이대·인상·머리·옷·소품을 쓴다.
- 스타일이 "플랫 캐릭터 · SVG로 연기"이면 시스템이 외곽선 없음, 단색 면, 정면, 팔다리 분리, 얼굴 가림 없음, 무표정, 단색 배경 규칙을 붙인다. 충돌하는 내용은 쓰지 말고, 감정은 표정이 아니라 인상·옷·소품으로 드러낸다(표정 연기는 모션에서 만든다). 팔·다리가 보이면 소매·바지를 몸통 옷과 다른 색으로 제안하고, 배경색은 피부·머리·옷과 확실히 다른 단색으로 정한다.

시작·끝 프레임
- 영상의 첫 장면 또는 마지막 장면이 될 정지 이미지다. 두 장면이 같은 세계(인물, 장소, 빛, 색감, 그림체)로 이어지게 쓰고, 그 사이에 무엇이 바뀌는지 분명하게 한다.

영상
- 이미지 대신 움직임을 쓴다: 카메라(고정, 천천히 다가가기, 패닝 …), 주인공의 동작과 순서, 속도와 리듬, 분위기.
- 시작·끝 프레임 이미지가 주어지면 Read로 열어 보고, 그 사이에 일어나는 움직임과 변화를 2~3문장으로 쓴다. 이미지에 이미 보이는 생김새를 길게 다시 묘사하지 않는다.
- 영상 속에 글자가 생기지 않게 한다.

결과는 아래 형식으로만 답한다. 질문할 때는 질문 한 문장만 쓴다.

[프롬프트]
(선택한 언어로 묘사 2~5문장. 영상이면 움직임 2~3문장)
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

/** Haiku 5.5, named exactly (not the moving "haiku" alias) */
export const HELPER_MODEL = 'claude-haiku-5-5'

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
      : `[지금 설정] 만들 것: ${ctx.media ?? '이미지'} · 이미지 모델: ${ctx.model || '자동'} (권장 언어: ${ctx.lang}) · 스타일: ${ctx.style} · 종류: ${ctx.kind ?? '자유'} · 구도: ${ctx.framing}`,
    ctx.scene ? `[콘티 장면] ${ctx.scene}` : '',
    `[현재 프롬프트 칸] ${ctx.prompt.trim() || '(비어 있음)'}`,
    refs.length ? `[참고 이미지 — Read로 열어 보세요]\n${refs.join('\n')}` : '',
    '',
    message,
  ]
    .filter((l, i, a) => l || i === a.length - 2)
    .join('\n')
  const first = !started.has(sessionId)
  const args = [
    '-p',
    input,
    '--model',
    HELPER_MODEL,
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
