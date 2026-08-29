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

## 요구사항 (최초 1회)

| 항목 | 설치 |
|------|------|
| Claude Code CLI | 로그인된 `claude` 명령 (이미 사용 중) |
| whisper.cpp | `brew install whisper-cpp` |
| STT 모델 | `curl -L -o ~/JarvisHub/models/ggml-small-q8_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin` |

## 실행

- 개발: `npm start`
- 배포: `npm run dist` → `dist/Jarvis Hub-*.dmg`
  - 서명 없는 앱이므로 최초 실행 시 **우클릭 → 열기** (또는 시스템 설정 → 개인정보 보호 및 보안에서 허용)
  - 최초 🎙 클릭 시 마이크 권한 허용 필요

## 데이터 위치

- 문서: `~/JarvisHub/docs/*.html` (일반 HTML — 브라우저로도 열림)
- 설정: `~/JarvisHub/config.json` · 세션 매핑: `~/JarvisHub/sessions.json`

## ⚠️ 주의

Claude는 `--dangerously-skip-permissions`로 실행됩니다 — 지정한 프로젝트 폴더에서 파일 수정·명령 실행을 확인 없이 수행합니다. 신뢰하는 프로젝트에서만 사용하고, 파괴적 지시는 음성으로도 신중히.

## 로드맵 (다음 단계)

- 웨이크워드("자비스") 상시 대기 — Porcupine 연동
- barge-in(낭독 중 말 끊기), 스트리밍 TTS
- 작업계획 파일(speckit) 전용 뷰·음성 라우팅
