import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

import { runQueuedProcessingJob } from "../../electron/processing/job-runner.mjs";
import { runTableConversationPipeline } from "../../electron/chat/table-pipeline.mjs";
import { createMultiQueryRag } from "../../electron/rag/multi-query-rag.mjs";
import {
  createIntegrationTestTarget,
  getIntegrationTargetSkipReason,
} from "./support/supabase-test-target.mjs";
import {
  createGoldenPathServices,
  loadGoldenPathFixture,
  quietLogger,
} from "./support/deterministic-services.mjs";

describe("golden-path integration", () => {
  it("refuses the normal Redou development Supabase target", () => {
    const skipReason = getIntegrationTargetSkipReason({
      REDOU_TEST_SUPABASE_URL: "http://127.0.0.1:55321",
      REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      REDOU_TEST_SCHEMA_PROVENANCE: "migrations",
    });

    assert.match(skipReason, /normal Redou development Supabase target/);
  });

  const skipReason = getIntegrationTargetSkipReason(process.env);

  const persistCoreGoldenPath = async () => {
    const target = createIntegrationTestTarget(process.env);
    const fixture = await loadGoldenPathFixture();
    const services = await createGoldenPathServices(fixture);
    const supabase = createClient(target.supabaseUrl, target.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    await target.assertSchemaProvenance(supabase);
    await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    await target.seedGoldenPathRows(supabase, fixture, services);

    const { runMultiQueryRag } = createMultiQueryRag({
      supabase,
      generateEmbedding: services.generateEmbedding,
      isRerankerAvailable: async () => false,
      logger: quietLogger(),
    });

    const ragResults = await runMultiQueryRag(
      fixture.searchQueries,
      fixture.keywordHints,
      [fixture.ids.paperId],
      "table",
    );

    assert.equal(ragResults.chunks[0]?.chunk_id, fixture.ids.chunkId);
    assert.ok(ragResults.figures.some((figure) => figure.figure_id === fixture.ids.tableFigureId));

    const result = await runTableConversationPipeline({
      supabase,
      conversationId: fixture.ids.conversationId,
      ownerId: fixture.ids.ownerId,
      ownerPaperIds: [fixture.ids.paperId],
      scopeAll: true,
      history: fixture.history,
      message: fixture.history.at(-1)?.content ?? "",
      abortSignal: new AbortController().signal,
      emitStatus: () => {},
      emitComplete: () => {},
      generateOrchestratorPlanFn: async () => services.orchestratorPlan,
      runMultiQueryRagFn: runMultiQueryRag,
      extractColumnsFromPaperFn: services.extractColumnsFromPaper,
      parseAllHtmlTablesFn: services.parseAllHtmlTables,
      extractMatrixFromHtmlFn: services.extractMatrixFromHtml,
      runPaperScopedRecoverySearchFn: async () => ({ chunks: [], figures: [] }),
      extractNullCellsFromPaperFn: async () => ({ data_rows: [] }),
      scheduleImmediateFn: () => {},
    });

    assert.equal(result.hasTable, true);
    assert.ok(result.tableId);

    const { data: tableRows, error: tableError } = await supabase
      .from("chat_generated_tables")
      .select("table_title, headers, rows, source_refs, metadata")
      .eq("id", result.tableId)
      .limit(1);
    assert.equal(tableError, null);
    assert.equal(tableRows?.[0]?.table_title, fixture.expected.tableTitle);
    assert.deepEqual(tableRows?.[0]?.headers, fixture.expected.headers);
    assert.deepEqual(tableRows?.[0]?.rows, fixture.expected.rows);
    assert.equal(tableRows?.[0]?.metadata?.extractionMode, "per_paper");
    assert.equal(tableRows?.[0]?.metadata?.sourceEvidenceLocations?.[fixture.ids.paperId]?.length > 0, true);

    const { data: jobs, error: jobsError } = await supabase
      .from("processing_jobs")
      .select("job_type, status, source_file_id")
      .eq("paper_id", fixture.ids.paperId)
      .order("created_at", { ascending: true });
    assert.equal(jobsError, null);
    assert.deepEqual(jobs?.map((job) => `${job.job_type}:${job.status}`), [
      "parse_sections:succeeded",
      "generate_embeddings:succeeded",
    ]);
    assert.ok(jobs?.every((job) => job.source_file_id === fixture.ids.sourceFileId));

    await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
  };

  const abortPerPaperExtractionWithoutPersistence = async () => {
    const target = createIntegrationTestTarget(process.env);
    const fixture = await loadGoldenPathFixture();
    const abortController = new AbortController();
    const services = await createGoldenPathServices(fixture, {
      abortController,
      scenario: "perPaperAbort",
    });
    const supabase = createClient(target.supabaseUrl, target.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    await target.assertSchemaProvenance(supabase);
    await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    await target.seedGoldenPathRows(supabase, fixture, services);

    try {
      const { runMultiQueryRag } = createMultiQueryRag({
        supabase,
        generateEmbedding: services.generateEmbedding,
        isRerankerAvailable: async () => false,
        logger: quietLogger(),
      });

      await assert.rejects(
        () => runTableConversationPipeline({
          supabase,
          conversationId: fixture.ids.conversationId,
          ownerId: fixture.ids.ownerId,
          ownerPaperIds: [fixture.ids.paperId],
          scopeAll: true,
          history: fixture.history,
          message: fixture.history.at(-1)?.content ?? "",
          abortSignal: abortController.signal,
          emitStatus: () => {},
          emitComplete: () => {},
          generateOrchestratorPlanFn: async () => services.orchestratorPlan,
          runMultiQueryRagFn: runMultiQueryRag,
          extractColumnsFromPaperFn: services.extractColumnsFromPaper,
          parseAllHtmlTablesFn: services.parseAllHtmlTables,
          extractMatrixFromHtmlFn: services.extractMatrixFromHtml,
          runPaperScopedRecoverySearchFn: async () => ({ chunks: [], figures: [] }),
          extractNullCellsFromPaperFn: async () => ({ data_rows: [] }),
          scheduleImmediateFn: () => {},
        }),
        (err) => err?.name === "AbortError",
      );

      const { data: messages, error: messagesError } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("conversation_id", fixture.ids.conversationId);
      assert.equal(messagesError, null);
      assert.deepEqual(messages, []);

      const { data: tables, error: tablesError } = await supabase
        .from("chat_generated_tables")
        .select("id")
        .eq("conversation_id", fixture.ids.conversationId);
      assert.equal(tablesError, null);
      assert.deepEqual(tables, []);

      const { data: conversations, error: conversationError } = await supabase
        .from("chat_conversations")
        .select("phase")
        .eq("id", fixture.ids.conversationId)
        .limit(1);
      assert.equal(conversationError, null);
      assert.equal(conversations?.[0]?.phase, "clarifying");
    } finally {
      await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    }
  };

  const fallbackAfterPerPaperExtractionError = async () => {
    const target = createIntegrationTestTarget(process.env);
    const fixture = await loadGoldenPathFixture();
    const services = await createGoldenPathServices(fixture, {
      scenario: "perPaperError",
    });
    const supabase = createClient(target.supabaseUrl, target.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    await target.assertSchemaProvenance(supabase);
    await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    await target.seedGoldenPathRows(supabase, fixture, services);

    try {
      const { runMultiQueryRag } = createMultiQueryRag({
        supabase,
        generateEmbedding: services.generateEmbedding,
        isRerankerAvailable: async () => false,
        logger: quietLogger(),
      });

      const result = await runTableConversationPipeline({
        supabase,
        conversationId: fixture.ids.conversationId,
        ownerId: fixture.ids.ownerId,
        ownerPaperIds: [fixture.ids.paperId],
        scopeAll: true,
        history: fixture.history,
        message: fixture.history.at(-1)?.content ?? "",
        abortSignal: new AbortController().signal,
        emitStatus: () => {},
        emitComplete: () => {},
        generateOrchestratorPlanFn: async () => services.orchestratorPlan,
        runMultiQueryRagFn: runMultiQueryRag,
        extractColumnsFromPaperFn: services.extractColumnsFromPaper,
        generateTableFromSpecFn: services.generateTableFromSpec,
        parseAllHtmlTablesFn: services.parseAllHtmlTables,
        extractMatrixFromHtmlFn: services.extractMatrixFromHtml,
        runPaperScopedRecoverySearchFn: async () => ({ chunks: [], figures: [] }),
        extractNullCellsFromPaperFn: async () => ({ data_rows: [] }),
        scheduleImmediateFn: () => {},
      });

      assert.equal(result.hasTable, true);
      assert.ok(result.tableId);

      const { data: tableRows, error: tableError } = await supabase
        .from("chat_generated_tables")
        .select("table_title, headers, rows, metadata")
        .eq("id", result.tableId)
        .limit(1);
      assert.equal(tableError, null);
      assert.equal(tableRows?.[0]?.table_title, fixture.expected.tableTitle);
      assert.deepEqual(tableRows?.[0]?.headers, fixture.expected.headers);
      assert.deepEqual(tableRows?.[0]?.rows, fixture.expected.rows);
      assert.equal(tableRows?.[0]?.metadata?.extractionMode, "single_call_fallback");
      assert.deepEqual(tableRows?.[0]?.metadata?.partialFailures, [
        {
          paperId: fixture.ids.paperId,
          paperTitle: fixture.paper.title,
          error: "Fake per-paper extraction failed",
        },
      ]);
      assert.equal(tableRows?.[0]?.metadata?.agenticRecovery?.skippedReason, "single_call_fallback");

      const { data: messages, error: messagesError } = await supabase
        .from("chat_messages")
        .select("id, message_type")
        .eq("conversation_id", fixture.ids.conversationId);
      assert.equal(messagesError, null);
      assert.deepEqual(messages?.map((message) => message.message_type), ["table_report"]);

      const { data: conversations, error: conversationError } = await supabase
        .from("chat_conversations")
        .select("phase")
        .eq("id", fixture.ids.conversationId)
        .limit(1);
      assert.equal(conversationError, null);
      assert.equal(conversations?.[0]?.phase, "follow_up");
    } finally {
      await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    }
  };

  const failQueuedEmbeddingJobWithoutDamagingPaper = async () => {
    const target = createIntegrationTestTarget(process.env);
    const fixture = await loadGoldenPathFixture();
    const services = await createGoldenPathServices(fixture);
    const failedJobId = "10000000-0000-4000-8000-000000000703";
    const supabase = createClient(target.supabaseUrl, target.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    await target.assertSchemaProvenance(supabase);
    await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    await target.seedGoldenPathRows(supabase, fixture, services);

    try {
      const { error: insertError } = await supabase.from("processing_jobs").insert({
        id: failedJobId,
        paper_id: fixture.ids.paperId,
        user_id: fixture.ids.ownerId,
        source_file_id: fixture.ids.sourceFileId,
        job_type: "generate_embeddings",
        status: "queued",
        source_path: fixture.source.storedPath,
        created_at: "2026-05-23T00:00:04.000Z",
      });
      assert.equal(insertError, null);

      const failedEvents = [];
      const result = await runQueuedProcessingJob({
        loadNextJob: async () => {
          const { data, error } = await supabase
            .from("processing_jobs")
            .select("id, paper_id, user_id, source_path, source_file_id, job_type, status, created_at")
            .eq("status", "queued")
            .eq("job_type", "generate_embeddings")
            .order("created_at", { ascending: true })
            .limit(1);
          if (error) throw new Error(error.message);
          return data?.[0] ?? null;
        },
        updateJobStatus: async (jobId, patch) => {
          const { error } = await supabase.from("processing_jobs").update(patch).eq("id", jobId);
          if (error) throw new Error(error.message);
        },
        processJob: async () => {
          throw new Error("Embedding model unavailable");
        },
        broadcastJobFailed: (payload) => {
          failedEvents.push(payload);
        },
        now: () => "2026-05-23T00:00:05.000Z",
      });

      assert.deepEqual(result, {
        job: {
          id: failedJobId,
          paperId: fixture.ids.paperId,
          jobType: "generate_embeddings",
        },
        status: "failed",
        error: "Embedding model unavailable",
      });
      assert.deepEqual(failedEvents, [
        {
          jobId: failedJobId,
          paperId: fixture.ids.paperId,
          error: "Embedding model unavailable",
        },
      ]);

      const { data: jobs, error: jobsError } = await supabase
        .from("processing_jobs")
        .select("status, started_at, finished_at, error_message")
        .eq("id", failedJobId)
        .limit(1);
      assert.equal(jobsError, null);
      assert.equal(jobs?.[0]?.status, "failed");
      assert.equal(jobs?.[0]?.started_at, "2026-05-23T00:00:05+00:00");
      assert.equal(jobs?.[0]?.finished_at, "2026-05-23T00:00:05+00:00");
      assert.equal(jobs?.[0]?.error_message, "Embedding model unavailable");

      const { data: papers, error: paperError } = await supabase
        .from("papers")
        .select("id, title")
        .eq("id", fixture.ids.paperId)
        .limit(1);
      assert.equal(paperError, null);
      assert.deepEqual(papers, [{ id: fixture.ids.paperId, title: fixture.paper.title }]);

      const { data: chunks, error: chunksError } = await supabase
        .from("paper_chunks")
        .select("id, text")
        .eq("paper_id", fixture.ids.paperId);
      assert.equal(chunksError, null);
      assert.equal(chunks?.length, 1);
      assert.equal(chunks?.[0]?.id, fixture.ids.chunkId);
    } finally {
      await target.cleanupGoldenPathRows(supabase, fixture.ids.ownerId);
    }
  };

  if (skipReason) {
    it("persists the core paper-to-table spine through real Supabase RPCs", { skip: skipReason }, () => {});
    it("aborts per-paper extraction without persisting chat output", { skip: skipReason }, () => {});
    it("falls back to single-call table generation after a per-paper extraction error", { skip: skipReason }, () => {});
    it("marks a failed embedding worker job without damaging paper data", { skip: skipReason }, () => {});
  } else {
    it("persists the core paper-to-table spine through real Supabase RPCs", persistCoreGoldenPath);
    it("aborts per-paper extraction without persisting chat output", abortPerPaperExtractionWithoutPersistence);
    it("falls back to single-call table generation after a per-paper extraction error", fallbackAfterPerPaperExtractionError);
    it("marks a failed embedding worker job without damaging paper data", failQueuedEmbeddingJobWithoutDamagingPaper);
  }
});
