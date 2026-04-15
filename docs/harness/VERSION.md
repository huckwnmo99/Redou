# Harness Version

## v1.2 — 2026-04-10
- SRAG 통합 이슈 3건 수정 (Orchestrator clarify 과다 / 한글 인코딩 깨짐 / Guardian 검증 실패)
- llm.md 알려진 이슈 2~4번 수정 완료 처리

## v1.1 — 2026-04-10
- BM25 검색 0건 반환 버그 수정: `websearch_to_tsquery` → `build_or_tsquery` (OR 기반)
- database/rpc.md BM25 설정 섹션 갱신
- feature-status.md BM25 버그 상태 완료 처리

## v1.0 — 2026-04-10
- 초기 하네스 구축
- main/ 3개, detail/ 12개 파일 작성
- 코드베이스 실사 기반 (추측 없음)

## 변경 규칙
- major (v2.0): 하네스 구조 변경 (파일 추가/삭제/재편)
- minor (v1.1): 기존 파일 내용 갱신
- 모든 기능 추가/수정 커밋 ��� 관련 하네스 파일도 함께 갱신
