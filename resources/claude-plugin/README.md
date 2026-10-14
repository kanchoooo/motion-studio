# 포함된 HyperFrames 스킬

출처: heygen-com/hyperframes (Apache-2.0), `hyperframes skills` 0.8.157 기준. 그냥 Claude Code로 HyperFrames 작업할 때와 같은 공식 흐름(길잡이 → 작업 흐름 → 블록 → 검사·스냅샷, 하위 에이전트)을 쓰기 위해 광고 영상에 필요한 스킬을 모두 넣는다.

| 스킬 | 용도 |
|---|---|
| hyperframes | 길잡이: 무엇을 만들지에 따라 작업 흐름·스킬을 고른다 |
| hyperframes-core / -animation / -creative / -keyframes | 컴포지션 규칙, 모션, 크리에이티브 방향, 키프레임 |
| hyperframes-cli | check · snapshot · add 등 명령 |
| hyperframes-registry | 전문 블록·전환·효과 (hyperframes add) |
| hyperframes-audio, media-use | 소리, 소재(검색·생성·처리) |
| motion-graphics, general-video, product-launch-video, music-to-video, faceless-explainer | 작업 흐름 |
| svg-character-motion | 모션스튜디오: 캐릭터 SVG 파츠 태깅·연기 |

Claude 세션에서는 앱이 `hyperframes`·`npx hyperframes` 명령을 앱에 들어 있는 HyperFrames로 연결한다(노드 설치 불필요, 미리 허용).

갱신 방법: `HOME=<임시폴더> npx hyperframes@<버전> skills` 로 받은 뒤 위 스킬만 복사하고, package.json의 hyperframes 버전도 같이 맞춘다.
