// ============================================================================
// Manual A/B — NOT run in CI. Requires LIVE MinerU (8001) + docling sidecar
// (8011) + Supabase (55321, to resolve each paper's stored PDF path). No Ollama,
// no vLLM. Parses the SAME papers with both parsers and prints a 5-axis table
// comparison + a win/loss gate verdict (tool-ab-adoption slice 02).
//
// This is the docling side of the A/B. It does NOT touch the production import
// pipeline — it calls parsePdf (MinerU) and parsePdfDocling (docling) directly
// on the stored PDFs and compares TABLE PARSING only. The downstream table_gen /
// verification / fidelity-of-the-generated-table is the OTHER half of the gate
// and is measured separately by scripts/e2e-table-fidelity.mjs (same fixture,
// same 5 papers, same LLM) — this script wires the shared 43-cell fixture in as
// axis ① so the parser's raw table quality is on record here too.
//
// 5 axes (per plan slice 02):
//   ① table structure  — #rows/#cols per table + cell-text overlap between the
//                         two parsers, PLUS golden-fixture rediscovery: how many
//                         of the 43 hand-verified cell VALUES each parser's raw
//                         table cells contain (for the 2 fixture papers).
//   ② equation LaTeX    — equation count each + a few samples side by side.
//   ③ caption linking   — for each "Table N" the fixture/other parser expects,
//                         did the parser surface a table whose caption resolves
//                         to that same "Table N"? (figure_no match rate)
//   ④ cell bbox         — fraction of cells carrying a bbox (docling TableFormer
//                         gives per-cell bbox; MinerU gives table-level bbox only,
//                         so this axis is expected to favor docling by design).
//   ⑤ parse time        — wall-clock per paper, each parser.
//
// Gate verdict (pre-defined, plan slice 02 step 4): docling ADVANCES to slice 03
// iff it shows a CLEAR win on at least one of {table structure, cell bbox,
// caption linking} AND is not materially worse on golden-cell rediscovery
// (fidelity proxy). Otherwise HOLD (keep MinerU). The script prints the raw
// numbers and a computed PASS/HOLD, but the human records the final call in
// completed/02 (fixture covers only 2 of 5 papers → 3 are qualitative).
//
// Config (owner id, paper ids) mirrors e2e-table-fidelity.mjs; override via env:
//   REDOU_AB_OWNER_ID, REDOU_AB_PAPER_IDS (comma-separated, first 2 SHOULD be the
//   fixture papers so axis ① golden rediscovery has ground truth).
//
// Usage (from apps/desktop):
//   node scripts/ab-docling-tables.mjs
//   REDOU_AB_PAPER_IDS="id1,id2,id3,id4,id5" node scripts/ab-docling-tables.mjs
// Override targets: REDOU_MINERU_URL / REDOU_DOCLING_URL / REDOU_SUPABASE_URL.
// ============================================================================
import "dotenv/config";
import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { parsePdf, parseMineruResult, flattenTableHtml } from "../electron/mineru-client.mjs";
import { isMineruAvailable } from "../electron/mineru-client.mjs";
import { parsePdfDocling, isDoclingAvailable } from "../electron/docling-client.mjs";
import { parseHtmlTable } from "../electron/html-table-parser.mjs";
import { loadFidelityGroundTruth } from "../tests/integration/support/eval-runner.mjs";

// ---- config (real data observed in dev DB; override via env) ----
// First two are the golden-fixture papers (Table 3/4 hand-verified, 43 cells).
const OWNER_ID = process.env.REDOU_AB_OWNER_ID ?? "615fb4db-be0e-49e5-b634-05969fa71aa4";
const DEFAULT_PAPER_IDS = [
  "7536d494-e3a3-473c-b992-43cc18b56a4e", // CO2/CH4/CO/N2 on KOH-treated activated carbon (fixture)
  "5e0f399d-8996-4387-9200-2dafa58658bc", // ethane/ethylene on zeolite 13X (fixture)
];
const PAPER_IDS = (process.env.REDOU_AB_PAPER_IDS ?? DEFAULT_PAPER_IDS.join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);
const GROUND_TRUTH_FIXTURE = "adsorption-groundtruth-v0.json";

const SUPABASE_URL = process.env.REDOU_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SUPABASE_SERVICE_KEY = process.env.REDOU_SUPABASE_SERVICE_KEY ?? "";
if (!SUPABASE_SERVICE_KEY) { console.error("FATAL: REDOU_SUPABASE_SERVICE_KEY missing (.env)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// Normalization for cell-value comparison (kept in step with the fidelity eval:
// trim + collapse whitespace; numeric leniency only via exact-string on values).
// ---------------------------------------------------------------------------
function norm(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}
function normLower(v) {
  return norm(v).toLowerCase();
}

// ---- resolve stored PDF path for a paper (primary main_pdf) ----
async function resolveStoredPath(paperId) {
  const { data, error } = await supabase
    .from("paper_files")
    .select("stored_path, file_kind, is_primary")
    .eq("paper_id", paperId);
  if (error) throw new Error(`paper_files lookup: ${error.message}`);
  const files = data ?? [];
  const primary = files.find((f) => f.is_primary && f.file_kind === "main_pdf")
    ?? files.find((f) => f.is_primary)
    ?? files[0];
  if (!primary?.stored_path) throw new Error(`no stored PDF for paper ${paperId}`);
  return primary.stored_path;
}

// ---- MinerU: parse → flat cell-value set + table summaries ----
function mineruTables(parsed) {
  // parseMineruResult(...).tables carry { figureNo, caption, html, page }.
  return (parsed.tables ?? []).map((t) => {
    const grid = t.html ? parseHtmlTable(t.html) : { headers: [], rows: [], success: false };
    const rows = grid.rows ?? [];
    const numCols = grid.headers?.length || (rows[0]?.length ?? 0);
    const cellValues = [];
    for (const r of rows) for (const c of r) if (norm(c)) cellValues.push(norm(c));
    // header cells too (structure evidence)
    for (const h of grid.headers ?? []) if (norm(h)) cellValues.push(norm(h));
    return {
      figureNo: t.figureNo,
      caption: t.caption,
      page: t.page ?? null,
      numRows: rows.length,
      numCols,
      cellValues,
      cellsWithBbox: 0, // MinerU exposes table-level bbox only, not per-cell
      totalCells: rows.length * (numCols || 0),
    };
  });
}

// ---- docling: normalize → flat cell-value set + table summaries ----
function doclingTables(parsed) {
  return (parsed.tables ?? []).map((t) => {
    const cellValues = [];
    for (const c of t.cells ?? []) if (norm(c.text)) cellValues.push(norm(c.text));
    return {
      figureNo: t.figureNo,
      caption: t.caption,
      page: t.page ?? null,
      numRows: t.numRows,
      numCols: t.numCols,
      cellValues,
      cellsWithBbox: t.cellsWithBbox ?? (t.cells ?? []).filter((c) => c.bbox).length,
      totalCells: (t.cells ?? []).length,
    };
  });
}

// ---- axis ①b: golden 43-cell value rediscovery for a fixture paper ----
// How many hand-verified cell VALUES appear anywhere in this parser's raw table
// cells for the paper? This is the parser's ceiling — the LLM cannot extract a
// value the parser never surfaced.
function goldenRediscovery(paperTables, groundTruthCells) {
  const parserValues = new Set();
  for (const t of paperTables) for (const v of t.cellValues) parserValues.add(v);
  let found = 0;
  const missed = [];
  for (const cell of groundTruthCells) {
    const want = norm(cell.value);
    // exact value present as a standalone cell OR as a substring of some cell
    const hit = parserValues.has(want) || [...parserValues].some((pv) => pv.includes(want));
    if (hit) found += 1;
    else missed.push(`${cell.identity.join("/")} ${cell.column}=${cell.value}@${cell.condition ?? ""}`);
  }
  return { found, total: groundTruthCells.length, missed };
}

// ---- axis ①a: cross-parser cell-text overlap (Jaccard on value multisets) ----
function cellOverlap(aTables, bTables) {
  const aSet = new Set();
  const bSet = new Set();
  for (const t of aTables) for (const v of t.cellValues) aSet.add(normLower(v));
  for (const t of bTables) for (const v of t.cellValues) bSet.add(normLower(v));
  let inter = 0;
  for (const v of aSet) if (bSet.has(v)) inter += 1;
  const union = new Set([...aSet, ...bSet]).size;
  return { inter, union, aOnly: aSet.size - inter, bOnly: bSet.size - inter, jaccard: union === 0 ? 0 : inter / union };
}

// ---- axis ③: caption linking — do both parsers agree on the "Table N" set? ----
function captionRefs(tables) {
  const refs = new Set();
  for (const t of tables) {
    const m = /tab(?:le)?\.?\s*(\d+)/i.exec(t.figureNo) || /tab(?:le)?\.?\s*(\d+)/i.exec(t.caption ?? "");
    if (m) refs.add(`Table ${m[1]}`);
  }
  return refs;
}

async function analyzePaper(paperId, groundTruthByPaper) {
  const storedPath = await resolveStoredPath(paperId);
  const buffer = await fs.readFile(storedPath);
  console.log(`\n${ts()} [PAPER ${paperId}] ${storedPath.split(/[\\/]/).pop()} (${(buffer.length / 1024).toFixed(0)} KB)`);

  // MinerU 3.4 (live) — same call the production pipeline makes, but read-only.
  const mineruRaw = await parsePdf(buffer, { backend: "pipeline", lang: "en" });
  const mineruParsed = parseMineruResult(mineruRaw);
  const mTables = mineruTables(mineruParsed);
  const mEquations = mineruParsed.equations ?? [];

  // docling sidecar.
  const doclingRaw = await parsePdfDocling(buffer);
  const dTables = doclingTables(doclingRaw);
  const dEquations = doclingRaw.equations ?? [];

  const overlap = cellOverlap(mTables, dTables);
  const mRefs = captionRefs(mTables);
  const dRefs = captionRefs(dTables);
  const sharedRefs = [...mRefs].filter((r) => dRefs.has(r));

  const mBboxCells = mTables.reduce((s, t) => s + t.cellsWithBbox, 0);
  const mTotalCells = mTables.reduce((s, t) => s + t.totalCells, 0);
  const dBboxCells = dTables.reduce((s, t) => s + t.cellsWithBbox, 0);
  const dTotalCells = dTables.reduce((s, t) => s + t.totalCells, 0);

  const gt = groundTruthByPaper.get(paperId);
  const mGolden = gt ? goldenRediscovery(mTables, gt) : null;
  const dGolden = gt ? goldenRediscovery(dTables, gt) : null;

  // ---- per-paper report ----
  console.log(`  ① tables: MinerU ${mTables.length}  |  docling ${dTables.length}`);
  console.log(`     MinerU dims: ${mTables.map((t) => `${t.figureNo}[${t.numRows}x${t.numCols}]`).join(" ") || "(none)"}`);
  console.log(`     docling dims: ${dTables.map((t) => `${t.figureNo}[${t.numRows}x${t.numCols}]`).join(" ") || "(none)"}`);
  console.log(`     cross-parser cell overlap: Jaccard ${(overlap.jaccard * 100).toFixed(1)}% (∩${overlap.inter} MinerU-only ${overlap.aOnly} docling-only ${overlap.bOnly})`);
  if (gt) {
    console.log(`     golden 43-cell rediscovery (this paper ${gt.length} cells): MinerU ${mGolden.found}/${mGolden.total} (${pct(mGolden.found, mGolden.total)})  |  docling ${dGolden.found}/${dGolden.total} (${pct(dGolden.found, dGolden.total)})`);
    if (mGolden.missed.length) console.log(`       MinerU missed: ${mGolden.missed.slice(0, 6).join("; ")}${mGolden.missed.length > 6 ? " …" : ""}`);
    if (dGolden.missed.length) console.log(`       docling missed: ${dGolden.missed.slice(0, 6).join("; ")}${dGolden.missed.length > 6 ? " …" : ""}`);
  } else {
    console.log(`     golden rediscovery: (no fixture for this paper — qualitative)`);
  }
  console.log(`  ② equations: MinerU ${mEquations.length}  |  docling ${dEquations.length}`);
  const sampleEq = (arr, get) => arr.slice(0, 2).map((e) => norm(get(e)).slice(0, 60)).join("  ||  ");
  if (mEquations.length) console.log(`     MinerU sample: ${sampleEq(mEquations, (e) => e.latex)}`);
  if (dEquations.length) console.log(`     docling sample: ${sampleEq(dEquations, (e) => e.latex)}`);
  console.log(`  ③ caption linking: MinerU refs {${[...mRefs].join(", ")}}  |  docling refs {${[...dRefs].join(", ")}}  |  shared ${sharedRefs.length}`);
  console.log(`  ④ cell bbox: MinerU ${mBboxCells}/${mTotalCells} (${pct(mBboxCells, mTotalCells)})  |  docling ${dBboxCells}/${dTotalCells} (${pct(dBboxCells, dTotalCells)})`);
  console.log(`  ⑤ parse time: MinerU ${(mineruRaw.processingTime / 1000).toFixed(1)}s  |  docling ${(doclingRaw.processingTime / 1000).toFixed(1)}s (server ${(doclingRaw.serverProcessingTime / 1000).toFixed(1)}s)`);

  return {
    paperId,
    mTableCount: mTables.length,
    dTableCount: dTables.length,
    overlapJaccard: overlap.jaccard,
    doclingOnlyCells: overlap.bOnly,
    mEquations: mEquations.length,
    dEquations: dEquations.length,
    sharedRefs: sharedRefs.length,
    mRefs: mRefs.size,
    dRefs: dRefs.size,
    mBboxRatio: mTotalCells ? mBboxCells / mTotalCells : 0,
    dBboxRatio: dTotalCells ? dBboxCells / dTotalCells : 0,
    mTime: mineruRaw.processingTime,
    dTime: doclingRaw.processingTime,
    mGoldenFound: mGolden?.found ?? null,
    dGoldenFound: dGolden?.found ?? null,
    goldenTotal: gt?.length ?? 0,
  };
}

async function main() {
  console.log(`Docling vs MinerU 3.4 — table parsing A/B (${PAPER_IDS.length} papers)`);
  console.log(`MinerU=${process.env.REDOU_MINERU_URL || "http://localhost:8001"}  docling=${process.env.REDOU_DOCLING_URL || "http://localhost:8011"}`);

  const [mineruUp, doclingUp] = await Promise.all([isMineruAvailable(), isDoclingAvailable()]);
  console.log(`${ts()} health: MinerU ${mineruUp ? "UP" : "DOWN"} | docling ${doclingUp ? "UP" : "DOWN"}`);
  if (!mineruUp) { console.error("FATAL: MinerU sidecar is not reachable (need 3.4 baseline live)"); process.exit(1); }
  if (!doclingUp) { console.error("FATAL: docling sidecar is not reachable (build+run compose.docling.yaml first)"); process.exit(1); }

  // Golden fixture → per-paper ground-truth cell list (2 papers).
  const groundTruthByPaper = new Map();
  try {
    const gtFixture = await loadFidelityGroundTruth(GROUND_TRUTH_FIXTURE);
    for (const p of gtFixture.papers ?? []) groundTruthByPaper.set(p.paperId, p.groundTruthCells ?? []);
    console.log(`${ts()} golden fixture: ${GROUND_TRUTH_FIXTURE} (${gtFixture.papers?.length ?? 0} papers, ${[...groundTruthByPaper.values()].reduce((s, c) => s + c.length, 0)} cells)`);
  } catch (err) {
    console.warn(`${ts()} WARN: could not load golden fixture (${err.message}) — axis ① rediscovery skipped`);
  }

  const results = [];
  for (const paperId of PAPER_IDS) {
    try {
      results.push(await analyzePaper(paperId, groundTruthByPaper));
    } catch (err) {
      console.error(`${ts()} [PAPER ${paperId}] FAILED: ${err.message}`);
    }
  }

  if (results.length === 0) { console.error("No papers analyzed."); process.exit(1); }

  // ---------------------------------------------------------------------------
  // Aggregate + gate verdict
  // ---------------------------------------------------------------------------
  const sum = (get) => results.reduce((s, r) => s + (get(r) ?? 0), 0);
  const avg = (get) => sum(get) / results.length;

  const goldenPapers = results.filter((r) => r.goldenTotal > 0);
  const mGoldenTotal = goldenPapers.reduce((s, r) => s + r.mGoldenFound, 0);
  const dGoldenTotal = goldenPapers.reduce((s, r) => s + r.dGoldenFound, 0);
  const goldenCellTotal = goldenPapers.reduce((s, r) => s + r.goldenTotal, 0);

  console.log(`\n===== A/B SUMMARY (${results.length} papers) =====`);
  console.log(`① tables found (Σ):        MinerU ${sum((r) => r.mTableCount)}   |  docling ${sum((r) => r.dTableCount)}`);
  console.log(`① cross-parser overlap:    Jaccard avg ${(avg((r) => r.overlapJaccard) * 100).toFixed(1)}%`);
  if (goldenPapers.length) {
    console.log(`① golden rediscovery (Σ):  MinerU ${mGoldenTotal}/${goldenCellTotal} (${pct(mGoldenTotal, goldenCellTotal)})  |  docling ${dGoldenTotal}/${goldenCellTotal} (${pct(dGoldenTotal, goldenCellTotal)})   [${goldenPapers.length} fixture paper(s)]`);
  }
  console.log(`② equations (Σ):           MinerU ${sum((r) => r.mEquations)}   |  docling ${sum((r) => r.dEquations)}`);
  console.log(`③ caption refs shared (Σ): ${sum((r) => r.sharedRefs)}  (MinerU refs ${sum((r) => r.mRefs)} / docling refs ${sum((r) => r.dRefs)})`);
  console.log(`④ cell bbox ratio (avg):   MinerU ${(avg((r) => r.mBboxRatio) * 100).toFixed(1)}%  |  docling ${(avg((r) => r.dBboxRatio) * 100).toFixed(1)}%`);
  console.log(`⑤ parse time (avg):        MinerU ${(avg((r) => r.mTime) / 1000).toFixed(1)}s  |  docling ${(avg((r) => r.dTime) / 1000).toFixed(1)}s`);

  // ---- pre-defined gate (plan slice 02 step 4) ----
  // docling wins an axis "clearly" if:
  //   structure: docling finds >= MinerU tables AND overlap shows docling adds
  //              cells MinerU lacks on >= half the papers (docling-only > 0).
  //   bbox:      docling per-cell bbox ratio materially exceeds MinerU's (which
  //              is 0 by construction) — i.e. docling > 0.5.
  //   caption:   docling resolves >= as many "Table N" refs as MinerU overall.
  // Not materially worse on fidelity proxy: docling golden rediscovery >=
  //   MinerU - 10%p (of golden cell total). (Only meaningful with fixture papers.)
  // docling finds at least as many tables AND surfaces distinct cells MinerU
  // lacked on at least half the papers (real "structure MinerU missed" signal,
  // not a trivially-true clause).
  const structureWin = sum((r) => r.dTableCount) >= sum((r) => r.mTableCount)
    && results.filter((r) => r.doclingOnlyCells > 0).length >= Math.ceil(results.length / 2);
  const bboxWin = avg((r) => r.dBboxRatio) > 0.5 && avg((r) => r.dBboxRatio) > avg((r) => r.mBboxRatio);
  const captionWin = sum((r) => r.dRefs) >= sum((r) => r.mRefs);
  const fidelityNotWorse = goldenCellTotal === 0
    ? null
    : (dGoldenTotal >= mGoldenTotal - Math.ceil(0.1 * goldenCellTotal));

  const clearWins = [
    ["table structure", structureWin],
    ["cell bbox", bboxWin],
    ["caption linking", captionWin],
  ].filter(([, w]) => w).map(([name]) => name);

  console.log(`\n===== GATE (pre-defined, slice 02 step 4) =====`);
  console.log(`clear docling wins: ${clearWins.length ? clearWins.join(", ") : "(none)"}`);
  console.log(`fidelity proxy not worse: ${fidelityNotWorse === null ? "n/a (no fixture papers in set)" : (fidelityNotWorse ? "yes" : "NO — docling loses golden rediscovery")}`);
  const advance = clearWins.length >= 1 && fidelityNotWorse !== false;
  console.log(`VERDICT: ${advance ? "PASS → proceed to slice 03 (docling adoption)" : "HOLD → keep MinerU (no clear win or fidelity regressed)"}`);
  console.log(`\nNOTE: gate math is a first cut. The fixture covers ${goldenPapers.length}/${results.length} papers; eyeball the remaining ${results.length - goldenPapers.length} table(s) and pair this with scripts/e2e-table-fidelity.mjs (generated-table fidelity, same fixture/LLM) before recording the final call in completed/02.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${ts()} FATAL:`, err);
  process.exit(1);
});
