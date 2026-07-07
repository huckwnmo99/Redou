import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChunkSpans,
  mapOffsetToChunk,
  ADSORPTION_PROMPT_DESCRIPTION,
  ADSORPTION_EXAMPLES,
} from "../electron/langextract-client.mjs";

// tool-ab-adoption slice 04 — measurement-only LangExtract client. These tests
// cover the PURE grounding math (char_offset → Redou chunk coordinate mapping,
// the D3 axis the A/B gate decides on) and the few-shot schema shape. The live
// /extract call and /health are exercised by scripts/ab-langextract.mjs against
// the running sidecar; they are not unit-tested here (no network in CI).

describe("buildChunkSpans — concatenation + absolute spans", () => {
  const chunks = [
    { chunkOrder: 1, text: "alpha beta", startCharOffset: 0 },
    { chunkOrder: 2, text: "gamma", startCharOffset: 11 },
    { chunkOrder: 3, text: "delta epsilon", startCharOffset: 17 },
  ];

  it("joins chunk text with the separator", () => {
    const { text } = buildChunkSpans(chunks, "\n\n");
    assert.equal(text, "alpha beta\n\ngamma\n\ndelta epsilon");
  });

  it("computes each chunk's absolute [start,end) in the joined text", () => {
    const { text, spans } = buildChunkSpans(chunks, "\n\n");
    assert.equal(spans.length, 3);
    // span text must equal the slice of the joined text at [absStart, absEnd).
    for (let i = 0; i < spans.length; i++) {
      assert.equal(text.slice(spans[i].absStart, spans[i].absEnd), chunks[i].text);
    }
    // spans carry the ORIGINAL chunk coordinate (startCharOffset) for back-mapping.
    assert.equal(spans[1].startCharOffset, 11);
    assert.equal(spans[1].chunkOrder, 2);
  });

  it("accounts for a multi-char separator between spans", () => {
    const { spans } = buildChunkSpans(chunks, "\n\n");
    // gamma starts right after "alpha beta"(10) + separator(2) = 12.
    assert.equal(spans[1].absStart, 12);
    assert.equal(spans[1].absEnd, 17);
  });

  it("handles empty input and default separator", () => {
    assert.deepEqual(buildChunkSpans([]), { text: "", spans: [] });
    const { text } = buildChunkSpans([{ text: "x" }, { text: "y" }]);
    assert.equal(text, "x\n\ny"); // default separator is \n\n
  });
});

describe("mapOffsetToChunk — offset → chunk coordinate", () => {
  const { spans } = buildChunkSpans(
    [
      { chunkOrder: 1, text: "alpha beta", startCharOffset: 0 },
      { chunkOrder: 2, text: "gamma", startCharOffset: 100 },
    ],
    "\n\n",
  );

  it("resolves an offset inside the first chunk", () => {
    // offset 6 → 'b' of "beta", chunk 1, in-chunk offset 0 + (6-0) = 6.
    assert.deepEqual(mapOffsetToChunk(6, spans), { chunkOrder: 1, offsetInChunk: 6 });
  });

  it("translates into the ORIGINAL chunk's startCharOffset coordinate", () => {
    // "gamma" absStart is 12 (10 + 2 sep). An offset of 13 is 1 char into gamma,
    // whose original startCharOffset is 100 → 100 + (13-12) = 101.
    assert.deepEqual(mapOffsetToChunk(13, spans), { chunkOrder: 2, offsetInChunk: 101 });
  });

  it("returns nulls for an offset in the separator gap or out of range", () => {
    // offset 10/11 fall in the "\n\n" between chunk 1 (ends 10) and chunk 2 (starts 12).
    assert.deepEqual(mapOffsetToChunk(11, spans), { chunkOrder: null, offsetInChunk: null });
    assert.deepEqual(mapOffsetToChunk(9999, spans), { chunkOrder: null, offsetInChunk: null });
  });

  it("returns nulls for a missing offset", () => {
    assert.deepEqual(mapOffsetToChunk(null, spans), { chunkOrder: null, offsetInChunk: null });
    assert.deepEqual(mapOffsetToChunk(undefined, spans), { chunkOrder: null, offsetInChunk: null });
  });
});

describe("adsorption few-shot schema (A/B)", () => {
  it("prompt description forces the pressure-range condition (D1)", () => {
    assert.match(ADSORPTION_PROMPT_DESCRIPTION, /pressure range/i);
    assert.match(ADSORPTION_PROMPT_DESCRIPTION, /condition/i);
  });

  it("examples carry property/value/unit/condition attributes with pressure ranges", () => {
    assert.ok(Array.isArray(ADSORPTION_EXAMPLES) && ADSORPTION_EXAMPLES.length >= 1);
    const allExtractions = ADSORPTION_EXAMPLES.flatMap((ex) => ex.extractions);
    assert.ok(allExtractions.length >= 3, "need several few-shot extractions");
    for (const e of allExtractions) {
      assert.equal(typeof e.extraction_class, "string");
      assert.equal(typeof e.extraction_text, "string");
      for (const key of ["property", "value", "unit", "condition"]) {
        assert.ok(key in e.attributes, `example attribute ${key} required`);
      }
    }
    // The two pressure-range scenarios the fixture distinguishes must both appear,
    // so the schema demonstrably teaches D1 condition separation.
    const conditions = allExtractions.map((e) => e.attributes.condition).join(" ┃ ");
    assert.match(conditions, /1000 kPa/);
    assert.match(conditions, /100 kPa/);
    // q_m must appear twice with DIFFERENT values under different conditions
    // (the exact defect the A/B tests: same parameter, two pressure ranges).
    const qm = allExtractions.filter((e) => e.attributes.property === "q_m");
    assert.ok(qm.length >= 2, "q_m must be exemplified under >=2 conditions");
    assert.ok(new Set(qm.map((e) => e.attributes.value)).size >= 2, "q_m values must differ across conditions");
  });
});
