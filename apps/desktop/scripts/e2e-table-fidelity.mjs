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
// Usage (from apps/desktop):
//   node scripts/e2e-table-fidelity.mjs
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

async function main() {
  console.log(`${ts()} [E2E] LLM model: ${getActiveModel()}`);
  const conv = unwrapSingle(await supabase
    .from("chat_conversations")
    .insert({
      owner_user_id: OWNER_ID,
      title: "[E2E-fidelity] " + new Date().toISOString().slice(0, 16),
      phase: "follow_up",
      scope_folder_id: null,
      scope_all: true,
      conversation_type: "table",
    })
    .select("id")
    .single(), "conversation insert");
  const convId = conv.id;
  console.log(`${ts()} [E2E] conversation: ${convId}`);

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

  console.log(`${ts()} [E2E] running table pipeline (${PAPER_IDS.length} papers, real LLM)...`);
  await runTableConversationPipeline({
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

  const { data: tables, error: tblErr } = await supabase
    .from("chat_generated_tables")
    .select("id, table_title, headers, rows, source_refs, metadata, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false });
  if (tblErr) { console.error(`${ts()} [E2E] table query error:`, tblErr.message); process.exit(1); }
  if (!tables || tables.length === 0) {
    console.error(`${ts()} [E2E] FAIL: no generated table persisted`);
    console.log(`[E2E] cleanup: DELETE FROM chat_conversations WHERE id='${convId}';`);
    process.exit(1);
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
  // scored against each paper's ground-truth block.
  const groundTruth = await loadFidelityGroundTruth(GROUND_TRUTH_FIXTURE);
  const result = evaluateTableFidelityFixture(groundTruth, () => table);

  console.log(`\n===== TABLE FIDELITY REPORT =====`);
  console.log(`fixture: ${result.fixture} (${result.schemaVersion})`);
  console.log(`overall fidelity: ${(result.overall.fidelity * 100).toFixed(1)}% (${result.overall.matched}/${result.overall.total})`);
  console.log(`overall misattribution: ${result.overall.misattribution} | fabrication: ${result.overall.fabrication}`);
  for (const report of result.reports) {
    console.log(`\n-- ${report.paperId}`);
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
  process.exit(0);
}

main().catch((err) => {
  console.error(`${ts()} [E2E] FATAL:`, err);
  process.exit(1);
});
