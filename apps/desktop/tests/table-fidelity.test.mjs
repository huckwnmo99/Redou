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

// Same ground truth with slice-07 scope labels (full_range = ~600 kPa,
// low_pressure = ~100 kPa). Used to test scope-subset grading (RUN3 case).
const PAPER2_GROUND_TRUTH_SCOPED = {
  paperId: "5e0f399d-8996-4387-9200-2dafa58658bc",
  conditionMixedColumns: [{ column: "q_m" }],
  groundTruthCells: [
    { identity: ["Ethane", "DSL"], column: "q_m", value: "2.400", condition: "~600 kPa", scope: "full_range" },
    { identity: ["Ethane", "DSL"], column: "q_m", value: "2.328", condition: "~100 kPa", scope: "low_pressure" },
    { identity: ["Ethylene", "DSL"], column: "q_m", value: "2.450", condition: "~600 kPa", scope: "full_range" },
    { identity: ["Ethylene", "DSL"], column: "q_m", value: "2.00", condition: "~100 kPa", scope: "low_pressure" },
    { identity: ["Ethane", "Sips"], column: "q_m", value: "4.89", condition: "~600 kPa", scope: "full_range" },
    { identity: ["Ethane", "Sips"], column: "q_m", value: "2.95", condition: "~100 kPa", scope: "low_pressure" },
    { identity: ["Ethylene", "Sips"], column: "q_m", value: "6.91", condition: "~600 kPa", scope: "full_range" },
    { identity: ["Ethylene", "Sips"], column: "q_m", value: "6.07", condition: "~100 kPa", scope: "low_pressure" },
  ],
};

// RUN3 case: the query said "low pressure only", so the model extracted (and the
// table carries) ONLY the ~100 kPa fits — a faithful low-pressure table. Graded
// against the whole fixture it looks 50% (4/8); graded against the low_pressure
// scope it is a fair 100% (4/4).
const LOW_PRESSURE_ONLY_PAPER2_TABLE = {
  table_title: "Low-pressure isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "MAPE"],
  rows: [
    ["Ethane", "DSL (~100 kPa)", "2.328 [2]", "8.242 [2]"],
    ["Ethylene", "DSL (~100 kPa)", "2.00 [2]", "1.992 [2]"],
    ["Ethane", "Sips (~100 kPa)", "2.95 [2]", "2.928 [2]"],
    ["Ethylene", "Sips (~100 kPa)", "6.07 [2]", "3.739 [2]"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: {
    extractionMode: "per_paper",
    conditionConflicts: [{ column: "q_m", columnIndex: 2, conditions: ["~100 kPa"] }],
  },
};

// Slice 09 (D-b) pivot output for paper 2: the mixed q_m column has a derived
// "측정 조건 (q_m)" column immediately after it, each derived cell filled from the
// cell's condition. conditionConflicts is EMPTY here on purpose — the point of B is
// that the derived-and-filled column earns conflict credit even without a listed
// conflict (slice 09 promotes the mix to a column instead of only flagging it).
const DERIVED_CONDITION_PAPER2_TABLE = {
  table_title: "Isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "측정 조건 (q_m)", "MAPE"],
  rows: [
    ["Ethane", "DSL", "2.400 [2]", "~600 kPa", "16.585 [2]"],
    ["Ethane", "DSL", "2.328 [2]", "~100 kPa", "8.242 [2]"],
    ["Ethylene", "DSL", "2.450 [2]", "~600 kPa", "1.739 [2]"],
    ["Ethylene", "DSL", "2.00 [2]", "~100 kPa", "1.992 [2]"],
    ["Ethane", "Sips", "4.89 [2]", "~600 kPa", "2.316 [2]"],
    ["Ethane", "Sips", "2.95 [2]", "~100 kPa", "2.928 [2]"],
    ["Ethylene", "Sips", "6.91 [2]", "~600 kPa", "4.112 [2]"],
    ["Ethylene", "Sips", "6.07 [2]", "~100 kPa", "3.739 [2]"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: { extractionMode: "per_paper", conditionConflicts: [] },
};

// Same pivot shape but the derived condition column is entirely empty (N/A): the
// pivot ran yet carried no condition. This must NOT earn conflict credit — a
// derived column that disambiguates nothing is no better than not pivoting.
const EMPTY_DERIVED_CONDITION_PAPER2_TABLE = {
  table_title: "Isotherm parameters of ethane and ethylene",
  headers: ["Adsorbate", "Model", "q_m", "측정 조건 (q_m)", "MAPE"],
  rows: [
    ["Ethane", "DSL", "2.400 [2]", "N/A", "16.585 [2]"],
    ["Ethane", "DSL", "2.328 [2]", "N/A", "8.242 [2]"],
    ["Ethylene", "DSL", "2.450 [2]", "N/A", "1.739 [2]"],
    ["Ethylene", "DSL", "2.00 [2]", "N/A", "1.992 [2]"],
    ["Ethane", "Sips", "4.89 [2]", "N/A", "2.316 [2]"],
    ["Ethane", "Sips", "2.95 [2]", "N/A", "2.928 [2]"],
    ["Ethylene", "Sips", "6.91 [2]", "N/A", "4.112 [2]"],
    ["Ethylene", "Sips", "6.07 [2]", "N/A", "3.739 [2]"],
  ],
  source_refs: [{ paperId: "5e0f399d-8996-4387-9200-2dafa58658bc", refNo: "2" }],
  metadata: { extractionMode: "per_paper", conditionConflicts: [] },
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

  it("without a scope option grades against every ground-truth cell (regression)", () => {
    // No options -> identical to the legacy 2-arg call: the low-pressure-only
    // table matches only its 4 ~100 kPa cells out of the full 8 -> 50%.
    const legacy = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH_SCOPED, LOW_PRESSURE_ONLY_PAPER2_TABLE);
    const withEmptyOptions = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH_SCOPED, LOW_PRESSURE_ONLY_PAPER2_TABLE, {});

    assert.equal(legacy.fidelity.total, 8);
    assert.equal(legacy.fidelity.matched, 4);
    assert.equal(legacy.fidelity.score, 0.5);
    assert.equal(legacy.scoped.applicable, true);
    assert.equal(legacy.scoped.requested, null);
    // Passing an empty options object must not change scoring.
    assert.deepEqual(withEmptyOptions.fidelity, legacy.fidelity);
  });

  it("grades only the requested scope subset (RUN3: low-pressure-only table is not unfairly penalized)", () => {
    const report = evaluateTableFidelityCase(
      PAPER2_GROUND_TRUTH_SCOPED,
      LOW_PRESSURE_ONLY_PAPER2_TABLE,
      { scope: "low_pressure" },
    );

    // Golden is restricted to the 4 low-pressure cells, all of which the faithful
    // low-pressure table carries -> full fidelity instead of a 50% penalty.
    assert.equal(report.fidelity.total, 4);
    assert.equal(report.fidelity.matched, 4);
    assert.equal(report.fidelity.score, 1);
    assert.equal(report.misattribution.count, 0);
    assert.equal(report.missing.count, 0);
    assert.equal(report.scoped.applicable, true);
    assert.deepEqual(report.scoped.requested, ["low_pressure"]);
    assert.equal(report.scoped.matchedCells, 4);
  });

  it("accepts a scope array and unions the requested labels", () => {
    const report = evaluateTableFidelityCase(
      PAPER2_GROUND_TRUTH_SCOPED,
      FAITHFUL_PAPER2_TABLE,
      { scope: ["full_range", "low_pressure"] },
    );
    // Both scopes together == the whole fixture, and the faithful table matches all.
    assert.equal(report.fidelity.total, 8);
    assert.equal(report.fidelity.matched, 8);
    assert.equal(report.scoped.applicable, true);
  });

  it("marks a nonexistent scope as not applicable (no golden cells in scope)", () => {
    const report = evaluateTableFidelityCase(
      PAPER2_GROUND_TRUTH_SCOPED,
      FAITHFUL_PAPER2_TABLE,
      { scope: "nonexistent" },
    );
    assert.equal(report.scoped.applicable, false);
    assert.equal(report.fidelity.total, 0);
    assert.equal(report.scoped.matchedCells, 0);
  });

  // Slice 09 (D-b) credit: a derived-and-filled "측정 조건 (q_m)" column handles the
  // mix even though metadata.conditionConflicts is empty. Before B this scored 0.
  it("credits a derived-and-filled condition column even without a listed conflict (B)", () => {
    const report = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH, DERIVED_CONDITION_PAPER2_TABLE);

    assert.equal(report.conflictHandling.expected, 1);
    assert.equal(report.conflictHandling.detected, 1);
    assert.equal(report.conflictHandling.score, 1);
    // The derived condition column also lets every value match under its condition,
    // so fidelity is full (the pivot disambiguated the ~600/~100 kPa rows).
    assert.equal(report.fidelity.matched, 8);
    assert.equal(report.misattribution.count, 0);
  });

  // Guardrail: a pivot that ran but carries no condition (all N/A) must NOT be
  // credited — otherwise the scorer would reward an empty column as "handled".
  it("does NOT credit a derived condition column whose cells are all empty (B)", () => {
    const report = evaluateTableFidelityCase(PAPER2_GROUND_TRUTH, EMPTY_DERIVED_CONDITION_PAPER2_TABLE);

    assert.equal(report.conflictHandling.expected, 1);
    assert.equal(report.conflictHandling.detected, 0);
    assert.equal(report.conflictHandling.score, 0);
    // With no condition anywhere, the ~600/~100 kPa values are misattributed, not matched.
    assert.equal(report.fidelity.matched, 0);
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
    assert.equal(result.scope, null);
    // Paper 2 has 16 ground-truth cells; the faithful table matches the 8 q_m
    // cells (MAPE cells also match since the table carries both columns).
    const paper2Report = result.reports.find(
      (report) => report.paperId === "5e0f399d-8996-4387-9200-2dafa58658bc",
    );
    assert.equal(paper2Report.fidelity.matched, 16);
    assert.equal(result.overall.matched, 16);
  });

  it("restricts the overall total to the requested scope subset", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    const result = evaluateTableFidelityFixture(
      groundTruth,
      (paperId) => (paperId === "5e0f399d-8996-4387-9200-2dafa58658bc" ? FAITHFUL_PAPER2_TABLE : { headers: [], rows: [] }),
      { scope: "low_pressure" },
    );

    // 20 of the 43 golden cells are low_pressure (paper1 Table 4 = 12, paper2 = 8).
    assert.equal(result.overall.total, 20);
    assert.deepEqual(result.scope, ["low_pressure"]);
    assert.equal(result.overall.applicablePapers, 2);
  });

  it("does not let a nonexistent scope drag the overall down to 0% (applicable:false excluded)", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    const result = evaluateTableFidelityFixture(groundTruth, () => FAITHFUL_PAPER2_TABLE, { scope: "nonexistent" });

    // No paper has in-scope cells -> both blocks are N/A and excluded, so the
    // overall stays 1 (empty) rather than collapsing to 0/43.
    assert.equal(result.overall.total, 0);
    assert.equal(result.overall.fidelity, 1);
    assert.equal(result.overall.applicablePapers, 0);
    assert.equal(result.reports.every((report) => report.scoped.applicable === false), true);
  });
});

describe("fidelity fixture scope backward-compat", () => {
  it("accepts a fixture with scopeVocabulary and cell scope labels", async () => {
    const groundTruth = await loadFidelityGroundTruth("adsorption-groundtruth-v0.json");
    assert.deepEqual(groundTruth.scopeVocabulary, ["full_range", "low_pressure"]);
    // Every cell carries a scope drawn from the vocabulary.
    for (const paper of groundTruth.papers) {
      for (const cell of paper.groundTruthCells) {
        assert.equal(groundTruth.scopeVocabulary.includes(cell.scope), true);
      }
    }
    assert.doesNotThrow(() => assertFidelityGroundTruthShape(groundTruth));
  });

  it("still validates a fixture with no scope fields at all (backward-compat)", () => {
    const noScope = {
      schemaVersion: "table-fidelity-v0",
      papers: [
        {
          paperId: "legacy",
          groundTruthCells: [{ identity: ["A"], column: "q_m", value: "1.0" }],
        },
      ],
    };
    assert.doesNotThrow(() => assertFidelityGroundTruthShape(noScope));
  });

  it("rejects a non-string scope on a cell", () => {
    const badScope = {
      schemaVersion: "table-fidelity-v0",
      papers: [
        {
          paperId: "bad",
          groundTruthCells: [{ identity: ["A"], column: "q_m", value: "1.0", scope: 123 }],
        },
      ],
    };
    assert.throws(() => assertFidelityGroundTruthShape(badScope));
  });

  it("rejects a non-array scopeVocabulary", () => {
    const badVocab = {
      schemaVersion: "table-fidelity-v0",
      scopeVocabulary: "full_range",
      papers: [],
    };
    assert.throws(() => assertFidelityGroundTruthShape(badVocab));
  });
});
