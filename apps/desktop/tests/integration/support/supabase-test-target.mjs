const NORMAL_DEV_SUPABASE_URLS = new Set([
  "http://127.0.0.1:55321",
  "http://localhost:55321",
]);

const NORMAL_DEV_PORTS = new Set(["55320", "55321", "55322", "55323", "55324", "55329"]);

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isLocalUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function usesNormalDevPort(value) {
  try {
    const parsed = new URL(value);
    return NORMAL_DEV_PORTS.has(parsed.port);
  } catch {
    return false;
  }
}

function assertNoSupabaseError(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result?.data;
}

export function getIntegrationTargetSkipReason(env = process.env) {
  const supabaseUrl = normalizeUrl(env.REDOU_TEST_SUPABASE_URL);
  const serviceRoleKey = env.REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY;
  const schemaProvenance = env.REDOU_TEST_SCHEMA_PROVENANCE;

  if (!supabaseUrl || !serviceRoleKey) {
    return "set REDOU_TEST_SUPABASE_URL and REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY for a disposable local Supabase target";
  }
  if (schemaProvenance !== "migrations") {
    return "set REDOU_TEST_SCHEMA_PROVENANCE=migrations after building the test target from supabase/migrations/*.sql";
  }
  if (!isLocalUrl(supabaseUrl)) {
    return "REDOU integration tests require a local disposable Supabase target";
  }
  if (NORMAL_DEV_SUPABASE_URLS.has(supabaseUrl) || usesNormalDevPort(supabaseUrl)) {
    return "refusing normal Redou development Supabase target; use a disposable test project/port set";
  }
  if (env.REDOU_TEST_DATABASE_URL && usesNormalDevPort(env.REDOU_TEST_DATABASE_URL)) {
    return "refusing normal Redou development database port; use a disposable test database";
  }
  return null;
}

export function createIntegrationTestTarget(env = process.env) {
  const skipReason = getIntegrationTargetSkipReason(env);
  if (skipReason) {
    throw new Error(skipReason);
  }

  return {
    supabaseUrl: normalizeUrl(env.REDOU_TEST_SUPABASE_URL),
    serviceRoleKey: env.REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY,
    async assertSchemaProvenance(supabase) {
      const emptyVector = [1, ...Array(2047).fill(0)];

      assertNoSupabaseError(
        await supabase
          .from("paper_chunks")
          .select("id, source_file_id")
          .limit(1),
        "schema check: paper_chunks.source_file_id",
      );
      assertNoSupabaseError(
        await supabase
          .from("chat_generated_tables")
          .select("id, metadata")
          .limit(1),
        "schema check: chat_generated_tables.metadata",
      );
      assertNoSupabaseError(
        await supabase.rpc("match_chunks", {
          query_embedding: emptyVector,
          match_threshold: 0.99,
          match_count: 1,
          filter_paper_ids: [],
        }),
        "schema check: match_chunks vector(2048)",
      );
      assertNoSupabaseError(
        await supabase.rpc("match_figures", {
          query_embedding: emptyVector,
          match_threshold: 0.99,
          match_count: 1,
          filter_item_types: ["table"],
          filter_paper_ids: [],
        }),
        "schema check: match_figures vector(2048)",
      );
    },
    async cleanupGoldenPathRows(supabase, ownerId) {
      assertNoSupabaseError(
        await supabase.from("chat_conversations").delete().eq("owner_user_id", ownerId),
        "cleanup: chat_conversations",
      );
      assertNoSupabaseError(
        await supabase.from("papers").delete().eq("owner_user_id", ownerId),
        "cleanup: papers",
      );
      assertNoSupabaseError(
        await supabase.from("app_users").delete().eq("id", ownerId),
        "cleanup: app_users",
      );
    },
    async seedGoldenPathRows(supabase, fixture, services) {
      const { ids } = fixture;
      const now = "2026-05-23T00:00:00.000Z";
      const embedding = JSON.stringify(services.embedding);

      assertNoSupabaseError(
        await supabase.from("app_users").insert({
          id: ids.ownerId,
          display_name: fixture.paper.ownerName,
          email: fixture.paper.ownerEmail,
          auth_provider: "integration-test",
        }),
        "seed: app_users",
      );
      assertNoSupabaseError(
        await supabase.from("papers").insert({
          id: ids.paperId,
          owner_user_id: ids.ownerId,
          title: fixture.paper.title,
          normalized_title: fixture.paper.normalizedTitle,
          publication_year: fixture.paper.publicationYear,
          journal_name: fixture.paper.journal,
          doi: fixture.paper.doi,
          abstract: fixture.paper.abstract,
          authors: fixture.paper.authors,
          extraction_version: fixture.paper.extractionVersion,
          extraction_source: "integration_fixture",
        }),
        "seed: papers",
      );
      assertNoSupabaseError(
        await supabase.from("paper_files").insert({
          id: ids.sourceFileId,
          paper_id: ids.paperId,
          file_kind: "main_pdf",
          original_filename: fixture.source.originalFilename,
          stored_filename: fixture.source.storedFilename,
          stored_path: fixture.source.storedPath,
          mime_type: "application/pdf",
          file_size_bytes: 1024,
          is_primary: true,
        }),
        "seed: paper_files",
      );
      assertNoSupabaseError(
        await supabase.from("paper_sections").insert({
          id: ids.sectionId,
          paper_id: ids.paperId,
          source_file_id: ids.sourceFileId,
          section_name: fixture.extraction.section.sectionName,
          section_order: fixture.extraction.section.sectionOrder,
          page_start: fixture.extraction.section.pageStart,
          page_end: fixture.extraction.section.pageEnd,
          raw_text: fixture.extraction.section.rawText,
          parser_confidence: 0.99,
        }),
        "seed: paper_sections",
      );
      assertNoSupabaseError(
        await supabase.from("paper_chunks").insert({
          id: ids.chunkId,
          paper_id: ids.paperId,
          section_id: ids.sectionId,
          source_file_id: ids.sourceFileId,
          chunk_order: fixture.extraction.chunk.chunkOrder,
          page: fixture.extraction.chunk.page,
          text: fixture.extraction.chunk.text,
          token_count: fixture.extraction.chunk.tokenCount,
          parser_confidence: 0.99,
        }),
        "seed: paper_chunks",
      );
      assertNoSupabaseError(
        await supabase.from("chunk_embeddings").insert({
          chunk_id: ids.chunkId,
          embedding,
          embedding_model: fixture.embedding.model,
          embedding_dim: fixture.embedding.dimensions,
        }),
        "seed: chunk_embeddings",
      );
      assertNoSupabaseError(
        await supabase.from("figures").insert({
          id: ids.tableFigureId,
          paper_id: ids.paperId,
          source_file_id: ids.sourceFileId,
          figure_no: fixture.extraction.table.figureNo,
          caption: fixture.extraction.table.caption,
          page: fixture.extraction.table.page,
          item_type: "table",
          summary_text: fixture.extraction.table.summaryText,
          plain_text: fixture.extraction.table.plainText,
          embedding,
        }),
        "seed: figures",
      );
      assertNoSupabaseError(
        await supabase.from("processing_jobs").insert([
          {
            id: ids.parseJobId,
            paper_id: ids.paperId,
            user_id: ids.ownerId,
            source_file_id: ids.sourceFileId,
            job_type: "parse_sections",
            status: "succeeded",
            source_path: fixture.source.storedPath,
            started_at: now,
            finished_at: "2026-05-23T00:00:01.000Z",
            created_at: now,
          },
          {
            id: ids.embeddingJobId,
            paper_id: ids.paperId,
            user_id: ids.ownerId,
            source_file_id: ids.sourceFileId,
            job_type: "generate_embeddings",
            status: "succeeded",
            source_path: fixture.source.storedPath,
            started_at: "2026-05-23T00:00:02.000Z",
            finished_at: "2026-05-23T00:00:03.000Z",
            created_at: "2026-05-23T00:00:02.000Z",
          },
        ]),
        "seed: processing_jobs",
      );
      assertNoSupabaseError(
        await supabase.from("chat_conversations").insert({
          id: ids.conversationId,
          owner_user_id: ids.ownerId,
          title: "Golden path table",
          phase: "clarifying",
          scope_all: true,
          conversation_type: "table",
        }),
        "seed: chat_conversations",
      );
    },
  };
}
