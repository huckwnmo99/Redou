import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runTableConversationPipeline } from "../electron/chat/table-pipeline.mjs";

function createAbortError(message = "Aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function createStage3cDeps(overrides = {}) {
  return {
    generateTableFromSpecFn: async (tableSpec) => ({
      title: tableSpec.title,
      headers: tableSpec.column_definitions ?? [],
      rows: [["fallback"]],
      references: [],
    }),
    ...overrides,
  };
}

function createStage3dDeps(overrides = {}) {
  return {
    runPaperScopedRecoverySearchFn: async () => ({
      chunks: [{ chunk_id: "chunk-recovered", paper_id: "paper-1", text: "Recovered evidence" }],
      figures: [],
    }),
    extractNullCellsFromPaperFn: async () => ({
      data_rows: [{ confidence: "high", values: { Outcome: "Recovered" } }],
    }),
    ...overrides,
  };
}

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
    is: () => fakeBuilder(table, state),
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

  return {
    supabase: { from: fakeBuilder },
    inserts,
    updates,
  };
}

describe("runTableConversationPipeline", () => {
  it("aborts after orchestrator without persisting assistant messages or generated tables", async () => {
    const abortController = new AbortController();
    const { supabase, inserts } = createRecordingSupabase();
    const emitted = { status: [], tokens: [], complete: [], error: [] };

    await assert.rejects(
      () =>
        runTableConversationPipeline({
          supabase,
          emitStatus: (status) => emitted.status.push(status),
          emitToken: (token) => emitted.tokens.push(token),
          emitComplete: (complete) => emitted.complete.push(complete),
          emitError: (error) => emitted.error.push(error),
          abortSignal: abortController.signal,
          conversationId: "conv-1",
          ownerId: "user-1",
          ownerPaperIds: ["paper-1"],
          scopeFolderId: null,
          scopeAll: true,
          message: "make a table",
          history: [],
          generateOrchestratorPlanFn: async () => {
            abortController.abort();
            return {
              action: "generate_table",
              keyword_hints: [],
              search_queries: [{ query: "test", intent: "primary" }],
              table_spec: {
                title: "Test",
                row_axis: "Papers",
                column_definitions: ["Col1"],
              },
            };
          },
          runMultiQueryRagFn: async () => {
            assert.fail("runMultiQueryRagFn should not be called after abort");
          },
        }),
      (err) => err?.name === "AbortError",
    );

    assert.equal(
      inserts.filter((entry) => entry.table === "chat_messages").length,
      0,
      "no assistant message should be inserted after abort",
    );
    assert.equal(
      inserts.filter((entry) => entry.table === "chat_generated_tables").length,
      0,
      "no generated table should be inserted after abort",
    );
    assert.deepEqual(emitted.status, [{ stage: "orchestrating", message: "사용자 요청 분석 중..." }]);
    assert.equal(emitted.complete.length, 0, "CHAT_COMPLETE should not fire on abort");
    assert.equal(emitted.tokens.length, 0, "table mode should not emit tokens before RAG");
  });

  it("loads setup context before calling the orchestrator", async () => {
    const { supabase } = createRecordingSupabase({
      papers: [{
        id: "paper-1",
        title: "Paper One",
        authors: [{ family: "Kim" }, { family: "Lee" }],
        publication_year: 2024,
      }],
      figures: [{
        paper_id: "paper-1",
        figure_no: "Table 1",
        caption: "Baseline table",
      }],
      chat_generated_tables: [{
        table_title: "Previous",
        headers: ["A"],
        rows: [["1"]],
        source_refs: [],
      }],
    });
    let orchestratorInput;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-1",
      ownerId: "user-1",
      history: [{ role: "user", content: "make a table", message_type: "text" }],
      generateOrchestratorPlanFn: async (history, paperList, previousTable) => {
        orchestratorInput = { history, paperList, previousTable };
        return {
          action: "generate_table",
          keyword_hints: [],
          search_queries: [{ query: "test", intent: "primary" }],
          table_spec: { title: "Test", row_axis: "Papers", column_definitions: [] },
        };
      },
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "paper text" }],
        figures: [],
      }),
      ...createStage3cDeps(),
    });

    assert.equal(result.shellOnly, undefined);
    assert.deepEqual(orchestratorInput.paperList, [{
      title: "Paper One",
      authors: "Kim, Lee",
      year: 2024,
      tableCaptions: [{ figureNo: "Table 1", caption: "Baseline table" }],
    }]);
    assert.deepEqual(orchestratorInput.previousTable, {
      table_title: "Previous",
      headers: ["A"],
      rows: [["1"]],
      source_refs: [],
    });
  });

  it("handles clarify responses without falling back to the legacy table body", async () => {
    const { supabase, inserts, updates } = createRecordingSupabase();
    const emitted = { status: [], tokens: [], complete: [] };

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: (status) => emitted.status.push(status),
      emitToken: (token) => emitted.tokens.push(token),
      emitComplete: (complete) => emitted.complete.push(complete),
      abortSignal: new AbortController().signal,
      conversationId: "conv-clarify",
      ownerId: "user-1",
      history: [{ role: "user", content: "make a table", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "clarify",
        clarification_response: "Which outcome should I compare?",
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "paper text" }],
        figures: [],
      }),
      ...createStage3cDeps(),
    });

    assert.deepEqual(result, {
      conversationId: "conv-clarify",
      messageId: "chat_messages-row",
      hasTable: false,
    });
    assert.deepEqual(emitted.status.at(-1), { stage: null, message: "" });
    assert.equal(emitted.tokens.join(""), "Which outcome should I compare?");
    assert.deepEqual(emitted.complete, [{
      conversationId: "conv-clarify",
      messageId: "chat_messages-row",
      hasTable: false,
    }]);
    assert.deepEqual(inserts.filter((entry) => entry.table === "chat_messages").map((entry) => entry.data), [{
      conversation_id: "conv-clarify",
      role: "assistant",
      content: "Which outcome should I compare?",
      message_type: "text",
    }]);
    assert.equal(updates.filter((entry) => entry.table === "chat_conversations").length, 1);
  });

  it("promotes repeated clarify responses to a generate_table fallback", async () => {
    const { supabase, inserts } = createRecordingSupabase();
    let generatedSpec;
    let ragInput;
    const history = [
      { role: "user", content: "make a comparison table for kinase outcomes", message_type: "text" },
      { role: "assistant", content: "Which papers?", message_type: "text" },
      { role: "assistant", content: "Which columns?", message_type: "text" },
      { role: "assistant", content: "Which outcome?", message_type: "text" },
    ];

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-guardrail",
      ownerId: "user-1",
      history,
      generateOrchestratorPlanFn: async () => ({
        action: "clarify",
        clarification_response: "Which outcome should I compare?",
      }),
      runMultiQueryRagFn: async (searchQueries, keywordHints, filterPaperIds, mode) => {
        ragInput = { searchQueries, keywordHints, filterPaperIds, mode };
        return {
          chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "paper text" }],
          figures: [],
        };
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async (tableSpec) => {
          generatedSpec = tableSpec;
          return {
            title: tableSpec.title,
            headers: tableSpec.column_definitions ?? [],
            rows: [["fallback"]],
            references: [],
          };
        },
      }),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.deepEqual(ragInput.searchQueries, [{
      query: "make a comparison table for kinase outcomes",
      intent: "user request fallback",
    }]);
    assert.deepEqual(ragInput.keywordHints, []);
    assert.equal(ragInput.mode, "table");
    assert.deepEqual(generatedSpec, {
      title: "\uC790\uB3D9 \uC0DD\uC131 \uD14C\uC774\uBE14",
      row_axis: "\uAC01 \uB370\uC774\uD130 \uD3EC\uC778\uD2B8",
      column_definitions: [],
      inclusion_criteria: "",
      exclusion_criteria: "",
    });
    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 1);
    assert.equal(inserts.filter((entry) => entry.table === "chat_generated_tables").length, 1);
  });

  it("returns a no-data text response when table RAG finds no evidence", async () => {
    const { supabase, inserts, updates } = createRecordingSupabase();
    const emitted = { status: [], complete: [] };
    let ragInput;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: (status) => emitted.status.push(status),
      emitComplete: (complete) => emitted.complete.push(complete),
      abortSignal: new AbortController().signal,
      conversationId: "conv-no-data",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "make a table", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["kinase"],
        search_queries: [{ query: "kinase", intent: "primary" }],
        table_spec: { title: "Kinase", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async (searchQueries, keywordHints, filterPaperIds, mode) => {
        ragInput = { searchQueries, keywordHints, filterPaperIds, mode };
        return { chunks: [], figures: [] };
      },
    });

    assert.deepEqual(ragInput, {
      searchQueries: [{ query: "kinase", intent: "primary" }],
      keywordHints: ["kinase"],
      filterPaperIds: ["paper-1"],
      mode: "table",
    });
    assert.deepEqual(result, {
      conversationId: "conv-no-data",
      messageId: "chat_messages-row",
      hasTable: false,
    });
    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 1);
    assert.equal(updates.filter((entry) => entry.table === "chat_conversations").length, 1);
    assert.deepEqual(emitted.complete, [result]);
    assert.deepEqual(emitted.status.at(-1), {
      stage: "searching",
      message: "\uAD00\uB828 \uB17C\uBB38 \uB370\uC774\uD130 \uAC80\uC0C9 \uC911...",
      detail: "1\uAC1C \uCFFC\uB9AC \uC2E4\uD589",
    });
  });

  it("prepares RAG metadata and backfilled table figures before shell continuation", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{
        id: "paper-2",
        title: "Scoped Paper",
        authors: [{ family: "Park" }],
        publication_year: 2025,
        journal_name: "Redou Journal",
        doi: "10.0000/redou",
      }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [
          {
            id: "fig-1",
            paper_id: "paper-2",
            source_file_id: "source-existing",
            figure_no: "Table 1",
            caption: "Already in RAG",
            item_type: "table",
            summary_text: "existing",
            page: 1,
          },
          {
            id: "fig-2",
            paper_id: "paper-2",
            source_file_id: "source-1",
            figure_no: "Table 2",
            caption: "Backfilled table",
            item_type: "table",
            summary_text: "backfilled",
            page: 2,
          },
        ];
      },
    });
    let ragInput;
    let generatedRagContext;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-rag",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1", "paper-2"],
      scopeFolderId: "folder-a",
      scopeAll: false,
      history: [{ role: "user", content: "make a table", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["scoped"],
        search_queries: [{ query: "scoped", intent: "primary" }],
        table_spec: { title: "Scoped", row_axis: "Papers", column_definitions: [] },
      }),
      getPaperIdsInFolderTreeFn: async (folderId) => {
        assert.equal(folderId, "folder-a");
        return ["paper-2", "paper-3"];
      },
      runMultiQueryRagFn: async (searchQueries, keywordHints, filterPaperIds, mode) => {
        ragInput = { searchQueries, keywordHints, filterPaperIds, mode };
        return {
          chunks: [{ chunk_id: "chunk-1", paper_id: "paper-2", text: "chunk text" }],
          figures: [{
            figure_id: "fig-1",
            paper_id: "paper-2",
            source_file_id: "source-existing",
            figure_no: "Table 1",
            caption: "Already in RAG",
            item_type: "table",
            summary_text: "existing",
            page: 1,
          }],
        };
      },
      loadSourceFileMetadataMapFn: async () => new Map([[
        "source-1",
        { source_file_kind: "supplementary_pdf", source_filename: "supp.pdf" },
      ]]),
      ...createStage3cDeps({
        generateTableFromSpecFn: async (tableSpec, ragContext) => {
          generatedRagContext = ragContext;
          return {
            title: tableSpec.title,
            headers: tableSpec.column_definitions ?? [],
            rows: [["fallback"]],
            references: [],
          };
        },
      }),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.deepEqual(ragInput.filterPaperIds, ["paper-2"]);
    assert.match(generatedRagContext, /chunk text/);

    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.deepEqual(tableInsert.data.source_refs, [{
      refNo: "1",
      paperId: "paper-2",
      title: "Scoped Paper",
      authors: "Park",
      year: 2025,
      doi: "10.0000/redou",
      evidenceLocations: ["Main PDF", "Main PDF p.1", "Supplementary: supp.pdf, p.2"],
      evidenceSummary: "Main PDF; Main PDF p.1; Supplementary: supp.pdf, p.2",
      hasSupplementaryEvidence: true,
    }]);
    assert.deepEqual(tableInsert.data.metadata.sourceEvidenceLocations, {
      "paper-2": ["Main PDF", "Main PDF p.1", "Supplementary: supp.pdf, p.2"],
    });
  });

  it("persists table reports with extraction metadata and cleaned cell values before shell continuation", async () => {
    const { supabase, inserts, updates } = createRecordingSupabase({
      papers: [{
        id: "paper-1",
        title: "Persistence Paper",
        authors: [{ family: "Kim" }],
        publication_year: 2026,
        journal_name: "Redou Journal",
        doi: "10.1000/persist",
      }],
      figures: [],
    });
    const emitted = { complete: [] };

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      emitComplete: (complete) => emitted.complete.push(complete),
      abortSignal: new AbortController().signal,
      conversationId: "conv-persist",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "persist table", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["persist"],
        search_queries: [{ query: "persist", intent: "primary" }],
        table_spec: { title: "Persistence", row_axis: "Papers", column_definitions: ["Value"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "Value .25", page: 7 }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async () => ({ paper_title: "Persistence Paper", data_rows: [{ values: { Value: ".25" } }] }),
      ...createStage3cDeps(),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.equal(result.messageId, "chat_messages-row");
    assert.equal(result.tableId, "chat_generated_tables-row");
    assert.deepEqual(emitted.complete, [{
      conversationId: "conv-persist",
      messageId: "chat_messages-row",
      hasTable: true,
      tableId: "chat_generated_tables-row",
    }]);

    assert.deepEqual(inserts.map((entry) => entry.table), ["chat_messages", "chat_generated_tables"]);
    const messageInsert = inserts.find((entry) => entry.table === "chat_messages");
    assert.equal(messageInsert.data.message_type, "table_report");
    assert.deepEqual(JSON.parse(messageInsert.data.content).rows, [["0.25 [1]"]]);
    assert.deepEqual(messageInsert.data.metadata, {
      source_chunk_ids: ["chunk-1"],
      source_evidence_locations: { "paper-1": ["Main PDF p.7"] },
    });

    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.deepEqual(tableInsert.data.rows, [["0.25 [1]"]]);
    assert.deepEqual(tableInsert.data.source_refs, [{
      refNo: "1",
      paperId: "paper-1",
      title: "Persistence Paper",
      authors: "Kim",
      year: 2026,
      doi: "10.1000/persist",
      evidenceLocations: ["Main PDF p.7"],
      evidenceSummary: "Main PDF p.7",
      hasSupplementaryEvidence: false,
    }]);
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    assert.equal(typeof tableInsert.data.metadata.stage3bMs, "number");
    assert.equal(tableInsert.data.metadata.perPaperTiming.length, 1);
    assert.equal(tableInsert.data.metadata.perPaperTiming[0].paperId, "paper-1");
    assert.equal(tableInsert.data.metadata.perPaperTiming[0].success, true);
    assert.equal(typeof tableInsert.data.metadata.perPaperTiming[0].ms, "number");
    assert.deepEqual(tableInsert.data.metadata.partialFailures, []);
    assert.deepEqual(tableInsert.data.metadata.nullSummary, { totalNulls: 0, totalCells: 1, droppedRowCount: 0, details: [] });
    assert.equal(tableInsert.data.metadata.agenticRecovery.skippedReason, "gate_not_met");
    assert.equal(tableInsert.data.metadata.tableSpecAdherence, null);
    assert.deepEqual(tableInsert.data.metadata.sourceEvidenceLocations, { "paper-1": ["Main PDF p.7"] });
    // Phase 1: cellTuples reach metadata (aligned with rows, null when no cell_meta);
    // no column_semantic_types on this spec -> null; no conditions -> no conflicts.
    assert.deepEqual(tableInsert.data.metadata.cellTuples, [[null]]);
    assert.equal(tableInsert.data.metadata.columnSemanticTypes, null);
    assert.deepEqual(tableInsert.data.metadata.conditionConflicts, []);

    assert.equal(updates.some((entry) => entry.table === "chat_conversations" && entry.data.phase === "follow_up"), true);
    assert.equal(
      updates.some((entry) => entry.table === "chat_messages" && entry.data.metadata?.table_id === "chat_generated_tables-row"),
      true,
    );
  });

  it("schedules Guardian verification after table persistence and returns without shellOnly", async () => {
    const { supabase, updates } = createRecordingSupabase({
      papers: [{
        id: "paper-1",
        title: "Guardian Paper",
        authors: [],
        publication_year: 2026,
      }],
      figures: [],
    });
    const emitted = { status: [], verificationDone: [] };
    let scheduledTask = null;
    const groundednessCalls = [];

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: (status) => emitted.status.push(status),
      emitVerificationDone: (payload) => emitted.verificationDone.push(payload),
      scheduleImmediateFn: (callback) => {
        scheduledTask = callback;
        return "scheduled";
      },
      checkGroundednessFn: async (source, claim) => {
        groundednessCalls.push({ source, claim });
        return { status: "verified", evidence: "matched" };
      },
      abortSignal: new AbortController().signal,
      conversationId: "conv-guardian",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "verify table", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["guardian"],
        search_queries: [{ query: "guardian", intent: "primary" }],
        table_spec: { title: "Guardian", row_axis: "Papers", column_definitions: ["Material", "Value"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "Material A has value 25 mg in the source." }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async () => ({
        paper_title: "Guardian Paper",
        data_rows: [{ values: { Material: "Material A", Value: "25 mg [1]" } }],
      }),
      ...createStage3cDeps(),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.equal(result.messageId, "chat_messages-row");
    assert.equal(result.tableId, "chat_generated_tables-row");
    assert.equal(result.ragResults, undefined);
    assert.equal(typeof scheduledTask, "function");

    await scheduledTask();

    // Phase 2 slice 02: no parsed matrices in this fixture (figures: []), so the
    // numeric cell cannot be back-matched and falls through to the Guardian — but now
    // with a narrow MeasHalu value_fabrication claim (no unit/condition tuple here) and
    // a method="guardian" verification record.
    assert.equal(groundednessCalls.length, 1);
    assert.equal(groundednessCalls[0].claim, "For Material A, the value 25 mg for Value appears in the source");
    assert.equal(updates.some((entry) => entry.table === "chat_generated_tables" && Array.isArray(entry.data.verification)), true);
    assert.deepEqual(emitted.verificationDone, [{
      conversationId: "conv-guardian",
      tableId: "chat_generated_tables-row",
      verification: [{ row: 0, col: 1, method: "guardian", checkType: "value_fabrication", status: "verified", evidence: "matched" }],
    }]);
  });

  it("code-verifies cells found in the parsed matrix and does NOT call the Guardian for them", async () => {
    // A paper with an OCR table (figure summary_text HTML) whose values the extraction
    // copies into the generated table. The parsed matrix therefore contains those
    // values, so Stage 4 back-matches them in code — the Guardian must not be asked.
    const { supabase, updates } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Matrix Paper", authors: [], publication_year: 2026 }],
      figures: [],
    });
    let scheduledTask = null;
    const groundednessCalls = [];

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      emitVerificationDone: () => {},
      scheduleImmediateFn: (callback) => { scheduledTask = callback; return "scheduled"; },
      checkGroundednessFn: async (source, claim) => {
        groundednessCalls.push({ source, claim });
        return { status: "verified", evidence: "matched" };
      },
      abortSignal: new AbortController().signal,
      conversationId: "conv-matrix",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "compare", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["matrix"],
        search_queries: [{ query: "matrix", intent: "primary" }],
        table_spec: { title: "Matrix", row_axis: "Papers", column_definitions: ["Adsorbent", "q_max"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [],
        figures: [{
          figure_id: "fig-1",
          paper_id: "paper-1",
          caption: "Table 3 Langmuir parameters",
          summary_text: "<table><tr><th>Adsorbent</th><th>q_max</th></tr><tr><td>KACa</td><td>8.69</td></tr></table> long enough for parsing threshold",
          page: 5,
        }],
      }),
      // Code parser turns the OCR HTML into a matrix carrying 8.69 (caption -> Table 3).
      parseAllHtmlTablesFn: () => [{ success: true, headers: ["Adsorbent", "q_max"], rows: [["KACa", "8.69"]] }],
      extractMatrixFromHtmlFn: async () => ({ headers: [], rows: [] }),
      // Extraction copies the matrix value 8.69 (with a source_hint pointing at Table 3).
      extractColumnsFromPaperFn: async () => ({
        paper_title: "Matrix Paper",
        data_rows: [{
          values: { Adsorbent: "KACa", q_max: "8.69" },
          cell_meta: { q_max: { source_hint: "Table 3", unit: "mol/kg" } },
        }],
      }),
      ...createStage3cDeps(),
    });

    assert.equal(result.hasTable, true);
    await scheduledTask();

    // The numeric cell (q_max=8.69) was back-matched in the Table 3 matrix -> Guardian
    // was never called.
    assert.equal(groundednessCalls.length, 0);
    const verifyUpdate = updates.find((e) => e.table === "chat_generated_tables" && Array.isArray(e.data.verification));
    assert.ok(verifyUpdate, "verification update persisted");
    const codeCell = verifyUpdate.data.verification.find((v) => v.method === "code");
    assert.ok(codeCell, "a code-verified cell exists");
    assert.equal(codeCell.status, "verified");
    assert.equal(codeCell.checkType, "backmatch");
    assert.equal(codeCell.scope, "source_hinted");
  });

  it("parses OCR table matrices with code parser first and LLM fallback second", async () => {
    const { supabase } = createRecordingSupabase({
      papers: [{
        id: "paper-1",
        title: "Parsing Paper",
        authors: [{ family: "Choi" }],
        publication_year: 2026,
      }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    const parserInputs = [];
    const llmInputs = [];
    let generatedRagContext;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-parse",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "parse tables", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["parse"],
        search_queries: [{ query: "parse", intent: "primary" }],
        table_spec: { title: "Parse", row_axis: "Papers", column_definitions: [] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "context text" }],
        figures: [
          {
            figure_id: "fig-code",
            paper_id: "paper-1",
            source_file_id: "source-main",
            source_file_kind: "main_pdf",
            source_filename: "main.pdf",
            figure_no: "Table 1",
            caption: "Code parsed table",
            item_type: "table",
            summary_text: "html-code table summary with enough characters for parsing",
            page: 3,
          },
          {
            figure_id: "fig-llm",
            paper_id: "paper-1",
            source_file_id: "source-supp",
            source_file_kind: "supplementary_pdf",
            source_filename: "supp.pdf",
            figure_no: "Table S1",
            caption: "LLM parsed table",
            item_type: "table",
            summary_text: "llm-only table summary with enough characters for parsing",
            page: 8,
          },
        ],
      }),
      parseAllHtmlTablesFn: (summaryText) => {
        parserInputs.push(summaryText);
        if (summaryText.includes("html-code")) {
          return [{ success: true, headers: ["Metric"], rows: [["AUC"]] }];
        }
        return [{ success: false }];
      },
      extractMatrixFromHtmlFn: async (summaryText) => {
        llmInputs.push(summaryText);
        return { headers: ["Metric"], rows: [["F1"]] };
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async (tableSpec, ragContext) => {
          generatedRagContext = ragContext;
          return {
            title: tableSpec.title,
            headers: tableSpec.column_definitions ?? [],
            rows: [["fallback"]],
            references: [],
          };
        },
      }),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(parserInputs.length, 2);
    assert.deepEqual(llmInputs, ["llm-only table summary with enough characters for parsing"]);
    assert.match(generatedRagContext, /Code parsed table - \[1\] Parsing Paper, Main PDF p\.3/);
    assert.match(generatedRagContext, /LLM parsed table - \[1\] Parsing Paper, Supplementary: supp\.pdf, p\.8/);
    assert.match(generatedRagContext, /Metric/);
    assert.match(generatedRagContext, /AUC/);
    assert.match(generatedRagContext, /F1/);
    assert.match(generatedRagContext, /\[Chunk 1, \[1\], Main PDF\]/);
  });

  it("extracts per-paper data before shell continuation", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [
        { id: "paper-1", title: "Extraction Paper 1", authors: [], publication_year: 2025 },
        { id: "paper-2", title: "Extraction Paper 2", authors: [], publication_year: 2026 },
      ],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    const emitted = { status: [] };
    const extractInputs = [];

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: (status) => emitted.status.push(status),
      abortSignal: new AbortController().signal,
      conversationId: "conv-extract",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1", "paper-2"],
      history: [{ role: "user", content: "extract data", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Extraction", row_axis: "Papers", column_definitions: ["Dose\u00B2", "Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [
          { chunk_id: "chunk-1", paper_id: "paper-1", text: "paper one evidence" },
          { chunk_id: "chunk-2", paper_id: "paper-2", text: "paper two evidence" },
        ],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (tableSpec, paperContext, paperTitle, signal) => {
        extractInputs.push({ tableSpec, paperContext, paperTitle, signalAborted: signal.aborted });
        return {
          paper_title: paperTitle,
          data_rows: [{
            values: {
              Dose2: paperTitle.endsWith("1") ? "5 mg" : "10 mg",
              Outcome: paperTitle.endsWith("1") ? "AUC" : "F1",
            },
          }],
        };
      },
      ...createStage3cDeps(),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.deepEqual(extractInputs.map((input) => ({
      title: input.paperTitle,
      hasPaperChunk: input.paperContext.includes(input.paperTitle.endsWith("1") ? "paper one evidence" : "paper two evidence"),
      columns: input.tableSpec.column_definitions,
      signalAborted: input.signalAborted,
    })), [
      { title: "Extraction Paper 1", hasPaperChunk: true, columns: ["Dose2", "Outcome"], signalAborted: false },
      { title: "Extraction Paper 2", hasPaperChunk: true, columns: ["Dose2", "Outcome"], signalAborted: false },
    ]);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.deepEqual(tableInsert.data.rows, [["5 mg [1]", "AUC [1]"], ["10 mg [2]", "F1 [2]"]]);
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    assert.equal(tableInsert.data.metadata.perPaperTiming.length, 2);
    assert.deepEqual(tableInsert.data.metadata.perPaperTiming.map((entry) => ({
      paperId: entry.paperId,
      success: entry.success,
      hasTiming: typeof entry.ms === "number",
    })), [
      { paperId: "paper-1", success: true, hasTiming: true },
      { paperId: "paper-2", success: true, hasTiming: true },
    ]);
    assert.deepEqual(tableInsert.data.metadata.partialFailures, []);
    assert.deepEqual(emitted.status.filter((status) => status.stage === "extracting").map((status) => status.detail), [
      "Extraction Paper 1",
      "Extraction Paper 2",
    ]);
  });

  // fix 19: a scope paper with no matching data gets an all-N/A placeholder row,
  // and its reason (LLM notes or default) is persisted into
  // chat_generated_tables.metadata.perPaperReasons end-to-end (merge -> Stage 3c
  // return -> persist), so the frontend can render a "no data found" section.
  it("persists per-paper missing-data reasons into the generated table metadata", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [
        { id: "paper-1", title: "Has Data Paper", authors: [], publication_year: 2025 },
        { id: "paper-2", title: "No Data Paper", authors: [], publication_year: 2026 },
      ],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-reasons",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1", "paper-2"],
      history: [{ role: "user", content: "compare", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["q_max"],
        search_queries: [{ query: "q_max", intent: "primary" }],
        table_spec: { title: "Reasons", row_axis: "Papers", column_definitions: ["Adsorbent", "q_max"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [
          { chunk_id: "chunk-1", paper_id: "paper-1", text: "paper one evidence" },
          { chunk_id: "chunk-2", paper_id: "paper-2", text: "paper two evidence" },
        ],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (tableSpec, _paperContext, paperTitle) => {
        if (paperTitle.startsWith("Has Data")) {
          return {
            paper_title: paperTitle,
            data_rows: [{ values: { [tableSpec.column_definitions[0]]: "Carbon", [tableSpec.column_definitions[1]]: "120 mg/g" } }],
          };
        }
        // No matching data — report why via notes (mirrors EXTRACTION_AGENT prompt).
        return { paper_title: paperTitle, data_rows: [], notes: "no fitted isotherm model parameters reported" };
      },
      ...createStage3cDeps(),
    });

    assert.equal(result.hasTable, true);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    // paper-1 real row + paper-2 all-N/A placeholder row.
    assert.deepEqual(tableInsert.data.rows, [["Carbon [1]", "120 mg/g [1]"], ["N/A", "N/A"]]);
    // Reasons reached metadata for both papers.
    const reasons = tableInsert.data.metadata.perPaperReasons;
    assert.equal(Array.isArray(reasons), true);
    assert.equal(reasons.length, 2);
    const hasData = reasons.find((r) => r.paperId === "paper-1");
    const noData = reasons.find((r) => r.paperId === "paper-2");
    assert.equal(hasData.hadRows, true);
    assert.equal(noData.hadRows, false);
    assert.equal(noData.failed, false);
    assert.equal(noData.paperTitle, "No Data Paper");
    assert.equal(noData.note, "no fitted isotherm model parameters reported");
  });

  // Phase 1 (table-semantics-hardening D1/D2/D3): per-cell tuples, column semantic
  // types, and condition conflicts flow merge -> Stage 3c -> persist into metadata.
  it("persists cell tuples, column semantic types, and condition conflicts into metadata", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Isotherm Paper", authors: [], publication_year: 2026 }],
      figures: () => [],
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-tuples",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "compare q_max", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["q_max"],
        search_queries: [{ query: "q_max isotherm", intent: "primary" }],
        table_spec: {
          title: "Isotherm",
          row_axis: "Papers",
          column_definitions: ["Adsorbent", "q_max"],
          column_semantic_types: ["condition", "parameter"],
        },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "isotherm evidence", page: 3 }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (_tableSpec, _ctx, paperTitle) => ({
        paper_title: paperTitle,
        data_rows: [
          {
            values: { Adsorbent: "Zeolite", q_max: "5.2" },
            cell_meta: { q_max: { unit: "mmol/g", condition: "full range 293 K", source_hint: "Table 3" } },
          },
          {
            values: { Adsorbent: "Zeolite", q_max: "3.1" },
            cell_meta: { q_max: { condition: "low pressure", source_hint: "Table 4" } },
          },
        ],
      }),
      ...createStage3cDeps(),
    });

    assert.equal(result.hasTable, true);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    // Slice 09 (D-b): the mixed-condition q_max column is pivoted into a derived
    // "측정 조건 (q_max)" column (inserted at index 2), so headers/rows/semantic types
    // widen by one and every index stays aligned.
    assert.deepEqual(tableInsert.data.headers, ["Adsorbent", "q_max", "측정 조건 (q_max)"]);
    assert.deepEqual(tableInsert.data.metadata.columnSemanticTypes, ["condition", "parameter", "condition"]);
    // Cell tuples aligned with the widened rows; q_max tuple (index 1) is unchanged.
    assert.equal(tableInsert.data.metadata.cellTuples.length, tableInsert.data.rows.length);
    assert.equal(tableInsert.data.metadata.cellTuples[0].length, 3);
    assert.deepEqual(tableInsert.data.metadata.cellTuples[0][1], {
      unit: "mmol/g",
      condition: "full range 293 K",
      source_hint: "Table 3",
    });
    // Derived column carries each row's condition string as data + a tuple.
    assert.equal(tableInsert.data.rows[0][2], "full range 293 K");
    assert.equal(tableInsert.data.rows[1][2], "low pressure");
    // Two different conditions on the parameter column -> one condition conflict, now
    // also pointing at its derived column.
    assert.equal(tableInsert.data.metadata.conditionConflicts.length, 1);
    assert.equal(tableInsert.data.metadata.conditionConflicts[0].column, "q_max");
    assert.equal(tableInsert.data.metadata.conditionConflicts[0].columnIndex, 1);
    assert.equal(tableInsert.data.metadata.conditionConflicts[0].derivedColumnIndex, 2);
    assert.deepEqual(tableInsert.data.metadata.conditionConflicts[0].conditions, [
      "full range 293 K",
      "low pressure",
    ]);
  });

  it("merges per-paper extraction results before shell continuation", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Merge Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    let fallbackCalled = false;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-merge",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "merge data", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Merged Table", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "merge evidence" }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (_tableSpec, _paperContext, paperTitle) => ({
        paper_title: paperTitle,
        data_rows: [{ values: { Outcome: "Improved" } }],
      }),
      ...createStage3cDeps({
        generateTableFromSpecFn: async () => {
          fallbackCalled = true;
          return { title: "Unexpected", headers: [], rows: [], references: [] };
        },
      }),
    });

    assert.equal(result.shellOnly, undefined);
    assert.equal(result.hasTable, true);
    assert.equal(fallbackCalled, false);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    assert.deepEqual(tableInsert.data.headers, ["Outcome"]);
    assert.deepEqual(tableInsert.data.rows, [["Improved [1]"]]);
    assert.deepEqual(tableInsert.data.metadata.nullSummary, { totalNulls: 0, totalCells: 1, droppedRowCount: 0, details: [] });
  });

  it("falls back to single-call when all per-paper extractions fail", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [
        { id: "paper-1", title: "Fail Paper 1", authors: [], publication_year: 2025 },
        { id: "paper-2", title: "Fail Paper 2", authors: [], publication_year: 2026 },
      ],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    let mergeCalled = false;
    let generatedInput;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-all-fail",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1", "paper-2"],
      history: [{ role: "user", content: "fallback data", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Fallback Table", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [
          { chunk_id: "chunk-1", paper_id: "paper-1", text: "fail evidence 1" },
          { chunk_id: "chunk-2", paper_id: "paper-2", text: "fail evidence 2" },
        ],
        figures: [],
      }),
      extractColumnsFromPaperFn: async () => {
        throw new Error("extract failed");
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async (tableSpec, ragContext, paperMetadata, signal) => {
          mergeCalled = true;
          generatedInput = { tableSpec, ragContext, paperMetadata, signalAborted: signal.aborted };
          return {
            title: tableSpec.title,
            headers: ["Outcome"],
            rows: [["Fallback"]],
            references: [],
          };
        },
      }),
      ...createStage3dDeps(),
    });

    assert.equal(result.hasTable, true);
    assert.equal(mergeCalled, true);
    assert.deepEqual(generatedInput.tableSpec, {
      title: "Fallback Table",
      row_axis: "Papers",
      column_definitions: ["Outcome"],
    });
    assert.deepEqual(generatedInput.paperMetadata.map((entry) => entry.paperId), ["paper-1", "paper-2"]);
    assert.equal(generatedInput.signalAborted, false);
    assert.match(generatedInput.ragContext, /fail evidence 1/);
    assert.match(generatedInput.ragContext, /fail evidence 2/);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "single_call_fallback");
    assert.deepEqual(tableInsert.data.metadata.partialFailures.map((entry) => entry.paperId), ["paper-1", "paper-2"]);
    assert.equal(tableInsert.data.metadata.agenticRecovery.skippedReason, "single_call_fallback");
    assert.deepEqual(tableInsert.data.rows, [["Fallback"]]);
  });

  it("falls back to single-call when per-paper extraction fails for every paper and preserves fallback diagnostics", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Empty Merge Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-empty-merge",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "empty merge", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Empty Merge", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "empty merge evidence" }],
        figures: [],
      }),
      // fix 19: the per-paper merge now emits all-N/A placeholder rows instead of
      // returning empty rows, so the single-call fallback is only reached when
      // every per-paper extraction *fails* (extractionSuccessCount === 0).
      extractColumnsFromPaperFn: async () => {
        throw new Error("force fallback");
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async () => ({
          title: "Empty Merge",
          headers: ["Outcome"],
          rows: [["Recovered"]],
          references: [],
        }),
      }),
    });

    assert.equal(result.hasTable, true);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "single_call_fallback");
    assert.equal(tableInsert.data.metadata.nullSummary, null);
    assert.equal(tableInsert.data.metadata.agenticRecovery.skippedReason, "single_call_fallback");
    assert.equal(tableInsert.data.metadata.tableSpecAdherence.normalizedToSpec, false);
    assert.deepEqual(tableInsert.data.metadata.tableSpecAdherence.requestedHeaders, ["Outcome"]);
    assert.deepEqual(tableInsert.data.headers, ["Outcome"]);
    assert.deepEqual(tableInsert.data.rows, [["Recovered"]]);
    // Phase 1 (R-5): the single-call fallback path has no per-cell extraction, so
    // cellTuples stays null and no conflicts are reported (scalar-only path).
    assert.equal(tableInsert.data.metadata.cellTuples, null);
    assert.deepEqual(tableInsert.data.metadata.conditionConflicts, []);
  });

  // P0-A regression (fix 18): single-call fallback timeout must NOT crash the
  // pipeline. The fallback path is reached because every per-paper extraction
  // fails (extractionSuccessCount === 0; fix 19 made empty data_rows produce
  // placeholder rows rather than an empty merge). When generateTableFromSpecFn
  // throws a non-abort error (e.g. DOMException TimeoutError), the pipeline must
  // complete and return an empty table with a notes string instead of propagating.
  it("returns an empty table with notes when single-call fallback times out (non-abort error)", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Timeout Fallback Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    let fallbackCalled = false;

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-fallback-timeout",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "timeout fallback", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Timeout Fallback", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "timeout fallback evidence" }],
        figures: [],
      }),
      // fix 19: force the fallback path via failed extraction (empty data_rows now
      // become placeholder rows instead of an empty merge).
      extractColumnsFromPaperFn: async () => {
        throw new Error("force fallback");
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async () => {
          fallbackCalled = true;
          // Simulate the production failure: AbortSignal.timeout(300s) fires while
          // the local Ollama call is in flight -> DOMException [TimeoutError].
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
      }),
    });

    // P0-A core: pipeline completed (did NOT throw) and produced a table result.
    assert.equal(fallbackCalled, true);
    assert.equal(result.hasTable, true);

    const messageInsert = inserts.find((entry) => entry.table === "chat_messages");
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    // Fallback path was taken.
    assert.equal(tableInsert.data.metadata.extractionMode, "single_call_fallback");
    // Empty table (rows: []) is persisted instead of an error screen.
    assert.deepEqual(tableInsert.data.rows, []);
    assert.deepEqual(tableInsert.data.headers, ["Outcome"]);
    // notes lives on tableJson, which is serialized into the assistant message content.
    const persistedTableJson = JSON.parse(messageInsert.data.content);
    assert.deepEqual(persistedTableJson.rows, []);
    assert.equal(typeof persistedTableJson.notes, "string");
    assert.match(persistedTableJson.notes, /시간 내에 완료되지 못/);
  });

  // P0-A: a generic (non-DOMException) timeout-style Error must also be salvaged
  // into an empty table rather than crashing the pipeline.
  it("returns an empty table with notes when single-call fallback throws a generic error", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Generic Fallback Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-fallback-generic",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "generic fallback", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Generic Fallback", row_axis: "Papers", column_definitions: ["Outcome"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "generic fallback evidence" }],
        figures: [],
      }),
      // fix 19: force the fallback path via failed extraction (empty data_rows now
      // become placeholder rows instead of an empty merge).
      extractColumnsFromPaperFn: async () => {
        throw new Error("force fallback");
      },
      ...createStage3cDeps({
        generateTableFromSpecFn: async () => {
          throw new Error("Ollama request failed");
        },
      }),
    });

    assert.equal(result.hasTable, true);
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "single_call_fallback");
    assert.deepEqual(tableInsert.data.rows, []);
  });

  // P0-A boundary: user-initiated abort must STILL propagate even on the fallback
  // path. When the abort signal is firing (e.g. the user cancelled mid-request)
  // and generateTableFromSpecFn rejects with AbortError, the pipeline must reject
  // with AbortError rather than swallowing it into an empty table.
  it("re-throws AbortError when the single-call fallback is aborted by the user", async () => {
    const abortController = new AbortController();
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Fallback User Abort Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    await assert.rejects(
      () => runTableConversationPipeline({
        supabase,
        emitStatus: () => {},
        abortSignal: abortController.signal,
        conversationId: "conv-fallback-user-abort",
        ownerId: "user-1",
        ownerPaperIds: ["paper-1"],
        history: [{ role: "user", content: "fallback user abort", message_type: "text" }],
        generateOrchestratorPlanFn: async () => ({
          action: "generate_table",
          keyword_hints: ["outcome"],
          search_queries: [{ query: "outcome", intent: "primary" }],
          table_spec: { title: "Fallback User Abort", row_axis: "Papers", column_definitions: ["Outcome"] },
        }),
        runMultiQueryRagFn: async () => ({
          chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "fallback abort evidence" }],
          figures: [],
        }),
        // fix 19: force the fallback path via failed extraction (empty data_rows now
        // become placeholder rows instead of an empty merge).
        extractColumnsFromPaperFn: async () => {
          throw new Error("force fallback");
        },
        ...createStage3cDeps({
          generateTableFromSpecFn: async () => {
            // Realistic user-cancel race: the abort signal fires (user pressed
            // stop) and the in-flight request rejects with AbortError.
            abortController.abort();
            throw createAbortError("fallback aborted by user");
          },
        }),
      }),
      (err) => err?.name === "AbortError",
    );

    // Abort must short-circuit before any persistence.
    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 0);
    assert.equal(inserts.filter((entry) => entry.table === "chat_generated_tables").length, 0);
  });

  it("aborts after single-call fallback generation before normalization or shell continuation", async () => {
    const abortController = new AbortController();
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Fallback Abort Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    await assert.rejects(
      () => runTableConversationPipeline({
        supabase,
        emitStatus: () => {},
        abortSignal: abortController.signal,
        conversationId: "conv-fallback-abort",
        ownerId: "user-1",
        ownerPaperIds: ["paper-1"],
        history: [{ role: "user", content: "fallback abort", message_type: "text" }],
        generateOrchestratorPlanFn: async () => ({
          action: "generate_table",
          keyword_hints: ["outcome"],
          search_queries: [{ query: "outcome", intent: "primary" }],
          table_spec: { title: "Fallback Abort", row_axis: "Papers", column_definitions: ["Outcome"] },
        }),
        runMultiQueryRagFn: async () => ({
          chunks: [{ chunk_id: "chunk-1", paper_id: "paper-1", text: "fallback evidence" }],
          figures: [],
        }),
        extractColumnsFromPaperFn: async () => {
          throw new Error("force fallback");
        },
        ...createStage3cDeps({
          generateTableFromSpecFn: async (tableSpec) => {
            abortController.abort();
            return {
              title: tableSpec.title,
              headers: tableSpec.column_definitions,
              rows: [["Should not continue"]],
              references: [],
            };
          },
        }),
      }),
      (err) => err?.name === "AbortError",
    );

    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 0);
    assert.equal(inserts.filter((entry) => entry.table === "chat_generated_tables").length, 0);
  });

  it("runs Stage 3d recovery on per-paper null cells before shell continuation", async () => {
    const emitted = { status: [] };
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Recovery Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: (status) => emitted.status.push(status),
      abortSignal: new AbortController().signal,
      conversationId: "conv-stage3d-recovery",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "recover nulls", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Recovery Table", row_axis: "Papers", column_definitions: ["Outcome", "Support"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-existing", paper_id: "paper-1", text: "existing evidence" }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (tableSpec, _paperContext, paperTitle) => ({
        paper_title: paperTitle,
        data_rows: [{ values: { [tableSpec.column_definitions[0]]: "", [tableSpec.column_definitions[1]]: "baseline" } }],
      }),
      ...createStage3cDeps(),
      ...createStage3dDeps(),
    });

    assert.equal(result.hasTable, true);
    const messageInsert = inserts.find((entry) => entry.table === "chat_messages");
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.equal(tableInsert.data.metadata.extractionMode, "per_paper");
    assert.deepEqual(tableInsert.data.rows, [["Recovered [1]", "baseline [1]"]]);
    assert.equal(tableInsert.data.metadata.nullSummary.totalNulls, 0);
    assert.equal(tableInsert.data.metadata.agenticRecovery.attempted, true);
    assert.equal(tableInsert.data.metadata.agenticRecovery.recoveredCellCount, 1);
    assert.deepEqual(messageInsert.data.metadata.source_chunk_ids, ["chunk-existing", "chunk-recovered"]);
    assert.deepEqual(tableInsert.data.metadata.sourceEvidenceLocations, {
      "paper-1": ["Main PDF"],
    });
    assert.deepEqual(emitted.status.filter((status) => status.stage === "researching").map((status) => status.detail), [
      "(1/1) Recovery Paper",
    ]);
  });

  it("keeps the merged table when Stage 3d recovery fails soft", async () => {
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Fail Soft Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    const result = await runTableConversationPipeline({
      supabase,
      emitStatus: () => {},
      abortSignal: new AbortController().signal,
      conversationId: "conv-stage3d-fail-soft",
      ownerId: "user-1",
      ownerPaperIds: ["paper-1"],
      history: [{ role: "user", content: "recover nulls fail soft", message_type: "text" }],
      generateOrchestratorPlanFn: async () => ({
        action: "generate_table",
        keyword_hints: ["outcome"],
        search_queries: [{ query: "outcome", intent: "primary" }],
        table_spec: { title: "Fail Soft Table", row_axis: "Papers", column_definitions: ["Outcome", "Support"] },
      }),
      runMultiQueryRagFn: async () => ({
        chunks: [{ chunk_id: "chunk-existing", paper_id: "paper-1", text: "existing evidence" }],
        figures: [],
      }),
      extractColumnsFromPaperFn: async (tableSpec, _paperContext, paperTitle) => ({
        paper_title: paperTitle,
        data_rows: [{ values: { [tableSpec.column_definitions[0]]: "", [tableSpec.column_definitions[1]]: "baseline" } }],
      }),
      ...createStage3cDeps(),
      ...createStage3dDeps({
        extractNullCellsFromPaperFn: async () => {
          throw new Error("recovery LLM failed");
        },
      }),
    });

    assert.equal(result.hasTable, true);
    const messageInsert = inserts.find((entry) => entry.table === "chat_messages");
    const tableInsert = inserts.find((entry) => entry.table === "chat_generated_tables");
    assert.deepEqual(tableInsert.data.rows, [["N/A", "baseline [1]"]]);
    assert.equal(tableInsert.data.metadata.nullSummary.totalNulls, 1);
    assert.equal(tableInsert.data.metadata.agenticRecovery.attempted, true);
    assert.equal(tableInsert.data.metadata.agenticRecovery.recoveredCellCount, 0);
    assert.equal(tableInsert.data.metadata.agenticRecovery.perPaper[0].success, false);
    assert.match(tableInsert.data.metadata.agenticRecovery.perPaper[0].error, /recovery LLM failed/);
    assert.deepEqual(messageInsert.data.metadata.source_chunk_ids, ["chunk-existing"]);
  });

  it("aborts after Stage 3d recovery before shell continuation or persistence", async () => {
    const abortController = new AbortController();
    const { supabase, inserts } = createRecordingSupabase({
      papers: [{ id: "paper-1", title: "Stage 3d Abort Paper", authors: [], publication_year: 2026 }],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });

    await assert.rejects(
      () => runTableConversationPipeline({
        supabase,
        emitStatus: () => {},
        abortSignal: abortController.signal,
        conversationId: "conv-stage3d-abort",
        ownerId: "user-1",
        ownerPaperIds: ["paper-1"],
        history: [{ role: "user", content: "abort during stage 3d", message_type: "text" }],
        generateOrchestratorPlanFn: async () => ({
          action: "generate_table",
          keyword_hints: ["outcome"],
          search_queries: [{ query: "outcome", intent: "primary" }],
          table_spec: { title: "Stage 3d Abort", row_axis: "Papers", column_definitions: ["Outcome", "Support"] },
        }),
        runMultiQueryRagFn: async () => ({
          chunks: [{ chunk_id: "chunk-existing", paper_id: "paper-1", text: "existing evidence" }],
          figures: [],
        }),
        extractColumnsFromPaperFn: async (tableSpec, _paperContext, paperTitle) => ({
          paper_title: paperTitle,
          data_rows: [{ values: { [tableSpec.column_definitions[0]]: "", [tableSpec.column_definitions[1]]: "baseline" } }],
        }),
        ...createStage3cDeps(),
        ...createStage3dDeps({
          extractNullCellsFromPaperFn: async () => {
            abortController.abort();
            return {
              data_rows: [{ confidence: "high", values: { Outcome: "Should not persist" } }],
            };
          },
        }),
      }),
      (err) => err?.name === "AbortError",
    );

    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 0);
    assert.equal(inserts.filter((entry) => entry.table === "chat_generated_tables").length, 0);
  });

  it("aborts during per-paper extraction without persisting assistant messages or generated tables", async () => {
    const abortController = new AbortController();
    const { supabase, inserts } = createRecordingSupabase({
      papers: [
        { id: "paper-1", title: "Abort Paper 1", authors: [], publication_year: 2025 },
        { id: "paper-2", title: "Abort Paper 2", authors: [], publication_year: 2026 },
      ],
      figures: (state) => {
        if (state.select === "paper_id, figure_no, caption") return [];
        return [];
      },
    });
    const extractCalls = [];

    await assert.rejects(
      () => runTableConversationPipeline({
        supabase,
        emitStatus: () => {},
        abortSignal: abortController.signal,
        conversationId: "conv-abort-extract",
        ownerId: "user-1",
        ownerPaperIds: ["paper-1", "paper-2"],
        history: [{ role: "user", content: "extract data", message_type: "text" }],
        generateOrchestratorPlanFn: async () => ({
          action: "generate_table",
          keyword_hints: ["outcome"],
          search_queries: [{ query: "outcome", intent: "primary" }],
          table_spec: { title: "Abort Extraction", row_axis: "Papers", column_definitions: ["Outcome"] },
        }),
        runMultiQueryRagFn: async () => ({
          chunks: [
            { chunk_id: "chunk-1", paper_id: "paper-1", text: "paper one evidence" },
            { chunk_id: "chunk-2", paper_id: "paper-2", text: "paper two evidence" },
          ],
          figures: [],
        }),
        extractColumnsFromPaperFn: async (_tableSpec, _paperContext, paperTitle, signal) => {
          extractCalls.push(paperTitle);
          if (paperTitle === "Abort Paper 1") {
            return { paper_title: paperTitle, data_rows: [{ values: { Outcome: "ok" } }] };
          }
          return await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(createAbortError("per-paper abort")), { once: true });
            abortController.abort();
          });
        },
      }),
      (err) => err?.name === "AbortError",
    );

    assert.deepEqual(extractCalls, ["Abort Paper 1", "Abort Paper 2"]);
    assert.equal(inserts.filter((entry) => entry.table === "chat_messages").length, 0);
    assert.equal(inserts.filter((entry) => entry.table === "chat_generated_tables").length, 0);
  });
});
