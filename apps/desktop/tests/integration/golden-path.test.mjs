import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

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

  it("persists the core paper-to-table spine through real Supabase RPCs", { skip: skipReason }, async () => {
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
  });
});
