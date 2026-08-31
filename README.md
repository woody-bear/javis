# Jarvis Hub

음성·텍스트 피드백으로 **HTML 문서를 생성·보강**하고, 같은 대화로 **실제 프로젝트 소스코드 작업**까지 시키는 로컬 소통창구 앱 (macOS).

## 동작 방식

```
🎙 음성 ─┐
         ├→ whisper.cpp(로컬 STT) → claude -p (헤드리스, 세션 유지) ─┬→ ~/JarvisHub/docs/*.html 보강
⌨ 텍스트 ┘                                                          ├→ 선택한 프로젝트 소스 수정
                                                                    └→ 응답 요약 → say -v Yuna (한국어 낭독)
```

- **문서 = 대화의 기억**: 주제(질문)마다 HTML 문서 1개가 만들어지고, 피드백을 줄 때마다 Claude가 문서를 직접 수정해 점점 좋은 참조 문서로 자랍니다. 문서별로 Claude 세션이 이어집니다(`--resume`).
- **프로젝트 작업**: 사이드바 하단 PROJECT 경로를 클릭해 작업 대상 폴더를 지정하면, "이 기능 구현해줘" 같은 지시가 실제 코드 수정으로 이어지고 결과가 문서의 '작업 로그'에 남습니다.
- **음성**: 🎙 클릭 → 말하기 → 1.6초 침묵 시 자동 전송. 응답은 한국어로 낭독(끄기 가능).

## 🖥 다른 PC에서 설치·실행 (처음부터 끝까지)

```bash
# 0) 요구사항: macOS(Apple Silicon), Node 20+ (nvm 권장), git
# 1) 소스 받기
git clone https://github.com/woody-bear/javis.git ~/workflow/jarvis
cd ~/workflow/jarvis
npm install

# 2) Claude Code CLI — 설치 후 로그인 (앱과 야간 러너가 사용)
#    https://claude.com/claude-code 안내에 따라 설치 → 터미널에서 `claude` 실행해 로그인

# 3) 음성 인식(STT, 선택 — 🎙 기능을 쓸 때만)
brew install whisper-cpp
mkdir -p ~/JarvisHub/models
curl -L -o ~/JarvisHub/models/ggml-small-q8_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin

# 4) 실행
npm start                 # 개발 모드로 바로 실행
# 또는 앱으로 빌드해 설치:
npm run dist              # → dist/mac-arm64/Jarvis.app, dist/Jarvis-*.dmg
cp -R dist/mac-arm64/Jarvis.app /Applications/
```

- 서명 없는 앱이므로 최초 실행 시 **우클릭 → 열기** (또는 시스템 설정 → 개인정보 보호 및 보안에서 허용). 최초 🎙 클릭 시 마이크 권한 허용.
- `.dmg`/`dist/`는 저장소에 **커밋하지 않습니다** (대용량 바이너리로 git이 비대해짐) — 각 PC에서 `npm run dist`로 빌드하거나, 배포가 필요하면 GitHub Releases에 올리세요.

### 프로젝트 루트 지정·추적 관리

- 첫 실행 후 사이드바 하단 **PROJECT ROOT · 🗂 추적 관리**를 클릭 → 루트 폴더(기본 `~/workflow`)를 지정하고, 하위 폴더별 **체크박스로 추적 여부**를 정합니다.
- 체크된 폴더만: 메인 문서 자동 생성(`<프로젝트>/jarvis/`) · 야간 아이디어 · 벤치마킹 대상. 체크 해제해도 문서는 보존되며 다시 체크하면 복원됩니다.
- 각 프로젝트 메인 문서 상단 **🧭 프로젝트 목적(한 문장)** 을 작성해야 야간 아이디어·벤치마킹이 동작합니다.

### 야간 러너 등록 (launchd, 선택)

```bash
# scripts/ 의 두 plist에서 사용자 경로·node 경로를 내 것으로 바꾼 뒤 등록
sed "s|/Users/woody|$HOME|g; s|/.nvm/versions/node/v24.14.0|$(dirname $(dirname $(which node)))|g" \
  scripts/com.woody.jarvis.night.plist > ~/Library/LaunchAgents/com.$USER.jarvis.night.plist
sed "s|/Users/woody|$HOME|g; s|/.nvm/versions/node/v24.14.0|$(dirname $(dirname $(which node)))|g" \
  scripts/com.woody.jarvis.bench.plist > ~/Library/LaunchAgents/com.$USER.jarvis.bench.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.$USER.jarvis.night.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.$USER.jarvis.bench.plist
```

- 23:00 **아이디어 러너**: 모든 추적 프로젝트를 읽고(코드 수정 없음) 개선 아이디어를 아침 브리핑으로 — 매일 다른 아이디어
- 22:00 **벤치마킹 러너**: 하루 1개 프로젝트 순환, 3단계 에이전트(사례 조사 → 구현 분석 → 적합성 판정)
- 브리핑의 **🚀 착수**를 누르면 '➕ 추가할 기능' 등재 후 개선 작업이 앱에서 바로 시작됩니다 (🔴 게이트 항목은 등재만)

## 데이터 위치

- 문서: `~/JarvisHub/docs/*.html` (일반 HTML — 브라우저로도 열림)
- 설정: `~/JarvisHub/config.json` · 세션 매핑: `~/JarvisHub/sessions.json`

## ⚠️ 주의

Claude는 `--dangerously-skip-permissions`로 실행됩니다 — 지정한 프로젝트 폴더에서 파일 수정·명령 실행을 확인 없이 수행합니다. 신뢰하는 프로젝트에서만 사용하고, 파괴적 지시는 음성으로도 신중히.

## 로드맵 (다음 단계)

- 웨이크워드("자비스") 상시 대기 — Porcupine 연동
- barge-in(낭독 중 말 끊기), 스트리밍 TTS
- 작업계획 파일(speckit) 전용 뷰·음성 라우팅
