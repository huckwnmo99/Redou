# Architecture Debuggability Implementation Plan

Status: implementation plan
Date: 2026-05-07
Scope type: architecture/refactor fix
Depends on:

- `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`
- `docs/features/proposals/2026-05-07-architecture-v2-reinforcements.md`
- `docs/agents/codex-claude/decisions.md`

## Purpose

This is the concrete execution plan for turning the architecture/debuggability review into small implementation slices.

The v2 review and Codex-Claude decisions define the strategy. This document defines the work order, files, acceptance criteria, verification commands, and stop points.

## Current Answer

A concrete implementation plan did not fully exist before this document.

Existing docs were:

- diagnosis and strategy: `2026-05-07-architecture-debuggability-review-v2.md`
- reinforcement notes: `2026-05-07-architecture-v2-reinforcements.md`
- accepted principles: `docs/agents/codex-claude/decisions.md`

Those were not yet a per-slice implementation plan. This document is that missing layer.

## Global Rules

- Do not start runtime refactor before Stage -1 branch hygiene analysis.
- Do not run a real merge without explicit user approval.
- Do not mix backend Electron extraction and frontend PaperDetail extraction in the same PR.
- Keep each slice behavior-preserving unless the slice explicitly says otherwise.
- Update `AGENTS.md` after each completed slice.
- Use `docs/agents/codex-claude/` for cross-agent review notes.
- Promote only accepted decisions to `docs/agents/codex-claude/decisions.md`.
- For every refactor stage, record the measured D9 KPI baseline, hard gate, and soft target when the relevant numbers are available.
- For code-changing stages, verify the designated code-writing agent is available before edits. If unavailable, pause runtime code changes and notify the user per D10.

## Stage -1: Branch Hygiene Analysis

Goal:

Determine whether architecture refactor can safely proceed on the current branch, and document the conflict risk with `origin/main`.

Write scope:

- `docs/features/proposals/2026-05-07-branch-hygiene-analysis.md`
- `docs/agents/codex-claude/codex-to-claude.md`
- `AGENTS.md`

Read scope:

- `origin/main`
- `HEAD`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/llm-qa.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
- `frontend/src/features/settings/SettingsView.tsx`
- `frontend/src/lib/chatQueries.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/types/desktop.ts`
- `docs/harness/**`

Tasks:

1. Measure current state:
   - `main.mjs` line count
   - direct `ipcMain.handle` / `ipcMain.on` count
   - direct import count
   - merge-tree conflict file list against `origin/main`
2. Categorize conflict files:
   - Electron runtime
   - frontend contract/UI
   - docs/harness
   - migrations/new graph files
3. For each conflict group, record:
   - Redou-side changes to preserve
   - origin/main-side changes to preserve
   - likely manual resolution risk
4. Recommend one of:
   - proceed docs-only first
   - create integration branch
   - merge `origin/main` after user approval
   - defer architecture refactor until current feature branch is pushed/merged

Acceptance criteria:

- Conflict count is measured from current repo state, not copied from old docs.
- Real merge is not executed.
- User has a clear next decision point.

Verification:

```powershell
git merge-base HEAD origin/main
git merge-tree <base> HEAD origin/main
git status --short --branch
```

Stop point:

Ask user whether to do Stage 0 docs-only, run integration planning, or proceed to Stage 0.5 after branch decision.

## Stage 0: Domain Context And Decisions Docs

Goal:

Create the canonical domain language and architecture decision locations before code movement.

Write scope:

- `CONTEXT.md`
- `docs/harness/main/glossary.md`
- `docs/harness/decisions/0001-debuggable-module-split.md`
- `docs/harness/decisions/0002-module-ownership.md`
- `AGENTS.md`

Tasks:

1. Create `CONTEXT.md` as a thin index.
2. Create `docs/harness/main/glossary.md` with detailed definitions:
   - main PDF
   - supplementary PDF
   - source file
   - source_file_id
   - evidence location
   - generated table
   - Stage 3d
   - RAG context
   - processing job
   - paper reference
   - source evidence label
3. Create ADR 0001 for debuggable module split.
4. Create ADR 0002 for Module ownership, based on decision D8.
5. Link these files from `AGENTS.md`.
6. Escape hatch: if ADR 0001 or ADR 0002 grows beyond roughly two pages, split Stage 0 into:
   - Stage 0a: `CONTEXT.md` and `docs/harness/main/glossary.md`
   - Stage 0b: ADR 0001, ADR 0002, and `AGENTS.md` links

Acceptance criteria:

- `CONTEXT.md` does not duplicate full definitions.
- `docs/harness/main/glossary.md` is the canonical detail file.
- ADRs clearly state what belongs in `main.mjs` and what does not.
- Stage 0 remains one slice only while the docs stay reviewable; otherwise the 0a/0b escape hatch is used.

Verification:

```powershell
Select-String -Path CONTEXT.md -Pattern "glossary"
Select-String -Path docs\harness\main\glossary.md -Pattern "supplementary PDF"
git diff --check
```

Stop point:

Ask Claude through `docs/agents/codex-claude/codex-to-claude.md` to review terminology and ADR placement.

## Stage 0.5: Test Infrastructure Bootstrap

Goal:

Make one small automated test run before runtime refactor.

Write scope:

- test config file if needed
- one first test file
- `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`
- `AGENTS.md`

Candidate first tests:

Option A:

- `frontend/src/features/search/searchModel.test.ts`

Option B:

- `apps/desktop/electron/html-table-parser.test.mjs`

Preferred first choice:

- Start with `searchModel.test.ts` if existing frontend Vitest runs more easily.
- Use `html-table-parser.test.mjs` only if desktop ESM test setup is straightforward.

Tasks:

1. Inspect existing Vitest config.
2. Decide whether frontend or desktop gets the first test.
3. Add the smallest characterization test.
4. Document future strategies for:
   - Electron/preload contract tests
   - LLM/Ollama/VLLM mock
   - Supabase fixture
   - Abort test helper
5. Run the targeted test.

Acceptance criteria:

- At least one meaningful test runs locally.
- Test command is documented.
- Stage 2A is not allowed until LLM mock and Supabase fixture strategy are at least documented.

Verification:

```powershell
cmd /c npm run test -- --run <test-file>
```

or, for desktop if configured:

```powershell
cmd /c npm run test -- <desktop-test-file>
```

Stop point:

If test infra requires package changes or dependency install, ask user before broad setup.

## Stage 1: Chat/Table Pipeline State Audit

Goal:

Map `CHAT_SEND_MESSAGE` before moving code.

Write scope:

- `docs/harness/detail/electron/chat-table-pipeline-state.md`
- `docs/harness/decisions/0004-chat-pipeline-contract.md`
- `docs/agents/codex-claude/codex-to-claude.md`
- `AGENTS.md`

Read scope:

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/llm-chat.mjs`
- `apps/desktop/electron/llm-qa.mjs`
- `frontend/src/types/desktop.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`

Tasks:

1. Map the `CHAT_SEND_MESSAGE` flow:
   - auth/user scope
   - conversation create/load
   - history load
   - QA branch
   - table branch
   - orchestrator
   - RAG
   - table extraction
   - merge
   - Stage 3d
   - fallback
   - persistence
   - stream/status events
   - abort
2. Identify pipeline context object fields.
3. Identify Module-local state vs caller-owned state.
4. Define `emitStatus` contract.
5. Define minimum abort behavior before extraction.
6. Create a mutable state table with:
   - variable name
   - owner
   - lifecycle
   - cleanup rule
   - extraction target
7. Create an abort cleanup table for each async phase.
8. Create a regression scenario list with at least these cases:
   - `per_paper` normal table generation
   - `single_call_fallback`
   - clarification branch
   - no-data branch
   - NULL cells greater than or equal to 5%
   - NULL cells equal to 0
   - abort during orchestrator
   - abort during RAG
   - abort during Stage 3b
   - abort during Stage 3c
   - abort during Stage 3d
   - Ollama/VLLM unavailable
   - partial extraction failure

Acceptance criteria:

- A future implementation agent can extract `table-pipeline.mjs` without rediscovering the whole flow.
- Mutable state, abort cleanup, and regression scenario tables are present.
- Regression scenario list contains at least 10 concrete cases.
- No runtime code moved in this stage.

Verification:

```powershell
Select-String -Path apps\desktop\electron\main.mjs -Pattern "CHAT_SEND_MESSAGE|runMultiQueryRag|runAgenticNullRecovery|handleQaPipeline"
git diff --check
```

Stop point:

Claude review requested before Stage 2A.

## Stage 2A: Chat/Table Pipeline Extraction

Goal:

Move chat/table orchestration out of `main.mjs` without changing behavior.

Write scope:

- `apps/desktop/electron/chat/table-pipeline.mjs`
- `apps/desktop/electron/chat/qa-pipeline.mjs` if extracted together
- `apps/desktop/electron/chat/status-events.mjs`
- `apps/desktop/electron/main.mjs`
- targeted tests if available
- `AGENTS.md`

Tasks:

1. Verify the designated code-writing agent is available; pause this stage if unavailable.
2. Create `chat/` folder.
3. Extract status event helper first.
4. Extract QA pipeline only if low-conflict; otherwise leave QA in `main.mjs` for a later slice.
5. Extract table pipeline with a single `runTableConversationPipeline` entrypoint.
6. Pass dependencies explicitly:
   - `supabase`
   - `ownerId`
   - `scope`
   - `abortSignal`
   - `emitStatus`
   - LLM/RAG helper functions
7. Keep IPC channel and frontend event names unchanged.
8. Preserve fallback paths.
9. Record D9 KPI baseline and current value for `main.mjs` line count, chat/table orchestration location, and relevant direct helper references.

Acceptance criteria:

- `main.mjs` no longer contains the full table generation orchestration body.
- `CHAT_SEND_MESSAGE` handler becomes a coordinator.
- Existing chat behavior is intended to remain unchanged.
- At least one abort behavior is tested or documented per D12.
- D9 KPI baseline and current value are recorded. Exact hard-gate pass/fail is deferred until Q5 is closed.

Verification:

```powershell
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/chat/table-pipeline.mjs
Select-String -Path apps\desktop\electron\main.mjs -Pattern "runMultiQueryRag|runAgenticNullRecovery|extractColumnsFromPaper|generateTableFromSpec|persistEntities" | Measure-Object -Line
cmd /c npm run build
```

Runtime smoke if available:

- one Q&A message
- one table generation
- one abort while running

Stop point:

Do not continue to RAG extraction until this slice is stable.

## Stage 2B: PaperDetailView Mechanical Split

Goal:

Split `PaperDetailView.tsx` into leaf Modules without changing UI behavior.

Write scope:

- `frontend/src/features/paper/PaperDetailView.tsx`
- `frontend/src/features/paper/PaperOverviewTab.tsx`
- `frontend/src/features/paper/PaperPdfTab.tsx`
- `frontend/src/features/paper/PaperSupplementaryFilesPanel.tsx`
- `frontend/src/features/paper/PaperFiguresTab.tsx`
- `frontend/src/features/paper/PaperReferencesTab.tsx`
- `frontend/src/features/paper/PaperMetadataTab.tsx`
- shared local helper file only if necessary
- `AGENTS.md`

Tasks:

1. Verify the designated code-writing agent is available; pause this stage if unavailable.
2. Record D9 baseline for `PaperDetailView.tsx` line count and component responsibilities.
3. Extract presentational tabs first:
   - metadata
   - references
   - overview
4. Extract figure/table/equation tab next.
5. Extract PDF tab last because it owns the most state.
6. Keep `PaperDetailView` as coordinator.
7. Do not redesign layout or copy.

Acceptance criteria:

- Current tab behavior is preserved.
- Supplementary PDF attach remains visible and functional.
- Highlight/note creation behavior remains wired.
- No backend files touched in this stage.
- D9 baseline and current `PaperDetailView.tsx` line count are recorded.

Verification:

```powershell
cmd /c npm run build
git diff --check
```

Manual/UI smoke if available:

- overview tab
- PDF tab
- supplementary list/attach button
- figures/tables/equations
- references
- metadata

Stop point:

If props drilling becomes excessive, pause and create a small local context plan rather than improvising broad state refactor.

## Stage 3: Source Evidence And Stage 3d Helpers

Goal:

Extract pure or near-pure helpers from `main.mjs` for source evidence and Stage 3d recovery.

Write scope:

- `apps/desktop/electron/chat/source-evidence.mjs`
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`
- `apps/desktop/electron/main.mjs`
- tests where possible
- `AGENTS.md`

Tasks:

1. Verify the designated code-writing agent is available; pause this stage if unavailable.
2. Extract source evidence formatting first, then update all callers, including `main.mjs` and `chat/table-pipeline.mjs` if Stage 2A already created it, to import from `chat/source-evidence.mjs`.
3. Add tests for:
   - main PDF label
   - supplementary label
   - null source_file_id fallback
4. Extract Stage 3d recovery helpers.
5. Add tests or documented cases for:
   - high-confidence recovery applies
   - medium/low confidence ignored
   - abort behavior or non-abortable reason
6. Record D9 baseline/current value for source evidence and Stage 3d helper locations.

Helper split policy:

- Prefer domain-specific helper modules over one broad `chat/extraction-helpers.mjs`.
- Source evidence lives in `chat/source-evidence.mjs`.
- Stage 3d recovery helpers should live in `chat/agentic-null-recovery.mjs`.
- Stage 3b/3c table extraction helpers can later live in `chat/table-extraction.mjs` or a similarly focused module.
- Do not create a catch-all helper module unless the extracted functions do not share a clearer domain owner.

Acceptance criteria:

- Table/Q&A source labeling behavior is unchanged.
- Stage 3d metadata behavior is unchanged.
- Extracted async helper defines abort behavior per D12.
- No duplicate source evidence formatter remains in `main.mjs` or `chat/table-pipeline.mjs`.
- D9 baseline/current values are recorded.

Verification:

```powershell
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/chat/source-evidence.mjs
node --check apps/desktop/electron/chat/agentic-null-recovery.mjs
Select-String -Path apps\desktop\electron\main.mjs -Pattern "runMultiQueryRag|runAgenticNullRecovery|extractColumnsFromPaper|generateTableFromSpec|persistEntities" | Measure-Object -Line
cmd /c npm run build
```

Stop point:

Do not change LLM prompts in this stage.

## Stage 4: Frontend Repository Implementation Split

Goal:

Split `supabasePaperRepository.ts` Implementation while keeping the facade stable.

Write scope:

- `frontend/src/lib/supabasePaperRepository.ts`
- `frontend/src/lib/paperRepository/papers.ts`
- `frontend/src/lib/paperRepository/source-files.ts`
- `frontend/src/lib/paperRepository/extraction.ts`
- `frontend/src/lib/paperRepository/highlights.ts`
- `frontend/src/lib/paperRepository/notes.ts`
- `frontend/src/lib/paperRepository/folders.ts`
- `frontend/src/lib/paperRepository/mappers.ts`
- `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`
- `AGENTS.md`

Tasks:

1. Verify the designated code-writing agent is available; pause this stage if unavailable.
2. Measure facade call sites.
3. Decide facade sunset policy with user if needed.
4. Extract mappers first.
5. Extract `source-files.ts` second.
6. Extract one self-contained domain, likely highlights or notes.
7. Keep query hooks unchanged.
8. Record D9 baseline/current value for facade size and call-site count.

Acceptance criteria:

- Existing `supabasePaperRepository` export remains.
- No query key redesign.
- Import, paper list, paper detail, notes, highlights, supplementary list still load by contract.
- D9 baseline/current values are recorded.

Verification:

```powershell
cmd /c npm run build
git diff --check
```

Stop point:

Do not remove facade in this stage.

## Stage 5: Import/Processing Pipeline Extraction

Goal:

Move import/extraction/embedding job processing out of `main.mjs`.

Write scope:

- `apps/desktop/electron/pipeline/import-processing.mjs`
- `apps/desktop/electron/pipeline/embedding-processing.mjs`
- `apps/desktop/electron/pipeline/job-coordinator.mjs`
- `apps/desktop/electron/main.mjs`
- `AGENTS.md`

Tasks:

1. Verify the designated code-writing agent is available; pause this stage if unavailable.
2. Document current job ordering.
3. Extract job status update helper.
4. Extract import PDF job processor.
5. Extract embedding job processor.
6. Extract coordinator only after import/embedding processors are stable.
7. Preserve source-file-scoped extraction behavior.
8. Record D9 baseline/current value for `main.mjs` processing-loop responsibilities.

Acceptance criteria:

- Main PDF import still creates primary `paper_files`, sections, chunks, figures.
- Supplementary PDF import still creates non-primary `paper_files` and source-scoped extraction.
- Embedding queue still follows extraction.
- `main.mjs` only starts/coordinates processing loop.
- D8 scope check confirms processing domain logic is no longer reintroduced into `main.mjs`.
- D9 baseline/current values are recorded.

Verification:

```powershell
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/pipeline/import-processing.mjs
node --check apps/desktop/electron/pipeline/embedding-processing.mjs
Select-String -Path apps\desktop\electron\main.mjs -Pattern "processImportPdfJob|processEmbeddingJob|tryStartExtractionJob|tryStartEmbeddingJob" | Measure-Object -Line
cmd /c npm run build
```

Runtime smoke if available:

- import one main PDF
- attach one supplementary PDF
- confirm `source_file_id` rows
- confirm job state reaches expected final status

Stop point:

Do not add DOCX conversion in this stage.

## User Decisions

These come from `docs/agents/codex-claude/open-questions.md`.

Closed:

- Q5: Stage 2A KPI gates use measured closure numbers, not the early R1 proposal as written.
- Q6: runtime code changes pause if the designated code-writing agent is unavailable unless the user explicitly approves a fallback code-writing path.
- Q7: `supabasePaperRepository` facade sunset timing is decided after Stage 4 call-site measurement; Stage 4 does not remove the facade.
- Q8: every async extracted pipeline must define abort behavior and have at least one targeted regression or documented non-abortable reason; the full matrix expands incrementally.
- Q9: Stage 0 stayed one slice.
- Q10: Stage 3 helper extraction follows Stage 2A and must update existing `chat/table-pipeline.mjs` callers.
- Q13: Stage 4 mocked frontend Vitest coverage closes the Supabase fixture stop-gap for this cycle; real Supabase fixtures are deferred until a DB-heavy, auth/RLS, workflow-integration, Stage 5, or reliability-focused series needs them.

Still open:

- None from the current Plan 12 closure set.

Current defaults:

- Stage 2A is closed with `main.mjs <= 3600`, `shellOnly = 0`, table orchestration in `chat/table-pipeline.mjs`, and desktop tests/build passing.
- Runtime code-changing stages continue only with the designated code-writing path available.
- Stage 3 helper extraction is complete from the current Plan 12 scope: source evidence, Stage 3d agentic NULL recovery helpers, shared extraction normalizers, table extraction helpers, and the `includePipelineContext` test escape hatch cleanup are done.
- Stage 4 is complete after seven frontend repository domain splits plus query hook migration measurement; the repository facade remains public until a later approved query-adapter migration.
- Q13 is closed by D30 for this cycle. Do not add real Supabase fixtures until a later trigger justifies a separate test-infrastructure slice.

## Stage 3 Progress

Completed source evidence slice:

- Added `apps/desktop/electron/chat/source-evidence.mjs`.
- Added source evidence tests for main PDF, supplementary PDF, and null `source_file_id` fallback.
- Updated `apps/desktop/electron/main.mjs` and `apps/desktop/electron/chat/table-pipeline.mjs` callers to import source evidence helpers directly.
- Removed temporary source-evidence DI from `runTableConversationPipeline`.
- Verified with `node --check`, desktop tests, desktop build, and `git diff --check`.

Completed agentic NULL recovery helper slice:

- Added `apps/desktop/electron/chat/agentic-null-recovery.mjs`.
- Moved Stage 3d gate, skip metadata, NULL grouping, recovery query construction, clone helpers, recovered-value application, and evidence append identifiers out of `main.mjs`.
- Kept `runPaperScopedRecoverySearch` in `main.mjs` by design because it depends on `runMultiQueryRag`; `chat/table-pipeline.mjs` still receives only that search function and `extractNullCellsFromPaperFn` as runtime dependencies.
- Added `apps/desktop/tests/agentic-null-recovery.test.mjs`.
- Removed temporary Stage 3d helper DI parameters from `runTableConversationPipeline`.
- Cleaned up the old Stage 3d test dependency helper so it now only supplies the two remaining runtime dependencies.
- Verified with `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review.

Completed extraction-utils cleanup slice:

- Added `apps/desktop/electron/chat/extraction-utils.mjs`.
- Moved `extractKeyTerms`, `sanitizeColumnNames`, and `normalizeColumnKey` into the shared utility module.
- Updated `main.mjs`, `chat/agentic-null-recovery.mjs`, and `chat/table-pipeline.mjs` to import the shared helpers.
- Removed `sanitizeColumnNamesFn` from the `runTableConversationPipeline` DI surface.
- Added `apps/desktop/tests/extraction-utils.test.mjs`.
- Removed the stale test-side `sanitizeColumnNamesFn` override so Stage 3b coverage exercises the shared sanitizer.
- Verified with `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review.

Completed table-extraction helper split:

- Added `apps/desktop/electron/chat/table-extraction.mjs`.
- Moved table context assembly, per-paper context assembly, Stage 3c merge, fallback normalization, and table cell cleanup out of `main.mjs`.
- Updated `chat/table-pipeline.mjs` to import the table extraction helpers directly.
- Updated `chat/agentic-null-recovery.mjs` so `assembleRecoveryContext` uses `assemblePerPaperContext` directly instead of receiving `assemblePerPaperContextFn`.
- Removed the remaining table-extraction helper DI parameters from `runTableConversationPipeline`:
  - `assemblePerPaperContextFn`;
  - `mergeExtractionResultsFn`;
  - `assembleRagContextFn`;
  - `normalizeFallbackTableToSpecFn`;
  - `cleanCellValueFn`.
- Added `apps/desktop/tests/table-extraction.test.mjs`.
- Updated table-pipeline fixtures to exercise the real helper behavior instead of injecting fake Stage 3b/3c helper results.
- Resolved the validation-agent P3 by adding direct characterization coverage for `assembleRagContext` and `assemblePerPaperContext`.
- Verified with `node --check`, desktop tests, desktop build, and `git diff --check`.

Completed includePipelineContext cleanup:

- Removed the production/test-only `includePipelineContext` option from `runTableConversationPipeline`.
- Kept the pipeline public return shape minimal: `{ conversationId, messageId, hasTable, tableId }`.
- Updated `apps/desktop/tests/table-pipeline.test.mjs` to assert observable behavior through public results, emitted completion payloads, persisted fake Supabase rows, and injected runtime callback inputs.
- Preserved coverage for clarify guardrail fallback, RAG/source evidence metadata, Stage 3a OCR table parsing, Stage 3b per-paper extraction, Stage 3c fallback diagnostics, Stage 3d recovery/fail-soft/abort, and Guardian scheduling without returning private pipeline context.
- Verified `Select-String` finds no remaining `includePipelineContext` usage in Electron chat modules or desktop tests.
- Verified with `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review.

Current D9 measurements:

| Metric | After source-evidence slice | After agentic recovery helper slice | After extraction-utils cleanup | After table-extraction split | After includePipelineContext cleanup | Notes |
|--------|-----------------------------|-------------------------------------|--------------------------------|------------------------------|--------------------------------------|-------|
| `main.mjs` line count | 3480 | 3295 | 3221 | 2507 | 2507 | Table extraction helpers removed from `main.mjs`; RAG and QA branch still remain. |
| `table-pipeline.mjs` line count | 1332 | 1268 | 1262 | 1115 | 1086 | Test-only return branch removed. |
| `source-evidence.mjs` line count | 88 | 88 | 88 | 88 | 88 | Unchanged. |
| `agentic-null-recovery.mjs` line count | 0 | 242 | 178 | 154 | 154 | Unchanged after cleanup. |
| `extraction-utils.mjs` line count | 0 | 0 | 66 | 66 | 66 | Unchanged. |
| `table-extraction.mjs` line count | 0 | 0 | 0 | 279 | 279 | Unchanged. |
| `table-pipeline.test.mjs` line count | n/a | n/a | n/a | 1159 | 1158 | Tests now observe persisted rows/callback inputs instead of private pipeline context. |
| Desktop test count | 3 suites / 24 tests | 4 suites / 30 tests | 5 suites / 33 tests | 6 suites / 38 tests | 6 suites / 38 tests | Count unchanged; assertions are less coupled to private return shape. |

## Stage 4 Progress

Completed mapper split slice:

- Added `frontend/src/lib/paperRepository/mappers.ts`.
- Moved repository row types, note-kind mapping, title/slug helpers, selection-anchor normalization, and row-to-app-model mappers out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept the exported `supabasePaperRepository` facade unchanged.
- Added `frontend/src/lib/paperRepository/mappers.test.ts` for observable mapper behavior.
- Added ADR 0005 to record the facade sunset policy and Q13 fixture stop-gap.

Completed mapper characterization and highlight split slice:

- Added thin characterization tests for `rowToHighlight`, `rowToFigure`, `rowToChunk`, `rowToSection`, `rowToHighlightPreset`, `normalizeTitle`, and `toSlug`.
- Added `frontend/src/lib/paperRepository/highlights.ts`.
- Moved highlight preset CRUD, highlight CRUD, existing-highlight lookup, and selection-highlight creation out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept the exported `supabasePaperRepository` facade and query hooks unchanged.
- Kept note creation wired by importing `getOrCreateSelectionHighlight` and `getHighlightById` from the focused highlight module.

Completed notes split slice:

- Added `frontend/src/lib/paperRepository/notes.ts`.
- Added `frontend/src/lib/paperRepository/notes.test.ts`.
- Moved note select shape, note reads, note creation, and note updates out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept note creation's highlight dependency one-way: `notes.ts` imports `getOrCreateSelectionHighlight` and `getHighlightById` from `highlights.ts`.
- Kept the exported `supabasePaperRepository` facade and query hooks unchanged.

Completed source-file/import helper split slice:

- Added `frontend/src/lib/paperRepository/source-files.ts`.
- Added `frontend/src/lib/paperRepository/source-files.test.ts`.
- Moved primary PDF file lookup, supplementary file listing, `paper_files` creation, import job creation, and supplementary cleanup row deletes out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept `createImportedPaper` and `attachSupplementaryPdfToPaper` as facade-level workflows so paper creation, folder assignment, cleanup semantics, and public query hooks remain unchanged.
- Left `fetchPaperSignals` and `deletePaper` file-path queries in the facade for now because they are paper-list signal and disk-cleanup concerns rather than source-file CRUD ownership.

Completed paper-list/signals split slice:

- Added `frontend/src/lib/paperRepository/paperSignals.ts`.
- Added `frontend/src/lib/paperRepository/paperSignals.test.ts`.
- Moved paper-list note counts, figure counts, primary-source file filtering, and latest import job processing status aggregation out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept `deletePaper` file-path lookup in the facade because it belongs to disk-cleanup workflow, not paper-list signals.
- Adopted the review-process guardrail for future larger supplementary/import/paper CRUD collision slices: confirm the user's intended option and supplementary status before proceeding.

Completed folders split slice:

- Added `frontend/src/lib/paperRepository/folders.ts`.
- Added `frontend/src/lib/paperRepository/folders.test.ts`.
- Moved folder list aggregation, folder creation, direct folder paper-id lookup, paper-folder attachment, and folder reassignment helpers out of `frontend/src/lib/supabasePaperRepository.ts`.
- Kept `supabasePaperRepository` as the public facade and kept query hooks unchanged.
- Kept `movePaperToFolder` as a facade-level workflow because it delegates assignment to `folders.ts` and then reloads the full `Paper` through the existing facade `getPaperById` path.
- Kept `createImportedPaper` as a facade-level workflow while delegating its folder attachment helper.
- Did not touch paper CRUD, import workflows, supplementary workflows, Electron, or DB schema.
- Preserved the explicit-confirmation guardrail before any paper CRUD slice because that area may collide with future supplementary/import behavior.

Completed first Paper CRUD helper split slice:

- Q15 was answered as `A + default`: supplementary/import is stable enough for the narrow split, and import/supplementary/delete workflows stay in the facade.
- Added `frontend/src/lib/paperRepository/papers.ts`.
- Added `frontend/src/lib/paperRepository/papers.test.ts`.
- Moved low-level paper row reads and paper-list raw fetches out of `frontend/src/lib/supabasePaperRepository.ts`.
- Moved the low-level imported-paper row insert into `createPaperRecord`.
- Moved the `toggle_paper_star` RPC wrapper into `togglePaperStarRecord`.
- Kept `createImportedPaper`, `attachSupplementaryPdfToPaper`, and `deletePaper` as facade-level workflows.
- Left the remaining direct `from("papers")` calls in the facade intentionally for import rollback cleanup and delete-paper hard delete sequencing.
- Did not touch supplementary workflows, import workflow orchestration, Electron, DB schema, or query hooks.

Completed query hook migration measurement slice:

- Measured production facade usage after the Stage 4 domain splits.
- Confirmed `frontend/src/lib/queries.ts` is still the only production import of `supabasePaperRepository`.
- Confirmed production code has 0 direct focused-module imports outside the facade.
- Counted 38 `paperRepository.*` call occurrences in `queries.ts`, covering 37 unique facade methods.
- Grouped query hooks by migration posture:
  - read-only direct candidates: primary/supplementary file reads, note reads, highlight-by-paper, folder reads;
  - adapter-needed candidates: paper app-model reads, star toggle, user-scoped mutations;
  - workflow-retained paths: import, supplementary attach, delete, move-paper-to-folder;
  - not-yet-split paths: extraction/search/reference helpers.
- Updated ADR 0005 with the measured facade sunset posture.
- Added D29 to record that facade sunset requires a query adapter step before any broad removal.
- Claude reviewed the measurement with no blockers and recommended Stage 4 closure.
- Added D30 to close Q13 with the mocked-unit-test stop-gap for this Stage 4 cycle.
- Marked Stage 4 complete: keep the facade, pause broad query-hook migration, and move the next large architecture priority to RAG infrastructure extraction.
- Left runtime code unchanged in this measurement slice.

Current D9 measurements:

| Metric | Before Stage 4 | After mapper split | After highlight split | After notes split | After source-file split | After paper-signals split | After folders split | After Paper CRUD helper split | Notes |
|--------|----------------|--------------------|-----------------------|-------------------|-------------------------|---------------------------|---------------------|-------------------------------|-------|
| `supabasePaperRepository.ts` line count | 1421 | 1260 | 1071 | 971 | 865 | 818 | 736 | 673 | Mapper rows, highlight CRUD, note CRUD, source-file/job helpers, paper-list signals, folder helpers, and low-level paper row helpers moved behind the facade. |
| External facade import count | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | Only `frontend/src/lib/queries.ts` imports the facade outside the repository file. |
| `mappers.ts` line count | 0 | 439 | 439 | 439 | 439 | 439 | 439 | 439 | Pure mapper/row-type module. |
| `highlights.ts` line count | 0 | 0 | 277 | 277 | 277 | 277 | 277 | 277 | Highlight/preset persistence module. |
| `notes.ts` line count | 0 | 0 | 0 | 153 | 153 | 153 | 153 | 153 | Notes persistence module. |
| `source-files.ts` line count | 0 | 0 | 0 | 0 | 153 | 153 | 153 | 153 | Source-file and import-job persistence helper module. |
| `paperSignals.ts` line count | 0 | 0 | 0 | 0 | 0 | 59 | 59 | 59 | Paper-list count and processing status aggregation module. |
| `folders.ts` line count | 0 | 0 | 0 | 0 | 0 | 0 | 119 | 119 | Folder persistence and paper-folder assignment helper module. |
| `papers.ts` line count | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 92 | Low-level paper row read/create/star helper module. |
| `paperSignals.test.ts` line count | 0 | 0 | 0 | 0 | 0 | 128 | 128 | 128 | Mocked Supabase tests for note/figure counts, primary-source job filtering, and fallback status behavior. |
| `folders.test.ts` line count | 0 | 0 | 0 | 0 | 0 | 0 | 180 | 180 | Mocked Supabase tests for folder aggregation, slugged creation, direct paper scope lookup, and reassignment ordering. |
| `papers.test.ts` line count | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 175 | Mocked Supabase tests for paper row filters/search, imported-paper row creation, missing id errors, and star RPC delegation. |
| Frontend Vitest count | 1 suite / 1 test | 2 suites / 4 tests | 2 suites / 8 tests | 3 suites / 11 tests | 4 suites / 15 tests | 5 suites / 18 tests | 6 suites / 22 tests | 7 suites / 26 tests | Added mapper, notes, source-file, paper-signals, folders, and papers tests while keeping the existing search model test passing. |

Verification:

- RED: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts` failed after adding the test because `./mappers` did not exist.
- GREEN: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts` passed with approved escalation: 1 suite / 3 tests.
- `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passed with approved escalation: 2 suites / 4 tests.
- `cmd /c npm run build` in `frontend` passed with approved escalation; existing large chunk warnings remain.
- `git diff --check` passed with LF-to-CRLF warnings only.
- Dedicated validation agent review found no P1/P2 blocker; its non-blocking recommendation is to add thin characterization coverage for the remaining mapper functions before or during the next Stage 4 slice.
- Mapper characterization follow-up: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts` passed with approved escalation: 1 suite / 7 tests.
- Highlight split: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passed with approved escalation: 2 suites / 8 tests.
- Highlight split: `cmd /c npm run build` in `frontend` passed with approved escalation; existing large chunk warnings remain.
- Highlight split: `git diff --check` passed with LF-to-CRLF warnings only.
- Notes split: `cmd /c npm run test -- --run src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passed with approved escalation: 3 suites / 11 tests.
- Notes split: `cmd /c npm run build` in `frontend` passed with approved escalation; existing large chunk warnings remain.
- Notes split: `git diff --check` passed with LF-to-CRLF warnings only.
- Notes split: `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `noteSelect`, `rowToNote`, `KIND_TO_DB`, `NoteRow`, or note creation/update bodies; only the existing note-count query remains inside `fetchPaperSignals`.
- Source-file split: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`: 4 suites / 15 tests.
- Source-file split: `cmd /c npm run build` in `frontend` passed; existing large chunk warnings remain.
- Source-file split: `git diff --check` passed with LF-to-CRLF warnings only.
- Source-file split: `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `insertPaperFile`, `createImportJob`, `rowToSupplementaryFile`, `PrimaryFileRow`, or `SupplementaryFileRow`; direct `paper_files` / `processing_jobs` access remains only for paper-list signals and delete-paper disk cleanup.
- Paper-signals split: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`: 5 suites / 18 tests.
- Paper-signals split: `cmd /c npm run build` in `frontend` passed; existing large chunk warnings remain.
- Paper-signals split: `git diff --check` passed with LF-to-CRLF warnings only.
- Paper-signals split: `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `ProcessingJobRow`, `ProcessingSignal`, or direct `processing_jobs` access; only `deletePaper` still reads `paper_files` for disk cleanup.
- Folders split: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/folders.test.ts src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`: 6 suites / 22 tests.
- Folders split: `cmd /c npm run build` in `frontend` passed; existing large chunk warnings remain.
- Folders split: `git diff --check` passed with LF-to-CRLF warnings only.
- Folders split: `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns direct `from("folders")`, `from("paper_folders")`, or `toSlug` usage; folder workflows now call the focused `folders.ts` helpers while `movePaperToFolder` still reloads a full `Paper` through the facade.
- Paper CRUD helper split: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/papers.test.ts src/lib/paperRepository/folders.test.ts src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`: 7 suites / 26 tests.
- Paper CRUD helper split: `cmd /c npm run build` in `frontend` passed; existing large chunk warnings remain.
- Paper CRUD helper split: `git diff --check` passed with LF-to-CRLF warnings only.
- Paper CRUD helper split: `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `fetchPapersRaw`, `normalizeTitle`, `PaperRow`, or the `toggle_paper_star` RPC wrapper; remaining direct `from("papers")` calls are intentionally limited to import rollback cleanup and delete-paper hard delete sequencing.
- Query hook migration measurement: `Select-String` confirms the only production facade import outside the repository file is `frontend/src/lib/queries.ts`.
- Query hook migration measurement: `Select-String` counts 38 `paperRepository.*` occurrences in `queries.ts`, covering 37 unique facade methods.
- Query hook migration measurement: `Select-String` confirms production focused-module imports outside the facade remain 0.
- Query hook migration measurement: docs-only `git diff --check` passed with LF-to-CRLF warnings only.
- Stage 4 closure docs: `git diff --check -- AGENTS.md` passed with LF-to-CRLF warnings only, and `Select-String` found no trailing whitespace in the closure docs.

Next likely architecture slice:

- Stage 4 is closed. Do not keep extending it unless the user explicitly asks for a small read-only query-adapter tracer.
- D29 records the query hook migration measurement: do not remove the facade immediately; use a small read-only query-adapter tracer if the user approves code changes.
- D30 records the Q13 closure: mocked frontend repository coverage is enough for this cycle; real Supabase fixtures are deferred until a later trigger.
- Claude's recommended next large architecture priority is RAG infrastructure extraction.
- Q16 is opened for RAG scope confirmation: default is `rag/multi-query-rag.mjs`, include abort propagation/Q14 closure, move `runPaperScopedRecoverySearch` in the same slice, exclude reranker subroutine movement, and treat supplementary/import as stable for this RAG-only slice.
- Broader import/supplementary/delete/app-model workflow extraction still requires explicit D26 confirmation.

## Previous First Concrete Next Step

Recommended immediate implementation slice:

Plan 12 Stage 3: Source Evidence And Stage 3d Helpers.

Reason:

- Stage 2A is closed.
- Q5/Q6/Q7/Q8/Q10 are closed.
- Stage 3 removes the temporary D19 helper dependency-injection pattern.
- Source evidence helper extraction is directly relevant to supplementary labeling and table/Q&A consistency.
- It should reduce `main.mjs` further while avoiding a broad runtime redesign.

First slice output:

- `apps/desktop/electron/chat/source-evidence.mjs`
- source evidence tests for main PDF, supplementary PDF, and null `source_file_id` fallback
- updated callers in `apps/desktop/electron/main.mjs` and `apps/desktop/electron/chat/table-pipeline.mjs`
- updated `docs/harness/detail/electron/chat-table-pipeline-state.md`
- updated `docs/agents/codex-claude/codex-to-claude.md`
- updated `AGENTS.md`

## Approval Request

Previous approval path:

Proceed to Plan 12 Stage 3 source evidence helper extraction first, then review before extracting Stage 3d helpers.
