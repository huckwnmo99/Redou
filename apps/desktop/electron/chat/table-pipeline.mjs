import { throwIfChatAborted } from "./abort-guards.mjs";
import {
  appendUniqueById,
  applyRecoveredValues,
  assembleRecoveryContext,
  buildRecoveryQueries,
  buildSkippedAgenticRecovery,
  cloneNullSummaryForRecovery,
  cloneTableForRecovery,
  getChunkId,
  getFigureId,
  groupNullsByPaper,
  shouldTriggerAgenticRecovery,
  uniqueStrings,
} from "./agentic-null-recovery.mjs";
import { sanitizeColumnNames } from "./extraction-utils.mjs";
import {
  buildEvidenceLocationsByPaper,
  enrichSourceRefsWithEvidence,
  serializeEvidenceLocations,
} from "./source-evidence.mjs";
import {
  FALLBACK_RAG_BUDGET,
  assemblePerPaperContext,
  assembleRagContext,
  cleanCellValue,
  mergeExtractionResults,
  normalizeFallbackTableToSpec,
} from "./table-extraction.mjs";

const ORCHESTRATING_MESSAGE = "\uC0AC\uC6A9\uC790 \uC694\uCCAD \uBD84\uC11D \uC911...";
const DEFAULT_CLARIFICATION_TEXT = "\uC694\uCCAD\uC744 \uC880 \uB354 \uAD6C\uCCB4\uC801\uC73C\uB85C \uD574\uC8FC\uC138\uC694.";
const SEARCHING_MESSAGE = "\uAD00\uB828 \uB17C\uBB38 \uB370\uC774\uD130 \uAC80\uC0C9 \uC911...";
const NO_DATA_MESSAGE = "\uAD00\uB828 \uB370\uC774\uD130\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC694\uCCAD\uC744 \uB354 \uAD6C\uCCB4\uC801\uC73C\uB85C \uD574\uC8FC\uC2DC\uAC70\uB098, \uD574\uB2F9 \uC8FC\uC81C\uC758 \uB17C\uBB38\uC774 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0 \uC788\uB294\uC9C0 \uD655\uC778\uD574\uC8FC\uC138\uC694.";
const PARSING_MESSAGE = "OCR \uD14C\uC774\uBE14 \uD30C\uC2F1 \uC911...";
const TABLE_CLEANUP_MESSAGE = "\uD14C\uC774\uBE14 \uC815\uB9AC \uC911...";

function defaultUnwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
}

function defaultIntersectPaperIds(basePaperIds, scopedPaperIds) {
  const allowed = new Set(basePaperIds);
  return scopedPaperIds.filter((paperId) => allowed.has(paperId));
}

async function defaultLoadSourceFileMetadataMap() {
  return new Map();
}

async function defaultCheckGroundedness() {
  return { status: "unverified", evidence: "guardian unavailable" };
}

function requireStage3dFn(fn, name) {
  if (typeof fn !== "function") {
    throw new TypeError(`runTableConversationPipeline requires ${name} for Stage 3d recovery`);
  }
  return fn;
}

async function loadTableSetup({ supabase, conversationId, ownerId }) {
  if (!supabase) throw new TypeError("runTableConversationPipeline requires supabase");

  const { data: allPapers } = await supabase
    .from("papers")
    .select("id, title, authors, publication_year")
    .eq("owner_user_id", ownerId)
    .is("trashed_at", null);

  const paperIdsForCaptions = (allPapers ?? []).map((paper) => paper.id);
  let tableFigsForOrchestrator = [];
  if (paperIdsForCaptions.length > 0) {
    const { data } = await supabase
      .from("figures")
      .select("paper_id, figure_no, caption")
      .eq("item_type", "table")
      .in("paper_id", paperIdsForCaptions);
    tableFigsForOrchestrator = data ?? [];
  }

  const captionsByPaperId = new Map();
  for (const figure of tableFigsForOrchestrator ?? []) {
    if (!captionsByPaperId.has(figure.paper_id)) captionsByPaperId.set(figure.paper_id, []);
    captionsByPaperId.get(figure.paper_id).push({ figureNo: figure.figure_no, caption: figure.caption });
  }

  const paperList = (allPapers ?? []).map((paper) => ({
    title: paper.title ?? "Untitled",
    authors: Array.isArray(paper.authors)
      ? paper.authors.map((author) => author.family ?? author.name ?? "").join(", ")
      : "",
    year: paper.publication_year ?? 0,
    tableCaptions: captionsByPaperId.get(paper.id) ?? [],
  }));

  const { data: prevTables } = await supabase
    .from("chat_generated_tables")
    .select("table_title, headers, rows, source_refs")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);

  return {
    paperList,
    previousTable: prevTables?.[0] ?? null,
  };
}

function applyClarifyGuardrail(plan, history) {
  if (plan.action !== "clarify") return plan;

  const clarifyCount = history.filter((message) => message.role === "assistant" && message.message_type === "text").length;
  if (clarifyCount < 3) return plan;

  plan.action = "generate_table";
  const lastUserMsg = [...history].reverse().find((message) => message.role === "user");
  if (lastUserMsg && !plan.search_queries?.length) {
    plan.search_queries = [{ query: lastUserMsg.content, intent: "user request fallback" }];
  }
  if (!plan.keyword_hints) plan.keyword_hints = [];
  if (!plan.table_spec) {
    plan.table_spec = {
      title: "\uC790\uB3D9 \uC0DD\uC131 \uD14C\uC774\uBE14",
      row_axis: "\uAC01 \uB370\uC774\uD130 \uD3EC\uC778\uD2B8",
      column_definitions: [],
      inclusion_criteria: "",
      exclusion_criteria: "",
    };
  }

  return plan;
}

async function handleClarifyAction({
  supabase,
  conversationId,
  plan,
  abortSignal,
  emitStatus,
  emitToken,
  emitComplete,
  unwrapSingleFn,
}) {
  emitStatus?.({ stage: null, message: "" });
  const clarificationText = plan.clarification_response || DEFAULT_CLARIFICATION_TEXT;
  const tokens = clarificationText.split(/(?<=\s)/);
  for (const token of tokens) {
    emitToken?.(token);
  }

  throwIfChatAborted(abortSignal);

  const messageRow = unwrapSingleFn(await supabase
    .from("chat_messages")
    .insert({ conversation_id: conversationId, role: "assistant", content: clarificationText, message_type: "text" })
    .select("id")
    .single(), "chat_messages insert (clarify)");

  await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  const result = { conversationId, messageId: messageRow.id, hasTable: false };
  emitComplete?.(result);
  return result;
}

async function handleNoDataAction({
  supabase,
  conversationId,
  emitComplete,
  unwrapSingleFn,
}) {
  const messageRow = unwrapSingleFn(await supabase
    .from("chat_messages")
    .insert({ conversation_id: conversationId, role: "assistant", content: NO_DATA_MESSAGE, message_type: "text" })
    .select("id")
    .single(), "chat_messages insert (table/no-data)");

  await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  const result = { conversationId, messageId: messageRow.id, hasTable: false };
  emitComplete?.(result);
  return result;
}

async function loadTableRagAndMetadata({
  supabase,
  conversationId,
  ownerPaperIds,
  scopeFolderId,
  scopeAll,
  plan,
  abortSignal,
  emitStatus,
  emitComplete,
  runMultiQueryRagFn,
  getPaperIdsInFolderTreeFn,
  intersectPaperIdsFn,
  loadSourceFileMetadataMapFn,
  unwrapSingleFn,
}) {
  if (typeof runMultiQueryRagFn !== "function") {
    throw new TypeError("runTableConversationPipeline requires runMultiQueryRagFn after Stage 1");
  }

  emitStatus?.({
    stage: "searching",
    message: SEARCHING_MESSAGE,
    detail: `${plan.search_queries.length}\uAC1C \uCFFC\uB9AC \uC2E4\uD589`,
  });
  console.log(`[Chat] Stage 2: RAG - ${plan.search_queries.length} queries`);

  let filterPaperIds = ownerPaperIds;
  if (!scopeAll && scopeFolderId) {
    if (typeof getPaperIdsInFolderTreeFn !== "function") {
      throw new TypeError("runTableConversationPipeline requires getPaperIdsInFolderTreeFn for folder-scoped RAG");
    }
    filterPaperIds = intersectPaperIdsFn(ownerPaperIds, await getPaperIdsInFolderTreeFn(scopeFolderId));
  }

  const ragResults = await runMultiQueryRagFn(plan.search_queries, plan.keyword_hints, filterPaperIds, "table", {
    abortSignal,
  });
  throwIfChatAborted(abortSignal);

  if (ragResults.chunks.length === 0 && ragResults.figures.length === 0) {
    return {
      result: await handleNoDataAction({
        supabase,
        conversationId,
        emitComplete,
        unwrapSingleFn,
      }),
    };
  }

  const paperIds = [...new Set([
    ...ragResults.chunks.map((chunk) => chunk.paper_id),
    ...ragResults.figures.map((figure) => figure.paper_id),
  ])];
  const { data: papers } = await supabase
    .from("papers")
    .select("id, title, authors, publication_year, journal_name, doi")
    .in("id", paperIds);
  const paperMetadata = (papers ?? []).map((paper) => ({
    paperId: paper.id,
    title: paper.title ?? "Untitled",
    authors: Array.isArray(paper.authors)
      ? paper.authors.map((author) => author.family ?? author.name ?? "").join(", ")
      : "",
    year: paper.publication_year ?? 0,
    journal: paper.journal_name ?? "",
    doi: paper.doi ?? "",
  }));

  const existingFigIds = new Set(ragResults.figures.map((figure) => figure.figure_id));
  const { data: allTableFigures, error: backfillErr } = await supabase
    .from("figures")
    .select("id, paper_id, source_file_id, figure_no, caption, item_type, summary_text, page")
    .in("paper_id", paperIds)
    .eq("item_type", "table");
  if (backfillErr) console.error("[Chat/RAG] backfill query error:", backfillErr.message);

  const backfillSourceFiles = await loadSourceFileMetadataMapFn((allTableFigures ?? []).map((figure) => figure.source_file_id));
  let backfillCount = 0;
  for (const figure of allTableFigures ?? []) {
    if (existingFigIds.has(figure.id)) continue;
    const sourceFile = backfillSourceFiles.get(figure.source_file_id) ?? {};
    ragResults.figures.push({
      figure_id: figure.id,
      paper_id: figure.paper_id,
      source_file_id: figure.source_file_id,
      source_file_kind: sourceFile.source_file_kind ?? null,
      source_filename: sourceFile.source_filename ?? null,
      figure_no: figure.figure_no,
      caption: figure.caption,
      item_type: figure.item_type,
      summary_text: figure.summary_text,
      page: figure.page,
      similarity: 0,
      _rrfScore: 0,
    });
    backfillCount++;
  }
  if (backfillCount > 0) {
    console.log(`[Chat/RAG] Backfilled ${backfillCount} table figures not found by semantic search`);
  }

  const paperRefMap = new Map();
  paperMetadata.forEach((paper, index) => paperRefMap.set(paper.paperId, { refNo: index + 1, title: paper.title }));
  const evidenceLocationsByPaper = buildEvidenceLocationsByPaper(ragResults.chunks, ragResults.figures);

  return {
    ragResults,
    paperMetadata,
    paperRefMap,
    evidenceLocationsByPaper,
  };
}

async function parseTableMatrices({
  ragResults,
  paperMetadata,
  emitStatus,
  abortSignal,
  parseAllHtmlTablesFn,
  extractMatrixFromHtmlFn,
}) {
  emitStatus?.({ stage: "parsing", message: PARSING_MESSAGE });
  console.log("[Chat] Stage 3a: Parsing OCR tables...");

  const figuresByPaper = new Map();
  for (const figure of ragResults.figures) {
    if (!figuresByPaper.has(figure.paper_id)) figuresByPaper.set(figure.paper_id, []);
    figuresByPaper.get(figure.paper_id).push(figure);
  }

  const chunksByPaper = new Map();
  for (const chunk of ragResults.chunks) {
    if (!chunksByPaper.has(chunk.paper_id)) chunksByPaper.set(chunk.paper_id, []);
    chunksByPaper.get(chunk.paper_id).push(chunk);
  }

  const parsedMatrices = [];
  let codeParseCount = 0;
  let llmParseCount = 0;

  const allPaperIds = [...new Set([...figuresByPaper.keys(), ...chunksByPaper.keys()])];
  for (let paperIndex = 0; paperIndex < allPaperIds.length; paperIndex++) {
    const paperId = allPaperIds[paperIndex];
    const paperMeta = paperMetadata.find((paper) => paper.paperId === paperId);
    if (!paperMeta) continue;

    const figures = figuresByPaper.get(paperId) ?? [];
    const ocrFigures = figures.filter((figure) => figure.summary_text && figure.summary_text.length > 30);
    if (ocrFigures.length === 0) continue;
    if (typeof parseAllHtmlTablesFn !== "function") {
      throw new TypeError("runTableConversationPipeline requires parseAllHtmlTablesFn for Stage 3a parsing");
    }

    const tables = [];
    for (const figure of ocrFigures) {
      const codeParsed = parseAllHtmlTablesFn(figure.summary_text);
      const successTables = codeParsed.filter((table) => table.success);

      if (successTables.length > 0) {
        for (const table of successTables) {
          tables.push({
            headers: table.headers,
            rows: table.rows,
            caption: figure.caption || figure.figure_no || "",
            source: "code",
            source_file_id: figure.source_file_id,
            source_file_kind: figure.source_file_kind,
            source_filename: figure.source_filename,
            page: figure.page,
          });
          codeParseCount++;
        }
      } else {
        try {
          if (typeof extractMatrixFromHtmlFn !== "function") {
            throw new TypeError("runTableConversationPipeline requires extractMatrixFromHtmlFn for Stage 3a LLM fallback");
          }
          emitStatus?.({
            stage: "parsing",
            message: `LLM \uD30C\uC2F1 \uC911... ${paperMeta.title.slice(0, 30)}`,
          });
          const extracted = await extractMatrixFromHtmlFn(figure.summary_text, abortSignal);
          if (extracted.headers?.length > 0 && extracted.rows?.length > 0) {
            tables.push({
              headers: extracted.headers,
              rows: extracted.rows,
              caption: figure.caption || figure.figure_no || "",
              source: "llm",
              source_file_id: figure.source_file_id,
              source_file_kind: figure.source_file_kind,
              source_filename: figure.source_filename,
              page: figure.page,
            });
            llmParseCount++;
          }
        } catch (err) {
          console.error(`[Chat] Extractor Agent failed for ${figure.figure_no}:`, err.message);
        }
      }
    }

    if (tables.length > 0) {
      parsedMatrices.push({
        paperIndex,
        paperId,
        paperTitle: paperMeta.title,
        tables,
      });
    }
  }

  console.log(`[Chat] Stage 3a: Parsed ${codeParseCount} tables (code) + ${llmParseCount} tables (LLM) from ${parsedMatrices.length} papers`);

  return {
    figuresByPaper,
    chunksByPaper,
    allPaperIds,
    parsedMatrices,
  };
}

async function runPerPaperExtraction({
  plan,
  paperMetadata,
  figuresByPaper,
  chunksByPaper,
  allPaperIds,
  parsedMatrices,
  emitStatus,
  abortSignal,
  extractColumnsFromPaperFn,
}) {
  const tableSpec = plan.table_spec || {
    title: "\uBE44\uAD50 \uD14C\uC774\uBE14",
    column_definitions: [],
  };

  const stage3bStart = Date.now();
  if (tableSpec.column_definitions) {
    tableSpec.column_definitions = sanitizeColumnNames(tableSpec.column_definitions);
  }

  const columnDefs = Array.isArray(tableSpec.column_definitions) ? tableSpec.column_definitions : [];
  console.log(`[SRAG-DEBUG] columnDefs: ${JSON.stringify(columnDefs)}`);
  const parsedTablesByPaper = new Map(parsedMatrices.map((pm) => [pm.paperId, pm.tables]));

  const extractionResults = [];
  let extractionSuccessCount = 0;
  let extractionFailCount = 0;
  let extractionFallbackNeeded = false;

  if (columnDefs.length > 0 && allPaperIds.length > 0) {
    if (typeof extractColumnsFromPaperFn !== "function") {
      throw new TypeError("runTableConversationPipeline requires extractColumnsFromPaperFn for Stage 3b extraction");
    }

    for (let i = 0; i < allPaperIds.length; i++) {
      const pid = allPaperIds[i];
      const pMeta = paperMetadata.find((paper) => paper.paperId === pid);
      if (!pMeta) continue;

      emitStatus?.({
        stage: "extracting",
        message: `\uB17C\uBB38\uBCC4 \uB370\uC774\uD130 \uCD94\uCD9C \uC911... (${i + 1}/${allPaperIds.length})`,
        detail: pMeta.title?.slice(0, 60) ?? "",
      });

      const paperContext = assemblePerPaperContext({
        chunks: chunksByPaper.get(pid) ?? [],
        figures: figuresByPaper.get(pid) ?? [],
        parsedTables: parsedTablesByPaper.get(pid) ?? [],
        paperTitle: pMeta.title,
      });

      if (!paperContext || paperContext.trim().length === 0) {
        extractionResults.push({
          paperId: pid,
          paperTitle: pMeta.title,
          extraction: { paper_title: pMeta.title, data_rows: [] },
          success: true,
          ms: 0,
        });
        continue;
      }

      const t0 = Date.now();
      try {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
        const onAbort = () => timeoutController.abort();
        abortSignal?.addEventListener("abort", onAbort);

        let extraction;
        try {
          extraction = await extractColumnsFromPaperFn(
            tableSpec,
            paperContext,
            pMeta.title,
            timeoutController.signal,
          );
        } finally {
          clearTimeout(timeoutId);
          abortSignal?.removeEventListener("abort", onAbort);
        }

        extractionResults.push({
          paperId: pid,
          paperTitle: pMeta.title,
          extraction,
          success: true,
          ms: Date.now() - t0,
        });
        extractionSuccessCount++;
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        console.error(`[Chat] Stage 3b extraction failed for "${pMeta.title?.slice(0, 40)}":`, err.message);
        extractionResults.push({
          paperId: pid,
          paperTitle: pMeta.title,
          extraction: { paper_title: pMeta.title, data_rows: [] },
          success: false,
          error: err.message,
          ms: Date.now() - t0,
        });
        extractionFailCount++;
      }
    }

    if (extractionSuccessCount === 0 && extractionFailCount > 0) {
      extractionFallbackNeeded = true;
    }
  } else {
    extractionFallbackNeeded = true;
  }

  const stage3bMs = Date.now() - stage3bStart;
  console.log(
    `[Chat] Stage 3b: Per-paper extraction -> ${extractionSuccessCount} success, ${extractionFailCount} fail, ${stage3bMs}ms (fallback=${extractionFallbackNeeded})`,
  );

  return {
    tableSpec,
    extractionResults,
    extractionSuccessCount,
    extractionFailCount,
    extractionFallbackNeeded,
    stage3bMs,
  };
}

async function runStage3cMergeFallback({
  tableSpec,
  ragResults,
  paperMetadata,
  paperRefMap,
  parsedMatrices,
  extractionResults,
  extractionFallbackNeeded,
  emitStatus,
  abortSignal,
  generateTableFromSpecFn,
}) {
  emitStatus?.({ stage: "assembling", message: "\uD14C\uC774\uBE14 \uC0DD\uC131 \uC911..." });

  let tableJson;
  let extractionMode;
  let nullSummary = null;
  let agenticRecovery = null;
  let tableSpecAdherence = null;
  // Preserve the per-paper merge result so that, if the single-call fallback
  // throws (e.g. DOMException TimeoutError), we can still salvage partial rows
  // instead of crashing the whole pipeline. Stays null when fallback was forced
  // before any merge ran (e.g. all per-paper extractions failed up front).
  let mergedTableJson = null;

  if (!extractionFallbackNeeded) {
    console.log("[Chat] Stage 3c: Merging per-paper extractions (code-only, no LLM)...");
    const merged = mergeExtractionResults(extractionResults, tableSpec, paperMetadata, paperRefMap);
    tableJson = merged.tableJson;
    mergedTableJson = merged.tableJson;
    nullSummary = merged.nullSummary;
    extractionMode = "per_paper";

    if (!tableJson.rows || tableJson.rows.length === 0) {
      console.warn("[Chat] Stage 3c: merged result empty -> falling back to single-call Table Agent");
      extractionFallbackNeeded = true;
    }
  }

  if (extractionFallbackNeeded) {
    if (typeof generateTableFromSpecFn !== "function") {
      throw new TypeError("runTableConversationPipeline requires generateTableFromSpecFn for Stage 3c fallback");
    }
    console.log("[Chat] Stage 3c: Fallback -> single-call Table Agent on combined RAG context...");
    const ragContext = assembleRagContext(
      ragResults.chunks,
      ragResults.figures,
      paperRefMap,
      parsedMatrices,
      FALLBACK_RAG_BUDGET,
    );
    try {
      tableJson = await generateTableFromSpecFn(tableSpec, ragContext, paperMetadata, abortSignal);
      throwIfChatAborted(abortSignal);
      const normalizedFallback = normalizeFallbackTableToSpec(tableJson, tableSpec);
      tableJson = normalizedFallback.tableJson;
      tableSpecAdherence = normalizedFallback.diagnostics;
    } catch (err) {
      // User-initiated abort must still propagate so the request is cancelled.
      throwIfChatAborted(abortSignal);
      // Timeout / generic fallback failure: do NOT crash the pipeline. Salvage
      // the per-paper merge result if it had any rows, otherwise return an empty
      // table with a note so the user sees a result instead of an error screen.
      // Stage 3d is skipped because extractionMode stays "single_call_fallback"
      // and nullSummary is null; persistTableReport handles rows: [] safely.
      console.error(
        "[Chat] Stage 3c: single-call fallback failed (non-abort), returning salvaged/empty table:",
        err?.message || err,
      );
      if (mergedTableJson && Array.isArray(mergedTableJson.rows) && mergedTableJson.rows.length > 0) {
        tableJson = mergedTableJson;
      } else {
        tableJson = {
          title: tableSpec?.title || "비교 테이블",
          headers: Array.isArray(tableSpec?.column_definitions) ? tableSpec.column_definitions.slice() : [],
          rows: [],
          references: [],
          notes: "표 생성이 시간 내에 완료되지 못했습니다. 요청을 더 구체적으로 좁히거나 다시 시도해주세요.",
        };
      }
    }
    extractionMode = "single_call_fallback";
    agenticRecovery = buildSkippedAgenticRecovery(null, "single_call_fallback");
    nullSummary = null;
  }

  return {
    tableJson,
    nullSummary,
    extractionMode,
    agenticRecovery,
    tableSpecAdherence,
    extractionFallbackNeeded,
  };
}

async function runAgenticNullRecovery({
  tableJson,
  nullSummary,
  paperRefMap,
  paperMetadata,
  tableSpec,
  keywordHints,
  chunksByPaper,
  figuresByPaper,
  abortSignal,
  onStatus,
  runPaperScopedRecoverySearchFn,
  extractNullCellsFromPaperFn,
}) {
  const startedAt = Date.now();
  const nullsBeforeRecovery = Number(nullSummary?.totalNulls ?? 0);
  const baseRecovery = {
    attempted: false,
    ms: 0,
    nullsBeforeRecovery,
    nullsAfterRecovery: nullsBeforeRecovery,
    recoveredCellCount: 0,
    perPaper: [],
  };

  try {
    if (!shouldTriggerAgenticRecovery(nullSummary, tableJson, abortSignal)) {
      return {
        tableJson,
        nullSummary,
        agenticRecovery: {
          ...baseRecovery,
          ms: Date.now() - startedAt,
          skippedReason: "gate_not_met",
        },
      };
    }

    const runPaperScopedRecoverySearch = requireStage3dFn(runPaperScopedRecoverySearchFn, "runPaperScopedRecoverySearchFn");
    const extractNullCellsFromPaper = requireStage3dFn(extractNullCellsFromPaperFn, "extractNullCellsFromPaperFn");

    const workingTableJson = cloneTableForRecovery(tableJson);
    const workingNullSummary = cloneNullSummaryForRecovery(nullSummary);
    const groupedNulls = groupNullsByPaper(workingNullSummary);
    const perPaper = [];
    const recoveredEvidenceChunks = [];
    const recoveredEvidenceFigures = [];
    let recoveredCellCount = 0;
    let paperIndex = 0;

    for (const [paperId, group] of groupedNulls) {
      paperIndex++;
      const paperTitle = group.paperTitle || paperMetadata?.find((paper) => paper.paperId === paperId)?.title || "Untitled";
      const nullColumns = uniqueStrings(group.nullCells.map((cell) => cell.column));
      const paperRecord = {
        paperId,
        paperTitle,
        nullColumns,
        queriesUsed: 0,
        recoveredCount: 0,
        success: true,
      };

      try {
        if (abortSignal?.aborted) {
          paperRecord.success = false;
          paperRecord.skippedReason = "aborted";
          perPaper.push(paperRecord);
          break;
        }

        onStatus?.({
          stage: "researching",
          message: "NULL \uAC12 \uC7AC\uAC80\uC0C9 \uC911...",
          detail: `(${paperIndex}/${groupedNulls.size}) ${paperTitle.slice(0, 60)}`,
        });

        const queries = buildRecoveryQueries(paperTitle, nullColumns, keywordHints);
        paperRecord.queriesUsed = queries.length;
        const recoveryResults = await runPaperScopedRecoverySearch(queries, paperId, abortSignal);

        const existingChunkIds = new Set((chunksByPaper?.get(paperId) ?? []).map(getChunkId).filter(Boolean));
        const existingFigureIds = new Set((figuresByPaper?.get(paperId) ?? []).map(getFigureId).filter(Boolean));
        const newChunks = (recoveryResults.chunks ?? []).filter((chunk) => {
          const id = getChunkId(chunk);
          return id && !existingChunkIds.has(id);
        });
        const newFigures = (recoveryResults.figures ?? []).filter((figure) => {
          const id = getFigureId(figure);
          return id && !existingFigureIds.has(id);
        });

        paperRecord.newChunkCount = newChunks.length;
        paperRecord.newFigureCount = newFigures.length;

        if (newChunks.length === 0 && newFigures.length === 0) {
          paperRecord.skippedReason = "no_new_context";
          perPaper.push(paperRecord);
          continue;
        }

        const recoveryContext = assembleRecoveryContext({
          newChunks,
          newFigures,
          missingColumns: nullColumns,
          paperTitle,
        });

        if (!recoveryContext || recoveryContext.length === 0) {
          paperRecord.skippedReason = "empty_recovery_context";
          perPaper.push(paperRecord);
          continue;
        }

        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 30000);
        const onAbort = () => timeoutController.abort();
        abortSignal?.addEventListener("abort", onAbort);

        let recovered;
        try {
          recovered = await extractNullCellsFromPaper(
            tableSpec,
            nullColumns,
            recoveryContext,
            paperTitle,
            timeoutController.signal,
          );
        } finally {
          clearTimeout(timeoutId);
          abortSignal?.removeEventListener("abort", onAbort);
        }

        const applied = applyRecoveredValues(
          workingTableJson,
          paperRefMap,
          paperId,
          recovered?.data_rows ?? [],
          workingNullSummary,
        );
        paperRecord.recoveredCount = applied;
        if (applied > 0) {
          recoveredEvidenceChunks.push(...newChunks);
          recoveredEvidenceFigures.push(...newFigures);
        }
        recoveredCellCount += applied;
        perPaper.push(paperRecord);
      } catch (err) {
        paperRecord.success = false;
        paperRecord.error = err?.message || String(err);
        perPaper.push(paperRecord);
        console.warn(`[Chat] Stage 3d recovery skipped for "${paperTitle.slice(0, 40)}": ${paperRecord.error}`);
      }
    }

    return {
      tableJson: workingTableJson,
      nullSummary: workingNullSummary,
      recoveredEvidenceChunks,
      recoveredEvidenceFigures,
      agenticRecovery: {
        attempted: true,
        ms: Date.now() - startedAt,
        nullsBeforeRecovery,
        nullsAfterRecovery: Number(workingNullSummary?.totalNulls ?? 0),
        recoveredCellCount,
        perPaper,
      },
    };
  } catch (err) {
    console.error("[Chat] Stage 3d Agentic NULL Recovery failed soft:", err?.message || err);
    return {
      tableJson,
      nullSummary,
      agenticRecovery: {
        ...baseRecovery,
        ms: Date.now() - startedAt,
        success: false,
        error: err?.message || String(err),
      },
    };
  }
}

async function runStage3dAgenticNullRecovery({
  stage3cContext,
  tableSpec,
  paperRefMap,
  paperMetadata,
  keywordHints,
  ragResults,
  chunksByPaper,
  figuresByPaper,
  evidenceLocationsByPaper,
  emitStatus,
  abortSignal,
  runPaperScopedRecoverySearchFn,
  extractNullCellsFromPaperFn,
}) {
  let {
    tableJson,
    nullSummary,
    extractionMode,
    agenticRecovery,
  } = stage3cContext;
  let nextEvidenceLocationsByPaper = evidenceLocationsByPaper;

  if (extractionMode === "per_paper" && nullSummary) {
    const recoveryResult = await runAgenticNullRecovery({
      tableJson,
      nullSummary,
      paperRefMap,
      paperMetadata,
      tableSpec,
      keywordHints,
      chunksByPaper,
      figuresByPaper,
      abortSignal,
      onStatus: (status) => emitStatus?.(status),
      runPaperScopedRecoverySearchFn,
      extractNullCellsFromPaperFn,
    });
    tableJson = recoveryResult.tableJson;
    nullSummary = recoveryResult.nullSummary;
    agenticRecovery = recoveryResult.agenticRecovery;

    if ((recoveryResult.recoveredEvidenceChunks?.length ?? 0) > 0 || (recoveryResult.recoveredEvidenceFigures?.length ?? 0) > 0) {
      appendUniqueById(ragResults.chunks, recoveryResult.recoveredEvidenceChunks, getChunkId);
      appendUniqueById(ragResults.figures, recoveryResult.recoveredEvidenceFigures, getFigureId);
      nextEvidenceLocationsByPaper = buildEvidenceLocationsByPaper(ragResults.chunks, ragResults.figures);
    }
    if (agenticRecovery?.attempted) {
      console.log(
        `[Chat] Stage 3d: Agentic NULL Recovery filled ${agenticRecovery.recoveredCellCount} cells in ${agenticRecovery.ms}ms`,
      );
      emitStatus?.({
        stage: "assembling",
        message: TABLE_CLEANUP_MESSAGE,
      });
    }
  }

  return {
    ...stage3cContext,
    tableJson,
    nullSummary,
    agenticRecovery,
    evidenceLocationsByPaper: nextEvidenceLocationsByPaper,
  };
}

async function persistTableReport({
  supabase,
  conversationId,
  tableJson,
  ragResults,
  paperMetadata,
  paperRefMap,
  evidenceLocationsByPaper,
  extractionResults,
  stage3bMs,
  nullSummary,
  extractionMode,
  agenticRecovery,
  tableSpecAdherence,
  abortSignal,
  emitComplete,
  unwrapSingleFn,
}) {
  if (tableJson.rows) {
    tableJson.rows = tableJson.rows.map((row) => row.map((cell) => cleanCellValue(cell)));
  }
  console.log(
    `[Chat] Stage 3c: Table -> ${tableJson.rows?.length ?? 0} rows, ${tableJson.references?.length ?? 0} references (mode=${extractionMode})`,
  );

  const sourceEvidenceLocations = serializeEvidenceLocations(evidenceLocationsByPaper);
  const extractionMetadata = {
    extractionMode,
    stage3bMs,
    perPaperTiming: extractionResults.map((r) => ({ paperId: r.paperId, ms: r.ms, success: r.success })),
    partialFailures: extractionResults.filter((r) => !r.success).map((r) => ({ paperId: r.paperId, paperTitle: r.paperTitle, error: r.error })),
    nullSummary,
    agenticRecovery,
    tableSpecAdherence,
    sourceEvidenceLocations,
  };

  throwIfChatAborted(abortSignal);
  const msg = unwrapSingleFn(await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content: JSON.stringify(tableJson),
      message_type: "table_report",
      metadata: {
        source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id),
        source_evidence_locations: sourceEvidenceLocations,
      },
    })
    .select("id")
    .single(), "chat_messages insert (table_report)");

  await supabase.from("chat_conversations").update({ phase: "follow_up", updated_at: new Date().toISOString() }).eq("id", conversationId);

  const doiLookup = new Map(paperMetadata.map((p) => [p.paperId, p.doi]));
  let sourceRefs = tableJson.references?.length > 0 ? tableJson.references : null;
  if (!sourceRefs || sourceRefs.length === 0) {
    console.log("[Chat] No references -> generating from paperMetadata");
    sourceRefs = paperMetadata.map((p, i) => ({
      refNo: String(i + 1),
      paperId: p.paperId,
      title: p.title,
      authors: p.authors,
      year: p.year,
      doi: p.doi,
    }));
  } else {
    sourceRefs = sourceRefs.map((ref) => ({
      ...ref,
      doi: ref.doi || doiLookup.get(ref.paperId) || "",
    }));
  }
  sourceRefs = enrichSourceRefsWithEvidence(sourceRefs, evidenceLocationsByPaper, paperRefMap);

  const tableRow = unwrapSingleFn(await supabase
    .from("chat_generated_tables")
    .insert({
      message_id: msg.id,
      conversation_id: conversationId,
      table_title: tableJson.title,
      headers: tableJson.headers,
      rows: tableJson.rows,
      source_refs: sourceRefs,
      metadata: extractionMetadata,
    })
    .select("id")
    .single(), "chat_generated_tables insert");
  const tableId = tableRow.id;

  await supabase.from("chat_messages").update({
    metadata: {
      source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id),
      source_evidence_locations: sourceEvidenceLocations,
      table_id: tableId,
    },
  }).eq("id", msg.id);

  const result = {
    conversationId,
    messageId: msg.id,
    hasTable: true,
    tableId,
  };
  emitComplete?.(result);

  return {
    ...result,
    tableJson,
    sourceRefs,
    extractionMetadata,
  };
}

function scheduleGuardianVerification({
  supabase,
  conversationId,
  tableId,
  tableJson,
  ragResults,
  emitStatus,
  emitVerificationDone,
  checkGroundednessFn,
  scheduleImmediateFn,
}) {
  scheduleImmediateFn(async () => {
    try {
      emitStatus?.({ stage: "verifying", message: "\uB370\uC774\uD130 \uAC80\uC99D \uC911..." });
      console.log("[Chat] Stage 4: Guardian - verifying data...");

      const allSourceTexts = [
        ...ragResults.figures.filter((f) => f.summary_text).map((f) => `${f.caption ?? ""}\n${f.summary_text}`.slice(0, 1000)),
        ...ragResults.chunks.slice(0, 20).map((c) => c.text.slice(0, 800)),
      ];
      const combinedSource = allSourceTexts.join("\n\n").slice(0, 12000);

      const cellsToVerify = [];
      for (let r = 0; r < tableJson.rows.length; r++) {
        for (let c = 0; c < tableJson.rows[r].length; c++) {
          const cellValue = tableJson.rows[r][c];
          if (!cellValue || cellValue === "N/A" || cellValue.trim() === "") continue;
          const cleanValue = cellValue.replace(/\[\d+\]/g, "").trim();
          if (!cleanValue || !/\d/.test(cleanValue)) continue;
          cellsToVerify.push({ row: r, col: c, cleanValue });
        }
      }

      const maxVerify = 50;
      const sampled = cellsToVerify.length > maxVerify
        ? cellsToVerify.filter((_, i) => i % Math.ceil(cellsToVerify.length / maxVerify) === 0)
        : cellsToVerify;
      console.log(`[Chat] Guardian: ${cellsToVerify.length} numeric cells -> sampling ${sampled.length}`);

      const batchSize = 5;
      const verification = [];
      for (let i = 0; i < sampled.length; i += batchSize) {
        const batch = sampled.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((cell) => {
            const identParts = tableJson.headers.slice(0, 2)
              .map((h, idx) => tableJson.rows[cell.row]?.[idx])
              .filter(Boolean)
              .join(", ");
            const claim = identParts
              ? `For ${identParts}, the value of ${tableJson.headers[cell.col]} is ${cell.cleanValue}`
              : `The value of ${tableJson.headers[cell.col]} is ${cell.cleanValue}`;
            return checkGroundednessFn(combinedSource, claim)
              .then((res) => ({ row: cell.row, col: cell.col, ...res }))
              .catch(() => ({ row: cell.row, col: cell.col, status: "unverified", evidence: "error" }));
          }),
        );
        verification.push(...results);
      }

      await supabase.from("chat_generated_tables").update({ verification }).eq("id", tableId);
      emitVerificationDone?.({ conversationId, tableId, verification });
      console.log(`[Chat] Verification done: ${verification.filter((v) => v.status === "verified").length}/${verification.length} verified`);
    } catch (err) {
      console.error("[Chat] Verification error (non-fatal):", err.message);
    }
  });
}

/**
 * Stage 2A table pipeline shell.
 *
 * The table pipeline owns setup through final table persistence plus Stage 4
 * Guardian verification scheduling.
 */
export async function runTableConversationPipeline({
  supabase,
  emitStatus,
  emitToken,
  emitComplete,
  abortSignal,
  conversationId,
  ownerId,
  history,
  ownerPaperIds = [],
  scopeFolderId = null,
  scopeAll = true,
  paperList,
  previousTable,
  generateOrchestratorPlanFn,
  runMultiQueryRagFn,
  getPaperIdsInFolderTreeFn,
  intersectPaperIdsFn = defaultIntersectPaperIds,
  loadSourceFileMetadataMapFn = defaultLoadSourceFileMetadataMap,
  parseAllHtmlTablesFn,
  extractMatrixFromHtmlFn,
  extractColumnsFromPaperFn,
  generateTableFromSpecFn,
  runPaperScopedRecoverySearchFn,
  extractNullCellsFromPaperFn,
  checkGroundednessFn = defaultCheckGroundedness,
  scheduleImmediateFn = setImmediate,
  emitVerificationDone,
  unwrapSingleFn = defaultUnwrapSingle,
}) {
  if (typeof generateOrchestratorPlanFn !== "function") {
    throw new TypeError("runTableConversationPipeline requires generateOrchestratorPlanFn");
  }

  const setup = paperList === undefined || previousTable === undefined
    ? await loadTableSetup({ supabase, conversationId, ownerId })
    : { paperList, previousTable };
  throwIfChatAborted(abortSignal);

  emitStatus?.({ stage: "orchestrating", message: ORCHESTRATING_MESSAGE });
  const plan = applyClarifyGuardrail(
    await generateOrchestratorPlanFn(history, setup.paperList, setup.previousTable, abortSignal),
    history,
  );
  throwIfChatAborted(abortSignal);

  if (plan.action === "clarify") {
    return await handleClarifyAction({
      supabase,
      conversationId,
      plan,
      abortSignal,
      emitStatus,
      emitToken,
      emitComplete,
      unwrapSingleFn,
    });
  }

  const ragContext = await loadTableRagAndMetadata({
    supabase,
    conversationId,
    ownerPaperIds,
    scopeFolderId,
    scopeAll,
    plan,
    abortSignal,
    emitStatus,
    emitComplete,
    runMultiQueryRagFn,
    getPaperIdsInFolderTreeFn,
    intersectPaperIdsFn,
    loadSourceFileMetadataMapFn,
    unwrapSingleFn,
  });
  if (ragContext.result) return ragContext.result;

  const parsedContext = await parseTableMatrices({
    ragResults: ragContext.ragResults,
    paperMetadata: ragContext.paperMetadata,
    emitStatus,
    abortSignal,
    parseAllHtmlTablesFn,
    extractMatrixFromHtmlFn,
  });

  const extractionContext = await runPerPaperExtraction({
    plan,
    paperMetadata: ragContext.paperMetadata,
    figuresByPaper: parsedContext.figuresByPaper,
    chunksByPaper: parsedContext.chunksByPaper,
    allPaperIds: parsedContext.allPaperIds,
    parsedMatrices: parsedContext.parsedMatrices,
    emitStatus,
    abortSignal,
    extractColumnsFromPaperFn,
  });

  const stage3cContext = await runStage3cMergeFallback({
    tableSpec: extractionContext.tableSpec,
    ragResults: ragContext.ragResults,
    paperMetadata: ragContext.paperMetadata,
    paperRefMap: ragContext.paperRefMap,
    parsedMatrices: parsedContext.parsedMatrices,
    extractionResults: extractionContext.extractionResults,
    extractionFallbackNeeded: extractionContext.extractionFallbackNeeded,
    emitStatus,
    abortSignal,
    generateTableFromSpecFn,
  });

  const stage3dContext = await runStage3dAgenticNullRecovery({
    stage3cContext,
    tableSpec: extractionContext.tableSpec,
    paperRefMap: ragContext.paperRefMap,
    paperMetadata: ragContext.paperMetadata,
    keywordHints: plan.keyword_hints ?? [],
    ragResults: ragContext.ragResults,
    chunksByPaper: parsedContext.chunksByPaper,
    figuresByPaper: parsedContext.figuresByPaper,
    evidenceLocationsByPaper: ragContext.evidenceLocationsByPaper,
    emitStatus,
    abortSignal,
    runPaperScopedRecoverySearchFn,
    extractNullCellsFromPaperFn,
  });
  throwIfChatAborted(abortSignal);

  const persistenceResult = await persistTableReport({
    supabase,
    conversationId,
    tableJson: stage3dContext.tableJson,
    ragResults: ragContext.ragResults,
    paperMetadata: ragContext.paperMetadata,
    paperRefMap: ragContext.paperRefMap,
    evidenceLocationsByPaper: stage3dContext.evidenceLocationsByPaper,
    extractionResults: extractionContext.extractionResults,
    stage3bMs: extractionContext.stage3bMs,
    nullSummary: stage3dContext.nullSummary,
    extractionMode: stage3cContext.extractionMode,
    agenticRecovery: stage3dContext.agenticRecovery,
    tableSpecAdherence: stage3cContext.tableSpecAdherence,
    abortSignal,
    emitComplete,
    unwrapSingleFn,
  });

  scheduleGuardianVerification({
    supabase,
    conversationId,
    tableId: persistenceResult.tableId,
    tableJson: persistenceResult.tableJson,
    ragResults: ragContext.ragResults,
    emitStatus,
    emitVerificationDone,
    checkGroundednessFn,
    scheduleImmediateFn,
  });

  return {
    conversationId,
    messageId: persistenceResult.messageId,
    hasTable: true,
    tableId: persistenceResult.tableId,
  };
}
