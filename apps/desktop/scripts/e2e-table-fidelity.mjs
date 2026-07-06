// ============================================================================
// Manual E2E — NOT run in CI. Requires live Supabase (55321) + Ollama (11434)
// + vLLM (8100) and real imported papers. One run takes many minutes.
//
// Drives the real table-generation pipeline (runTableConversationPipeline)
// without Electron — mirrors main.mjs CHAT_SEND_MESSAGE wiring — then scores the
// persisted table against the hand-verified ground-truth fixture with the
// table_fidelity eval. Prints a fidelity / misattribution / fabrication /
// conflictHandling report. Use it to record a current score before/after
// extraction or A-B changes (Phase 3 docling/LangExtract judge).
//
// Config (owner id, paper ids, query) is a top block below; override via env:
//   REDOU_E2E_OWNER_ID, REDOU_E2E_PAPER_IDS (comma-separated), REDOU_E2E_QUERY.
//
// Measurement protocol env (slice 07):
//   REDOU_E2E_RUNS   number of pipeline runs (default 1, recommended 3). Runs the
//                    pipeline N times (a fresh conversation each) and reports the
//                    MEDIAN overall fidelity + min/max/spread — the local LLM
//                    varies ~23%p run-to-run, so a single run can't judge a change.
//   REDOU_E2E_SCOPE  optional scope label (e.g. "low_pressure" or "full_range",
//                    comma-separated for several). When the query targets one
//                    scenario (e.g. "low pressure only"), the fidelity is graded
//                    against just that subset of golden cells (see the fixture's
//                    scopeVocabulary), avoiding an unfair penalty from cells the
//                    query never asked for.
//   REDOU_E2E_METRIC optional metric label, comma-separated (see the fixture's
//                    metricVocabulary: "capacity" = q_m saturation capacity,
//                    "accuracy" = MAPE error). Independent axis from scope, ANDed
//                    with it. DEFAULT: "capacity" (slice 12) — the default query
//                    asks for adsorption capacity, so the MAPE (accuracy) golden
//                    cells it never requested are excluded and stop counting as
//                    missing. To opt back into MAPE grading set
//                    REDOU_E2E_METRIC=accuracy (or capacity,accuracy). Set
//                    REDOU_E2E_METRIC=all to grade EVERY metric (no metric filter)
//                    — this is how the pre-slice-12 whole-fixture score is produced.
//                    (Note: an empty value falls back to the "capacity" default, so
//                    use "all" to explicitly disable the filter.)
//
// A run that ends in clarify / no-data (the pipeline returns hasTable:false and
// persists an assistant message instead of a table) is reported as [CLARIFY],
// NOT a failure: it is "not measurable", not "0% fidelity", so it is excluded
// from the fidelity sample. If every run clarifies, the script still exits 0.
//
// Usage (from apps/desktop):
//   node scripts/e2e-table-fidelity.mjs                                   # metric defaults to capacity
//   REDOU_E2E_RUNS=3 node scripts/e2e-table-fidelity.mjs
//   REDOU_E2E_RUNS=3 REDOU_E2E_SCOPE=low_pressure node scripts/e2e-table-fidelity.mjs
//   REDOU_E2E_RUNS=3 REDOU_E2E_METRIC=accuracy node scripts/e2e-table-fidelity.mjs  # grade MAPE
//   REDOU_E2E_RUNS=3 REDOU_E2E_METRIC=all node scripts/e2e-table-fidelity.mjs       # whole-fixture (pre-slice-12)
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

// ---- config (real data observed in dev DB; override via env) ----
const OWNER_ID = process.env.REDOU_E2E_OWNER_ID ?? "615fb4db-be0e-49e5-b634-05969fa71aa4";
const PAPER_IDS = (process.env.REDOU_E2E_PAPER_IDS ?? [
  "7536d494-e3a3-473c-b992-43cc18b56a4e", // CO2/CH4/CO/N2 on KOH-treated activated carbon
  "5e0f399d-8996-4387-9200-2dafa58658bc", // ethane/ethylene on zeolite 13X
].join(",")).split(",").map((id) => id.trim()).filter(Boolean);
const QUERY = process.env.REDOU_E2E_QUERY
  ?? "각 논문의 흡착제와 흡착 용량(q_max), 온도 조건을 비교 테이블로 정리해줘";
const GROUND_TRUTH_FIXTURE = "adsorption-groundtruth-v0.json";

// Measurement protocol (slice 07): N runs -> median fidelity; optional scope
// restricts grading to a golden-cell subset when the query targets one scenario.
const RUNS = Math.max(1, parseInt(process.env.REDOU_E2E_RUNS ?? "1", 10) || 1);
const SCOPE = (process.env.REDOU_E2E_SCOPE ?? "")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const SCOPE_OPTION = SCOPE.length > 0 ? { scope: SCOPE } : {};

// Metric axis (slice 12): the default query asks for adsorption CAPACITY (q_m), so
// the accuracy (MAPE) golden cells it never requested must NOT count as missing.
// Parsed like SCOPE (comma-separated) but DEFAULTS to "capacity" when unset — the
// scorer ANDs metric with scope, so a capacity-only default excludes MAPE cells.
// Escape hatches: REDOU_E2E_METRIC=all disables the metric filter (whole-fixture,
// pre-slice-12 behavior); an empty value is treated as "unset" and falls back to
// the capacity default (so "" and "all" are distinct — "" keeps the filter).
const METRIC_RAW = (process.env.REDOU_E2E_METRIC ?? "")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const METRIC = METRIC_RAW.length === 0 ? ["capacity"] : METRIC_RAW;
// "all" => grade every metric (no filter). Otherwise pass the requested labels.
const METRIC_FILTER_OFF = METRIC.length === 1 && METRIC[0].toLowerCase() === "all";
const METRIC_OPTION = METRIC_FILTER_OFF ? {} : { metric: METRIC };

// Combined grading options handed to the fidelity scorer: scope and metric are
// independent axes ANDed inside evaluateTableFidelityFixture.
const GRADING_OPTIONS = { ...SCOPE_OPTION, ...METRIC_OPTION };
const METRIC_LABEL = METRIC_FILTER_OFF ? "all (filter off)" : METRIC.join(",");

const SUPABASE_URL = process.env.REDOU_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SUPABASE_SERVICE_KEY = process.env.REDOU_SUPABASE_SERVICE_KEY ?? "";
if (!SUPABASE_SERVICE_KEY) { console.error("FATAL: REDOU_SUPABASE_SERVICE_KEY missing (.env)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// ---- helpers copied from main.mjs (not exported there) ----
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
  if (error) { console.error("[E2E] source file metadata lookup error:", error.message); return new Map(); }
  return new Map((data ?? []).map((file) => [file.id, {
    source_file_kind: file.file_kind,
    source_filename: file.original_filename || file.stored_filename || "",
  }]));
}
async function getPaperIdsInFolderTree() {
  console.warn(`${ts()} [E2E] getPaperIdsInFolderTree called unexpectedly (scope_all test) — returning []`);
  return [];
}

// Median of a numeric sample. For an even count we take the LOWER middle
// (conservative) so a fidelity median is never inflated above an observed run.
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid];
}

// One pipeline run against a fresh conversation. Returns a structured outcome so
// main() can collect a median over N runs and treat clarify as "not measurable"
// rather than a failure. Does NOT call process.exit (main owns the exit code).
async function runOnce(runIndex) {
  const runLabel = RUNS > 1 ? ` run ${runIndex}/${RUNS}` : "";
  const conv = unwrapSingle(await supabase
    .from("chat_conversations")
    .insert({
      owner_user_id: OWNER_ID,
      title: "[E2E-fidelity" + runLabel + "] " + new Date().toISOString().slice(0, 16),
      phase: "follow_up",
      scope_folder_id: null,
      scope_all: true,
      conversation_type: "table",
    })
    .select("id")
    .single(), "conversation insert");
  const convId = conv.id;
  console.log(`${ts()} [E2E]${runLabel} conversation: ${convId}`);

  unwrapSingle(await supabase
    .from("chat_messages")
    .insert({ conversation_id: convId, role: "user", content: QUERY, message_type: "text" })
    .select("id")
    .single(), "user message insert");

  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content, message_type")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });
  const history = (historyRows ?? []).map((m) => ({ role: m.role, content: m.content, message_type: m.message_type }));

  const abortController = new AbortController();
  let verificationResolve;
  const verificationDone = new Promise((res) => { verificationResolve = res; });

  const send = (channel, payload) => {
    if (channel === "chat:status") {
      console.log(`${ts()} [STATUS] stage=${payload.stage ?? "null"} ${payload.message ?? ""}`);
    }
  };
  const emitStatus = createChatStatusEmitter({ conversationId: convId, send });
  const { runMultiQueryRag, runPaperScopedRecoverySearch } = createMultiQueryRag({ supabase });

  console.log(`${ts()} [E2E]${runLabel} running table pipeline (${PAPER_IDS.length} papers, real LLM)...`);
  const outcome = await runTableConversationPipeline({
    supabase,
    emitStatus,
    emitToken: () => {},
    emitComplete: (payload) => console.log(`${ts()} [COMPLETE] ${JSON.stringify(payload).slice(0, 200)}`),
    emitVerificationDone: (payload) => { verificationResolve(payload); },
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

  // Clarify / no-data: the pipeline persisted an assistant message instead of a
  // table (hasTable:false). This is a legitimate app response (library-scope
  // clarification), not a fidelity failure — report it and exclude it from the
  // fidelity sample. resolve the verification promise so nothing hangs.
  if (!outcome || outcome.hasTable === false) {
    verificationResolve(null);
    let clarifyMsg = "";
    if (outcome?.messageId) {
      const { data: msgRow } = await supabase
        .from("chat_messages")
        .select("content")
        .eq("id", outcome.messageId)
        .limit(1);
      clarifyMsg = msgRow?.[0]?.content ?? "";
    }
    console.log(`\n${ts()} [CLARIFY]${runLabel} no table generated (hasTable:false) — excluded from fidelity sample.`);
    if (clarifyMsg) console.log(`   message: ${clarifyMsg.slice(0, 200).replace(/\s+/g, " ")}`);
    console.log(`   cleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
    return { outcome: "clarify", convId, message: clarifyMsg };
  }

  const { data: tables, error: tblErr } = await supabase
    .from("chat_generated_tables")
    .select("id, table_title, headers, rows, source_refs, metadata, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false });
  if (tblErr) {
    verificationResolve(null);
    console.error(`${ts()} [E2E] table query error:`, tblErr.message);
    throw new Error(`table query failed: ${tblErr.message}`);
  }
  if (!tables || tables.length === 0) {
    // hasTable was true but nothing is persisted — a genuine defect, not clarify.
    verificationResolve(null);
    console.error(`${ts()} [E2E] FAIL: hasTable:true but no generated table persisted`);
    console.log(`[E2E] cleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
    throw new Error("hasTable:true but no table persisted");
  }

  const tbl = tables[0];
  const table = {
    table_title: tbl.table_title,
    headers: Array.isArray(tbl.headers) ? tbl.headers : JSON.parse(tbl.headers ?? "[]"),
    rows: Array.isArray(tbl.rows) ? tbl.rows : JSON.parse(tbl.rows ?? "[]"),
    metadata: tbl.metadata ?? {},
  };

  // Wait briefly for async Guardian verification before scoring (non-fatal).
  const verificationOutcome = await Promise.race([
    verificationDone,
    new Promise((res) => setTimeout(() => res("TIMEOUT"), 180000)),
  ]);

  // Slice 02: report how each verified cell was decided — deterministic code
  // back-match vs Guardian (LLM). This is the "verifier author" distribution the
  // baseline tracks ("Guardian N/M verified"); a big code share means Stage 4 got
  // more deterministic without over-verifying.
  const verification = (verificationOutcome && verificationOutcome !== "TIMEOUT"
    ? verificationOutcome.verification
    : null) ?? [];
  const codeVerified = verification.filter((v) => v.status === "verified" && v.method === "code").length;
  const guardianVerified = verification.filter((v) => v.status === "verified" && v.method === "guardian").length;
  const guardianTotal = verification.filter((v) => v.method === "guardian").length;
  console.log(
    `${ts()} [VERIFY] ${verification.filter((v) => v.status === "verified").length}/${verification.length} verified` +
    ` (code back-match ${codeVerified} / Guardian ${guardianVerified}/${guardianTotal})`,
  );

  // ---- table_fidelity scoring against the hand-verified ground truth ----
  // All papers are asked for in one merged table, so the same persisted table is
  // scored against each paper's ground-truth block. GRADING_OPTIONS (scope AND
  // metric) grades only the golden-cell subset the query targeted — metric defaults
  // to capacity (slice 12) so the default capacity query is not penalized for the
  // MAPE accuracy cells it never asked for.
  const groundTruth = await loadFidelityGroundTruth(GROUND_TRUTH_FIXTURE);
  const result = evaluateTableFidelityFixture(groundTruth, () => table, GRADING_OPTIONS);

  console.log(`\n===== TABLE FIDELITY REPORT${runLabel} =====`);
  console.log(`fixture: ${result.fixture} (${result.schemaVersion})`);
  if (result.scope) console.log(`scope: ${result.scope.join(", ")} (grading golden subset)`);
  console.log(`metric: ${METRIC_LABEL} (grading golden subset)`);
  console.log(`overall fidelity: ${(result.overall.fidelity * 100).toFixed(1)}% (${result.overall.matched}/${result.overall.total})`);
  console.log(`overall misattribution: ${result.overall.misattribution} | fabrication: ${result.overall.fabrication}`);
  for (const report of result.reports) {
    const scopeNote = report.scoped?.applicable === false ? " [N/A: no in-scope golden cells]" : "";
    console.log(`\n-- ${report.paperId}${scopeNote}`);
    console.log(`   fidelity: ${(report.fidelity.score * 100).toFixed(1)}% (${report.fidelity.matched}/${report.fidelity.total})`);
    console.log(`   misattribution: ${report.misattribution.count} | fabrication: ${report.fabrication.count} | missing: ${report.missing.count}`);
    console.log(`   conflictHandling: ${report.conflictHandling.detected}/${report.conflictHandling.expected}`);
    if (report.misattribution.count) {
      console.log(`   misattributed: ${report.misattribution.cells.map((c) => `${c.identity.join("/")} ${c.column}=${c.value}@${c.condition}`).join("; ").slice(0, 300)}`);
    }
    if (report.fabrication.count) {
      console.log(`   fabricated: ${report.fabrication.cells.map((c) => `${c.column}=${c.value}`).join("; ").slice(0, 300)}`);
    }
  }
  console.log(`\ncleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
  return { outcome: "fidelity", convId, fidelity: result.overall.fidelity, result };
}

async function main() {
  console.log(`${ts()} [E2E] LLM model: ${getActiveModel()}`);
  console.log(`${ts()} [E2E] protocol: RUNS=${RUNS}${SCOPE.length ? ` SCOPE=${SCOPE.join(",")}` : ""} METRIC=${METRIC_LABEL}`);

  const fidelitySamples = [];
  let clarifyCount = 0;
  const cleanupIds = [];

  for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
    const runResult = await runOnce(runIndex);
    if (runResult?.convId) cleanupIds.push(runResult.convId);
    if (runResult?.outcome === "fidelity") {
      fidelitySamples.push(runResult.fidelity);
    } else {
      clarifyCount += 1;
    }
  }

  console.log(`\n===== PROTOCOL SUMMARY (RUNS=${RUNS}) =====`);
  if (SCOPE.length) console.log(`scope: ${SCOPE.join(", ")}`);
  console.log(`metric: ${METRIC_LABEL}`);
  console.log(`fidelity samples: ${fidelitySamples.length} | clarify/no-data: ${clarifyCount}`);

  if (fidelitySamples.length === 0) {
    // Every run clarified — a valid outcome (library-scope clarification), not a
    // failure. No fidelity number to report.
    console.log(`[CLARIFY] all ${RUNS} run(s) clarified — no fidelity sample. Not a failure.`);
    console.log(`cleanup: DELETE FROM chat_conversations WHERE id IN (${cleanupIds.map((id) => `'${id}'`).join(", ")});`);
    process.exit(0);
  }

  const med = median(fidelitySamples);
  const min = Math.min(...fidelitySamples);
  const max = Math.max(...fidelitySamples);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`median fidelity: ${pct(med)}  [min ${pct(min)} / max ${pct(max)} / spread ${((max - min) * 100).toFixed(1)}p]`);
  console.log(`per-run fidelity: ${fidelitySamples.map(pct).join(", ")}`);
  if (cleanupIds.length) {
    console.log(`cleanup: DELETE FROM chat_conversations WHERE id IN (${cleanupIds.map((id) => `'${id}'`).join(", ")});`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`${ts()} [E2E] FATAL:`, err);
  process.exit(1);
});
