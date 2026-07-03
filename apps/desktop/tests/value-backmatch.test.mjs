import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MEASHALU_CHECK_TYPES,
  backMatchCell,
  buildMatrixValueIndex,
  buildNarrowGuardianClaim,
  extractTableToken,
  normalizeNumericValue,
  pickCheckType,
} from "../electron/chat/value-backmatch.mjs";
import { runCodeBackMatchPass } from "../electron/chat/table-pipeline.mjs";

describe("normalizeNumericValue", () => {
  it("strips reference tags to a bare number", () => {
    assert.equal(normalizeNumericValue("8.69 [1]"), "8.69");
    assert.equal(normalizeNumericValue("4.45[2]"), "4.45");
  });

  it("strips surrounding units", () => {
    assert.equal(normalizeNumericValue("25 mg"), "25");
    assert.equal(normalizeNumericValue("~600 kPa"), "600");
  });

  it("keeps signed and scientific notation", () => {
    assert.equal(normalizeNumericValue("-1.2"), "-1.2");
    assert.equal(normalizeNumericValue("3.0E-3"), "3.0e-3");
  });

  it("returns null for non-numeric / empty / nullish", () => {
    assert.equal(normalizeNumericValue("Langmuir"), null);
    assert.equal(normalizeNumericValue("N/A"), null);
    assert.equal(normalizeNumericValue(""), null);
    assert.equal(normalizeNumericValue(null), null);
    assert.equal(normalizeNumericValue(undefined), null);
  });
});

describe("extractTableToken", () => {
  it("extracts the table number from varied caption formats", () => {
    assert.equal(extractTableToken("Table 3"), "3");
    assert.equal(extractTableToken("TABLE 4."), "4");
    assert.equal(extractTableToken("Table 3: Langmuir parameters"), "3");
    assert.equal(extractTableToken("Tab. 12 something"), "12");
  });

  it("returns null when there is no table number", () => {
    assert.equal(extractTableToken("Fig. 2 caption"), null);
    assert.equal(extractTableToken("Section 3.2"), null);
    assert.equal(extractTableToken(null), null);
  });
});

describe("buildMatrixValueIndex", () => {
  const parsedMatrices = [
    {
      tables: [
        { caption: "Table 3 Langmuir", rows: [["KACa", "8.69"], ["KACi", "4.02"]] },
        { caption: "Table 4 params", rows: [["KACa", "4.45"]] },
        { caption: "Fig. 1", rows: [["x", "99.9"]] },
      ],
    },
  ];

  it("indexes all normalized values across every table", () => {
    const { all } = buildMatrixValueIndex(parsedMatrices);
    assert.equal(all.has("8.69"), true);
    assert.equal(all.has("4.02"), true);
    assert.equal(all.has("4.45"), true);
    assert.equal(all.has("99.9"), true);
    assert.equal(all.has("1.11"), false);
  });

  it("buckets values by table-number token (figures get no bucket)", () => {
    const { byTable } = buildMatrixValueIndex(parsedMatrices);
    assert.equal(byTable.get("3").has("8.69"), true);
    assert.equal(byTable.get("3").has("4.45"), false); // 4.45 is in Table 4
    assert.equal(byTable.get("4").has("4.45"), true);
    assert.equal(byTable.has("1"), false); // "Fig. 1" has no table token
  });

  it("returns empty index for null/undefined/non-array input", () => {
    for (const bad of [null, undefined, {}, "x"]) {
      const idx = buildMatrixValueIndex(bad);
      assert.equal(idx.all.size, 0);
      assert.equal(idx.byTable.size, 0);
    }
  });
});

describe("backMatchCell", () => {
  const valueIndex = buildMatrixValueIndex([
    { tables: [
      { caption: "Table 3", rows: [["8.69"], ["4.02"]] },
      { caption: "Table 4", rows: [["4.45"]] },
    ] },
  ]);

  it("matches source_hinted scope when the value is in the hinted table", () => {
    const r = backMatchCell({ cellValue: "8.69 [1]", sourceHint: "Table 3", valueIndex });
    assert.deepEqual(r, { matched: true, scope: "source_hinted" });
  });

  it("falls back to any_matrix when the source_hint points elsewhere but the value exists", () => {
    // 4.45 lives in Table 4, but the hint says Table 3 -> not source_hinted, still any_matrix.
    const r = backMatchCell({ cellValue: "4.45", sourceHint: "Table 3", valueIndex });
    assert.deepEqual(r, { matched: true, scope: "any_matrix" });
  });

  it("uses any_matrix when source_hint is absent", () => {
    const r = backMatchCell({ cellValue: "4.02", valueIndex });
    assert.deepEqual(r, { matched: true, scope: "any_matrix" });
  });

  it("returns none when the value is not in any matrix", () => {
    const r = backMatchCell({ cellValue: "7.77", sourceHint: "Table 3", valueIndex });
    assert.deepEqual(r, { matched: false, scope: "none" });
  });

  it("returns none for non-numeric cells (identity/model names)", () => {
    const r = backMatchCell({ cellValue: "KACa", sourceHint: "Table 3", valueIndex });
    assert.deepEqual(r, { matched: false, scope: "none" });
  });
});

describe("pickCheckType", () => {
  it("prefers condition > unit > fabrication", () => {
    assert.equal(pickCheckType({ condition: "at 293 K", unit: "mol/kg" }), MEASHALU_CHECK_TYPES.CONDITION_MISMATCH);
    assert.equal(pickCheckType({ unit: "mol/kg" }), MEASHALU_CHECK_TYPES.UNIT_MISMATCH);
    assert.equal(pickCheckType({}), MEASHALU_CHECK_TYPES.VALUE_FABRICATION);
    assert.equal(pickCheckType(null), MEASHALU_CHECK_TYPES.VALUE_FABRICATION);
  });
});

describe("buildNarrowGuardianClaim", () => {
  const cell = { headers: ["Adsorbent", "Gas", "q_max"], row: ["KACa", "CO2", "8.69 [1]"], col: 2, cleanValue: "8.69" };

  it("builds a condition_mismatch claim embedding the measurement condition", () => {
    const claim = buildNarrowGuardianClaim(cell, { condition: "at 293 K" }, MEASHALU_CHECK_TYPES.CONDITION_MISMATCH);
    assert.equal(claim, "For KACa, CO2, q_max = 8.69 was measured at 293 K");
  });

  it("builds a unit_mismatch claim embedding the unit", () => {
    const claim = buildNarrowGuardianClaim(cell, { unit: "mol/kg" }, MEASHALU_CHECK_TYPES.UNIT_MISMATCH);
    assert.equal(claim, "For KACa, CO2, q_max = 8.69 is reported in mol/kg");
  });

  it("builds a value_fabrication claim with identity when no tuple info", () => {
    const claim = buildNarrowGuardianClaim(cell, null, MEASHALU_CHECK_TYPES.VALUE_FABRICATION);
    assert.equal(claim, "For KACa, CO2, the value 8.69 for q_max appears in the source");
  });

  it("drops identity gracefully when leading columns are N/A", () => {
    const naCell = { headers: ["Adsorbent", "q_max"], row: ["N/A", "8.69"], col: 1, cleanValue: "8.69" };
    const claim = buildNarrowGuardianClaim(naCell, null, MEASHALU_CHECK_TYPES.VALUE_FABRICATION);
    assert.equal(claim, "The value 8.69 for q_max appears in the source");
  });
});

describe("runCodeBackMatchPass (deterministic Stage 4 pass 1)", () => {
  const parsedMatrices = [
    { tables: [{ caption: "Table 3", rows: [["KACa", "8.69"], ["KACi", "4.02"]] }] },
  ];

  it("code-verifies matrix-backed numeric cells and routes the rest to Guardian", () => {
    const tableJson = {
      headers: ["Adsorbent", "q_max"],
      rows: [
        ["KACa [1]", "8.69 [1]"], // 8.69 is in the matrix -> code-verified
        ["KACi [1]", "7.77 [1]"], // 7.77 is NOT in the matrix -> Guardian candidate
      ],
    };
    const cellTuples = [
      [null, { source_hint: "Table 3" }],
      [null, null],
    ];

    const { codeVerified, guardianCandidates, numericCellCount } = runCodeBackMatchPass({
      tableJson,
      parsedMatrices,
      cellTuples,
    });

    assert.equal(numericCellCount, 2); // two numeric cells (identity cells are non-numeric)
    assert.equal(codeVerified.length, 1);
    assert.deepEqual(codeVerified[0], {
      row: 0,
      col: 1,
      status: "verified",
      method: "code",
      checkType: "backmatch",
      scope: "source_hinted",
    });
    assert.equal(guardianCandidates.length, 1);
    assert.deepEqual(guardianCandidates[0], { row: 1, col: 1, cleanValue: "7.77" });
  });

  it("skips N/A and non-numeric cells entirely", () => {
    const tableJson = { headers: ["Adsorbent", "q_max"], rows: [["KACa", "N/A"], ["Langmuir", ""]] };
    const { codeVerified, guardianCandidates, numericCellCount } = runCodeBackMatchPass({
      tableJson,
      parsedMatrices,
      cellTuples: null,
    });
    assert.equal(numericCellCount, 0);
    assert.equal(codeVerified.length, 0);
    assert.equal(guardianCandidates.length, 0);
  });

  it("routes everything to Guardian when there are no parsed matrices (fallback path)", () => {
    const tableJson = { headers: ["A", "V"], rows: [["x", "12.3"]] };
    const { codeVerified, guardianCandidates } = runCodeBackMatchPass({
      tableJson,
      parsedMatrices: [],
      cellTuples: null,
    });
    assert.equal(codeVerified.length, 0);
    assert.equal(guardianCandidates.length, 1);
    assert.deepEqual(guardianCandidates[0], { row: 0, col: 1, cleanValue: "12.3" });
  });
});
