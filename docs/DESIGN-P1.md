# Phase 1 설계 — 화면 흐름, 데이터 구조, 내부 구조

## 1. 화면 흐름

```
[홈] ─ 새 프로젝트 ─→ [새 프로젝트 창: 이름 · 비율 카드 · 길이] ─→ [프로젝트]
  │                                                                 ├─ 브리프 탭 (출력 사양 · 필수 텍스트 · 소재 · 톤앤매너 메모)
  ├─ 최근 프로젝트 카드 ─────────────────────────────────────────→ ├─ 편집 탭   (대화 · 미리보기 · 타임라인 · 속성)
  │                                                                 └─ 이력·결과물 탭 (결과물 갤러리 · 작업 이력 · 되돌리기)
  └─ 환경 점검 (Claude 로그인 · 사용량 · 렌더 엔진 · FFmpeg · 폰트)
```

- 처음 실행하면 환경 점검을 먼저 보여준다. 모두 정상이면 홈으로 이동한다.
- 프로젝트를 처음 열면 브리프 탭이 열린다. 브리프를 저장하면 편집 탭에서 "콘티 받기" 버튼이 활성화된다.

## 2. 편집 탭 배치 (디자이너 툴 관례)

```
┌ 상단바: ← 홈 | 프로젝트명 | [브리프][편집][이력·결과물] |     사용량 ● | [내보내기] ┐
├──────────────┬──────────────────────────────────────┬───────────────────┤
│ 대화 (Claude) │  캔버스 (미리보기, 세이프존, 표시 모드)  │ 속성 패널           │
│ · 콘티 카드    │                                      │ (Phase 2에서 확장)  │
│ · 작업 상태    ├──────────────────────────────────────┤                   │
│ · 표시 칩      │  재생바 + 타임라인                     │                   │
└──────────────┴──────────────────────────────────────┴───────────────────┘
```

## 3. 프로젝트 폴더

```
~/Documents/모션스튜디오/<프로젝트명>.msproj/
  project.json        { id, name, createdAt, updatedAt, appVersion, agentSessionId }
  brief.json          브리프 (아래 스키마)
  overrides.json      디자이너 직접 수정값
  chat.json           대화 기록 (화면 표시용)
  composition/        HyperFrames 프로젝트 (렌더 루트)
    index.html          Claude 작업 영역
    hyperframes.json, meta.json
    assets/             광고주 소재 원본 (삭제하지 않음)
    ms/runtime.js       모션스튜디오 런타임 (앱이 관리, Claude 수정 불가)
    ms/overrides.js     overrides.json에서 생성 (앱이 관리)
    vendor/gsap.min.js  로컬 GSAP (앱이 관리)
  references/         레퍼런스 (Phase 3, 렌더 루트 밖이므로 결과물에 포함 불가)
  feedback/           화면 표시 피드백 (스냅샷 + 표시 + 코멘트)
  renders/            내보낸 결과물 + index.json
  thumbnails/         이력·결과물 썸네일
  .history/           이력 저장소 (isomorphic-git, 사용자에게 숨김)
```

이력에 포함하는 항목: `brief.json`, `overrides.json`, `composition/` (`assets/`는 제외), `feedback/`
이력에서 제외하는 항목: 소재 원본(삭제하지 않으므로 불필요), `renders/`, `thumbnails/`, `chat.json`

## 4. 브리프 스키마 (요약)

```ts
OutputSpec    { preset, width, height, fps, duration, format, background, backgroundColor, quality, audio, safeZone, maxSizeMB? }
TimingSpec    { mode: 'exact' | 'section' | 'any', at?, section?: 'start' | 'middle' | 'end' }
RequiredText  { id, text, locked, timing, minDuration, position, style: { mode: 'auto' | 'custom', fontFamily?, fontWeight?, fontSize?, color? }, note }
Asset         { id, file, originalName, kind, required, timing, position, transform: 'free' | 'crop-only' | 'none', note, meta }
Brief         { version: 1, title, client, campaign, output, texts[], assets[], references[], tone }
```

## 5. 내부 구조

| 영역 | 역할 |
|---|---|
| main/paths | OS·칩별 실행 파일 위치 (개발 모드 / 설치본), 사용자 데이터 위치 |
| main/doctor | Claude 로그인, 렌더 브라우저, FFmpeg, 폰트 점검 |
| main/projects | 프로젝트 생성·열기·목록, 브리프·수정값 저장, 소재 가져오기 |
| main/history | isomorphic-git 이력 기록·조회·복원 |
| main/hyperframes | Electron 내장 Node로 HyperFrames CLI 실행 (렌더, 스냅샷, 검사) |
| main/preview-server | 127.0.0.1 임의 포트, 프로젝트별 토큰 경로로 composition 제공 |
| main/agent | Agent SDK 세션, 권한 제한, 앱 전용 도구, 진행 이벤트 전달 |
| main/fonts | fontkit 폰트 스캔 + 캐시 |
| main/renders | 내보내기, 진행률, 결과물 목록, 썸네일 |
| preload | `window.studio` API (contextIsolation) |
| renderer | React + Zustand, 디자인 토큰 기반 UI |
| runtime | `ms-runtime.js` (Phase 0 검증본을 정식화) |

## 6. Claude 전용 도구 (MCP 서버 `studio`)

| 도구 | 설명 |
|---|---|
| `get_brief` | 브리프 + 소재 목록(크기·길이·composition 내 경로) |
| `get_designer_edits` | 디자이너 직접 수정값, 고정 항목, 요소 목록 |
| `propose_storyboard` | 콘티를 구조화해서 제출 → 화면에 콘티 카드 표시, 디자이너 승인 대기 |
| `check_video` | HyperFrames 검사 + 모션스튜디오 규칙 검사 + 필수 텍스트 검사 |
| `look_at_frames` | 지정 시점 스냅샷 이미지 반환 (Claude가 직접 봄) |
| `get_history` | 최근 작업 이력 (Phase 2) |

## 7. 사용자에게 보이는 말 (예시)

| 내부 동작 | 화면 문구 |
|---|---|
| get_brief | 브리프를 확인하고 있어요 |
| Write/Edit composition | 영상을 만들고 있어요 / 영상을 수정하고 있어요 |
| check_video | 결과를 점검하고 있어요 |
| look_at_frames | 장면을 직접 확인하고 있어요 |
| 사용량 한도 | 이번 사용량을 모두 썼어요. ○시 ○분 이후 다시 이어갈 수 있어요 |
| 렌더 실패 | 영상을 내보내지 못했어요. [자세히] (기술 정보는 접힘 상태) |
