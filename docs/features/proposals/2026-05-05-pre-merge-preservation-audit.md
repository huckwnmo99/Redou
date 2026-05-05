# Pre-Merge Preservation Audit - Option B+

> Date: 2026-05-05
> Branch: `feature/pipeline-v2-only`
> Baseline checkpoint: `c2f2c3d` (`Update integration strategy after checkpoint`)
> Merge target: `origin/main` at `3799fd2`
> Related strategy: `docs/features/proposals/2026-05-05-integration-strategy-update.md`

This audit is the first executable planning artifact for the Option B+ integration path.
It does not change runtime code.
Its job is to name what must survive the later merge before conflict resolution begins.

---

## 1. Integration Principle

The merge must not be treated as "feature wins" or "main wins".

Preserve these five behavior groups:

1. Security and ownership hardening from the feature branch.
2. Supplementary source-file tracking from the feature branch.
3. Stage 3d Agentic NULL Recovery from the feature branch.
4. V2-only PDF processing from the feature branch.
5. Entity graph and graph-enhanced RAG from `origin/main`.

If a conflict touches one of these groups, resolve it by composing behavior, not by choosing one side wholesale.

---

## 2. Security And Ownership Guardrails

### Must Survive

- Chat data access must remain authenticated and user-owned.
- Service-role generic table IPC must not expose chat tables.
- Chat frontend reads must continue through Supabase/RLS where possible.
- Electron chat actions must continue to receive and verify `{ userId, accessToken }`.
- File deletion must remain constrained to import cleanup tokens or authenticated user-owned stored paths.
- `redou-file://` must remain constrained to files under the Redou library root.
- Background CrossRef DOI lookup must remain opt-in.
- LLM model preferences must remain user-scoped.

### Files And Symbols

Current feature-branch paths:

- `supabase/migrations/20260503010000_secure_chat_tables.sql`
  - enables RLS on `chat_conversations`
  - enables RLS on `chat_messages`
  - enables RLS on `chat_generated_tables`
  - validates generated table inserts through matching `message_id` and `conversation_id`
- `apps/desktop/electron/main.mjs`
  - `resolveAuthenticatedUserId()`
  - `ipcMain.handle(IPC_CHANNELS.CHAT_SEND_MESSAGE, ...)`
  - `ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, ...)`
  - `ipcMain.handle(IPC_CHANNELS.CHAT_EXPORT_CSV, ...)`
  - `ipcMain.handle(IPC_CHANNELS.LLM_GET_MODEL, ...)`
  - `ipcMain.handle(IPC_CHANNELS.LLM_SET_MODEL, ...)`
  - `ipcMain.handle(IPC_CHANNELS.FILE_DELETE, ...)`
  - `resolveRedouFileUrlToPath()`
  - `protocol.handle("redou-file", ...)`
  - `REDOU_ENABLE_CROSSREF_DOI`
  - `fileDeleteCleanupTokens`
- `apps/desktop/electron/preload.mjs`
  - `chat.sendMessage(args)`
  - `chat.abort(args)`
  - `chat.exportCsv(args)`
  - `llm.getModel(args)`
  - `llm.setModel(args)`
  - `file.delete(args)`
- `frontend/src/lib/chatQueries.ts`
  - `getAuthContext()`
  - `useChatConversations()`
  - `useChatMessages()`
  - `useGeneratedTables()`
  - `useSendChatMessage()`
  - `useAbortChat()`
  - `useExportGeneratedTable()`
  - `useLlmModel()`
  - `useSetLlmModel()`
- `frontend/src/lib/desktop.ts`
  - `toDesktopFileUrl()`
  - `deleteImportedLibraryFile()`
- `frontend/src/lib/queries.ts`
  - failed import cleanup path using `cleanupToken`
- `frontend/src/lib/supabasePaperRepository.ts`
  - authenticated delete cleanup in `deletePaper()`
- `frontend/src/types/desktop.ts`
  - auth arguments for chat, LLM, and file delete IPC types

### Merge Checks

- `chat_conversations`, `chat_messages`, and `chat_generated_tables` must not be re-added to broad service-role query/mutation allowlists.
- `CHAT_SEND_MESSAGE`, `CHAT_ABORT`, and `CHAT_EXPORT_CSV` must still fail without a valid Supabase access token.
- CSV export must still filter by conversation owner.
- `FILE_DELETE` must not accept arbitrary stored paths without owner validation.
- Entity graph settings must not reuse global/non-user-scoped model preference writes.

---

## 3. Supplementary Source-File Guardrails

### Must Survive

- Main PDF and supplementary PDF extraction rows must be independently owned by `source_file_id`.
- Processing a supplementary file must not delete or overwrite main-PDF sections, chunks, figures, tables, equations, references, or paper metadata.
- Embedding generation must be scoped to the processing job's `source_file_id` when available.
- Existing main PDF import must continue to create a `paper_files` row and an `import_pdf` job tied to that file.

### Files And Symbols

- `supabase/migrations/20260504010000_add_supplementary_source_tracking.sql`
  - adds `source_file_id` to `paper_sections`
  - adds `source_file_id` to `paper_chunks`
  - adds `source_file_id` to `processing_jobs`
  - adds indexes:
    - `idx_sections_source_order`
    - `idx_chunks_source_order`
    - `idx_processing_jobs_source_status`
  - backfills existing rows to a chosen main/primary `paper_files` row
- `apps/desktop/electron/main.mjs`
  - `persistV2Results({ paperId, userId, sourceFileId, ... })`
  - delete scopes:
    - `paper_chunks` by `paper_id` + `source_file_id`
    - `figures` by `paper_id` + `source_file_id`
    - `paper_sections` by `paper_id` + `source_file_id`
  - insert fields:
    - `paper_sections.source_file_id`
    - `paper_chunks.source_file_id`
    - `figures.source_file_id`
  - image path scoping:
    - `path.join(paperId, sourceFileId)`
  - `processWithMineruGrobid({ sourceFileId, shouldUpdatePaperMetadata })`
  - `processImportPdfJob(job)`
  - `processEmbeddingJob(job)`
  - queueing `generate_embeddings` with `source_file_id`
  - `requeueOutdatedPapers()`
- `frontend/src/lib/supabasePaperRepository.ts`
  - `insertPaperFile(..., options)`
  - `createImportJob(..., sourceFileId)`
  - main PDF import path passing `sourceFileId`
- `docs/features/new/10-supplementary-files.md`
  - locked decisions:
    - keep using `job_type = 'import_pdf'`
    - no new supplementary job type yet
    - attach PDF first
    - DOCX/DOC conversion later

### Merge Checks

- Do not revert `persistV2Results()` to deleting by `paper_id` only.
- Do not let `origin/main` entity extraction changes queue embeddings without carrying `source_file_id` when the job has one.
- Entity extraction may remain paper-scoped for the first merge, but it must not destroy source-scoped chunk/section persistence.
- RAG source labels may remain paper-level for this merge; source-aware labels stay a later supplementary slice.

---

## 4. Stage 3d Agentic NULL Recovery Guardrails

### Must Survive

- Table generation must still run Stage 3d after Stage 3c merge and before final cell cleaning.
- Recovery must remain gated, paper-scoped, and fail-soft.
- Recovery must only apply values with `confidence === "high"`.
- Recovery metadata must be stored under `chat_generated_tables.metadata.agenticRecovery`.
- Frontend pipeline status must still understand the `researching` stage.

### Files And Symbols

- `apps/desktop/electron/main.mjs`
  - import of `extractNullCellsFromPaper`
  - `shouldTriggerAgenticRecovery()`
  - `groupNullsByPaper()`
  - `buildRecoveryQueries()`
  - `runPaperScopedRecoverySearch()`
  - `applyRecoveredValues()`
  - `runAgenticNullRecovery()`
  - call site after Stage 3c and before final table persistence
  - `CHAT_STATUS` with `stage: "researching"`
- `apps/desktop/electron/llm-orchestrator.mjs`
  - `NULL_RECOVERY_EXTRACTION_PROMPT`
  - `extractNullCellsFromPaper()`
  - export of `extractNullCellsFromPaper`
- `frontend/src/types/desktop.ts`
  - `ChatPipelineStage` includes `"researching"`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
  - `TABLE_STAGES` includes `researching`
- `docs/features/new/09-agentic-research-null.md`
  - design source for Stage 3d

### Merge Checks

- Entity graph RAG changes must not bypass Stage 3d in table mode.
- If `runMultiQueryRag()` becomes wrapped by `runGraphEnhancedRag()`, `runPaperScopedRecoverySearch()` must still be able to run a paper-scoped table retrieval.
- `agenticRecovery` metadata must still be included in the generated table metadata object.
- Abort/timeout must continue returning the original table rather than throwing top-level chat failure.

---

## 5. V2-Only PDF Pipeline Guardrails

### Must Survive

- MinerU remains the required structural pipeline.
- GROBID remains optional degraded metadata/reference enrichment.
- Removed V1 heuristic fallback must not be resurrected.
- GLM-OCR is only an empty-table fallback, not a replacement structural PDF pipeline.
- `CURRENT_EXTRACTION_VERSION` remains consistent with V2-only behavior.

### Files And Symbols

- `apps/desktop/electron/main.mjs`
  - `CURRENT_EXTRACTION_VERSION = 25`
  - `processWithMineruGrobid()`
  - `processImportPdfJob()`
  - `persistV2Results()`
  - `enhanceEmptyTablesWithOcr()` call only after MinerU table detection
  - `requeueOutdatedPapers()`
- `apps/desktop/electron/ocr-extraction.mjs`
  - `enhanceEmptyTablesWithOcr()`
  - GLM-OCR timeout behavior
- `apps/desktop/electron/pdf-heuristics.mjs`
  - should not become the active structural extraction fallback again

### Merge Checks

- `origin/main` must not lower `CURRENT_EXTRACTION_VERSION` back to 24.
- `origin/main` must not reintroduce first-pass heuristic parsing as an active fallback.
- Entity extraction queueing should happen after embeddings without changing PDF import completion semantics.
- Supplementary source-file handling must stay attached to the V2 pipeline.

---

## 6. Entity Graph Guardrails From `origin/main`

### Must Survive

- Entity graph migration and RPCs must be included.
- Entity extraction jobs must be queued after embeddings, unless explicitly deferred.
- Entity backfill IPC and settings UI must remain available.
- Graph-enhanced RAG must remain connected to Q&A retrieval.
- The entity extraction model preference must support explicit model choice and fallback to chat model.

### Files And Symbols From `origin/main`

- `supabase/migrations/20260423010000_add_entity_graph.sql`
  - entity tables
  - graph traversal/search RPCs
  - `papers.entity_extraction_version`
  - `user_workspace_preferences.entity_extraction_model`
- `apps/desktop/electron/entity-extractor.mjs`
  - `CURRENT_ENTITY_EXTRACTION_VERSION`
  - `extractEntitiesFromPaper()`
  - `extractQueryEntities()`
  - `persistEntitiesForPaper()`
  - `buildChunkIndexForPaper()`
- `apps/desktop/electron/graph-search.mjs`
  - `runGraphEnhancedRag()`
- `apps/desktop/electron/main.mjs`
  - imports from `entity-extractor.mjs`
  - import of `runGraphEnhancedRag`
  - `processEntityExtractionJob()`
  - `tryStartEntityExtractionJob()`
  - `enqueueEntityBackfill()`
  - `ENTITY_BACKFILL`
  - `ENTITY_BACKFILL_STATUS`
  - `ENTITY_GET_MODEL`
  - `ENTITY_SET_MODEL`
  - `runGraphEnhancedRag()` call in Q&A flow
- `apps/desktop/electron/preload.mjs`
  - `entity.backfill()`
  - `entity.backfillStatus()`
  - `entity.getModel()`
  - `entity.setModel(args)`
- `apps/desktop/electron/types/ipc-channels.mjs`
  - `ENTITY_BACKFILL`
  - `ENTITY_BACKFILL_STATUS`
  - `ENTITY_GET_MODEL`
  - `ENTITY_SET_MODEL`
- `frontend/src/features/settings/SettingsView.tsx`
  - entity model settings UI
  - entity backfill actions/status
- `frontend/src/lib/chatQueries.ts`
  - entity model query/mutation hooks
  - entity backfill query/mutation hooks
- `frontend/src/types/desktop.ts`
  - entity IPC API types

### Open Product Decision

`origin/main` intentionally allows graph traversal to reach outside folder-scoped paper IDs.

This needs a product decision before merge:

- Option 1: keep cross-folder graph expansion and label it as graph discovery.
- Option 2: constrain graph expansion to `filterPaperIds` in folder-scoped QA.

Default recommendation for Redou:

- folder-scoped QA should remain folder-scoped by default
- whole-library QA may use cross-folder graph expansion
- if cross-folder evidence is used, the answer/source UI should visibly mark it later

### Merge Checks

- If entity model settings are merged, they should use authenticated/user-scoped preference semantics compatible with the feature branch's LLM model hardening.
- If entity extraction jobs are queued after embeddings, duplicate job prevention should be reviewed.
- If graph search changes `runMultiQueryRag()` flow, Stage 3d paper-scoped recovery must still work.

---

## 7. Conflict Resolution Order

When the actual merge starts, resolve conflicts in this order:

1. IPC constants and preload surface
   - easiest to compose
   - establishes API shape for frontend/types
2. Frontend types
   - combine chat auth args, `researching`, and entity APIs
3. LLM orchestrator
   - combine Stage 3d recovery with origin/main LLM changes
4. Entity graph standalone files and migration
   - accept new origin/main files, then review interactions
5. `main.mjs`
   - largest conflict
   - resolve by preserving all five behavior groups
6. Frontend chat/settings/query files
   - compose auth/RLS chat flow with entity settings/backfill flow
7. Harness docs
   - update after code shape is settled

---

## 8. Validation Plan After Merge

Minimum checks:

- `node --check apps/desktop/electron/main.mjs`
- `node --check apps/desktop/electron/preload.mjs`
- `node --check apps/desktop/electron/llm-orchestrator.mjs`
- `cmd /c npm run build` in `frontend`
- `cmd /c npm run build` in `apps/desktop`
- migration order review:
  - `20260423010000_add_entity_graph.sql`
  - `20260503010000_secure_chat_tables.sql`
  - `20260504010000_add_supplementary_source_tracking.sql`

Behavior checks:

- chat send requires auth and only sees user-owned data
- table generation still stores `agenticRecovery`
- main PDF processing still produces source-scoped sections/chunks
- embedding job for a source file only embeds that source file's chunks
- entity backfill queues and status can be invoked
- graph-enhanced QA falls back gracefully when no graph hits exist

---

## 9. Next Step

Do not merge yet.

Next execution unit:

1. Run Stage 3d verification on the current feature branch.
2. If verification passes, update harness docs before merge.
3. If verification fails, fix Stage 3d first in a small patch.
