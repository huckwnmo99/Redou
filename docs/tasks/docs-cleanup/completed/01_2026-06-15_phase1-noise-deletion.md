# Phase 1 — 외부 노이즈 삭제 (완료)

> 상위 ledger: `../README.md` · 완료 2026-06-15 · 커밋 `ad76d41`

## 한 일

`docs/`에서 앱·harness가 참조하지 않는 외부 vendored 자료와 발표 산출물 **245개**를 삭제.

| 대상 | 파일 수 | 정체 |
|------|--------:|------|
| `docs/reference/awesome-design-md` | 146 | 외부 디자인 참고 리포(awesome-design-md clone) |
| `docs/exports/Skills` | 66 | 외부 스킬 export 모음 |
| `docs/presentation_assets` | 33 | advisor·redou-agent 발표 산출물(png/svg/html/스크립트) |

## 근거

- 참조 추적: `presentation_assets` → 문서 5건만 참조(코드 0), vendored → 문서 2건만 참조(코드 0). 앱 빌드·harness 무영향.
- 사용자 결정: "앱에 영향 없는 것은 삭제"(발표자료 포함). 콘텐츠 손실 경고 후 진행 승인.

## 검증

- 커밋 `ad76d41`에 3개 폴더 삭제만 포함. **AGENTS.md(세션 전 스테이징, 무관)는 제외.**
- 복구 경로: git 이력(`git restore --source=ad76d41^ -- <path>` 또는 revert).

## 후속

- 발표자료를 가리키던 stale 링크(advisor ledger `completed/05`, `features/proposals/2026-04-28`)는 Phase 3에서 정리.
