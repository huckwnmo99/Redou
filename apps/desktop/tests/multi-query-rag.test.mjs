import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMultiQueryRag,
  rrfFusion,
  rrfFusionFigures,
} from "../electron/rag/multi-query-rag.mjs";

function createRecordingRpc(resolver) {
  const calls = [];
  return {
    calls,
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return resolver(name, args);
      },
    },
  };
}

function quietLogger() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("multi-query RAG helpers", () => {
  it("fuses vector and BM25 chunk ranks with table-mode weighting", () => {
    const fused = rrfFusion(
      [
        { chunk_id: "vector-only", similarity: 0.9 },
        { chunk_id: "both", similarity: 0.7 },
      ],
      [
        { chunk_id: "bm25-only", bm25_rank: 12 },
        { chunk_id: "both", bm25_rank: 8 },
      ],
      "table",
    );

    assert.deepEqual(fused.map((chunk) => chunk.chunk_id), ["both", "bm25-only", "vector-only"]);
    assert.ok(fused.every((chunk) => typeof chunk._rrfScore === "number"));
  });

  it("boosts table figures when fusing vector and BM25 figure ranks", () => {
    const fused = rrfFusionFigures(
      [
        { figure_id: "figure-1", item_type: "figure", similarity: 0.95 },
        { figure_id: "table-1", item_type: "table", similarity: 0.8 },
      ],
      [{ figure_id: "table-1", item_type: "table", bm25_rank: 20 }],
    );

    assert.equal(fused[0].figure_id, "table-1");
  });

  it("runs table-mode vector, BM25, figure, and figure-BM25 RPCs with paper filters", async () => {
    const { calls, supabase } = createRecordingRpc((name) => {
      if (name === "match_chunks") {
        return { data: [{ chunk_id: "chunk-vector", paper_id: "paper-1", text: "vector", similarity: 0.8 }] };
      }
      if (name === "match_chunks_bm25") {
        return { data: [{ chunk_id: "chunk-bm25", paper_id: "paper-1", text: "bm25", bm25_rank: 5 }] };
      }
      if (name === "match_figures") {
        return { data: [{ figure_id: "figure-vector", paper_id: "paper-1", item_type: "figure", similarity: 0.7 }] };
      }
      if (name === "match_figures_bm25") {
        return { data: [{ figure_id: "table-bm25", paper_id: "paper-1", item_type: "table", bm25_rank: 10 }] };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const { runMultiQueryRag } = createMultiQueryRag({
      supabase,
      generateEmbedding: async (query) => [query.length],
      isRerankerAvailable: async () => false,
      logger: quietLogger(),
    });

    const result = await runMultiQueryRag([{ query: "alpha", intent: "primary" }], [], ["paper-1"], "table");

    assert.deepEqual(calls.map((call) => call.name), [
      "match_chunks",
      "match_chunks_bm25",
      "match_figures",
      "match_figures_bm25",
    ]);
    assert.ok(calls.every((call) => call.args.filter_paper_ids[0] === "paper-1"));
    assert.deepEqual(calls.find((call) => call.name === "match_chunks")?.args.boost_section_names, null);
    assert.equal(calls.find((call) => call.name === "match_chunks")?.args.section_boost, 0.08);
    assert.deepEqual(result.chunks.map((chunk) => chunk.chunk_id), ["chunk-bm25", "chunk-vector"]);
    assert.deepEqual(result.figures.map((figure) => figure.figure_id), ["table-bm25", "figure-vector"]);
  });

  it("aborts after embedding before starting Supabase RPCs", async () => {
    const abortController = new AbortController();
    const { calls, supabase } = createRecordingRpc(() => {
      throw new Error("RPC should not run after abort");
    });
    const { runMultiQueryRag } = createMultiQueryRag({
      supabase,
      generateEmbedding: async () => {
        abortController.abort();
        return [0.1, 0.2];
      },
      isRerankerAvailable: async () => false,
      logger: quietLogger(),
    });

    await assert.rejects(
      () => runMultiQueryRag([{ query: "abort", intent: "primary" }], [], ["paper-1"], "table", {
        abortSignal: abortController.signal,
      }),
      (err) => err?.name === "AbortError",
    );
    assert.equal(calls.length, 0);
  });

  it("runs paper-scoped recovery through table RAG with the paper filter", async () => {
    const { calls, supabase } = createRecordingRpc((name) => {
      if (name === "match_chunks") {
        return { data: [{ chunk_id: "chunk-recovery", paper_id: "paper-9", text: "recovered", similarity: 0.9 }] };
      }
      return { data: [] };
    });
    const { runPaperScopedRecoverySearch } = createMultiQueryRag({
      supabase,
      generateEmbedding: async () => [0.3],
      isRerankerAvailable: async () => false,
      logger: quietLogger(),
    });

    const result = await runPaperScopedRecoverySearch([{ query: "missing outcome", intent: "recovery" }], "paper-9");

    assert.deepEqual(result.chunks.map((chunk) => chunk.chunk_id), ["chunk-recovery"]);
    assert.ok(calls.every((call) => call.args.filter_paper_ids[0] === "paper-9"));
    assert.ok(calls.some((call) => call.name === "match_figures_bm25"));
  });
});
