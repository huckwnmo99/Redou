import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assemblePerPaperContext,
  assembleRagContext,
  cleanCellValue,
  deriveConditionColumns,
  detectConditionConflicts,
  mergeExtractionResults,
  normalizeCellMeta,
  normalizeFallbackTableToSpec,
} from "../electron/chat/table-extraction.mjs";
import {
  ORCHESTRATOR_SCHEMA,
  EXTRACTION_AGENT_SYSTEM_PROMPT,
  resolveExtractNumPredict,
} from "../electron/llm-orchestrator.mjs";
import { ADSORPTION_EXTRACTION_HINT } from "../electron/chat/adsorption-domain.mjs";

describe("table extraction helpers", () => {
  it("cleans common numeric cell formatting without touching non-strings", () => {
    assert.equal(cleanCellValue(".25 K"), "0.25 K");
    assert.equal(cleanCellValue("303."), "303");
    assert.equal(cleanCellValue("303. K"), "303 K");
    assert.equal(cleanCellValue(null), null);
  });

  // Phase 2.5 slice 09 (D-f): the persist formatter must leave a fitted range intact.
  // The en-dash / hyphen is not a decimal point, so no ".\s"/".$" rule fires.
  it("preserves a fitted temperature range value unchanged (D-f)", () => {
    assert.equal(cleanCellValue("303–343"), "303–343");
    assert.equal(cleanCellValue("303–343 K"), "303–343 K");
    assert.equal(cleanCellValue("303-343"), "303-343");
    // Regression: a real decimal is still normalized.
    assert.equal(cleanCellValue("303.15"), "303.15");
  });

  it("normalizes fallback tables to the requested column spec", () => {
    const result = normalizeFallbackTableToSpec({
      title: "Fallback",
      headers: ["Outcome", "Unexpected", "Dose"],
      rows: [["AUC", "drop me", "5 mg"], ["", "drop me too", "10 mg"]],
    }, {
      column_definitions: ["Dose", "Outcome", "Missing"],
    });

    assert.deepEqual(result.tableJson.headers, ["Dose", "Outcome", "Missing"]);
    assert.deepEqual(result.tableJson.rows, [["5 mg", "AUC", "N/A"], ["10 mg", "N/A", "N/A"]]);
    assert.deepEqual(result.diagnostics.missingHeaders, ["Missing"]);
    assert.deepEqual(result.diagnostics.droppedHeaders, ["Unexpected"]);
    assert.equal(result.diagnostics.normalizedToSpec, true);
  });

  it("assembles combined RAG context with parsed tables, OCR tables, chunks, and evidence labels", () => {
    const context = assembleRagContext([
      { chunk_id: "chunk-1", paper_id: "paper-1", text: "main chunk", page: 4 },
    ], [
      {
        figure_id: "fig-1",
        paper_id: "paper-1",
        figure_no: "Table S1",
        caption: "Supplementary assay table",
        summary_text: "supplementary table html text with enough length to be included",
        source_file_kind: "supplementary_pdf",
        source_filename: "supp.pdf",
        page: 3,
        _rrfScore: 10,
      },
    ], new Map([
      ["paper-1", { refNo: 1, title: "Paper One" }],
    ]), [{
      paperId: "paper-1",
      paperTitle: "Paper One",
      tables: [{
        caption: "Parsed table",
        headers: ["Dose", "Outcome"],
        rows: [["5 mg", "AUC"]],
        page: 2,
      }],
    }]);

    assert.match(context, /Parsed table - \[1\] Paper One, Main PDF p\.2/);
    assert.match(context, /Table S1 - \[1\] Paper One, Supplementary: supp\.pdf, p\.3/);
    assert.match(context, /\[Chunk 1, \[1\], Main PDF p\.4\]/);
  });

  it("assembles per-paper context in relevance order with source labels", () => {
    const context = assemblePerPaperContext({
      paperTitle: "Paper One",
      parsedTables: [{
        caption: "Parsed table",
        headers: ["Dose"],
        rows: [["5 mg"]],
        page: 2,
      }],
      figures: [{
        figure_no: "Table S1",
        caption: "Supplementary assay table",
        summary_text: "supplementary table html text with enough length to be included",
        source_file_kind: "supplementary_pdf",
        source_filename: "supp.pdf",
        page: 3,
        _rrfScore: 4,
      }],
      chunks: [
        { chunk_id: "low", text: "lower relevance", page: 9, _rrfScore: 1 },
        { chunk_id: "high", text: "higher relevance", page: 8, _rrfScore: 9 },
      ],
    });

    assert.match(context, /Parsed table, Main PDF p\.2/);
    assert.match(context, /Table S1, Supplementary: supp\.pdf, p\.3/);
    assert.ok(context.indexOf("higher relevance") < context.indexOf("lower relevance"));
  });

  it("merges per-paper extraction rows with normalized columns and reference tags", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { dose: "5 mg", outcome: "AUC" } },
            { values: { dose: "", outcome: "" } },
          ],
        },
      },
      {
        paperId: "paper-2",
        paperTitle: "Paper Two",
        success: false,
        error: "extraction boom",
        extraction: { data_rows: [{ values: { dose: "ignored", outcome: "ignored" } }] },
      },
    ], {
      title: "Merged",
      column_definitions: ["Dose", "Outcome"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: ["Kim"], year: 2026, doi: "10.1/one" },
      { paperId: "paper-2", title: "Paper Two", authors: ["Lee"], year: 2025, doi: "10.1/two" },
    ], new Map([
      ["paper-1", { refNo: 1, title: "Paper One" }],
      ["paper-2", { refNo: 2, title: "Paper Two" }],
    ]));

    // fix 19: paper-2 produced no data (success=false) so it gets an all-N/A
    // placeholder row instead of being skipped, and is included in references.
    assert.deepEqual(result.tableJson.rows, [["5 mg [1]", "AUC [1]"], ["N/A", "N/A"]]);
    assert.deepEqual(result.tableJson.references.map((ref) => ref.paperId), ["paper-1", "paper-2"]);
    // Placeholder cells are NOT recorded in nullSummary (deliberately empty rows).
    assert.equal(result.nullSummary.totalCells, 4);
    assert.equal(result.nullSummary.totalNulls, 2);
    assert.equal(result.nullSummary.droppedRowCount, 1);
    assert.deepEqual(result.nullSummary.details, []);
    // fix 19: per-paper reasons — paper-1 had data, paper-2 failed.
    assert.equal(result.reasons.length, 2);
    const reasonOne = result.reasons.find((r) => r.paperId === "paper-1");
    const reasonTwo = result.reasons.find((r) => r.paperId === "paper-2");
    assert.equal(reasonOne.hadRows, true);
    assert.equal(reasonTwo.hadRows, false);
    assert.equal(reasonTwo.failed, true);
    assert.equal(reasonTwo.refNo, "2");
    assert.match(reasonTwo.note, /Extraction failed: extraction boom/);
    assert.match(result.tableJson.notes, /1 of 2 paper/);
    // Phase 1: cellTuples is returned and aligned with rows (one real row + one
    // placeholder), with null tuples when no cell_meta was provided.
    assert.equal(result.cellTuples.length, result.tableJson.rows.length);
    assert.deepEqual(result.cellTuples, [[null, null], [null, null]]);
    // No column_semantic_types on the spec -> null; no conditions -> no conflicts.
    assert.equal(result.columnSemanticTypes, null);
    assert.deepEqual(result.conditionConflicts, []);
  });

  it("preserves per-cell tuples (unit/condition/source_hint) and column semantic types (D1/D2/D3)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            {
              values: { Adsorbent: "Zeolite 13X", "q_max": "5.2" },
              cell_meta: { "q_max": { unit: "mmol/g", condition: "at 293 K", source_hint: "Table 3" } },
            },
          ],
        },
      },
    ], {
      title: "Tuples",
      column_definitions: ["Adsorbent", "q_max"],
      column_semantic_types: ["condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: ["Kim"], year: 2026, doi: "" },
    ], new Map([
      ["paper-1", { refNo: 1, title: "Paper One" }],
    ]));

    // Scalar rows unchanged (values still flow through untouched, ref tag applied).
    assert.deepEqual(result.tableJson.rows, [["Zeolite 13X [1]", "5.2 [1]"]]);
    // Tuple carries the cell-level provenance/condition/unit; the identity column had
    // no cell_meta so it stays null.
    assert.equal(result.cellTuples[0][0], null);
    assert.deepEqual(result.cellTuples[0][1], {
      unit: "mmol/g",
      condition: "at 293 K",
      source_hint: "Table 3",
    });
    // Column semantic types are preserved index-aligned to headers.
    assert.deepEqual(result.columnSemanticTypes, ["condition", "parameter"]);
  });

  it("falls back a row-level source_hint into each cell tuple (D3 provenance)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { Adsorbent: "MOF", "q_max": "3.1" }, confidence: "high", source_hint: "Table 4" },
          ],
        },
      },
    ], {
      title: "RowHint",
      column_definitions: ["Adsorbent", "q_max"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    // The row-level source_hint + confidence propagate to every non-empty cell tuple.
    assert.deepEqual(result.cellTuples[0][0], { source_hint: "Table 4", confidence: "high" });
    assert.deepEqual(result.cellTuples[0][1], { source_hint: "Table 4", confidence: "high" });
  });

  it("blocks a leaked JSON fragment cell during merge and forces N/A (D4)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            // Fragment observed in the E2E leaking into the q_max cell; Adsorbent is clean.
            { values: { Adsorbent: "Carbon", "q_max": ' uma T (K) : "308.15",  ' } },
          ],
        },
      },
    ], {
      title: "Fragment",
      column_definitions: ["Adsorbent", "q_max"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    // The fragment cell is blocked -> N/A (and counted as a null); the clean cell stays.
    assert.deepEqual(result.tableJson.rows, [["Carbon [1]", "N/A"]]);
    assert.equal(result.nullSummary.totalNulls, 1);
    assert.equal(result.nullSummary.details.length, 1);
    assert.equal(result.nullSummary.details[0].column, "q_max");
  });

  it("detects a condition conflict when a parameter column mixes conditions (D1)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { Adsorbent: "Z", "q_max": "5.2" }, cell_meta: { "q_max": { condition: "full range, 293 K" } } },
            { values: { Adsorbent: "Z", "q_max": "3.1" }, cell_meta: { "q_max": { condition: "low pressure" } } },
          ],
        },
      },
    ], {
      title: "Conflict",
      column_definitions: ["Adsorbent", "q_max"],
      column_semantic_types: ["condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    assert.equal(result.conditionConflicts.length, 1);
    assert.equal(result.conditionConflicts[0].column, "q_max");
    assert.equal(result.conditionConflicts[0].columnIndex, 1);
    assert.deepEqual(result.conditionConflicts[0].conditions, ["full range, 293 K", "low pressure"]);
    // Slice 09 (D-b): the mixed conditions are pivoted into a derived "측정 조건 (q_max)"
    // column (the identity column being typed "condition" does NOT suppress the pivot —
    // the guard is name-collision, not semantic-type).
    assert.deepEqual(result.tableJson.headers, ["Adsorbent", "q_max", "측정 조건 (q_max)"]);
    assert.equal(result.conditionConflicts[0].derivedColumnIndex, 2);
    assert.deepEqual(result.tableJson.rows, [
      ["Z [1]", "5.2 [1]", "full range, 293 K"],
      ["Z [1]", "3.1 [1]", "low pressure"],
    ]);
  });

  // Phase 2.5 slice 09 (D-b): when a parameter column mixes conditions and NO explicit
  // condition column exists, merge derives a "측정 조건" column via pivot and atomically
  // shifts every later index (headers/rows/cellTuples/columnSemanticTypes/conflict/null).
  it("derives a condition column from mixed conditions and shifts later indices (D-b pivot)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { Adsorbent: "Z", "q_max": "5.2", "K_L": "" }, cell_meta: { "q_max": { condition: "full range" } } },
            { values: { Adsorbent: "Z", "q_max": "3.1", "K_L": "0.04" }, cell_meta: { "q_max": { condition: "low pressure" } } },
          ],
        },
      },
    ], {
      title: "Pivot",
      column_definitions: ["Adsorbent", "q_max", "K_L"],
      // No "condition" entry -> duplicate guard does not fire; only q_max carries conditions.
      column_semantic_types: ["parameter", "parameter", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    // Derived "측정 조건 (q_max)" column inserted right after q_max (index 2).
    assert.deepEqual(result.tableJson.headers, ["Adsorbent", "q_max", "측정 조건 (q_max)", "K_L"]);
    assert.deepEqual(result.tableJson.rows, [
      ["Z [1]", "5.2 [1]", "full range", "N/A"],
      ["Z [1]", "3.1 [1]", "low pressure", "0.04 [1]"],
    ]);
    // columnSemanticTypes extended index-aligned, derived column tagged "condition".
    assert.deepEqual(result.columnSemanticTypes, ["parameter", "parameter", "condition", "parameter"]);
    // The conflict points at the derived column; its own index is unchanged (insert after).
    assert.equal(result.conditionConflicts.length, 1);
    assert.equal(result.conditionConflicts[0].columnIndex, 1);
    assert.equal(result.conditionConflicts[0].derivedColumnIndex, 2);
    // cellTuples aligned to the 4-wide rows; derived tuples carry the condition.
    assert.equal(result.cellTuples[0].length, 4);
    assert.deepEqual(result.cellTuples[0][2], { condition: "full range" });
    assert.deepEqual(result.cellTuples[1][2], { condition: "low pressure" });
    // The row-1 K_L null detail (originally columnIndex 2) shifted to 3 after the insert.
    const klNull = result.nullSummary.details.find((d) => d.column === "K_L");
    assert.ok(klNull, "expected a null detail on K_L");
    assert.equal(klNull.columnIndex, 3);
  });

  it("forces an all-N/A placeholder row + reason for every scope paper when no paper yields data", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: { data_rows: [], notes: "no q_max reported in this paper" },
      },
      {
        paperId: "paper-2",
        paperTitle: "Paper Two",
        success: true,
        extraction: { data_rows: [] },
      },
    ], {
      title: "All Empty",
      column_definitions: ["Adsorbent", "q_max"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: ["Kim"], year: 2026, doi: "10.1/one" },
      { paperId: "paper-2", title: "Paper Two", authors: ["Lee"], year: 2025, doi: "10.1/two" },
    ], new Map([
      ["paper-1", { refNo: 1, title: "Paper One" }],
      ["paper-2", { refNo: 2, title: "Paper Two" }],
    ]));

    // Both papers become all-N/A placeholder rows (no empty-body table).
    assert.deepEqual(result.tableJson.rows, [["N/A", "N/A"], ["N/A", "N/A"]]);
    assert.deepEqual(result.tableJson.references.map((ref) => ref.paperId), ["paper-1", "paper-2"]);
    // Reasons carry the per-paper LLM note where present, default otherwise.
    assert.equal(result.reasons.length, 2);
    const reasonOne = result.reasons.find((r) => r.paperId === "paper-1");
    const reasonTwo = result.reasons.find((r) => r.paperId === "paper-2");
    assert.equal(reasonOne.hadRows, false);
    assert.equal(reasonOne.failed, false);
    assert.equal(reasonOne.note, "no q_max reported in this paper");
    assert.equal(reasonTwo.note, "No matching data found in this paper");
    assert.match(result.tableJson.notes, /2 of 2 paper/);
  });

  // Phase 2.5 slice 08 (D-a coverage counter) — records per-paper real rows +
  // distinct conditions on reasons[] without changing rows/tableJson.
  it("records distinctConditionCount>=2 when a paper contributes multiple condition sets (D-a)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { Adsorbent: "Z", "q_max": "5.2" }, cell_meta: { "q_max": { condition: "full range, 293 K" } } },
            { values: { Adsorbent: "Z", "q_max": "3.1" }, cell_meta: { "q_max": { condition: "low pressure <=100 kPa" } } },
          ],
        },
      },
    ], {
      title: "Coverage two sets",
      column_definitions: ["Adsorbent", "q_max"],
      column_semantic_types: ["condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    const reason = result.reasons.find((r) => r.paperId === "paper-1");
    // Coverage counters are tallied before the slice-09 pivot, so they still see 2 rows /
    // 2 distinct conditions regardless of the derived column.
    assert.equal(reason.extractedRowCount, 2);
    assert.equal(reason.distinctConditionCount, 2);
    // Slice 09 (D-b): the two conditions are pivoted into a derived "측정 조건 (q_max)"
    // column (both data rows kept + ref-tagged, condition string surfaced as data).
    assert.deepEqual(result.tableJson.rows, [
      ["Z [1]", "5.2 [1]", "full range, 293 K"],
      ["Z [1]", "3.1 [1]", "low pressure <=100 kPa"],
    ]);
  });

  it("counts distinctConditionCount=1 when all rows share one condition (D-a)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            { values: { Adsorbent: "Z", "q_max": "5.2" }, cell_meta: { "q_max": { condition: "at 293 K" } } },
            // Same condition after whitespace/punct normalization -> still one set.
            { values: { Adsorbent: "Z", "q_max": "5.4" }, cell_meta: { "q_max": { condition: "at 293K." } } },
          ],
        },
      },
    ], {
      title: "Coverage one set",
      column_definitions: ["Adsorbent", "q_max"],
      column_semantic_types: ["condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    const reason = result.reasons.find((r) => r.paperId === "paper-1");
    assert.equal(reason.extractedRowCount, 2);
    assert.equal(reason.distinctConditionCount, 1);
  });

  it("reports zero coverage counters for a paper that produced no data (D-a)", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: { data_rows: [] },
      },
    ], {
      title: "Coverage empty",
      column_definitions: ["Adsorbent", "q_max"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    const reason = result.reasons.find((r) => r.paperId === "paper-1");
    assert.equal(reason.hadRows, false);
    assert.equal(reason.extractedRowCount, 0);
    assert.equal(reason.distinctConditionCount, 0);
  });
});

// Phase 2.5 slice 10-A (measured defect: cell_meta key collapse). gemma sometimes
// stuffs several meta fields into the `unit` string as a "key: value, key: value"
// blob (real DB row below), leaving `condition` absent and silently defeating the
// slice-09 pivot + fidelity eval. normalizeCellMeta re-splits it deterministically.
describe("normalizeCellMeta (slice 10-A cell_meta re-split)", () => {
  it("re-splits the measured collapsed unit blob into unit + condition (real DB row)", () => {
    // Exact tuple pulled from chat_generated_tables.metadata (conversation 3dd8fbc5…).
    const collapsed = {
      unit: "unit: mmol/g, condition: at 293.15 K, pressure <= 1000 kPa",
      confidence: "high",
      source_hint: "Table 4 (p.7)",
    };
    const out = normalizeCellMeta(collapsed);
    assert.equal(out.unit, "mmol/g");
    // The unknown "pressure <=" label is NOT a boundary, so it stays glued to the
    // condition segment (the whole measurement condition is preserved intact).
    assert.equal(out.condition, "at 293.15 K, pressure <= 1000 kPa");
    // Fields that were already correct are preserved.
    assert.equal(out.source_hint, "Table 4 (p.7)");
    assert.equal(out.confidence, "high");
  });

  it("leaves a well-shaped meta object unchanged (no false re-split)", () => {
    const clean = { unit: "mmol/g", condition: "at 293 K", source_hint: "Table 3" };
    assert.deepEqual(normalizeCellMeta(clean), clean);
  });

  it("does not touch a value that merely contains a colon but no leading known label", () => {
    // "1:2" ratios / times must not be treated as a collapsed blob.
    const ratio = { unit: "1:2", condition: "12:30 run" };
    assert.deepEqual(normalizeCellMeta(ratio), ratio);
  });

  it("does not re-split an unlabelled fragment blob (conservative — leaves as-is)", () => {
    // Second observed collapse form ("mmol/g} , 100 kPa") has no known key label, so
    // it is left untouched (the D4 cell validator still guards the value column).
    const fragment = { unit: "mmol/g} , 100 kPa" };
    assert.deepEqual(normalizeCellMeta(fragment), fragment);
  });

  it("splits a condition-field blob and does not clobber an already-set field", () => {
    // condition string carries a "source:" segment; existing source_hint wins.
    const meta = { condition: "condition: at 300 K, source: Table 2", source_hint: "Table 5" };
    const out = normalizeCellMeta(meta);
    assert.equal(out.condition, "at 300 K");
    assert.equal(out.source_hint, "Table 5"); // pre-existing value preserved
  });

  it("returns null/non-objects unchanged", () => {
    assert.equal(normalizeCellMeta(null), null);
    assert.equal(normalizeCellMeta(undefined), null);
    assert.equal(normalizeCellMeta("x"), "x");
  });
});

// Slice 10-A end-to-end: a collapsed cell_meta blob, once re-split during merge, must
// surface its condition so detectConditionConflicts fires and the slice-09 pivot builds
// a "측정 조건" column (and fidelity eval reads the condition). Before the fix the
// condition was buried in `unit`, so the pivot produced nothing.
describe("collapsed cell_meta flows through merge into the condition pivot (10-A)", () => {
  it("re-splits collapsed unit blobs so mixed conditions pivot into a derived column", () => {
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            {
              values: { Adsorbent: "Z", "q_max": "5.2" },
              cell_meta: { "q_max": { unit: "unit: mmol/g, condition: at 293.15 K, pressure <= 1000 kPa" } },
            },
            {
              values: { Adsorbent: "Z", "q_max": "3.1" },
              cell_meta: { "q_max": { unit: "unit: mmol/g, condition: at 293.15 K, pressure <= 100 kPa" } },
            },
          ],
        },
      },
    ], {
      title: "Collapsed",
      column_definitions: ["Adsorbent", "q_max"],
      column_semantic_types: ["condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: [], year: 2026, doi: "" },
    ], new Map([["paper-1", { refNo: 1, title: "Paper One" }]]));

    // The condition was recovered from the collapsed unit blob onto each tuple.
    assert.equal(result.cellTuples[0][1].unit, "mmol/g");
    assert.equal(result.cellTuples[0][1].condition, "at 293.15 K, pressure <= 1000 kPa");
    // Two distinct conditions on the q_max parameter column -> a conflict is detected...
    assert.equal(result.conditionConflicts.length, 1);
    assert.equal(result.conditionConflicts[0].column, "q_max");
    // ...and the slice-09 pivot derives a "측정 조건 (q_max)" column carrying the conditions.
    assert.deepEqual(result.tableJson.headers, ["Adsorbent", "q_max", "측정 조건 (q_max)"]);
    assert.deepEqual(result.tableJson.rows, [
      ["Z [1]", "5.2 [1]", "at 293.15 K, pressure <= 1000 kPa"],
      ["Z [1]", "3.1 [1]", "at 293.15 K, pressure <= 100 kPa"],
    ]);
  });
});

describe("detectConditionConflicts (D1)", () => {
  const headers = ["Adsorbent", "q_max", "q(P)"];
  const types = ["condition", "parameter", "raw_data"];

  it("flags a parameter column with two different conditions", () => {
    const cellTuples = [
      [null, { condition: "at 293 K" }, { condition: "5 kPa" }],
      [null, { condition: "low pressure" }, { condition: "10 kPa" }],
    ];
    const conflicts = detectConditionConflicts(cellTuples, headers, types);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].column, "q_max");
    assert.deepEqual(conflicts[0].conditions, ["at 293 K", "low pressure"]);
  });

  it("does not flag when the parameter column has a single (normalized) condition", () => {
    const cellTuples = [
      [null, { condition: "at 293 K" }, null],
      [null, { condition: "at 293K." }, null], // same after whitespace/punct normalization
    ];
    assert.deepEqual(detectConditionConflicts(cellTuples, headers, types), []);
  });

  it("ignores raw_data and condition columns even when they vary", () => {
    const cellTuples = [
      [{ condition: "a" }, null, { condition: "5 kPa" }],
      [{ condition: "b" }, null, { condition: "10 kPa" }],
    ];
    // Only the identity (condition) and q(P) (raw_data) columns vary -> no conflict.
    assert.deepEqual(detectConditionConflicts(cellTuples, headers, types), []);
  });

  it("returns no conflicts for empty tuples", () => {
    assert.deepEqual(detectConditionConflicts([], headers, types), []);
    assert.deepEqual(detectConditionConflicts(null, headers, types), []);
  });

  // Phase 2.5 slice 09 (D-f): en-dash vs hyphen dash normalization means a fitted
  // range spelled "303–343 K" and "303-343K" is ONE condition — not two — so it must
  // not raise a false conflict (and the pivot would not double-count it either).
  it("treats en-dash and hyphen range spellings as one condition (D-f dash normalization)", () => {
    const cellTuples = [
      [null, { condition: "303–343 K" }, null],
      [null, { condition: "303-343K" }, null],
    ];
    assert.deepEqual(detectConditionConflicts(cellTuples, headers, types), []);
  });
});

describe("deriveConditionColumns (D-b pivot slice 09)", () => {
  it("inserts a derived condition column after each flagged column and atomically shifts later indices", () => {
    // 3 columns: [Adsorbent(0), q_max(1), Note(2)]. q_max mixes two conditions.
    const headers = ["Adsorbent", "q_max", "Note"];
    const rows = [
      ["Z [1]", "5.2 [1]", "a"],
      ["Z [1]", "3.1 [1]", "b"],
    ];
    const cellTuples = [
      [null, { condition: "full range" }, null],
      [null, { condition: "low pressure" }, null],
    ];
    const columnSemanticTypes = ["condition", "parameter", null];
    const conditionConflicts = [
      { column: "q_max", columnIndex: 1, conditions: ["full range", "low pressure"] },
    ];
    // A null detail sitting on the "Note" column (index 2) must shift to 3 after insert.
    const nullDetails = [{ column: "Note", columnIndex: 2, rowIndex: 0 }];

    const semanticTypes = deriveConditionColumns({
      headers,
      rows,
      cellTuples,
      columnSemanticTypes,
      conditionConflicts,
      nullDetails,
    });

    // Derived column inserted at index 2 (right after q_max), named after the source.
    assert.deepEqual(headers, ["Adsorbent", "q_max", "측정 조건 (q_max)", "Note"]);
    // Each row carries its source cell's condition in the new column.
    assert.deepEqual(rows, [
      ["Z [1]", "5.2 [1]", "full range", "a"],
      ["Z [1]", "3.1 [1]", "low pressure", "b"],
    ]);
    // cellTuples gains a derived tuple carrying the condition (for hover parity).
    assert.deepEqual(cellTuples[0][2], { condition: "full range" });
    assert.deepEqual(cellTuples[1][2], { condition: "low pressure" });
    // The trailing "Note" tuple slot stays aligned (still index 3, still null).
    assert.equal(cellTuples[0].length, 4);
    assert.equal(cellTuples[0][3], null);
    // Semantic types: derived column tagged "condition", index-aligned to headers.
    assert.deepEqual(semanticTypes, ["condition", "parameter", "condition", null]);
    // Conflict now points to its derived column and its own columnIndex is unchanged
    // (insert happened AFTER it).
    assert.equal(conditionConflicts[0].columnIndex, 1);
    assert.equal(conditionConflicts[0].derivedColumnIndex, 2);
    // The null detail on "Note" shifted from 2 -> 3.
    assert.equal(nullDetails[0].columnIndex, 3);
  });

  it("shifts a second (later) conflict's columnIndex when an earlier column is pivoted", () => {
    // Two flagged columns: q_max(1) and K_L(3). Processing right-to-left keeps indices
    // valid; the earlier insert must bump the later conflict + its derived index.
    const headers = ["Adsorbent", "q_max", "T", "K_L"];
    const rows = [["Z", "5.2", "298", "0.04"]];
    const cellTuples = [[null, { condition: "full range" }, null, { condition: "low pressure" }]];
    const conditionConflicts = [
      { column: "q_max", columnIndex: 1, conditions: ["full range", "x"] },
      { column: "K_L", columnIndex: 3, conditions: ["low pressure", "y"] },
    ];

    const semanticTypes = deriveConditionColumns({
      headers,
      rows,
      cellTuples,
      columnSemanticTypes: null,
      conditionConflicts,
      nullDetails: [],
    });

    // Headers: derived cols after q_max (idx2) and after K_L (which moved to idx4 -> its
    // derived col at idx5).
    assert.deepEqual(headers, ["Adsorbent", "q_max", "측정 조건 (q_max)", "T", "K_L", "측정 조건 (K_L)"]);
    assert.deepEqual(rows, [["Z", "5.2", "full range", "298", "0.04", "low pressure"]]);
    // q_max conflict unchanged (1 -> derived 2). K_L conflict bumped 3 -> 4 -> derived 5.
    const qmax = conditionConflicts.find((c) => c.column === "q_max");
    const kl = conditionConflicts.find((c) => c.column === "K_L");
    assert.equal(qmax.columnIndex, 1);
    assert.equal(qmax.derivedColumnIndex, 2);
    assert.equal(kl.columnIndex, 4);
    assert.equal(kl.derivedColumnIndex, 5);
    // semanticTypes built from scratch (spec omitted it), condition-tagged at derived cols.
    assert.deepEqual(semanticTypes, [null, null, "condition", null, null, "condition"]);
  });

  it("does not derive when no conflict is present (regression)", () => {
    const headers = ["Adsorbent", "q_max"];
    const rows = [["Z", "5.2"]];
    const cellTuples = [[null, { condition: "full range" }]];
    const semanticTypes = deriveConditionColumns({
      headers,
      rows,
      cellTuples,
      columnSemanticTypes: [null, "parameter"],
      conditionConflicts: [],
      nullDetails: [],
    });
    assert.deepEqual(headers, ["Adsorbent", "q_max"]);
    assert.deepEqual(rows, [["Z", "5.2"]]);
    assert.deepEqual(semanticTypes, [null, "parameter"]);
  });

  it("skips derivation when the derived column name already exists (duplicate guard, assumption C)", () => {
    // A column named exactly "측정 조건 (q_max)" is already present (e.g. a prior pivot or
    // an orchestrator column of the same name) -> do not add a second representation.
    // NOTE: the guard keys on the derived NAME, not the "condition" semantic type, because
    // identity columns (Adsorbent) are also typed "condition" — a type-based guard would
    // wrongly suppress every adsorption pivot.
    const headers = ["Adsorbent", "q_max", "측정 조건 (q_max)"];
    const rows = [["Z", "5.2", "full range"], ["Z", "3.1", "low pressure"]];
    const cellTuples = [
      [null, { condition: "full range" }, { condition: "full range" }],
      [null, { condition: "low pressure" }, { condition: "low pressure" }],
    ];
    const columnSemanticTypes = ["condition", "parameter", "condition"];
    const conditionConflicts = [
      { column: "q_max", columnIndex: 1, conditions: ["full range", "low pressure"] },
    ];

    const semanticTypes = deriveConditionColumns({
      headers,
      rows,
      cellTuples,
      columnSemanticTypes,
      conditionConflicts,
      nullDetails: [],
    });

    // Nothing inserted; the input arrays are untouched and no derivedColumnIndex is set.
    assert.deepEqual(headers, ["Adsorbent", "q_max", "측정 조건 (q_max)"]);
    assert.deepEqual(rows, [["Z", "5.2", "full range"], ["Z", "3.1", "low pressure"]]);
    assert.equal(semanticTypes, columnSemanticTypes);
    assert.equal(conditionConflicts[0].derivedColumnIndex, undefined);
  });

  it("uses N/A for rows whose source cell has no condition", () => {
    const headers = ["Adsorbent", "q_max"];
    const rows = [["Z", "5.2"], ["Z", "3.1"]];
    const cellTuples = [
      [null, { condition: "full range" }],
      [null, null], // no condition on this row's source cell
    ];
    const conditionConflicts = [
      { column: "q_max", columnIndex: 1, conditions: ["full range", "low pressure"] },
    ];
    deriveConditionColumns({
      headers,
      rows,
      cellTuples,
      columnSemanticTypes: [null, "parameter"],
      conditionConflicts,
      nullDetails: [],
    });
    assert.deepEqual(rows, [["Z", "5.2", "full range"], ["Z", "3.1", "N/A"]]);
    assert.deepEqual(cellTuples[1][2], null);
  });
});

describe("completeness spec + set-enumeration prompt (D-a slice 08)", () => {
  it("declares an optional completeness enum on the orchestrator table_spec", () => {
    const completeness = ORCHESTRATOR_SCHEMA.properties.table_spec.properties.completeness;
    assert.ok(completeness, "table_spec should expose a completeness property");
    assert.equal(completeness.type, "string");
    assert.deepEqual(completeness.enum, ["all_sets", "representative"]);
    // Optional + back-compat: not in table_spec.required (there is no required list),
    // and the top-level schema still only requires `action`.
    assert.deepEqual(ORCHESTRATOR_SCHEMA.required, ["action"]);
    assert.equal(ORCHESTRATOR_SCHEMA.properties.table_spec.required, undefined);
  });

  it("instructs the extraction agent to enumerate sets then emit one row per set", () => {
    // Rule 5 was strengthened from "multiple rows if multiple conditions" to an
    // explicit enumerate-first subtask so every condition set becomes its own row.
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /세트 열거 후 세트마다 정확히 1행/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /파라미터 세트/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /별개의 세트/);
    // Unit-fidelity guard against spec drift observed in the RUNS=3 baseline.
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /mmol\/g/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /mg\/g/);
  });

  it("reinforces pressure-range set enumeration in the adsorption domain hint", () => {
    assert.match(ADSORPTION_EXTRACTION_HINT, /압력 범위별 세트를 각각 행으로/);
  });
});

describe("range-notation convention (D-f slice 09)", () => {
  it("instructs the extraction agent to write a fitted range instead of a single value", () => {
    // Rule 4 gained a sub-bullet: temperature/pressure-range-fitted params get a range
    // like "303–343" in the condition column rather than null, plus a cell_meta.condition.
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /범위에서 피팅된 값/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /303–343/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /fitted over 303–343 K/);
  });

  it("carries the range convention into the adsorption domain hint", () => {
    assert.match(ADSORPTION_EXTRACTION_HINT, /303–343/);
    assert.match(ADSORPTION_EXTRACTION_HINT, /fitted over 303–343 K/);
  });
});

describe("num_predict env semantics (slice 10-C)", () => {
  it("defaults to 8192 when the env is unset / blank", () => {
    assert.equal(resolveExtractNumPredict(undefined), 8192);
    assert.equal(resolveExtractNumPredict(""), 8192);
  });

  it("uses a positive integer env override", () => {
    assert.equal(resolveExtractNumPredict("4096"), 4096);
    assert.equal(resolveExtractNumPredict("16384"), 16384);
  });

  it("falls back to the default on non-numeric / non-positive values", () => {
    assert.equal(resolveExtractNumPredict("abc"), 8192);
    assert.equal(resolveExtractNumPredict("0"), 8192);
    assert.equal(resolveExtractNumPredict("-100"), 8192);
  });
});

describe("cell_meta emission rule narrowed to parameter columns (slice 10-C, condition mandatory 10-C revised)", () => {
  it("scopes cell_meta to parameter columns and makes condition mandatory", () => {
    // Rule 12 (10-C revised): cell_meta only on parameter columns, condition is now
    // REQUIRED on every parameter cell (the earlier "only when non-obvious" hedge was
    // measured as a regression — coverage dropped to conditions 0~1), and cell_meta is
    // never on identity/condition/raw_data. unit/source_hint stay for back-match.
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /parameter 열에만/);
    assert.match(EXTRACTION_AGENT_SYSTEM_PROMPT, /condition은 파라미터 셀마다 필수/);
    // The hedge phrasing must be gone.
    assert.equal(/자명하지 않을 때만/.test(EXTRACTION_AGENT_SYSTEM_PROMPT), false);
    // The few-shot must stay consistent: cell_meta keys are parameter columns
    // (q_max / K_L), never the T (K) / Adsorbent identity columns, and every
    // parameter cell_meta block carries a "condition" key.
    const metaBlocks = EXTRACTION_AGENT_SYSTEM_PROMPT.match(/"cell_meta":\s*\{[^\n]*\}/g) ?? [];
    assert.ok(metaBlocks.length >= 2, "few-shot should still show cell_meta usage");
    for (const block of metaBlocks) {
      assert.equal(/"T \(K\)":/.test(block), false, `cell_meta must not key the T (K) identity column: ${block}`);
      assert.equal(/"Adsorbent":/.test(block), false, `cell_meta must not key the Adsorbent identity column: ${block}`);
      assert.ok(/"condition":/.test(block), `parameter cell_meta must carry a condition: ${block}`);
    }
  });
});

describe("merge tolerates partial cell_meta (slice 10-C regression)", () => {
  it("keeps merging when only the parameter column carries cell_meta", () => {
    // With the narrowed rule the model emits cell_meta for the parameter column only.
    // normalizedMeta.get() must miss gracefully on the identity/condition columns
    // (no tuple), and the parameter column still gets its unit/source_hint tuple.
    const result = mergeExtractionResults([
      {
        paperId: "paper-1",
        paperTitle: "Paper One",
        success: true,
        extraction: {
          data_rows: [
            {
              values: { Adsorbent: "Zeolite 13X", "T (K)": "303", "q_max": "5.2" },
              // Only the parameter column q_max has meta; no key for Adsorbent / T (K).
              cell_meta: { "q_max": { unit: "mmol/g", source_hint: "Table 3" } },
            },
          ],
        },
      },
    ], {
      title: "Partial meta",
      column_definitions: ["Adsorbent", "T (K)", "q_max"],
      column_semantic_types: ["condition", "condition", "parameter"],
    }, [
      { paperId: "paper-1", title: "Paper One", authors: ["Kim"], year: 2026, doi: "" },
    ], new Map([
      ["paper-1", { refNo: 1, title: "Paper One" }],
    ]));

    // Row values flow through untouched (ref tag applied), no crash on missing meta.
    assert.deepEqual(result.tableJson.rows, [["Zeolite 13X [1]", "303 [1]", "5.2 [1]"]]);
    // Identity/condition columns had no cell_meta -> null tuples; parameter column
    // carries its unit + source_hint tuple.
    const [rowTuples] = result.cellTuples;
    assert.equal(rowTuples[0], null); // Adsorbent
    assert.equal(rowTuples[1], null); // T (K)
    assert.deepEqual(rowTuples[2], { unit: "mmol/g", source_hint: "Table 3" }); // q_max
    // No condition anywhere -> no false conflict, no derived column.
    assert.deepEqual(result.conditionConflicts, []);
    assert.equal(result.tableJson.headers.length, 3);
  });
});
