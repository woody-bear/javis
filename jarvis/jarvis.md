# jarvis

> Jarvis 문서 · 음성/텍스트 피드백으로 보강됩니다 · 블록을 클릭하면 직접 편집

<!-- PURPOSE:START -->
## 🧭 프로젝트 목적 (한 문장)

> 로컬에서 작업중인 프로젝트를 자가개선하고 전체 프로젝트의 진행상황을 확인및 조정할수 있는 한눈에 보기좋은 만능툴

_이 한 문장이 모든 개선의 최종 목표다. 야간 자율 개선과 벤치마킹 조사는 "이 문장에 더 가까워지는가"로 후보를 고른다. 이 블록을 클릭해 언제든 수정할 수 있다._
<!-- PURPOSE:END -->

<!-- TOOLKIT:START -->
## 🧩 사용 중인 Skill · Agent · MCP

_자동 스캔 2026-09-02 — .claude/skills·commands·agents, .mcp.json 기준. 야간 러너가 매일 갱신_

| 구분 | 사용 중 |
|------|---------|
| 🛠 Skill | — (전역 기본만 사용) |
| 🤖 Agent | `benchmark-scout` · `fit-judge` · `impl-analyst` |
| 🔌 MCP | — (전역 기본만 사용) |
<!-- TOOLKIT:END -->

## 개요

Jarvis는 **음성·텍스트·손 제스처**로 대화하면서, 주제별 마크다운 문서를 Claude가 직접 보강하고 연결된 프로젝트의 소스 작업까지 수행하는 macOS 로컬 Electron 앱이다. 문서 하나가 곧 하나의 Claude 세션이자 "대화의 기억"이며, 모든 인식(STT·제스처)은 로컬에서 처리된다.

```
🎙 음성 ──┐                                        ┌→ <프로젝트>/jarvis/*.md 보강
🗣 "자비스" ├→ whisper.cpp(로컬) ─┐                  │
✊ 제스처 ─┘ (MediaPipe 로컬)      ├→ claude -p (stream-json, --resume) ─┼→ 연결된 프로젝트 소스 수정
⌨ 텍스트 ─────────────────────────┘                  └→ 실시간 작업 로그 패널 + 응답 에코
```

## 한눈에 보는 기능 구성

| 영역 | 핵심 기능 |
|------|-----------|
| **입력** | ⌨ 텍스트 · 🎙 음성(1.6s 침묵 자동 전송, 로컬 whisper) · 🗣 "자비스" 호출어 상시 대기 · 손 제스처 6종 |
| **제스처** | ✊ 음성↔텍스트 토글 · ☝👇 문서 이동 · 👉 세부문서 진입 · 👌 갈래 생성(음성 제목) · 🖐 프로젝트 맵 |
| **문서** | 마크다운 원본 저장 · 노션식 블록 편집(WYSIWYG·⋮⋮ 드래그·‹› 원문) · 갈래 트리·드래그 정렬·이름 변경 · HTML→MD 변환 |
| **두뇌** | `claude -p` 헤드리스(stream-json) · 문서별 세션 `--resume` · 모델 전역 선택 · ESC 중단(세션 보존) |
| **프로젝트** | 문서↔프로젝트 연결(cwd) · `<프로젝트>/jarvis/` 문서 저장·상속 · `~/workflow` 자동 스캔 → 메인 문서·분석 자동 생성 |
| **뷰·피드백** | ☰/🖐 프로젝트 맵(트리 연결 SVG) · 작업 과정 실시간 패널(요청→도구→결과) · 제스처 토스트 · ⛶ 전체 화면 |

## ✅ 완성된 기능

- **헤드리스 Claude 연동 + 문서별 세션 유지** — `claude -p --output-format stream-json`을 spawn, 문서 경로·규칙을 시스템 프롬프트로 주입, `sessions.json`에 문서↔세션 매핑을 저장해 `--resume`으로 이어감. ESC로 중단 가능(세션 보존).
  <details><summary>변화 과정</summary>

  - `26d05f3` Jarvis Hub MVP — 음성·텍스트 피드백 HTML 문서 허브 + claude 헤드리스 프로젝트 제어
  - `62e9c86` 음성 낭독 제거 → 요청 텍스트 에코 + ESC 작업 중단
  - `89f77e1` 작업 과정 실시간 로그 패널 — 도구 실행·중간 설명·결과 표시
  - `6e41a4b` 좀비 방지 — abort/quit 시 SIGTERM→SIGKILL 단계 종료
  </details>
- **로컬 STT (whisper.cpp)** — 🎙 클릭 후 1.6초 침묵 시 자동 전송, 렌더러에서 16k WAV 인코딩 → `whisper-cli -l ko`. 설치/모델 상태를 UI에 표시.
  <details><summary>변화 과정</summary>

  - `26d05f3` Jarvis Hub MVP (whisper-cli + ggml-small-q8_0)
  </details>
- **"자비스" 호출어 대기 모드** — 마이크 상시 개방, 에너지 기반 발화 구간 검출 → 로컬 whisper 인식 → `WAKE_RE`(자비스/쟈비스/jarvis…) 매칭. 뒤에 명령이 붙으면 즉시 전송, 호출어만이면 띵 소리 후 녹음.
  <details><summary>변화 과정</summary>

  - `0b50b14` '자비스' 호출어 대기 모드 — 로컬 whisper 발화 감지로 상시 음성 시작
  </details>
- **손 제스처 제어 (MediaPipe GestureRecognizer, 로컬 WASM 번들)** — ✊ 주먹: 음성 대기 ↔ 다시 ✊ 하면 녹음 취소·텍스트 입력 / ☝👇 검지 위·아래: 문서 이동 / 👉 검지 오른쪽: 첫 갈래로 진입 / 👌: 음성으로 새 갈래 생성 / 🖐 손바닥: 프로젝트 맵 토글 / 맵이 열린 상태에서 ✊: 첫 번째 프로젝트로 이동 + 맵 닫기. 발동 토스트 + ✋ 손 감지 상태 표시.
  <details><summary>변화 과정</summary>

  - `7ba8cbf` ✊ 주먹 제스처로 음성인식 시작 — MediaPipe GestureRecognizer 로컬 번들
  - `93a9752` ☝ 검지 위/아래 제스처로 문서 이동
  - `02246b6` 👉 검지 오른쪽 제스처 — 첫 갈래(세부문서)로 진입
  - `e443c43` 제스처 인식 시각 피드백 — 발동 토스트 + ✋ 손 감지 상태 표시
  - `f9ee993` 주먹 제스처 토글 — ✊ 음성 대기 ↔ 다시 ✊ 하면 녹음 취소 + 텍스트 입력 대기
  - `6e41a4b` 👌 갈래 생성
  - `1ddf3bc` Claude 작업 중에도 문서 탐색 제스처(☝👇👉) 동작 — ✊는 안내 토스트
  - `f27829e` 프로젝트 맵(☰) + 🖐 손바닥 제스처 토글
  - `6945994` 프로젝트 맵에서 ✊ 주먹 제스처 → 첫 번째 프로젝트로 이동 + 맵 닫기
  </details>
- **프로젝트 맵(☰)** — 전체 프로젝트(루트 문서)와 갈래를 SVG 트리로 그리는 전체 화면 뷰. 노드 클릭 또는 제스처로 문서 이동.
  <details><summary>변화 과정</summary>

  - `e4c9598` 노션식 블록 드래그 이동 (같은 시기 편집기 정비)
  - `f27829e` 프로젝트 맵(☰) — 전체 프로젝트·갈래 트리 연결 뷰 + 🖐 손바닥 제스처 토글
  - `6945994` 맵에서 ✊ 주먹 → 첫 번째 프로젝트 선택
  </details>
- **마크다운 문서 + 노션식 블록 편집기** — marked로 렌더, 블록 단위 클릭 편집(WYSIWYG, turndown으로 HTML→MD 역변환), 저장은 마크다운 원본. 레거시 HTML 문서는 MD로 변환 가능.
  <details><summary>변화 과정</summary>

  - `2551197` 마크다운 문서 전환 + 노션 스타일 블록 편집기
  - `5d1ba8e` 레거시 HTML→MD 변환 (turndown + gfm)
  - `8148e6c` 노션식 WYSIWYG 블록 편집 — 렌더된 서식 그대로 수정, 저장은 마크다운 원본
  - `6e41a4b` md 렌더 버그 수정
  </details>
- **문서 갈래(브랜치) 트리** — `.doctree.json`으로 부모-자식 관계, 트리 사이드바, ⑂ 분기 생성 시 상하위 자동 링크, 갈래 세션에는 상위 문서 경로를 컨텍스트로 전달. 드래그 정렬(`.docorder.json`).
  <details><summary>변화 과정</summary>

  - `be22a5b` 문서 갈래(브랜치) — 트리 사이드바·⑂ 분기·상하위 자동 링크·갈래 세션 컨텍스트
  - `c14282d` 문서 드래그 정렬 + 문서별 프로젝트 폴더 연결
  </details>
- **프로젝트 연결 + `~/workflow` 자동 스캔** — 문서별 프로젝트 폴더(`.docprojects.json`)를 claude의 cwd로 사용, 문서 파일은 `<프로젝트>/jarvis/` 에 저장(`.docroots.json`). 시작 3초 후·10분마다 `~/workflow/*` 를 스캔해 미연결 프로젝트의 메인 문서를 자동 생성.
  <details><summary>변화 과정</summary>

  - `fed0920` 프로젝트명 Jarvis로 변경 + 문서 저장소를 프로젝트 docs/로 이동
  - `c14282d` 문서별 프로젝트 폴더 연결
  - `5d1ba8e` 프로젝트별 jarvis/ 문서 저장
  - `6e41a4b` workflow 자동 스캔
  </details>
- **사이드바 문서 이름 변경** — 항목의 ✎ 버튼 또는 제목 더블클릭 → 인라인 입력(Enter 저장 / Esc 취소). 파일 id는 그대로 두고 문서의 첫 H1(레거시 HTML은 `<title>`)만 교체하므로 세션·프로젝트·갈래 매핑이 유지된다.
  <details><summary>변화 과정</summary>

  - `c14282d` 문서 드래그 정렬 (사이드바 항목 조작의 시작)
  - `377dd35` 사이드바 문서 이름 변경 — ✎ 버튼/더블클릭 인라인 편집, H1만 교체(파일 id·세션 유지)
  </details>
- **기능 보드 규칙 (완성/추가/개선 3섹션 + git 기반 변화 과정)** — 시스템 프롬프트로 강제되어 모든 문서가 같은 구조를 유지.
  <details><summary>변화 과정</summary>

  - `8e0e388` 문서 기능 보드 규칙 — 완성/추가/개선 3섹션 상시 유지 + git 커밋 기반 변화 과정
  </details>
- **[벤치 I-17] 야간 브리핑에 어젯밤 Claude 실행 비용 표시** — night_runner·bench_runner가 `claude -p` stream-json의 result 이벤트에서 `total_cost_usd`를 함께 저장하고, 야간 브리핑 요약 줄(🌙 아이디어 카운트 줄 · 🔭 목적 줄)에 `💰 오늘 야간 실행 비용 $x.xx` 합계를 표시(비용 0이면 생략). 실행 기록 `night/<날짜>.json`에도 프로젝트별 `cost`가 남아 섹션 복원 시에도 유지.
  <details><summary>변화 과정</summary>

  - `830ce84` 야간 러너 '개선 아이디어 제안' 전환 — result 이벤트 파싱 구조 도입(비용은 버려짐)
  - `32ea096` 3단계 벤치마킹 파이프라인 — runStage도 같은 파싱 구조 공유
  - (2026-09-02, 미커밋) I-17 구현 — runClaude/runStage에 cost 캡처, renderBriefingSection·renderSection에 합계 표시. 검증 완료·커밋 대기
  </details>
- **[벤치 I-19] 프로젝트 맵 노드에 착수 대기 건수 배지** — 프로젝트 맵의 루트 노드 meta에 bench.json의 `status: accepted` 건수를 `⏳ 착수 n` 배지로 표시. `bench:acceptedCounts` IPC(main)가 문서 id별 건수를 집계하고, renderMap()이 함께 읽어 렌더(실패 시 빈 객체 폴백 — 맵 렌더는 항상 동작).
  <details><summary>변화 과정</summary>

  - `f27829e` 프로젝트 맵(☰) — 노드 meta(폴더명·갈래 수·수정 시각) 도입
  - `32ea096` 벤치마킹 파이프라인 — bench.json에 착수 상태(accepted) 기록 시작
  - (2026-09-02, 미커밋) I-19 구현 — `bench:acceptedCounts` IPC + 맵 루트 노드 `⏳ 착수 n` 배지. 검증 완료·커밋 대기
  </details>
- **[벤치 I-27] 야간·벤치 러너의 '이전 제안' 목록을 최근 20건으로 제한** — night_runner의 `priorTitles`·bench_runner의 `prior`가 프로젝트별 이력을 `acceptedAt → date` 최신순으로 정렬해 앞 20건(`PRIOR_LIMIT`)만 프롬프트에 주입. bench.json 이력 자체와 신규 아이디어 중복 검사(`seen`)는 전체 이력 기준 그대로 유지.
  <details><summary>변화 과정</summary>

  - `830ce84` 야간 러너 '아이디어 제안' 전환 — 이력 전체를 "이미 제안된 아이디어"로 프롬프트에 주입하기 시작
  - `32ea096` 벤치마킹 파이프라인 — 1단계 프롬프트에 프로젝트별 이전 사례 전체 주입
  - (2026-09-02, 미커밋) I-27 구현 — 두 파일에 `recentPrior()`/`PRIOR_LIMIT=20` 도입, 프롬프트 주입분만 slice. 검증 완료·커밋 대기
  </details>
- **Claude 모델 전역 선택** — 사이드바 드롭다운(기본/Fable/Opus/Sonnet/Haiku). `config.model` → `claude --model` 플래그로 전달, 모든 문서·프로젝트·자동 분석에 동일 적용.
  <details><summary>변화 과정</summary>

  - `b759955` Claude 모델 전역 선택 — 기본/Fable/Opus/Sonnet/Haiku, 모든 문서·프로젝트 동일 적용
  </details>
- **작업 패널 통합 + ⛶ 문서 전체 화면** — 요청 에코·도구 로그·최종 결과·자동분석 알림을 입력창 위 '작업 과정' 한 패널에 시간순 통합. ⛶ 버튼으로 사이드바·패널·입력창을 숨기고 문서만 크게(ESC 복귀).
  <details><summary>변화 과정</summary>

  - `89f77e1` 작업 과정 실시간 로그 패널
  - `5e4b217` 작업 과정·요청·결과 단일 패널 통합(입력창 위) + ⛶ 문서 전체 화면
  </details>

## ➕ 추가할 기능

-   barge-in — 작업 중 말 끊기/새 명령으로 대체 (README 로드맵)
-   작업계획 파일(speckit) 전용 뷰·음성 라우팅 (README 로드맵)
-   갈래 문서의 변경 요약을 상위 문서에 자동 반영(롤업)
-   문서 내 검색 / 전체 문서 검색
-   작업 로그 → git 커밋 자동 생성(옵션)
-   사이드바·프로젝트 맵에 git/GitHub 연결 상태 뱃지 표시 (🟢 원격 연결 / 🟡 로컬만 / 🔴 없음) + 미연결 프로젝트 원클릭 `gh repo create`

## 🔧 개선할 기능

- **이름 변경 시 파일명 동기화 옵션** — 현재는 제목(H1)만 바뀌고 파일명(`jarvis.md` 등)은 유지. 원하면 `renameDocId()`로 파일명까지 함께 바꾸는 옵션 추가 가능(갈래 링크·세션 매핑 일괄 갱신 로직은 이미 있음).
- **맵 제스처 확장** — 현재 맵에서 ✊는 항상 첫 번째 프로젝트로만 이동. ☝👇로 맵 안에서 프로젝트를 하이라이트한 뒤 ✊로 선택하도록 확장하면 어떤 프로젝트든 손만으로 진입 가능.
- **README·`main.js` 헤더 주석 갱신** — 아직 "HTML 문서 / `say -v Yuna` 낭독 / `~/JarvisHub/docs`" 기준. 현재는 MD + 프로젝트별 `jarvis/` 저장 + TTS 제거 상태.
- **죽은 코드 정리** — `speak()`·`sayProc`·`config.voice` 는 62e9c86 이후 호출되지 않음. `tts:stop` IPC도 함께 정리.
- **호출어 감지 정확도** — 에너지 기반 VAD + 전체 발화 whisper 인식이라 잡음 환경에서 오탐/지연. README 로드맵의 Porcupine 등 경량 KWS 검토.
- **`webSecurity: false`** — MediaPipe wasm을 file://에서 fetch하기 위한 완화. 커스텀 프로토콜(`app://`) 등록으로 대체 가능.
- **문서 삭제 시 세션 정리** — `sessions.json` 잔여 항목 정리 여부 확인 필요.
- **자동 스캔 대상 하드코딩** — `~/workflow` 고정. 설정에서 스캔 루트를 지정할 수 있게.
- **`app.js` 1,100줄 단일 파일** — 음성/제스처/편집기/문서목록 모듈 분리.

## 구조

```
jarvis/
├─ package.json          electron 33 · electron-builder(mac dmg, arm64) · marked · turndown · @mediapipe/tasks-vision
├─ src/
│  ├─ main.js            메인 프로세스: 문서 저장소·트리·프로젝트 매핑, claude/whisper 실행, IPC, workflow 스캔
│  ├─ preload.js         contextBridge → window.jarvis.{docs, chat, stt, tts, config, events}
│  └─ renderer/
│     ├─ index.html / style.css   사이드바(트리) + 문서 뷰 + 입력창 + 작업 로그 패널
│     ├─ app.js          문서 렌더/편집, 녹음·호출어·제스처, 메시지 전송·로그
│     └─ vendor/         marked, turndown(+gfm), MediaPipe vision wasm + gesture_recognizer.task
├─ docs/                 중앙 메타: .docorder.json(정렬) · .docprojects.json(문서→프로젝트) · .docroots.json(문서→저장 폴더) · .doctree.json(갈래)
└─ jarvis/jarvis.md      이 문서 (프로젝트 메인 문서)

~/JarvisHub/             config.json(projectPath, wakeMode, gestureMode…) · sessions.json(문서→claude 세션) · models/ggml-small-q8_0.bin
```

### 데이터 흐름 (한 번의 피드백)

1. 렌더러 `sendMessage(text)` → `chat:send` IPC
2. `runClaude()`가 문서 경로·상위 문서·프로젝트 cwd를 결정하고 `claude` spawn
3. stdout의 stream-json 라인을 파싱해 `tool`/`text`/`tool_result` 이벤트를 `chat:event`로 렌더러에 전송
4. 종료 시 세션 ID 저장, 결과 텍스트 반환 → 렌더러가 문서를 다시 렌더

### 실행

- 개발 `npm start` · 배포 `npm run dist` (미서명 → 최초 우클릭 열기)
- 전제: 로그인된 `claude` CLI, `brew install whisper-cpp`, `~/JarvisHub/models/ggml-small-q8_0.bin`
- ⚠️ `--dangerously-skip-permissions` 로 실행되므로 신뢰하는 프로젝트에서만 연결

## 프로젝트 GitHub 연결 현황 (2026-08-29 점검)

`docs/.docprojects.json`에 연결된 7개 프로젝트를 `git remote` · `gh repo list`(계정 woody-bear)로 확인.

| 문서 | 프로젝트 | git | GitHub 원격 | 상태 |
|------|----------|-----|-------------|------|
| 추세추종프로젝트 | `trading_view` | ✅ 440 커밋 | ✅ `woody-bear/trading_view` (private) | 🟢 정상 연결 — origin/main과 동기화(0 ahead/0 behind), 미커밋 1건(`jarvis/`) |
| jarvis | `jarvis` | ✅ | ✅ `woody-bear/javis` (private) | 🟢 정상 연결 (2026-08-30 push) |
| 인터벌러너 | `Intervelrunner` | ⚠️ 1 커밋(Initial) | ❌ 원격 없음 | 🟡 로컬 git만 — 미커밋 17건(소스 대부분) |
| ai_helper | `ai_helper` | ❌ | ❌ | 🔴 git 저장소 아님 |
| intervel | `intervel` | ❌ | ❌ | 🔴 git 저장소 아님 |
| intervel-web | `intervel-web` | ❌ | ❌ | 🔴 git 저장소 아님 |
| keyboardwarrior | `keyboardwarrior` | ❌ | ❌ | 🔴 git 저장소 아님 |

- GitHub에 연결된 프로젝트는 **trading_view 1개뿐**. 나머지 6개는 GitHub 저장소 자체가 없음(계정의 기존 저장소 목록에도 해당 이름 없음).
- 다음 단계 제안: ① `jarvis`·`Intervelrunner` → `gh repo create woody-bear/<이름> --private --source . --push` ② 나머지 4개 → `git init` 후 동일. (실행은 요청 시 진행 — 외부 공개 작업이라 확인 후 수행)

## 작업 로그

- **2026-09-02** — [벤치 I-27] 야간·벤치 러너 '이전 제안' 목록 최근 20건 제한 구현 (검증 완료·**커밋 대기** — 공통 규칙 '에이전트 단독 커밋 금지'). 변경: `night_runner.js`·`bench_runner.js`에 `PRIOR_LIMIT = 20`과 `recentPrior(items, limit)`(`acceptedAt` 우선, 없으면 `date` 기준 최신순 정렬 후 slice, 원본 불변)를 두고 `priorTitles`/`prior` 계산부만 이를 거치도록 수정 — bench.json은 손대지 않고, night_runner의 신규 아이디어 중복 검사(`seen`)는 전체 이력 기준 유지. 검증: node --check 2파일 통과 + `recentPrior` 단위 테스트(25건→20건, 착수일 최신 항목 최우선, 가장 오래된 5건 제외, 원본 미변경, 빈 배열/1건 경계) 통과, 실제 bench.json(Intervelrunner 11건)은 20건 미만이라 현재 동작 동일. **근거**: night_runner.js:141-148·bench_runner.js:179-192가 프로젝트별 bench.json 이력 전체(Intervelrunner 11 · trading_view 10 · keyboardwarrior 8 · jarvis 6)를 매일 밤 프롬프트에 통째로 주입해, 하루 최대 3건씩 늘어나는 목록이 끝없이 커짐 (벤치 I-27, 2026-09-02 착수 승인).

- **2026-09-02** — [벤치 I-19] 프로젝트 맵 착수 대기 배지 구현 (검증 완료·**커밋 대기** — 공통 규칙 '에이전트 단독 커밋 금지'). 변경: `main.js`에 `bench:acceptedCounts` IPC(bench.json에서 `status: accepted`를 docId별 집계) · `preload.js` `bench.acceptedCounts` 노출 · `app.js` renderMap()이 건수를 함께 읽어 루트 노드 meta에 `⏳ 착수 n` 배지 표시(IPC 실패 시 `{}` 폴백으로 맵 렌더 보존, 갈래 노드에는 미표시). 검증: node --check 3파일 통과 + 실제 bench.json 집계 테스트(인터벌러너 3 · keyboardwarrior 3 · 추세추종 1 · jarvis 1) 통과. **근거**: renderMap()의 노드 meta가 폴더명·갈래 수·수정 시각만 표시해 맵에서 어떤 프로젝트에 처리할 착수 항목이 쌓여 있는지 알 수 없었음 (src/renderer/app.js 노드 meta 부분, bench.json status:accepted — 벤치 I-19, 2026-09-02 착수 승인).

- **2026-09-02** — [벤치 I-17] 야간 브리핑 Claude 실행 비용 표시 구현 (검증 완료·**커밋 대기** — 공통 규칙 '에이전트 단독 커밋 금지'에 따라 커밋은 사용자 확인 후). 변경: `night_runner.js` runClaude가 result 이벤트의 `total_cost_usd`를 캡처해 프로젝트 결과 `cost`로 저장하고 요약 줄에 `💰 오늘 야간 실행 비용 $x.xx` 합계 표시(0이면 생략, `night/<날짜>.json`에도 기록되어 복원 시 유지) · `bench_runner.js` runStage가 단계별 비용을 누적해 renderSection 목적 줄에 표시(실패 브리핑에도 그 시점까지의 비용 포함). 검증: node --check 2파일 통과 + renderBriefingSection/renderSection 단위 테스트(합산 $0.40 표시 · 0이면 미표시 · 벤치 $1.06 표시) 통과. **근거**: night_runner.js 113~127행·bench_runner.js 72~83행이 `ev.result`만 남기고 같은 이벤트의 `total_cost_usd`를 버려 야간 자동화 비용을 어디서도 확인할 수 없었음 (벤치 I-17, 2026-09-02 착수 승인).

- **2026-08-29** — 사이드바 문서 이름 변경 기능 구현(커밋 `377dd35`). `main.js` `docs:rename` IPC(H1/`<title>` 교체), `preload.js` `docs.rename`, `app.js` ✎ 버튼·더블클릭 인라인 편집(편집 중 드래그/선택 비활성), `style.css` 입력창 스타일.

- **2026-08-29** — 연결된 7개 프로젝트의 git/GitHub 연결 상태 점검 → "프로젝트 GitHub 연결 현황" 섹션 추가. 결과: GitHub 연결 1(trading_view) / 로컬 git만 2(jarvis, Intervelrunner) / git 없음 4.

- **2026-08-29** — 프로젝트 맵이 열린 상태에서 ✊ 주먹 제스처 → 첫 번째 프로젝트(정렬 1순위 루트 문서)로 이동하고 맵을 닫는 기능 추가. `app.js`: `mapRoots`(맵/사이드바 정렬 순서 루트 id) · `mapSelectFirst()` · 제스처 루프에 맵 열림+✊ 분기(작업 중에도 동작). 커밋 `6945994`.
- **2026-08-29** — 인터벌러너·추세추종프로젝트 문서를 keyboardwarrior/intervel-web과 같은 기능 보드 형식으로 재정리. `Intervelrunner/jarvis/인터벌러너.md`: 일반 이론 문서 → 워치·iOS 코드 분석(완성 9건, git 커밋이 1개뿐이라 변화 과정은 파일 수정일 기준). `trading_view/jarvis/추세추종프로젝트.md`: 기존 분석 14개 절은 유지하고 상단에 완성 21건(440커밋 기반 해시 연결)·추가 9·개선 8 신설.
- **2026-08-29** — 프로젝트 구조·소스(`main.js` 687줄, `app.js` 1,095줄)·git 로그 17개 커밋을 분석해 메인 문서 초기 작성. 기능 보드(완성 8 / 추가 5 / 개선 7) 정리. 발견: `speak()` 죽은 코드, README·헤더 주석이 HTML/TTS 시절 기준으로 낡음.

## 갈래

- [🚀 멀티 프로젝트 운영 철학 — 머스크 모델](jarvis-운영-철학.md) — 프로젝트=회사, 목적=미션, 야간 러너=야간 엔지니어링, 브리핑=경영 회의, 착수=자원 배분

- [jarvis 개선 규칙](jarvis-개선-규칙.md) — 이 프로젝트 전용 규칙. 전 프로젝트 공통 규칙은 루트 문서 `docs/공통-개선-규칙.md`. 개선 목표 = 메인 문서 상단 🧭 프로젝트 목적 한 문장
