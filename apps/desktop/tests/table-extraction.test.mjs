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

    assert.deepEqual(result.tableJson.rows, [["5 mg [1]", "AUC [1]"]]);
    assert.deepEqual(result.tableJson.references.map((ref) => ref.paperId), ["paper-1"]);
    assert.equal(result.nullSummary.totalCells, 4);
    assert.equal(result.nullSummary.totalNulls, 2);
    assert.equal(result.nullSummary.droppedRowCount, 1);
    assert.deepEqual(result.nullSummary.details, []);
  });
});
