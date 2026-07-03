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
| `runQaConversationPipeline` | `chat/qa-pipeline.mjs` | QA branch after shared auth/conversation setup — **extracted from `main.mjs` (slice 04, DI pattern, behavior-preserving)** |
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

Current owner: `runQaConversationPipeline` in `chat/qa-pipeline.mjs` (extracted from `main.mjs` in slice 04, table-pipeline DI pattern). `CHAT_SEND_MESSAGE` injects `supabase`, `abortSignal`, `emitStatus/emitToken/emitComplete`, and the RAG/graph/embedding/folder/QA functions; the flow, status events, persistence, and metadata keys below are unchanged from the former inline handler.

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
| Stage 4 | `verifying` then `CHAT_VERIFICATION_DONE` | Background two-pass verification via `setImmediate`: (1) deterministic code back-match (`runCodeBackMatchPass`) marks matrix-backed cells `method:"code"`; (2) Guardian (LLM) only re-checks unmatched cells with narrow MeasHalu claims | `chat_generated_tables.verification` (records carry `method`/`checkType`/`scope`) |

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
| `chat/qa-pipeline.mjs` | **✅ extracted (slice 04)** — QA branch owns `runQaConversationPipeline` (DI, behavior-preserving) | table-specific Stage 3b/3c/3d logic |
| `chat/source-evidence.mjs` | evidence location formatting and source ref enrichment | DB ownership checks |
| `chat/agentic-null-recovery.mjs` | Stage 3d gate, query building, recovery application | top-level table persistence |
| `rag/retrieval.mjs` | `runMultiQueryRag`, RRF, rerank, source-file metadata hydration | IPC handler code |

## Work History

Step-by-step implementation logs (Stage 2A tracer bullets, Plan 12 Stage 3 slices, fix 18/19) were removed from this document; see git history. This harness doc keeps only the **current state** - work process and history belong in the ledger and git.

