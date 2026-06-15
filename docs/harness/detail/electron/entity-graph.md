# 엔티티 그래프 (Entity Graph)

> 하네스 버전: v1.12 | 최종 갱신: 2026-06-15

## 개요

논문에서 **엔티티(substance/method/condition/metric/phenomenon/concept)와 관계**를 추출해 지식 그래프를 만들고, QA RAG를 그래프로 보강하는 **opt-in 부가 기능**. 기본 OFF(`user_workspace_preferences.entity_graph_enabled`). 실패해도 core 처리("Complete")에 영향 없음(graceful degrade). 관련 기능 매트릭스: `../../main/feature-status.md`.

## 모듈

### `entity-extractor.mjs` — 추출·영속화
- `CURRENT_ENTITY_EXTRACTION_VERSION = 2` (추출 로직 변경 시 증가; `papers.entity_extraction_version`와 비교해 재추출 판단).
- `assemblePaperContextForEntities(paperId, supabase)` — 청크/요약에서 추출용 컨텍스트 조립.
- `extractEntitiesFromPaper(paperContext, paperTitle, modelName, abortSignal)` — Ollama JSON 호출(`callOllamaJson`, 기본 timeout 180초)로 엔티티+관계 추출 → `normalizeExtraction`으로 타입/신뢰도 정규화.
- `extractQueryEntities(query, modelName, abortSignal)` — 사용자 질의에서 엔티티 추출(QA 시 그래프 진입점).
- `buildChunkIndexForPaper` / `resolveChunkId` — 추출 결과를 실제 `paper_chunks.id`에 매핑(`source_hint`→chunk).
- `persistEntities(paperId, chunkIndexMap, extracted, supabase, generateEmbeddingFn)` — `entities`/`entity_relations` upsert + 엔티티 임베딩(2048) 생성·저장.
- 정규화 헬퍼: `canonicalize`, `normalizeEntityType`, `normalizeRelationType`, `normalizeConfidence`, `normalizeConfidenceTag`, `parseJsonObject`.

### `graph-search.mjs` — 그래프 보강 검색
- `runGraphEnhancedRag(...)` — 그래프 강화 RAG 진입점. base RAG 결과 + 그래프 결과를 융합.
- `matchQueryEntitiesToGraph(queryEntities, supabase, generateEmbedding, filterPaperIds, abortSignal)` — 질의 엔티티를 그래프 엔티티에 매칭(`match_entities` + `resolve_same_as`).
- `fetchGraphChunks(matchedEntities, ...)` — 매칭 엔티티에서 `graph_traverse_1hop`으로 1-hop 이웃 + evidence 청크 수집.
- `rrfFusionWithGraph(baseChunks, graphChunks, mode="qa", k=60)` — base/graph 청크를 RRF로 융합.

## 데이터 (마이그레이션 `20260423010000_add_entity_graph.sql`)

- **`entities`** — `paper_id`(FK), `chunk_id`(FK nullable), `entity_type`(substance/method/condition/metric/phenomenon/concept), `raw_name`, `canonical_name`, `value`, `unit`, `confidence`(high/medium/low), `confidence_tag`(EXTRACTED/INFERRED/AMBIGUOUS), `source_hint`, `embedding`(vector 2048). 인덱스: paper/canonical/type/(paper,canonical).
- **`entity_relations`** — `source_entity_id`/`target_entity_id`(FK), `relation_type`(affects/correlates_with/measures/uses/compared_to/outperforms/produces/same_as), `direction`(positive/negative/neutral/bidirectional), `source_paper_id`(FK), `evidence_chunk_id`(FK nullable), `confidence`/`confidence_tag`. unique(source,target,type,paper).
- 컬럼 추가: `papers.entity_extraction_version`(int, default 0), `user_workspace_preferences.entity_extraction_model`(text), `entity_graph_enabled`(bool, default false — 마이그레이션 `20260527073618`).
- enum: `job_type`에 `extract_entities` 추가.
- RLS: 두 테이블 모두 papers 소유권 기반 정책.
- RPC(3): `match_entities`(엔티티 임베딩 벡터검색), `resolve_same_as`(same_as 재귀 확장), `graph_traverse_1hop`(1-hop 이웃+evidence 청크). 상세: `../database/rpc.md`.

## 동작 흐름

1. **추출(ON 또는 수동 백필)**: import→embedding 완료 후 `extract_entities` job 비차단 큐잉(`enqueueEntityExtractionIfNeeded`, OFF면 스킵). **수동 백필 버튼은 토글과 무관하게 항상 동작.** job 실행 → assemble→extract(LLM JSON)→persist(+임베딩).
2. **QA(ON)**: `handleQaPipeline`이 `runGraphEnhancedRag`(그래프) vs plain `runMultiQueryRag` 분기. 질의 엔티티 추출→그래프 매칭→1-hop 수집→base와 RRF 융합→컨텍스트.

## 특징·주의

- **opt-in 기본 OFF 근거**: `extract_entities`가 편당 ~104초(처리의 ~60%) 소요 + QA 그래프 가치 미검증(fix 16).
- **graceful degrade**: `getEntityGraphEnabled` DB 조회 에러 시 throw 대신 OFF로 폴백(fix 17, `main.mjs`). `entity_graph_enabled` 컬럼 미적용 환경에서도 QA가 깨지지 않음.
- **부가 기능**: 실패해도 core(import+embedding) "Complete" 판정에서 제외(`paperSignals.ts`).
- 설정: GET/SET IPC + Settings 토글(`../frontend/stores-queries.md`, `../../main/feature-status.md`).
