# Open Questions

Unresolved Codex-Claude-user questions. Promote answers to `decisions.md` when confirmed.

## Q1: Branch Integration Before Refactor

Status: ANSWERED - see D3 + D4 (`decisions.md`)
Question:

Should runtime architecture refactor wait until `feature/pipeline-v2-only` is reconciled with `origin/main`, given the current merge-tree conflict set?

Default recommendation:

Yes for runtime refactor. Docs-only work can continue before integration.

## Q2: Test Infrastructure Scope

Status: ANSWERED - see D5 (`decisions.md`)
Question:

Should Stage 0.5 create only pure helper tests first, or also set up Electron/preload contract tests immediately?

Default recommendation:

Start with one pure helper test, then add preload contract tests before IPC refactor.

## Q3: Domain Glossary Location

Status: ANSWERED - see D6 (`decisions.md`)
Question:

Should canonical glossary live at root `CONTEXT.md`, `docs/harness/main/glossary.md`, or both?

Default recommendation:

Use both: `CONTEXT.md` as the agent entrypoint, `docs/harness/main/glossary.md` as the detailed canonical glossary.

## Q4: PaperDetail Split Timing

Status: ANSWERED - see D7 (`decisions.md`)
Question:

Should `PaperDetailView.tsx` split happen in parallel with chat/table backend extraction?

Default recommendation:

Yes, if assigned to separate workstreams and only as behavior-preserving mechanical extraction.

## Q5: KPI Hard Gate Numbers

Status: ANSWERED - see D21 (`decisions.md`)
Question:

Should the R1 hard/soft KPI numbers be accepted as written, adjusted after a fresh Stage -1 measurement pass, or kept as soft targets only?

Default recommendation:

Accept the KPI principle now, but measure current values first and ask the user before treating exact line-count, IPC-count, import-count, or coverage numbers as hard gates.

Decision:

Accept measured, stage-specific hard gates instead of the early R1 line-count proposal as written. Stage 2A is closed with `main.mjs <= 3600`, `shellOnly = 0`, table orchestration moved into `chat/table-pipeline.mjs`, and desktop tests/build passing. The earlier `main.mjs <= 2500` Stage 2A proposal becomes a later soft target after broader helper and pipeline extraction.

## Q6: Codex Availability Fallback

Status: ANSWERED - see D22 (`decisions.md`)
Question:

When Codex or the designated code-writing agent is unavailable, should code-changing stages pause completely, or may another tool/agent perform limited code edits?

Default recommendation:

Docs, planning, review, and decision recording may continue. Runtime code changes should pause unless the user explicitly approves a fallback code-writing path.

Decision:

Use the default recommendation. Runtime code changes pause when the designated code-writing agent is unavailable. Docs, planning, review, and decision recording can continue. A fallback code-writing path requires explicit user approval.

## Q7: Repository Facade Sunset Timeline

Status: ANSWERED - see D23 (`decisions.md`)
Question:

Should `supabasePaperRepository` facade sunset follow the proposed 3/6/9/12-month schedule, a shorter threshold-based schedule, or be decided after call-site measurement?

Default recommendation:

Accept the sunset-policy requirement now, but decide the exact timeline after measuring facade call sites during Stage 4 planning.

Decision:

Use the default recommendation. Stage 4 must measure facade call sites first and then propose the sunset policy. Do not remove the facade during Stage 4.

Follow-up measurement:

The 2026-05-15 query hook migration measurement is recorded in D29 and ADR 0005. The result confirms the facade should not be removed immediately; the next safe code-changing step would be a small read-only query-adapter tracer if the user approves it.

## Q8: Abort Test Matrix Scope

Status: ANSWERED - see D24 (`decisions.md`)
Question:

Should Stage 2A require the full five-case abort test matrix before the first chat/table pipeline extraction can close?

Default recommendation:

Require abort behavior to be defined for every async extracted pipeline. Start with at least one meaningful abort regression test in the first extraction PR, then expand to the full matrix as the module stabilizes unless the user wants stricter gates.

Decision:

Use the default recommendation. Stage 2A closure does not require the full five-case matrix in the first tracer, but every async extracted pipeline must define abort behavior and add at least one targeted regression. Stage 2A now has multiple abort regressions across the table pipeline.

## Q9: Stage 0 Single Slice Or Split?

Status: ANSWERED - Stage 0 stayed one docs slice; no 0a/0b split was needed.
Source: Claude review of plan 12 (S6, U1)
Question:

Should Stage 0 remain one docs slice (`CONTEXT.md`, `docs/harness/main/glossary.md`, ADR 0001, ADR 0002, and `AGENTS.md` links), or should it split into Stage 0a/0b?

Decision:

Keep Stage 0 together. The ADRs stayed reviewable, so the implementation-plan escape hatch was not needed.

## Q10: Stage 3 Helper Extraction Order Relative To Stage 2A

Status: ANSWERED - see D15, D16, and D25 (`decisions.md`)
Source: Claude review of plan 12 (S1, U2)
Question:

Should source evidence and Stage 3d helpers be extracted before Stage 2A, after Stage 2A, or together with Stage 2A?

Options:

- A: Stage 2A then Stage 3. This keeps the current plan order but Stage 3 must update `chat/table-pipeline.mjs` callers if Stage 2A already created them.
- B: Stage 3 before Stage 2A. This avoids temporary duplicate helper logic but moves helper extraction earlier.
- C: Combine Stage 2A and Stage 3. This avoids duplication but makes the PR larger.

Decision:

Keep Stage 2A before Stage 3. Split Stage 2A Tracer 3b into smaller setup/orchestrator, RAG/metadata, and extraction/merge sub-steps. Stage 3 helper extraction remains after Stage 2A and must update `chat/table-pipeline.mjs` callers instead of duplicating helper logic.

Reaffirmed 2026-05-11 after Stage 2A closure:

Stage 2A is complete, so the next architecture slice should be Stage 3 helper extraction. Extract source evidence formatting first, then Stage 3d/helper logic, and update both `main.mjs` and `chat/table-pipeline.mjs` callers.

## Q11: Stage 0 Reinforcement Handling

Status: ANSWERED - user approved inline reinforcement on 2026-05-08.
Source: Claude review of Stage 0 outputs (C-2/C-3/C-4)
Question:

Should Claude's Stage 0 reinforcement suggestions be folded into Stage 0 before Stage 0.5, handled as a later follow-up, or left as separate review notes?

Decision:

Fold them into Stage 0 inline before Stage 0.5.

Applied reinforcement scope:

- Added the missing glossary terms requested by Claude.
- Added D9 hard/soft KPI recording rules and D10 code-writing availability behavior to ADR 0001.
- Added D8 mapping, DB query/mutate whitelist ownership, and whitelist migration path to ADR 0002.
- Clarified Stage -1 branch hygiene analysis around `entity_extraction_model` and frontend type union resolution.

## Q12: LLM Mock Library Choice

Status: ANSWERED - see D13 (`decisions.md`)
Source: Claude review of ADR 0003 (S7)
Question:

ADR 0003 defines the LLM/Ollama/VLLM mock scenarios, but not the implementation tool. Which mock pattern should Stage 2A use?

Options:

- A: `vi.mock` + direct fetch stub.
- B: `msw`.
- C: `nock`.
- D: `undici.MockAgent`.

Decision:

Use a two-track mock strategy by test runtime:

- Frontend Vitest tests use `vi.mock` plus direct fetch stubs by default.
- Desktop Node test-runner tests use dependency injection through public module parameters, such as `runTableConversationPipeline({...})`.

This keeps the desktop `.mjs` test harness dependency-light while preserving the original frontend Vitest default.

## Q13: Supabase Fixture Isolation Strategy

Status: ANSWERED - see D30 (`decisions.md`)
Source: Claude review of ADR 0003 (S8)
Question:

ADR 0003 defines the minimum Supabase fixture data, but not the isolation strategy. How should Stage 2A isolate DB tests?

Options:

- A: local Supabase test instance plus per-test cleanup.
- B: mock adapter for the Supabase client.
- C: in-memory pglite or similar SQL fixture.

Default recommendation:

Defer the final choice until Stage 2A planning measures the pipeline seams and repository call shape. The current default is to document the fixture requirements now, then choose the isolation strategy before writing the first database-heavy regression.

Decision:

Stage 4 closes this as a stop-gap rather than choosing a real fixture backend now.

For the Stage 4 repository split, mocked frontend Vitest coverage with `vi.mock` and builder-style Supabase stubs is accepted as sufficient. Real Supabase fixture isolation is deferred to a later series and should be reopened only when DB-heavy regressions, multi-paper auth/RLS checks, workflow integration tests such as `createImportedPaper`, Stage 5 import/processing, or another reliability-focused series needs it.

## Q14: RAG Abort Propagation Timing

Status: ANSWERED - see D31 (`decisions.md`)
Source: Claude review of Stage 1 audit (S14)
Question:

Should `runMultiQueryRag` accept and propagate `AbortSignal` during Stage 2A, or should that be deferred to a later RAG extraction slice?

Decision:

Do not expand Stage 2A to full RAG abort propagation. Stage 2A should document `runMultiQueryRag` as a temporary delayed-abort segment, while preserving this contract: if the user aborts before table persistence, no assistant message or generated table should be inserted after cancellation.

Final resolution:

The later RAG extraction slice has now completed. `runMultiQueryRag` accepts an optional `abortSignal`, table and Q&A callers pass the active signal, and the RAG module checks abort state before/after embedding, after RPC completion, and around reranker work. `runPaperScopedRecoverySearch` moved with the RAG module and shares the same abort-aware path.

## Q15: Paper CRUD Split Scope And Supplementary/Import Collision Status

Status: ANSWERED - see D28 (`decisions.md`)
Source: Claude Stage 4 folders split review; D26

Before starting the Paper CRUD split, what exact scope does the user approve, and what is the current supplementary/import workflow status?

Required confirmation:

1. Supplementary/import status:
   - A: supplementary/import work is stable enough to proceed;
   - B: supplementary/import work is actively in progress, so paper CRUD should pause;
   - C: supplementary/import work is intentionally paused, so paper CRUD may proceed.

2. Paper CRUD extraction scope:
   - include paper row reads and paper list raw fetches;
   - include single-paper lookup support needed by `getPaperById`;
   - include low-level paper insert/update helpers only if they do not move import workflow orchestration;
   - exclude `createImportedPaper`, `attachSupplementaryPdfToPaper`, and `deletePaper` workflows from the first Paper CRUD slice unless the user explicitly approves moving them.

Default recommendation:

Proceed only with the low-level paper row helper split while keeping `createImportedPaper`, `attachSupplementaryPdfToPaper`, and `deletePaper` in the facade for now. This preserves current supplementary/import behavior and follows the facade workflow pattern accepted in D27.

Decision:

Use A + default. Treat supplementary/import as stable enough for the narrow Paper CRUD helper split. Extract low-level paper row helpers only, and keep `createImportedPaper`, `attachSupplementaryPdfToPaper`, and `deletePaper` as facade workflows.

## Q16: RAG Infrastructure Extraction Scope And Q14 Closure

Status: ANSWERED - default accepted and implemented; see D31 (`decisions.md`)
Source: Claude Stage 4 closure framing; D26 confirmation pattern; Q14 deferred RAG abort propagation

Before starting the RAG infrastructure extraction slice, confirm the exact scope.

1. Target module location:
   - A: `chat/multi-query-rag.mjs`, under the existing chat domain.
   - B: `rag/multi-query-rag.mjs`, as a separate RAG subsystem.

   Default: B. RAG is a subsystem shared by Q&A, table generation, and recovery search, so it should not stay under the chat table-pipeline boundary.

2. Slice scope:
   - A: mechanical `runMultiQueryRag` extraction only.
   - B: mechanical extraction plus abort propagation, closing Q14.
   - C: extraction plus reranker subroutine movement.

   Default: B. RAG already has a documented delayed-abort gap, and module extraction is the natural point to add explicit `AbortSignal` propagation plus at least one abort regression.

3. `runPaperScopedRecoverySearch` handling:
   - A: move it in the same slice.
   - B: keep it in `main.mjs` and defer.

   Default: A. It is a small wrapper around `runMultiQueryRag`, is used by Stage 3d recovery, and should benefit from the same abort behavior.

4. Reranker subroutines:
   - A: include reranker subroutine movement now.
   - B: exclude reranker subroutine movement.

   Default: B. `reranker-worker.mjs` already exists, and moving reranker subroutines in the first RAG slice would increase scope.

5. Supplementary/import collision status:
   - A: stable enough to proceed.
   - B: actively in progress, so pause runtime edits.
   - C: intentionally paused, so safe to proceed.

   Default: A. This RAG infrastructure slice should touch Electron RAG logic only, not frontend import/supplementary workflows.

Default recommendation:

Use `rag/multi-query-rag.mjs`, include abort propagation to close Q14, move `runPaperScopedRecoverySearch` in the same slice, exclude reranker subroutine movement, and treat supplementary/import as stable enough for this specific RAG slice.

Expected D9:

- `main.mjs`: roughly 2507 lines to 2200-2300 lines.
- `rag/multi-query-rag.mjs`: roughly 250-350 new lines.
- New desktop unit tests: 3-5 cases covering multi-query/RRF behavior and abort propagation.
- Q14 becomes ready for D31 promotion after runtime verification.

Decision:

Use the default recommendation. The implemented slice created `apps/desktop/electron/rag/multi-query-rag.mjs`, moved `runMultiQueryRag` and `runPaperScopedRecoverySearch`, added abort propagation to the RAG path, left reranker worker internals in place, and did not touch frontend import/supplementary workflows.

Measured result:

- `apps/desktop/electron/main.mjs`: 2645 lines after extraction.
- `apps/desktop/electron/rag/multi-query-rag.mjs`: 233 lines.
- `apps/desktop/tests/multi-query-rag.test.mjs`: 141 lines.
- Desktop Node tests now cover 7 suites / 43 tests.
