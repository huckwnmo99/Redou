# Chat/Table Pipeline State Audit

Status: Stage 1 audit complete
Date: 2026-05-08
Scope: `CHAT_SEND_MESSAGE` and related chat/table helpers in `apps/desktop/electron/main.mjs`

This document maps the current chat and table pipeline before any runtime code is moved.

No runtime code changed in Stage 1.

## Files Read

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/llm-qa.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `frontend/src/types/desktop.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/lib/chatQueries.ts`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`

## Entry Points

| Entry point | Current owner | Role |
|-------------|---------------|------|
| `IPC_CHANNELS.CHAT_SEND_MESSAGE` | `main.mjs` | Main request handler for table and QA conversations |
| `IPC_CHANNELS.CHAT_ABORT` | `main.mjs` | Looks up a conversation-scoped `AbortController` and aborts it |
| `handleQaPipeline` | `main.mjs` | QA branch after shared auth/conversation setup |
| `runMultiQueryRag` | `main.mjs` | Shared vector/BM25/figure retrieval and reranking |
| `runAgenticNullRecovery` | `main.mjs` | Stage 3d recovery pass for remaining table NULL cells |
| `generateOrchestratorPlan` | `llm-orchestrator.mjs` | Table/clarify planning |
| `generateTableFromSpec` | `llm-orchestrator.mjs` | Single-call table fallback |
| `extractColumnsFromPaper` | `llm-orchestrator.mjs` | Per-paper SRAG extraction |
| `extractNullCellsFromPaper` | `llm-orchestrator.mjs` | Stage 3d recovery extraction |
| `generateQaResponse` | `llm-qa.mjs` | Streaming QA answer |
| `formatSourceAttribution` | `llm-qa.mjs` | Ensures paper/source attribution in QA output |

## Shared Request Setup

`CHAT_SEND_MESSAGE` receives:

```ts
{
  conversationId?: string;
  message: string;
  scopeFolderId?: string | null;
  scopeAll?: boolean;
  mode?: "table" | "qa";
  userId?: string;
  accessToken?: string;
}
```

Shared setup flow:

1. Resolve authenticated user with `resolveAuthenticatedUserId({ userId, accessToken })`.
2. Apply user-specific LLM preference with `applyUserLlmPreference(ownerId)`.
3. Load all paper IDs owned by the authenticated user with `getPaperIdsForUser(ownerId)`.
4. Create a new `chat_conversations` row when `conversationId` is absent.
5. Load and verify an existing conversation when `conversationId` is present:
   - must match `owner_user_id`;
   - stored `scope_folder_id`, `scope_all`, and `conversation_type` can override missing request values.
6. Insert the user message into `chat_messages`.
7. Load conversation history ordered by `created_at`.
8. Create an `AbortController`.
9. Store it in `chatAbortControllers` using the resolved `convId`.
10. Branch to QA or table pipeline based on `conversation_type`.

Important ownership rule:

- The authenticated owner scope is established before either QA or table branch.
- Future extraction should pass `ownerId`, `ownerPaperIds`, conversation scope, `abortSignal`, and `emitStatus` explicitly.

## QA Branch Flow

Current owner: `handleQaPipeline`.

| Step | Status event | Work | Persistence |
|------|--------------|------|-------------|
| QA-1 | `searching` | Scope owned paper IDs, derive one search query from the user message, run `runMultiQueryRag(..., "qa")` | none |
| QA-2 | none | If no chunks/figures, insert assistant no-data text | `chat_messages`, conversation timestamp |
| QA-3 | none | Load metadata for referenced papers | none |
| QA-4 | none | Build paper ref map and evidence locations | none |
| QA-5 | none | Assemble RAG context | none |
| QA-6 | `answering` | Stream `generateQaResponse(...)` and emit `CHAT_TOKEN` | none during stream |
| QA-7 | none | Post-process with `formatSourceAttribution(...)` | none |
| QA-8 | `CHAT_COMPLETE` | Insert final assistant text message and update conversation phase/timestamp | `chat_messages`, `chat_conversations` |

QA metadata currently stores:

- `source_chunk_ids`
- `referenced_paper_ids`
- `source_evidence_locations`

## Table Branch Flow

| Stage | Status event | Main work | Key mutable output |
|-------|--------------|-----------|--------------------|
| Setup | none | Load all owned papers and table captions for orchestrator context | `paperList`, `previousTable` |
| Stage 1 | `orchestrating` | Run `generateOrchestratorPlan(history, paperList, previousTable, abortSignal)` | `plan` |
| Clarify | `stage: null` then `CHAT_TOKEN`/`CHAT_COMPLETE` | Emit clarification text and save assistant text | assistant `chat_messages` row |
| Stage 2 | `searching` | Scope papers, run `runMultiQueryRag(plan.search_queries, plan.keyword_hints, filterPaperIds, "table")` | `ragResults` |
| No data | `CHAT_COMPLETE` | Insert assistant no-data text | assistant `chat_messages` row |
| Stage 2b | none | Load paper metadata and backfill all table figures for relevant papers | `paperMetadata`, `ragResults.figures` |
| Stage 3a | `parsing` | Parse OCR HTML with `parseAllHtmlTables`, fallback to `extractMatrixFromHtml` | `parsedMatrices` |
| Stage 3b | `extracting` | Per-paper context assembly and `extractColumnsFromPaper` | `extractionResults` |
| Stage 3c | `assembling` | Merge per-paper extraction or use `generateTableFromSpec` fallback | `tableJson`, `nullSummary`, `extractionMode` |
| Stage 3d | `researching` then `assembling` | Run Agentic NULL Recovery when gate passes | `agenticRecovery`, recovered evidence |
| Persist | `CHAT_COMPLETE` | Insert assistant table message, generated table, source refs, metadata | `chat_messages`, `chat_generated_tables` |
| Stage 4 | `verifying` then `CHAT_VERIFICATION_DONE` | Background Guardian verification via `setImmediate` | `chat_generated_tables.verification` |

## Pipeline Context Fields

A future `runTableConversationPipeline` should receive a single context object rather than hidden globals.

Minimum context:

| Field | Owner | Purpose |
|-------|-------|---------|
| `supabase` | caller-owned dependency | DB reads/writes |
| `conversationId` | caller-owned value | Message/table ownership |
| `ownerId` | caller-owned value | Authenticated user scope |
| `ownerPaperIds` | caller-owned value | Paper scope guard |
| `message` | caller-owned value | User input |
| `history` | caller-owned value | Orchestrator and QA context |
| `scopeFolderId` | caller-owned value | Optional folder filter |
| `scopeAll` | caller-owned value | Scope mode |
| `mode` / `conversationType` | caller-owned value | QA vs table branch |
| `abortSignal` | caller-owned dependency | Cancellation propagation |
| `emitStatus` | caller-owned dependency | Sends `CHAT_STATUS` payloads |
| `emitToken` | caller-owned dependency | Sends `CHAT_TOKEN` payloads |
| `emitComplete` | caller-owned dependency | Sends `CHAT_COMPLETE` payloads |
| `emitError` | caller-owned dependency | Sends `CHAT_ERROR` payloads |
| `llm` helpers | injected dependency | Orchestrator, table, QA, extraction, recovery |
| `rag` helpers | injected dependency | Embedding/RPC retrieval and reranking |
| `sourceEvidence` helpers | injected dependency | Main vs supplementary evidence labels |

## Mutable State Table

| Variable/state | Current owner | Lifecycle | Cleanup rule | Extraction target |
|----------------|---------------|-----------|--------------|-------------------|
| `convId` | `CHAT_SEND_MESSAGE` | Created or loaded before branch | always available in return/error if possible | caller keeps |
| `conversationType` | `CHAT_SEND_MESSAGE` | Request mode, then stored conversation type for existing conversations | none | caller keeps |
| `scopeFolderId`, `scopeAll` | `CHAT_SEND_MESSAGE` | Request values, then stored conversation values if existing | none | caller keeps |
| `ownerPaperIds` | `CHAT_SEND_MESSAGE` | Loaded after auth | immutable array | caller keeps |
| `userMessageId` | `CHAT_SEND_MESSAGE` | Current user message is inserted before history load, but the ID is not retained | future pipeline should retain it if parent/reply linkage is introduced | caller keeps |
| `history` | `CHAT_SEND_MESSAGE` | Loaded after user message insert | immutable array | caller keeps |
| `abortController` | `CHAT_SEND_MESSAGE` | Created after history load | delete from `chatAbortControllers` in `finally` | caller keeps |
| `chatAbortControllers` | module global in `main.mjs` | Active while request is in-flight | delete on abort and handler finally | future abort registry/helper |
| `paperList` | table branch | Orchestrator context | local only | table pipeline |
| `previousTable` | table branch | Orchestrator context | local only | table pipeline |
| `plan` | table branch | Orchestrator output, may be mutated by clarify guardrail | local only | table pipeline |
| `clarificationCount` | table branch | Computed from assistant text messages when `plan.action === "clarify"` | local only | table pipeline |
| `filterPaperIds` | QA/table branch | Derived from owner IDs and optional folder tree | local only | RAG helper |
| `ragResults` | QA/table branch | RAG output, then table branch mutates figures during backfill and Stage 3d | local only | RAG/table pipeline |
| `paperMetadata` | QA/table branch | Loaded from RAG paper IDs | local only | table/QA pipeline |
| `paperRefMap` | QA/table branch | Derived from paperMetadata order | local only | source evidence helper |
| `evidenceLocationsByPaper` | QA/table branch | Derived from RAG results, recomputed after Stage 3d recovery evidence | local only | source evidence helper |
| `tableSpec` | table branch | `plan.table_spec` fallback, then `column_definitions` sanitized in place | local only | table pipeline |
| `figuresByPaper`, `chunksByPaper` | table branch | Derived from RAG results | local only | table pipeline |
| `parsedMatrices` | table branch | Stage 3a output | local only | table pipeline |
| `extractionResults` | table branch | Stage 3b output | local only | table pipeline |
| `extractionFallbackNeeded` | table branch | Stage 3b/3c control flag | local only | table pipeline |
| `tableJson` | table branch | Stage 3c/3d output, then cleaned before persistence | local only until persisted | table pipeline |
| `nullSummary` | table branch | Stage 3c output, Stage 3d may update | persisted in metadata | table pipeline |
| `agenticRecovery` | table branch | Stage 3d output or fallback skip metadata | persisted in metadata | Stage 3d helper |
| `tableSpecAdherence` | table branch | single-call fallback diagnostics | persisted in metadata | table pipeline |
| `extractionMetadata` | table branch | Built before persistence | persisted in `chat_generated_tables.metadata` | table pipeline |
| `verification` | background Stage 4 | Built after table persistence | persists best-effort | separate verifier |
| `conversationUpdatedAt` | QA/table branch | Conversation timestamp is updated in clarify, no-data, QA final, and table final paths | update only after a branch reaches a persistence boundary | table/QA pipeline |

## Status And Event Contract

Renderer-facing event names must remain stable:

- `CHAT_STATUS`
- `CHAT_TOKEN`
- `CHAT_COMPLETE`
- `CHAT_VERIFICATION_DONE`
- `CHAT_ERROR`

Current status stages:

| Stage | Used by | Meaning |
|-------|---------|---------|
| `orchestrating` | table branch | Request and table intent planning |
| `searching` | QA/table | RAG retrieval |
| `parsing` | table | OCR/table parsing |
| `extracting` | table | Per-paper SRAG extraction |
| `researching` | table Stage 3d | Agentic NULL Recovery |
| `assembling` | table | Merge/fallback/final table assembly |
| `verifying` | table Stage 4 | Background Guardian verification |
| `answering` | QA | Streaming QA answer |
| `null` | clarify branch | Clears pipeline UI |

Resolved contract issue:

- `frontend/src/types/desktop.ts` now types `ChatStatusEvent.stage` as `ChatPipelineStage | null` because `main.mjs` sends `stage: null` in the clarify path.

## Abort Cleanup Table

| Phase | Current abort support | Cleanup today | Stage 2A requirement |
|-------|-----------------------|---------------|----------------------|
| Before `convId` exists | none | no controller exists | document pending/new conversation abort behavior |
| After `convId`, before branch | controller exists | `finally` deletes controller | keep |
| QA RAG search | partial: `runMultiQueryRag` has no `AbortSignal` parameter | waits for current embedding/RPC work | add/propagate signal or document non-abortable segment |
| QA answer streaming | supported through `generateQaResponse(..., abortSignal)` | `AbortError` handled by outer catch | keep and test |
| Table orchestrator | supported through `generateOrchestratorPlan(..., abortSignal)` | outer catch returns `error: "aborted"` | keep and test |
| Table RAG search | partial: `runMultiQueryRag` has no `AbortSignal` parameter | waits for current embedding/RPC work | add/propagate signal or document non-abortable segment |
| Stage 3a code parser | not async/abortable | local work only | acceptable if fast; document |
| Stage 3a LLM parser | supported through `extractMatrixFromHtml(..., abortSignal)` | errors are currently caught and logged per figure | decide whether top-level abort should rethrow here |
| Stage 3b per-paper extraction | supported through a per-paper timeout controller linked to parent abort | parent abort is rethrown | keep and test |
| Stage 3c code merge | not async/abortable | local work only | acceptable if fast; document |
| Stage 3c single-call fallback | supported through `generateTableFromSpec(..., abortSignal)` | outer catch returns aborted | keep and test |
| Stage 3d recovery search/extraction | partial: has `abortSignal`, but recovery is fail-soft | may return a table instead of cancelling persistence | decide and test before extraction |
| Persistence | no explicit abort check immediately before insert | inserts after prior stages complete | add pre-persist abort check or document behavior |
| Stage 4 verification | no abort; runs after completion in `setImmediate` | best-effort logs only | treat as separate non-blocking verifier |
| `CHAT_ABORT` IPC | validates owner for non-`pending` conversation; aborts map entry by key | deletes controller if found | preserve auth check and map cleanup |

Current highest abort risk:

- Stage 3d catches recovery errors fail-soft. If the parent signal aborts inside Stage 3d, the recovery function can still return `tableJson`/`nullSummary`, allowing final persistence to continue. Stage 2A should explicitly decide whether abort always cancels table persistence or only cancels best-effort recovery.

## Regression Scenarios

The first extraction PR should preserve or explicitly redefine these behaviors.

| ID | Scenario | Expected behavior |
|----|----------|-------------------|
| R1 | New table conversation | Creates owned conversation, inserts user message, completes table branch |
| R2 | Existing table conversation | Loads only if `owner_user_id` matches, reuses stored scope/type |
| R3 | QA conversation | Runs QA RAG, streams tokens, stores text answer with source attribution |
| R4 | Clarification branch | Clears pipeline status, streams clarification tokens, stores text message, no table row |
| R5 | Clarify guardrail after 3 assistant text clarifications | Forces `generate_table` with fallback table spec/search query |
| R6 | Table no-data branch | Stores assistant no-data text and emits `CHAT_COMPLETE` with `hasTable: false` |
| R7 | QA no-data branch | Stores assistant no-data text and emits `CHAT_COMPLETE` with `hasTable: false` |
| R8 | Normal per-paper table generation | Stage 3b extraction succeeds, Stage 3c code merge persists table and metadata |
| R9 | Empty/failed per-paper extraction | Falls back to single-call table generation and records `single_call_fallback` recovery skip metadata |
| R10 | Fallback table has wrong columns | Normalizes to `tableSpec.column_definitions` and records `tableSpecAdherence` |
| R11 | NULL cells below Stage 3d gate | Skips recovery with `skippedReason: "gate_not_met"` |
| R12 | NULL cells above Stage 3d gate with no new context | Records per-paper `no_new_context` skip without inventing values |
| R13 | Stage 3d high-confidence recovery | Applies only high-confidence recovered values and updates source evidence locations |
| R14 | Supplementary evidence in RAG | Source refs include supplementary evidence labels without changing paper citation numbers |
| R15 | Abort during orchestrator | Returns aborted and does not persist assistant/table output after user message |
| R16 | Abort during RAG | Even if RAG signal propagation is deferred, no assistant message or generated table should be inserted after abort; only the already-inserted user message may remain |
| R17 | Abort during Stage 3b | Parent abort propagates through per-paper timeout controller and avoids table persistence |
| R18 | Abort during Stage 3d | Must be decided; current fail-soft path may not cancel final persistence |
| R19 | Guardian verification failure | Does not fail completed table; logs non-fatal error |
| R20 | Unauthorized abort/export attempt | Rejects or no-ops when conversation/table is not owned by authenticated user |
| R21 | User owns zero papers | Either skips RAG and returns no-data or calls RAG with an empty owned-paper filter without leaking data |
| R22 | Conversation type changes mid-flow | Existing conversation type remains authoritative unless a separate explicit type-migration action exists |
| R23 | Concurrent `CHAT_SEND_MESSAGE` with the same conversation ID | Defines whether the second request is rejected, queued, or aborts the first; must not leave two active controllers for one conversation |
| R24 | RAG returns a paper outside `ownerPaperIds` | Pipeline must reject/filter out-of-scope evidence before metadata, refs, or persistence |
| R25 | Conversation is deleted during Stage 4 verification | Guardian update failure remains non-fatal and does not corrupt other conversations or tables |

## Extraction Targets

| Future module | First responsibilities to move | Must stay out of it |
|---------------|-------------------------------|---------------------|
| `chat/status-events.mjs` | typed `emitStatus`, `emitToken`, `emitComplete`, `emitError` helpers | LLM/RAG logic |
| `chat/table-pipeline.mjs` | table branch after shared request setup | IPC auth, BrowserWindow lifecycle |
| `chat/qa-pipeline.mjs` | QA branch after shared request setup | table-specific Stage 3b/3c/3d logic |
| `chat/source-evidence.mjs` | evidence location formatting and source ref enrichment | DB ownership checks |
| `chat/agentic-null-recovery.mjs` | Stage 3d gate, query building, recovery application | top-level table persistence |
| `rag/retrieval.mjs` | `runMultiQueryRag`, RRF, rerank, source-file metadata hydration | IPC handler code |

## Stage 2A Tracer Bullet 1

Status: completed 2026-05-09.

Scope:

- Added `apps/desktop/electron/chat/status-events.mjs`.
- Added Node test coverage for status payload creation and `stage: null`.
- Replaced direct `IPC_EVENTS.CHAT_STATUS` sends in `main.mjs` with `emitStatus(...)` for the current QA/table chat paths.

D9 measurement:

| Metric | Baseline before tracer | Current after tracer | Notes |
|--------|------------------------|----------------------|-------|
| `main.mjs` line count | 4321 | 4317 | Small reduction only; main goal was helper seam creation. |
| Direct `IPC_EVENTS.CHAT_STATUS` references in `main.mjs` | 12 | 0 | Status event name is now owned by `chat/status-events.mjs`. |
| Chat/table helper reference count in `main.mjs` | 9 | 9 | Full table orchestration has not been moved yet. |

Verification:

- `node --check apps/desktop/electron/chat/status-events.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run test` in `apps/desktop` passed with approved escalation.
- `cmd /c npm run build` in `apps/desktop` passed.

## Stage 2A Tracer Bullet 2

Status: completed 2026-05-09.

Scope:

- Added `apps/desktop/electron/chat/abort-guards.mjs`.
- Added Node test coverage for `throwIfChatAborted(...)` and its `AbortError` shape.
- Added delayed-abort boundary guards in QA/table paths after non-propagating or long async steps and before final assistant/table persistence starts.

Guard locations:

- QA after `runMultiQueryRag(...)`.
- QA after streamed answer generation, before final assistant message persistence.
- Table after `generateOrchestratorPlan(...)`, before clarify/table branch persistence.
- Clarify before assistant clarification message persistence.
- Table after `runMultiQueryRag(...)`.
- Single-call fallback after `generateTableFromSpec(...)`.
- Table after optional Stage 3d recovery.
- Table immediately before final `chat_messages` table-report insertion.

D9 measurement:

| Metric | Baseline before abort tracer | Current after abort tracer | Notes |
|--------|------------------------------|----------------------------|-------|
| `main.mjs` line count | 4317 | 4326 | Expected small increase because this slice adds safety guards. |
| Direct `IPC_EVENTS.CHAT_STATUS` references in `main.mjs` | 0 | 0 | Status helper seam remains intact. |
| `throwIfChatAborted` references in `main.mjs` | 0 | 9 | Includes the import plus 8 guard call sites. |
| Chat/table helper reference count in `main.mjs` | 9 | 9 | Full table orchestration has not been moved yet. |

Limits:

- This does not make `runMultiQueryRag(...)` itself abortable.
- This does not make final message/table persistence transactional.
- It narrows the documented delayed-abort gap before persistence-heavy boundaries while keeping the broader RAG abort propagation work deferred.

Verification:

- RED: `cmd /c npm run test` failed before implementation on missing `chat/abort-guards.mjs`.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation.
- `node --check apps/desktop/electron/chat/abort-guards.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.

## Stage 2A Tracer Bullet 3a

Status: completed 2026-05-10.

Scope:

- Added `apps/desktop/electron/chat/table-pipeline.mjs`.
- Added `apps/desktop/tests/table-pipeline.test.mjs`.
- Defined the first `runTableConversationPipeline({...})` public shell and dependency-injected orchestration seam.
- Added the first chat-flow abort regression: abort after orchestrator must throw `AbortError`, must not call RAG, must not insert assistant messages, must not insert generated tables, and must not emit completion.
- Did not wire `runTableConversationPipeline(...)` into `main.mjs` yet.
- Did not move the table branch body yet.
- This test verifies the orchestrator abort seam only; RAG and persistence dependencies are intentionally not exercised until Tracer 3b wires those stages.

Initial public shell:

```js
await runTableConversationPipeline({
  emitStatus,
  abortSignal,
  history,
  paperList,
  previousTable,
  generateOrchestratorPlanFn,
});
```

State ownership decision for this tracer:

| Owner | State |
|-------|-------|
| `main.mjs` caller-owned | conversation creation/loading, authenticated `ownerId`, `ownerPaperIds`, `conversationType`, `scopeFolderId`, `scopeAll`, `abortController`, inserted user message, loaded `history` |
| `table-pipeline.mjs` pipeline-owned later | `paperList`, `previousTable`, `plan`, `ragResults`, `paperMetadata`, `paperRefMap`, `evidenceLocationsByPaper`, `tableSpec`, `parsedMatrices`, `extractionResults`, `tableJson`, `nullSummary`, `agenticRecovery`, `tableSpecAdherence` |
| Tracer 3a implemented now | only `emitStatus`, `generateOrchestratorPlanFn(...)`, and the abort boundary after orchestration |

D9 measurement:

| Metric | Baseline before tracer 3a | Current after tracer 3a | Notes |
|--------|---------------------------|-------------------------|-------|
| `main.mjs` line count | 4326 | 4326 | No runtime wiring yet. |
| `table-pipeline.mjs` line count | 0 | 32 | Shell only. |
| Chat/table helper reference count in `main.mjs` | 9 | 9 | Full table orchestration has not been moved yet. |

Q12 decision:

- Closed as D13: frontend Vitest uses `vi.mock` plus direct fetch stubs; desktop Node tests use dependency injection through public module parameters.

Q13 status:

- Still deferred. Tracer 3a uses a recording fake Supabase object and does not require a real Supabase fixture.

Verification:

- RED: `cmd /c npm run test` failed before implementation on missing `chat/table-pipeline.mjs`.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.

## Stage 2A Tracer Bullet 3b-1

Status: completed 2026-05-10.

Scope:

- Expanded `apps/desktop/electron/chat/table-pipeline.mjs` so the table pipeline shell owns setup plus Stage 1:
  - load owned paper context for the orchestrator;
  - load table captions per paper;
  - load the previous generated table for modify-table context;
  - call the injected orchestrator;
  - apply the existing clarify guardrail;
  - handle clarify responses by clearing status, streaming text tokens, inserting the assistant text message, updating the conversation timestamp, and emitting completion.
- Wired `apps/desktop/electron/main.mjs` through `runTableConversationPipeline({...})`.
- Preserved the temporary `shellOnly: true` continuation from D14:
  - clarify returns directly from the pipeline module;
  - non-clarify table plans return `plan`, setup context, and `shellOnly: true`;
  - `main.mjs` continues from the returned `plan` into the existing Stage 2+ RAG and Stage 3 table body.
- Added desktop tests for setup context loading and clarify branch behavior.

Out of scope:

- Moving Stage 2 RAG.
- Moving Stage 2b paper metadata/table-figure backfill.
- Moving Stage 3a/3b/3c parsing, extraction, merge, or fallback.
- Moving Stage 3d Agentic NULL Recovery.
- Moving final table persistence or Stage 4 Guardian verification.
- Making `runMultiQueryRag(...)` directly abortable.

D9 measurement:

| Metric | Baseline before tracer 3b-1 | Current after tracer 3b-1 | Notes |
|--------|-----------------------------|---------------------------|-------|
| `main.mjs` line count | 4326 | 4249 | Setup, orchestrator, clarify guardrail, and clarify branch were moved out. |
| `table-pipeline.mjs` line count | 32 | 174 | The module now owns setup plus Stage 1/clarify. |
| Direct `generateOrchestratorPlan(...)` calls in `main.mjs` | 1 | 0 | `main.mjs` injects the function into the pipeline instead of calling it directly. |
| Direct Stage 2+/Stage 3 table helper references in `main.mjs` | 11 | 11 | Expected to remain until Tracer 3b-2 and 3b-3. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the shell did not load setup context or handle clarify responses.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 6 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocking issue. It confirmed:
  - non-clarify `generate_table` plans continue into the existing Stage 2+ table path through `shellOnly: true`;
  - clarify responses return before the legacy table body and do not duplicate assistant/table output.

Residual P3 risk:

- A very late abort can still arrive after the final pre-persistence guard and during the non-transactional write window.
- This risk exists for the clarify assistant-message write window and the final table persistence window.
- This is not expanded in Tracer 3b-1 because transactional persistence/cleanup is out of scope; keep it visible for the later persistence extraction slice.

Next intended slice:

- Tracer 3b-2 should move only Stage 2 RAG and Stage 2b paper metadata/table-figure backfill into `chat/table-pipeline.mjs`.
- It should preserve the same `shellOnly` continuation until Tracer 3c removes it.

## Stage 2A Tracer Bullet 3b-2

Status: completed 2026-05-10.

Scope:

- Added D17 regression coverage for the repeated-clarify guardrail.
- Moved Stage 2 table RAG into `apps/desktop/electron/chat/table-pipeline.mjs`.
- Moved the table no-data branch into `chat/table-pipeline.mjs`.
- Moved Stage 2b paper metadata loading and table-figure backfill into `chat/table-pipeline.mjs`.
- Moved `paperRefMap` and initial `evidenceLocationsByPaper` preparation into `chat/table-pipeline.mjs` so Stage 3 can continue from returned context.
- Kept `main.mjs` as the coordinator:
  - it passes `ownerPaperIds`, folder scope values, and helper dependencies into the pipeline;
  - it returns early for no-data or clarify results;
  - it continues from Stage 3a only when `shellOnly: true`.

Out of scope:

- Moving Stage 3a/3b/3c parsing, extraction, merge, or fallback.
- Moving Stage 3d Agentic NULL Recovery.
- Moving final table persistence or Stage 4 Guardian verification.
- Making `runMultiQueryRag(...)` internally abortable.
- Closing Q13 with a real Supabase fixture strategy.

D17/D18:

- D17 accepted and implemented: `applyClarifyGuardrail` now has a desktop Node regression test.
- D18 accepted and implemented for Tracer 3b-2: table RAG folder filtering is pipeline-owned through explicit helper injection.

D9 measurement:

| Metric | Baseline before tracer 3b-2 | Current after tracer 3b-2 | Notes |
|--------|-----------------------------|---------------------------|-------|
| `main.mjs` line count | 4249 | 4174 | Stage 2 and Stage 2b table code moved out. |
| `table-pipeline.mjs` line count | 174 | 353 | Stage 2 RAG/no-data and Stage 2b metadata/backfill moved in. |
| Direct `generateOrchestratorPlan(...)` calls in `main.mjs` | 0 | 0 | The Stage 1 move remains intact. |
| Direct Stage 2+/Stage 3 table helper references in `main.mjs` | 11 | 10 | Table-mode direct `runMultiQueryRag(...)` call was removed; QA and Stage 3+ references remain. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new no-data and metadata/backfill tests expected Stage 2 behavior inside the pipeline.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 9 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- Dedicated validation agent review found no P1/P2 blocking issue. It confirmed:
  - no-data returns inside the pipeline and does not fall into legacy Stage 3;
  - non-empty RAG returns `ragResults`, `paperMetadata`, `paperRefMap`, and `evidenceLocationsByPaper` for Stage 3 continuation;
  - folder scope filtering is helper-injected and intersected with `ownerPaperIds`;
  - table backfill avoids duplicate `figure_id` values and hydrates source-file metadata.

Residual P3 risk:

- The no-data branch has the same late-abort non-transactional write-window risk already recorded for clarify and final table persistence.
- This remains a later persistence extraction/transactional cleanup concern, not a Tracer 3b-2 blocker.

Next intended slice:

- Tracer 3b-3 should move only Stage 3a, Stage 3b, and Stage 3c parsing/extraction/merge/fallback into `chat/table-pipeline.mjs`.
- Stage 3d, final table persistence, and Guardian verification should remain out of Tracer 3b-3 unless explicitly approved.

## Stage 2A Tracer Bullet 3b-3-1

Status: completed 2026-05-10.

Scope:

- Accepted D19 with a safety correction: `main.mjs` should pass Stage 3 helpers by dependency injection while Stage 2A is in progress, because importing `main.mjs` from `chat/table-pipeline.mjs` would create a circular dependency.
- Moved Stage 3a OCR table parsing into `apps/desktop/electron/chat/table-pipeline.mjs`.
- Preserved the Stage 3a order:
  - group figures by paper;
  - group chunks by paper;
  - try `parseAllHtmlTablesFn(...)` first;
  - use `extractMatrixFromHtmlFn(...)` fallback only when code parsing produces no successful table;
  - preserve caption, source type, source file metadata, and page hints on parsed tables.
- Returned `figuresByPaper`, `chunksByPaper`, `allPaperIds`, and `parsedMatrices` from the pipeline shell so `main.mjs` can continue at Stage 3b.

Out of scope:

- Moving Stage 3b per-paper extraction.
- Moving Stage 3c merge/fallback.
- Moving Stage 3d Agentic NULL Recovery.
- Moving final table persistence or Stage 4 Guardian verification.
- Closing Q13 with a real Supabase fixture strategy.

D9 measurement:

| Metric | Baseline before tracer 3b-3-1 | Current after tracer 3b-3-1 | Notes |
|--------|--------------------------------|-----------------------------|-------|
| `main.mjs` line count | 4174 | 4083 | Stage 3a parsing moved out. |
| `table-pipeline.mjs` line count | 353 | 477 | Stage 3a parser helper moved in. |
| `table-pipeline.test.mjs` line count | 414 | 521 | Added code-parser plus LLM-fallback regression coverage. |
| Direct Stage 2+/Stage 3 table helper references in `main.mjs` | 10 | 8 | Direct Stage 3a parser calls were removed; injected function references remain. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new Stage 3a parsing test expected parser calls and parsed matrices from the pipeline.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 10 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- Dedicated validation agent found a P1 continuation bug: `main.mjs` still used `allPaperIds` for Stage 3b after Stage 3a moved. Fixed by returning `allPaperIds` from `chat/table-pipeline.mjs`, destructuring it in `main.mjs`, and asserting the contract in the Stage 3a regression.
- Re-run verification passed: `node --check` for `table-pipeline.mjs` and `main.mjs`, `git diff --check`, `cmd /c npm run test` in `apps/desktop`, and `cmd /c npm run build` in `apps/desktop`.

Next intended slice:

- Tracer 3b-3-2 should move only Stage 3b per-paper extraction into `chat/table-pipeline.mjs`.
- It must preserve the current per-paper timeout and abort-controller composition behavior.

## Stage 2A Tracer Bullet 3b-3-2

Status: completed 2026-05-10.

Scope:

- Moved Stage 3b per-paper extraction into `apps/desktop/electron/chat/table-pipeline.mjs` as `runPerPaperExtraction`.
- Preserved the current code's sequential per-paper loop rather than changing it to `Promise.all`.
- Preserved Stage 3b behavior:
  - derive `tableSpec` from `plan.table_spec` or the default comparison table shape;
  - sanitize requested column definitions through injected `sanitizeColumnNamesFn`;
  - build per-paper context through injected `assemblePerPaperContextFn`;
  - call injected `extractColumnsFromPaperFn(...)`;
  - compose each per-paper 60s timeout controller with the parent abort signal;
  - rethrow parent aborts;
  - record per-paper success/failure results and fallback-need status.
- Returned `tableSpec`, `extractionResults`, `extractionSuccessCount`, `extractionFailCount`, `extractionFallbackNeeded`, and `stage3bMs` from the pipeline shell so `main.mjs` can continue at Stage 3c.

Out of scope:

- Moving Stage 3c merge/fallback.
- Moving Stage 3d Agentic NULL Recovery.
- Moving final table persistence or Stage 4 Guardian verification.
- QA extraction.
- Closing Q13 with a real Supabase fixture strategy.

D9 measurement:

| Metric | Baseline before tracer 3b-3-2 | Current after tracer 3b-3-2 | Notes |
|--------|--------------------------------|-----------------------------|-------|
| `main.mjs` line count | 4083 | 3972 | Stage 3b extraction moved out. |
| `table-pipeline.mjs` line count | 477 | 638 | Stage 3b extraction helper moved in. |
| `table-pipeline.test.mjs` line count | 521 | 677 | Added per-paper extraction success and parent-abort regression coverage. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new Stage 3b tests expected `tableSpec`, `extractionResults`, and parent-abort rejection from the pipeline.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 12 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker. It confirmed:
  - `main.mjs` Stage 3c/3d continuation receives all needed values;
  - parent abort behavior and per-paper timeout composition were preserved;
  - Stage 3c/3d/persistence/Guardian were not moved in this slice;
  - new tests cover extraction output shape, context assembly, column sanitization, and parent abort before persistence.

Residual P3 risk:

- Stage 3c continuation is not yet covered by an end-to-end shell-plus-main integration test.
- The all-fail extraction branch that sets `extractionFallbackNeeded=true` should be covered when Stage 3c merge/fallback moves.

Next intended slice:

- Tracer 3b-3-3 should move only Stage 3c merge/fallback into `chat/table-pipeline.mjs`.
- It should add coverage for all-fail extraction fallback and merged-empty fallback before moving Stage 3d or persistence.

## Stage 2A Tracer Bullet 3b-3-3

Status: completed 2026-05-10.

Scope:

- Moved Stage 3c merge/fallback into `apps/desktop/electron/chat/table-pipeline.mjs` as `runStage3cMergeFallback`.
- Preserved Stage 3c behavior:
  - emit the assembling status before table generation;
  - merge successful per-paper extraction results through injected `mergeExtractionResultsFn`;
  - skip merge when Stage 3b marked fallback needed;
  - fall back to the single-call table agent when all per-paper extractions fail;
  - fall back when a code-only merge produces no rows;
  - assemble combined RAG context through injected `assembleRagContextFn`;
  - normalize fallback output through injected `normalizeFallbackTableToSpecFn`;
  - preserve fallback diagnostics in `tableSpecAdherence`;
  - preserve `extractionMode: "single_call_fallback"`, `agenticRecovery.skippedReason`, and `nullSummary: null`;
  - abort after fallback generation and before normalization or shell continuation.
- Returned `tableJson`, `nullSummary`, `extractionMode`, `agenticRecovery`, `tableSpecAdherence`, and the final `extractionFallbackNeeded` flag from the pipeline shell so `main.mjs` can continue at Stage 3d.

Out of scope:

- Moving Stage 3d Agentic NULL Recovery.
- Moving final table persistence or Stage 4 Guardian verification.
- QA extraction.
- Closing Q13 with a real Supabase fixture strategy.

D9 measurement:

| Metric | Baseline before tracer 3b-3-3 | Current after tracer 3b-3-3 | Notes |
|--------|--------------------------------|-----------------------------|-------|
| `main.mjs` line count | 3972 | 3941 | Stage 3c merge/fallback moved out. |
| `table-pipeline.mjs` line count | 638 | 741 | Stage 3c merge/fallback helper moved in. |
| `table-pipeline.test.mjs` line count | 677 | 1007 | Added merge/fallback and fallback-abort regression coverage. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new Stage 3c tests expected `extractionMode`, `tableJson`, `nullSummary`, fallback metadata, and diagnostics from the pipeline.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 16 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue. It confirmed:
  - `main.mjs` Stage 3d continuation receives all needed values;
  - all-fail and merged-empty fallback behavior matches the previous flow;
  - fallback preserves `single_call_fallback` metadata and clears `nullSummary`;
  - abort guards still exist after fallback generation, after Stage 3d, and before final persistence;
  - Stage 3d, persistence, Guardian, and QA bodies were not moved in this slice.
- The validation agent's P3 fallback-generation abort coverage gap was closed by adding `aborts after single-call fallback generation before normalization or shell continuation`.

Next intended slice:

- Review with Claude before moving Stage 3d.
- If approved, split the next work into small pieces rather than moving all remaining table logic at once:
  - Tracer 3c-1: Stage 3d Agentic NULL Recovery movement.
  - Tracer 3c-2: final table persistence and extraction metadata assembly.
  - Tracer 3c-3: Stage 4 Guardian verification plus `shellOnly` cleanup.

## Stage 2A Tracer Bullet 3c-1

Status: completed 2026-05-10.

Scope:

- Moved Stage 3d Agentic NULL Recovery orchestration into `apps/desktop/electron/chat/table-pipeline.mjs`.
- Followed Claude's Option B: the wrapper/flow now lives in `chat/table-pipeline.mjs`, while the existing recovery helpers remain in `main.mjs` and are passed by dependency injection.
- Preserved Stage 3d behavior:
  - skip recovery for `single_call_fallback`;
  - gate recovery through injected `shouldTriggerAgenticRecoveryFn`;
  - clone table and NULL summary before applying recovered values;
  - group NULL cells by paper;
  - run paper-scoped recovery search;
  - ignore papers with no new recovery context;
  - call the NULL-cell extraction LLM with a 30s per-paper timeout;
  - apply only injected high-confidence recovered values;
  - append recovered evidence chunks/figures back into `ragResults`;
  - rebuild `evidenceLocationsByPaper` when recovered evidence is appended;
  - fail soft on per-paper recovery errors.
- `main.mjs` now resumes after Stage 3d at table post-processing and persistence.
- `main.mjs` was restored from the UTF-8 HEAD source after a PowerShell rewrite corrupted Korean literals, then the current Stage 2A wiring was reapplied.

Out of scope:

- Moving final table persistence.
- Moving Stage 4 Guardian verification.
- QA extraction.
- Closing Q13 with a real Supabase fixture strategy.
- Broad extraction of all Stage 3d helper functions into a new helper module.

D9 measurement:

| Metric | Baseline before tracer 3c-1 | Current after tracer 3c-1 | Notes |
|--------|-----------------------------|---------------------------|-------|
| `main.mjs` line count | 3941 | 3734 | Stage 3d orchestration moved out and `runAgenticNullRecovery` removed. |
| `table-pipeline.mjs` line count | 741 | 1098 | Stage 3d wrapper and flow moved in. |
| `table-pipeline.test.mjs` line count | 1007 | 1288 | Added Stage 3d success, skip, fail-soft, and abort coverage. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new Stage 3d recovery test expected recovered table values and evidence updates from the pipeline.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 19 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue. It confirmed:
  - `main.mjs` no longer owns `runAgenticNullRecovery` or the Stage 3d flow block;
  - helper-only DI remains in `main.mjs`;
  - `chat/table-pipeline.mjs` returns recovered `tableJson`, `nullSummary`, `agenticRecovery`, `ragResults`, and `evidenceLocationsByPaper`;
  - `single_call_fallback` does not trigger Stage 3d;
  - recovery success, fail-soft behavior, recovered evidence append, and evidence-location rebuild are covered;
  - chat/Q&A/status Korean strings were not newly corrupted after the UTF-8 restoration.
- The validation agent's P3 Stage 3d abort gap was closed by adding `aborts after Stage 3d recovery before shell continuation or persistence`.

Next intended slice:

- Review with Claude before moving persistence.
- Tracer 3c-2 should move only final table persistence and extraction metadata assembly into the pipeline.
- Stage 4 Guardian verification and `shellOnly` cleanup should remain for Tracer 3c-3.

## Stage 2A Tracer Bullet 3c-2

Status: completed 2026-05-10.

Scope:

- Moved final table persistence into `apps/desktop/electron/chat/table-pipeline.mjs`.
- Moved `extractionMetadata` assembly with persistence so the table pipeline now writes:
  - assistant `chat_messages` rows with `message_type: "table_report"`;
  - `chat_generated_tables` rows with `source_refs` and metadata;
  - generated-table `table_id` back into assistant message metadata;
  - `chat_conversations.phase = "follow_up"`;
  - `CHAT_COMPLETE` payload emission.
- Kept Stage 4 Guardian verification in `main.mjs` as the only remaining `shellOnly` continuation.
- Passed production helper functions by dependency injection:
  - `cleanCellValueFn`;
  - `serializeEvidenceLocationsFn`;
  - `enrichSourceRefsWithEvidenceFn`.
- Confirmed the current schema/code does not contain a separate `chat_message_source_refs` table; this slice moved the existing `chat_generated_tables.source_refs` behavior.

Out of scope:

- Moving Stage 4 Guardian verification.
- Removing `shellOnly`.
- Broad helper extraction into `chat/extraction-helpers.mjs`.
- QA extraction.
- Closing Q13 with real Supabase fixtures.

D9 measurement:

| Metric | Baseline before tracer 3c-2 | Current after tracer 3c-2 | Notes |
|--------|-----------------------------|---------------------------|-------|
| `main.mjs` line count | 3734 | 3636 | Final table persistence and metadata assembly moved out. |
| `table-pipeline.mjs` line count | 1098 | 1258 | Added `persistTableReport` and helper defaults. |
| `table-pipeline.test.mjs` line count | 1288 | 1398 | Added persistence/metadata/clean-cell regression coverage. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new persistence test expected the pipeline to insert `chat_messages` and `chat_generated_tables`.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 20 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue. It confirmed:
  - abort-before-persistence no-insert behavior is preserved;
  - persistence order moved as intended;
  - production helper DI is wired from `main.mjs`;
  - Stage 4 still receives `ragResults`, `tableJson`, `tableId`, and `messageId`.
- Residual risk: persistence is still not transactional, so partial writes remain possible if a failure occurs after the first insert. This matches the pre-existing behavior and is not expanded by this slice.

Next intended slice:

- Ask Claude to review Tracer 3c-2.
- Tracer 3c-3 should move only Stage 4 Guardian verification and remove the temporary `shellOnly` continuation.

## Stage 2A Tracer Bullet 3c-3

Status: completed 2026-05-11.

Scope:

- Moved Stage 4 Guardian verification scheduling into `apps/desktop/electron/chat/table-pipeline.mjs`.
- Preserved Guardian behavior:
  - schedule work in the background through `scheduleImmediateFn`;
  - emit `verifying` status;
  - collect numeric table cells;
  - sample up to 50 cells;
  - call `checkGroundednessFn`;
  - write `chat_generated_tables.verification`;
  - emit `CHAT_VERIFICATION_DONE` through `emitVerificationDone`;
  - keep verification failures fail-soft and non-fatal.
- Removed the temporary `shellOnly` continuation from the runtime path.
- `main.mjs` now returns `await runTableConversationPipeline({...})` directly for table conversations.
- Kept production IPC output minimal: by default the pipeline returns only `{ conversationId, messageId, hasTable, tableId }`.
- Temporarily added `includePipelineContext: true` only for desktop Node tests that needed internal stage context; this was later removed in the Plan 12 Stage 3 cleanup.

Out of scope:

- QA extraction.
- Broad helper extraction into `chat/extraction-helpers.mjs`.
- Transactional persistence/partial-write cleanup.
- Q13 real Supabase fixtures.
- Guardian sampling-cap and fail-soft dedicated tests beyond the scheduling regression.

D9 measurement:

| Metric | Baseline before tracer 3c-3 | Current after tracer 3c-3 | Notes |
|--------|-----------------------------|---------------------------|-------|
| `main.mjs` line count | 3636 | 3569 | Stage 4 Guardian body and `shellOnly` branch removed. |
| `table-pipeline.mjs` line count | 1258 | 1352 | Added Guardian scheduling and minimal/default return handling. |
| `table-pipeline.test.mjs` line count | 1398 | 1483 | Added Guardian scheduling and no-`shellOnly` regression; tests temporarily opted into `includePipelineContext`, which was later removed. |

Verification:

- RED: `cmd /c npm run test` failed before implementation because the new Guardian test expected no `shellOnly` result and a scheduled verification task.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 2 suites, 21 tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent first found one P2: the direct pipeline return exposed internal context over IPC. This was first fixed by making internal context opt-in through `includePipelineContext: true`; the later Plan 12 Stage 3 cleanup removed that escape hatch entirely.

Stage 2A status:

- Stage 2A table pipeline extraction is complete for setup, orchestration, RAG/metadata, Stage 3a parsing, Stage 3b per-paper extraction, Stage 3c merge/fallback, Stage 3d Agentic NULL Recovery, final persistence, and Stage 4 Guardian scheduling.
- `main.mjs` still owns the Q&A branch and helper functions that are temporarily dependency-injected into `chat/table-pipeline.mjs` under D19.
- Q5/Q6/Q7/Q8/Q10 are closed as of 2026-05-11.
- Next architecture work should move source evidence and broad pure helpers into dedicated helper modules.

## Plan 12 Stage 3 Source Evidence Slice

Status: completed 2026-05-11.

Scope:

- Created `apps/desktop/electron/chat/source-evidence.mjs`.
- Moved source evidence labeling and serialization helpers out of `main.mjs`:
  - `formatEvidenceLocation`;
  - `buildEvidenceLocationsByPaper`;
  - `enrichSourceRefsWithEvidence`;
  - `serializeEvidenceLocations`.
- Updated `main.mjs` Q&A and RAG-context assembly paths to import source evidence helpers.
- Updated `chat/table-pipeline.mjs` to import source evidence helpers directly.
- Removed temporary source-evidence DI parameters from `runTableConversationPipeline`:
  - `buildEvidenceLocationsByPaperFn`;
  - `serializeEvidenceLocationsFn`;
  - `enrichSourceRefsWithEvidenceFn`.
- Added desktop Node tests for main PDF labels, supplementary PDF labels, and missing source metadata fallback.

Out of scope:

- Stage 3d helper extraction.
- Broad Stage 3b/3c table-extraction helper extraction.
- QA branch extraction.
- Q13 real Supabase fixture strategy.
- Changing source evidence label copy or citation numbering behavior.

D9 measurement:

| Metric | Baseline before source-evidence slice | Current after source-evidence slice | Notes |
|--------|---------------------------------------|-------------------------------------|-------|
| `main.mjs` line count | 3569 | 3480 | Source evidence helpers moved out. |
| `table-pipeline.mjs` line count | 1352 | 1332 | Source evidence defaults and DI removed. |
| `source-evidence.mjs` line count | 0 | 88 | New pure helper module. |
| Desktop test count | 3 suites / 21 tests | 3 suites / 24 tests | Added 3 source-evidence helper tests. |

Verification:

- RED: `cmd /c npm run test` failed with approved escalation because `chat/source-evidence.mjs` did not exist.
- GREEN: `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 3 suites, 24 tests.
- `node --check apps/desktop/electron/chat/source-evidence.mjs` passed.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs` passed.
- `node --check apps/desktop/electron/main.mjs` passed.
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker and confirmed:
  - main PDF, supplementary PDF, and missing-source fallback labels are preserved;
  - table-pipeline persistence, Stage 3d evidence rebuild, source refs, and metadata still use the evidence map correctly;
  - the Q&A path still builds and serializes evidence locations through the extracted helper;
  - `source-evidence.mjs` has no imports, so the new dependency direction does not create a circular import risk.
- The validation agent's only non-blocking note was an unused `enrichSourceRefsWithEvidence` import in `main.mjs`; it was removed and `node --check` plus desktop tests still pass.

Next intended slice:

- Ask Claude and a validation agent to review before moving Stage 3d helpers.
- If approved, extract Stage 3d helper logic into a focused module such as `chat/agentic-null-recovery.mjs`.

## Plan 12 Stage 3 Agentic NULL Recovery Helper Slice

Status: completed 2026-05-11, pending external review.

Scope:

- Created `apps/desktop/electron/chat/agentic-null-recovery.mjs`.
- Moved Stage 3d pure helper behavior out of `main.mjs`:
  - `shouldTriggerAgenticRecovery`;
  - `buildSkippedAgenticRecovery`;
  - `groupNullsByPaper`;
  - `uniqueStrings`;
  - `buildRecoveryQueries`;
  - `getChunkId`;
  - `getFigureId`;
  - `appendUniqueById`;
  - `isNullTableCell`;
  - `cloneTableForRecovery`;
  - `cloneNullSummaryForRecovery`;
  - `assembleRecoveryContext`;
  - `applyRecoveredValues`.
- Updated `chat/table-pipeline.mjs` to import those helpers directly.
- Removed the temporary Stage 3d helper DI parameters from `runTableConversationPipeline`.
- Kept `runPaperScopedRecoverySearch` in `main.mjs` by design because it still calls `runMultiQueryRag`; `table-pipeline.mjs` receives it explicitly as `runPaperScopedRecoverySearchFn`.
- Kept `extractNullCellsFromPaperFn` as an injected LLM dependency.

Out of scope:

- Exporting or moving `runMultiQueryRag`.
- Moving paper-scoped recovery search out of `main.mjs`.
- Broad Stage 3b/3c table extraction helper split.
- QA branch extraction.
- Q13 real Supabase fixture strategy.

D9 measurement:

| Metric | Baseline before agentic helper slice | Current after agentic helper slice | Notes |
|--------|--------------------------------------|------------------------------------|-------|
| `main.mjs` line count | 3480 | 3295 | Stage 3d pure helper block removed; paper-scoped recovery search remains. |
| `table-pipeline.mjs` line count | 1332 | 1268 | Temporary Stage 3d helper DI removed. |
| `agentic-null-recovery.mjs` line count | 0 | 242 | New focused helper module. |
| Desktop test count | 3 suites / 24 tests | 4 suites / 30 tests | Added 6 helper-level recovery tests. |

Verification:

- RED: `node --test tests\agentic-null-recovery.test.mjs` first failed with approved escalation because `chat/agentic-null-recovery.mjs` did not exist.
- GREEN: `node --test tests\agentic-null-recovery.test.mjs` in `apps/desktop` passed with approved escalation: 6 tests.
- `node --check apps/desktop/electron/chat/agentic-null-recovery.mjs`
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 4 suites, 30 tests.
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker and confirmed the dependency direction: `agentic-null-recovery.mjs` is pure, `table-pipeline.mjs` imports it directly, and `main.mjs` keeps `runMultiQueryRag` private behind `runPaperScopedRecoverySearchFn`.
- The validation agent's non-blocking test-helper note was resolved by narrowing `createStage3dDeps` to only `runPaperScopedRecoverySearchFn` and `extractNullCellsFromPaperFn`; `node --check`, desktop tests, desktop build, and `git diff --check` still pass after cleanup.

Residual risks resolved by next slice:

- `agentic-null-recovery.mjs` originally owned local copies of column sanitization/key-term/column-key normalization logic. The follow-up extraction-utils slice moved those helpers into `chat/extraction-utils.mjs`.

## Plan 12 Stage 3 Extraction Utils Cleanup Slice

Status: completed 2026-05-11, pending external review.

Scope:

- Created `apps/desktop/electron/chat/extraction-utils.mjs`.
- Moved shared extraction normalization helpers into it:
  - `extractKeyTerms`;
  - `sanitizeColumnNames`;
  - `normalizeColumnKey`.
- Updated `main.mjs` to import `extractKeyTerms` and `normalizeColumnKey` from the shared module.
- Updated `chat/agentic-null-recovery.mjs` to import all three helpers from the shared module.
- Updated `chat/table-pipeline.mjs` to import `sanitizeColumnNames` directly.
- Removed the temporary `sanitizeColumnNamesFn` DI parameter from `runTableConversationPipeline`.

Out of scope:

- Moving `runMultiQueryRag`.
- Moving `runPaperScopedRecoverySearch`.
- Broad Stage 3b/3c table extraction helper split.
- QA branch extraction.
- Q13 real Supabase fixture strategy.

D9 measurement:

| Metric | Baseline before extraction-utils slice | Current after extraction-utils slice | Notes |
|--------|----------------------------------------|--------------------------------------|-------|
| `main.mjs` line count | 3295 | 3221 | Normalizer/key-term helper copies removed from `main.mjs`. |
| `table-pipeline.mjs` line count | 1268 | 1262 | `sanitizeColumnNamesFn` DI removed. |
| `agentic-null-recovery.mjs` line count | 242 | 178 | Local normalizer/key-term copies removed. |
| `extraction-utils.mjs` line count | 0 | 66 | New shared utility module. |
| Desktop test count | 4 suites / 30 tests | 5 suites / 33 tests | Added 3 utility tests. |

Verification:

- RED: `node --test tests\extraction-utils.test.mjs` first failed with approved escalation because `chat/extraction-utils.mjs` did not exist.
- GREEN: `node --test tests\extraction-utils.test.mjs` passed with approved escalation: 3 tests.
- `node --check apps/desktop/electron/chat/extraction-utils.mjs`
- `node --check apps/desktop/electron/chat/agentic-null-recovery.mjs`
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 5 suites, 33 tests.
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker and confirmed there is no behavior drift in the normalization helpers, no circular import, and no ownership leak.
- The validation agent's non-blocking test-fixture note was resolved by removing the ignored `sanitizeColumnNamesFn` override from `apps/desktop/tests/table-pipeline.test.mjs`; the test now uses `"Dose\u00B2"` and exercises the real shared sanitizer. `node --check`, desktop tests, desktop build, and `git diff --check` still pass after cleanup.

Residual risks:

- The helper split now centralizes normalization, but Stage 3b/3c table extraction helpers still live in `main.mjs` and are passed by DI. A later focused `chat/table-extraction.mjs` slice should remove that remaining table-extraction DI.

Next intended slice:

- Ask Claude to review this extraction-utils cleanup slice with a blocking-risk lens.
- Then prefer a focused `chat/table-extraction.mjs` split for Stage 3b/3c helpers before QA branch extraction.

## Plan 12 Stage 3 Table Extraction Helper Split

Status: completed 2026-05-11, pending external review.

Scope:

- Created `apps/desktop/electron/chat/table-extraction.mjs`.
- Moved table helper behavior out of `main.mjs`:
  - `cleanCellValue`;
  - `assembleRagContext`;
  - `assemblePerPaperContext`;
  - `normalizeFallbackTableToSpec`;
  - `mergeExtractionResults`.
- Updated `chat/table-pipeline.mjs` to import these helpers directly.
- Updated `chat/agentic-null-recovery.mjs` so `assembleRecoveryContext` imports and uses `assemblePerPaperContext` directly.
- Removed these temporary helper DI parameters from `runTableConversationPipeline`:
  - `assemblePerPaperContextFn`;
  - `mergeExtractionResultsFn`;
  - `assembleRagContextFn`;
  - `normalizeFallbackTableToSpecFn`;
  - `cleanCellValueFn`.
- Added `apps/desktop/tests/table-extraction.test.mjs` with direct coverage for cleanup, fallback normalization, context assembly, per-paper context assembly, and merge behavior.
- Updated table-pipeline fixtures to exercise the real helper behavior instead of injecting fake Stage 3b/3c helper results.
- Resolved validation-agent P3 by adding direct tests for `assembleRagContext` and `assemblePerPaperContext`.
- Kept runtime dependencies injected:
  - `generateTableFromSpecFn`;
  - `runPaperScopedRecoverySearchFn`;
  - `extractNullCellsFromPaperFn`;
  - parser/LLM/Supabase boundary helpers.

Out of scope:

- Moving `runMultiQueryRag`.
- Moving `runPaperScopedRecoverySearch`.
- QA branch extraction.
- Q13 real Supabase fixture strategy.
- `includePipelineContext` cleanup.

D9 measurement:

| Metric | Baseline before table-extraction split | Current after table-extraction split | Notes |
|--------|----------------------------------------|--------------------------------------|-------|
| `main.mjs` line count | 3221 | 2507 | Table extraction helper blocks removed; QA/RAG infrastructure still remain. |
| `table-pipeline.mjs` line count | 1262 | 1115 | Remaining helper DI surface reduced to actual runtime boundaries. |
| `agentic-null-recovery.mjs` line count | 178 | 154 | `assemblePerPaperContextFn` dependency removed. |
| `table-extraction.mjs` line count | 0 | 279 | New focused helper module. |
| Desktop test count | 5 suites / 33 tests | 6 suites / 38 tests | Added 5 helper-level table extraction tests. |

Verification:

- RED: `node --test tests\table-extraction.test.mjs` first failed with approved escalation because `chat/table-extraction.mjs` did not exist.
- GREEN: `node --test tests\table-extraction.test.mjs` passed with approved escalation: 5 tests.
- `node --check apps/desktop/electron/chat/table-extraction.mjs`
- `node --check apps/desktop/electron/chat/agentic-null-recovery.mjs`
- `node --check apps/desktop/electron/chat/table-pipeline.mjs`
- `node --check apps/desktop/electron/main.mjs`
- `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 6 suites, 38 tests.
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.

Residual risks:

- `runPaperScopedRecoverySearch` still lives in `main.mjs` by design because it wraps `runMultiQueryRag`.

## Plan 12 Stage 3 includePipelineContext Cleanup

Status: completed 2026-05-11.

Scope:

- Removed the `includePipelineContext` option from `runTableConversationPipeline`.
- Kept the public table pipeline return payload minimal:
  - `conversationId`;
  - `messageId`;
  - `hasTable`;
  - `tableId`.
- Kept `persistTableReport`'s private `tableJson`, `sourceRefs`, and `extractionMetadata` return available only inside `chat/table-pipeline.mjs` for Guardian scheduling.
- Updated `apps/desktop/tests/table-pipeline.test.mjs` to verify behavior through public results, emitted completion payloads, fake Supabase inserts/updates, and injected runtime callback inputs instead of private pipeline context.

Out of scope:

- Moving `runMultiQueryRag`.
- Moving `runPaperScopedRecoverySearch`.
- QA branch extraction.
- Q13 real Supabase fixture strategy.
- Transactional persistence cleanup.

D9 measurement:

| Metric | Baseline before cleanup | Current after cleanup | Notes |
|--------|-------------------------|-----------------------|-------|
| `main.mjs` line count | 2507 | 2507 | No main-process logic change. |
| `table-pipeline.mjs` line count | 1115 | 1086 | Test-only return branch removed. |
| `table-pipeline.test.mjs` line count | 1159 | 1158 | Assertions now observe persisted rows/callback inputs instead of private pipeline context. |
| Desktop test count | 6 suites / 38 tests | 6 suites / 38 tests | Coverage count unchanged; coupling reduced. |

Verification:

- RED: `node --test apps\desktop\tests\table-pipeline.test.mjs` failed after removing the production branch because tests still expected private pipeline context.
- GREEN: `node --test apps\desktop\tests\table-pipeline.test.mjs` passed after moving those assertions to observable payloads and callback inputs.
- `Select-String` found no remaining `includePipelineContext` usage in Electron chat modules or desktop tests.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs` passed.
- `cmd /c npm run test` in `apps/desktop` passed with approved escalation: 6 suites, 38 tests.
- `cmd /c npm run build` in `apps/desktop` passed.
- `git diff --check` passed with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent found no blocker/P1/P2/P3 and confirmed the pipeline API no longer exposes internal stage context.

## Remaining Open Items For Stage 2A

1. Defer `runMultiQueryRag` signal propagation to a later RAG extraction slice unless the user explicitly expands Stage 2A.
2. Preserve this contract in Stage 2A: if abort is requested before table persistence, no assistant message or generated table should be inserted.
3. Stage 3d abort-after-wrapper is now covered: if the parent abort signal is set during recovery, the pipeline throws before shell continuation or persistence. Per-paper recovery errors still remain fail-soft by design.
4. `CHAT_STATUS` `stage: null` type mismatch is resolved in `frontend/src/types/desktop.ts`.
5. Q12 LLM mock strategy is closed as D13: frontend uses `vi.mock` plus direct fetch stubs; desktop Node tests use dependency injection.
6. Choose the Supabase fixture strategy from Q13 before replacing fake Supabase coverage with database-heavy regression fixtures.
7. Desktop-side placeholder test now passes through `cmd /c npm run test` with approved escalation after the default sandbox hits `spawn EPERM`.
8. Stage 2A now has multiple chat-flow abort regressions in `apps/desktop/tests/table-pipeline.test.mjs`; future async pipeline extractions should keep the D24 policy of at least one targeted abort regression or a documented non-abortable reason.
9. Keep Stage 4 Guardian verification as a best-effort background verifier unless the user requests stronger synchronous guarantees.

## Verification Commands

```powershell
Select-String -Path apps\desktop\electron\main.mjs -Pattern "CHAT_SEND_MESSAGE|runMultiQueryRag|runAgenticNullRecovery|handleQaPipeline"
git diff --check
```

## fix 18 P0-A Regression Test Coverage

Status: completed 2026-06-08.

Scope:

- Added test-only coverage for the fix 18 P0-A non-blocking single-call fallback behavior in `apps/desktop/tests/table-pipeline.test.mjs`.
- No production code changed. `chat/table-pipeline.mjs` and `chat/table-extraction.mjs` already implement P0-A/P0-B (`runStage3cMergeFallback` try/catch at lines 591-620, salvage/empty-table path with `notes`, `FALLBACK_RAG_BUDGET`).
- Reused the existing empty-merge fallback setup (every per-paper row blank via `extractColumnsFromPaperFn` returning `{ values: { [col]: "" } }`), which forces the Stage 3c code merge to produce zero rows and route into the single-call fallback path.

Added cases:

| Case | Fake `generateTableFromSpecFn` behavior | Asserted pipeline behavior |
|------|------------------------------------------|----------------------------|
| Timeout non-abort (P0-A core) | throws `DOMException("The operation was aborted due to timeout", "TimeoutError")` | pipeline does NOT throw; `hasTable: true`; `chat_generated_tables` insert has `metadata.extractionMode === "single_call_fallback"`, `rows: []`, `headers: ["Outcome"]`; assistant `chat_messages` content JSON has `notes` matching `시간 내에 완료되지 못` |
| Generic error salvage | throws `new Error("Ollama request failed")` | pipeline does NOT throw; `rows: []`; `extractionMode === "single_call_fallback"` |
| User abort propagation (P0-A boundary) | calls `abortController.abort()` then throws `AbortError` | pipeline rejects with `err.name === "AbortError"` (re-thrown by `throwIfChatAborted(abortSignal)` at `table-pipeline.mjs:599`); no `chat_messages` or `chat_generated_tables` inserts |

Design notes:

- `notes` is not a `chat_generated_tables` column. It lives on `tableJson` and is serialized into the assistant `chat_messages.content` via `JSON.stringify(tableJson)` in `persistTableReport`. Tests assert it by `JSON.parse(messageInsert.data.content).notes`.
- The empty-table salvage path persists normally because RAG returned chunks (so the no-data early return is not taken). `persistTableReport` handles `rows: []` safely; Guardian scheduling iterates an empty row set with no error.
- The "salvage non-empty `mergedTableJson` rows" branch (`table-pipeline.mjs:609-610`) is not reachable through the public `runTableConversationPipeline` entry: when the per-paper merge yields rows, the code never enters the fallback (`extractionFallbackNeeded` stays false). It can only be reached via a forced-fallback-after-non-empty-merge state, which the current flow does not produce. Not tested because reproducing it would require modifying production code (out of scope) and the real timeout log shows all papers at `data_rows=0`, which is the empty-merge case already covered.

D9 measurement:

| Metric | Baseline before fix 18 test coverage | Current after fix 18 test coverage | Notes |
|--------|--------------------------------------|------------------------------------|-------|
| `table-pipeline.test.mjs` test count | 18 | 21 | Added 3 P0-A fallback cases. |
| `table-pipeline.mjs` line count | 1086 (Stage 2A cleanup) → unchanged by fix 18 P0 + this slice | unchanged | Test-only slice. |
| Full desktop unit suite | n/a | 60 tests / 13 suites pass | `node --test tests/*.test.mjs`. |

Verification:

- `node --check apps/desktop/tests/table-pipeline.test.mjs` passed.
- `node --check apps/desktop/electron/chat/table-pipeline.mjs` passed.
- `node --check apps/desktop/electron/chat/table-extraction.mjs` passed.
- `node --test tests/table-pipeline.test.mjs` in `apps/desktop` passed: 21 tests, 0 fail.
- `node --test tests/*.test.mjs` in `apps/desktop` passed: 60 tests / 13 suites, 0 fail (no regressions).
- Logs confirm the salvage path executes: `[Chat] Stage 3c: single-call fallback failed (non-abort), returning salvaged/empty table: The operation was aborted due to timeout` (and `... : Ollama request failed`); the abort case short-circuits before that log line, confirming AbortError propagation.

## fix 19 — Force per-paper rows + surface missing-data reasons

Status: completed 2026-06-09 (P0; P1 deferred to a separate fix).

Goal: a comparison table must never render "headers + references only". Every scope paper that produced no data is shown as an all-N/A row, and *why* it is empty is surfaced to the user.

Production changes:

- `chat/table-extraction.mjs` `mergeExtractionResults` (done by the prior fixer, verified here):
  - After the real-data merge loop, every scope paper not in `usedPaperIds` (empty `data_rows` or `success=false`) gets an all-N/A placeholder row. The identity column is N/A too (decision **B** in the plan — no invented material name; the paper is identified via `[refNo]` + the reasons section). Placeholder rows bypass the >50% N/A drop rule and are NOT recorded in `nullSummary` (so Stage 3d does not re-search a paper already judged empty, and the real-row NULL gate is not skewed).
  - Placeholder papers are added to `usedPaperIds`, so `references` covers the full scope (not just papers that yielded data).
  - Collects `reasons: [{ paperId, paperTitle, refNo, hadRows, failed, note }]`. `note` = trimmed per-paper `extraction.notes`, falling back to `"Extraction failed: <error>"` (when `success=false`) or `"No matching data found in this paper"`.
  - Sets `tableJson.notes` to `"<M> of <N> paper(s) had no matching data; see the missing-data notes below."` (previously always `""`).
  - Return signature widened to `{ tableJson, nullSummary, reasons }`.
- `chat/table-pipeline.mjs` (completed in this slice — the prior fixer had only received `merged.reasons` into a local and stopped):
  - `runStage3cMergeFallback` now returns `perPaperReasons` (was dropped from the return object). The single-call fallback path leaves it `[]`.
  - `runStage3dAgenticNullRecovery` already spreads `...stage3cContext`, so `perPaperReasons` flows through untouched.
  - `persistTableReport` takes `perPaperReasons` and writes it into `extractionMetadata.perPaperReasons`, which is persisted to `chat_generated_tables.metadata` (existing JSONB column — no migration).
  - The pipeline orchestrator passes `stage3dContext.perPaperReasons` into `persistTableReport`.

Frontend changes:

- `frontend/src/types/chat.ts`: added `PerPaperReason`, `PartialExtractionFailure`, `ChatTableMetadata` types and `metadata?: ChatTableMetadata | null` on `ChatGeneratedTable` (optional — `useChatTable` selects `*` so the column flows through with no mapper change; optional avoids breaking other `ChatGeneratedTable` literals e.g. advisor tests). No `any`.
- `frontend/src/features/chat/ChatTableReport.tsx`: a "No data found" section below the verification legend renders `metadata.perPaperReasons` entries with `hadRows === false` as "[refNo] title — note". Hidden when none. Reason strings stay English (LLM notes); labels are localized via `t()`. The all-N/A placeholder rows themselves are already visible through the existing row renderer.

Effect on the fix 18 fallback path: because the merge now always emits placeholder rows, `tableJson.rows.length === 0` after a code merge no longer occurs, so the single-call fallback is only reached via the upstream forced path (`extractionSuccessCount === 0 && extractionFailCount > 0`, i.e. every per-paper extraction threw). The fix 18 P0-A salvage behavior is unchanged and still covered; the regression tests below were re-pointed from the (now unreachable) empty-merge trigger to the failed-extraction trigger.

Test changes (`apps/desktop/tests`):

| File | Change |
|------|--------|
| `table-extraction.test.mjs` | Updated the existing merge test to the new behavior (a `success=false` paper now yields an all-N/A placeholder row + is included in references + carries a failure reason). Added a case where all scope papers are empty → both become placeholder rows, reasons carry per-paper notes/defaults, `tableJson.notes` matches `2 of 2 paper`. |
| `table-pipeline.test.mjs` | Re-pointed the 4 fallback cases (empty-merge → single-call) to trigger fallback via `extractColumnsFromPaperFn` throwing (every extraction fails) instead of returning blank `data_rows` (which now becomes placeholder rows). Added an end-to-end case: paper-1 has data, paper-2 returns empty `data_rows` + `notes` → persisted `chat_generated_tables.metadata.perPaperReasons` has `paper-1 hadRows=true`, `paper-2 hadRows=false` with its LLM note. |

Verification:

- `node --check apps/desktop/electron/chat/table-extraction.mjs apps/desktop/electron/chat/table-pipeline.mjs` passed.
- `node --test tests/*.test.mjs` in `apps/desktop` passed: 62 tests / 13 suites, 0 fail (was 60; +2 extraction, +1 pipeline; existing merge/fallback tests updated, no unexplained regressions).
- `npm run build` (tsc -b + vite) in `frontend` passed.
- `CURRENT_EXTRACTION_VERSION` unchanged (chat runtime + display layer only; PDF extraction artifacts/embeddings untouched). No DB/IPC/new-component changes.
