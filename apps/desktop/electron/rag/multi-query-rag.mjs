import { createChatAbortError, throwIfChatAborted } from "../chat/abort-guards.mjs";
import { generateEmbedding as defaultGenerateEmbedding } from "../embedding-worker.mjs";
import {
  isRerankerAvailable as defaultIsRerankerAvailable,
  rerankChunks as defaultRerankChunks,
} from "../reranker-worker.mjs";
import {
  FIGURE_RRF_WEIGHTS,
  MATCH_CHUNK,
  MATCH_FIGURE,
  RERANKER_TOPK,
  RRF_K,
  RRF_RESULT_LIMIT,
  RRF_WEIGHTS,
  TABLE_BOOST,
} from "./config.mjs";

export function rrfFusion(vectorChunks, bm25Chunks, mode = "table", k = RRF_K) {
  const wBM25 = mode === "qa" ? RRF_WEIGHTS.qa.bm25 : RRF_WEIGHTS.table.bm25;
  const wVector = mode === "qa" ? RRF_WEIGHTS.qa.vector : RRF_WEIGHTS.table.vector;
  const MISSING_RANK = 1000;

  const vectorRankMap = new Map();
  vectorChunks.forEach((chunk, index) => vectorRankMap.set(chunk.chunk_id, index));

  const bm25RankMap = new Map();
  bm25Chunks.forEach((chunk, index) => bm25RankMap.set(chunk.chunk_id, index));

  const chunkObjMap = new Map();
  for (const chunk of vectorChunks) chunkObjMap.set(chunk.chunk_id, chunk);
  for (const chunk of bm25Chunks) {
    if (!chunkObjMap.has(chunk.chunk_id)) chunkObjMap.set(chunk.chunk_id, chunk);
  }

  const scored = [];
  for (const [chunkId, chunk] of chunkObjMap) {
    const vectorRank = vectorRankMap.has(chunkId) ? vectorRankMap.get(chunkId) : MISSING_RANK;
    const bm25Rank = bm25RankMap.has(chunkId) ? bm25RankMap.get(chunkId) : MISSING_RANK;
    const rrfScore = wVector * (1 / (k + vectorRank)) + wBM25 * (1 / (k + bm25Rank));
    scored.push({ ...chunk, _rrfScore: rrfScore });
  }

  scored.sort((a, b) => b._rrfScore - a._rrfScore);
  return scored.slice(0, RRF_RESULT_LIMIT);
}

export function rrfFusionFigures(vectorFigures, bm25Figures, k = RRF_K) {
  const wBM25 = FIGURE_RRF_WEIGHTS.bm25;
  const wVector = FIGURE_RRF_WEIGHTS.vector;
  const MISSING_RANK = 1000;

  const vectorRankMap = new Map();
  vectorFigures.forEach((figure, index) => vectorRankMap.set(figure.figure_id, index));

  const bm25RankMap = new Map();
  bm25Figures.forEach((figure, index) => bm25RankMap.set(figure.figure_id, index));

  const figureObjMap = new Map();
  for (const figure of vectorFigures) figureObjMap.set(figure.figure_id, figure);
  for (const figure of bm25Figures) {
    if (!figureObjMap.has(figure.figure_id)) figureObjMap.set(figure.figure_id, figure);
  }

  const scored = [];
  for (const [figureId, figure] of figureObjMap) {
    const vectorRank = vectorRankMap.has(figureId) ? vectorRankMap.get(figureId) : MISSING_RANK;
    const bm25Rank = bm25RankMap.has(figureId) ? bm25RankMap.get(figureId) : MISSING_RANK;
    let rrfScore = wVector * (1 / (k + vectorRank)) + wBM25 * (1 / (k + bm25Rank));
    if (figure.item_type === "table") rrfScore += TABLE_BOOST;
    scored.push({ ...figure, _rrfScore: rrfScore });
  }

  scored.sort((a, b) => b._rrfScore - a._rrfScore);
  return scored;
}

export function createMultiQueryRag({
  supabase,
  generateEmbedding = defaultGenerateEmbedding,
  rerankChunks = defaultRerankChunks,
  isRerankerAvailable = defaultIsRerankerAvailable,
  logger = console,
} = {}) {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new TypeError("createMultiQueryRag requires a Supabase client with rpc()");
  }

  async function rerankChunksIfAvailable(query, chunks, mode, abortSignal) {
    const topK = RERANKER_TOPK[mode] ?? 15;
    throwIfChatAborted(abortSignal);
    try {
      const available = await isRerankerAvailable();
      throwIfChatAborted(abortSignal);
      if (!available) {
        logger.log("[reranker] Not available, using RRF order");
        return chunks.slice(0, topK);
      }
      const start = Date.now();
      const result = await rerankChunks(query, chunks, topK);
      throwIfChatAborted(abortSignal);
      logger.log(`[reranker] Reranked ${chunks.length} → ${result.length} chunks in ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      logger.warn("[reranker] Failed, falling back to RRF order:", err.message);
      return chunks.slice(0, topK);
    }
  }

  async function runMultiQueryRag(searchQueries, _keywordHints, filterPaperIds, mode = "table", options = {}) {
    const abortSignal = options?.abortSignal;
    const vectorChunkMap = new Map();
    const bm25ChunkMap = new Map();
    const vectorFigureMap = new Map();
    const bm25FigureMap = new Map();

    throwIfChatAborted(abortSignal);

    for (const searchQuery of searchQueries ?? []) {
      const emb = await generateEmbedding(searchQuery.query, "query");
      throwIfChatAborted(abortSignal);

      const bm25QueryText = searchQuery.query;
      const promises = [
        supabase.rpc("match_chunks", {
          query_embedding: emb,
          match_threshold: MATCH_CHUNK.threshold,
          match_count: MATCH_CHUNK.count,
          filter_paper_ids: filterPaperIds,
          boost_section_names: null,
          section_boost: MATCH_CHUNK.sectionBoost,
        }),
        supabase.rpc("match_chunks_bm25", {
          query_text: bm25QueryText,
          match_count: MATCH_CHUNK.count,
          filter_paper_ids: filterPaperIds,
        }),
        supabase.rpc("match_figures", {
          query_embedding: emb,
          match_threshold: MATCH_FIGURE.threshold,
          match_count: MATCH_FIGURE.count,
          filter_item_types: ["table", "figure", "equation"],
          filter_paper_ids: filterPaperIds,
        }),
      ];

      if (mode === "table") {
        promises.push(
          supabase.rpc("match_figures_bm25", {
            query_text: bm25QueryText,
            match_count: MATCH_FIGURE.count,
            filter_item_types: ["table"],
            filter_paper_ids: filterPaperIds,
          }),
        );
      }

      const results = await Promise.all(promises);
      throwIfChatAborted(abortSignal);
      const [vectorResult, bm25Result, figureResult] = results;
      const figureBm25Result = mode === "table" ? results[3] : null;

      if (vectorResult.error) logger.error("[Chat/RAG] match_chunks error:", vectorResult.error.message);
      for (const chunk of vectorResult.data ?? []) {
        const existing = vectorChunkMap.get(chunk.chunk_id);
        if (!existing || chunk.similarity > existing.similarity) {
          vectorChunkMap.set(chunk.chunk_id, chunk);
        }
      }

      if (bm25Result.error) logger.error("[Chat/RAG] match_chunks_bm25 error:", bm25Result.error.message);
      for (const chunk of bm25Result.data ?? []) {
        const existing = bm25ChunkMap.get(chunk.chunk_id);
        if (!existing || chunk.bm25_rank > existing.bm25_rank) {
          bm25ChunkMap.set(chunk.chunk_id, chunk);
        }
      }

      if (figureResult.error) logger.error("[Chat/RAG] match_figures error:", figureResult.error.message);
      for (const figure of figureResult.data ?? []) {
        const existing = vectorFigureMap.get(figure.figure_id);
        if (!existing || figure.similarity > existing.similarity) {
          vectorFigureMap.set(figure.figure_id, figure);
        }
      }

      if (figureBm25Result) {
        if (figureBm25Result.error) logger.error("[Chat/RAG] match_figures_bm25 error:", figureBm25Result.error.message);
        for (const figure of figureBm25Result.data ?? []) {
          const existing = bm25FigureMap.get(figure.figure_id);
          if (!existing || figure.bm25_rank > existing.bm25_rank) {
            bm25FigureMap.set(figure.figure_id, figure);
          }
        }
      }
    }

    const allVectorChunks = [...vectorChunkMap.values()];
    const allBm25Chunks = [...bm25ChunkMap.values()];
    const allVectorFigures = [...vectorFigureMap.values()];
    const allBm25Figures = [...bm25FigureMap.values()];

    const rankedChunks = rrfFusion(allVectorChunks, allBm25Chunks, mode);

    let allFigures;
    if (mode === "table" && allBm25Figures.length > 0) {
      allFigures = rrfFusionFigures(allVectorFigures, allBm25Figures);
      logger.log(`[Chat/RAG] Figure RRF: ${allVectorFigures.length} vector + ${allBm25Figures.length} BM25 → ${allFigures.length} fused`);
    } else {
      allFigures = allVectorFigures;
    }

    const originalQuery = (searchQueries ?? []).map((searchQuery) => searchQuery.query).join(" ");
    const rerankedChunks = await rerankChunksIfAvailable(originalQuery, rankedChunks, mode, abortSignal);

    logger.log(`[Chat/RAG] ${(searchQueries ?? []).length} queries → ${allVectorChunks.length} vector + ${allBm25Chunks.length} BM25 chunks, ${allFigures.length} figures → RRF ${rankedChunks.length} → reranked ${rerankedChunks.length} (mode=${mode})`);

    return { chunks: rerankedChunks, figures: allFigures };
  }

  async function runPaperScopedRecoverySearch(queries, paperId, abortSignal) {
    if (abortSignal?.aborted) {
      throw createChatAbortError("Agentic NULL recovery aborted");
    }
    if (!paperId || !Array.isArray(queries) || queries.length === 0) {
      return { chunks: [], figures: [] };
    }
    const result = await runMultiQueryRag(queries, [], [paperId], "table", { abortSignal });
    if (abortSignal?.aborted) {
      throw createChatAbortError("Agentic NULL recovery aborted");
    }
    return {
      chunks: result?.chunks ?? [],
      figures: result?.figures ?? [],
    };
  }

  return {
    runMultiQueryRag,
    runPaperScopedRecoverySearch,
  };
}
