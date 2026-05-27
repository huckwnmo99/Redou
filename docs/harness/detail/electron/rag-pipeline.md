# RAG 파이프라인
> 하네스 버전: v1.1 | 최종 갱신: 2026-05-27

## 개요
채팅(테이블 생성/Q&A) 시 관련 논문 데이터를 검색하는 Hybrid Search + RRF Fusion + Reranker 파이프라인. 검색 결과를 LLM 컨텍스트로 조립한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/main.mjs` | RAG 함수들 + Stage 3d NULL Recovery | 채팅 파이프라인 구간 |
| `apps/desktop/electron/reranker-worker.mjs` | Cross-encoder reranker | ~147 |
| `apps/desktop/electron/embedding-worker.mjs` | 쿼리 임베딩 생성 | ~143 |

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
| `runPaperScopedRecoverySearch(queries, paperId, signal)` | main.mjs | Stage 3d 단일 논문 재검색 | → {chunks, figures} |
| `runAgenticNullRecovery(args)` | main.mjs | Stage 3d NULL 복구 오케스트레이션 | → {tableJson, nullSummary, agenticRecovery} |

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
      ├─ [Table 모드 Stage 3d] Agentic NULL Recovery
      │   ├─ mergeExtractionResults()의 nullSummary.details를 논문별로 그룹화
      │   ├─ buildRecoveryQueries(): LLM 없이 컬럼명/단위/keyword_hints 기반 쿼리 생성
      │   ├─ runPaperScopedRecoverySearch(): 단일 paperId로 runMultiQueryRag() 재사용
      │   ├─ Gate 1: 새 chunk_id/figure_id가 없으면 LLM 재추출 생략
      │   └─ Gate 2: confidence="high" 셀만 기존 N/A에 적용
      │
      └─ [Q&A 모드] assembleRagContext(chunks, figures, refMap, [])
          └─ 텍스트 위주 (파싱 매트릭스 없음)
```

## Q&A 엔티티 그래프 opt-in (fix 16)

`handleQaPipeline`(main.mjs)은 RAG 검색 직전에 `getEntityGraphEnabled(ownerId)`로 분기한다. 기본값 OFF.

| 토글 | RAG 경로 | 비고 |
|------|----------|------|
| OFF (기본) | `runMultiQueryRag(queries, hints, filterIds, "qa", {abortSignal})` 직접 호출 | plain RAG. `extractQueryEntities` LLM 호출/`graphing` 상태 없음 |
| ON | `runGraphEnhancedRag(...)` | 내부에서 `runMultiQueryRag`로 baseResults 생성 후 entity graph chunk fusion. `graphing` 상태 emit |

- 두 경로의 반환은 모두 `{chunks, figures}`로 호환된다(graph 경로는 `graph` 메타 필드 추가, QA 하류 미사용).
- 자동 entity 추출 큐잉도 동일 플래그로 게이트된다 — `enqueueEntityExtractionIfNeeded` 진입부에서 `getEntityGraphEnabled(userId)`가 false면 즉시 return(import/embedding 완료 호출처 2곳 모두 커버). 수동 백필(`enqueueEntityBackfill`)은 이 게이트를 거치지 않아 토글과 무관하게 동작.

### 관련 헬퍼/IPC

| 항목 | 위치 | 역할 |
|------|------|------|
| `getEntityGraphEnabled(userId)` | main.mjs | `user_workspace_preferences.entity_graph_enabled` 읽기. userId 없거나 미설정/null → false |
| `ENTITY_GET_GRAPH_ENABLED` IPC | main.mjs / ipc-channels.mjs / preload.mjs | `{enabled}` 반환 |
| `ENTITY_SET_GRAPH_ENABLED` IPC | main.mjs / ipc-channels.mjs / preload.mjs | `{enabled}` upsert |
| 마이그레이션 | `supabase/migrations/20260527073618_add_entity_graph_enabled.sql` | `entity_graph_enabled boolean not null default false` 컬럼 추가 |

## RRF 가중치

| 모드 | BM25 가중 | Vector 가중 | 비고 |
|------|-----------|------------|------|
| table | 0.6 | 0.4 | 키워드 정확도 중시 (수치 데이터) |
| qa | 0.3 | 0.7 | 의미 유사도 중시 (개념적 답변) |

## 의존성
- 사용: Supabase RPC (match_chunks, match_chunks_bm25, match_figures, match_figures_bm25), embedding-worker (쿼리 임베딩), reranker-worker
- 사용됨: 채팅 파이프라인 (Table + Q&A)

## 현재 상태
- 구현 완료: Hybrid Search, RRF, Reranker, 컨텍스트 조립, SRAG 병합, Stage 3d Agentic NULL Recovery
- SRAG nullSummary 데이터는 Stage 3d 재검색과 `agenticRecovery` metadata 기록에 사용됨

### 알려진 이슈

1. **BM25 검색 0건** — Hybrid Search에서 `0 BM25 chunks` 반환. 벡터 검색만 동작 중. `paper_chunks.fts` tsvector가 매칭되지 않는 것으로 추정. `match_chunks_bm25` RPC 및 tsvector 인덱스 점검 필요.
