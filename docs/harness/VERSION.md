# Harness Version

## v1.4 — 2026-05-27
- Entity Graph opt-in 전환 (fix 16). `user_workspace_preferences.entity_graph_enabled` boolean(기본 false) 플래그로 자동 큐잉/QA graph 경로를 게이트
- 마이그레이션 `20260527073618_add_entity_graph_enabled.sql` 추가
- main.mjs: `getEntityGraphEnabled(userId)` 헬퍼, `enqueueEntityExtractionIfNeeded` 진입부 게이트, `handleQaPipeline` graph/plain 분기, `ENTITY_GET_GRAPH_ENABLED`/`ENTITY_SET_GRAPH_ENABLED` IPC 2개
- ipc-channels.mjs/preload.mjs: 채널 2개 + 브리지 2개. desktop.ts: `EntityGraphEnabledInfo` 타입 + entity 메서드 2개
- chatQueries.ts: `entityKeys.graphEnabled` + `useEntityGraphEnabled`/`useSetEntityGraphEnabled`. SettingsView.tsx: Entity Graph 패널에 opt-in 토글(수동 백필은 독립 유지, D1=나)
- feature-status.md: 엔티티 추출 행을 "✅ 구현됨 (opt-in, 기본 OFF)"로 갱신. flows.md: 임포트 흐름 opt-in 조건 + Q&A graph/plain 분기 정정. rag-pipeline.md: Q&A opt-in 섹션 추가. stores-queries.md: 엔티티/모델 훅 표 추가
- #15 미커밋분(paperSignals import+embedding 합성, ProcessingView 라벨, paperSignals.test.ts) 유지 — opt-in과 독립적으로 옳은 버그 수정. opt-in 전환으로 자동 entity job이 사라져 #15가 잡던 불일치는 신규 import에서 미발생(맥락만 하네스에 보정)

## v1.3 — 2026-05-27
- 라이브러리 "Complete" 상태와 실제 처리 상태 불일치 수정 (fix 15, 옵션 A1)
- `paperSignals.ts`가 core 파이프라인(import_pdf + generate_embeddings) 합성으로 카드 상태 계산 — 둘 다 succeeded일 때만 "Complete". entity는 제외(graceful-degradation)
- flows.md: PDF 임포트 흐름에 embedding 후 `extract_entities` 큐잉/처리 단계 추가
- feature-status.md: 엔티티 그래프 ✅ 구현됨 처리 + 라이브러리 카드 상태/엔티티 추출 항목 추가
- stores-queries.md: 라이브러리 카드 처리 상태 계산 섹션 추가

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
