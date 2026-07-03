import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectAdsorptionDomain,
  buildAdsorptionPromptHint,
  normalizeAdsorptionUnit,
  ADSORPTION_AIF_FIELDS,
} from "../electron/chat/adsorption-domain.mjs";

describe("adsorption domain detection (D2, range-guarded)", () => {
  it("detects an adsorption isotherm spec (>= 2 signals)", () => {
    assert.equal(
      detectAdsorptionDomain({
        title: "CO2 흡착 등온선 비교",
        column_definitions: ["Adsorbent", "q_max (mmol/g)", "K_L (kPa)", "Model"],
      }),
      true,
    );
  });

  it("does NOT flag a catalysis spec (range-guard R-4)", () => {
    assert.equal(
      detectAdsorptionDomain({
        title: "Catalyst performance comparison",
        column_definitions: ["Catalyst", "Conversion (%)", "TOF (h-1)", "Selectivity (%)"],
      }),
      false,
    );
  });

  it("does NOT flag on a single lone signal", () => {
    // "selectivity" alone (1 signal) must not trip the domain.
    assert.equal(
      detectAdsorptionDomain({ title: "Reaction study", column_definitions: ["Catalyst", "Selectivity (%)"] }),
      false,
    );
  });

  it("returns false for empty / missing spec", () => {
    assert.equal(detectAdsorptionDomain({}), false);
    assert.equal(detectAdsorptionDomain(undefined), false);
  });

  it("can use paper metadata captions as extra signal", () => {
    assert.equal(
      detectAdsorptionDomain(
        { title: "Comparison", column_definitions: ["Material"] },
        { captions: ["Table 2. Langmuir isotherm parameters"] },
      ),
      true,
    );
  });
});

describe("adsorption prompt hint gating (conditional injection, assumption E)", () => {
  it("returns the AIF rule only when the domain is detected", () => {
    const hint = buildAdsorptionPromptHint({ title: "isotherm", column_definitions: ["q_max", "langmuir"] });
    assert.ok(hint.length > 0);
    assert.match(hint, /NIST AIF/);
  });

  it("returns an empty string (no-op) for non-adsorption specs", () => {
    assert.equal(buildAdsorptionPromptHint({ title: "catalyst", column_definitions: ["TOF"] }), "");
  });
});

describe("adsorption unit normalization (additive, round-trip)", () => {
  it("normalizes loading units to mmol/g", () => {
    assert.deepEqual(normalizeAdsorptionUnit("2.5", "mol/kg"), { canonicalValue: 2.5, canonicalUnit: "mmol/g" });
    assert.deepEqual(normalizeAdsorptionUnit(4, "mmol/g"), { canonicalValue: 4, canonicalUnit: "mmol/g" });
  });

  it("normalizes pressure units to kPa", () => {
    assert.deepEqual(normalizeAdsorptionUnit("1", "bar"), { canonicalValue: 100, canonicalUnit: "kPa" });
    assert.deepEqual(normalizeAdsorptionUnit("1", "atm"), { canonicalValue: 101.325, canonicalUnit: "kPa" });
  });

  it("returns null for unknown units or non-numeric values", () => {
    assert.equal(normalizeAdsorptionUnit("5", "widgets"), null);
    assert.equal(normalizeAdsorptionUnit("abc", "kPa"), null);
  });

  it("exposes the AIF field taxonomy separating parameters from raw data", () => {
    assert.ok(ADSORPTION_AIF_FIELDS.parameters.length > 0);
    assert.ok(ADSORPTION_AIF_FIELDS.rawData.length > 0);
    assert.ok(ADSORPTION_AIF_FIELDS.conditions.length > 0);
  });
});
