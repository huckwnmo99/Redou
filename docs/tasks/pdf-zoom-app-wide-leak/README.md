# PDF Zoom — App-wide Zoom Leak

## Purpose

PDF 확대(Ctrl+휠 / Ctrl+= ) 시 PDF 리더의 자체 scale 줌은 정상인데, PDF 영역 **바깥**(헤더·여백)이나 PDF 탭이 아닐 때는 Electron 기본 webContents 줌이 발동해 "리더 열기" 버튼 등 **앱 UI 전체가 확대·이동**하는 버그를 수정한다.

이 ledger는 컨텍스트를 작게 유지한다: 이 README를 먼저 읽고, 다음 단계에 맞는 링크 1개(계획 슬라이스)만 연다.

## Current Status

- Status: in-progress (구현 완료, `/test`·`/review` 대기)
- Size: 소규모 (fix) — 수정 1파일(`main.mjs`), DB/IPC/컴포넌트/마이그레이션 무변경
- Phase: `fixer` 구현 완료(`node --check` 통과). `/test` 검증 대기.
- Owner: 메인 Claude (오케스트레이터); 구현은 `fixer` 서브에이전트
- 원인: BrowserWindow `webPreferences`에 줌 제어 부재 + 렌더러 전역 줌 가드 부재 → PDF scroll container 밖에서 Electron 기본 webContents 줌이 앱 전체에 적용됨 (코드로 확정, 근거는 완료 슬라이스 참조)
- 조치: `main.mjs`에 `lockWebContentsZoom(webContents)` 헬퍼 추가 — `setVisualZoomLevelLimits(1,1)`(핀치 차단) + `before-input-event`로 Ctrl/Cmd+`=`/`+`/`-`/`0` 차단 + `setZoomFactor(1)`/`zoom-changed` 고정. 메인 창·detached 창 양쪽에 적용. PDF 리더 자체 scale 줌은 무변경.

## Next Action

`/test`로 빌드/타입/린트 회귀를 검증한다(`node --check apps/desktop/electron/main.mjs`는 `fixer`가 통과 확인). 이후 `/review`로 코드 리뷰 + PR 생성. Electron 수동 검증 항목은 완료 슬라이스의 "검증 방법" 참조(헤더 영역·비-PDF 화면 Ctrl+휠/Ctrl+= 시 앱 미확대, PDF 영역 안 자체 줌 보존, detached 창 동일).

**PDF 리더의 자체 scale 줌(`PdfReaderWorkspace`)은 무변경·보존됨.**

## Success Criteria

- PDF 영역 **바깥**(헤더·여백)에서 Ctrl+휠/Ctrl+= 해도 앱 UI(버튼·헤더·사이드바)가 확대/이동하지 않는다.
- PDF 탭이 **아닌** 화면(라이브러리·검색·노트 등)에서 Ctrl+= /Ctrl+- 해도 앱 전체가 확대되지 않는다.
- PDF 영역 **안**에서 Ctrl+휠/Ctrl+= 는 기존대로 PDF만 자연스럽게 확대된다(리더 자체 scale 줌 보존).
- detached 패널 창에서도 동일하게 webContents 줌이 발동하지 않는다.
- DB/IPC/컴포넌트/`CURRENT_EXTRACTION_VERSION` 무변경.

## Documents To Read

- `completed/01_2026-06-24_pdf-zoom-app-wide-leak.md` — 원인 진단(코드 근거 포함), 수정안 비교(A/B), 채택안, 검증 절차.
- `CLAUDE.md` (repo root) — 워크플로우·규칙·스킬 정책. 현재 상태: `docs/harness/main/feature-status.md`.
- 참고 코드: `apps/desktop/electron/main.mjs`(BrowserWindow 생성부), `frontend/src/features/paper/PdfReaderWorkspace.tsx`(리더 자체 줌 — 보존 대상).

## Planned

- None.

## In Progress

- None.

## Completed

- App-wide zoom leak fix — `completed/01_2026-06-24_pdf-zoom-app-wide-leak.md` (2026-06-24, `fixer`: `main.mjs`에 `lockWebContentsZoom` 추가, `node --check` 통과)

## Last Updated

2026-06-24
