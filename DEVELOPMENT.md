# 모션스튜디오 개발 가이드

Intel Mac, M칩(Apple Silicon) Mac, Windows에서 같은 방법으로 시작할 수 있다.

## 1. 준비물

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | 24 LTS (최소 22.12) | `.nvmrc` 참고. nvm·fnm·volta 중 편한 것 |
| Git | 아무 버전 | |
| Claude 계정 | Pro/Max/Team | 개발 테스트용. 각자 본인 계정 |
| 디스크 | 여유 5GB 이상 | node_modules ≈ 1GB, 렌더 엔진 ≈ 150MB |

Python, FFmpeg, Chrome, Claude Code CLI는 **따로 설치하지 않아도 된다**.
FFmpeg는 setup이 받아 오고, Chrome(렌더 엔진)도 setup이 확인하고 받는다. Claude Code는 Agent SDK 패키지에 OS·칩별로 들어 있다.

## 2. 시작

```bash
git clone <저장소> motion-studio && cd motion-studio
nvm use            # 또는 fnm use (Node 24)
npm run setup      # 의존성 + FFmpeg/ffprobe/yt-dlp + 렌더 엔진 + Claude 로그인 확인
npm run dev        # 개발 모드 실행
```

`npm run setup`은 다음을 순서대로 한다.

1. Node 버전을 확인한다.
2. `npm ci`로 설치한다. postinstall에서 node-pty의 `spawn-helper` 실행 권한을 고친다.
3. 이 OS·칩에 맞는 FFmpeg/ffprobe/yt-dlp를 `resources/bin/<os>-<arch>/`에 받고, SHA-256을 대조한다.
4. Claude 로그인 상태를 확인한다. 로그인이 안 돼 있으면 앱의 환경 점검 화면에서 하면 된다.
5. 렌더 엔진(Chrome)이 있는지 확인하고, 없으면 받는다.

### M칩 Mac 참고
- `npm ci`가 자동으로 arm64용 패키지를 받는다(`@anthropic-ai/claude-agent-sdk-darwin-arm64`, node-pty, sharp).
- Rosetta 터미널에서 설치하면 x64 패키지가 깔린다. `node -p process.arch`가 `arm64`인지 먼저 확인할 것.

### Windows 참고
- 설치·실행 모두 PowerShell에서 한다. 셸 스크립트는 쓰지 않는다.
- node-pty는 ConPTY를 사용한다(Windows 10 1809 이상).
- 한글 사용자 폴더 경로도 지원한다. 문제가 생기면 `MS_PROJECTS_DIR`로 프로젝트 위치를 바꿔서 확인한다.

## 3. 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 모드 (핫 리로드) |
| `npm run build` | 빌드 (`out/`) |
| `npm test` | 단위 테스트 (vitest) |
| `npm run typecheck` | 타입 검사 (main/preload, renderer) |
| `npm run test:e2e` | 화면 흐름 테스트 (Claude 호출 없음, 임시 폴더 사용) |
| `npm run test:live` | 실제 Claude로 브리프 → 콘티 → 제작까지 (사용량 소모) |
| `node tests/e2e/variations-quick.mjs` 등 | 기존 프로젝트로 베리에이션·사운드·기능 검수 (`MS_SANDBOX=<live-flow 폴더>`) |
| `npm run dist:mac` (`dist:mac-arm64`, `dist:mac-x64`) | Mac 설치 파일: 서명·공증 (`release/`, 6장 참고) |
| `npm run dist:win` | Windows 설치 파일 (미서명) |

E2E 스크린샷은 `tests/e2e/shots*/`에 저장된다. 기존 프로젝트로 검수하려면 다음을 실행한다.

```bash
MS_SANDBOX=<live-flow가 남긴 폴더> node tests/e2e/review.mjs
```

## 4. 구조

```
src/
  main/            Electron 메인 프로세스
    ai/            AI 서비스 연결 (힉스필드·매그니픽: 앱이 OAuth·MCP 클라이언트)
                   - accounts: 서비스별 계정 여러 개, 사용 중 계정 (토큰은 0600 파일, Windows는 DPAPI)
                   - connect: 로그인(동적 등록·PKCE·루프백), MCP 연결·토큰 갱신
                   - media: 결과 파일을 composition/assets/generated/에 저장
                   - catalog / tts: 모델·목소리 목록, 미리듣기 샘플
    access.ts      첫 실행 암호 (해시만 보관)
    audit.ts       숨은 창에서 영상을 열어 편집 가능 요소·그룹 내부·모션 상태 점검
    agent/         Claude 실시간 세션
                   - pty-session: 대화형 Claude Code를 PTY로 실행, 리모트 컨트롤
                   - transcript: 대화 기록 파일 추적
                   - mcp-http / tools: 앱 전용 도구
                   - prompt: 작업 규칙
    projects.ts    프로젝트 폴더, 브리프, 직접 수정값, 소재
    history.ts     이력 (isomorphic-git, 저장할 때마다 내용 해시)
    renders.ts     내보내기, 결과물 보관함
    audio.ts       BGM/효과음, 길이 변경을 index.html에 반영, 기본 효과음
    variations.ts  베리에이션 (크기·길이, Claude 재구성 대기열은 pty-session)
    references.ts  레퍼런스 (파일·유튜브, 장면 분석, dHash 복제 감지)
    psd.ts         PSD → PNG (합치기 / 레이어별 + 위치)
    brands.ts      브랜드 프리셋 (앱 전체 공유)
    trust.ts       Claude 폴더 신뢰 여부 읽기 (쓰지 않음)
    checks.ts      모션스튜디오 규칙 검사 + HyperFrames check
    fontcss.ts     시스템 폰트 @font-face local() 생성
    preview-server.ts
                   127.0.0.1 미리보기 서버
                   - 프로젝트마다 토큰 경로
                   - HyperFrames 런타임 주입
                   - MCP 엔드포인트
  preload/         window.studio API
  renderer/        React UI (디자이너 화면)
  runtime/ms-runtime.js
                   직접 수정값을 영상 위에 적용하는 런타임
                   (겉 상자, 구간 속도, 편집기 통신)
  shared/          타입과 공용 로직
resources/
  bin/<os>-<arch>/ FFmpeg 등 (git 제외, setup이 받음)
  claude-plugin/   HyperFrames 작성 스킬 (Claude에 --plugin-dir로 전달)
  sfx/             기본 효과음 (scripts/make-sfx.mjs로 합성)
poc/               Phase 0 기술 검증 기록 (RESULTS.md)
```

## 5. Claude 연동 원칙 (꼭 지킬 것)

- **원본 Claude Code를 그대로 실행한다.** 사용자는 Claude Code 자체 로그인으로 본인 계정에 로그인한다.
- **앱은 Claude 토큰을 저장하거나 전달하지 않는다.** 이것은 Anthropic 정책이다.
- 대화형 세션은 다음 옵션으로 실행한다.
  - `--remote-control`
  - `--permission-mode acceptEdits` + 허용·거부 규칙.
    - 프로젝트 안 편집은 묻지 않는다.
    - 앱이 관리하는 파일(`ms/`, `vendor/`, `assets/`, brief.json, overrides.json, references/, project.json, .history/, .studio/)은 거부 규칙으로 항상 막는다.
  - 그 밖의 권한 질문은 `PermissionRequest` **HTTP 훅**이 앱에 묻는다(`/hook/<토큰>/permission`, `agent/permissions.ts`).
    - "물어보기": 대화창 카드로 묻는다. 14분 안에 답이 없으면 거부한다.
    - "모두 허용": 앱이 바로 허용한다.
  - `--tools Read,Write,Edit,Glob,Grep,Skill,Agent,Bash,WebFetch,WebSearch` (Bash·웹은 위 질문을 거친다. Agent = 공식 흐름의 하위 에이전트)
  - PATH 맨 앞에 `userData/cli/`: `hyperframes`·`npx hyperframes`가 앱 안 HyperFrames CLI(앱의 노드)로 간다(`agent/cliShims.ts`). 이 명령들은 미리 허용.
  - 하위 에이전트는 덧붙인 시스템 프롬프트를 못 받으므로 `.studio/motion-studio-rules.md`(컴포지션 규칙)를 읽게 한다.
  - `PreToolUse` **HTTP 훅**(`/hook/<토큰>/pretool`): 대화에서 처음 영상 파일(composition/의 .html·.css·.js)을 쓰기 전에 대화 기록에 HyperFrames 라우터나 작업 흐름 스킬(`hyperframes`, `motion-graphics`, `product-launch-video` …)을 읽은 흔적이 있는지 확인하고, 없으면 돌려보내요(이유는 한국어로).
  - `PermissionRequest` 훅은 사람에게 묻기 전에 두 가지를 돌려보내요: 영상 파일을 고치는 셸 스크립트(python·node·sed -i·perl -i·리다이렉션·tee → Edit/Write로만), 설명(description)이 한국어가 아닌 명령.
  - 설정 `language: "Korean"`(Claude Code 응답 언어). 중간 메모까지 한국어로 쓰도록 프롬프트에 예시 문장도 있어요.
  - `--setting-sources ""` (개인 설정, 훅, 플러그인 제외)
  - `--strict-mcp-config` + 앱 MCP 서버만 연결
- **이어갈 대화**: 대화 기록 파일이 있을 때만 `--resume`, 없으면(첫 요청 전에 모델을 바꾼 새 프로젝트) 같은 id로 `--session-id`. `--resume`이 "No conversation found"로 끝나면 바로 새 대화로 다시 시작한다.
- **편집 잠금**: 세션이 `busy`인 동안 편집 탭은 보기·재생·선택만 된다. 모든 수정은 `editor/editLock.ts`의 `blockedEdit()`를 거친다(overrides 저장소의 모든 변경, 사운드 패널의 파일 교체). 캔버스 위 안내가 뜨고, 수정을 시도하면 깜빡인다.
- **메시지 입력**: 텍스트를 쓰고 0.8초 뒤 Enter를 따로 보낸다. 한 번에 보내면 붙여넣기로 인식된다.
- **폴더 신뢰 확인은 자동으로 답하지 않는다.** 터미널을 열고 안내만 한다.
- 개발 중 Claude Code 터미널 안에서 `npm run dev`를 실행하면 부모 세션의 `CLAUDE*` 환경변수가 이어진다. 그러면 대화 기록 저장이 꺼지므로, PTY를 띄울 때 이 변수들을 제거한다(`cleanEnv`).

## 5-1. AI 서비스 연결

| 서비스 | 연결 방식 | 로그인 |
|---|---|---|
| 힉스필드 `mcp.higgsfield.ai/mcp` | 앱이 MCP 클라이언트 | 앱의 "AI 연결" → 브라우저 OAuth |
| 매그니픽 `mcp.magnific.com` | 앱이 MCP 클라이언트 | 앱의 "AI 연결" → 브라우저 OAuth |
| 아트리스트 `mcp.artlist.io/mcp` | Claude Code가 MCP 클라이언트 (동적 등록이 꺼져 있음) | Claude 터미널의 `/mcp` → artlist → Authenticate |

- Claude는 앱 MCP의 중계 도구(`ai_status`, `ai_tools`, `ai_call`, `ai_import`)로 힉스필드·매그니픽을 써요. 결과 파일은 앱이 내려받아 프로젝트에 넣어요(세션에 셸이 없어서).
- 아트리스트를 켜면 세션 MCP 설정에 `artlist`가 추가되고 `mcp__artlist` 권한이 열려요. 후보는 `show_audio_candidates`로 사운드 패널에 보여줘요.
- 서비스 응답 형식(2026-10-13 실제 확인, 샘플: `tests/unit/fixtures/`)
  - 매그니픽 목록(`images_models_list`·`video_models_list`·`audio_voices_list`)은 JSON이 아니라 TOON 텍스트예요(`ai/toon.ts`).
  - 플랜 때문에 막힌 모델은 `unavailableToThisAccount`에 와요. 목소리에는 미리듣기 주소가 없어서 `audio_tts`로 샘플을 만들어요(creations_wait → creations_get).
  - 힉스필드는 JSON(structuredContent)이고 페이지가 나뉘어요. `models_explore`, `list_voices`(preview_url 있음)를 써요.
- 목소리 찾기의 한국어 검색어 → 영어 설명어 매핑과 느낌 칩은 `src/shared/voiceSearch.ts`에 있어요.
- 아트리스트 로그인은 `__artlist__` 보조 세션(아트리스트만 넣은 `--mcp-config`)에서 `/mcp`를 열어요. 토큰은 서버 이름과 주소로 저장돼서 프로젝트 세션들이 같이 써요.
- **소재 생성**(`ai/generate.ts`): 앱이 서비스 생성 도구를 직접 불러요.
  - 도구 입력 스키마로 프롬프트·모델·비율·개수·네거티브·참고 이미지 키를 찾아요.
  - 결과는 `.studio/generations/<id>/source.png` 후보로 저장하고, "소재에 추가"를 누르면 `composition/assets/gen-<id>/`로 옮겨요.
  - 스타일(룩) 13가지와 종류 6가지 문장은 `src/shared/genStyles.ts`(영어·중국어·한국어). 순서: 스타일 → 종류 → 구도(인물) → 디자이너 프롬프트 그대로. 바꾸면 `tests/e2e/style-samples.mjs`(Codex로 실제 샘플, `ONLY=clay,3d`로 일부만)로 확인해요.
- **영상 생성**(`ai/generateVideo.ts`): 영상 도구(힉스필드 `generate_video`, 매그니픽 `video_generate`) 스키마에서 프롬프트·모델(slug)·비율·길이와 시작·끝 프레임 자리를 찾아요.
  - 힉스필드: `start_image`/`end_image`, 또는 `medias: [{role, value}]`. 매그니픽: `keyframes: {start, end}`, 각각 `{type: "image", url}`(카탈로그 안내문 기준).
  - 이미지는 base64(설명에 있을 때) 또는 서비스의 업로드 도구로 올린 주소·id를 넣어요. 서명된 업로드 주소를 주면 PUT으로 올려요.
  - 결과는 `.studio/generations/<id>/video.mp4` + `poster.jpg` 후보예요. ⚠ 실제 계정으로는 아직 확인 전(이 개발 맥에 연결된 계정 없음).
- **AI 웹 수집**(`ai/webCollect.ts`): `claude -p --model sonnet --tools WebSearch,WebFetch --output-format stream-json --no-session-persistence`. 도구 사용(검색어·읽은 사이트)을 진행 줄로 보여주고, 결과 JSON(로고·이미지·색·사실·카피 + 출처)에서 이미지는 앱이 직접 받아요(https, 이미지 형식, 15MB 이하, 120px 이상). `.studio/collect/items.json`에 남고, 남은 것을 넣으면 이미지·로고 → 소재, 색 → 브랜드 색, 사실·카피 → 브랜드 메모.
- **캐릭터 SVG**(`character/`, ms-svg-character)
  - `img2svg/*.cjs`는 원본 그대로의 CommonJS예요. 설치본에 파일로 들어가서(`electron-builder.yml`) `sharp`·`@visioncortex/vtracer`(WASM, 버전 고정)를 node_modules에서 불러요. 변환은 `worker.cjs` 워커 스레드에서 해요.
  - Claude 도구: `character_info`, `character_tag`(tag.js + 차이 검사), `character_embed`(index.html의 호스트 요소 안에 인라인). 스킬은 `resources/claude-plugin/skills/svg-character-motion/`, 런타임은 `ms/svgrig.js`예요.
- **Codex CLI 이미지**(`ai/codex.ts`)
  - 상태: `codex app-server`에 JSON-RPC(initialize → initialized → account/read + account/rateLimits/read)로 물어요. 모델을 부르지 않아서 토큰이 들지 않아요(관제센터 대시보드와 같은 방식). 1분 캐시.
  - 생성: `codex exec -s read-only --enable image_generation --json [-i 참고] -`(프롬프트는 stdin)으로 내장 image_gen을 부르고, `$CODEX_HOME/generated_images/<thread>/`의 PNG를 가져와요.
  - `codex`는 보통 npm 스크립트(`#!/usr/bin/env node`)예요. Finder로 연 앱은 PATH가 짧으므로 로그인 셸 PATH와 흔한 설치 폴더를 붙여서 실행해요.
  - 모델 id는 `codex` / `gpt-image`이고, Claude 도구는 `codex_image`예요.
- **프롬프트 도우미**(`ai/promptHelper.ts`): `claude -p --model haiku --effort high --tools ""`를 쓰고, 대화는 `--session-id`/`--resume`로 이어가요. 사용자 설정은 건드리지 않아요.
- 모델·추론 강도는 세션을 `--model`/`--effort`로 다시 시작해서 바꿔요(`--resume`). 기본값은 `opus` + `high`예요(pty-session `DEFAULT_MODEL`/`DEFAULT_EFFORT`).
  - Claude Code의 `/model`·`/effort` 화면에서 Enter를 누르면 사용자 전체 기본값이 바뀌기 때문이에요.

## 6. 코드 서명과 공증 (Mac)

배포용 빌드는 `npm run dist:mac`(= `node scripts/build-mac.mjs`)으로 한다. M칩용과 Intel용 dmg·zip을 각각 만든다. `--arch arm64` 또는 `--arch x64`로 하나만 만들 수도 있다.
미니미광장·비둘기모니터와 **같은 서명 자산과 같은 규칙**을 쓴다.

**서명 자산**
- 인증서: `~/.minimi-signing/DeveloperID_Application.p12` (+ `p12-password`). 로그인 키체인에는 넣지 않는다.
- 공증: 키체인 프로필 `minimi-notary` (`xcrun notarytool store-credentials`로 한 번 저장해 둔 것)

**빌드 순서**
1. 공유 잠금 `~/.minimi-signing/.build.lock`을 잡는다. 다른 프로젝트의 서명 빌드가 돌고 있으면 끝날 때까지 기다린다.
2. 빌드 전용 임시 키체인을 만들어 .p12를 넣는다. 그래서 키체인 "허용" 창이 뜨지 않는다.
   - 임시 키체인은 검색 목록 **맨 뒤**에 붙이고, 빌드가 끝나면 성공·실패·중단 모두 빼고 지운다.
   - 로그인 키체인과 기본 키체인은 건드리지 않는다.
3. 각 CPU용 네이티브 패키지(`prepare-target`)와 FFmpeg(`fetch-binaries`)를 준비한 뒤 electron-builder를 실행한다.
   - 하드닝 런타임과 `build/entitlements.mac.plist`를 쓴다.
   - 서명 → 공증 → 스테이플 순서로 진행한다.
4. 마지막에 `spctl`과 `stapler`로 결과를 검사한다.

**서명 범위**
- 함께 넣은 FFmpeg, yt-dlp, PTY·sharp 네이티브 모듈은 우리 Developer ID로 서명한다.
- **Claude Code 실행 파일은 Anthropic 서명을 그대로 둔다**(`signIgnore`).

**참고**
- `electron-builder.config.cjs`는 위 스크립트 없이도 동작한다. 키체인에 Developer ID가 있으면 쓰고, `MS_SIGN_DEV=1`이면 Apple Development로 테스트 서명하고, 둘 다 없으면 서명하지 않는다.
- 설치본은 Node `--inspect`를 막는 퓨즈가 켜져 있어 Playwright Electron 실행기로 붙을 수 없다. `MS_APP_EXEC=<앱>/Contents/MacOS/MotionStudio node tests/e2e/smoke.mjs`는 Chromium 디버깅 포트로 연결한다.
- 설치본에는 `out/`, `package.json`, 실행에 필요한 `node_modules`만 들어간다. 다른 OS의 네이티브 파일과 개발용 캐시(`.v8-cache`)는 뺀다. 캐시를 넣으면 codesign이 수천 개 파일을 서명하느라 빌드가 끝나지 않는다.

### 개발 중 빠른 설치 (이 맥에만)
`npm run dist:mac-local` (= `node scripts/build-mac.mjs --local`)
- 이 맥의 CPU용 앱만 서명해서 만들어요. 공증·dmg·zip은 만들지 않아요. 이 맥에서 만든 앱이라 격리 표시가 없어요.
- `/Applications/MotionStudio.app`에 덮어써요. 앱이 열려 있으면 정상 종료한 뒤 설치하고 다시 열어요.
- 작업 중이면 앱이 종료를 묻고, 그때는 스크립트가 멈춰요.
- 빌드만 하려면 `npm run dist:mac-local-build`(= `--local --no-install`)를 써요. 테스트 중인 앱을 끄지 않아요. 설치는 사용자가 요청할 때만 해요.
- GitHub 릴리스는 하지 않아요. 와이프분께 배포할 때만 `--release`를 써요.

## 7. Claude 로그인과 키체인

- 로그인은 앱 안 터미널 창에서 **Claude Code 자체 로그인**(`claude auth login`)으로 한다. 로그인 정보는 Claude Code가 맥 키체인(Windows는 자격 증명)에 직접 저장하고, 앱은 보지도 저장하지도 않는다.
- 앱이 실행하는 모든 Claude 프로세스는 `claude-env.ts`의 환경을 쓴다.
  - `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` 등은 **넘기지 않는다**.
  - 장기 토큰이 키체인 로그인을 덮어쓰면 리모트 컨트롤이 잠기기 때문이다(관제센터에서 겪은 문제).
- 환경 점검이 확인하는 것:
  - 키체인 잠김
  - 로그인 방식이 claude.ai가 아닌 경우
  - 무시한 환경변수
- Electron 자체는 키체인을 쓰지 않는다(`use-mock-keychain`). 그래서 "Safe Storage" 키체인 확인 창이 반복해서 뜨지 않는다.
- 쉬고 있는 다른 프로젝트의 Claude 세션은 정리해서, 여러 프로세스가 동시에 토큰을 갱신하다 로그아웃되는 일을 줄인다.

## 8. 첫 실행 암호

- 지인에게만 공유하는 앱이라 처음 실행할 때 암호를 한 번 물어요(`src/main/access.ts`, 화면은 `LockScreen.tsx`).
  - 통과하면 앱 데이터 폴더에 `access.json`이 생기고, 다음부터는 묻지 않아요.
- 저장소에는 **암호 원문이 없고**, 솔트를 넣은 scrypt 해시만 있어요. 소스가 공개라 직접 빌드하면 우회할 수 있으니, 설치 파일을 가진 사람을 거르는 정도의 장치예요.
- 암호를 바꾸려면 `node scripts/set-access-password.mjs`를 실행하고 다시 빌드하면 돼요.
- 입력 칸은 **일반 텍스트 칸**이에요. 글자는 투명하게 하고 점(●)을 위에 겹쳐 보여요.
  - `type="password"`나 `-webkit-text-security`를 쓰면 Chromium이 비밀번호 칸으로 보고 맥에서 영문 입력만 허용해요. 그러면 한글 암호를 칠 수 없어요(0.2.0에서 겪음).
  - 회귀 테스트: `node tests/e2e/ime-compose.mjs`
- 테스트는 샌드박스 프로필에 `access.json`을 미리 만들어 통과해요(`tests/e2e/access.mjs`).
  - 실제 암호로 확인하려면 환경변수로 넘겨요: `MS_ACCESS_PASSWORD=… node tests/e2e/smoke.mjs`, `MS_ACCESS_PASSWORD=… npx vitest run`.

## 9. 문제 해결

| 증상 | 해결 |
|---|---|
| `posix_spawnp failed` | `node scripts/postinstall.mjs` 실행 (spawn-helper 실행 권한) |
| 미리보기가 배경만 나옴 | 미리보기 서버가 HyperFrames 런타임을 주입하는지 확인 (`?ms-preview=1`) |
| 폰트가 명조로 바뀜 | 설치되지 않은 폰트. 환경 점검에서 다시 찾기 → Claude에게 설치된 폰트로 바꾸라고 요청 |
| 대화창에 내용이 안 보임 | `~/.claude/projects/*/<세션ID>.jsonl`이 생기는지 확인. 생기지 않으면 `CLAUDE*` 환경변수 문제 |
| Mac에서 "확인되지 않은 개발자" | `npm run dist:mac` 없이 만든 미서명·테스트 서명 빌드. 배포는 꼭 `dist:mac`으로 (공증 포함) |
| Mac 설치본이 실행 직후 꺼짐 | 번들 이름에 한글이 들어간 경우. `productName`은 영문(MotionStudio)으로 유지 |
| 내보낸 영상에 BGM이 없음 | `<audio>`에 `id`가 없으면 렌더러가 무시함. applyAudio가 자동으로 붙임 |
