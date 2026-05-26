import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  rrfFusionWithGraph,
  runGraphEnhancedRag,
} from "../electron/graph-search.mjs";

function createGraphSupabase() {
  const calls = [];

  return {
    calls,
    supabase: {
      from(table) {
        if (table === "entities") {
          return {
            select(columns) {
              calls.push({ type: "select", table, columns });
              return {
                in(column, values) {
                  calls.push({ type: "from", table, column, values });
                  return Promise.resolve({
                    data: [{
                      entity_id: "entity-co2",
                      paper_id: "paper-1",
                      canonical_name: "co2",
                      entity_type: "material",
                      alias_of: null,
                    }],
                  });
                },
              };
            },
          };
        }

        if (table === "paper_chunks") {
          return {
            select() {
              return {
                in(column, values) {
                  calls.push({ type: "from", table, column, values });
                  return Promise.resolve({
                    data: [{
                      chunk_id: "graph-chunk",
                      paper_id: "paper-1",
                      section: "Results",
                      page_start: 4,
                      text: "CO2 capture capacity improves after amine functionalization.",
                    }],
                  });
                },
              };
            },
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
      rpc(name, args) {
        calls.push({ type: "rpc", name, args });

        if (name === "resolve_same_as") {
          return Promise.resolve({ data: [{ entity_id: "entity-co2" }] });
        }

        if (name === "graph_traverse_1hop") {
          return Promise.resolve({
            data: [{
              entity_id: "entity-co2",
              related_entity_id: "entity-amine",
              chunk_id: "graph-chunk",
              relation_type: "enhances",
              relation_weight: 0.91,
            }],
          });
        }

        throw new Error(`unexpected rpc ${name}`);
      },
    },
  };
}

describe("graph-enhanced RAG", () => {
  it("keeps base chunks and appends graph evidence through RRF", () => {
    const fused = rrfFusionWithGraph(
      [{ chunk_id: "base-chunk", text: "base" }],
      [{ chunk_id: "graph-chunk", text: "graph" }],
    );

    assert.deepEqual(fused.map((chunk) => chunk.chunk_id), ["base-chunk", "graph-chunk"]);
    assert.equal(fused.find((chunk) => chunk.chunk_id === "graph-chunk")?._graphEnhanced, true);
  });

  it("passes abort signals into base RAG and query entity extraction", async () => {
    const abortController = new AbortController();
    const observedSignals = [];

    const result = await runGraphEnhancedRag(
      [{ query: "co2 capture capacity", intent: "primary" }],
      [],
      ["paper-1"],
      "qa",
      { rpc: async () => ({ data: [] }) },
      {
        abortSignal: abortController.signal,
        generateEmbedding: async () => [0.1, 0.2],
        modelName: "fake-model",
        runMultiQueryRag: async (_queries, _hints, _paperIds, _mode, options) => {
          observedSignals.push(options?.abortSignal);
          return { chunks: [{ chunk_id: "base-chunk", paper_id: "paper-1" }], figures: [] };
        },
        extractQueryEntitiesFn: async (_query, _model, signal) => {
          observedSignals.push(signal);
          return [];
        },
      },
    );

    assert.deepEqual(observedSignals, [abortController.signal, abortController.signal]);
    assert.deepEqual(result.chunks.map((chunk) => chunk.chunk_id), ["base-chunk"]);
  });

  it("adds graph chunks for matched query entities in QA mode", async () => {
    const { calls, supabase } = createGraphSupabase();

    const result = await runGraphEnhancedRag(
      [{ query: "co2 capture capacity", intent: "primary" }],
      [],
      ["paper-1"],
      "qa",
      supabase,
      {
        generateEmbedding: async () => [0.2, 0.4],
        modelName: "fake-model",
        runMultiQueryRag: async () => ({
          chunks: [{ chunk_id: "base-chunk", paper_id: "paper-1", text: "base" }],
          figures: [],
        }),
        extractQueryEntitiesFn: async () => [{
          name: "CO2",
          type: "material",
          confidence: 0.9,
        }],
      },
    );

    assert.ok(result.chunks.some((chunk) => chunk.chunk_id === "base-chunk"));
    assert.ok(result.chunks.some((chunk) => chunk.chunk_id === "graph-chunk"));
    assert.equal(result.graph.queryEntityCount, 1);
    assert.equal(result.graph.graphChunkCount, 1);
    assert.ok(calls.some((call) => call.type === "rpc" && call.name === "graph_traverse_1hop"));
    assert.ok(calls.every((call) => !String(call.columns ?? "").includes("alias_of")));
  });
});
