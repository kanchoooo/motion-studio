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
| `node tests/e2e/youtube-ref.mjs` | 유튜브 주소를 레퍼런스로 실제로 내려받기(인터넷 필요, 계정·사용량 없음): 일반 영상·쇼츠, 없는 영상의 안내 (`MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 사본에서) |
| `node tests/e2e/share-flow.mjs` | 프로젝트 공유: 공유 창(메모 직접 입력) → 파일 내용(넣는 것·빼는 것) → 홈에서 열기 → 새 프로젝트·인계 메모 안내 (`MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 사본에서) |
| `node tests/e2e/share-live.mjs` | 실제 Claude로 인계 메모 작성 → 공유 파일 → 받는 쪽 새 세션이 메모를 읽고 이어받는지 (`MS_SANDBOX=<신뢰된 샌드박스>`, 백업·복원, 사용량 소모) |
| `node tests/e2e/sound-marks.mjs` | 표시 없이 들어온 음악·효과음이 사운드 탭과 타임라인 "소리만"에 보이는지 (`MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 사본에서) |
| `node tests/e2e/sound-live.mjs` | 실제 Claude로 무료 배경음악 후보 → 대화창 카드에서 듣기 → 고르기 → 배경음악으로 교체·사운드 탭 표시 (`MS_SANDBOX=<신뢰된 샌드박스>`, 백업·복원, 사용량 소모) |
| `node tests/e2e/edit-requests-live.mjs` | 실제 Claude(앱 기본 opus·high)로 편집 요청 확인: 배경 따로 떼기, 이름 없는 내용 → 이름 붙이기 요청, 새 요소 이름, 파일을 붙인 핀(교체·스타일·참고). 폴더 신뢰 질문은 테스트가 답하지 않으므로 이미 신뢰된 샌드박스 프로젝트를 쓰고, 백업했다가 되돌린다 (`MS_SANDBOX=<신뢰된 「앱 주문 런칭」 폴더가 있는 샌드박스>`, 사용량 소모) |
| `npm run dist:mac` (`dist:mac-arm64`, `dist:mac-x64`) | Mac 설치 파일: 서명·공증 (`release/`, 6장 참고). `--release`는 관제용 판(Intel)도 함께 올린다 (5-7장) |
| `node tests/e2e/runtime-text.mjs` | 런타임: 안에 요소가 있는 글자의 단어를 바꿔도 구조·크기 유지, 새 줄바꿈, 드래그한 부분만 색(그 자리, 꾸밈 걸침), 단어 강조(모든 곳) |
| `node tests/e2e/api-key.mjs` | 사용자 Claude API 키: 키 확인·저장, 키로 대화와 금액 표시, 크레딧 부족·거부된 키에서 같은 대화를 구독으로 이어가기, 다시 키로, 키 지우기 (가짜 API, 요금 없음. `MS_SANDBOX=<신뢰한 ms-p6 샌드박스>`, 프로젝트는 백업 후 되돌림) |
| `node tests/e2e/feedback-4.mjs` | 사용 피드백 4차: 글자 일부만 색(편집 화면), 상자 글자 수정, 다른 쪽 변경이 다음 편집에 지워지지 않음, 대화창 소리 카드 재생·실패 안내, 글꼴 블록 (`MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 사본에서) |
| `node tests/e2e/collect-flow.mjs` | 관제용 판: 결과물 모음 — console.json 없으면 아무 일 없음, 지난 결과물 채우기(clone), 관제에서 지우기 요청 → 앱에서도 지움, 새 내보내기·앱에서 지우기 따라가기 (`MS_CONSOLE=1 npx electron-vite build` 뒤, `MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 사본에서) |
| `node tests/e2e/web-flow.mjs` | 관제용 판: 웹 연결 — console.json으로 켜고 끄기, 숨은 시작, 토큰·CSP·막는 요청, 업로드·내려받기, 미리보기 중계(샌드박스·글꼴·소리), 관제 같은 중계를 거친 브라우저에서 화면·편집 저장·파일 올리기·내려받기, 종료 → 다시 연결 (`MS_CONSOLE=1` 빌드 뒤, `MS_SANDBOX=<「앱 주문 런칭」 샌드박스>`, 이 맥의 Chrome 사용) |
| `npm run dist:win` | Windows 설치 파일 (미서명) |
| `npm run registry` | 앱에 넣는 HyperFrames 레지스트리 사본 받기 (`resources/hf-registry`, 5-4장) |

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
                   - prompt: 짧은 안내(쓸 수 있는 것) + 편집 정리 요청
    storyboard.ts  콘티(storyboard.json): 장면·소재 칸·할당, storyboard.html 칸 찍기
    headFix.ts     index.html <head>의 앱 줄 보정(CDN GSAP → vendor/)
    tidy.ts        편집 정리: 이름 없는 내용 찾기, 전후 화면 비교
    projects.ts    프로젝트 폴더, 브리프(출력 사양·소재함), 직접 수정값
    history.ts     이력 (isomorphic-git, 저장할 때마다 내용 해시)
    renders.ts     내보내기, 결과물 보관함
    audio.ts       BGM/효과음, 길이 변경을 index.html에 반영, 기본 효과음
    variations.ts  베리에이션 (크기·길이, Claude 재구성 대기열은 pty-session)
    references.ts  대화 첨부 (파일·유튜브, 개요 시트, 구간 0.1초 시트, dHash 복제 감지)
    psd.ts         PSD → PNG (합치기 / 레이어별 + 위치)
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
  - PATH 맨 앞에 `userData/cli/`: `hyperframes`·`npx hyperframes`가 앱 안 HyperFrames CLI(앱의 노드)로 간다(`agent/cliShims.ts`). 이 명령들은 미리 허용. `add`에는 항상 `--no-clipboard`를 붙인다(CLI는 기본으로 클립보드에 복사함).
  - **레지스트리 사본**(`resources/hf-registry/`, 5-4장): CLI는 늘 `--import offline-fetch.mjs`로 실행(`registry.nodeArgs()`, 세션 명령과 `runHf` 모두) → 레지스트리 요청을 앱 안 사본에서 답한다. Claude 도구 `find_blocks`(검색 + 움직임 미리보기)·`add_block`(설치).
  - 하위 에이전트는 덧붙인 시스템 프롬프트를 못 받으므로 `.studio/motion-studio-rules.md`(컴포지션 규칙)를 읽게 한다.
  - **하네스 없음 (0.5)**: Claude는 일반 Claude Code처럼 대화로 기획하고 만든다. 관문(콘티 전 필수 읽기, 첫 쓰기 전 레시피, 턴 종료 검사·검수 강제, 편집 준비)과 앱이 쓰던 BRIEF.md는 없앴다. 예전 버전이 쓴 BRIEF.md는 세션 시작 때 지운다(`dropAppBriefDoc`, 앱 표시 문구가 있을 때만).
  - 시스템 프롬프트(`agent/prompt.ts`)는 역할·한국어·작업 폴더·**쓸 수 있는 것** 목록·디자이너 수정 존중·컴포지션 읽는 법만 담는다. 순서를 강제하지 않는다.
  - `PreToolUse` **HTTP 훅**(`/hook/<토큰>/pretool`)은 Agent만 본다: 검수 에이전트(`motion-reviewer`, 디자이너가 "검수해줘"라고 할 때)에 세션의 `effort`를 넣는다.
  - **head 보정**(`headFix.ts`): 턴이 끝날 때·프로젝트를 열 때·내보내기 전에 index.html의 앱 줄(vendor/gsap → ms/fonts.css → ms/overrides.js → ms/runtime.js)을 `<head>` 맨 위로 되돌리고, CDN GSAP(플러그인 포함)은 vendor/ 사본으로 바꾼다. 미리보기 서버는 턴 중에도 메모리에서 같은 보정을 해서 보여준다.
  - **콘티**: Claude가 `composition/storyboard.html`(장면마다 `id="frame-NN"` 칸)을 쓰고 `show_storyboard`를 부르면, 앱이 숨은 창에서 칸마다 찍어(`storyboard.shootCells`) 대화 카드와 스토리보드 패널에 보여준다. 장면마다 소재 칸(이미지 프롬프트, 영상 프롬프트 + 중요한 영상은 시작·끝 프롬프트). 디자이너 할당은 `storyboard.json`(앱 파일), Claude는 `get_storyboard`로 읽는다.
  - **승인은 대화로**: 버튼이 없다. 디자이너가 "제작해줘·진행해·승인"이라고 하면 Claude가 `start_build`를 부른다 → 장면별 소재 파일을 받고, 콘티가 승인 상태가 되고, 앱이 `build-started` 이벤트로 편집 탭을 연다. 승인 뒤 바뀐 할당은 디자이너의 다음 메시지에 붙는다(앱 메시지에는 안 붙음).
  - **첨부**: 대화에 넣은 이미지·영상·유튜브는 references/에 저장(내보내기 폴더 밖). 영상은 컷 + 개요 시트(1초, 2분 넘으면 더 넓게)만 바로 만들고, `look_at_reference(id, from, to, every)`가 구간을 0.1초 시트로 그때 만든다(캐시, 한 번에 200프레임). 영상에 쓰기로 하면 `use_as_material`이 소재함으로 복사(유튜브는 거절).
  - **보기 모드 → 편집 활성화**: 0.5부터 새 프로젝트는 `project.json`의 `editable: false`로 시작한다(이전 프로젝트는 값이 없어 항상 편집 가능, 베리에이션은 원본을 따름). 영상이 있고 `editable === false`면 `editLock`이 모든 손 편집을 막고(보기·재생·선택·표시는 됨), 캔버스 아래 **편집 활성화** 버튼(`agent.activateEditing`)을 보여준다. 누르면(`tidy.ts`, `pty-session.activateEditing`): 숨은 창에서 `[data-ms-id]` 밖의 글자·그림·영상·SVG를 센다 → 없으면 바로 편집 가능 → 있으면 같은 순간 12장을 찍고 Claude에게 이름(data-ms-*)만 붙이게 요청(`TIDY_REQUEST`, 앱 메시지로 표시) → 턴이 끝나면 다시 찍어 비교, 달라졌으면 한 번 고치게 하고 → `editable: true`. 그사이 디자이너가 메시지를 보냈으면(세대 카운터) 비교 없이 연다.
  - 흐름 배치(flex·grid) 레이어는 처음엔 위치만 옮긴다. 크기·회전 손잡이를 잡으면 그 묶음을 자유 배치로 바꾼다(최상위는 `__root` 묶음). 런타임 감싸기는 부모의 `preserve-3d`·`perspective`를 이어받고, 레이어 자체의 혼합 모드는 감싸기로 옮긴다(`--ms-cb`, 디자이너 값이 이김).
  - 소리·내레이션: `show_voice_candidates`(목소리 카드 → 고르면 메시지), 아트리스트 / 내장 효과음 / 상업 사용·출처 표기 불필요 무료 음원(Mixkit은 자동으로 받아짐). `ai_import`에 `page_url`·`license`를 남기고 내보내기 창이 보여준다(`renders:preflight`, 레퍼런스와 거의 같은 장면 경고도 여기서).
  - 기본 추론 강도는 `high`(DEFAULT_EFFORT, 채팅 패널에서 프로젝트별로 바꿀 수 있음). WebSearch는 미리 허용(비슷한 광고 조사), WebFetch는 질문.
  - `PermissionRequest` 훅은 `[cd <프로젝트|composition> &&] hyperframes <check·lint·snapshot·catalog… 읽기 명령> | grep·head·tail·wc·cut·tr·sort·sed -n <구간>p`처럼 보고서를 걸러 읽는 명령은 바로 허용해요(`hyperframesReadPipeline`: `>`·`$(…)`·`;`·`||`·백틱·`sort -o`·`sed -i/w`가 하나라도 있으면 그대로 물어봄).
  - 앱 MCP 서버(`studio`)는 도구가 끝날 때 한 번에 응답하므로 설정에 `timeout: 900000`(15분)을 준다. 없으면 Claude Code가 60초 넘게 조용한 호출(GPT 이미지 생성 등)을 "The operation timed out."으로 끊는다.
  - `PermissionRequest` 훅은 설명(description)이 한국어가 아닌 명령만 사람에게 묻기 전에 돌려보내요. 셸로 영상 파일을 고치는 것도 다른 명령처럼 승인 카드로 물어봐요(0.5).
  - 설정 `language: "Korean"`(Claude Code 응답 언어). 중간 메모까지 한국어로 쓰도록 프롬프트에 예시 문장도 있어요.
  - `--setting-sources ""` (개인 설정, 훅, 플러그인 제외)
  - `--strict-mcp-config` + 앱 MCP 서버만 연결
- **이어갈 대화**: 대화 기록 파일이 있을 때만 `--resume`, 없으면(첫 요청 전에 모델을 바꾼 새 프로젝트) 같은 id로 `--session-id`. `--resume`이 "No conversation found"로 끝나면 바로 새 대화로 다시 시작한다.
- **편집 잠금**: 세션이 `busy`인 동안 편집 탭은 보기·재생·선택만 된다. 모든 수정은 `editor/editLock.ts`의 `blockedEdit()`를 거친다(overrides 저장소의 모든 변경, 사운드 패널의 파일 교체). 캔버스 위 안내가 뜨고, 수정을 시도하면 깜빡인다.
- **메시지 입력**: 텍스트를 쓰고 0.8초 뒤 Enter를 따로 보낸다. 한 번에 보내면 붙여넣기로 인식된다.
- **폴더 신뢰 확인은 자동으로 답하지 않는다.** 터미널을 열고 안내만 한다.
- 개발 중 Claude Code 터미널 안에서 `npm run dev`를 실행하면 부모 세션의 `CLAUDE*` 환경변수가 이어진다. 그러면 대화 기록 저장이 꺼지므로, PTY를 띄울 때 이 변수들을 제거한다(`cleanEnv`).

## 5-2. 폴더·베리에이션·템플릿 (0.3.0)

- **폴더**: 프로젝트 폴더(`문서/모션스튜디오`) 안의 일반 폴더(`folders.ts`, 최대 4단계, 숨김 폴더 제외). 목록은 폴더를 훑어 만들고(`scan`), 최근 목록에만 있는 같은 id 사본은 숨김. 옮기기·폴더 이름 바꾸기는 그 안의 Claude가 작업 중이면 막고, 쉬고 있는 세션은 닫은 뒤 옮긴다(`--resume <id>`는 다른 폴더에서도 같은 대화를 찾음).
- **베리에이션**: 원본과 같은 폴더에 만든다. 줄마다 `note`(추가 요청)가 있으면 항상 Claude 재구성. 재구성은 `MAX_ADAPTING = 4`개까지 동시에(각자 Claude 세션), 나머지는 대기.
- **템플릿**: `<프로젝트 폴더>/.templates/<id>/`(composition·brief·overrides·cover.jpg·template.json·generated.json). 칸 찾기는 `htmlSlots.ts`(브라우저 없이 data-ms-id 요소의 글자·파일). 새 프로젝트에 채울 때 글자는 직접 수정값(overrides.text), 파일은 assets/tpl-*로 복사해 src 교체(내레이션은 data-duration도 새 길이로), 브리프의 필수 문구·소재도 따라 바꿈. 새 대본은 Claude에게 같은 목소리로 다시 녹음하라고 보냄(`ai_call` 기록에 남긴 설정값 `generated.json args`). 템플릿으로 만든 프로젝트는 `.studio/template.json`에 칸 목록, 위쪽 "템플릿 칸"으로 다시 바꿈.
- **고쳐서 다시 만들기**: `GenRequest.revision[]`·`revisedFrom`. 모델이 참고 이미지를 받으면 이전 그림을 함께 보내고 마지막 수정만, 아니면 모든 수정을 글로(`withRevision`). 소재에 넣을 때 요청 전체를 `asset.generated.request/video`에 남겨 소재에서도 다시 고칠 수 있음.

## 5-3. SVG 캐릭터 장치 (0.3.0)

- `tag.cjs`: `eye`(흰자+눈동자+반짝임의 볼록 껍질을 매끈한 흰자 전체로 새로 만들고 눈동자를 그 모양으로 clip, `data-eye`), `underhang`(관절 밑에 숨는 둥근 기둥, clip 밖), `follow`(clip은 제자리, 그림은 다른 부위를 따라감), `maxRot`(`data-max-rot`), `absorbs`. 눈 장치는 sharp로 도형 마스크를 그려 계산(`prepareTags`, 비동기).
- `check.cjs` / MCP `character_check`: pivot 있는 부위를 최대 각도 양쪽으로 돌려 pivot 둘레의 틈(닫힘 연산으로 찾는 가는 빈틈, 빨강)과 비킨 자리에 드러난 같은 색(자홍), 눈 장치 여부를 `check_sheet.png`로. `data-added` 도형(일부러 숨긴 채움)은 세지 않는다.
- `svgrig.js`: `SvgRig.pose(svg, id, {rot, s, sx, sy, x, y})`(pivot·최대 각도·follow), `SvgRig.eyeRig(svg, 'eye-l', {scale, lookX, lookY, pupil})`, `SvgRig.layer(svg, id, ref, 'above'|'below')`.
- `lib.cjs`: 주변보다 훨씬 어두운 가는 띠(다문 입·속눈썹 선)는 안티앨리어싱으로 보고 지우지 않음. 플랫 캐릭터 생성 문장: 그늘이 부위를 넘지 않게, 온전한 흰자 타원, 면으로 된 입, 조금 어두운 목 기둥, 소매·바지 끝단이 손목·발목을 덮게.

## 5-4. HyperFrames 레지스트리 사본 (0.3.1)

- `scripts/fetch-registry.mjs`(`npm run registry`, `setup`·`build-mac`·`dist:win`·CI가 실행): 앱에 든 `hyperframes` 버전의 태그(`v<버전>`) 레지스트리를 통째로 받는다 → `resources/hf-registry/mirror/registry/…`(registry.json, 항목별 registry-item.json과 파일), `mirror/static.heygen.ai/…`(HeyGen CDN에 있는 그림), `previews/<이름>.jpg`(미리보기 영상의 15·50·85% 세 장면을 가로로, 없으면 포스터 480px), `mirror.json`(버전 표시: 같은 버전이면 건너뜀, `--force`로 다시). 저장소에는 `offline-fetch.mjs`만 들어 있고 나머지는 빌드 때 받는다(일부 텍스처는 출처 확인 중이라 공개 저장소에 넣지 않음).
- `offline-fetch.mjs`: CLI 프로세스의 `fetch`를 감싸, `raw.githubusercontent.com/heygen-com/hyperframes/<아무 ref>/registry/…`와 `static.heygen.ai/…`를 사본 파일로 답하고 없는 것만 네트워크로 보낸다. CLI의 manifest 캐시(`~/.hyperframes/cache`, 24시간)가 신선하면 CLI가 그걸 먼저 쓴다.
- `src/main/registry.ts`: 사본 목록(`registryItems`), 검색(`searchRegistry`: 단어 끝 맞추기, 이름·제목 4 > 태그 3 > 설명 1, 맞춘 단어 비율을 곱함, 1점 미만 버림), 설치(`addRegistryItem` = `hyperframes add --no-clipboard --json`).
- 앱 크기: 패키지 안 약 150MB(압축 설치 파일 기준 약 +45~60MB).

## 5-5. 영상 템포·스타일 (0.3.1, 0.5에서 화면 제거)

- `src/shared/direction.ts`는 예전 브리프의 값을 읽기 위해 남겨 두었다. get_brief의 `olderBrief`(이전 브리프 메모)로만 Claude에게 간다. 0.5부터 템포·스타일은 대화로 정한다.

## 5-6. 에펙처럼 편집 (Claude가 만들고, 디자이너가 손으로 다듬기)

- **데이터** (`src/shared/overrides.ts`, version 2): `elements[id]`에 변형(x·y·scaleX/Y·rotate·rotateX/Y·anchorX/Y·opacity), `keys`(속성별 키프레임 `{t 출력 시간, v, e 이징}`), `effects`(blend·blur·brightness…·shadow·glow), `mask`(요소 자기 상자 기준 rect/ellipse, 페더·반전), `inPoint/outPoint`, `deleted`, `label`, `src`(그림·영상 교체), 글자 스타일(기울임·밑줄·대문자·글자 테두리)·모양(fill·stroke·radius). 최상위에 `layers`(디자이너 레이어), `duplicates`(Claude 레이어 복사본), `order`(쌓임 그룹별 순서, 위가 먼저), `markers`, `guides`. **잠금은 디자이너가 켤 때만**: version 1은 손대면 자동 잠금이었으므로 읽을 때 `locked`를 버린다(`normalizeOverrides`).
- **런타임** (`src/runtime/ms-runtime.js`): 래퍼의 변형을 `@property`로 등록한 **상속되지 않는 CSS 변수**(`--ms-x` 등)로 만든다(중첩 레이어가 부모 이동을 두 번 받지 않게). `transform`은 손댄 레이어에만 둔다(쌓임 맥락이 바뀌지 않게). 키프레임 → 메인 출력 타임라인(구간 속도가 있으면 바깥 W)에 GSAP `fromTo`/`set`(변수 트윈, `CAPTURE_OFF`로 Claude 모션 기록에서 제외), 인/아웃 → `--ms-io`. 효과는 래퍼 `filter`·`mix-blend-mode`, 조정 레이어는 `backdrop-filter`. 마스크는 SVG 휘도 마스크(감싼 순간 잰 `GEO`)로 **요소 자체**에 건다(`mask-position`으로 래퍼 영역을 요소 좌표에 맞추고 `mask-clip:no-clip`) — 그래서 Claude의 회전·이동도 따라간다. 요소에 이미 마스크가 있거나 Claude 타임라인이 마스크 속성을 트윈하면(`MASK_WRAP`, 감쌀 때 계산 스타일 + 등록 때 트윈 검사) 래퍼에 건다. `describe().local` = 요소 자기 좌표 → 구성 px 2D 행렬(조상들의 회전·크기 선형부를 곱하고 측정한 상자로 위치를 맞춤, 3D는 근사) — 캔버스는 이걸 거꾸로 써서 돌린 레이어에도 마스크를 레이어 방향으로 그리고, 고른 레이어의 마스크 테두리를 그린다. 복사본은 메인 타임라인 등록 때 원본을 복제해 바로 뒤에 넣고 원본 트윈을 모두 복제(대상은 DOM 경로로 매핑). 순서는 같은 부모의 형제끼리 자리만 바꿈(+명시적 z-index가 있으면 z도). `hit` 메시지 = 그 점에 그려진 레이어(위부터), `solo` 메시지 = 편집기 전용 솔로.
- **디자이너 레이어** (`main/designerLayers.ts`): `index.html` 루트 끝의 `<!-- ms:layers -->` 관리 구역에 실제 요소로 씀(렌더러가 영상 디코딩·오디오까지 그대로 처리). `applyAudioEdits`가 매번 다시 씀. 아이디는 `L…`(복사본 `D…`), 파일은 프로젝트 안 상대 경로만.
- **편집기**: `edit.ts`(공용 동작: 키프레임이면 플레이헤드에 키·아니면 고정값, 복제·삭제·잠금·순서·나누기·인아웃·이동·정렬·분배·레이어 추가·복사/붙여넣기), `LayerEditor.tsx`(스톱워치 속성), `Timeline.tsx`(솔로·눈·잠금, 끌어서 순서, 인/아웃 손잡이, 키프레임 줄·다이아몬드, 마커, 작업 영역, 프레임 표시, 소리 파형 — `Waveform.tsx`: 미리보기 서버의 파일을 Web Audio로 8 kHz 디코딩해 초당 200개 피크로 캐시, `data-media-start`부터 클립 길이만큼), `Preview.tsx`(맨 위 레이어 선택, 핸들·회전·기준점(위치 보정), 스마트 가이드 스냅, 범위 선택, 확대·이동, 눈금자·가이드, 모션 경로, 마스크 그리기; 키프레임 속성은 끄는 동안 점선 미리보기 후 놓을 때 키). 단축키는 `EditorTab.tsx`.
- **Claude**: `get_designer_edits`(잠긴 레이어 목록·규칙·키프레임 요약·디자이너 레이어·복사본·삭제·순서), `clear_designer_edits`(잠기지 않은 레이어를 Claude에게 돌려줌, 잠긴 건 거절, 이력에 Claude로 기록). 프롬프트 "Designer edits", 검사 `ms_locked_removed`(잠긴 레이어가 사라지면 오류).
- **속성 한 목록** (`src/shared/props.ts`): 키프레임 가능한 모든 속성(변형·기준점, 효과·그림자·빛 번짐, 글자 색·크기·자간·행간·테두리, 채우기·테두리·모서리·그라디언트, 마스크 x/y/w/h/페더, 선 그리기)을 id·라벨·CSS 변수·단위·대상(wrap/el)으로 정의. 고정값은 원래 자리(transform/effects/style/mask/trim)에 두고 `setValue`/`staticPatch`/`unsetStatic`로 읽고 쓴다. 키프레임 값은 숫자 또는 색(`lerpColor`), `loops`(cycle/pingpong), 위치 키의 `c`(곡선 손잡이, `positionAt`). 런타임 `PROPDEFS`가 같은 목록이어야 한다(단위 테스트 `props.test.ts`가 대조).
- **런타임 추가 동작**: 효과·글자·모양 값도 등록 변수(효과·선 그리기 변수는 상속: 조정 레이어의 backdrop과 안쪽 도형이 읽음). `wiggle` = 시드 고정 난수 트윈(별도 변수 `--ms-wx` 등을 transform calc에 더함). 프레임 훅(출력 타임라인 `onUpdate` 체인, 자식 렌더 뒤) = 숫자 카운트, 시간별 문구, 키프레임 마스크 재그리기, 부모 연결(`--ms-pm` 행렬), Claude 마스크가 있는 요소의 사용자 마스크 따라가기, 트랙 매트(`mask-image: url(그림)`), 모션 블러(SVG `feGaussianBlur`를 키프레임 속도로). 카메라 = `elements.__camera` → `<body>` transform(원점 50vw 50vh, describe 기준은 root offset). 곡선 경로 = 구간마다 proxy 트윈이 베지어로 `--ms-x/y`.
- **Claude 움직임 가져오기(own)**: `elements[id].own[GSAP 속성]` = 절대 키프레임(요소 자체에 GSAP 트윈). `captureMotion`이 그 요소만 대상인 트윈(`self`)에서 해당 속성을 지움(set·keyframes 트윈도 기록). `claude-tracks` 메시지가 트윈 경계(반복·키프레임 단계 포함)에서 `MAIN_OUT.totalTime(t, true)`로 값을 읽어 키를 만든다 → 무작위·상대값도 실제 값. 모션 조정 키가 안 맞으면 `matchLateEdits`(같은 sig 중 `at`에 가장 가까운 트윈, `lateApply` + `invalidate`), 끝내 못 찾으면 STALE → 편집기 알림(버리기).
- **캐릭터**: `svgrig.js` `SvgRig.chars()`가 연기 파라미터를 알려 주고(`describe().rig`), `[data-pivot]` 부위를 `<g data-ms-wrap-for="<호스트>::<부위>">`로 감싸 관절 기준(transform-box view-box) 변형. 부위 크기 단위 `unit`(그림 단위 → 구성 px). 캔버스: 캐릭터를 고른 뒤 다시 누르면 부위.
- **그 밖**: 자동 이름(`그룹~경로`, `data-ms-auto`) — 그룹 안 이름 없는 글자·그림. 자유 배치(`overrides.freeze`, 런타임 `measure-flow`로 잰 상자를 absolute로). 부분 문구 `textRuns`·강조 `highlights`·시간별 문구 `textKeys`·글자 애니메이터 `custom`. CSS 애니메이션(`document.getAnimations`, 키 `<요소>@<이름>#n`, sig `css:`) 시작·길이·이징·끄기. stagger 간격·시작 위치·하나만 늦추기(`MotionOverride.stagger`). 그룹 이동 `moveTo`(래퍼를 옮기고 화면 위치 보정 `--ms-gx/gy`). 영상 속도·거꾸로 `videoFx`(main `videoFx.ts`가 ffmpeg로 `.ms-video/` 파일), 소리 볼륨 키프레임(main `audio.ts` `audioEnvelopes`가 `.ms-audio/` 파일, 원래 media-start는 `data-ms-original-media-start`).
- **Claude 도구**: `get_designer_edits`(규칙·propertyCatalog·own·freeze 포함), `update_designer_edits`(디자이너 값을 지우지 않고 고침: 병합, 키프레임 목록 교체, 잠금 거절 — `main/designerEdits.ts`), `clear_designer_edits`(`props`로 속성만 돌려받기). 프롬프트는 "디자이너 작업을 지우지 말고 그 값을 고쳐라".
- **레이어 시간 이동·클릭·순서 (0.5 beta.5)**: 타임라인 막대는 `shiftLayers`(`shared/overrides.ts` `shiftElement`: Claude 움직임은 authored 초, 디자이너 키·인/아웃 등은 출력 초). 런타임 `applyElementTiming`이 공유 트윈을 대상별로 나누고(`splitTween`, stagger 간격 유지, from은 revert 후), 0초 초기 `set`은 두고, 0초 앞은 레이어째 멈추고, 클립 `data-start`도 옮긴 뒤 `refreshMotionTimes`로 표시 시간을 다시 잰다. 캔버스 클릭은 런타임 `hitAt`(판정 동안만 pointer-events 켬, `shownNow`·`paintsItself`). 레이어 순서·검색·⌘↑/⌘↓는 `shared/layers.ts` 하나. 편집 활성화 뒤 매 턴 `main/tidy.ts` `auditLayers`(페이지 스크립트 `AUDIT_SCRIPT`)와 `auditVerdict`.
- **테스트**: `tests/e2e/layer-editing.mjs`(런타임 이동·상자·클릭, 헤드리스 크롬), `tests/e2e/edit-usability.mjs`(앱 화면: 목록·검색·클릭·우클릭·가이드·⌘↓·크기 스냅·막대 스냅), `tests/e2e/ae-engine.mjs`·`ae-engine2.mjs`·`ae-engine3.mjs`(미리보기와 내보낸 영상 픽셀까지), `tests/e2e/ae-editor.mjs`·`ae-editor2.mjs`·`ae-editor3.mjs`(클릭·드래그·단축키로 전 기능; 테스트 레이어는 `fixtures.mjs`), 단위 `ae-edits`, `props`, `designer-tools`, `audio-curve`. 임시 폴더는 테스트가 끝나면 지워진다(`tests/unit/tmp-setup.ts`, e2e `cleanupOnExit`).

## 5-7. 관제용 판 (0.5.0-beta.9)

관제(이 맥의 사용자 대시보드)에서 모션스튜디오를 브라우저로 쓰고, 모든 결과물을 한 폴더에 모으는 **관제 전용 판**이다.
**일반 판(맥 M칩·Intel, 윈도우)에는 이 코드가 아예 들어가지 않는다.**

**빌드 분리**
- `MS_CONSOLE=1`로 빌드할 때만 들어간다. `electron.vite.config.ts`가 `__MS_CONSOLE__`(일반 판은 `false`)를 정의하고, 관제 코드는 모두 그 뒤에 있다.
  - main: `index.ts`가 `console-mode.ts`를 `__MS_CONSOLE__`일 때만 불러온다. `ipc.ts`는 `handle`·`send` 두 곳에서만 `console-bridge.ts`로 넘긴다.
  - renderer: 브라우저용 `web.html`(웹 shim → 앱)은 관제용 판 빌드에만 생긴다. 창은 그대로 `index.html`을 쓴다.
- `node scripts/check-regular-build.mjs`: 일반 판 `out/`에 관제 코드가 없는지 검사한다. `build-mac.mjs`와 CI 빌드가 매번 돌린다.
- 관제용 판은 일반 판과 **같은 앱**(이름·번들 id·데이터 폴더)이다. 관제 맥에서는 일반 판 대신 깔린다.
- 업데이트: 관제용 판은 최신 릴리스의 `console-mac.yml`만 읽는다(generic 공급자, `updater.ts`). 일반 판은 전처럼 `latest-mac.yml`·`latest.yml`만 읽는다.
- 빌드
  - `node scripts/build-mac.mjs --release`: 일반 판(M칩·Intel) 다음에 관제용 판(Intel, zip)도 만들어 같은 릴리스에 올린다. 빼려면 `--no-console`.
  - `--console`: 관제용 판만 만든다(`release/console/`). `--local --console`은 이 맥에 설치한다(사용자가 요청할 때만).

**켜고 끄기** (관제용 판 안에서도 `console.json`이 있어야 켜진다)
- 관제가 `<userData>/console.json` = `{"web":true,"collectDir":"…/모션스튜디오 결과물"}`을 쓴다.
- 앱은 시작할 때 읽고, 바뀌면 따라간다(파일 감시 + 10초마다 확인).
- `--hidden`으로 실행하면 창과 Dock 아이콘 없이 시작한다(웹 연결이 켜져 있을 때만). 업데이트로 다시 시작해도 숨은 채로 돌아온다.
- 숨은 동안에는 업데이트를 스스로 설치한다. Claude 작업·내보내기가 없고, 10분 동안 웹 사용이 없을 때만 한다.

**결과물 모음** (`collect.ts`)
- 내보낸 영상·PNG 시퀀스·AE 패키지를 `<모음>/<폴더…>/<프로젝트>/<파일>`에 복제한다(APFS clone → 하드 링크 → 복사).
- 처음 켜질 때 지난 결과물도 채운다. 색인은 `<모음>/.motionstudio/index.json`이다.
- 앱에서 지우면 복제본도 지운다. 관제의 지우기 요청(`.motionstudio/delete-requests/*.json`)이 오면 앱에서도 지운다(원본은 휴지통으로).
- 프로젝트 이름 바꾸기·옮기기를 따라가고, 지운 프로젝트의 복제본은 `orphan`으로 남긴다.
- `<모음>/지난 결과물/`은 건드리지 않는다.

**웹 연결** (`web.ts`)
- 127.0.0.1의 임의 포트에서 연다. `<userData>/web-endpoint.json`(0600, 시작마다 새 토큰, 종료 때 지움)을 관제가 읽어 `X-MS-Token`을 붙여 중계한다.
- 경로는 모두 상대 경로다. 관제는 `/api/console/studio/ms/` 아래로 중계한다.
- 창과 **같은 IPC 핸들러**(`/api/invoke`)와 **같은 이벤트**(SSE `/api/events`)를 쓴다.
- 브라우저에서 달라지는 것(`src/renderer/src/web/shim.ts`)
  - 파일 고르기·끌어 놓기 → 업로드
  - 폴더에서 보기 → 내려받기
  - 링크 → 브라우저에서 열기
  - 로그인 → "맥에서 해 주세요"
  - 표시한 장면 캡처 → 앱이 그 시점 프레임에 표시를 그려서 만든다(`web-frame.ts`)
  - 연결이 끊기면 "다시 연결하는 중" 표시, 다시 연결되면 새로고침
- 미리보기는 `/preview/p/…`와 런타임만 중계한다(MCP·훅 경로는 막는다). `Content-Security-Policy: sandbox allow-scripts`로 별도 origin이 되고, 글꼴·fetch를 위해 `Access-Control-Allow-Origin: *`를 붙인다.
- `terminal:write`가 열려 있어서 **웹 연결은 원격 조작과 같다**. 관제가 IP 제한 뒤에서만 중계한다.
- 표: `src/shared/web-channels.ts`(preload와 같은지 `tests/unit/web-shim.test.ts`가 비교한다)

## 5-8. 직접 수정 보호·저장 합치기·글꼴 (0.5.0-beta.10)
- **디자이너 레이어 보호**(`agent/designerGuard.ts`)
  - 디자이너가 직접 고친 레이어(이름·잠금만 바꾼 것 제외)와 디자이너가 추가한 레이어가 대상이에요.
  - 요청마다 허용 범위를 정해요(`approvalFor`). 표시한 레이어, 메시지에 이름이 나온 레이어, Claude가 물은 뒤 짧게 "네"라고 답한 경우의 그 레이어가 허용돼요. "직접 고친 것도 바꿔도 돼" 같은 말, 앱의 요청, 베리에이션 재구성은 전부 허용이에요.
  - Claude의 `update_designer_edits`·`clear_designer_edits`는 허용 밖이면 거절해요.
  - PreToolUse 훅(Edit/MultiEdit/Write)은 composition의 HTML 편집이 그 레이어의 마크업이나 그 레이어를 가리키는 코드(CSS 규칙, 트윈 문장)를 바꾸면 되돌려 보내요.
- **저장 합치기**(`shared/overridesMerge.ts`)
  - 편집 화면은 수정값 전체와 함께 기준(base)을 보내요.
  - 디스크가 그사이 바뀌었으면 레이어(그리고 소리 편집·모션 편집·쌓는 순서 등) 단위로 합쳐요. 같은 레이어를 양쪽에서 바꿨으면 디자이너 쪽이 이겨요.
  - 합쳐진 결과는 편집 화면이 다시 받아요.
- **글꼴 블록**(`fontcss.ts` `withFontBlock`)
  - HyperFrames는 렌더할 때 페이지 본문에 `@font-face`가 없는 글꼴에 자기 규칙(설치 글꼴의 굵기를 파일 이름으로 추측)을 덧붙여요.
  - 그래서 페이지가 연결한 로컬 스타일시트의 `@font-face`를 `index.html`의 `<!-- ms:fonts -->` 블록에도 넣어요(`refreshFontCss`).
- **글자 수정**(`ms-runtime.js` `editInPlace`)
  - 안에 요소가 있는 글자는 바뀐 글자만 그 자리에서 바꿔요.
  - 드래그로 고른 부분의 색은 `highlights[].nth`(그 자리, 띄어쓰기 무시)로 저장해요.
- **소리 후보**: `saveListeningCopy`가 미리듣기를 `composition/assets/candidates/`에 받아요(앞부분 바이트로 소리 파일인지 확인). 공유 파일에서는 빠져요.

## 5-9. 사용자 Claude API 키 (beta.11 예정)
- **무엇**: AI 연결 → 「Claude API 키」에 키(예: 프로모션 크레딧)를 넣으면 Claude 대화를 그 키로 먼저 해요. 키를 더 쓸 수 없으면 Claude 구독(Claude Code 로그인)으로 같은 대화를 이어가요.
- **보관**(`claudeApi.ts`): 다른 서비스 토큰과 같은 방식이에요. 앱 데이터 폴더의 `claude-api.json`(0600)에 두고, Windows는 DPAPI로 봉해요. 맥 키체인은 쓰지 않아요. 저장 전에 `GET /v1/models`로 키를 확인해요(요금 없음). 웹 연결로는 키를 넣거나 지울 수 없어요(`web.ts` BLOCKED).
- **세션에 넘기는 방법**: 환경변수가 아니라 세션 설정의 `apiKeyHelper`(`curl -fsS <미리보기 서버>/claude-key/<실행마다 바뀌는 비밀값>`)예요.
  - 환경변수로 넘기면 Claude가 실행하는 명령이 키를 물려받고, Claude Code가 "이 키를 쓸까요?"를 물어요. helper는 둘 다 없어요.
  - helper는 구독 로그인보다 우선이라, 구독으로 열 때는 아예 넣지 않아요.
  - 미리보기 서버는 브라우저 요청(Origin·Sec-Fetch 헤더)에는 키를 주지 않아요. PreToolUse 훅(Bash·Read)이 helper 주소나 키 파일을 읽으려는 명령을 막아요(`readsApiKey`).
  - API 키 세션은 원격 제어(`--remote-control`) 없이 열어요(claude.ai 로그인이 필요한 기능).
- **구독으로 넘기기**(`pty-session.ts` `continueOnSubscription`)
  - 감지: 실패한 턴의 문구(`shared/claudeApi.ts` `apiFailure`: 크레딧 부족, Console 사용 한도, 거부된 키, 요청 과다)와 StopFailure 훅의 오류 종류. 거부된 키는 Claude Code가 몇 분씩 다시 시도해서, 터미널의 "401 invalid x-api-key · Retrying" 문구를 보고 바로 넘겨요.
  - 넘기면 `markFailed` → 키로 돌던 세션은 쉬고 있으면 바로, 작업 중이면 턴이 끝난 뒤 `--resume`으로 다시 열려요(대화 그대로). 막힌 세션은 "구독으로 바꿨어요. 하던 작업을 이어서 해 주세요."를 보내 이어가요(베리에이션 재구성 칸은 유지).
  - 돌아오기: Console 사용 한도는 풀리는 시각, 요청 과다는 15분 뒤 다음 요청부터 키로 돌아와요. 크레딧·거부된 키는 「다시 API 키로」를 눌러야 해요.
- **금액**(`agent/apiMeter.ts`): 키로 돈 프로세스가 대화 기록(본 대화 + subagents)에 쓴 응답의 토큰을 정가로 계산해요(중복 줄은 한 번만). 요청마다·프로젝트(`.studio/api-cost.json`)·이 컴퓨터의 달(`claude-api-usage.json`)로 모아요. 잔액은 API로 알 수 없어서, Console에서 본 잔액을 넣으면 그 뒤 이 컴퓨터 사용분을 빼서 보여줘요. 터미널의 다음 프롬프트 제안(`promptSuggestionEnabled`)은 꺼서 보이지 않는 요청을 줄였어요.
- **테스트**: `tests/e2e/mock-anthropic.mjs`(가짜 API: 성공, 크레딧 부족, 거부된 키)로 `api-key.mjs`가 요금 없이 전체 흐름을 확인해요. 실제 키 확인은 `MS_TEST_BREAK_KEY=<파일>`(그 파일이 생기면 helper가 망가진 키를 줘요)로 해요.

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
- **프롬프트 도우미**(`ai/promptHelper.ts`): Haiku 5.5(`claude-haiku-5-5`로 고정) `-p` 세션, Read만. 소재 패널 오른쪽에 늘 있고 생성기 상태(`useGenHelper`)를 읽어 마지막으로 누른 프롬프트 칸(이미지·움직임·시작·끝)에 넣는다. 끌어 놓은 참고 이미지는 feedback/refs/로 복사해 읽게 한다.
- **영상 생성 도구**(`make_video`): Claude가 `generateVideoCandidate`를 한 번에 부른다(시작·끝 프레임 = composition 경로). 결과는 assets/generated/로 복사하고 대화 카드로 보여준다.
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
- **관제 맥**(관제용 판이 깔린 이 맥)에서는 `--local --console`로 설치해요. `--console` 없이 설치하면 일반 판이 관제용 판을 덮어써서 관제 연결이 끊겨요(5-7장).

## 7. Claude 로그인과 키체인

- 로그인은 앱 안 터미널 창에서 **Claude Code 자체 로그인**(`claude auth login`)으로 한다. 로그인 정보는 Claude Code가 맥 키체인(Windows는 자격 증명)에 직접 저장하고, 앱은 보지도 저장하지도 않는다.
- 앱이 실행하는 모든 Claude 프로세스는 `claude-env.ts`의 환경을 쓴다.
  - `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` 등은 **넘기지 않는다**.
  - 장기 토큰이 키체인 로그인을 덮어쓰면 리모트 컨트롤이 잠기기 때문이다(관제센터에서 겪은 문제).
  - 디자이너가 넣은 API 키는 이 경로가 아니라 세션 설정의 `apiKeyHelper`로만 넘긴다(5-9).
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
