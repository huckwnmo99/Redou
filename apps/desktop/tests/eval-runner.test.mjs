import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateRagRetrievalCase,
  evaluateTableGenerationCase,
  loadEvalCaseSet,
  normalizeEvalString,
} from "./integration/support/eval-runner.mjs";

describe("RAG/table eval runner", () => {
  it("loads the golden-path v0 eval set with an all-asserted cell gate", async () => {
    const caseSet = await loadEvalCaseSet("golden-path-v0.json");

    assert.equal(caseSet.schemaVersion, "rag-table-eval-v0");
    assert.deepEqual(caseSet.cases.map((evalCase) => evalCase.id), [
      "golden-path-table-rag",
      "golden-path-table-output",
    ]);

    const tableCase = caseSet.cases.find((evalCase) => evalCase.mode === "table_generation");
    assert.equal(tableCase.metrics.cellExactMatch, "all_asserted");
    assert.equal("cellExactMatchMin" in tableCase.metrics, false);
  });

  it("normalizes only boring whitespace for cell comparisons", () => {
    assert.equal(normalizeEvalString(" 42   mmol/g [1]\n"), "42 mmol/g [1]");
  });

  it("passes a RAG case when required chunk and figure ranks are satisfied", async () => {
    const caseSet = await loadEvalCaseSet("golden-path-v0.json");
    const ragCase = caseSet.cases.find((evalCase) => evalCase.mode === "rag_retrieval");

    const report = evaluateRagRetrievalCase(ragCase, {
      chunks: [
        {
          chunk_id: "10000000-0000-4000-8000-000000000401",
          paper_id: "10000000-0000-4000-8000-000000000101",
          source_file_id: "10000000-0000-4000-8000-000000000201",
        },
      ],
      figures: [
        {
          figure_id: "10000000-0000-4000-8000-000000000501",
          paper_id: "10000000-0000-4000-8000-000000000101",
          source_file_id: "10000000-0000-4000-8000-000000000201",
        },
      ],
    });

    assert.equal(report.passed, true);
    assert.equal(report.metrics.every((metric) => metric.passed), true);
  });

  it("requires every asserted table cell to match", async () => {
    const caseSet = await loadEvalCaseSet("golden-path-v0.json");
    const tableCase = caseSet.cases.find((evalCase) => evalCase.mode === "table_generation");

    const report = evaluateTableGenerationCase(tableCase, {
      table_title: "Adsorption capacity table",
      headers: ["Material", "Capacity", "Condition"],
      rows: [["Golden Path Framework [1]", "42 mmol/g [1]", "298 K, 1 bar [1]"]],
      source_refs: [
        {
          paperId: "10000000-0000-4000-8000-000000000101",
          refNo: "1",
        },
      ],
      metadata: {
        extractionMode: "per_paper",
        sourceEvidenceLocations: {
          "10000000-0000-4000-8000-000000000101": [{ page: 2 }],
        },
      },
    });

    assert.equal(report.passed, true);
    assert.equal(report.metrics.find((metric) => metric.name === "cellExactMatch")?.observed, 3);
  });
});
