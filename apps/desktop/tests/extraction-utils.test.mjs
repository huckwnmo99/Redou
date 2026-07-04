import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CELL_NA,
  extractKeyTerms,
  normalizeColumnKey,
  sanitizeColumnNames,
  validateCellValue,
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

describe("validateCellValue (D4 fragment guard)", () => {
  it("blocks the E2E-observed leaked JSON fragment", () => {
    // Exact fragment observed leaking into a cell during the pipeline-risk-audit E2E.
    const result = validateCellValue(' uma T (K) : "308.15",  ');
    assert.equal(result.ok, false);
    assert.equal(result.cleaned, CELL_NA);
    assert.equal(result.reason, "json_fragment");
  });

  it("blocks a key:value fragment even without quotes", () => {
    const result = validateCellValue("T (K) : 308.15");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "kv_fragment");
  });

  it("blocks braces, control characters, and over-length blobs", () => {
    assert.equal(validateCellValue("{value: 5}").reason, "json_fragment");
    assert.equal(validateCellValue("5 mg").reason, "control_char");
    assert.equal(validateCellValue("x".repeat(80)).reason, "too_long");
  });

  it("passes pure numbers, units, reference tags, model/material names", () => {
    assert.deepEqual(validateCellValue("5.05 [1]"), { ok: true, cleaned: "5.05 [1]" });
    assert.deepEqual(validateCellValue("120 mg/g"), { ok: true, cleaned: "120 mg/g" });
    assert.deepEqual(validateCellValue("303.15"), { ok: true, cleaned: "303.15" });
    assert.deepEqual(validateCellValue("Langmuir"), { ok: true, cleaned: "Langmuir" });
    assert.deepEqual(validateCellValue("Zeolite 13X"), { ok: true, cleaned: "Zeolite 13X" });
    // Ratios/times (no spaces around colon) are not fragments.
    assert.deepEqual(validateCellValue("1:2"), { ok: true, cleaned: "1:2" });
  });

  // Phase 2.5 slice 09 (D-f): a temperature/pressure range written with an en-dash (or
  // plain hyphen) is a legitimate cell value and must survive the fragment guard — it
  // has no quote/brace/kv-colon and is well under the length cap.
  it("passes a fitted temperature/pressure range value (D-f range notation)", () => {
    assert.deepEqual(validateCellValue("303–343"), { ok: true, cleaned: "303–343" });
    assert.deepEqual(validateCellValue("303–343 K"), { ok: true, cleaned: "303–343 K" });
    assert.deepEqual(validateCellValue("303-343"), { ok: true, cleaned: "303-343" });
    assert.deepEqual(validateCellValue("0–100 kPa"), { ok: true, cleaned: "0–100 kPa" });
  });

  it("normalizes empty / null / N/A to the N/A sentinel and accepts numbers", () => {
    assert.deepEqual(validateCellValue(null), { ok: true, cleaned: CELL_NA });
    assert.deepEqual(validateCellValue("   "), { ok: true, cleaned: CELL_NA });
    assert.deepEqual(validateCellValue("N/A"), { ok: true, cleaned: CELL_NA });
    assert.deepEqual(validateCellValue(308.15), { ok: true, cleaned: "308.15" });
  });
});
