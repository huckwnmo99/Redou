// Graph-Enhanced Search — Step on top of Multi-query RAG
// - Extracts query entities via LLM (메인 LLM)
// - Matches → resolve_same_as → graph_traverse_1hop → chunk ids
// - Runs existing multi-query RAG in parallel (폴더 스코프 적용)
// - 2-way RRF (base ⊕ graph) + reranker
//
// 폴더 스코프 정책:
//   그래프 순회는 전체 DB에서 수행 (filter_paper_ids 미전달).
//   벡터/BM25는 filter_paper_ids 적용 (기존 동작).
//   결과: 폴더 내 RAG hit + 폴더 밖이라도 그래프로 도달 가능한 chunk 혼합.

import { extractQueryEntities } from "./entity-extractor.mjs";

// ============================================================
// Entity 매칭 (canonical exact → semantic fallback)
// ============================================================

/**
 * Query-entities → graph의 seed entity ids.
 * (a) canonical_name exact 매칭이 먼저 — 확실한 경우 빠르고 정확
 * (b) 남은 쿼리는 match_entities RPC (embedding 기반, threshold 0.50)
 */
async function matchQueryEntitiesToGraph(queryEntities, queryEmbedding, supabase) {
  if (!queryEntities || queryEntities.length === 0) return [];

  const seedIds = new Set();
  const matchedCanonicals = new Set();

  // (a) exact canonical match
  const canonicals = [...new Set(queryEntities.map((qe) => qe.canonical_name).filter(Boolean))];
  if (canonicals.length > 0) {
    const { data: exactHits } = await supabase
      .from("entities")
      .select("id, canonical_name")
      .in("canonical_name", canonicals)
      .limit(200);
    for (const e of exactHits ?? []) {
      seedIds.add(e.id);
      matchedCanonicals.add(e.canonical_name);
    }
  }

  // (b) 부족한 경우 (매칭된 canonical이 queryEntities의 50% 미만) 시맨틱 fallback
  const needSemantic = queryEntities.filter((qe) => !matchedCanonicals.has(qe.canonical_name));
  if (needSemantic.length > 0 && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
    try {
      const { data: semHits, error } = await supabase.rpc("match_entities", {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 20,
        filter_paper_ids: null,
        filter_types: null,
      });
      if (error) {
        console.warn("[graph-search] match_entities error:", error.message);
      } else {
        for (const e of semHits ?? []) {
          seedIds.add(e.entity_id);
        }
      }
    } catch (err) {
      console.warn("[graph-search] match_entities call failed:", err.message);
    }
  }

  return [...seedIds];
}

// ============================================================
// Graph chunk fetch
// ============================================================

async function fetchGraphChunks(chunkIds, supabase) {
  if (!chunkIds || chunkIds.length === 0) return [];
  const { data, error } = await supabase
    .from("paper_chunks")
    .select("id, paper_id, text, section_id, chunk_order")
    .in("id", chunkIds)
    .limit(100);
  if (error) {
    console.warn("[graph-search] paper_chunks fetch error:", error.message);
    return [];
  }
  return (data ?? []).map((c) => ({
    chunk_id: c.id,
    paper_id: c.paper_id,
    text: c.text,
    section_id: c.section_id,
    chunk_order: c.chunk_order,
  }));
}

// ============================================================
// 2-way RRF (base ⊕ graph)
// ============================================================
//
// 역사적 주석:
//   초기 설계는 vector+bm25+graph 3-way였으나 runMultiQueryRag가 이미
//   내부에서 vector+bm25 RRF+reranker를 완료해 단일 랭킹을 리턴하므로,
//   외부에서 "벡터/BM25를 분리해 다시 가중"할 수 없다. 따라서 여기서는
//   base(이미 RRF+reranked)와 graph의 명시적 2-way RRF만 수행한다.

/**
 * base 랭킹(이미 vector+bm25 RRF+reranker 통과)과 graph 랭킹을 RRF로 병합.
 * mode="qa":    wBase=0.75, wGraph=0.25
 * mode="table": wBase=0.70, wGraph=0.30   (table은 그래프 희소 → 그래프 슬쩍 더 가중)
 * graphChunks empty → wGraph 0, wBase 1 (완전 패스스루).
 */
export function rrfFusionWithGraph(baseChunks, graphChunks, mode = "qa", k = 60) {
  let wBase = mode === "qa" ? 0.75 : 0.70;
  let wGraph = mode === "qa" ? 0.25 : 0.30;
  if (!graphChunks || graphChunks.length === 0) {
    wBase = 1;
    wGraph = 0;
  }
  const MISSING_RANK = 1000;

  const baseRankMap = new Map();
  (baseChunks || []).forEach((c, idx) => baseRankMap.set(c.chunk_id, idx));
  const graphRankMap = new Map();
  (graphChunks || []).forEach((c, idx) => graphRankMap.set(c.chunk_id, idx));

  const chunkObjMap = new Map();
  for (const c of baseChunks || []) chunkObjMap.set(c.chunk_id, c);
  for (const c of graphChunks || []) {
    if (!chunkObjMap.has(c.chunk_id)) chunkObjMap.set(c.chunk_id, c);
  }

  const scored = [];
  for (const [chunkId, chunk] of chunkObjMap) {
    const bRank = baseRankMap.has(chunkId) ? baseRankMap.get(chunkId) : MISSING_RANK;
    const gRank = graphRankMap.has(chunkId) ? graphRankMap.get(chunkId) : MISSING_RANK;
    const rrfScore = wBase * (1 / (k + bRank)) + wGraph * (1 / (k + gRank));
    scored.push({ ...chunk, _rrfScore: rrfScore });
  }
  scored.sort((a, b) => b._rrfScore - a._rrfScore);
  return scored.slice(0, 40);
}

/**
 * Deprecated alias — 기존 import 경로 유지용.
 * 첫 인자(baseOrVector)만 base로 사용, 둘째 인자(_bm25Ignored)는 무시.
 * runMultiQueryRag가 이미 vector+bm25 RRF+reranker된 단일 리스트를 리턴하므로
 * 외부에서 vector/bm25를 분리할 수 없음 → 2-way로 축소.
 */
export function rrfFusionTriple(baseOrVector, _bm25Ignored, graphChunks, mode = "qa", k = 60) {
  return rrfFusionWithGraph(baseOrVector, graphChunks, mode, k);
}

// ============================================================
// Main entry — runGraphEnhancedRag
// ============================================================

/**
 * Graph-Enhanced RAG: 쿼리 엔티티 추출 → 그래프 순회 → base(vector+BM25 RRF+reranked) ⊕ graph 2-way RRF.
 * (graphChunks가 비면 wGraph=0으로 자동 패스스루.)
 *
 * @param {Array<{query: string, intent?: string}>} searchQueries
 * @param {string[]} keywordHints
 * @param {string[]|null} filterPaperIds — 폴더 스코프 (vector/BM25에만 적용)
 * @param {"qa"|"table"} mode
 * @param {object} supabase
 * @param {object} deps — {
 *   generateEmbedding: (text, role) => Promise<number[]>,
 *   runMultiQueryRag: (sq, hints, filterIds, mode) => Promise<{chunks, figures}>,
 *   modelName: string — 쿼리 엔티티 추출에 사용할 LLM 모델
 * }
 * @returns {Promise<{chunks: Array, figures: Array, graph: {queryEntities, seedCount, expandedCount, graphChunkCount}}>}
 */
export async function runGraphEnhancedRag(
  searchQueries,
  keywordHints,
  filterPaperIds,
  mode,
  supabase,
  { generateEmbedding, runMultiQueryRag, modelName }
) {
  const firstQueryText = searchQueries?.[0]?.query || "";

  // Step 1 & 2 (병렬): 기존 vector+BM25 RAG, 그리고 쿼리 엔티티 추출
  const baseRagP = runMultiQueryRag(searchQueries, keywordHints, filterPaperIds, mode);
  const queryEntitiesP = extractQueryEntities(firstQueryText, modelName);

  const [baseRag, queryEntities] = await Promise.all([baseRagP, queryEntitiesP]);

  // 쿼리 엔티티가 0개면 그래프 단계 생략 → 기존 결과 그대로 리턴 (degradation)
  if (!queryEntities || queryEntities.length === 0) {
    console.log(`[graph-search] No query entities extracted → fallback to base RAG`);
    return {
      chunks: baseRag.chunks,
      figures: baseRag.figures,
      graph: {
        queryEntities: [],
        seedCount: 0,
        expandedCount: 0,
        graphChunkCount: 0,
      },
    };
  }
  console.log(`[graph-search] Query entities: ${queryEntities.map((e) => e.canonical_name).join(", ")}`);

  // 쿼리 embedding (match_entities RPC용) — 첫 쿼리만 사용
  let queryEmbedding = null;
  try {
    queryEmbedding = await generateEmbedding(firstQueryText, "query");
  } catch (err) {
    console.warn("[graph-search] query embedding failed:", err.message);
  }

  // Step 3: seed entity 매칭 (전체 DB — 폴더 스코프 무시)
  const seedEntityIds = await matchQueryEntitiesToGraph(queryEntities, queryEmbedding, supabase);
  console.log(`[graph-search] Seed entities: ${seedEntityIds.length}`);

  if (seedEntityIds.length === 0) {
    return {
      chunks: baseRag.chunks,
      figures: baseRag.figures,
      graph: {
        queryEntities,
        seedCount: 0,
        expandedCount: 0,
        graphChunkCount: 0,
      },
    };
  }

  // Step 4: same_as 재귀 확장
  let expandedSeeds = seedEntityIds;
  try {
    const { data: expanded, error } = await supabase.rpc("resolve_same_as", {
      seed_entity_ids: seedEntityIds,
    });
    if (!error && Array.isArray(expanded) && expanded.length > 0) {
      expandedSeeds = expanded;
    }
  } catch (err) {
    console.warn("[graph-search] resolve_same_as failed:", err.message);
  }
  console.log(`[graph-search] After same_as expand: ${expandedSeeds.length}`);

  // Step 5: 1-hop 순회 → chunk ids
  let graphChunkIds = [];
  try {
    const { data: hops, error } = await supabase.rpc("graph_traverse_1hop", {
      seed_entity_ids: expandedSeeds,
      max_results: 50,
    });
    if (error) {
      console.warn("[graph-search] graph_traverse_1hop error:", error.message);
    } else {
      graphChunkIds = [...new Set((hops ?? []).map((h) => h.chunk_id).filter(Boolean))];
    }
  } catch (err) {
    console.warn("[graph-search] graph_traverse_1hop call failed:", err.message);
  }
  console.log(`[graph-search] Graph chunks (1-hop): ${graphChunkIds.length}`);

  // Step 6: 그래프 chunk 실제 텍스트 fetch
  const graphChunks = await fetchGraphChunks(graphChunkIds, supabase);

  // Step 7: 명시적 2-way RRF (base ⊕ graph).
  // baseRag.chunks는 이미 runMultiQueryRag 내부에서 vector+BM25 RRF+reranker를 통과한 단일 랭킹이므로,
  // 외부에서 vector/bm25를 분리해 3-way로 가중할 수 없다. 따라서 정직하게 2-way로 병합한다.
  // graphChunks가 비어 있으면 wBase=1/wGraph=0으로 자동 패스스루.
  const baseRanked = baseRag.chunks || [];
  const fused = rrfFusionWithGraph(baseRanked, graphChunks, mode);

  // Figures는 그래프 영향을 받지 않으므로 baseRag.figures 그대로 사용
  return {
    chunks: fused,
    figures: baseRag.figures || [],
    graph: {
      queryEntities,
      seedCount: seedEntityIds.length,
      expandedCount: expandedSeeds.length,
      graphChunkCount: graphChunks.length,
    },
  };
}
