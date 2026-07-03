import { throwIfChatAborted } from "./abort-guards.mjs";
import { extractKeyTerms } from "./extraction-utils.mjs";
import { assembleRagContext } from "./table-extraction.mjs";
import {
  buildEvidenceLocationsByPaper,
  serializeEvidenceLocations,
} from "./source-evidence.mjs";

const NO_DATA_MESSAGE =
  "관련 데이터를 찾지 못했습니다. 요청을 더 구체적으로 해주시거나, 해당 주제의 논문이 라이브러리에 있는지 확인해주세요.";
const SEARCHING_MESSAGE = "관련 논문 데이터 검색 중...";
const GRAPHING_MESSAGE = "Expanding entity graph context...";
const ANSWERING_MESSAGE = "답변 생성 중...";

function defaultUnwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
}

function defaultIntersectPaperIds(basePaperIds, scopedPaperIds) {
  const allowed = new Set(basePaperIds);
  return scopedPaperIds.filter((paperId) => allowed.has(paperId));
}

/**
 * Reorder paperMetadata into a deterministic ref-number order (slice 05, B-D3).
 *
 * The refNo shown as `[N]` was previously bound to whatever order paperIds came
 * out of `new Set([...chunks.map, ...figures.map])` — i.e. chunk arrival order,
 * which is stable within one run but not across runs. This sorts papers by their
 * strongest RAG evidence so `[N]` is reproducible for the same ragResults:
 *   1. first-appearance rank in `ragResults.chunks` (already rerank-ordered), then
 *   2. first-appearance rank in `ragResults.figures`, then
 *   3. paperId lexicographic order (tiebreak for evidence-less/placeholder papers).
 *
 * Returns a new array; input is not mutated. Papers absent from ragResults keep a
 * rank of +Infinity and fall to the sorted tail by paperId.
 *
 * @param {Array<{paperId: string}>} paperMetadata
 * @param {{chunks?: Array<{paper_id: string}>, figures?: Array<{paper_id: string}>}} ragResults
 * @returns {Array<{paperId: string}>}
 */
export function orderPaperMetadataDeterministic(paperMetadata, ragResults) {
  const firstIndex = (items) => {
    const seen = new Map();
    (items ?? []).forEach((item, i) => {
      const id = item?.paper_id;
      if (id != null && !seen.has(id)) seen.set(id, i);
    });
    return seen;
  };
  const chunkRank = firstIndex(ragResults?.chunks);
  const figureRank = firstIndex(ragResults?.figures);

  const rankOf = (paperId) => {
    if (chunkRank.has(paperId)) return chunkRank.get(paperId);
    if (figureRank.has(paperId)) return figureRank.get(paperId) + chunkRank.size;
    return Number.POSITIVE_INFINITY;
  };

  return [...(paperMetadata ?? [])].sort((a, b) => {
    const ra = rankOf(a.paperId);
    const rb = rankOf(b.paperId);
    if (ra !== rb) return ra - rb;
    // Lexicographic tiebreak keeps evidence-less papers deterministically ordered.
    return String(a.paperId).localeCompare(String(b.paperId));
  });
}

/**
 * Deterministic (LLM-free) check of the `[N]` citations in a Q&A response (slice 05).
 *
 * Confirms three things the range-only `formatSourceAttribution` never did:
 *   - existence/range: every cited `[N]` maps to a real paper (1..len).
 *   - paperId consistency: the cited paper actually appears in the RAG evidence set
 *     (`ragResults.chunks ∪ figures` paper_id union). "grounded" here is a WEAK
 *     match — the paper is in evidence — NOT an LLM claim-support check (B-D2 scope
 *     is code-confirmable facts only; LLM groundedness is explicitly out of scope).
 *
 * This records, it does not block: ungrounded/out-of-range citations are reported so
 * the caller can persist them; the answer itself is unchanged (gate C).
 *
 * @param {string} responseText - LLM-generated answer text (post-attribution is fine).
 * @param {Array<{paperId: string}>} orderedPaperMetadata - deterministically ordered.
 * @param {{chunks?: Array<{paper_id: string}>, figures?: Array<{paper_id: string}>}} ragResults
 * @returns {{ citationCount: number, inRange: number[], outOfRange: number[], grounded: number[], ungroundedRefs: number[] }}
 */
export function checkQaCitations(responseText, orderedPaperMetadata, ragResults) {
  const metadata = orderedPaperMetadata ?? [];
  const evidencePaperIds = new Set([
    ...(ragResults?.chunks ?? []).map((c) => c?.paper_id),
    ...(ragResults?.figures ?? []).map((f) => f?.paper_id),
  ].filter((id) => id != null));

  const refPattern = /\[(\d+)\]/g;
  const cited = new Set();
  let match;
  while ((match = refPattern.exec(String(responseText ?? ""))) !== null) {
    cited.add(parseInt(match[1], 10));
  }

  const inRange = [];
  const outOfRange = [];
  const grounded = [];
  const ungroundedRefs = [];
  for (const n of [...cited].sort((a, b) => a - b)) {
    const idx = n - 1; // 0-based
    if (idx < 0 || idx >= metadata.length) {
      outOfRange.push(n);
      continue;
    }
    inRange.push(n);
    if (evidencePaperIds.has(metadata[idx].paperId)) grounded.push(n);
    else ungroundedRefs.push(n);
  }

  return { citationCount: cited.size, inRange, outOfRange, grounded, ungroundedRefs };
}

/**
 * Q&A conversation pipeline (formerly handleQaPipeline in main.mjs).
 *
 * Pure move + dependency-injection boundary: every former module-global reference
 * (supabase, entity-graph functions, RAG runners, embedding, folder-tree lookup,
 * QA answer/attribution helpers, status/token/complete emitters, abort signal) is
 * now an argument. The flow, conditions, status events, persistence, and metadata
 * shape are unchanged from the inlined handler (behavior-preserving; see ledger
 * slice 04). Mirrors the DI contract of runTableConversationPipeline.
 *
 * @returns {Promise<{conversationId: string, messageId: string, hasTable: false}>}
 */
export async function runQaConversationPipeline({
  // values
  conversationId,
  message,
  history,
  scopeFolderId = null,
  scopeAll = true,
  ownerPaperIds = [],
  ownerId,
  // dependencies
  supabase,
  abortSignal,
  emitStatus,
  emitToken,
  emitComplete,
  // injected functions
  runMultiQueryRagFn,
  runGraphEnhancedRagFn,
  getEntityGraphEnabledFn,
  getEntityExtractionModelFn,
  generateEmbeddingFn,
  getPaperIdsInFolderTreeFn,
  generateQaResponseFn,
  formatSourceAttributionFn,
  // pure helpers (default to direct imports; overridable for test isolation)
  intersectPaperIdsFn = defaultIntersectPaperIds,
  unwrapSingleFn = defaultUnwrapSingle,
  assembleRagContextFn = assembleRagContext,
  buildEvidenceLocationsByPaperFn = buildEvidenceLocationsByPaper,
  serializeEvidenceLocationsFn = serializeEvidenceLocations,
  extractKeyTermsFn = extractKeyTerms,
  orderPaperMetadataDeterministicFn = orderPaperMetadataDeterministic,
  checkQaCitationsFn = checkQaCitations,
}) {
  console.log("[Chat/QA] Starting Q&A pipeline...");

  // Stage 1: RAG search
  emitStatus?.({ stage: "searching", message: SEARCHING_MESSAGE });

  let filterPaperIds = ownerPaperIds;
  if (!scopeAll && scopeFolderId) {
    filterPaperIds = intersectPaperIdsFn(ownerPaperIds, await getPaperIdsInFolderTreeFn(scopeFolderId));
  }

  // Use the user's message directly as the search query (simplified vs table pipeline)
  const searchQueries = [{ query: message, intent: "qa" }];
  const keyTerms = extractKeyTermsFn(message);

  // Entity graph is opt-in (default OFF). When enabled, expand context via the
  // entity graph; otherwise fall back to plain multi-query RAG (pre-graph behavior).
  const graphEnabled = await getEntityGraphEnabledFn(ownerId);
  let ragResults;
  if (graphEnabled) {
    emitStatus?.({ stage: "graphing", message: GRAPHING_MESSAGE });
    const entityModelName = await getEntityExtractionModelFn(ownerId);
    ragResults = await runGraphEnhancedRagFn(
      searchQueries,
      keyTerms,
      filterPaperIds,
      "qa",
      supabase,
      {
        generateEmbedding: generateEmbeddingFn,
        runMultiQueryRag: runMultiQueryRagFn,
        modelName: entityModelName,
        abortSignal,
      },
    );
  } else {
    ragResults = await runMultiQueryRagFn(searchQueries, keyTerms, filterPaperIds, "qa", {
      abortSignal,
    });
  }
  throwIfChatAborted(abortSignal);

  // If no results, inform user
  if (ragResults.chunks.length === 0 && ragResults.figures.length === 0) {
    const noDataMsg = NO_DATA_MESSAGE;
    const errMsg = unwrapSingleFn(await supabase
      .from("chat_messages")
      .insert({ conversation_id: conversationId, role: "assistant", content: noDataMsg, message_type: "text" })
      .select("id")
      .single(), "chat_messages insert (qa/no-data)");
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    emitComplete?.({ conversationId, messageId: errMsg.id, hasTable: false });
    return { conversationId, messageId: errMsg.id, hasTable: false };
  }

  // Collect paper metadata
  const paperIds = [...new Set([
    ...ragResults.chunks.map((c) => c.paper_id),
    ...ragResults.figures.map((f) => f.paper_id),
  ])];
  const { data: papers } = await supabase.from("papers").select("id, title, authors, publication_year, doi").in("id", paperIds);
  const paperMetadataUnordered = (papers ?? []).map((p) => ({
    paperId: p.id,
    title: p.title ?? "Untitled",
    authors: Array.isArray(p.authors) ? p.authors.map((a) => a.family ?? a.name ?? "").join(", ") : "",
    year: p.publication_year ?? 0,
    doi: p.doi ?? "",
  }));

  // Deterministic refNo order (slice 05, B-D3): sort by strongest RAG evidence so
  // the [N] numbering is reproducible across runs, not bound to DB return order.
  // The prompt refList, paperRefMap, attribution, and persisted metadata all read
  // this same order, so the conversation stays internally consistent.
  const paperMetadata = orderPaperMetadataDeterministicFn(paperMetadataUnordered, ragResults);

  // Build paper ref map (for assembleRagContext)
  const paperRefMap = new Map();
  paperMetadata.forEach((p, i) => paperRefMap.set(p.paperId, { refNo: i + 1, title: p.title }));
  const evidenceLocationsByPaper = buildEvidenceLocationsByPaperFn(ragResults.chunks, ragResults.figures);

  // Assemble RAG context (text-heavy, no parsed matrices for Q&A)
  const ragContext = assembleRagContextFn(ragResults.chunks, ragResults.figures, paperRefMap, []);

  // Stage 2: Q&A answering (streaming)
  emitStatus?.({ stage: "answering", message: ANSWERING_MESSAGE });
  console.log("[Chat/QA] Streaming Q&A response...");

  let fullResponse = "";
  for await (const token of generateQaResponseFn(ragContext, history, paperMetadata, abortSignal)) {
    fullResponse += token;
    emitToken?.(token);
  }
  throwIfChatAborted(abortSignal);

  // Post-process: ensure source attribution
  const { text: finalText, referencedPaperIds } = formatSourceAttributionFn(fullResponse, paperMetadata, evidenceLocationsByPaper);

  // Deterministic citation check (slice 05): record out-of-range / evidence-less
  // [N] citations. Records only — does not alter finalText or block the answer.
  const citationCheck = checkQaCitationsFn(finalText, paperMetadata, ragResults);
  if (citationCheck.outOfRange.length > 0 || citationCheck.ungroundedRefs.length > 0) {
    console.warn(
      `[Chat/QA] Citation check: ${citationCheck.outOfRange.length} out-of-range, ` +
      `${citationCheck.ungroundedRefs.length} evidence-less of ${citationCheck.citationCount} citations.`,
    );
  }

  // Save assistant message
  const msg = unwrapSingleFn(await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText,
      message_type: "text",
      metadata: {
        source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id),
        referenced_paper_ids: referencedPaperIds,
        source_evidence_locations: serializeEvidenceLocationsFn(evidenceLocationsByPaper),
        citationCheck: {
          citationCount: citationCheck.citationCount,
          outOfRange: citationCheck.outOfRange,
          ungroundedRefs: citationCheck.ungroundedRefs,
        },
      },
    })
    .select("id")
    .single(), "chat_messages insert (qa/final)");

  await supabase.from("chat_conversations").update({ phase: "follow_up", updated_at: new Date().toISOString() }).eq("id", conversationId);

  emitComplete?.({ conversationId, messageId: msg.id, hasTable: false });
  console.log(`[Chat/QA] Response complete. ${referencedPaperIds.length} papers referenced.`);

  return { conversationId, messageId: msg.id, hasTable: false };
}
