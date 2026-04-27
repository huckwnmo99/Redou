# Harness Version

## v1.4 — 2026-04-23
- 엔티티 그래프 critical 이슈 2건 수정 (docs/features/fix/08-entity-graph-critical-issues.md)
  - `persistEntities`: `evidence_chunk_id`를 source_hint → source entity chunk_id → target entity chunk_id 폴백 체인으로 채움. `CURRENT_ENTITY_EXTRACTION_VERSION` 1→2 범프 (자동 재추출 트리거). 버전 범프로 인한 자동 재추출은 신규/재임베딩 잡이 끝날 때만 동작. 이미 임베딩이 끝난 기존 논문은 Settings의 수동 백필 버튼으로만 재처리됨.
  - `graph-search.mjs`: 3-way RRF 중복 입력 문제 해소를 위해 `rrfFusionWithGraph` 2-way 함수 신규 export. `rrfFusionTriple`은 deprecated alias로 하위호환. 가중치: qa wBase=0.75/wGraph=0.25, table 0.70/0.30.
- feature-status.md, flows.md, detail/electron/rag-pipeline.md 갱신 (3-way → 2-way 기술 정확화)

## v1.3 — 2026-04-22
- 온톨로지 기반 엔티티 추출 + Graph-Enhanced Search 추가
- 신규 테이블: `entities`, `entity_relations` (+ 4개 RPC: match_entities, resolve_same_as, graph_traverse_1hop, god_nodes)
- 신규 모듈: `entity-extractor.mjs`, `graph-search.mjs`
- `papers.entity_extraction_version`, `user_workspace_preferences.entity_extraction_model` 컬럼 추가
- IPC 4종 추가: `entity:backfill`, `entity:backfill-status`, `entity:get-model`, `entity:set-model`
- Q&A 파이프라인이 `runMultiQueryRag` → `runGraphEnhancedRag`로 교체 (vector+BM25+graph 3-way RRF, graceful 2-way fallback)
- Settings UI: 엔티티 추출 모델 선택, 수동 백필 버튼, 진행 상태 표시
- 임베딩 잡 성공 시 자동으로 `extract_entities` 잡 큐잉
- feature-status.md, detail/electron/rag-pipeline.md, detail/electron/llm.md, detail/database/schema.md, detail/database/rpc.md 갱신

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
