# Phase 2 — 단일 인덱스 + 루트 정리 (완료)

> 상위 ledger: `../README.md` · 완료 2026-06-15

## 한 일

1. **단일 진입점 생성**: `docs/ONBOARDING.md`(이미 훌륭한 "어디에 뭐가 있는지" 내비)를 `docs/README.md`로 승격·재작성. harness(SSoT)·tasks(ledger)·backlog·agents·archive로 링크하는 작은 지도.
2. **stale 루트 3문서 → `docs/archive/`**:
   - `ROADMAP.md`(2026-04, "완료: 없음"이나 실제 대부분 구현됨 — feature-status가 대체)
   - `PROJECT_STRUCTURE.md`(레거시 자기선언 — overview가 대체)
   - `RECOMMENDED_SUBAGENTS.md`(현 Codex-only 규칙과 모순 — "직접 작업" 권장)
3. **`docs/archive/README.md`** 추가: 보관 폴더가 현행 아님을 명시.
4. **링크 정합**: harness `feature-status.md`의 `features/fix`·`features/new` 경로를 `archive/...`로 치환(new/17 advisor는 미참조). advisor ledger `completed/05`에 발표자료 제거 주석.

## 유지된 것

- `docs/Redou_아이템_개요.md`(제품 개요) — 인덱스에서 링크.
- `docs/features/new/17`(advisor 활성 계획서), `backlog/`, `goals/`, `agents/`, `harness/`.

## 스코프 밖(후속, 비차단)

- `backlog/*`의 `../01-Idea/Rag_design_report.md` 상대링크 — 원래도 파일명 불일치로 일부 깨져 있었음. `archive/legacy/01-Idea/`로의 정리는 별도.
- `agents/codex-claude/codex-to-claude.md`(수천 줄 히스토리 로그)의 과거 경로 언급 — 이력이라 미수정.
- `AGENTS.md` 삭제 스테이징(세션 전부터) — 처리 미정.

## 검증

- 앱 코드/DB/harness 시맨틱 무변경(문서 이동·링크만).
- `docs/` 진입점 = `docs/README.md` 단일.
