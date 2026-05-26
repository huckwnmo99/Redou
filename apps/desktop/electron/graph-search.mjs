import { throwIfChatAborted } from "./chat/abort-guards.mjs";
import { canonicalize, extractQueryEntities } from "./entity-extractor.mjs";

const GRAPH_TOP_K = 18;

export function rrfFusionWithGraph(baseChunks = [], graphChunks = [], mode = "qa", k = 60) {
  const baseWeight = mode === "qa" ? 0.78 : 0.9;
  const graphWeight = mode === "qa" ? 0.22 : 0.1;
  const missingRank = 1000;

  const baseRank = new Map();
  baseChunks.forEach((chunk, index) => baseRank.set(chunk.chunk_id, index));

  const graphRank = new Map();
  graphChunks.forEach((chunk, index) => graphRank.set(chunk.chunk_id, index));

  const chunks = new Map();
  for (const chunk of baseChunks) {
    if (chunk?.chunk_id) chunks.set(chunk.chunk_id, { ...chunk });
  }
  for (const chunk of graphChunks) {
    if (!chunk?.chunk_id) continue;
    const existing = chunks.get(chunk.chunk_id) ?? {};
    chunks.set(chunk.chunk_id, { ...chunk, ...existing, _graphEnhanced: true });
  }

  const scored = [];
  for (const [chunkId, chunk] of chunks) {
    const bRank = baseRank.has(chunkId) ? baseRank.get(chunkId) : missingRank;
    const gRank = graphRank.has(chunkId) ? graphRank.get(chunkId) : missingRank;
    scored.push({
      ...chunk,
      _rrfScore: baseWeight * (1 / (k + bRank)) + graphWeight * (1 / (k + gRank)),
    });
  }

  scored.sort((a, b) => b._rrfScore - a._rrfScore);
  return scored.slice(0, GRAPH_TOP_K);
}

async function matchQueryEntitiesToGraph(queryEntities, supabase, generateEmbedding, filterPaperIds, abortSignal) {
  throwIfChatAborted(abortSignal);
  const canonicalNames = [...new Set((queryEntities ?? [])
    .map((entity) => canonicalize(entity.canonical_name ?? entity.name))
    .filter(Boolean))];
  if (canonicalNames.length === 0) return [];

  const { data: exactRows, error: exactError } = await supabase
    .from("entities")
    .select("id, paper_id, entity_type, canonical_name")
    .in("canonical_name", canonicalNames);
  if (exactError) throw new Error(exactError.message);
  throwIfChatAborted(abortSignal);

  let rows = (exactRows ?? []).map((row) => ({
    ...row,
    id: row.id ?? row.entity_id,
  }));
  if (rows.length === 0 && typeof generateEmbedding === "function") {
    const queryText = canonicalNames.join(" ");
    const embedding = await generateEmbedding(queryText, "query");
    throwIfChatAborted(abortSignal);
    const { data: semanticRows, error: semanticError } = await supabase.rpc("match_entities", {
      query_embedding: embedding,
      match_threshold: 0.32,
      match_count: 20,
      filter_paper_ids: filterPaperIds ?? null,
      filter_types: null,
    });
    if (semanticError) throw new Error(semanticError.message);
    rows = (semanticRows ?? []).map((row) => ({
      id: row.entity_id,
      paper_id: row.paper_id,
      entity_type: row.entity_type,
      canonical_name: row.canonical_name,
    }));
  }

  if (Array.isArray(filterPaperIds) && filterPaperIds.length > 0) {
    const allowed = new Set(filterPaperIds);
    rows = rows.filter((row) => allowed.has(row.paper_id));
  }

  return rows;
}

function normalizeResolvedIds(data, fallbackIds) {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.entity_id ?? item?.id ?? null;
      })
      .filter(Boolean);
  }
  return fallbackIds;
}

async function fetchGraphChunks(matchedEntities, supabase, filterPaperIds, abortSignal) {
  throwIfChatAborted(abortSignal);
  const seedEntityIds = [...new Set((matchedEntities ?? []).map((entity) => entity.id).filter(Boolean))];
  if (seedEntityIds.length === 0) return [];

  const { data: resolvedData, error: resolveError } = await supabase.rpc("resolve_same_as", {
    seed_entity_ids: seedEntityIds,
  });
  if (resolveError) throw new Error(resolveError.message);
  throwIfChatAborted(abortSignal);

  const resolvedIds = normalizeResolvedIds(resolvedData, seedEntityIds);
  const { data: traversal, error: traversalError } = await supabase.rpc("graph_traverse_1hop", {
    seed_entity_ids: resolvedIds,
    max_results: 60,
  });
  if (traversalError) throw new Error(traversalError.message);
  throwIfChatAborted(abortSignal);

  let graphRows = traversal ?? [];
  if (Array.isArray(filterPaperIds) && filterPaperIds.length > 0) {
    const allowed = new Set(filterPaperIds);
    graphRows = graphRows.filter((row) => !row.paper_id || allowed.has(row.paper_id));
  }

  const chunkIds = [...new Set(graphRows.map((row) => row.chunk_id).filter(Boolean))];
  if (chunkIds.length === 0) return [];

  const { data: chunks, error: chunkError } = await supabase
    .from("paper_chunks")
    .select("id, paper_id, section_id, page, text")
    .in("id", chunkIds);
  if (chunkError) throw new Error(chunkError.message);
  throwIfChatAborted(abortSignal);

  const relationByChunk = new Map(graphRows.map((row) => [row.chunk_id, row]));
  return (chunks ?? []).map((chunk) => {
    const relation = relationByChunk.get(chunk.id) ?? {};
    return {
      ...chunk,
      chunk_id: chunk.id ?? chunk.chunk_id,
      page_start: chunk.page ?? chunk.page_start ?? null,
      _graphEnhanced: true,
      _graphRelation: relation.relation_type ?? null,
      _graphNeighbor: relation.neighbor_canonical_name ?? null,
    };
  });
}

export async function runGraphEnhancedRag(
  searchQueries,
  keywordHints,
  filterPaperIds,
  mode,
  supabase,
  {
    generateEmbedding,
    runMultiQueryRag,
    modelName,
    abortSignal,
    extractQueryEntitiesFn = extractQueryEntities,
  } = {},
) {
  if (typeof runMultiQueryRag !== "function") {
    throw new TypeError("runGraphEnhancedRag requires runMultiQueryRag");
  }

  const baseResults = await runMultiQueryRag(searchQueries, keywordHints, filterPaperIds, mode, {
    abortSignal,
  });
  throwIfChatAborted(abortSignal);

  if (mode !== "qa") {
    return {
      ...baseResults,
      graph: { enabled: false, queryEntityCount: 0, matchedEntityCount: 0, graphChunkCount: 0 },
    };
  }

  const queryText = (searchQueries ?? []).map((query) => query.query).filter(Boolean).join(" ");
  const queryEntities = await extractQueryEntitiesFn(queryText, modelName, abortSignal);
  throwIfChatAborted(abortSignal);

  const matchedEntities = await matchQueryEntitiesToGraph(
    queryEntities,
    supabase,
    generateEmbedding,
    filterPaperIds,
    abortSignal,
  );
  const graphChunks = await fetchGraphChunks(matchedEntities, supabase, filterPaperIds, abortSignal);

  return {
    ...baseResults,
    chunks: rrfFusionWithGraph(baseResults?.chunks ?? [], graphChunks, mode),
    graph: {
      enabled: true,
      queryEntityCount: queryEntities.length,
      matchedEntityCount: matchedEntities.length,
      graphChunkCount: graphChunks.length,
    },
  };
}
