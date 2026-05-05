# Research OS Goal Plan

Date: 2026-05-05
Branch: `feature/pipeline-v2-only`
Status: G1 verified; G2 code implemented and static/agent verified; runtime attach walkthrough pending
Mode: `/goal` equivalent, maintained as project documentation

## Goal

Make Redou reliable as a Research OS before broad feature expansion.

The near-term product direction is not to add many screens at once. The near-term goal is to ensure that Redou's generated research artifacts are trustworthy, traceable, and expandable to supplementary sources and user-defined research goals.

## Operating Principles

- Use small, verifiable slices.
- Prefer guards over broad prompt rewrites.
- Preserve current Redou Style unless a workflow is objectively confusing.
- Do not merge with `origin/main` until the current feature branch has stable table output and recorded validation.
- Do not reset local Supabase unless explicitly approved.
- Commit each checkpoint separately.

## Checkpoints

### G1 - Stop Wrong Table Artifacts

Problem:

- A scoped `Paper title` table request produced unrelated material-property columns during `single_call_fallback`.
- This can save misleading research artifacts even when Stage 3d metadata is correct.

Desired outcome:

- If generated fallback headers do not match `tableSpec.column_definitions`, Redou must not silently save the wrong table.

Minimal success criteria:

- Header mismatch is detected after fallback table generation.
- Mismatch is recorded in metadata or returned as a user-facing failure.
- The app does not present an unrelated table as if it satisfied the user's request.
- `node --check apps\desktop\electron\main.mjs` passes.
- `cmd /c npm run build` in `apps/desktop` passes.
- One scoped runtime check demonstrates the guard.

Primary files:

- `apps/desktop/electron/main.mjs`
- `docs/features/fix/10-stage-3d-runtime-verification.md`

Out of scope:

- Full table pipeline rewrite.
- Replacing the orchestrator.
- Changing the LLM model defaults.

### G2 - Supplementary PDF Attach

Problem:

- Source-scoped extraction prerequisites exist, but users cannot yet attach supplementary files through the UI.

Desired outcome:

- A paper can own a supplementary PDF as a distinct `paper_files` source.
- Extraction jobs run against that source without deleting main-paper extraction data.

Minimal success criteria:

- UI can attach one supplementary PDF to an existing paper from the paper detail PDF tab.
- `paper_files.file_kind = "supplementary_pdf"` and `is_primary = false`.
- `processing_jobs.job_type = "import_pdf"` stays unchanged.
- `processing_jobs.source_file_id` points at the supplementary file.
- Main paper sections/chunks remain intact after supplementary extraction.

Primary files:

- `frontend/src/features/paper/PaperDetailView.tsx`
- Optional small component: `frontend/src/features/paper/SupplementaryFilesPanel.tsx`
- `frontend/src/types/paper.ts`
- `frontend/src/lib/queries.ts`
- `frontend/src/lib/supabasePaperRepository.ts`
- `frontend/src/lib/desktop.ts`
- `apps/desktop/electron/main.mjs`
- `supabase/migrations/20260504010000_add_supplementary_source_tracking.sql`

Out of scope:

- DOCX/DOC conversion.
- Automatic supplementary discovery from publisher websites.
- New supplementary-specific job type.
- RAG supplementary citation labels.

### G3 - Supplementary Citation Label

Problem:

- Main papers and supplementary evidence need to be distinguishable in answers and generated tables.

Desired outcome:

- Paper citations remain `[N]`.
- Supplementary evidence gets a clear source label such as `[N] Supplementary`.

Minimal success criteria:

- RAG/source refs include source file role.
- Generated source refs can mark supplementary evidence.
- Body citations stay compact and readable.

Primary files:

- `apps/desktop/electron/main.mjs`
- `frontend/src/types/chat.ts`
- Chat/table rendering components, to be confirmed.

Out of scope:

- Citation style redesign.
- Bibliography export.

### G4 - Research Goal MVP

Problem:

- Redou has papers, chat, notes, figures, and search, but no durable user-facing object for "what I am trying to answer."

Desired outcome:

- A user can define a research goal and use it to scope papers, supplementary files, tables, notes, and chat results.

Minimal MVP:

- Goal title.
- Goal question.
- Goal status: `active`, `paused`, or `done`.
- Scope: all library, folder, or selected papers.
- Desired output type: Q&A answer, comparison table, review note, figure shortlist, or final conclusion.
- Completion criteria text.
- Links to generated chat, table, note, highlight, and figure artifacts.
- Open questions and unresolved source gaps.

Smallest implementation order:

1. Add `research_goals` and paper membership.
2. Add a `Goals` workspace in the left navigation.
3. Add paper membership controls from paper detail.
4. Add Search/Chat scope option: `All`, `Folder`, `Goal`.
5. Attach generated chat/table outputs to the active Goal.

Out of scope for MVP:

- Multi-user collaboration.
- Scheduling.
- Goal analytics.
- Complex kanban/project management.
- Auto-generated research plans.
- Goal-specific autonomous agents.

### G5 - Source Quality Panel

Problem:

- Users need to inspect why Redou generated a value.

Desired outcome:

- A compact panel shows source snippets, page/source-file role, figure/table origin, and confidence/evidence status.

Minimal success criteria:

- Table cell or source ref opens evidence context.
- Evidence distinguishes main paper vs supplementary.
- Panel uses existing Redou Style and avoids a new heavy layout.

Out of scope:

- Full provenance graph UI.
- New annotation engine.

## Current Priority

G2 is the active checkpoint. The minimal attach path is implemented in code and needs one Electron walkthrough before treating the slice as fully runtime-verified.

Reason:

- It unlocks user-provided supplementary PDFs without waiting for DOCX conversion.
- It reuses the existing `import_pdf` worker path with `source_file_id`, so the code surface stays small.
- It keeps the main PDF reader tied to the primary source state instead of a supplementary job's state.

G1 verification:

- PASS: `node --check apps\desktop\electron\main.mjs`.
- PASS: `node --check apps\desktop\electron\llm-orchestrator.mjs`.
- PASS: `cmd /c npm run build` in `apps/desktop`.
- PASS: scoped fallback runtime table `27203151-feee-421e-b310-3c0048a26a88` stored `headers = ["Paper Title"]` instead of unrelated material-property columns.
- PASS: `metadata.tableSpecAdherence.requestedHeaders = ["Paper Title"]`.
- PASS: `metadata.tableSpecAdherence.headerMatchesSpec = true`.
- PASS: `metadata.agenticRecovery.skippedReason = "single_call_fallback"` remains intact.
- PASS: `metadata.nullSummary = null` remains intact for fallback output.
- PASS: temporary `paper_folders` membership was removed after verification.
- PASS: user LLM preference was restored to `gemma4:31b`.

Known residual:

- The verified scoped fallback table had no rows. That is acceptable for G1 because incorrect columns were blocked, but a later table quality slice should improve fallback row production or return a clearer user-facing failure when no rows match the requested schema.

G2 verification:

- PASS: QA subagent found no blocking issues in the G2 patch.
- PASS: `cmd /c npm run build` in `frontend`.
- PASS: `cmd /c npm run build` in `apps/desktop`.
- PASS: `git diff --check`.
- PASS: Paper Detail now exposes a `Supplementary PDFs` sidebar section in the PDF tab.
- PASS: Attach flow limits the first slice to one selected PDF.
- PASS: Repository inserts `paper_files.file_kind = "supplementary_pdf"` and `is_primary = false`.
- PASS: Repository queues `processing_jobs.job_type = "import_pdf"` with `source_file_id`.
- PASS: Main paper processing status ignores supplementary source jobs when a primary `paper_files` source can be resolved.

G2 runtime pending:

- Attach one supplementary PDF in Electron.
- Confirm the new `paper_files` and `processing_jobs` rows in local Supabase.
- Confirm the main PDF reader remains open while the supplementary job is queued/running.
- Confirm supplementary extraction rows use the supplementary `source_file_id` and main source rows survive.

G2 residual:

- Existing section/figure/search views are still paper-wide, so supplementary evidence can appear mixed with main-paper evidence until G3 source labels land.

## Subagents

The goal is being refined with three subagents:

- Subagent A: table-spec adherence guard.
- Subagent B: supplementary attach next slice.
- Subagent C: Research Goal MVP and UI placement.

Their findings should be integrated before implementing G1.

### Subagent C - Goal MVP Findings

Status: received.

Summary:

- A Redou Goal should be a research-question container, not a generic task.
- It should bind papers, notes, highlights, chat conversations, generated tables, figures, unresolved questions, and source coverage.
- MVP should avoid new AI pipeline behavior and start with durable scope plus artifact storage.
- UI placement should be a `Goals` item in the left primary navigation, likely between Search and Chat.
- Goal detail should use a dense Redou workspace layout: goal list/sidebar, compact header, scoped papers, linked outputs, and open questions.
- RightInspector should not be expanded for Goal MVP because it is currently paper-inspector oriented.
- Later integration should let Goal summarize table NULL counts, Stage 3d recovery status, supplementary coverage, and evidence quality.

Accepted direction:

- G4 will start later as `Goal CRUD + paper membership`.
- The first implementation remains G1 because wrong generated artifacts would undermine every later Goal workflow.

### Subagent B - Supplementary Attach Findings

Status: received.

Summary:

- The safest next supplementary slice is one supplementary PDF attached from an existing paper detail screen.
- Reuse existing `file:select-dialog` and `file:import-pdf` behavior where possible.
- Reuse existing `processing_jobs.job_type = "import_pdf"` and rely on `processing_jobs.source_file_id`.
- Avoid a new DB migration unless existing `paper_files.file_kind` cannot represent `supplementary_pdf`.
- Do not touch Electron IPC unless a supplementary-specific file path policy becomes necessary.

Risks to guard:

- `fetchPaperSignals()` currently treats latest paper-level `import_pdf` job as paper readiness; supplementary jobs must not block the main PDF reader.
- Existing section/figure/table surfaces do not yet distinguish source files, so supplementary extraction can visually mix with main-paper evidence.
- Attach failure must clean up copied PDF files if DB insertion fails.
- Multi-select should be reduced to one file for the first slice or handled with explicit sequential partial-failure behavior.
- Source labels for RAG are a later checkpoint, so supplementary chunks may become searchable before they are visually labeled.

Accepted direction:

- G2 remains after G1.
- The first G2 implementation should be `Attach one supplementary PDF`, not DOCX conversion or citation labeling.

### Subagent A - Table-Spec Adherence Findings

Status: received.

Summary:

- `per_paper` is already safer because `mergeExtractionResults()` uses `tableSpec.column_definitions` as headers and builds rows to that length.
- The failure is isolated to `single_call_fallback`, where `generateTableFromSpec()` output is accepted and saved directly.
- `TABLE_OUTPUT_SCHEMA` only enforces `headers: string[]` and `rows: string[][]`; it does not enforce `headers === tableSpec.column_definitions`.
- `buildGeneratedTableRecord` does not exist; table rows are inserted directly into `chat_generated_tables`.
- `llm-orchestrator.mjs` should stay untouched for the first fix.

Accepted G1 implementation:

- Add a small fallback normalization helper in `apps/desktop/electron/main.mjs`.
- When `tableSpec.column_definitions.length > 0`, force fallback `tableJson.headers` to the requested column definitions.
- Re-map generated rows by normalized header names.
- Fill missing requested columns with `N/A`.
- Drop extra generated columns.
- Record requested/generated headers and row-width diagnostics in metadata.
- When `tableSpec.column_definitions` is empty, block arbitrary fallback output by storing empty headers/rows with `blockedUnspecifiedFallback: true`.

Rejected for first slice:

- Prompt-only fix.
- Full fallback rewrite.
- New clarify flow for empty `column_definitions`.

## Next Local Action

Wait for subagent reports, then convert G1 into a narrow implementation plan and patch only the owning code path.
