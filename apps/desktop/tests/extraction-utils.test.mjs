import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractKeyTerms,
  normalizeColumnKey,
  sanitizeColumnNames,
} from "../electron/chat/extraction-utils.mjs";

describe("extraction utility helpers", () => {
  it("extracts scientific identifiers and ignores common filler words", () => {
    assert.deepEqual(
      extractKeyTerms("Please compare CO2 and 5A adsorption data with the paper table"),
      ["co2", "5a", "compare", "adsorption"],
    );
  });

  it("normalizes scientific column symbols to ASCII-safe strings", () => {
    assert.deepEqual(
      sanitizeColumnNames(["CO\u2082 uptake (mmol g\u207B\u00B9)", "\u03B1-selectivity", "\u00B1 error"]),
      ["CO2 uptake (mmol g-1)", "alpha-selectivity", "+- error"],
    );
  });

  it("normalizes column keys for fuzzy header matching", () => {
    assert.equal(normalizeColumnKey("CO2 uptake (mmol/g)"), "co2uptakemmolg");
    assert.equal(normalizeColumnKey(" Result_Value [avg] "), "resultvalueavg");
  });
});
