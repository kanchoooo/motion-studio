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
| `npm run dist:mac-x64` / `dist:mac-arm64` / `dist:win` | 설치 파일 만들기 (`release/`) |

E2E 스크린샷은 `tests/e2e/shots*/`에 저장된다. 기존 프로젝트로 검수하려면 다음을 실행한다.

```bash
MS_SANDBOX=<live-flow가 남긴 폴더> node tests/e2e/review.mjs
```

## 4. 구조

```
src/
  main/            Electron 메인 프로세스
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
  - `--permission-mode dontAsk` + 허용 규칙. 쓰기는 `composition/`만 허용하고 `ms/`, `vendor/`, `assets/`는 제외한다.
  - `--tools Read,Write,Edit,Glob,Grep,Skill` (Bash 없음)
  - `--setting-sources ""` (개인 설정, 훅, 플러그인 제외)
  - `--strict-mcp-config` + 앱 MCP 서버만 연결
- **메시지 입력**: 텍스트를 쓰고 0.8초 뒤 Enter를 따로 보낸다. 한 번에 보내면 붙여넣기로 인식된다.
- **폴더 신뢰 확인은 자동으로 답하지 않는다.** 터미널을 열고 안내만 한다.
- 개발 중 Claude Code 터미널 안에서 `npm run dev`를 실행하면 부모 세션의 `CLAUDE*` 환경변수가 이어진다. 그러면 대화 기록 저장이 꺼지므로, PTY를 띄울 때 이 변수들을 제거한다(`cleanEnv`).

## 6. 문제 해결

| 증상 | 해결 |
|---|---|
| `posix_spawnp failed` | `node scripts/postinstall.mjs` 실행 (spawn-helper 실행 권한) |
| 미리보기가 배경만 나옴 | 미리보기 서버가 HyperFrames 런타임을 주입하는지 확인 (`?ms-preview=1`) |
| 폰트가 명조로 바뀜 | 설치되지 않은 폰트. 환경 점검에서 다시 찾기 → Claude에게 설치된 폰트로 바꾸라고 요청 |
| 대화창에 내용이 안 보임 | `~/.claude/projects/*/<세션ID>.jsonl`이 생기는지 확인. 생기지 않으면 `CLAUDE*` 환경변수 문제 |
| Mac에서 "확인되지 않은 개발자" | 서명하지 않은 내부 빌드. 앱을 우클릭 → 열기 |
| Mac 설치본이 실행 직후 꺼짐 | 번들 이름에 한글이 들어간 경우. `productName`은 영문(MotionStudio)으로 유지 |
| 내보낸 영상에 BGM이 없음 | `<audio>`에 `id`가 없으면 렌더러가 무시함. applyAudio가 자동으로 붙임 |
