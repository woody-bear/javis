# jarvis

> Jarvis 문서 · 음성/텍스트 피드백으로 보강됩니다 · 블록을 클릭하면 직접 편집

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
- **기능 보드 규칙 (완성/추가/개선 3섹션 + git 기반 변화 과정)** — 시스템 프롬프트로 강제되어 모든 문서가 같은 구조를 유지.
  <details><summary>변화 과정</summary>

  - `8e0e388` 문서 기능 보드 규칙 — 완성/추가/개선 3섹션 상시 유지 + git 커밋 기반 변화 과정
  </details>

## ➕ 추가할 기능

- barge-in — 작업 중 말 끊기/새 명령으로 대체 (README 로드맵)
- 작업계획 파일(speckit) 전용 뷰·음성 라우팅 (README 로드맵)
- 갈래 문서의 변경 요약을 상위 문서에 자동 반영(롤업)
- 문서 내 검색 / 전체 문서 검색
- 작업 로그 → git 커밋 자동 생성(옵션)

## 🔧 개선할 기능

- **맵 제스처 확장** — 현재 맵에서 ✊는 항상 첫 번째 프로젝트로만 이동. ☝👇로 맵 안에서 프로젝트를 하이라이트한 뒤 ✊로 선택하도록 확장하면 어떤 프로젝트든 손만으로 진입 가능.
- **README·`main.js` 헤더 주석 갱신** — 아직 "HTML 문서 / `say -v Yuna` 낭독 / `~/JarvisHub/docs`" 기준. 현재는 MD + 프로젝트별 `jarvis/` 저장 + TTS 제거 상태.
- **죽은 코드 정리** — `speak()`·`sayProc`·`config.voice` 는 62e9c86 이후 호출되지 않음. `tts:stop` IPC도 함께 정리.
- **호출어 감지 정확도** — 에너지 기반 VAD + 전체 발화 whisper 인식이라 잡음 환경에서 오탐/지연. README 로드맵의 Porcupine 등 경량 KWS 검토.
- **`webSecurity: false`** — MediaPipe wasm을 file://에서 fetch하기 위한 완화. 커스텀 프로토콜(`app://`) 등록으로 대체 가능.
- **문서 삭제 시 세션 정리** — `sessions.json` 잔여 항목 정리 여부 확인 필요.
- **자동 스캔 대상 하드코딩** — `~/workflow` 고정. 설정에서 스캔 루트를 지정할 수 있게.
- **`app.js` 1,100줄 단일 파일** — 음성/제스처/편집기/문서목록 모듈 분리.

## 개요

Jarvis는 **음성·텍스트·손 제스처**로 대화하면서, 주제별 마크다운 문서를 Claude가 직접 보강하고 연결된 프로젝트의 소스 작업까지 수행하는 macOS 로컬 Electron 앱이다. 문서 하나가 곧 하나의 Claude 세션이자 "대화의 기억"이며, 모든 인식(STT·제스처)은 로컬에서 처리된다.

```
🎙 음성 ──┐                                        ┌→ <프로젝트>/jarvis/*.md 보강
🗣 "자비스" ├→ whisper.cpp(로컬) ─┐                  │
✊ 제스처 ─┘ (MediaPipe 로컬)      ├→ claude -p (stream-json, --resume) ─┼→ 연결된 프로젝트 소스 수정
⌨ 텍스트 ─────────────────────────┘                  └→ 실시간 작업 로그 패널 + 응답 에코
```

## 주요 기능

| 영역 | 내용 | 위치 |
|------|------|------|
| 입력 | 🎙 녹음(침묵 자동 전송), "자비스" 호출어, ✊☝👇👉👌 제스처, 텍스트 | `app.js` 538–1010 |
| 두뇌 | `claude -p` 헤드리스 실행, 시스템 프롬프트 주입, 세션 resume, `--add-dir`로 문서 폴더 허용, ESC 중단 | `main.js` 266–415 |
| 문서 | MD 문서 목록/생성/삭제/갈래, 블록 WYSIWYG 편집, HTML→MD 변환 | `main.js` 56–265, `app.js` 13–440 |
| 프로젝트 | 문서↔프로젝트 폴더 연결(cwd), `~/workflow` 자동 스캔 | `main.js` 62–80, 611–642 |
| 피드백 | 도구 호출/결과/중간 텍스트를 실시간 로그 패널로, 제스처 토스트 | `app.js` 488–503, 853 |

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

## 작업 로그

- **2026-08-29** — 프로젝트 맵이 열린 상태에서 ✊ 주먹 제스처 → 첫 번째 프로젝트(정렬 1순위 루트 문서)로 이동하고 맵을 닫는 기능 추가. `app.js`: `mapRoots`(맵/사이드바 정렬 순서 루트 id) · `mapSelectFirst()` · 제스처 루프에 맵 열림+✊ 분기(작업 중에도 동작). 커밋 `6945994`.
- **2026-08-29** — 인터벌러너·추세추종프로젝트 문서를 keyboardwarrior/intervel-web과 같은 기능 보드 형식으로 재정리. `Intervelrunner/jarvis/인터벌러너.md`: 일반 이론 문서 → 워치·iOS 코드 분석(완성 9건, git 커밋이 1개뿐이라 변화 과정은 파일 수정일 기준). `trading_view/jarvis/추세추종프로젝트.md`: 기존 분석 14개 절은 유지하고 상단에 완성 21건(440커밋 기반 해시 연결)·추가 9·개선 8 신설.
- **2026-08-29** — 프로젝트 구조·소스(`main.js` 687줄, `app.js` 1,095줄)·git 로그 17개 커밋을 분석해 메인 문서 초기 작성. 기능 보드(완성 8 / 추가 5 / 개선 7) 정리. 발견: `speak()` 죽은 코드, README·헤더 주석이 HTML/TTS 시절 기준으로 낡음.
