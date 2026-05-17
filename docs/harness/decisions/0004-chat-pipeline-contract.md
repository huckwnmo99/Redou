# ADR 0004: Chat Pipeline Contract

Status: accepted
Date: 2026-05-08

## Context

Stage 1 mapped `CHAT_SEND_MESSAGE` before runtime extraction. The current handler owns authentication, conversation setup, QA flow, table orchestration, RAG, per-paper extraction, Stage 3d recovery, persistence, status events, and abort controller cleanup.

Stage 2A will move chat/table orchestration out of `main.mjs`. This ADR defines the contract that extraction must preserve.

## Decision

Future chat/table extraction must use explicit dependencies and stable event contracts.

`main.mjs` remains responsible for:

- IPC registration;
- request authentication;
- initial input normalization;
- choosing the coordinator;
- converting success/error results for the renderer;
- owning the active abort-controller registry unless a dedicated registry module is introduced in the same approved slice.

The extracted pipeline owns:

- QA or table domain flow after authenticated setup;
- RAG request construction;
- table orchestration;
- per-paper extraction;
- Stage 3d recovery;
- source evidence enrichment;
- persistence of assistant messages and generated tables, unless a later repository layer is introduced.

## Required Context Object

The first extracted table pipeline entrypoint should have one explicit context argument.

Recommended shape:

```ts
runTableConversationPipeline({
  supabase,
  conversationId,
  ownerId,
  ownerPaperIds,
  message,
  history,
  scopeFolderId,
  scopeAll,
  abortSignal,
  emitStatus,
  emitToken,
  emitComplete,
  emitError,
  llm,
  rag,
  sourceEvidence,
})
```

Names may change, but hidden access to mutable globals should not increase.

## Event Contract

The renderer-facing event names must stay stable:

- `CHAT_STATUS`
- `CHAT_TOKEN`
- `CHAT_COMPLETE`
- `CHAT_VERIFICATION_DONE`
- `CHAT_ERROR`

Status stages must remain compatible with `frontend/src/types/desktop.ts` and `ChatPipelineStatus`.

Pre-Stage 2A resolved the status clear mismatch by allowing `ChatStatusEvent.stage` to be `ChatPipelineStage | null` in `frontend/src/types/desktop.ts`.

The runtime may still send `CHAT_STATUS` with `stage: null` for clarification, so any extracted helper must preserve this clear-pipeline behavior or expose an explicit clear-pipeline event shape.

## Persistence Contract

The table pipeline must preserve:

- owned conversation scope;
- user message already inserted by the shared setup;
- assistant text messages for clarify/no-data/error paths;
- assistant `table_report` message for table output;
- `chat_generated_tables` row with `message_id`, `conversation_id`, title, headers, rows, source refs, and metadata;
- metadata fields currently used for SRAG and Stage 3d:
  - `extractionMode`;
  - `stage3bMs`;
  - `perPaperTiming`;
  - `partialFailures`;
  - `nullSummary`;
  - `agenticRecovery`;
  - `tableSpecAdherence`;
  - `sourceEvidenceLocations`;
- table/message linkage fields:
  - generated table `message_id`;
  - returned renderer `messageId`;
- verification result shape stored by Stage 4 Guardian;
- future `extractionVersion` or equivalent schema-version marker when the metadata shape changes.

Source refs must preserve paper-level citation numbers while source evidence labels distinguish main PDF and supplementary evidence.

## Abort Contract

Every async phase moved out of `main.mjs` must accept `AbortSignal` or document why it is non-abortable.

Required before Stage 2A closes:

- at least one abort regression test or smoke check;
- explicit behavior for abort before final table persistence;
- explicit behavior for Stage 3d abort;
- no leaked entry in `chatAbortControllers` or its replacement registry.

Default policy:

- abort should cancel final table persistence if it occurs before the table is persisted;
- Stage 4 Guardian verification remains best-effort and non-blocking after table completion.
- `runMultiQueryRag` signal propagation may be deferred to a later RAG extraction slice, but abort during RAG still must not allow assistant/table persistence after cancellation.
- Stage 3d should check `abortSignal.aborted` before entering recovery and again before applying recovered values so fail-soft recovery does not swallow cancellation.

Known current gap:

- `runMultiQueryRag` does not currently accept `AbortSignal`.
- Stage 3d recovery is fail-soft and can swallow abort-like failures.

Stage 2A may document one of these as a temporary limitation only if the user accepts it.

## Test Gate

Stage 2A must not begin as runtime extraction until these are true or explicitly waived by the user:

- Q12 LLM mock strategy is chosen;
- Q13 Supabase fixture strategy is chosen;
- the first desktop-side test dry-run strategy is documented and a placeholder test passes through `cmd /c npm run test` (completed on 2026-05-08 with approved escalation after default sandbox `spawn EPERM`);
- at least one abort scenario from the Stage 1 audit is selected as the first regression;
- Stage 3d metadata preservation expectations are listed in the test/fixture plan.

## Review Rules

Flag a Stage 2A patch if:

- the IPC channel names change without a migration plan;
- auth/user scope moves behind an untested abstraction;
- `ownerId` or `ownerPaperIds` stop being explicit pipeline inputs;
- source evidence formatting loses supplementary labels;
- Stage 3d metadata is dropped or renamed;
- abort can persist a generated table after user cancellation without an explicit accepted decision;
- `main.mjs` gains new chat/table domain logic instead of shrinking.
