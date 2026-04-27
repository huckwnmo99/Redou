# RAG 파이프라인
> 하네스 버전: v1.3 | 최종 갱신: 2026-04-22

## 개요
채팅(테이블 생성/Q&A) 시 관련 논문 데이터를 검색하는 Hybrid Search + RRF Fusion + Reranker 파이프라인. 검색 결과를 LLM 컨텍스트로 조립한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/main.mjs` | RAG 함수들 (2728~3225) | ~500줄 구간 |
| `apps/desktop/electron/reranker-worker.mjs` | Cross-encoder reranker | ~147 |
| `apps/desktop/electron/embedding-worker.mjs` | 쿼리 임베딩 생성 | ~143 |
| `apps/desktop/electron/graph-search.mjs` | Graph-Enhanced Search (QA 파이프라인 사용) | ~290 |

## 주요 함수

| 함수 | 위치 | 역할 | 입출력 |
|------|------|------|--------|
| `runMultiQueryRag(queries, hints, filterIds, mode)` | main.mjs:2823 | 멀티쿼리 RAG 진입점 | → {chunks, figures} |
| `rrfFusion(vectorChunks, bm25Chunks, mode, k)` | main.mjs:2728 | 청크 RRF 병합 | table: BM25 60%+Vector 40%, qa: BM25 30%+Vector 70% |
| `rrfFusionFigures(vectorFigs, bm25Figs, k)` | main.mjs:2764 | Figure RRF 병합 | BM25 60%+Vector 40%, TABLE_BOOST=0.005 |
| `rerankChunksIfAvailable(query, chunks, mode)` | main.mjs:2804 | Reranker 적용 | table: top-15, qa: top-10 |
| `assembleRagContext(chunks, figures, refMap, matrices)` | main.mjs:2959 | 전체 RAG 컨텍스트 조립 | → string (3섹션: 파싱TSV + OCR HTML + 텍스트) |
| `assemblePerPaperContext({chunks, figures, tables, title})` | main.mjs:3027 | 논문별 RAG 컨텍스트 (SRAG용) | 예산: 30K chars/논문 |
| `mergeExtractionResults(results, spec, meta, refMap)` | main.mjs:3110 | SRAG 병합 (코드 전용) | → {tableJson, nullSummary} |

## 데이터 흐름

```
searchQueries[] (Orchestrator 출력)
  │
  ├─ 각 쿼리마다:
  │   ├─ generateEmbedding(query, "query") → 2048-dim 벡터
  │   ├─ 병렬 RPC 호출:
  │   │   ├─ match_chunks(vector, threshold=0.2, count=60)
  │   │   ├─ match_chunks_bm25(text + keywordHints, count=60)
  │   │   ├─ match_figures(vector, threshold=0.15, count=30)
  │   │   └�� match_figures_bm25(text, count=30) [table 모드만]
  │   └─ 결과 누적 (Map, 최고 유사도/순위 유지)
  │
  ├─ RRF Fusion
  │   ├─ rrfFusion: 청크 40개 선택 (k=60, 모드별 가중)
  │   └─ rrfFusionFigures: 전체 반환 + TABLE_BOOST
  │
  ├─ Reranker (cross-encoder)
  │   ├─ bge-reranker-base (INT8 ONNX, ~350MB)
  │   ├─ 배치 크기 8, (query, passage) 쌍 스코어링
  │   └─ top-K 선택 (table:15, qa:10)
  │
  └─ 컨텍스트 조립
      ├─ [Table 모드] assembleRagContext → 전체 병합 컨텍스트
      │   ├─ Section 1: 파싱된 테이블 TSV (35K chars 예산)
      │   ├─ Section 2: OCR HTML 테이블 (70K chars 예산)
      │   └─ Section 3: 텍스트 청크 (나머지 예산)
      │
      ├─ [Table 모드 SRAG] assemblePerPaperContext × N논문
      │   └─ 논문당 30K chars (TSV 12K + OCR 14K + 텍스트 나머지)
      │
      └─ [Q&A 모드] assembleRagContext(chunks, figures, refMap, [])
          └─ 텍스트 위주 (파싱 매트릭스 없음)
```

## RRF 가중치

| 모드 | BM25 가중 | Vector 가중 | 비고 |
|------|-----------|------------|------|
| table | 0.6 | 0.4 | 키워드 정확도 중시 (수치 데이터) |
| qa | 0.3 | 0.7 | 의미 유사도 중시 (개념적 답변) |

## Graph-Enhanced Search (Q&A 전용)

**파일:** `apps/desktop/electron/graph-search.mjs`
**진입점:** `runGraphEnhancedRag(searchQueries, keywordHints, filterPaperIds, mode, supabase, deps)`
**적용 범위:** Q&A 파이프라인(`handleQaPipeline` @ main.mjs:3530). 테이블 파이프라인은 기존 `runMultiQueryRag` 유지.

### 처리 단계

```
Step 1: 기존 vector+BM25 RAG(runMultiQueryRag) + extractQueryEntities(첫 쿼리, 메인 LLM) 병렬 실행
Step 2: matchQueryEntitiesToGraph
   (a) entities.canonical_name IN (...) — exact 매칭
   (b) 부족하면 match_entities RPC (query_embedding, threshold=0.50) — 시맨틱 fallback
Step 3: resolve_same_as RPC — same_as 관계 재귀 확장 (동의어 union)
Step 4: graph_traverse_1hop RPC — 이웃 엔티티의 evidence chunk ids 수집 (max 50)
   * filter_paper_ids 미전달 → 폴더 스코프 넘어 전체 그래프 순회
Step 5: fetchGraphChunks — paper_chunks에서 실제 텍스트 로드
Step 6: rrfFusionWithGraph — 2-way RRF (base ⊕ graph)
   mode="qa":    wBase=0.75, wGraph=0.25
   mode="table": wBase=0.70, wGraph=0.30
   graphChunks 0개 → wBase=1/wGraph=0 (완전 패스스루)
   * baseRag.chunks는 이미 runMultiQueryRag 내부에서 vector+BM25 RRF+reranker를 통과한 단일 랭킹이라,
     외부에서 vector/bm25를 분리해 3-way로 가중하는 것이 구조적으로 불가능. 따라서 2-way로 축소.
   * `rrfFusionTriple`은 deprecated alias로 남아 2-way로 위임 (하위호환).
Step 7: reranker는 base 단계(runMultiQueryRag 내부)에서만 수행. 그래프 합류 후 재랭크 없음.
```

### 폴더 스코프 정책
- `runVectorSearch`/`runBm25Search`: `filter_paper_ids` 전달 (폴더 내 검색)
- `matchQueryEntitiesToGraph`/`graph_traverse_1hop`: `filter_paper_ids` 미전달 (전체 그래프)
- 결과: 폴더 내 벡터/BM25 hit + 폴더 밖이라도 그래프로 도달 가능한 chunk 혼합

### Graceful degradation
- 쿼리 엔티티 0개 → base RAG 그대로 반환
- seed 엔티티 0개 → base RAG 그대로 반환
- graph chunk 0개 → `rrfFusionWithGraph`가 wBase=1/wGraph=0으로 완전 패스스루

### 반환값 확장
`runGraphEnhancedRag`은 기존 `{chunks, figures}` 외에 `graph: {queryEntities, seedCount, expandedCount, graphChunkCount}`를 추가로 반환 (로깅/디버깅용).

## 의존성
- 사용: Supabase RPC (match_chunks, match_chunks_bm25, match_figures, match_figures_bm25, match_entities, resolve_same_as, graph_traverse_1hop), embedding-worker (쿼리 임베딩), reranker-worker, entity-extractor.mjs (extractQueryEntities)
- 사용됨: 채팅 파이프라인 (Table: runMultiQueryRag, Q&A: runGraphEnhancedRag)

## 현재 상태
- 구현 완료: Hybrid Search, RRF, Reranker, 컨텍스트 조립, SRAG 병합
- SRAG nullSummary 데이터 수집됨 (Agentic 재검색 Step 4 준비)

### 알려진 이슈

1. **BM25 검색 0건** — Hybrid Search에서 `0 BM25 chunks` 반환. 벡터 검색만 동작 중. `paper_chunks.fts` tsvector가 매칭되지 않는 것으로 추정. `match_chunks_bm25` RPC 및 tsvector 인덱스 점검 필요.
