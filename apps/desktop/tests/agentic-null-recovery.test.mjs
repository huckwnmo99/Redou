import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRecoveredValues,
  buildRecoveryQueries,
  buildSkippedAgenticRecovery,
  cloneNullSummaryForRecovery,
  cloneTableForRecovery,
  groupNullsByPaper,
  shouldTriggerAgenticRecovery,
} from "../electron/chat/agentic-null-recovery.mjs";

describe("agentic NULL recovery helpers", () => {
  it("gates recovery on recoverable per-paper NULL density", () => {
    const tableJson = { rows: [["Paper A", null]] };
    const nullSummary = {
      totalNulls: 1,
      totalCells: 20,
      details: [{ paperId: "paper-1", column: "Outcome", columnIndex: 1, rowIndex: 0 }],
    };

    assert.equal(shouldTriggerAgenticRecovery(nullSummary, tableJson), true);
    assert.equal(shouldTriggerAgenticRecovery({ ...nullSummary, totalCells: 21 }, tableJson), false);
    assert.equal(
      shouldTriggerAgenticRecovery({ ...nullSummary, details: [{ column: "Outcome", columnIndex: 1, rowIndex: 0 }] }, tableJson),
      false,
    );

    const abortController = new AbortController();
    abortController.abort();
    assert.equal(shouldTriggerAgenticRecovery(nullSummary, tableJson, abortController.signal), false);
  });

  it("groups NULL details by paper while preserving cell coordinates", () => {
    const grouped = groupNullsByPaper({
      details: [
        { paperId: "paper-1", paperTitle: "Paper One", column: "Outcome", columnIndex: 1, rowIndex: 0 },
        { paperId: "paper-1", paperTitle: "Paper One", column: "Dose", columnIndex: 2, rowIndex: 0 },
        { column: "Ignored", columnIndex: 3, rowIndex: 0 },
      ],
    });

    assert.equal(grouped.size, 1);
    assert.deepEqual(grouped.get("paper-1"), {
      paperTitle: "Paper One",
      nullCells: [
        { column: "Outcome", columnIndex: 1, rowIndex: 0 },
        { column: "Dose", columnIndex: 2, rowIndex: 0 },
      ],
    });
  });

  it("builds compact recovery queries from title, columns, units, and hints", () => {
    const queries = buildRecoveryQueries("Porous CO2 Capture", ["CO2 rate (mmol g-1)", "CO2 rate (mmol g-1)"], [
      "gas adsorption",
    ]);

    assert.equal(queries.length, 3);
    assert.deepEqual(queries.map((query) => query.intent), ["recovery", "recovery", "recovery"]);
    assert.match(queries[0].query, /CO2 rate/);
    assert.match(queries[0].query, /mmol g-1/);
    assert.ok(queries.every((query) => query.query.length <= 500));
  });

  it("clones recovery state before mutation", () => {
    const tableJson = {
      headers: ["Paper", "Outcome"],
      rows: [["Paper A", null]],
      references: [{ refNo: "1", paperId: "paper-1" }],
    };
    const nullSummary = {
      totalNulls: 1,
      totalCells: 2,
      details: [{ paperId: "paper-1", column: "Outcome", columnIndex: 1, rowIndex: 0 }],
    };

    const tableClone = cloneTableForRecovery(tableJson);
    const summaryClone = cloneNullSummaryForRecovery(nullSummary);
    tableClone.rows[0][1] = "Changed";
    summaryClone.details[0].column = "Changed";

    assert.equal(tableJson.rows[0][1], null);
    assert.equal(nullSummary.details[0].column, "Outcome");
  });

  it("applies only high-confidence recovered values to currently NULL cells", () => {
    const tableJson = {
      headers: ["Paper", "Outcome", "Notes"],
      rows: [["Paper A", null, "N/A"]],
      references: [],
    };
    const nullSummary = {
      totalNulls: 2,
      totalCells: 3,
      details: [
        { paperId: "paper-1", paperTitle: "Paper A", column: "Outcome", columnIndex: 1, rowIndex: 0 },
        { paperId: "paper-1", paperTitle: "Paper A", column: "Notes", columnIndex: 2, rowIndex: 0 },
      ],
    };

    const applied = applyRecoveredValues(
      tableJson,
      new Map([["paper-1", { refNo: "3" }]]),
      "paper-1",
      [
        { confidence: "low", values: { Outcome: "Low confidence" } },
        { confidence: "high", values: { Outcome: "Recovered outcome", Notes: "null" } },
      ],
      nullSummary,
    );

    assert.equal(applied, 1);
    assert.equal(tableJson.rows[0][1], "Recovered outcome [3]");
    assert.equal(tableJson.rows[0][2], "N/A");
    assert.equal(nullSummary.totalNulls, 1);
    assert.deepEqual(nullSummary.details, [
      { paperId: "paper-1", paperTitle: "Paper A", column: "Notes", columnIndex: 2, rowIndex: 0 },
    ]);
  });

  it("builds explicit skipped metadata for non-attempted recovery", () => {
    assert.deepEqual(buildSkippedAgenticRecovery({ totalNulls: 2 }, "single_call_fallback"), {
      attempted: false,
      ms: 0,
      nullsBeforeRecovery: 2,
      nullsAfterRecovery: 2,
      recoveredCellCount: 0,
      perPaper: [],
      skippedReason: "single_call_fallback",
    });
  });
});
