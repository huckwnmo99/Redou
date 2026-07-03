/**
 * RAG 튜닝 상수 중앙화 (B-M2, 무동작 리팩터).
 *
 * 검색 품질을 좌우하는 매직넘버가 `rag/multi-query-rag.mjs`·`graph-search.mjs`에
 * 산재해 튜닝·감사가 어려웠던 것을 단일 모듈로 수렴한다. 값은 이동 전과 100% 동일하며,
 * 위치만 통합한 것이다 (동작 무변경). 프롬프트 컨텍스트 예산(`chat/table-extraction.mjs`의
 * OCR/MATRIX/TOTAL_BUDGET·FALLBACK_RAG_BUDGET)은 "RAG 검색"이 아니라 "프롬프트 예산"이라
 * 성격이 달라 여기 포함하지 않는다.
 */

/** RRF(Reciprocal Rank Fusion) 순위 상수 k. 소비: rrfFusion / rrfFusionFigures / rrfFusionWithGraph. */
export const RRF_K = 60;

/**
 * 청크 RRF 벡터/BM25 가중 (모드별). 소비: rrfFusion.
 * table = 키워드 정확도 중시(수치 데이터), qa = 의미 유사도 중시(개념적 답변).
 */
export const RRF_WEIGHTS = {
  table: { vector: 0.4, bm25: 0.6 },
  qa: { vector: 0.7, bm25: 0.3 },
};

/** Figure RRF 벡터/BM25 가중. 소비: rrfFusionFigures. */
export const FIGURE_RRF_WEIGHTS = { vector: 0.4, bm25: 0.6 };

/** item_type='table' figure 가산점. 소비: rrfFusionFigures. */
export const TABLE_BOOST = 0.005;

/** RRF 이후 반환 청크 상한(reranker 입력 크기). 소비: rrfFusion. */
export const RRF_RESULT_LIMIT = 40;

/** Reranker(cross-encoder) top-K (모드별). 소비: rerankChunksIfAvailable. */
export const RERANKER_TOPK = { table: 15, qa: 10 };

/** match_chunks RPC 파라미터. 소비: runMultiQueryRag. */
export const MATCH_CHUNK = { threshold: 0.2, count: 60, sectionBoost: 0.08 };

/** match_figures RPC 파라미터. 소비: runMultiQueryRag. */
export const MATCH_FIGURE = { threshold: 0.15, count: 30 };

/** 그래프 RRF 이후 반환 청크 상한. 소비: rrfFusionWithGraph. */
export const GRAPH_TOP_K = 18;

/**
 * 그래프 RRF base/graph 가중 (모드별). 소비: rrfFusionWithGraph.
 * qa 모드만 그래프 fusion을 실사용(그 외 모드는 base만 반환).
 */
export const GRAPH_RRF_WEIGHTS = {
  qa: { base: 0.78, graph: 0.22 },
  table: { base: 0.9, graph: 0.1 },
};
