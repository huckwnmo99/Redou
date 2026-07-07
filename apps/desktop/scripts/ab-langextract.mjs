// ============================================================================
// Manual A/B — NOT run in CI. Requires LIVE Supabase (55321) + Ollama (11434) +
// LangExtract sidecar (8012), plus real imported papers. The (a) side also needs
// vLLM (8100) for the real table pipeline. One run takes many minutes.
//
// tool-ab-adoption slice 04 — LangExtract as an ALTERNATIVE Stage 3b extractor.
// Compares, on the SAME papers, the SAME fixture, the SAME LLM, and the SAME
// metric scope as scripts/e2e-table-fidelity.mjs:
//   (a) CURRENT Stage 3b — the real table pipeline (runTableConversationPipeline,
//       SRAG per-paper extraction), scored by table_fidelity. This IS the fair
//       88.6% in-scope baseline; nothing about the production path is changed.
//   (b) LangExtract — feed each paper's chunks + OCR table text to /extract with
//       the adsorption few-shot schema, fold {property,value,unit,condition} into
//       a table shaped like a generated one, and score it with the IDENTICAL
//       table_fidelity eval + capacity metric.
// Then it reports fidelity + misattribution (D1) + fabrication (D2/D4) + a
// GROUNDING axis unique to LangExtract (char_offset precision → chunk mapping,
// D3) and prints a pre-defined gate verdict.
//
// Fairness (updated criteria, overrides plan wording): the baseline is graded
// with REDOU_E2E_METRIC default = "capacity" — the same scope the 88.6% baseline
// uses. Both sides are graded through evaluateTableFidelityFixture with the same
// GRADING_OPTIONS, so the comparison is metric-for-metric on the same golden cells.
//
// Config mirrors e2e-table-fidelity.mjs; override via env:
//   REDOU_E2E_OWNER_ID, REDOU_E2E_PAPER_IDS (comma-separated; first 2 SHOULD be
//   the fixture papers), REDOU_E2E_QUERY, REDOU_E2E_METRIC (default capacity),
//   REDOU_E2E_SCOPE, REDOU_LANGEXTRACT_URL, REDOU_LANGEXTRACT_MODEL.
//   REDOU_AB_SKIP_BASELINE=1 runs only side (b) (skip the slow real pipeline when
//   the baseline is already recorded — the gate then reuses BASELINE_FIDELITY).
//   REDOU_AB_BASELINE_FIDELITY overrides the recorded baseline (default 0.886).
//
// Usage (from apps/desktop):
//   node scripts/ab-langextract.mjs
//   REDOU_AB_SKIP_BASELINE=1 node scripts/ab-langextract.mjs   # only LangExtract side
// ============================================================================
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { createChatStatusEmitter } from "../electron/chat/status-events.mjs";
import { runTableConversationPipeline } from "../electron/chat/table-pipeline.mjs";
import { createMultiQueryRag } from "../electron/rag/multi-query-rag.mjs";
import { parseAllHtmlTables } from "../electron/html-table-parser.mjs";
import { checkGroundedness, getActiveModel } from "../electron/llm-chat.mjs";
import {
  generateOrchestratorPlan,
  generateTableFromSpec,
  extractMatrixFromHtml,
  extractColumnsFromPaper,
  extractNullCellsFromPaper,
} from "../electron/llm-orchestrator.mjs";
import {
  loadFidelityGroundTruth,
  evaluateTableFidelityFixture,
} from "../tests/integration/support/eval-runner.mjs";
import {
  isLangExtractAvailable,
  extractLangExtract,
  buildChunkSpans,
  mapOffsetToChunk,
  ADSORPTION_PROMPT_DESCRIPTION,
  ADSORPTION_EXAMPLES,
} from "../electron/langextract-client.mjs";

// ---- config (real data observed in dev DB; override via env; mirrors e2e) ----
const OWNER_ID = process.env.REDOU_E2E_OWNER_ID ?? "615fb4db-be0e-49e5-b634-05969fa71aa4";
const PAPER_IDS = (process.env.REDOU_E2E_PAPER_IDS ?? [
  "7536d494-e3a3-473c-b992-43cc18b56a4e", // CO2/CH4/CO/N2 on KOH-treated activated carbon (fixture)
  "5e0f399d-8996-4387-9200-2dafa58658bc", // ethane/ethylene on zeolite 13X (fixture)
].join(",")).split(",").map((id) => id.trim()).filter(Boolean);
const QUERY = process.env.REDOU_E2E_QUERY
  ?? "각 논문의 흡착제와 흡착 용량(q_max), 온도 조건을 비교 테이블로 정리해줘";
const GROUND_TRUTH_FIXTURE = "adsorption-groundtruth-v0.json";

// Metric scope — DEFAULT capacity (same as e2e-table-fidelity.mjs and the 88.6%
// baseline). "all" disables the filter; empty falls back to capacity.
const METRIC_RAW = (process.env.REDOU_E2E_METRIC ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const METRIC = METRIC_RAW.length === 0 ? ["capacity"] : METRIC_RAW;
const METRIC_FILTER_OFF = METRIC.length === 1 && METRIC[0].toLowerCase() === "all";
const SCOPE = (process.env.REDOU_E2E_SCOPE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const GRADING_OPTIONS = {
  ...(SCOPE.length ? { scope: SCOPE } : {}),
  ...(METRIC_FILTER_OFF ? {} : { metric: METRIC }),
};
const METRIC_LABEL = METRIC_FILTER_OFF ? "all (filter off)" : METRIC.join(",");

// The recorded fair baseline (updated criteria): in-scope capacity median 88.6%
// (RUNS=3, gemma4:31b). Used by the gate when the baseline side is skipped.
const BASELINE_FIDELITY = Number(process.env.REDOU_AB_BASELINE_FIDELITY ?? 0.886);
const SKIP_BASELINE = process.env.REDOU_AB_SKIP_BASELINE === "1";

const SUPABASE_URL = process.env.REDOU_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SUPABASE_SERVICE_KEY = process.env.REDOU_SUPABASE_SERVICE_KEY ?? "";
if (!SUPABASE_SERVICE_KEY) { console.error("FATAL: REDOU_SUPABASE_SERVICE_KEY missing (.env)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const pct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);

// ---- helpers copied from e2e-table-fidelity.mjs (not exported in main.mjs) ----
function unwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
}
function intersectPaperIds(basePaperIds, scopedPaperIds) {
  const allowed = new Set(basePaperIds);
  return scopedPaperIds.filter((paperId) => allowed.has(paperId));
}
async function loadSourceFileMetadataMap(sourceFileIds) {
  const ids = [...new Set((sourceFileIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("paper_files")
    .select("id, file_kind, original_filename, stored_filename")
    .in("id", ids);
  if (error) { console.error("[AB] source file metadata lookup error:", error.message); return new Map(); }
  return new Map((data ?? []).map((file) => [file.id, {
    source_file_kind: file.file_kind,
    source_filename: file.original_filename || file.stored_filename || "",
  }]));
}
async function getPaperIdsInFolderTree() { return []; }

// ---------------------------------------------------------------------------
// (a) CURRENT Stage 3b — the real table pipeline, scored by table_fidelity.
// This is a faithful clone of one e2e-table-fidelity.mjs run: same wiring, same
// grading options (capacity metric), so the number IS the fair baseline.
// ---------------------------------------------------------------------------
async function runCurrentStage3b() {
  const conv = unwrapSingle(await supabase
    .from("chat_conversations")
    .insert({
      owner_user_id: OWNER_ID,
      title: "[AB-langextract-baseline] " + new Date().toISOString().slice(0, 16),
      phase: "follow_up",
      scope_folder_id: null,
      scope_all: true,
      conversation_type: "table",
    })
    .select("id").single(), "conversation insert");
  const convId = conv.id;
  console.log(`${ts()} [A/current] conversation: ${convId}`);

  unwrapSingle(await supabase
    .from("chat_messages")
    .insert({ conversation_id: convId, role: "user", content: QUERY, message_type: "text" })
    .select("id").single(), "user message insert");

  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content, message_type")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  const history = (historyRows ?? []).map((m) => ({ role: m.role, content: m.content, message_type: m.message_type }));

  const abortController = new AbortController();
  let verificationResolve;
  const verificationDone = new Promise((res) => { verificationResolve = res; });
  const emitStatus = createChatStatusEmitter({
    conversationId: convId,
    send: (channel, payload) => {
      if (channel === "chat:status") console.log(`${ts()} [STATUS] stage=${payload.stage ?? "null"} ${payload.message ?? ""}`);
    },
  });
  const { runMultiQueryRag, runPaperScopedRecoverySearch } = createMultiQueryRag({ supabase });

  console.log(`${ts()} [A/current] running real table pipeline (${PAPER_IDS.length} papers, real LLM)...`);
  const outcome = await runTableConversationPipeline({
    supabase,
    emitStatus,
    emitToken: () => {},
    emitComplete: () => {},
    emitVerificationDone: (payload) => verificationResolve(payload),
    abortSignal: abortController.signal,
    conversationId: convId,
    ownerId: OWNER_ID,
    ownerPaperIds: PAPER_IDS,
    scopeFolderId: null,
    scopeAll: true,
    history,
    generateOrchestratorPlanFn: generateOrchestratorPlan,
    runMultiQueryRagFn: runMultiQueryRag,
    getPaperIdsInFolderTreeFn: getPaperIdsInFolderTree,
    intersectPaperIdsFn: intersectPaperIds,
    loadSourceFileMetadataMapFn: loadSourceFileMetadataMap,
    parseAllHtmlTablesFn: parseAllHtmlTables,
    extractMatrixFromHtmlFn: extractMatrixFromHtml,
    extractColumnsFromPaperFn: extractColumnsFromPaper,
    generateTableFromSpecFn: generateTableFromSpec,
    runPaperScopedRecoverySearchFn: runPaperScopedRecoverySearch,
    extractNullCellsFromPaperFn: extractNullCellsFromPaper,
    checkGroundednessFn: checkGroundedness,
    unwrapSingleFn: unwrapSingle,
  });

  if (!outcome || outcome.hasTable === false) {
    verificationResolve(null);
    console.log(`${ts()} [A/current] CLARIFY — no table (excluded, not a failure). cleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
    return { outcome: "clarify", convId };
  }

  const { data: tables } = await supabase
    .from("chat_generated_tables")
    .select("table_title, headers, rows, metadata, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false });
  if (!tables || tables.length === 0) {
    verificationResolve(null);
    throw new Error("hasTable:true but no table persisted");
  }
  const tbl = tables[0];
  const table = {
    table_title: tbl.table_title,
    headers: Array.isArray(tbl.headers) ? tbl.headers : JSON.parse(tbl.headers ?? "[]"),
    rows: Array.isArray(tbl.rows) ? tbl.rows : JSON.parse(tbl.rows ?? "[]"),
    metadata: tbl.metadata ?? {},
  };
  // Give async Guardian verification a moment (non-fatal), then score.
  await Promise.race([verificationDone, new Promise((res) => setTimeout(() => res("TIMEOUT"), 60000))]);

  const groundTruth = await loadFidelityGroundTruth(GROUND_TRUTH_FIXTURE);
  const result = evaluateTableFidelityFixture(groundTruth, () => table, GRADING_OPTIONS);
  console.log(`${ts()} [A/current] fidelity ${pct(result.overall.fidelity)} (${result.overall.matched}/${result.overall.total}) misattr ${result.overall.misattribution} fab ${result.overall.fabrication}`);
  console.log(`${ts()} [A/current] cleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
  return { outcome: "fidelity", convId, fidelity: result.overall.fidelity, result };
}

// ---------------------------------------------------------------------------
// (b) LangExtract Stage 3b — load paper text, /extract, fold into a table, score.
// ---------------------------------------------------------------------------

// Load a paper's text material: body chunks (with char offsets) + OCR table HTML.
// The chunks feed LangExtract and provide the grounding coordinate system; the
// table HTML (as text) carries the actual isotherm-parameter numbers.
async function loadPaperText(paperId) {
  const { data: chunkRows } = await supabase
    .from("paper_chunks")
    .select("chunk_order, text, start_char_offset, page")
    .eq("paper_id", paperId)
    .order("chunk_order", { ascending: true });
  const chunks = (chunkRows ?? []).map((c) => ({
    chunkOrder: c.chunk_order,
    text: String(c.text ?? ""),
    startCharOffset: c.start_char_offset ?? 0,
    page: c.page ?? null,
  }));

  const { data: tableRows } = await supabase
    .from("figures")
    .select("figure_no, summary_text, page")
    .eq("paper_id", paperId)
    .eq("item_type", "table");
  // Flatten each table's HTML to a compact text block so LangExtract sees the
  // grid values (the parameter numbers live here, not in body prose).
  const tableTexts = (tableRows ?? [])
    .filter((r) => r.summary_text)
    .map((r) => {
      const grids = parseAllHtmlTables(r.summary_text);
      const lines = [];
      for (const g of grids) {
        if (g.headers?.length) lines.push(g.headers.join(" | "));
        for (const row of g.rows ?? []) lines.push((Array.isArray(row) ? row : [row]).join(" | "));
      }
      return `[${r.figure_no || "Table"}]\n${lines.join("\n")}`;
    });

  return { chunks, tableTexts };
}

const norm = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

// Fold LangExtract extractions into a generated-table shape the fidelity scorer
// understands. The fixture matches on: identity tokens (substring in the row) +
// a value in the target column + the condition present on the row/cellTuple.
// LangExtract gives {property, value, unit, condition} where condition carries
// the adsorbent/gas/temperature/pressure-range set — exactly the identity+qualifier
// the fixture needs. So each extraction becomes one row:
//   [ <condition (identity + qualifier)>, <value in the "property" column> ]
// with the condition also on the cellTuple (so rowCarriesCondition passes). The
// property name is the column header; the scorer's columnAliasKey folds q_m/qm/etc.
function foldExtractionsIntoTable(extractions) {
  // Distinct property names become columns (plus a leading identity column).
  const propColumns = [...new Set(extractions.map((e) => norm(e.property)).filter(Boolean))];
  const headers = ["항목(조건)", ...propColumns];
  const colIndexByProp = new Map(propColumns.map((p, i) => [p, i + 1]));

  const rows = [];
  const cellTuples = [];
  for (const e of extractions) {
    const prop = norm(e.property);
    const value = norm(e.value);
    if (!prop || !value) continue;
    const colIndex = colIndexByProp.get(prop);
    if (colIndex == null) continue;
    const condition = norm(e.condition);
    const row = headers.map(() => "N/A");
    row[0] = condition || e.extractionText || "";
    row[colIndex] = value;
    const tupleRow = headers.map(() => null);
    // The condition tuple on the value cell is what rowCarriesCondition reads.
    if (condition) tupleRow[colIndex] = { condition, unit: norm(e.unit) || undefined };
    rows.push(row);
    cellTuples.push(tupleRow);
  }
  return { table_title: "LangExtract 추출", headers, rows, metadata: { cellTuples } };
}

async function runLangExtractStage3b() {
  const groundTruth = await loadFidelityGroundTruth(GROUND_TRUTH_FIXTURE);
  const model = process.env.REDOU_LANGEXTRACT_MODEL || undefined;

  // One merged table across all papers (mirrors how the fixture is scored: one
  // table applied to each paper block). Extract per paper, concatenate rows.
  const allExtractions = [];
  const grounding = { total: 0, withOffset: 0, mappedToChunk: 0, byPaper: [] };
  let serverMs = 0;

  for (const paperId of PAPER_IDS) {
    const { chunks, tableTexts } = await loadPaperText(paperId);
    // Build the submission text = OCR table blocks first (the numbers), then body
    // chunks, so char offsets map back to a known coordinate system for grounding.
    const { text: chunkText, spans } = buildChunkSpans(chunks, "\n\n");
    const tablePrefix = tableTexts.join("\n\n");
    const submission = tablePrefix ? `${tablePrefix}\n\n${chunkText}` : chunkText;
    // Chunk spans are offset by the table prefix length in the submission string.
    const prefixLen = tablePrefix ? tablePrefix.length + 2 : 0;
    const shiftedSpans = spans.map((s) => ({ ...s, absStart: s.absStart + prefixLen, absEnd: s.absEnd + prefixLen }));

    console.log(`${ts()} [B/langextract] paper ${paperId}: ${chunks.length} chunks, ${tableTexts.length} tables, ${submission.length} chars → /extract`);
    let res;
    try {
      res = await extractLangExtract(submission, {
        promptDescription: ADSORPTION_PROMPT_DESCRIPTION,
        examples: ADSORPTION_EXAMPLES,
        modelId: model,
        maxCharBuffer: 6000,
        extractionPasses: 1,
      });
    } catch (err) {
      console.error(`${ts()} [B/langextract] paper ${paperId} FAILED: ${err.message}`);
      continue;
    }
    serverMs += res.serverProcessingTime;

    // Grounding: how many extractions carry a char offset, and how many of those
    // resolve to an actual chunk (D3 provenance — the current pipeline has neither).
    let mapped = 0;
    for (const e of res.extractions) {
      grounding.total += 1;
      if (e.charStart != null) {
        grounding.withOffset += 1;
        const { chunkOrder } = mapOffsetToChunk(e.charStart, shiftedSpans);
        if (chunkOrder != null) { mapped += 1; grounding.mappedToChunk += 1; }
      }
    }
    grounding.byPaper.push({
      paperId,
      extractions: res.extractions.length,
      withOffset: res.extractions.filter((e) => e.charStart != null).length,
      mappedToChunk: mapped,
      model: res.modelId,
      version: res.langextractVersion,
    });
    console.log(`${ts()} [B/langextract] paper ${paperId}: ${res.extractions.length} extractions, ${res.groundedExtractions} with offset, ${mapped} mapped→chunk (${res.langextractVersion}, ${res.modelId})`);

    allExtractions.push(...res.extractions);
  }

  const table = foldExtractionsIntoTable(allExtractions);
  const result = evaluateTableFidelityFixture(groundTruth, () => table, GRADING_OPTIONS);
  console.log(`${ts()} [B/langextract] folded ${allExtractions.length} extractions → ${table.rows.length} rows, ${table.headers.length} cols`);
  console.log(`${ts()} [B/langextract] fidelity ${pct(result.overall.fidelity)} (${result.overall.matched}/${result.overall.total}) misattr ${result.overall.misattribution} fab ${result.overall.fabrication}`);
  return { fidelity: result.overall.fidelity, result, grounding, serverMs, extractionCount: allExtractions.length };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`LangExtract vs current Stage 3b — extraction A/B (${PAPER_IDS.length} papers)`);
  console.log(`${ts()} LLM(baseline)=${getActiveModel()}  LangExtract=${process.env.REDOU_LANGEXTRACT_URL || "http://localhost:8012"}  metric=${METRIC_LABEL}${SCOPE.length ? ` scope=${SCOPE.join(",")}` : ""}`);

  const leUp = await isLangExtractAvailable();
  console.log(`${ts()} health: LangExtract ${leUp ? "UP" : "DOWN"}`);
  if (!leUp) { console.error("FATAL: LangExtract sidecar not reachable (build+run compose.langextract.yaml first)"); process.exit(1); }

  // (a) current Stage 3b baseline (skippable when already recorded).
  let baselineFidelity = BASELINE_FIDELITY;
  let baselineSource = `recorded ${pct(BASELINE_FIDELITY)}`;
  const cleanupIds = [];
  if (!SKIP_BASELINE) {
    try {
      const a = await runCurrentStage3b();
      if (a.convId) cleanupIds.push(a.convId);
      if (a.outcome === "fidelity") { baselineFidelity = a.fidelity; baselineSource = `measured ${pct(a.fidelity)} this run`; }
      else console.log(`${ts()} [A/current] clarified — using recorded baseline ${pct(BASELINE_FIDELITY)} for the gate`);
    } catch (err) {
      console.error(`${ts()} [A/current] baseline run failed (${err.message}) — using recorded baseline ${pct(BASELINE_FIDELITY)}`);
    }
  } else {
    console.log(`${ts()} [A/current] skipped (REDOU_AB_SKIP_BASELINE=1) — gate uses recorded baseline ${pct(BASELINE_FIDELITY)}`);
  }

  // (b) LangExtract Stage 3b.
  const b = await runLangExtractStage3b();

  // ---- report + pre-defined gate ----
  const groundOfOffset = b.grounding.withOffset === 0 ? null : b.grounding.mappedToChunk / b.grounding.withOffset;
  const offsetRate = b.grounding.total === 0 ? null : b.grounding.withOffset / b.grounding.total;

  console.log(`\n===== A/B SUMMARY (${PAPER_IDS.length} papers, metric=${METRIC_LABEL}) =====`);
  console.log(`fidelity:  current ${pct(baselineFidelity)} (${baselineSource})  |  LangExtract ${pct(b.fidelity)}`);
  console.log(`misattr:   LangExtract ${b.result.overall.misattribution}   |   fabrication: LangExtract ${b.result.overall.fabrication}`);
  console.log(`grounding: ${b.grounding.total} extractions, ${b.grounding.withOffset} with char_offset (${pct(offsetRate)}), ${b.grounding.mappedToChunk} mapped→chunk (${pct(groundOfOffset)} of offset-carrying)`);
  console.log(`           [current pipeline carries source_hint STRINGS only — no char offset; grounding advantage is LangExtract-only by construction]`);
  console.log(`server time: LangExtract ${(b.serverMs / 1000).toFixed(1)}s (Ollama backend)`);
  for (const p of b.grounding.byPaper) {
    console.log(`  - ${p.paperId}: ${p.extractions} extr, ${p.withOffset} offset, ${p.mappedToChunk} →chunk  (${p.version}/${p.model})`);
  }

  // Pre-defined gate (plan slice 04 step 4, updated criteria):
  //   ADVANCE to slice 05 iff LangExtract is NOT MATERIALLY WORSE on fidelity
  //   (>= baseline - 5%p, run-to-run noise band) AND its char_offset grounding is
  //   actually usable (a real fraction of extractions carry an offset that maps to
  //   a chunk — the D3 provenance ADVANTAGE). Otherwise HOLD (keep SRAG + cell tuples).
  const FIDELITY_BAND = 0.05;
  const fidelityNotWorse = b.fidelity >= baselineFidelity - FIDELITY_BAND;
  const GROUNDING_USABLE_MIN = 0.5; // >=50% of offset-carrying extractions map to a chunk
  const groundingUsable = offsetRate != null && offsetRate > 0
    && groundOfOffset != null && groundOfOffset >= GROUNDING_USABLE_MIN;

  console.log(`\n===== GATE (pre-defined, slice 04 step 4) =====`);
  console.log(`fidelity not materially worse (>= ${pct(baselineFidelity - FIDELITY_BAND)}): ${fidelityNotWorse ? "yes" : "NO"}  (LangExtract ${pct(b.fidelity)} vs baseline ${pct(baselineFidelity)})`);
  console.log(`grounding usable (offset present AND >=${pct(GROUNDING_USABLE_MIN)} of offsets map to a chunk): ${groundingUsable ? "yes" : "NO"}`);
  const advance = fidelityNotWorse && groundingUsable;
  console.log(`VERDICT: ${advance ? "PASS → proceed to slice 05 (LangExtract adoption)" : "HOLD → keep current SRAG + cell tuples (fidelity regressed or grounding not usable)"}`);
  console.log(`\nNOTE: gate math is a first cut. Grounding is the DECIDING axis (fidelity parity is the floor). Eyeball a few mapped offsets to confirm they land on the right source span before recording the final call in completed/04. A LangExtract fidelity that clarifies/underperforms with usable grounding is still informative — record WHY (schema quality, Ollama backend behavior, chunk coverage).`);
  if (cleanupIds.length) console.log(`\ncleanup: DELETE FROM chat_conversations WHERE id IN (${cleanupIds.map((id) => `'${id}'`).join(", ")});`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${ts()} FATAL:`, err);
  process.exit(1);
});
