import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assemblePerPaperContext,
  assembleRagContext,
  cleanCellValue,
  mergeExtractionResults,
  normalizeFallbackTableToSpec,
} from "../electron/chat/table-extraction.mjs";

describe("table extraction helpers", () => {
  it("cleans common numeric cell formatting without touching non-strings", () => {
    assert.equal(cleanCellValue(".25 K"), "0.25 K");
    assert.equal(cleanCellValue("303."), "303");
    assert.equal(cleanCellValue("303. K"), "303 K");
    assert.equal(cleanCellValue(null), null);
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
});
