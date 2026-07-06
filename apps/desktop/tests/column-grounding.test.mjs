import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHeaderVocabulary,
  snapColumnsToParsedHeaders,
} from "../electron/chat/column-grounding.mjs";

// Slice 11 branch 2: conservative column-name grounding / snap. These pin the
// "strong single-match replaces, weak/ambiguous/absent does not" contract that the
// table pipeline relies on (never a fuzzy metric rename like R2 -> MAPE).

describe("buildHeaderVocabulary", () => {
  it("maps normalized keys to their distinct original spellings", () => {
    const vocab = buildHeaderVocabulary([
      { tables: [{ headers: ["q_max (mmol/g)", "MAPE"] }] },
      { tables: [{ headers: ["q max (mmol/g)"] }] },
    ]);
    // "q_max (mmol/g)" and "q max (mmol/g)" normalize to the same key -> ambiguous set.
    const qmaxKey = [...vocab.keys()].find((k) => k.includes("qmax"));
    assert.ok(qmaxKey);
    assert.equal(vocab.get(qmaxKey).size, 2);
    const mapeKey = [...vocab.keys()].find((k) => k === "mape");
    assert.deepEqual([...vocab.get(mapeKey)], ["MAPE"]);
  });

  it("returns an empty map for missing / non-array input", () => {
    assert.equal(buildHeaderVocabulary(undefined).size, 0);
    assert.equal(buildHeaderVocabulary([]).size, 0);
    assert.equal(buildHeaderVocabulary([{ tables: [] }]).size, 0);
  });
});

describe("snapColumnsToParsedHeaders", () => {
  const parsedMatrices = [
    { tables: [{ headers: ["Adsorbent", "MAPE", "q_max (mmol/g)"] }] },
  ];

  it("snaps a spec name to the source wording on a strong single-match (case/spacing only)", () => {
    // "mape" normalizes to the attested "MAPE" -> snap to the source spelling.
    const out = snapColumnsToParsedHeaders({
      columnDefinitions: ["Adsorbent", "mape"],
      parsedMatrices,
    });
    assert.deepEqual(out.columns, ["Adsorbent", "MAPE"]);
    assert.equal(out.snappedCount, 1);
    assert.deepEqual(out.grounding[1], { column: "MAPE", grounded: true, snappedFrom: "mape" });
    // Adsorbent already matches the source wording exactly -> grounded, no snap.
    assert.deepEqual(out.grounding[0], { column: "Adsorbent", grounded: true });
  });

  it("does NOT rename a genuinely different metric (R2 stays, flagged not grounded)", () => {
    const out = snapColumnsToParsedHeaders({
      columnDefinitions: ["R2"],
      parsedMatrices,
    });
    assert.deepEqual(out.columns, ["R2"]);
    assert.equal(out.snappedCount, 0);
    assert.deepEqual(out.grounding[0], { column: "R2", grounded: false });
  });

  it("leaves an ambiguous key untouched (same normalized key, two source spellings)", () => {
    const ambiguous = [
      { tables: [{ headers: ["q_max (mmol/g)"] }] },
      { tables: [{ headers: ["q max (mmol/g)"] }] },
    ];
    const out = snapColumnsToParsedHeaders({
      columnDefinitions: ["q_max (mmol/g)"],
      parsedMatrices: ambiguous,
    });
    assert.deepEqual(out.columns, ["q_max (mmol/g)"]);
    assert.equal(out.snappedCount, 0);
    assert.deepEqual(out.grounding[0], { column: "q_max (mmol/g)", grounded: true });
  });

  it("is a fail-soft no-op when there is no parsed vocabulary", () => {
    const out = snapColumnsToParsedHeaders({
      columnDefinitions: ["Adsorbent", "MAPE"],
      parsedMatrices: [],
    });
    assert.deepEqual(out.columns, ["Adsorbent", "MAPE"]);
    assert.equal(out.snappedCount, 0);
    assert.ok(out.grounding.every((g) => g.grounded === false));
  });

  it("handles undefined columnDefinitions without throwing", () => {
    const out = snapColumnsToParsedHeaders({ columnDefinitions: undefined, parsedMatrices });
    assert.deepEqual(out.columns, []);
    assert.deepEqual(out.grounding, []);
    assert.equal(out.snappedCount, 0);
  });
});
