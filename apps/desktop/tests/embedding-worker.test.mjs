import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { EMBEDDING_DIM, generateEmbeddings } from "../electron/embedding-worker.mjs";

// generateEmbeddings depends on the module-internal callVllmSingle, which uses
// the global fetch. We stub globalThis.fetch so specific chunk texts fail while
// others succeed, then assert the batch isolates failures (A-R1).

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Build a fake fetch that returns a 2048-dim embedding for every text except
 * those whose text is listed in `failTexts` (those get a 500 response).
 */
function stubFetch(failTexts) {
  const failing = new Set(failTexts);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const text = body.messages[0].content.find((c) => c.type === "text")?.text ?? "";
    if (failing.has(text)) {
      return {
        ok: false,
        status: 500,
        text: async () => "simulated vLLM error",
      };
    }
    // Non-zero constant vector so normalization is stable and deterministic.
    const embedding = new Array(EMBEDDING_DIM).fill(1);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding }] }),
    };
  };
}

describe("generateEmbeddings partial-failure isolation (A-R1)", () => {
  it("keeps successful embeddings and leaves failed slots undefined instead of throwing", async () => {
    // 10 texts spanning two batches (CONCURRENCY_LIMIT = 8); fail indices 3 and 8.
    const texts = Array.from({ length: 10 }, (_, i) => `chunk-${i}`);
    stubFetch(["chunk-3", "chunk-8"]);

    const results = await generateEmbeddings(texts);

    assert.equal(results.length, texts.length, "length must equal input length");
    assert.equal(results[3], undefined, "failed index 3 stays undefined");
    assert.equal(results[8], undefined, "failed index 8 stays undefined");

    const succeeded = results.filter((r) => r != null);
    assert.equal(succeeded.length, 8, "8 of 10 chunks succeed");
    for (const r of succeeded) {
      assert.equal(r.length, EMBEDDING_DIM, "each success is a full-dim vector");
    }
  });

  it("reports only successful count via onProgress and does not reject on partial failure", async () => {
    const texts = Array.from({ length: 4 }, (_, i) => `t-${i}`);
    stubFetch(["t-1"]);

    let lastDone = -1;
    const results = await generateEmbeddings(texts, (done, total) => {
      lastDone = done;
      assert.equal(total, texts.length, "total reflects input length");
    });

    assert.equal(lastDone, 3, "progress counts only the 3 successful chunks");
    assert.equal(results[1], undefined, "the single failed chunk stays undefined");
    assert.equal(results.filter((r) => r != null).length, 3);
  });

  it("still returns an all-undefined array (no throw) when every chunk fails", async () => {
    const texts = ["a", "b", "c"];
    stubFetch(["a", "b", "c"]);

    const results = await generateEmbeddings(texts);

    assert.equal(results.length, 3);
    assert.deepEqual(
      results.filter((r) => r != null),
      [],
      "no embeddings survive when all fail",
    );
  });
});
