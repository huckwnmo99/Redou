# Read-only Improvement Advisor

## Purpose

Track the work needed for Redou to inspect its own local workspace state and suggest evidence-backed improvements to the user.

This ledger keeps implementation context small: read this README first, then open only the linked plan, active detail, completed summary, or decision record that matches the next step.

## Current Status

- Status: active — 살리기로 결정(2026-06-17). 폐기하지 않음.
- Size: Large
- Current phase: analyzer + snapshot adapter + 테스트 구현 완료(현재 앱 미연결 = **보존 대상**, 제거 금지). UI 연결은 **테스터 운영 단계**에서 착수 예정.
- 용도: 테스터가 앱을 사용하며 워크스페이스 약점(처리 실패·검색 누락·빈약한 표·정리 미흡 등)을 **수집·축적**하는 도구.
- Owner: 메인 Claude (오케스트레이터); 구현은 `developer`/`fixer` 서브에이전트
- Stakeholders: User, 테스터(약점 수집 운영), future Redou runtime implementer
- Source of truth: `docs/features/new/17-read-only-improvement-advisor.md`
- Review cadence: milestone

## Non-Technical Summary

The app should eventually notice where the research workspace is weak, such as failed processing, missing searchable data, weak table evidence, sparse extraction, or messy library organization. The first implementation should only read existing local data and present suggestion cards; it should not change data, collect long-lived behavior logs, or depend on an LLM.

## Next Action

advisor를 **살린다(확정)**. UI 연결로 활성화 — Settings 카드 또는 별도 advisor 뷰 + 실데이터 쿼리 배선. **테스터 운영 단계에서 착수**하며, 그때까지 `frontend/src/lib/advisor/` 코드(analyzeWorkspace·buildWorkspaceSnapshot·테스트)는 보존한다(제거 금지).

## Success Criteria

- The first implementation can run without DB migrations or raw event logging.
- Every suggestion includes evidence, impact, confidence, risk, and a recommended next action.
- Suggestions never include raw PDF text, note bodies, or chat prompt text.
- The feature works without an LLM.
- The user must approve any future mutation or task creation.

## Documents To Read

- `docs/features/new/17-read-only-improvement-advisor.md` - feature plan, analyzer categories, data retention strategy, and MVP boundaries.
- `CLAUDE.md` (repo root) - workflow, rules, skill policy. (AGENTS.md was removed in docs-cleanup; CLAUDE.md is the active agent-context file.) Current status: `docs/harness/main/feature-status.md`.

## Planned

- Query/data loading and optional Settings card - `planned/02_2026-06-01_snapshot-wiring-and-settings-card.md`

## In Progress

- None.

## Completed

- PPT deck from presentation draft - `completed/05_2026-06-10_presentation-deck.md`
- Seven-page non-technical presentation draft - `completed/04_2026-06-10_non-technical-presentation.md`
- Snapshot wiring adapter - `completed/03_2026-06-01_snapshot-wiring-adapter.md`
- Analyzer-only implementation - `completed/02_2026-06-01_analyzer-only-implementation.md`

## Recent Archive

- Read-only first before event logging - `archive/decisions/01_2026-06-01_read-only-first-before-events.md`
- Superseded MVP analyzer plan - `archive/planned/01_2026-06-01_mvp-read-only-analyzer.md`

## Last Updated

2026-06-10
