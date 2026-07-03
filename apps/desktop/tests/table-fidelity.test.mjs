import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFidelityGroundTruthShape,
  evaluateTableFidelityCase,
  evaluateTableFidelityFixture,
  isNumericCellValue,
  loadFidelityGroundTruth,
  stripCitationTags,
} from "./integration/support/eval-runner.mjs";

// Deterministic synthetic tables (no live LLM). The real E2E table output is
// non-deterministic, so the regression gate lives here on fixed tableRows; the
// live E2E is only for recording a current score.

// A faithful paper-2 table: the pressure-range condition is kept in the "Model"
// column, so every ground-truth cell can be matched under its own condition.
const FAITHFUL_PAPER2_TABLE = {
  table_title: "Isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "MAPE"],
  rows: [
    ["Ethane", "DSL (~600 kPa)", "2.400 [2]", "16.585 [2]"],
    ["Ethane", "DSL (~100 kPa)", "2.328 [2]", "8.242 [2]"],
    ["Ethylene", "DSL (~600 kPa)", "2.450 [2]", "1.739 [2]"],
    ["Ethylene", "DSL (~100 kPa)", "2.00 [2]", "1.992 [2]"],
    ["Ethane", "Sips (~600 kPa)", "4.89 [2]", "2.316 [2]"],
    ["Ethane", "Sips (~100 kPa)", "2.95 [2]", "2.928 [2]"],
    ["Ethylene", "Sips (~600 kPa)", "6.91 [2]", "4.112 [2]"],
    ["Ethylene", "Sips (~100 kPa)", "6.07 [2]", "3.739 [2]"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: {
    extractionMode: "per_paper",
    conditionConflicts: [{ column: "q_m", columnIndex: 2, conditions: ["~600 kPa", "~100 kPa"] }],
  },
};

// A D1-defective paper-2 table: the ~600 vs ~100 kPa fits are collapsed onto one
// "DSL"/"Sips" row with no pressure-range condition. The kept value is right but
// its condition is lost, so it must count as misattribution (not a match).
const CONDITION_MIXED_PAPER2_TABLE = {
  table_title: "Isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "MAPE"],
  rows: [
    ["Ethane", "DSL", "2.400", "16.585"],
    ["Ethylene", "DSL", "2.450", "1.739"],
    ["Ethane", "Sips", "4.89", "2.316"],
    ["Ethylene", "Sips", "6.91", "4.112"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: { extractionMode: "per_paper", conditionConflicts: [] },
};

// A fabricating paper-2 table: q_m for Ethane DSL ~600 kPa is a made-up value
// that appears nowhere in the ground truth (numeric misattribution / D2/D4).
const FABRICATED_PAPER2_TABLE = {
  table_title: "Isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "MAPE"],
  rows: [
    ["Ethane", "DSL (~600 kPa)", "9.999", "16.585"],
    ["Ethane", "DSL (~100 kPa)", "2.328", "8.242"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: { extractionMode: "per_paper", conditionConflicts: [] },
};

const PAPER2_GROUND_TRUTH = {
  paperId: "5e0f399d-8996-4387-9200-2dafa58658bc",
  conditionMixedColumns: [{ column: "q_m" }],
  groundTruthCells: [
    { identity: ["Ethane", "DSL"], column: "q_m", value: "2.400", condition: "~600 kPa" },
    { identity: ["Ethane", "DSL"], column: "q_m", value: "2.328", condition: "~100 kPa" },
    { identity: ["Ethylene", "DSL"], column: "q_m", value: "2.450", condition: "~600 kPa" },
    { identity: ["Ethylene", "DSL"], column: "q_m", value: "2.00", condition: "~100 kPa" },
    { identity: ["Ethane", "Sips"], column: "q_m", value: "4.89", condition: "~600 kPa" },
    { identity: ["Ethane", "Sips"], column: "q_m", value: "2.95", condition: "~100 kPa" },
    { identity: ["Ethylene", "Sips"], column: "q_m", value: "6.91", condition: "~600 kPa" },
    { identity: ["Ethylene", "Sips"], column: "q_m", value: "6.07", condition: "~100 kPa" },
  ],
};

describe("table_fidelity helpers", () => {
  it("strips citation tags but keeps the value", () => {
    assert.equal(stripCitationTags("2.400 [2]"), "2.400");
    assert.equal(stripCitationTags("8.69 [1, 3]"), "8.69");
    assert.equal(stripCitationTags("N/A"), "N/A");
  });

  it("recognises numeric cells and rejects N/A / labels", () => {
    assert.equal(isNumericCellValue("2.400 [2]"), true);
    assert.equal(isNumericCellValue("16.585"), true);
    assert.equal(isNumericCellValue("N/A"), false);
    assert.equal(isNumericCellValue(""), false);
    assert.equal(isNumericCellValue("DSL (~600 kPa)"), false);
  });
});

describe("table_fidelity fixture", () => {
  it("loads the adsorption ground-truth fixture with the expected cell counts", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    assert.equal(groundTruth.schemaVersion, "table-fidelity-v0");
    assert.equal(groundTruth.papers.length, 2);

    const [paper1, paper2] = groundTruth.papers;
    assert.equal(paper1.paperId, "7536d494-e3a3-473c-b992-43cc18b56a4e");
    assert.equal(paper1.groundTruthCells.length, 27);
    assert.equal(paper2.paperId, "5e0f399d-8996-4387-9200-2dafa58658bc");
    assert.equal(paper2.groundTruthCells.length, 16);

    // The fixture must encode the D1 case: same q_m parameter, two conditions.
    const co2Cells = paper1.groundTruthCells.filter(
      (cell) => cell.identity.includes("CO2") && cell.identity.includes("293.15") && cell.identity.includes("KACa"),
    );
    const conditions = new Set(co2Cells.map((cell) => cell.condition));
    assert.equal(conditions.has("<=1000 kPa"), true);
    assert.equal(conditions.has("<=100 kPa"), true);
  });

  it("validates the fixture shape", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    assert.doesNotThrow(() => assertFidelityGroundTruthShape(groundTruth));
  });

  it("rejects a fixture with the wrong schema version", () => {
    assert.throws(() => assertFidelityGroundTruthShape({ schemaVersion: "nope", papers: [] }));
  });
});

describe("evaluateTableFidelityCase", () => {
  it("scores a faithful condition-separated table as full fidelity", () => {
    const report = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH, FAITHFUL_PAPER2_TABLE);

    assert.equal(report.mode, "table_fidelity");
    assert.equal(report.paperId, "5e0f399d-8996-4387-9200-2dafa58658bc");
    assert.equal(report.fidelity.matched, 8);
    assert.equal(report.fidelity.total, 8);
    assert.equal(report.fidelity.score, 1);
    assert.equal(report.misattribution.count, 0);
    assert.equal(report.fabrication.count, 0);
    assert.equal(report.conflictHandling.detected, 1);
    assert.equal(report.conflictHandling.score, 1);
  });

  it("flags condition mixing (D1) as misattribution, not a match", () => {
    const report = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH, CONDITION_MIXED_PAPER2_TABLE);

    // Ethane/Ethylene DSL/Sips q_m ~600 kPa values are present, but the row has
    // no pressure-range condition -> value right, attribution lost.
    assert.equal(report.misattribution.count, 4);
    // The ~100 kPa ground-truth cells have no matching value at all -> missing.
    assert.equal(report.missing.count, 4);
    assert.equal(report.fidelity.matched, 0);
    // conditionConflicts was empty -> the pipeline did not flag the mixed column.
    assert.equal(report.conflictHandling.detected, 0);
    assert.equal(report.conflictHandling.score, 0);
  });

  it("counts a made-up numeric value as fabrication", () => {
    const report = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH, FABRICATED_PAPER2_TABLE);

    assert.equal(report.fabrication.count, 1);
    assert.equal(report.fabrication.cells[0].value, "9.999");
    // The genuine ~100 kPa row still matches.
    assert.equal(report.fidelity.matched, 1);
  });

  it("returns full score against an empty ground-truth block", () => {
    const report = evaluateTableFidelityCase({ paperId: "x", groundTruthCells: [] }, FAITHFUL_PAPER2_TABLE);
    assert.equal(report.fidelity.total, 0);
    assert.equal(report.fidelity.score, 1);
    assert.equal(report.conflictHandling.score, 1);
  });
});

describe("evaluateTableFidelityFixture", () => {
  it("aggregates per-paper reports into an overall score", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    // Only supply the faithful paper-2 table; paper-1 gets an empty table.
    const result = evaluateTableFidelityFixture(groundTruth, (paperId) =>
      paperId === "5e0f399d-8996-4387-9200-2dafa58658bc" ? FAITHFUL_PAPER2_TABLE : { headers: [], rows: [] },
    );

    assert.equal(result.schemaVersion, "table-fidelity-v0");
    assert.equal(result.reports.length, 2);
    assert.equal(result.overall.total, 43);
    // Paper 2 has 16 ground-truth cells; the faithful table matches the 8 q_m
    // cells (MAPE cells also match since the table carries both columns).
    const paper2Report = result.reports.find(
      (report) => report.paperId === "5e0f399d-8996-4387-9200-2dafa58658bc",
    );
    assert.equal(paper2Report.fidelity.matched, 16);
    assert.equal(result.overall.matched, 16);
  });
});
