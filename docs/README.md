# Redou 문서 인덱스

이 폴더의 **단일 진입점**. "어디에 뭐가 있는지"만 가리킨다 — 먼저 여기서 길을 찾고, 필요한 문서만 연다.

## 제품이 뭔지
- [`Redou_아이템_개요.md`](Redou_아이템_개요.md) — 제품 개요·차별점 (vs Mendeley/Zotero/ChatGPT)
- 루트 [`../README.md`](../README.md) — 실행 방법·환경변수

## 시스템 진실원천 (SSoT) — [`harness/`](harness/)
코드의 현재 동작을 가리키는 단일 진실원천. 코드와 다르면 **코드를 믿고 harness를 갱신**한다.
- [`harness/main/overview.md`](harness/main/overview.md) — 기술 스택, 외부 서비스(포트), 핵심 용어
- [`harness/main/flows.md`](harness/main/flows.md) — PDF 임포트→처리→임베딩→검색→채팅 데이터 흐름
- [`harness/main/feature-status.md`](harness/main/feature-status.md) — 전체 기능 매트릭스 (지금 뭐가 되는지)
- [`harness/VERSION.md`](harness/VERSION.md) — harness 변경 이력
- `harness/detail/` — 영역별 상세 (electron / frontend / database / services)
- `harness/decisions/` — 아키텍처 결정 기록(ADR)

## 진행 중인 작업 — [`tasks/`](tasks/) (ledger)
각 작업의 ledger. **README 먼저 읽고** 링크된 것만 연다. ledger 운영 방식(매 작업 사이클·구조·트리거): [`tasks/README.md`](tasks/README.md).
- [`tasks/read-only-improvement-advisor/`](tasks/read-only-improvement-advisor/) — 읽기 전용 개선 어드바이저 (활성, 테스터 단계 대기)
- [`tasks/pipeline-risk-audit/`](tasks/pipeline-risk-audit/) — 핵심 파이프라인 위험 감사 (발견 28건, 수정 승격 대기)
- [`tasks/table-semantics-hardening/`](tasks/table-semantics-hardening/) — 테이블 의미 보존 강화 (Phase 1 구현·E2E 재실증 통과, PR #4 merge 대기)
- [`tasks/pdf-zoom-app-wide-leak/`](tasks/pdf-zoom-app-wide-leak/) — PDF 줌 앱 전체 누수 fix (구현 완료, /test 대기)
- [`tasks/docs-cleanup/`](tasks/docs-cleanup/) — 문서 재편 (완료)
- 활성 기능 계획서: [`features/new/17-read-only-improvement-advisor.md`](features/new/17-read-only-improvement-advisor.md)

## 아이디어 — [`backlog/`](backlog/)
구현 전 아이디어 목록. `/plan` 후보.

## 에이전트 — [`agents/`](agents/)
- `agents/redou-spec-loop.md` — 스펙 루프

## 보관 — [`archive/`](archive/)
완료/레거시 문서를 **이력용으로 보존**(현행 아님). → [`archive/README.md`](archive/README.md)

## 워크플로우
루트 [`../CLAUDE.md`](../CLAUDE.md) — 역할 분리(메인 Claude=오케스트레이터, 서브에이전트 planner/developer/fixer/tester/reviewer=실행), 워크플로우, 절대 규칙.

## 빠른 참조 — 상황별 "어디 보지?"
| 상황 | 먼저 볼 곳 |
|------|-----------|
| 앱이 뭐하는지 | `Redou_아이템_개요.md`, 루트 `README.md` |
| PDF 올리면 내부 흐름 | `harness/main/flows.md` |
| 기능 X 완성됐나 | `harness/main/feature-status.md` |
| 진행 중인 일 | `tasks/<work>/README.md` |
| DB 스키마 | `harness/detail/database/schema.md` |
| 포트/외부 서비스 | `harness/main/overview.md` |
| 과거 계획·결정 | `archive/`, `harness/decisions/` |
