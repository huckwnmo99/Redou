import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runQaConversationPipeline,
  orderPaperMetadataDeterministic,
  checkQaCitations,
} from "../electron/chat/qa-pipeline.mjs";
import { formatSourceAttribution } from "../electron/llm-qa.mjs";

function createAbortError(message = "Aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

// Fake Supabase mirroring the table-pipeline test recorder: records inserts/updates
// and resolves table reads from `fixtures`. `.single()` returns a stable row id so the
// pipeline's unwrapSingle succeeds; `.in()`-scoped reads (papers) resolve via `then`.
function createRecordingSupabase(fixtures = {}) {
  const inserts = [];
  const updates = [];

  const fakeBuilder = (table, state = {}) => ({
    insert: (data) => {
      inserts.push({ table, data });
      return fakeBuilder(table, { singleData: { id: `${table}-row` } });
    },
    update: (data) => {
      updates.push({ table, data });
      return fakeBuilder(table);
    },
    select: (columns) => fakeBuilder(table, { ...state, select: columns }),
    eq: (column, value) => fakeBuilder(table, {
      ...state,
      eq: [...(state.eq ?? []), { column, value }],
    }),
    in: (column, values) => fakeBuilder(table, {
      ...state,
      in: [...(state.in ?? []), { column, values }],
    }),
    order: () => fakeBuilder(table, state),
    limit: () => fakeBuilder(table, state),
    single: () => Promise.resolve({ data: state.singleData ?? { id: `${table}-row` }, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve, reject) => {
      const fixture = fixtures[table];
      const data = typeof fixture === "function" ? fixture(state) : fixture;
      return Promise.resolve({ data: data ?? [], error: null }).then(resolve, reject);
    },
  });

  return { supabase: { from: fakeBuilder }, inserts, updates };
}

// Async-generator stand-in for generateQaResponse: yields the given tokens.
function makeQaResponseFn(tokens) {
  return async function* qaResponse() {
    for (const token of tokens) yield token;
  };
}

// Minimal happy-path dependency set. Individual tests override what they exercise.
function baseDeps(overrides = {}) {
  return {
    conversationId: "conv-qa",
    message: "What is the capacity?",
    history: [{ role: "user", content: "What is the capacity?", message_type: "text" }],
    scopeFolderId: null,
    scopeAll: true,
    ownerPaperIds: ["paper-1"],
    ownerId: "user-1",
    abortSignal: new AbortController().signal,
    emitStatus: () => {},
    emitToken: () => {},
    emitComplete: () => {},
    getEntityGraphEnabledFn: async () => false,
    getEntityExtractionModelFn: async () => "test-model",
    generateEmbeddingFn: async () => [0, 0, 0],
    getPaperIdsInFolderTreeFn: async () => [],
    runMultiQueryRagFn: async () => ({
      chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "capacity is high", page: 3 }],
      figures: [],
    }),
    runGraphEnhancedRagFn: async () => ({
      chunks: [{ chunk_id: "chunk-g", paper_id: "paper-1", text: "graph evidence", page: 5 }],
      figures: [],
    }),
    generateQaResponseFn: makeQaResponseFn(["The capacity is high [1]."]),
    formatSourceAttributionFn: () => ({ text: "final", referencedPaperIds: [] }),
    ...overrides,
  };
}

describe("runQaConversationPipeline", () => {
  it("uses plain multi-query RAG when the entity graph is OFF (graph fn not called)", async () => {
    const { supabase } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Paper One", authors: [{ family: "Kim" }], publication_year: 2024 }],
    });
    const emitted = { status: [], tokens: [], complete: [] };
    let multiQueryArgs;

    const result = await runQaConversationPipeline(baseDeps({
      supabase,
      emitStatus: (s) => emitted.status.push(s),
      emitToken: (t) => emitted.tokens.push(t),
      emitComplete: (c) => emitted.complete.push(c),
      getEntityGraphEnabledFn: async () => false,
      runMultiQueryRagFn: async (queries, keyTerms, filterPaperIds, mode, options) => {
        multiQueryArgs = { queries, keyTerms, filterPaperIds, mode, options };
        return { chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "t", page: 1 }], figures: [] };
      },
      runGraphEnhancedRagFn: async () => {
        assert.fail("runGraphEnhancedRagFn must not be called when graph is OFF");
      },
    }));

    assert.deepEqual(result, { conversationId: "conv-qa", messageId: "chat_messages-row", hasTable: false });
    assert.deepEqual(multiQueryArgs.queries, [{ query: "What is the capacity?", intent: "qa" }]);
    assert.equal(multiQueryArgs.mode, "qa");
    assert.deepEqual(multiQueryArgs.filterPaperIds, ["paper-1"]);
    // no `graphing` status when graph is OFF; searching then answering
    assert.deepEqual(emitted.status.map((s) => s.stage), ["searching", "answering"]);
    assert.equal(emitted.tokens.join(""), "The capacity is high [1].");
  });

  it("expands via the entity graph when ON and emits the graphing status", async () => {
    const { supabase } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Paper One", authors: [{ family: "Kim" }], publication_year: 2024 }],
    });
    const emitted = { status: [] };
    let graphArgs;
    let modelRequested = false;

    await runQaConversationPipeline(baseDeps({
      supabase,
      emitStatus: (s) => emitted.status.push(s),
      getEntityGraphEnabledFn: async () => true,
      getEntityExtractionModelFn: async () => { modelRequested = true; return "graph-model"; },
      runGraphEnhancedRagFn: async (queries, keyTerms, filterPaperIds, mode, sb, opts) => {
        graphArgs = { queries, keyTerms, filterPaperIds, mode, sb, opts };
        return { chunks: [{ chunk_id: "chunk-g", paper_id: "paper-1", text: "g", page: 2 }], figures: [] };
      },
      runMultiQueryRagFn: async () => {
        assert.fail("runMultiQueryRagFn must not be called directly when graph is ON");
      },
    }));

    assert.ok(modelRequested, "entity extraction model should be resolved for graph mode");
    assert.equal(graphArgs.mode, "qa");
    assert.equal(graphArgs.sb, supabase, "graph RAG receives the supabase client");
    assert.equal(graphArgs.opts.modelName, "graph-model");
    assert.equal(typeof graphArgs.opts.runMultiQueryRag, "function");
    assert.deepEqual(emitted.status.map((s) => s.stage), ["searching", "graphing", "answering"]);
  });

  it("returns a no-data text response and completes without streaming when RAG is empty", async () => {
    const { supabase, inserts, updates } = createRecordingSupabase();
    const emitted = { status: [], tokens: [], complete: [] };

    const result = await runQaConversationPipeline(baseDeps({
      supabase,
      emitStatus: (s) => emitted.status.push(s),
      emitToken: (t) => emitted.tokens.push(t),
      emitComplete: (c) => emitted.complete.push(c),
      runMultiQueryRagFn: async () => ({ chunks: [], figures: [] }),
      generateQaResponseFn: makeQaResponseFn(["should not stream"]),
    }));

    assert.deepEqual(result, { conversationId: "conv-qa", messageId: "chat_messages-row", hasTable: false });
    // one assistant text row (no-data), no streaming, conversation touched
    const chatInserts = inserts.filter((e) => e.table === "chat_messages");
    assert.equal(chatInserts.length, 1);
    assert.equal(chatInserts[0].data.message_type, "text");
    assert.match(chatInserts[0].data.content, /관련 데이터를 찾지 못했습니다/);
    assert.equal(emitted.tokens.length, 0, "no tokens should be emitted on no-data");
    assert.deepEqual(emitted.complete, [{ conversationId: "conv-qa", messageId: "chat_messages-row", hasTable: false }]);
    assert.equal(updates.filter((e) => e.table === "chat_conversations").length, 1);
    // no-data branch never advances phase to follow_up
    assert.equal(updates.some((e) => e.data.phase === "follow_up"), false);
  });

  it("throws AbortError after RAG when the signal is already fired and inserts no message", async () => {
    const controller = new AbortController();
    const { supabase, inserts } = createRecordingSupabase();

    await assert.rejects(
      () => runQaConversationPipeline(baseDeps({
        supabase,
        abortSignal: controller.signal,
        runMultiQueryRagFn: async () => {
          controller.abort();
          return { chunks: [{ chunk_id: "c", paper_id: "paper-1", text: "t", page: 1 }], figures: [] };
        },
        generateQaResponseFn: makeQaResponseFn(["never"]),
      })),
      (err) => err?.name === "AbortError",
    );

    assert.equal(
      inserts.filter((e) => e.table === "chat_messages").length,
      0,
      "aborting right after RAG must not persist any assistant message",
    );
  });

  it("intersects the folder scope with owner papers when scopeAll is false", async () => {
    const { supabase } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Paper One", authors: [], publication_year: 2024 }],
    });
    let filterSeen;

    await runQaConversationPipeline(baseDeps({
      supabase,
      scopeAll: false,
      scopeFolderId: "folder-9",
      ownerPaperIds: ["paper-1", "paper-2"],
      // folder tree contains paper-2 and paper-3; only paper-2 is owned -> intersection
      getPaperIdsInFolderTreeFn: async () => ["paper-2", "paper-3"],
      runMultiQueryRagFn: async (queries, keyTerms, filterPaperIds) => {
        filterSeen = filterPaperIds;
        return { chunks: [{ chunk_id: "c", paper_id: "paper-2", text: "t", page: 1 }], figures: [] };
      },
    }));

    assert.deepEqual(filterSeen, ["paper-2"], "out-of-scope papers are filtered from the RAG scope");
  });

  it("persists source attribution and evidence metadata on the final assistant message", async () => {
    const { supabase, inserts, updates } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Paper One", authors: [{ family: "Kim" }], publication_year: 2024 }],
    });

    const result = await runQaConversationPipeline(baseDeps({
      supabase,
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "capacity", page: 3 }],
        figures: [],
      }),
      generateQaResponseFn: makeQaResponseFn(["The capacity is high [1]."]),
      // use the real formatSourceAttribution to lock the [1] -> paper-1 mapping
      formatSourceAttributionFn: formatSourceAttribution,
    }));

    assert.equal(result.hasTable, false);
    const finalInsert = inserts
      .filter((e) => e.table === "chat_messages")
      .map((e) => e.data)
      .find((d) => d.metadata);
    assert.ok(finalInsert, "final assistant message carries metadata");
    assert.deepEqual(finalInsert.metadata.source_chunk_ids, ["chunk-1"]);
    assert.deepEqual(finalInsert.metadata.referenced_paper_ids, ["paper-1"]);
    assert.deepEqual(finalInsert.metadata.source_evidence_locations, { "paper-1": ["Main PDF p.3"] });
    // slice 05: a clean single-paper [1] citation persists a passing citationCheck
    assert.deepEqual(finalInsert.metadata.citationCheck, { citationCount: 1, outOfRange: [], ungroundedRefs: [] });
    // final branch advances the conversation phase to follow_up
    assert.equal(updates.some((e) => e.table === "chat_conversations" && e.data.phase === "follow_up"), true);
  });

  it("records out-of-range and evidence-less citations in metadata without altering the answer", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      // two papers exist in metadata; only paper-1 has RAG evidence below
      papers: [
        { id: "paper-1", title: "Paper One", authors: [{ family: "Kim" }], publication_year: 2024 },
        { id: "paper-2", title: "Paper Two", authors: [{ family: "Lee" }], publication_year: 2023 },
      ],
    });
    const emitted = { tokens: [] };

    // Response cites [1] (grounded: paper-1 in evidence), [2] (in-range but paper-2
    // has no RAG chunk/figure -> ungrounded), and [5] (out of range: only 2 papers).
    const answer = "A [1]. B [2]. C [5].";

    await runQaConversationPipeline(baseDeps({
      supabase,
      emitToken: (t) => emitted.tokens.push(t),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "evidence", page: 3 }],
        figures: [],
      }),
      generateQaResponseFn: makeQaResponseFn([answer]),
      // identity attribution so finalText is exactly the answer (no appended sources)
      formatSourceAttributionFn: (text) => ({ text, referencedPaperIds: [] }),
    }));

    const finalInsert = inserts
      .filter((e) => e.table === "chat_messages")
      .map((e) => e.data)
      .find((d) => d.metadata);
    assert.deepEqual(finalInsert.metadata.citationCheck, {
      citationCount: 3,
      outOfRange: [5],
      ungroundedRefs: [2],
    });
    // records only: the persisted answer text is untouched by the check
    assert.equal(finalInsert.content, answer);
  });
});

describe("orderPaperMetadataDeterministic", () => {
  const meta = (id) => ({ paperId: id, title: id });

  it("orders papers by first-appearance rank in the reranked chunks", () => {
    // metadata arrives in the opposite order of the evidence ranking
    const paperMetadata = [meta("paper-c"), meta("paper-a"), meta("paper-b")];
    const ragResults = {
      chunks: [
        { paper_id: "paper-a" },
        { paper_id: "paper-b" },
        { paper_id: "paper-a" }, // dup: first index wins
        { paper_id: "paper-c" },
      ],
      figures: [],
    };
    const ordered = orderPaperMetadataDeterministic(paperMetadata, ragResults);
    assert.deepEqual(ordered.map((p) => p.paperId), ["paper-a", "paper-b", "paper-c"]);
  });

  it("is deterministic: same input yields the same refNo order regardless of metadata order", () => {
    const ragResults = { chunks: [{ paper_id: "p2" }, { paper_id: "p1" }], figures: [] };
    const orderA = orderPaperMetadataDeterministic([meta("p1"), meta("p2")], ragResults);
    const orderB = orderPaperMetadataDeterministic([meta("p2"), meta("p1")], ragResults);
    assert.deepEqual(orderA.map((p) => p.paperId), ["p2", "p1"]);
    assert.deepEqual(orderB.map((p) => p.paperId), ["p2", "p1"], "metadata input order must not affect output");
  });

  it("ranks chunk-backed papers ahead of figure-only papers", () => {
    const paperMetadata = [meta("fig-only"), meta("chunked")];
    const ragResults = {
      chunks: [{ paper_id: "chunked" }],
      figures: [{ paper_id: "fig-only" }],
    };
    const ordered = orderPaperMetadataDeterministic(paperMetadata, ragResults);
    assert.deepEqual(ordered.map((p) => p.paperId), ["chunked", "fig-only"]);
  });

  it("falls back to lexicographic paperId order for evidence-less papers", () => {
    // neither paper appears in ragResults -> both rank +Infinity, sorted by id
    const ordered = orderPaperMetadataDeterministic([meta("zed"), meta("abe")], { chunks: [], figures: [] });
    assert.deepEqual(ordered.map((p) => p.paperId), ["abe", "zed"]);
  });

  it("does not mutate the input array", () => {
    const paperMetadata = [meta("b"), meta("a")];
    const ragResults = { chunks: [{ paper_id: "a" }], figures: [] };
    orderPaperMetadataDeterministic(paperMetadata, ragResults);
    assert.deepEqual(paperMetadata.map((p) => p.paperId), ["b", "a"], "input order preserved");
  });
});

describe("checkQaCitations", () => {
  const meta = (id) => ({ paperId: id, title: id });

  it("marks in-range citations grounded when the paper is in the RAG evidence set", () => {
    const result = checkQaCitations(
      "Claim [1] and [2].",
      [meta("p1"), meta("p2")],
      { chunks: [{ paper_id: "p1" }], figures: [{ paper_id: "p2" }] },
    );
    assert.deepEqual(result, {
      citationCount: 2,
      inRange: [1, 2],
      outOfRange: [],
      grounded: [1, 2],
      ungroundedRefs: [],
    });
  });

  it("detects out-of-range [N] beyond the paper count", () => {
    const result = checkQaCitations(
      "See [1] and [3].",
      [meta("p1"), meta("p2")], // only 2 papers -> [3] is out of range
      { chunks: [{ paper_id: "p1" }], figures: [] },
    );
    assert.deepEqual(result.outOfRange, [3]);
    assert.deepEqual(result.inRange, [1]);
    assert.equal(result.citationCount, 2);
  });

  it("detects an in-range citation whose paperId is absent from the evidence set", () => {
    const result = checkQaCitations(
      "Grounded [1], evidence-less [2].",
      [meta("p1"), meta("p2")],
      { chunks: [{ paper_id: "p1" }], figures: [] }, // p2 has no evidence
    );
    assert.deepEqual(result.grounded, [1]);
    assert.deepEqual(result.ungroundedRefs, [2]);
    assert.deepEqual(result.outOfRange, []);
  });

  it("deduplicates repeated citations and returns a clean pass when all are grounded", () => {
    const result = checkQaCitations(
      "First [1]. Again [1]. Also [1].",
      [meta("p1")],
      { chunks: [{ paper_id: "p1" }], figures: [] },
    );
    assert.equal(result.citationCount, 1, "repeated [1] counts once");
    assert.deepEqual(result.ungroundedRefs, []);
    assert.deepEqual(result.outOfRange, []);
  });

  it("returns a zero-count pass when the response has no citations", () => {
    const result = checkQaCitations("No brackets here.", [meta("p1")], { chunks: [{ paper_id: "p1" }], figures: [] });
    assert.deepEqual(result, {
      citationCount: 0,
      inRange: [],
      outOfRange: [],
      grounded: [],
      ungroundedRefs: [],
    });
  });
});
