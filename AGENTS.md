# Redou - Agent Shared Context

Read this file before starting work. Update it when you finish.

---

## 1. Project Overview

- Product: Windows desktop research workspace for reading, organizing, annotating, and recalling papers.
- Core idea: import PDFs, generate structured paper cards, notes, figures, and searchable research context.
- Current renderer baseline: `frontend`
- Current desktop shell: `apps/desktop`

### Skill Policy

- Use only project-local skills sourced from `mattpocock/skills` for normal Redou work.
- Do not use non-Matt Pocock skills such as Figma/image generation skills, plugin/system skills, or custom skills unless the user explicitly requests them by name or the task cannot be completed safely without them.
- User-approved exception: `karpathy-guidelines` may be used when Codex judges it helpful for planning, refactoring, code review, or larger runtime changes. Use it as a lightweight guardrail for surgical changes and verifiable success criteria; it does not replace the Matt Pocock default workflow.
- Keep non-Matt skills out of `.agents/skills`; preserve disabled ones under `.agents/skills.disabled`.
- User-approved exception: `lessons-to-skill` may live in `.agents/skills` and may be used when the user asks to capture mistakes, repeated failures, missing checks, or workflow lessons as reusable guardrails. It does not authorize runtime code changes by itself.
- Default workflow:
  - Planning: `plan`, `grill-me`, `grill-with-docs`, `zoom-out`
  - Implementation: `develop`, `fix`, `tdd`
  - Verification: `test`, `review`, `diagnose`
  - Issue/spec work: `to-prd`, `to-issues`, `triage`, `qa`
- For broad or ambiguous Redou work, follow `docs/agents/redou-spec-loop.md` as a workflow document. It is not an active skill and does not change the Matt Pocock-only skill policy.

### Codex-Claude File Exchange

- Use `docs/agents/codex-claude/` when Codex and Claude need to exchange review notes, implementation handoffs, unresolved questions, or architecture decisions.
- Codex writes to `docs/agents/codex-claude/codex-to-claude.md`.
- Claude writes to `docs/agents/codex-claude/claude-to-codex.md`.
- Keep unresolved questions in `docs/agents/codex-claude/open-questions.md`.
- Promote only accepted outcomes to `docs/agents/codex-claude/decisions.md`.
- Do not turn execution proposals into long inline debate logs. Use the exchange folder for discussion, then reflect confirmed decisions in the proposal.

---

## 2. Confirmed Stack

| Area | Choice |
|------|--------|
| Desktop shell | Electron |
| Frontend | React + TypeScript |
| Bundler | Vite |
| Styling | Tailwind CSS + CSS variables |
| UI primitives | Radix Primitives |
| UI state | Zustand |
| Server state | TanStack Query |
| Forms | React Hook Form + Zod |
| PDF viewer | PDF.js |
| Database | Local Supabase |
| Test | Vitest + Playwright |

---

## 3. Phase Status

| Phase | Scope | Status |
|------|-------|--------|
| 1 | App shell, library, paper detail, search, notes, figures, settings | In progress |
| 2 | Local Supabase auth and persisted data | In progress |
| 3 | PDF import, OCR, section/chunk/figure extraction | In progress |
| 4 | Highlight persistence and PDF anchors | In progress |
| 5 | Vector generation, summaries, advanced retrieval | In progress |

---

## 4. Current Verified Status

### Completed
- Local Supabase is configured and running on ports `55321-55329`.
- Initial schema migration exists at `supabase/migrations/20260309050635_initial_schema.sql`.
- `supabase/seed.sql` is intentionally empty now, so local resets start without a demo account or sample research data.
- `frontend` is now the main renderer baseline.
- `frontend` has a working app shell, library, paper detail, search, notes workspace, figures view, settings view, nested folders, and login gate.
- `frontend` auth uses a Supabase adapter, not the old mock auth repository.
- `frontend` auth screen is now simplified, localized at the entry layer, and includes a Google sign-in entry point alongside smaller email account toggles.
- Auth bootstrap now creates `app_users` rows and default highlight presets for real users on first session restore/sign-in, so the workspace can start clean without a seeded demo user.
- `frontend` now uses a dedicated Supabase auth storage key, purges legacy stored auth tokens, and clears stale local refresh tokens after DB resets instead of staying stuck in a broken session.
- `frontend` includes a desktop bridge for runtime detection, PDF file selection, backup creation, and Explorer reveal actions from the settings surface.
- `frontend` includes the first Phase 3 import slice: Add Paper opens an import dialog, copies PDFs into the desktop library, creates paper records, creates primary `paper_files` rows, and seeds queued `processing_jobs` entries.
- `frontend` surfaces processing job state across library cards, list rows, paper detail, and the right inspector so queued, running, failed, and ready papers stay visible after import.
- `frontend` listens to Electron job events, live-refreshes paper/folder state, and shows a transient processing status surface while background jobs run.
- `frontend` resolves a paper's primary PDF from `paper_files`, exposes system viewer / Explorer actions through the desktop bridge, and now renders the PDF tab through a PDF.js workspace with page navigation, zoom, a selectable text layer, persisted highlight overlays, preset-switching, note creation from saved highlights, deletion flows, and note-aware reader anchors.
- `frontend` now hides desktop-only PDF file actions in browser preview so the reader tab no longer offers Electron actions where the desktop bridge is unavailable.
- Claude review follow-up fixes are in: auth session fallback was removed, failed imports now clean up incomplete paper rows, reader mutations show user-facing errors, stale reader anchors auto-clear, PDF selection updates are throttled, and the desktop bridge / Electron IPC now validate paths and allowed DB tables.
- `pdfjs-dist` is installed in the `frontend` workspace and the PDF worker is bundled by Vite.
- `apps/desktop` dependencies are now installed locally, including a desktop-side `pdfjs-dist` copy used by the extraction helper.
- `apps/desktop` has Electron IPC, preload, database/file/window/backup handlers, and local Supabase access.
- `apps/desktop/electron/main.mjs` now prefers the `frontend` renderer URL in development, falls back to `frontend/dist` when that dev server is unavailable, and still uses packaged files when present.
- `apps/desktop/electron/main.mjs` now consumes queued `processing_jobs`, validates stored PDFs, runs a first-pass heuristic extraction for sections, chunks, and figures, refreshes the current system summary, and broadcasts progress events with extraction counts back to the renderer.
- `apps/desktop/electron` exposes a dedicated `file:open-path` channel for opening imported PDFs in the system viewer.
- `frontend` paper detail and the right inspector now read real extracted section outlines and figure captions from Supabase instead of relying on mock figure placeholders.
- `frontend` search and the global figures workspace now use real extracted chunk, note, and figure data from Supabase while respecting folder scope.
- `frontend` now supports a user-selectable Korean display mode from Settings, and the core shell surfaces switch between English and Korean while deeper product screens can continue to mix in English where translation is still pending.
- The Electron extraction helper now prefers a local `apps/desktop` `pdfjs-dist` dependency, falls back to `REDOU_DESKTOP_PDFJS_PATH` or `frontend/node_modules` when needed, and uses PDF.js page text so persisted sections, chunks, and figures can carry real page hints instead of `null` placeholders in the first-pass pipeline.
- Paper detail, the right inspector, search chunk results, and the global figures workspace now surface page-aware extraction hints whenever the worker can resolve them.
- Folder-scoped paper lists, folder counts, and search scopes now use direct folder membership instead of aggregating every descendant folder.
- Add Paper now inspects selected PDFs before import so cleaner titles and publication years can be inferred from the document itself before records are created.
- The latest locally imported paper was manually reprocessed on 2026-03-11 with the improved extraction heuristic so its stored title, year, sections, chunks, and figures now reflect the new pipeline.

- Phase 5 started: pgvector HNSW index and `match_chunks` semantic search function added. Embedding worker (`embedding-worker.mjs`) uses Transformers.js with `all-MiniLM-L6-v2` (384-dim, local). Electron processing pipeline auto-queues `generate_embeddings` jobs after extraction. Query embedding IPC channel enables the frontend to generate embeddings via the desktop bridge. Search view displays ranked semantic results with similarity scores when embeddings are available, with client-side fallback for browser mode.
- Fixed Electron preload script: converted from ESM `import` to CJS `require()` with inlined IPC channel constants so `window.redouDesktop` is properly exposed.
- Fixed Vite `base` config: added `base: "./"` so built assets use relative paths, enabling Electron `file://` loading.
- Fixed `formatAuthors()` crash in PaperCard, PaperListItem, RightInspector: added empty array guard.
- Presentation assets now include a standalone future-direction HTML slide that explains the planned ontology and Graph RAG expansion as a visual knowledge-graph workflow for lectures and demos.
- Stage 3d Agentic NULL Recovery is implemented for SRAG table generation: after Stage 3c merge, remaining NULL cells can trigger paper-scoped recovery search, skip LLM extraction when no new chunk/figure context is found, and only apply recovered values with `confidence === "high"`.
- Stage 0.5 test infrastructure bootstrap now has a first frontend Vitest characterization test for direct folder-scoped search membership and ADR 0003 documenting the next Electron/preload, LLM mock, Supabase fixture, and abort helper strategy.
- Stage 1 chat/table pipeline state audit is documented, including `CHAT_SEND_MESSAGE` flow, mutable state ownership, status/event contract, abort cleanup table, regression scenarios, and ADR 0004 chat pipeline contract before Stage 2A extraction.
- Pre-Stage 2A readiness reinforcements are applied: Stage 1 docs include Claude S12-S16, `ChatStatusEvent.stage` now permits `null`, and `apps/desktop` has a Node test dry-run with a first IPC channel contract placeholder test.
- Stage 2A first tracer bullet is implemented: chat status payload/event emission moved into `apps/desktop/electron/chat/status-events.mjs`, `main.mjs` now uses `emitStatus(...)` for QA/table `CHAT_STATUS` events, and desktop Node coverage verifies nullable `stage` payloads.
- Stage 2A abort guard tracer is implemented: `apps/desktop/electron/chat/abort-guards.mjs` provides a shared `AbortError` guard and `main.mjs` checks delayed-abort boundaries before QA/table final persistence starts.
- Stage 2A Tracer 3a is implemented: `apps/desktop/electron/chat/table-pipeline.mjs` defines the first `runTableConversationPipeline({...})` shell, desktop tests include a chat-flow abort regression, and Q12 is closed as D13 with frontend Vitest mocks plus desktop dependency injection.
- Stage 2A Tracer 3b-1 is implemented: `chat/table-pipeline.mjs` now owns table setup context loading, Stage 1 orchestrator invocation, clarify guardrail, and clarify persistence/streaming, while `main.mjs` continues Stage 2+ through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3b-2 is implemented: `chat/table-pipeline.mjs` now owns table Stage 2 RAG, no-data handling, Stage 2b paper metadata, table-figure backfill, paper refs, and initial evidence-location preparation, while `main.mjs` continues at Stage 3a through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3b-3-1 is implemented: `chat/table-pipeline.mjs` now owns Stage 3a OCR table parsing with code parser first and LLM fallback second, while `main.mjs` continues at Stage 3b through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3b-3-2 is implemented: `chat/table-pipeline.mjs` now owns Stage 3b per-paper extraction, including table-spec sanitization, per-paper context assembly through DI, per-paper timeout/abort composition, extraction result collection, and fallback-need detection, while `main.mjs` continues at Stage 3c through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3b-3-3 is implemented: `chat/table-pipeline.mjs` now owns Stage 3c merge/fallback, including code-only per-paper merge, all-fail single-call fallback, merged-empty fallback, fallback normalization diagnostics, and `single_call_fallback` recovery metadata, while `main.mjs` continues at Stage 3d through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3c-1 is implemented: `chat/table-pipeline.mjs` now owns Stage 3d Agentic NULL Recovery orchestration through helper dependency injection, including recovery gate behavior, fail-soft recovery, recovered evidence append/rebuild, and abort-before-continuation coverage, while `main.mjs` continues at post-processing/persistence through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3c-2 is implemented: `chat/table-pipeline.mjs` now owns final table persistence, `extractionMetadata` assembly, source-ref evidence enrichment, cell cleanup, conversation phase update, and `CHAT_COMPLETE` emission, while `main.mjs` continues only at Stage 4 Guardian through the temporary `shellOnly` continuation.
- Stage 2A Tracer 3c-3 is implemented: `chat/table-pipeline.mjs` now owns Stage 4 Guardian verification scheduling, verification updates, and `CHAT_VERIFICATION_DONE` emission; `main.mjs` now returns the table pipeline directly with no `shellOnly` continuation, and the default IPC return is trimmed to `{ conversationId, messageId, hasTable, tableId }`.
- Q5/Q6/Q7/Q8/Q10 architecture decisions are closed after Stage 2A: measured Stage 2A KPI gates are accepted, runtime code fallback requires explicit user approval, repository facade sunset waits for Stage 4 call-site measurement, abort coverage expands incrementally per async pipeline, and Stage 3 helper extraction follows Stage 2A.
- Plan 12 Stage 3 first source-evidence slice is implemented: `chat/source-evidence.mjs` now owns main-PDF/supplementary evidence labels, evidence location aggregation, source-ref enrichment, and evidence serialization; `main.mjs` and `chat/table-pipeline.mjs` import it directly, removing the temporary source-evidence DI parameters.
- Plan 12 Stage 3 table-extraction slice is implemented: `chat/table-extraction.mjs` now owns table context assembly, per-paper context assembly, Stage 3c merge, fallback normalization, and table cell cleanup; `chat/table-pipeline.mjs`, `chat/agentic-null-recovery.mjs`, and `main.mjs` import those helpers directly instead of passing the old helper DI parameters.
- Plan 12 Stage 3 includePipelineContext cleanup is implemented: `runTableConversationPipeline` no longer accepts the test-only internal context flag, its public return stays limited to `{ conversationId, messageId, hasTable, tableId }`, and table-pipeline tests now assert observable public results, emitted payloads, fake Supabase rows, and injected callback inputs.
- Plan 12 Stage 4 mapper split is implemented: `frontend/src/lib/paperRepository/mappers.ts` now owns repository row types, note-kind mapping, title/slug helpers, selection-anchor normalization, and row-to-app-model mappers while `supabasePaperRepository` remains the public facade.
- Plan 12 Stage 4 highlight split is implemented: `frontend/src/lib/paperRepository/highlights.ts` now owns highlight preset CRUD, highlight CRUD, highlight lookup, and selection-highlight creation while `supabasePaperRepository` remains the public facade and notes still call the extracted highlight helpers.
- Plan 12 Stage 4 notes split is implemented: `frontend/src/lib/paperRepository/notes.ts` now owns note reads, note creation, note updates, and the note select shape while `supabasePaperRepository` remains the public facade.
- Plan 12 Stage 4 source-file/import helper split is implemented: `frontend/src/lib/paperRepository/source-files.ts` now owns primary file lookup, supplementary file listing, `paper_files` creation, import job creation, and supplementary cleanup row deletes while `supabasePaperRepository` remains the public facade.
- Plan 12 Stage 4 paper-list/signals split is implemented: `frontend/src/lib/paperRepository/paperSignals.ts` now owns paper-list note counts, figure counts, primary-source filtering, and latest import job processing status aggregation while `supabasePaperRepository` remains the public facade.
- Plan 12 Stage 4 folders split is implemented: `frontend/src/lib/paperRepository/folders.ts` now owns folder list aggregation, folder creation, direct folder paper-id lookup, paper-folder attachment, and folder reassignment helpers while `supabasePaperRepository` remains the public facade.
- Claude accepted the Stage 4 folders split with no blocker, D26/D27 are recorded, and Q15 now gates the next Paper CRUD runtime slice on explicit supplementary/import status and scope confirmation.
- Plan 12 Stage 4 first Paper CRUD helper split is implemented: Q15 was answered as `A + default`, `frontend/src/lib/paperRepository/papers.ts` now owns low-level paper row reads, imported-paper row creation, and the paper-star RPC wrapper, while import/supplementary/delete workflows remain in the facade.
- Plan 12 Stage 4 query hook migration measurement is complete: `frontend/src/lib/queries.ts` remains the only production facade import, `queries.ts` has 38 `paperRepository.*` occurrences across 37 unique methods, production focused-module imports outside the facade remain 0, ADR 0005 is updated, and D29 records that facade sunset needs a small query-adapter step rather than immediate broad removal.
- Plan 12 Stage 4 is closed after Claude's measurement review: D30 closes Q13 with the mocked frontend Vitest stop-gap for this cycle, Stage 4 will not continue into broad facade/query-hook migration by default, and the next recommended large architecture slice is RAG infrastructure extraction.
- Q16 is opened for the next RAG infrastructure extraction scope: default recommendation is `rag/multi-query-rag.mjs`, include abort propagation to close Q14, move `runPaperScopedRecoverySearch` in the same slice, exclude reranker subroutine movement, and treat supplementary/import as stable for this RAG-only slice.
- RAG infrastructure extraction is implemented on `codex/rag-infra-extraction`: `apps/desktop/electron/rag/multi-query-rag.mjs` now owns RRF chunk/figure fusion, `runMultiQueryRag`, reranker call-boundary handling, abort checks, and `runPaperScopedRecoverySearch`; Q&A and table callers pass abort signals into RAG; Q14 is closed as D31.
- Claude reviewed the RAG infrastructure extraction with no blockers on 2026-05-18; the apparent `main.mjs` line-count discrepancy was resolved as mixed full-line vs non-empty-line measurement.
- Plan 12 scope was realigned on 2026-05-20: QA branch extraction, adapter work, and additional domain splits are outside Plan 12; the next slice is Stage 2B `PaperDetailView` mechanical split, starting with the responsibility map in `docs/harness/detail/frontend/paper-detail-view-responsibility-map.md`; Stage 5 import/processing requires fresh user confirmation after Stage 2B.
- Plan 12 Stage 2B first mechanical split is implemented: `frontend/src/features/paper/paperDetail/` now owns tab definitions, shared paper-detail styles, small paper-detail helpers, `PaperMetadataTab`, and `PaperReferencesTab`; `PaperDetailView.tsx` remains the coordinator and decreased from 1,980 to 1,707 full lines, or 1,573 non-empty lines.
- Plan 12 Stage 2B notes/overview split is implemented: `PaperOverviewTab` and `PaperNotesTab` now live under `frontend/src/features/paper/paperDetail/`; `PaperDetailView.tsx` still owns the coordinator, PDF tab, and extracted item tabs, and decreased to 1,459 full lines, or 1,337 non-empty lines.
- Plan 12 Stage 2B extracted-items split is implemented: `PaperExtractedItemsTab` now owns figures, tables, equations, crop helpers, OCR table HTML, PDF.js document loading, and KaTeX rendering; `PaperDetailView.tsx` still owns only the coordinator plus PDF tab/sidebar, and decreased to 894 full lines, or 834 non-empty lines.
- Claude reviewed the Stage 2B extracted-items split on 2026-05-22 with no blockers/P1/P2 and agreed the remaining order is PDF tab first, then sidebar micro-panels only if prop flow stays clear.
- Plan 12 Stage 2B PDF tab split is implemented: `PaperPdfTab` now owns PDF reader orchestration, highlight/note handlers, presets, source PDF controls, supplementary PDF attach, and the sidebar body; `PaperDetailView.tsx` now owns only the coordinator/header/tab routing and decreased to 166 full lines, or 155 non-empty lines.
- Claude reviewed the Stage 2B PDF tab split on 2026-05-22 with no blockers/P1/P2 and recommended closing Stage 2B / Plan 12 here; sidebar micro-panels stay inside `PaperPdfTab`, and the next recommended direction is the test-foundation pivot rather than Stage 5 or more broad refactoring.
- D35 records Plan 12 as closed after Stage 2B; Stage 5 is deferred unless the user explicitly chooses a reliability-focused implementation series, and entity graph integration remains a separate user-triggered feature plan.

### Verified 2026-05-22
- `frontend`: `cmd /c npm run build` passes after the Stage 2B notes/overview split; the existing large chunk warnings remain.
- `git diff --check` passes after the Stage 2B notes/overview split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Stage 2B D9 measurement: `PaperDetailView.tsx` is 1,459 full lines and 1,337 non-empty lines after extracting overview and notes tabs; `PaperOverviewTab.tsx` is 201 / 191 and `PaperNotesTab.tsx` is 68 / 62 full / non-empty lines.
- `frontend`: `cmd /c npm run build` passes after the Stage 2B extracted-items split; the existing large chunk warnings remain.
- `git diff --check` passes after the Stage 2B extracted-items split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Stage 2B D9 measurement: `PaperDetailView.tsx` is 894 full lines and 834 non-empty lines after extracting `PaperExtractedItemsTab`; `PaperExtractedItemsTab.tsx` is 577 / 513 full / non-empty lines.
- `frontend`: `cmd /c npm run build` passes after the Stage 2B PDF tab split; the existing large chunk warnings remain.
- `git diff --check` passes after the Stage 2B PDF tab split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Stage 2B D9 measurement: `PaperDetailView.tsx` is 166 full lines and 155 non-empty lines after extracting `PaperPdfTab`; `PaperPdfTab.tsx` is 722 / 671 full / non-empty lines.

### Verified 2026-05-20
- `frontend`: `cmd /c npm run build` passes after the Stage 2B first mechanical split; the existing large chunk warnings remain.
- `git diff --check` passes after the Stage 2B first mechanical split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Stage 2B D9 measurement correction: `PaperDetailView.tsx` is 1,707 full lines and 1,573 non-empty lines after extracting constants/styles/utils plus metadata/references tabs.
- `Select-String` confirms no `\uXXXX` Unicode escapes remain in `frontend/src/features/paper/paperDetail/*.ts*`; new Korean source strings are preserved as literals.

### Verified 2026-05-17
- `apps/desktop/electron/rag/multi-query-rag.mjs`: `node --check` passes after RAG infrastructure extraction.
- `apps/desktop/electron/main.mjs`: `node --check` passes after RAG infrastructure extraction.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after passing abort signals into RAG.
- `apps/desktop`: `cmd /c node --test tests\multi-query-rag.test.mjs` passes after the RED phase first failed on missing `electron/rag/multi-query-rag.mjs`; current RAG result is 1 suite, 5 tests.
- `apps/desktop`: `cmd /c npm run test` passes after RAG infrastructure extraction; current desktop result is 7 suites, 43 tests.
- `apps/desktop`: `cmd /c npm run build` passes after RAG infrastructure extraction.
- `git diff --check` passes after RAG infrastructure extraction with LF-to-CRLF warnings only on existing mixed-line-ending files.

### Verified 2026-05-15
- Stage 4 closure docs: `git diff --check -- AGENTS.md` passes with LF-to-CRLF warnings only, and `Select-String` finds no trailing whitespace in the closure docs.
- Query hook migration measurement: `Select-String` confirms `frontend/src/lib/queries.ts` is still the only production facade import outside `supabasePaperRepository.ts`.
- Query hook migration measurement: `Select-String` counts 38 `paperRepository.*` occurrences in `frontend/src/lib/queries.ts`, covering 37 unique facade methods.
- Query hook migration measurement: `Select-String` confirms production focused-module imports outside the facade remain 0.
- `git diff --check` passes after the query hook migration measurement with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `frontend`: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/papers.test.ts src/lib/paperRepository/folders.test.ts src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`; current frontend targeted result is 7 suites, 26 tests.
- `frontend`: `cmd /c npm run build` passes after the Paper CRUD helper split; the existing large chunk warnings remain.
- `git diff --check` passes after the Paper CRUD helper split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `fetchPapersRaw`, `normalizeTitle`, `PaperRow`, or the `toggle_paper_star` RPC wrapper; remaining direct `from("papers")` calls are intentionally limited to import rollback cleanup and delete-paper hard delete sequencing.
- `frontend`: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/folders.test.ts src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`; current frontend targeted result is 6 suites, 22 tests.
- `frontend`: `cmd /c npm run build` passes after the folders split; the existing large chunk warnings remain.
- `git diff --check` passes after the folders split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns direct `from("folders")`, `from("paper_folders")`, or `toSlug` usage; folder workflows now call `frontend/src/lib/paperRepository/folders.ts` while `movePaperToFolder` still reloads a full `Paper` through the facade.
- `frontend`: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/paperSignals.test.ts src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`; current frontend targeted result is 5 suites, 18 tests.
- `frontend`: `cmd /c npm run build` passes after the paper-list/signals split; the existing large chunk warnings remain.
- `git diff --check` passes after the paper-list/signals split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `ProcessingJobRow`, `ProcessingSignal`, or direct `processing_jobs` access; only `deletePaper` still reads `paper_files` for disk cleanup.
- `frontend`: default sandbox first hit Vite/esbuild `spawn EPERM`; rerun with approved escalation passed `cmd /c npm run test -- --run src/lib/paperRepository/source-files.test.ts src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts`; current frontend targeted result is 4 suites, 15 tests.
- `frontend`: `cmd /c npm run build` passes after the source-file/import helper split; the existing large chunk warnings remain.
- `git diff --check` passes after the source-file/import helper split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `insertPaperFile`, `createImportJob`, `rowToSupplementaryFile`, `PrimaryFileRow`, or `SupplementaryFileRow`; direct `paper_files` / `processing_jobs` access remains only for paper-list signals and delete-paper disk cleanup.

### Verified 2026-05-14
- `frontend`: `cmd /c npm run test -- --run src/lib/paperRepository/notes.test.ts src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passes with approved escalation after the notes split; current frontend targeted result is 3 suites, 11 tests.
- `frontend`: `cmd /c npm run build` passes after the notes split; the existing large chunk warnings remain.
- `git diff --check` passes after the notes split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer owns `noteSelect`, `rowToNote`, `KIND_TO_DB`, `NoteRow`, or note creation/update bodies; only the existing note-count query remains in `fetchPaperSignals`.
- `frontend`: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts` passes with approved escalation after mapper characterization coverage was expanded; current mapper result is 1 suite, 7 tests.
- `frontend`: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passes with approved escalation after the highlight split; current frontend targeted result is 2 suites, 8 tests.
- `frontend`: `cmd /c npm run build` passes after the highlight split; the existing large chunk warnings remain.
- `git diff --check` passes after the highlight split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` confirms `frontend/src/lib/supabasePaperRepository.ts` no longer directly queries `highlights` / `highlight_presets` and no longer owns highlight select strings or highlight mapper calls.

### Verified 2026-05-11
- `frontend`: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts` passes with approved escalation after the RED phase first failed on missing `./mappers`; current mapper result is 1 suite, 3 tests.
- `frontend`: `cmd /c npm run test -- --run src/lib/paperRepository/mappers.test.ts src/features/search/searchModel.test.ts` passes with approved escalation; current frontend targeted result is 2 suites, 4 tests.
- `frontend`: `cmd /c npm run build` passes after the Stage 4 mapper split; the existing large chunk warnings remain.
- `git diff --check` passes after the Stage 4 mapper split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for the Stage 4 mapper split; its non-blocking recommendation is thin characterization coverage for the remaining mapper helpers before or during the next repository split.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after removing `includePipelineContext`.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the `includePipelineContext` RED test phase; current result is 6 suites, 38 tests.
- `apps/desktop`: `cmd /c npm run build` passes after the `includePipelineContext` cleanup.
- `git diff --check` passes after the `includePipelineContext` cleanup with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `Select-String` finds no remaining `includePipelineContext` usage in Electron chat modules or desktop tests.
- Dedicated validation agent review found no blocker/P1/P2/P3 for the `includePipelineContext` cleanup and confirmed the pipeline API no longer exposes internal stage context.
- `apps/desktop/electron/chat/table-extraction.mjs`: `node --check` passes after the table-extraction helper split.
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`: `node --check` passes after importing `assemblePerPaperContext` directly.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after removing table-extraction helper DI.
- `apps/desktop/electron/main.mjs`: `node --check` passes after removing table-extraction helper implementations and importing `assembleRagContext`.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the table-extraction RED test first failed on missing `chat/table-extraction.mjs`; current result is 6 suites, 38 tests.
- `apps/desktop`: `cmd /c npm run build` passes after the table-extraction helper split.
- `git diff --check` passes after the table-extraction helper split with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `apps/desktop/electron/chat/extraction-utils.mjs`: `node --check` passes after extraction utility cleanup.
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`: `node --check` passes after importing shared extraction utilities.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after direct `sanitizeColumnNames` import and DI cleanup.
- `apps/desktop/electron/main.mjs`: `node --check` passes after importing `extractKeyTerms` and `normalizeColumnKey` from shared utilities.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the extraction-utils RED test first failed on missing `chat/extraction-utils.mjs`; current result is 5 suites, 33 tests.
- `apps/desktop`: `cmd /c npm run build` passes after extraction utility cleanup.
- `git diff --check` passes after extraction utility cleanup with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for extraction utility cleanup; its non-blocking test-fixture note was resolved by removing the ignored `sanitizeColumnNamesFn` override from `table-pipeline.test.mjs`.
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`: `node --check` passes after Stage 3d helper extraction.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after agentic recovery helper imports and DI cleanup.
- `apps/desktop/electron/main.mjs`: `node --check` passes after removing Stage 3d pure helpers while keeping `runPaperScopedRecoverySearch`.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the agentic recovery RED test first failed on missing `chat/agentic-null-recovery.mjs`; current result is 4 suites, 30 tests.
- `apps/desktop`: `cmd /c npm run build` passes after agentic recovery helper extraction.
- `git diff --check` passes after agentic recovery helper extraction with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for agentic recovery helper extraction; its non-blocking test-helper note was resolved by narrowing `createStage3dDeps` to only `runPaperScopedRecoverySearchFn` and `extractNullCellsFromPaperFn`.
- `apps/desktop/electron/chat/source-evidence.mjs`: `node --check` passes.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after source-evidence imports.
- `apps/desktop/electron/main.mjs`: `node --check` passes after source-evidence imports and helper removal.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the source-evidence RED test first failed on missing `chat/source-evidence.mjs`; current result is 3 suites, 24 tests.
- `apps/desktop`: `cmd /c npm run build` passes after source-evidence extraction.
- `git diff --check` passes after source-evidence extraction with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for source-evidence extraction and confirmed label fallback behavior, table-pipeline metadata/recovery preservation, Q&A path compatibility, and no circular import risk; its only non-blocking note was a now-removed unused `enrichSourceRefsWithEvidence` import in `main.mjs`.

### Verified 2026-05-09
- `apps/desktop/electron/chat/status-events.mjs`: `node --check` passes.
- `apps/desktop/electron/chat/abort-guards.mjs`: `node --check` passes.
- `apps/desktop/electron/main.mjs`: `node --check` passes after status event helper wiring.
- `apps/desktop/electron/main.mjs`: `node --check` passes after abort guard wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the Stage 2A RED test first failed on missing `chat/status-events.mjs`.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the abort guard RED test first failed on missing `chat/abort-guards.mjs`.
- `apps/desktop`: `cmd /c npm run build` passes after status event helper wiring.
- `apps/desktop`: `cmd /c npm run build` passes after abort guard wiring.

### Verified 2026-05-10
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3a.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the Tracer 3a RED test first failed on missing `chat/table-pipeline.mjs`.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3a.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3b-1 setup/clarify expansion.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3b-1 shell wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after Tracer 3b-1 RED tests first failed on missing setup/clarify behavior.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3b-1.
- `git diff --check` passes with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for Tracer 3b-1 and confirmed `generate_table` continues through `shellOnly` while `clarify` exits before the legacy table body. It recorded only P3 residual late-abort write-window risks for the later persistence extraction slice.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3b-2 RAG/metadata expansion.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3b-2 shell context wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the Tracer 3b-2 RED tests first failed on missing RAG/no-data/metadata behavior.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3b-2.
- Dedicated validation agent review found no P1/P2 blocker for Tracer 3b-2 and confirmed no-data, non-empty RAG continuation context, folder-scope filtering, and table backfill behavior. It recorded only the existing P3 late-abort write-window risk for the no-data persistence path.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3b-3-1 Stage 3a parsing movement.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3b-3-1 shell context wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the Tracer 3b-3-1 RED test first failed on missing Stage 3a parsing behavior.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3b-3-1.
- Dedicated validation agent review found one P1 after Tracer 3b-3-1: `main.mjs` still needed `allPaperIds` for Stage 3b continuation. The pipeline now returns `allPaperIds`, `main.mjs` destructures it, the regression test asserts it, and `node --check`, desktop tests, desktop build, and `git diff --check` pass.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3b-3-2 Stage 3b extraction movement.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3b-3-2 shell continuation wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the Tracer 3b-3-2 RED tests first failed on missing Stage 3b extraction behavior and per-paper abort propagation.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3b-3-2.
- `git diff --check` passes after Tracer 3b-3-2 with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no P1/P2 blocker for Tracer 3b-3-2 and confirmed Stage 3c/3d continuation values, parent abort behavior, scope boundaries, and new extraction tests. It recorded only P3 follow-ups for Stage 3c continuation integration coverage and all-fail extraction fallback coverage.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3b-3-3 Stage 3c merge/fallback movement.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3b-3-3 shell continuation wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after Tracer 3b-3-3 RED tests first failed on missing Stage 3c merge/fallback behavior; current result is 2 suites, 16 tests.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3b-3-3.
- `git diff --check` passes after Tracer 3b-3-3 with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue for Tracer 3b-3-3, confirmed Stage 3d continuation values, fallback metadata, abort guards, and scope boundaries, and its P3 fallback-abort test gap was covered before handoff.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3c-1 Stage 3d movement.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3c-1 shell continuation wiring and UTF-8 restoration from HEAD.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after Tracer 3c-1 RED test first failed on missing Stage 3d recovery behavior; current result is 2 suites, 19 tests.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3c-1.
- `git diff --check` passes after Tracer 3c-1 with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue for Tracer 3c-1, confirmed Stage 3d moved to the pipeline and Korean status strings were not newly corrupted, and its P3 Stage 3d abort gap was covered before handoff.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3c-2 persistence movement.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3c-2 shell continuation wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after Tracer 3c-2 RED test first failed on missing pipeline-owned persistence; current result is 2 suites, 20 tests.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3c-2.
- `git diff --check` passes after Tracer 3c-2 with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review found no blocking issue for Tracer 3c-2, confirmed persistence order, helper DI, abort-before-persistence guards, and Stage 4 handoff values, and recorded only the existing non-transactional partial-write residual risk.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes after Tracer 3c-3 Guardian movement and IPC return trimming.
- `apps/desktop/electron/main.mjs`: `node --check` passes after Tracer 3c-3 direct pipeline return wiring.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after Tracer 3c-3 RED test first failed on missing Guardian scheduling and `shellOnly` cleanup; current result is 2 suites, 21 tests.
- `apps/desktop`: `cmd /c npm run build` passes after Tracer 3c-3.
- `git diff --check` passes after Tracer 3c-3 with LF-to-CRLF warnings only on existing mixed-line-ending files.
- Dedicated validation agent review first found one P2 because the direct pipeline return exposed internal context over IPC; this was first handled with an opt-in test seam, then fully cleaned up in Plan 12 Stage 3 so the pipeline API now only returns the minimal public payload.

### Verified 2026-05-08
- `frontend`: `cmd /c npm run test -- --run src/features/search/searchModel.test.ts` passes with approved escalation after the default sandbox hits Vite/esbuild `spawn EPERM`.
- Stage 1 docs: `Select-String` checks found the expected `CHAT_SEND_MESSAGE`, RAG, Stage 3d, and QA anchors in `main.mjs`; `git diff --check` passes with LF-to-CRLF warnings only on existing mixed-line-ending files.
- `apps/desktop`: `cmd /c npm run test` passes with approved escalation after the default sandbox hits Node test runner `spawn EPERM`.

### Verified Today (2026-05-03)
- `apps/desktop/electron/main.mjs`: `node --check` passes after critical security/workflow fixes.
- `apps/desktop/electron/preload.mjs`: `node --check` passes after LLM IPC signature update.
- `frontend`: `npm run build` passes after chat auth scoping, PDF processing-state, highlight, search, and import cleanup fixes.
- `apps/desktop`: `npm run build` passes after preload API update.
- `supabase/migrations/20260503010000_secure_chat_tables.sql`: applied manually to the running local Supabase DB via `docker exec ... psql`; `chat_conversations`, `chat_messages`, and `chat_generated_tables` now report RLS enabled.
- `git diff --check` passes; only existing CRLF/git-ignore permission warnings remain.
- Dedicated validation agents reviewed the patch twice; first pass found 2 P2 and 1 P3 follow-up, second pass found no blocking issue and confirmed the follow-ups were resolved.

### Previously Verified (2026-04-22)
- `apps/desktop/electron/main.mjs`: `node --check` passes after Stage 3d Agentic NULL Recovery wiring.
- `apps/desktop/electron/llm-orchestrator.mjs`: `node --check` passes after adding `extractNullCellsFromPaper`.

### Previously Verified (2026-03-11)
- `frontend`: `npm run build` passes with semantic search integration.
- `apps/desktop/electron/main.mjs`: `node --check` passes with embedding worker import and generate_embeddings job handler.
- `supabase status`: local stack is running with `match_chunks` function and HNSW index.
- New migration `20260311010000_add_embedding_search.sql` applied successfully via `supabase db reset`.
- `apps/desktop`: `npm run build` passes after installing local dependencies, and the desktop-side `pdfjs-dist` module path exists under `apps/desktop/node_modules`.
- `supabase db reset --local --yes` passes, and `app_users`, `papers`, `folders`, `notes`, and `highlight_presets` were verified empty afterward.

### Known Gaps
- `frontend` is only partially wired to `window.redouDesktop`; settings, auth runtime, Add Paper import, processing-state surfaces, and the first PDF.js reader workspace are connected, but detached panel flows are still pending.
- `apps/desktop/src` still contains the legacy mock renderer and has not been replaced by the `frontend` codebase.
- The current PDF.js reader now persists saved selection highlights, supports preset switching, note creation from saved highlights, and safe deletion, but it still lacks existing-note reassignment between highlights, preset CRUD surfaces, and deeper text-fragment re-centering beyond page-level jumps.
- The background worker now performs a PDF.js page-text first pass for sections, chunks, figures, and summary refresh, and falls back to raw heuristic parsing when PDF.js cannot recover usable text. It is still not OCR-based, layout-aware, or embedding-aware.
- The Electron shell now launches against the installed desktop workspace and falls back to `frontend/dist` when the dev renderer is unavailable, but the in-window import, extraction, and reader flows have not yet been walked through manually or with automation.
- Search is still client-side over local Supabase records. It is not yet ranked retrieval, semantic search, or vector-backed recall.
- Google sign-in is now exposed in the auth UI, but local Supabase still needs real Google provider credentials/config before that OAuth path can complete successfully.
- Korean display mode now covers the core shell and the auth entry flow, but deeper surfaces like full paper detail and notes editing still contain partial English.
- PDF.js increases the frontend bundle size and currently triggers chunk-size warnings in production build output.
- In this environment, Vite `dev` / `preview` cannot be started reliably because `esbuild` hits `spawn EPERM`.

---

## 5. Key Paths

### Shared Docs
- `README.md`
- `AGENTS.md`
- `CONTEXT.md`
- `docs/agents/codex-claude/README.md`
- `docs/agents/codex-claude/decisions.md`
- `docs/harness/main/glossary.md`
- `docs/harness/detail/electron/chat-table-pipeline-state.md`
- `docs/harness/decisions/0001-debuggable-module-split.md`
- `docs/harness/decisions/0002-module-ownership.md`
- `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`
- `docs/harness/decisions/0004-chat-pipeline-contract.md`
- `docs/features/proposals/2026-05-08-branch-hygiene-analysis.md`
- `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`
- `docs/presentation_assets/redou-agent/redou-ontology-future-slide.html`
- `docs/features/new/10-supplementary-files.md`
- `docs/features/new/09-agentic-research-null.md`
- `docs/harness/main/feature-status.md`
- `docs/harness/detail/electron/llm.md`
- `docs/harness/detail/electron/rag-pipeline.md`
- `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`
- `docs/planning/product_decision_template.md`
- `docs/planning/implementation_plan.md`
- `docs/planning/selected_design_direction.md`
- `docs/planning/annotation_highlight_plan.md`
- `docs/frontend/frontend_options.md`
- `docs/frontend/frontend_structure_options.md`
- `docs/database/database_schema_draft.md`

### Frontend
- `frontend/README.md`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src/App.tsx`
- `frontend/src/components/ProcessingBadge.tsx`
- `frontend/src/app/AppShell.tsx`
- `frontend/src/app/RightInspector.tsx`
- `frontend/src/features/auth/AuthView.tsx`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
- `frontend/src/features/notes/NotesView.tsx`
- `frontend/src/features/paper/PaperDetailView.tsx`
- `frontend/src/features/paper/paperDetail/`
- `frontend/src/features/paper/PdfReaderWorkspace.tsx`
- `frontend/src/features/search/SearchView.tsx`
- `frontend/src/features/search/SearchSidebar.tsx`
- `frontend/src/features/search/searchModel.ts`
- `frontend/src/features/figures/FiguresView.tsx`
- `frontend/src/features/import/ImportPdfDialog.tsx`
- `frontend/src/lib/auth.ts`
- `frontend/src/lib/desktop.ts`
- `frontend/src/lib/locale.ts`
- `frontend/src/lib/queries.ts`
- `frontend/src/stores/uiStore.ts`
- `frontend/src/lib/supabase.ts`
- `frontend/src/lib/supabaseAuthRepository.ts`
- `frontend/src/lib/supabasePaperRepository.ts`
- `frontend/src/lib/paperRepository/highlights.ts`
- `frontend/src/lib/paperRepository/mappers.ts`
- `frontend/src/lib/paperRepository/mappers.test.ts`
- `frontend/src/lib/paperRepository/notes.ts`
- `frontend/src/lib/paperRepository/notes.test.ts`
- `frontend/src/mock/repository/paperRepository.ts` (retained as fallback)
- `frontend/src/types/desktop.ts`
- `frontend/src/types/paper.ts`

### Desktop Shell
- `apps/desktop/package.json`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/chat/abort-guards.mjs`
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`
- `apps/desktop/electron/chat/extraction-utils.mjs`
- `apps/desktop/electron/chat/source-evidence.mjs`
- `apps/desktop/electron/chat/status-events.mjs`
- `apps/desktop/electron/chat/table-extraction.mjs`
- `apps/desktop/electron/chat/table-pipeline.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `apps/desktop/tests/agentic-null-recovery.test.mjs`
- `apps/desktop/tests/desktop-placeholder.test.mjs`
- `apps/desktop/tests/extraction-utils.test.mjs`
- `apps/desktop/tests/source-evidence.test.mjs`
- `apps/desktop/tests/table-extraction.test.mjs`
- `apps/desktop/tests/table-pipeline.test.mjs`
- `apps/desktop/src/types/electron-api.d.ts`
- `apps/desktop/src/App.tsx`

### Supabase
- `supabase/config.toml`
- `supabase/migrations/20260309050635_initial_schema.sql`
- `supabase/seed.sql`

---

## 6. Recommended Next Work

1. Close Plan 12 / Stage 2B and pivot to the agreed test-foundation roadmap: fixture strategy, harness skeleton, and one deterministic golden-path integration test.
2. Improve the extraction worker from heuristic PDF text parsing into layout-aware and OCR-backed section, chunk, and figure extraction.
3. Decide whether to retire `apps/desktop/src` or fully replace it with the `frontend` renderer.
4. Walk through import, extraction, and reader flows inside the launched Electron window, or add automation for those runtime checks.
5. Add preset CRUD plus existing-note reassignment if highlight management needs to go beyond the current reader-local controls.

---
## 7. Active Work

Add `IN PROGRESS` here before editing files. Move finished work into the log below.

| Status | Date | Agent | Scope | Files | Out of Scope | Dependency |
|--------|------|-------|-------|-------|--------------|------------|
| DONE | 2026-05-22 | Codex | Record Plan 12 closure decision before entity graph work | `docs/agents/codex-claude/decisions.md`, `AGENTS.md` | Runtime code changes, entity graph implementation, test-foundation implementation | User corrected priority: finish Plan 12 / Stage 2B first |
| DONE | 2026-05-22 | Codex | Accept Stage 2B PDF review and close Plan 12 recommendation | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, Stage 5 implementation, test-foundation implementation | Claude PDF tab split review GO and Plan 12 termination recommendation |
| DONE | 2026-05-22 | Codex | Stage 2B PDF tab PaperDetailView split | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperPdfTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Further sidebar micro-panel extraction, backend edits, layout redesign, Stage 5 implementation | Claude extracted-items review GO with remaining slice = PDF tab first |
| DONE | 2026-05-22 | Codex | Stage 2B extracted-items PaperDetailView split | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperExtractedItemsTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | PDF tab/sidebar movement, backend edits, layout redesign, Stage 5 implementation | Claude notes/overview review GO with next split = extracted items before PDF tab/sidebar |
| DONE | 2026-05-22 | Codex | Stage 2B notes/overview PaperDetailView split | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperOverviewTab.tsx`, `frontend/src/features/paper/paperDetail/PaperNotesTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Extracted-items tab, PDF tab/sidebar movement, backend edits, layout redesign, Stage 5 implementation | User chose A-2 current file-exchange plus B-1 Stage 2B continuation after Claude P2 verification |
| DONE | 2026-05-21 | Codex | Post-Plan 12 roadmap cross-agent response | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, Stage 2B notes/overview split, committing roadmap decisions before user approval | Claude 2026-05-21 roadmap decision request and user request to collaborate through docs |
| DONE | 2026-05-20 | Codex | Stage 2B first PaperDetailView mechanical split | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/paperDetailConstants.ts`, `frontend/src/features/paper/paperDetail/paperDetailStyles.ts`, `frontend/src/features/paper/paperDetail/paperDetailUtils.ts`, `frontend/src/features/paper/paperDetail/PaperMetadataTab.tsx`, `frontend/src/features/paper/paperDetail/PaperReferencesTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Overview/notes/extracted-items/PDF tab movement, backend edits, layout redesign, Stage 5 implementation | Claude Stage 2B map GO and user approval to proceed |
| DONE | 2026-05-20 | Codex | Stage 2B PaperDetailView responsibility map | `docs/harness/detail/frontend/paper-detail-view-responsibility-map.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime UI edits, component extraction, QA branch extraction, Stage 5 implementation | User-approved Option A-light and Claude recommendation to map responsibilities before code movement |
| DONE | 2026-05-20 | Codex | Respond to Claude strategic Plan 12 scope boundary review | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime edits, QA branch extraction, Stage 2B implementation, Stage 5 implementation | Claude strategic stopping-criteria review and user request for Codex opinion |
| DONE | 2026-05-18 | Codex | Accept Claude RAG review and resolve `main.mjs` measurement discrepancy | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime edits, QA branch extraction, D32 promotion | Claude RAG infrastructure extraction review |
| DONE | 2026-05-17 | Codex | RAG infrastructure extraction and Q14/D31 closure | `apps/desktop/electron/rag/multi-query-rag.mjs`, `apps/desktop/tests/multi-query-rag.test.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Reranker worker internals, frontend/import/supplementary workflows, query adapter tracer, QA branch extraction, Stage 5 import/processing | User approved Q16 default after Claude Q16 review |
| DONE | 2026-05-17 | Codex | Open Q16 RAG infrastructure extraction scope and record Karpathy exception | `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime RAG code edits, branch creation, tests/build | Claude Stage 4 closure documentation review and user approval to proceed after checking |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 closure and Q13 D30 promotion | `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, query hook migration, facade removal, real Supabase fixture implementation, RAG extraction | Claude Stage 4 measurement closure review and user approval to proceed |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 query hook migration measurement | `frontend/src/lib/queries.ts`, `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime query-hook migration, facade removal, workflow extraction, tests/build reruns | Claude Paper CRUD helper split review recommending Option B measurement |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 first Paper CRUD helper split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/papers.ts`, `frontend/src/lib/paperRepository/papers.test.ts`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving `createImportedPaper`, `attachSupplementaryPdfToPaper`, or `deletePaper` workflows; query hook migration; facade removal; supplementary/import workflow changes; Electron or DB schema changes | User approved Q15 as A + default after Claude confirmed the confirmation-gate approach |
| DONE | 2026-05-15 | Codex | Accept Stage 4 folders review and record Paper CRUD confirmation gate | `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `AGENTS.md` | Runtime Paper CRUD edits, supplementary/import workflow changes, tests/build reruns | Claude folders review and user approval to proceed with the confirmation-gate step |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 folders split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/folders.ts`, `frontend/src/lib/paperRepository/folders.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, paper CRUD split, moving import/supplementary workflows, Electron or DB schema changes | Claude paper-signals review recommending folders first and preserving explicit confirmation before paper CRUD |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 paper-list/signals split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/paperSignals.ts`, `frontend/src/lib/paperRepository/paperSignals.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, paper/folder CRUD split, moving import workflows, Electron or DB schema changes | Claude source-file review recommending paper-list/signals first and user approval of the explicit-confirmation pattern |
| DONE | 2026-05-15 | Codex | Plan 12 Stage 4 source-file/import helper split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/source-files.ts`, `frontend/src/lib/paperRepository/source-files.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, moving `createImportedPaper` / `attachSupplementaryPdfToPaper` workflows wholesale, paper/folder CRUD split, Electron or DB schema changes | User approval to proceed after no new Claude notes-split reply |
| DONE | 2026-05-14 | Codex | Plan 12 Stage 4 notes repository split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/notes.ts`, `frontend/src/lib/paperRepository/notes.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, source-file/import split, paper/folder CRUD split, Electron or DB schema changes | Claude recommendation to continue Stage 4 with notes after highlight split |
| DONE | 2026-05-14 | Codex | Plan 12 Stage 4 highlight repository split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/highlights.ts`, `frontend/src/lib/paperRepository/mappers.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, notes split, source-file/import split, Electron or DB schema changes | Claude recommendation to proceed with Option B and mapper P3 characterization first |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 4 repository mapper split | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/mappers.ts`, `frontend/src/lib/paperRepository/mappers.test.ts`, `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Query hook migration, facade removal, Q13 real Supabase fixtures, source-file/import helper split, highlight/note split | Claude approval to proceed to Stage 4 and facade call-site measurement |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 3 includePipelineContext cleanup | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving `runMultiQueryRag`, moving `runPaperScopedRecoverySearch`, QA branch extraction, Q13 fixture implementation, transactional persistence cleanup | Claude table-extraction review recommending option C before Stage 4 |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 3 table extraction helper split | `apps/desktop/electron/chat/table-extraction.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-extraction.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving `runMultiQueryRag`, moving `runPaperScopedRecoverySearch`, QA branch extraction, Q13 fixture implementation, `includePipelineContext` cleanup | Claude extraction-utils review and user approval |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 3 extraction utils normalization cleanup | `apps/desktop/electron/chat/extraction-utils.mjs`, `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/extraction-utils.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving `runMultiQueryRag`, moving `runPaperScopedRecoverySearch`, broad Stage 3b/3c helper extraction, QA branch extraction, Q13 fixture implementation | Claude agentic NULL recovery review |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 3 agentic NULL recovery helper extraction | `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/agentic-null-recovery.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Exporting `runMultiQueryRag`, moving paper-scoped recovery search out of `main.mjs`, broad table-extraction helper split, QA branch extraction, Q13 fixture implementation | Claude source-evidence slice review and user approval |
| DONE | 2026-05-11 | Codex | Plan 12 Stage 3 source evidence helper extraction | `apps/desktop/electron/chat/source-evidence.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/source-evidence.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Stage 3d helper extraction, broad table extraction helpers, QA branch extraction, Q13 fixture implementation, source-label behavior changes | Claude D21-D25 review and user approval |
| DONE | 2026-05-11 | Codex | Close Q5/Q6/Q7/Q8/Q10 architecture decisions after Stage 2A | `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/decisions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, Plan 12 Stage 3 helper extraction, Q13 fixture implementation, QA branch extraction | Claude Tracer 3c-3 review and user approval |
| DONE | 2026-05-11 | Codex | Stage 2A Tracer 3c-3 Stage 4 Guardian movement and shellOnly cleanup | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | QA extraction, broad helper extraction, transactional persistence fix, real Supabase fixtures | Claude Tracer 3c-2 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3c-2 persistence and extraction metadata movement | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Stage 4 Guardian movement, shellOnly cleanup, broad helper extraction, real Supabase fixtures | Claude Tracer 3c-1 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3c-1 Stage 3d Agentic NULL Recovery movement | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving final table persistence, Stage 4 Guardian verification, QA extraction, real Supabase fixture closure, broad helper extraction | Claude Tracer 3b-3-3 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3b-3-3 Stage 3c merge/fallback movement | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving Stage 3d, final table persistence, Guardian verification, QA extraction, real Supabase fixture closure | Claude Tracer 3b-3-2 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3b-3-2 Stage 3b per-paper extraction movement | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving Stage 3c merge/fallback, Stage 3d, final table persistence, Guardian verification, QA extraction, real Supabase fixture closure | Claude Tracer 3b-3-1 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3b-3-1 Stage 3a parsing movement | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving Stage 3b extraction, Stage 3c merge/fallback, Stage 3d, final table persistence, Guardian verification, QA extraction, real Supabase fixture closure | Claude Tracer 3b-2 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3b-2 RAG and metadata/backfill movement | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving Stage 3a-3c extraction/merge, Stage 3d, final table persistence, Guardian verification, QA extraction, real Supabase fixture closure | Claude Tracer 3b-1 review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3b-1 setup and orchestrator shell wiring | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Moving Stage 2 RAG, Stage 2b metadata/backfill, Stage 3a-3c extraction/merge, Stage 3d, persistence, Guardian verification, QA extraction | Claude Tracer 3a review and user approval |
| DONE | 2026-05-10 | Codex | Stage 2A Tracer 3a table pipeline shell and abort regression | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `AGENTS.md` | Moving table branch body from `main.mjs`, QA extraction, Stage 3d helper extraction, RAG abort propagation, real Supabase fixture | Claude Stage 2A Tracer 3 plan and user approval |
| DONE | 2026-05-09 | Codex | Ask Claude to draft the next Stage 2A work composition | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, tests, table pipeline extraction | Claude consolidated Stage 2A tracer review |
| DONE | 2026-05-09 | Codex | Consolidate Claude review request for Stage 2A tracers | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | New runtime code changes, additional tests, table pipeline extraction | Completed Stage 2A status event and abort guard tracers |
| DONE | 2026-05-09 | Codex | Stage 2A abort persistence guard tracer bullet | `apps/desktop/electron/chat/abort-guards.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Full RAG abort propagation, full table pipeline extraction, Supabase integration fixture | Stage 2A status event helper tracer and abort no-persistence contract |
| DONE | 2026-05-09 | Codex | Stage 2A status event helper tracer bullet | `apps/desktop/electron/chat/status-events.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Full table pipeline extraction, QA module extraction, RAG abort propagation, Supabase fixture implementation | Stage 2A plan and Pre-Stage 2A readiness reinforcement |
| DONE | 2026-05-08 | Codex | Pre-Stage 2A readiness reinforcement, test dry-run, and validation cleanup | `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`, `docs/harness/decisions/0004-chat-pipeline-contract.md`, `docs/agents/codex-claude/open-questions.md`, `frontend/src/types/desktop.ts`, `apps/desktop/package.json`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Chat/table runtime extraction, RAG abort propagation implementation, Supabase fixture implementation | Claude Stage 1 review S12-S16, validation agent P3 follow-up, and user approval |
| DONE | 2026-05-08 | Codex | Stage 1 chat/table pipeline state audit | `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/harness/decisions/0004-chat-pipeline-contract.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code movement, Stage 2A implementation, new LLM/Supabase fixture implementation | Claude Stage 0.5 review and user approval |
| DONE | 2026-05-08 | Codex | Clarify Stage 0.5 Claude review request | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | New tests, runtime code changes, Stage 1 implementation | User request to summarize test content for Claude review |
| DONE | 2026-05-08 | Codex | Stage 0.5 test infrastructure bootstrap | `frontend/src/features/search/searchModel.test.ts`, `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime refactor, Electron IPC contract tests, LLM/Supabase fixture implementation | Stage 0 docs and user approval to proceed |
| DONE | 2026-05-08 | Codex | Apply Claude Stage 0 reinforcement suggestions inline | `docs/harness/main/glossary.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/decisions/0002-module-ownership.md`, `docs/features/proposals/2026-05-08-branch-hygiene-analysis.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, Stage 0.5 implementation, real integration merge | Claude combined review C-2/C-3/C-4 and user approval |
| DONE | 2026-05-08 | Codex | Stage 0 domain context, glossary, and architecture ADRs | `CONTEXT.md`, `docs/harness/main/glossary.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/decisions/0002-module-ownership.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, integration branch merge, test infrastructure implementation | Stage 0 from `docs/features/fix/12-architecture-debuggability-implementation-plan.md` |
| DONE | 2026-05-08 | Codex | Improve `lessons-to-skill` Korean trigger coverage | `.agents/skills/lessons-to-skill/SKILL.md`, `AGENTS.md` | Runtime code changes, broad skill redesign | User request to verify skill trigger quality |
| DONE | 2026-05-08 | Codex | Add Ouroboros-inspired lessons-to-skill guardrail skill | `.agents/skills/lessons-to-skill/SKILL.md`, `AGENTS.md` | Runtime code changes, installing Ouroboros, changing Matt Pocock skills | User request to apply an Ouroboros-inspired mistake-to-skill workflow |
| DONE | 2026-05-08 | Codex | Stage -1 branch hygiene analysis for architecture/debuggability refactor | `docs/features/proposals/2026-05-08-branch-hygiene-analysis.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Running a real merge, resolving merge conflicts, runtime code changes | `docs/features/fix/12-architecture-debuggability-implementation-plan.md` |
| DONE | 2026-05-07 | Codex | Fold Claude implementation-plan review into plan and open questions | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Runtime code changes, starting Stage -1 execution | Claude implementation plan review S1-S6 |
| DONE | 2026-05-07 | Codex | Prepare Claude review handoff for architecture/debuggability implementation plan | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` | Claude performing the review, changing runtime code | `docs/features/fix/12-architecture-debuggability-implementation-plan.md` |
| DONE | 2026-05-07 | Codex | Create concrete implementation plan for architecture/debuggability refactor stages | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `AGENTS.md` | Runtime code changes, executing branch merge, adding tests | V2 architecture review and Codex-Claude decisions D4-D12 |
| DONE | 2026-05-07 | Codex | Rewrite architecture/debuggability review as v2 and add Codex-Claude file exchange protocol | `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`, `docs/agents/codex-claude/**`, `AGENTS.md`, `CLAUDE.md` | Runtime code changes, branch integration execution, test infrastructure implementation | User request to consolidate v2 and create shared Codex/Claude communication folder |
| DONE | 2026-05-07 | Codex | Document Redou architecture/debuggability risks and staged remediation plan | `docs/features/proposals/2026-05-07-architecture-debuggability-review.md`, `AGENTS.md` | Runtime code changes, broad refactor implementation, test creation | User request to document structural issues and fixes |
| DONE | 2026-05-07 | Codex | Create Redou Spec Loop workflow document combining Matt Pocock flow with Ouroboros-inspired checks | `docs/agents/redou-spec-loop.md`, `AGENTS.md` | Creating a new active skill, installing Ouroboros, changing runtime code | User-approved workflow-document approach |
| DONE | 2026-05-07 | Codex | Restrict project-local skills to Matt Pocock skills only | `.agents/skills/**`, `.agents/skills.disabled/**`, `AGENTS.md` | Global Codex system skills, plugin-provided skills, deleting skill history | User request to use only `mattpocock/skills` |
| DONE | 2026-05-06 | Codex | G3 supplementary source labels for RAG answers and generated table references | `supabase/migrations/20260506010000_add_rag_source_file_metadata.sql`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/llm-qa.mjs`, `frontend/src/types/chat.ts`, `frontend/src/features/chat/ChatTableReport.tsx`, `docs/goals/2026-05-05-research-os-goal.md`, `docs/features/new/10-supplementary-files.md`, `AGENTS.md` | DOCX conversion, citation style redesign, exact per-claim provenance UI | Research OS G3 and supplementary Slice B |
| DONE | 2026-05-06 | Codex | Record G2 supplementary attach Electron runtime verification | `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` | New runtime code changes, DOCX conversion, G3 source labels, pushing to remote | G2 Electron bridge and DB walkthrough |
| DONE | 2026-05-05 | Codex | G2 supplementary PDF attach from paper detail | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/types/paper.ts`, `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` | DOCX conversion, RAG supplementary citation labels, supplementary inline reader, new job type | Research OS goal G2 and supplementary attach subagent findings |
| DONE | 2026-05-05 | Codex | Create Research OS goal plan with subagent-backed checkpoints | `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` | Implementing every goal slice at once, merge conflict resolution, DB reset | User request to use `/goal`, skills, and subagents |
| DONE | 2026-05-05 | Codex | G1 table-spec adherence guard for single-call fallback | `apps/desktop/electron/main.mjs`, `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` | Prompt rewrite, full table pipeline refactor, changing LLM defaults | Subagent A table-spec adherence analysis |
| DONE | 2026-05-05 | Codex | Fix Stage 3d metadata on single-call fallback | `apps/desktop/electron/main.mjs`, `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` | Broad table quality fixes, changing LLM prompts, merge conflict resolution | Runtime observation table `81a19a84-ba39-49bb-bfe1-68ac3c9dd84f` |
| DONE | 2026-05-05 | Codex | Record Stage 3d runtime observations and V1/V5 outcome | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` | Runtime code changes, deleting validation conversations, merge conflict resolution | Stage 3d Electron IPC verification runs |
| DONE | 2026-05-05 | Codex | Record Stage 3d V0 static verification result | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` | Runtime Electron chat walkthrough, merge conflict resolution, DB reset | `docs/features/fix/10-stage-3d-runtime-verification.md` |
| DONE | 2026-05-05 | Codex | Plan Stage 3d runtime verification before integration | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` | Performing the merge, changing runtime code, executing destructive DB reset | `docs/features/proposals/2026-05-05-pre-merge-preservation-audit.md` |
| DONE | 2026-05-05 | Codex | Create pre-merge preservation audit plan for Option B+ integration | `docs/features/proposals/2026-05-05-pre-merge-preservation-audit.md`, `AGENTS.md` | Performing the merge, changing runtime code, resolving conflicts | `docs/features/proposals/2026-05-05-integration-strategy-update.md` |
| DONE | 2026-05-05 | Codex | Update integration strategy after checkpoint and latest branch state | `docs/features/proposals/2026-05-05-integration-strategy-update.md`, `AGENTS.md` | Performing the actual merge, resolving merge conflicts, changing runtime code | `docs/features/proposals/2026-04-28-integration-strategy.md`, checkpoint `1637751` |
| DONE | 2026-05-04 | Codex | Upload reusable skills package to `huckwnmo99/Skills` | `AGENTS.md`; external repo `huckwnmo99/Skills` | Changing skill contents, publishing Redou app code | Prepared `docs/exports/Skills` package |
| DONE | 2026-05-04 | Codex | Prepare reusable GitHub skills repository package | `docs/exports/Skills/**`, `AGENTS.md` | Pushing to GitHub, modifying skill contents | User request to reuse skills via `huckwnmo99/Skills` |
| DONE | 2026-05-04 | Codex | Redou Style import dialog copy cleanup with minimal code changes | `frontend/src/features/import/ImportPdfDialog.tsx`, `AGENTS.md` | Redesigning the whole app, changing import pipeline behavior, adding supplementary UI | User preference for current design and minimal code edits |
| DONE | 2026-05-04 | Codex | Download external design reference repository for future UI guidance | `docs/reference/awesome-design-md/**`, `AGENTS.md` | Applying the design rules to Redou UI | `VoltAgent/awesome-design-md` |
| DONE | 2026-05-04 | Codex | Plan next supplementary implementation slices with parallel subagents | `docs/features/new/10-supplementary-files.md`, `AGENTS.md` | Implementing PDF attach, RAG labels, DOCX conversion | User request to use subagents for the next plan |
| DONE | 2026-05-04 | Codex | Implement first supplementary prerequisite slice: source-file ownership and source-scoped extraction persistence | `supabase/migrations/20260504010000_add_supplementary_source_tracking.sql`, `apps/desktop/electron/main.mjs`, `frontend/src/lib/supabasePaperRepository.ts`, `AGENTS.md` | Supplementary UI, DOCX conversion, RAG source-label rendering | `docs/features/new/10-supplementary-files.md`, parallel subagent analysis |
| DONE | 2026-05-04 | Codex | Install requested external Codex skills into the project-local `.agents/skills` folder | `.agents/skills/**`, `AGENTS.md` | Changing project runtime code, executing app tests | User-provided skill repository URLs |
| DONE | 2026-05-04 | Codex | Plan supplementary file ingestion, document conversion, source-scoped extraction, and citation labeling | `docs/features/new/10-supplementary-files.md`, `AGENTS.md` | Implementing the feature, DB migration execution, runtime QA | User request for supplementary docs/PDF support |
| DONE | 2026-05-03 | Codex | Fix critical review findings in small safety-focused slices | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/preload.mjs`, `frontend/src/lib/chatQueries.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabaseAuthRepository.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/search/searchModel.ts`, `frontend/src/types/desktop.ts`, `supabase/migrations/20260503010000_secure_chat_tables.sql`, `AGENTS.md` | Large renderer replacement, broad refactors, unrelated feature expansion | Critical findings review from 2026-05-03 |
| DONE | 2026-04-22 | Codex | Implement Stage 3d Agentic NULL Recovery for table generation | `apps/desktop/electron/llm-orchestrator.mjs`, `apps/desktop/electron/main.mjs`, `frontend/src/types/desktop.ts`, `frontend/src/features/chat/ChatPipelineStatus.tsx`, `docs/harness/main/feature-status.md`, `docs/harness/detail/electron/llm.md`, `docs/harness/detail/electron/rag-pipeline.md`, `AGENTS.md` | Editing `runMultiQueryRag` or `extractColumnsFromPaper`, DB migrations, IPC channel changes | `docs/features/new/09-agentic-research-null.md` |
| DONE | 2026-04-18 | Codex | Implement V2-only PDF processing pipeline from `docs/features/new/08-pipeline-v2-only.md` | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/pdf-heuristics.mjs`, `apps/desktop/electron/ocr-extraction.mjs`, `docs/harness/**`, `AGENTS.md` | DB schema changes, IPC channel renames, removing `enhanceEmptyTablesWithOcr`, removing import metadata/figure-image helpers | MinerU required, GROBID degraded mode allowed |
| DONE | 2026-04-18 | Codex | Move Phase 3 extraction from heuristic text parsing toward layout-aware ordering with OCR-ready scanned-PDF hooks and worker messaging | AGENTS.md, pps/desktop/electron/pdf-heuristics.mjs, pps/desktop/electron/main.mjs, rontend/src/types/desktop.ts | Cloud OCR provider integration, embeddings, retrieval, detached panels | Local desktop build and Supabase available |
| READY FOR ASSIGNMENT | 2026-03-10 | Desktop/Platform Agent | Wire `frontend` to `window.redouDesktop` and define the migration path away from `apps/desktop/src` legacy renderer | `apps/desktop/electron/**`, `apps/desktop/src/types/**`, `frontend/src/**` | Paper data migration, PDF.js, retrieval | Data layer contracts should stay stable |

---

## 8. Work Log

| Date | Agent | Work | Files |
|------|-------|------|-------|
| 2026-05-22 | Codex | Recorded D35 to close Plan 12 after Stage 2B before any entity graph work: Stage 5 is deferred unless the user explicitly chooses a reliability-focused implementation series, the default next direction is the test-foundation roadmap, and entity graph integration remains a separate user-triggered feature plan | `docs/agents/codex-claude/decisions.md`, `AGENTS.md` |
| 2026-05-22 | Codex | Accepted Claude's Stage 2B PDF tab split review: recorded GO with no blockers/P1/P2, confirmed Stage 2B can close, kept sidebar micro-panels inside `PaperPdfTab`, and updated the recommended next direction to the test-foundation pivot rather than Stage 5 or further broad refactoring | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-22 | Codex | Completed the Stage 2B PDF tab PaperDetailView split after Claude gave GO on extracted-items: moved PDF reader orchestration, highlight/note handlers, presets, source PDF controls, supplementary PDF attach, and sidebar body into `PaperPdfTab`, kept sidebar micro-panels together to avoid prop-plumbing churn, left backend/layout/copy unchanged, recorded D9 measurements (`PaperDetailView.tsx` 894 / 834 -> 166 / 155 full / non-empty lines; PDF tab 722 / 671), verified frontend build, and sent Claude a light blocker/P1/P2 review request to decide whether Stage 2B can close | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperPdfTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-22 | Codex | Checked Claude's Stage 2B extracted-items review: accepted GO with no blockers/P1/P2, recorded that `PaperExtractedItemsTab` self-contained PDF.js worker/KaTeX ownership is acceptable, and updated the recommended remaining order to PDF tab first with sidebar micro-panels only if prop flow stays clear | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `AGENTS.md` |
| 2026-05-22 | Codex | Completed the Stage 2B extracted-items PaperDetailView split after Claude gave GO on notes/overview: moved figures/tables/equations rendering into `PaperExtractedItemsTab`, moved the related image/PDF crop, OCR table, and KaTeX helpers with it, kept `PaperDetailView.tsx` as coordinator, left PDF tab/sidebar untouched, recorded D9 measurements (`PaperDetailView.tsx` 1,459 / 1,337 -> 894 / 834 full / non-empty lines; extracted-items 577 / 513), verified frontend build, and sent Claude a light blocker/P1/P2 review request before the remaining PDF tab slice | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperExtractedItemsTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-22 | Codex | Completed the Stage 2B notes/overview PaperDetailView split after the user chose A-2 current file exchange plus B-1 Stage 2B continuation: moved the overview tab into `PaperOverviewTab`, moved the notes tab into `PaperNotesTab`, kept `PaperDetailView.tsx` as coordinator, left PDF tab/sidebar and extracted item tabs untouched, recorded D9 measurements (`PaperDetailView.tsx` 1,707 / 1,573 -> 1,459 / 1,337 full / non-empty lines; overview 201 / 191; notes 68 / 62), verified frontend build, and sent Claude a light blocker/P1/P2 review request before the next extracted-items split | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/paperDetail/PaperOverviewTab.tsx`, `frontend/src/features/paper/paperDetail/PaperNotesTab.tsx`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Completed Plan 12 Stage 4 query hook migration measurement: accepted Claude's recommendation to measure before another runtime split, confirmed `frontend/src/lib/queries.ts` is the only production facade import, counted 38 `paperRepository.*` occurrences across 37 unique methods, confirmed production focused-module imports outside the facade remain 0, grouped hooks into read-only direct candidates, adapter-needed candidates, workflow-retained paths, and not-yet-split extraction/search/reference paths, updated ADR 0005, recorded D29, and requested Claude review before any query-hook code migration | `frontend/src/lib/queries.ts`, `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Completed Plan 12 Stage 4 first Paper CRUD helper split: treated Q15 as A + default, added `frontend/src/lib/paperRepository/papers.ts` and `papers.test.ts`, moved low-level paper row reads, imported-paper row creation, and the `toggle_paper_star` RPC wrapper out of `supabasePaperRepository.ts`, kept `createImportedPaper`, `attachSupplementaryPdfToPaper`, and `deletePaper` as facade workflows, measured `supabasePaperRepository.ts` 736 -> 673 lines and `papers.ts` at 92 lines, and verified papers/folders/paperSignals/source-files/notes/mapper/search tests, frontend build, `git diff --check`, and the intended remaining direct paper table calls for import rollback and delete sequencing | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/papers.ts`, `frontend/src/lib/paperRepository/papers.test.ts`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Accepted Claude's folders split review, recorded D26 for explicit confirmation before collision-risk runtime slices, recorded D27 for owner-domain placement of cross-domain join helpers, opened Q15 for Paper CRUD scope plus supplementary/import status, and told Claude that Paper CRUD code edits are waiting on that explicit confirmation | `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Completed Plan 12 Stage 4 folders split: accepted Claude's paper-list/signals review recommendation to split folders before paper CRUD, added `frontend/src/lib/paperRepository/folders.ts` and `folders.test.ts`, moved folder list aggregation, folder creation, direct folder paper-id lookup, paper-folder attachment, and folder reassignment helpers out of `supabasePaperRepository.ts`, kept `movePaperToFolder` as a facade workflow because it reloads the full `Paper` through `getPaperById`, measured `supabasePaperRepository.ts` 818 -> 736 lines and `folders.ts` at 119 lines, and verified folders/paperSignals/source-files/notes/mapper/search tests, frontend build, `git diff --check`, and absence of direct folder table ownership from the facade. Paper CRUD remains gated on explicit user confirmation because of supplementary/import collision risk | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/folders.ts`, `frontend/src/lib/paperRepository/folders.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Completed Plan 12 Stage 4 paper-list/signals split: accepted Claude's source-file split review, preserved the future guardrail that larger supplementary/import/paper CRUD collision slices need explicit user option/status confirmation, added `frontend/src/lib/paperRepository/paperSignals.ts` and `paperSignals.test.ts`, moved paper-list note counts, figure counts, primary-source file filtering, and latest import job processing status aggregation out of `supabasePaperRepository.ts`, kept delete-paper disk cleanup file lookup in the facade, measured `supabasePaperRepository.ts` 865 -> 818 lines and `paperSignals.ts` at 59 lines, and verified paperSignals/source-files/notes/mapper/search tests, frontend build, `git diff --check`, and absence of direct processing job ownership from the facade | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/paperSignals.ts`, `frontend/src/lib/paperRepository/paperSignals.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-15 | Codex | Completed Plan 12 Stage 4 source-file/import helper split: added `frontend/src/lib/paperRepository/source-files.ts` and `source-files.test.ts`, moved primary file lookup, supplementary file listing, `paper_files` creation, import job creation, and supplementary cleanup row deletes out of `supabasePaperRepository.ts`, kept `createImportedPaper` and `attachSupplementaryPdfToPaper` as facade-level workflows, left `fetchPaperSignals` and delete-paper disk-cleanup file queries in the facade, measured `supabasePaperRepository.ts` 971 -> 865 lines and `source-files.ts` at 153 lines, and verified source-files/notes/mapper/search tests, frontend build, `git diff --check`, and absence of old source-file helper ownership from the facade | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/source-files.ts`, `frontend/src/lib/paperRepository/source-files.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-14 | Codex | Completed Plan 12 Stage 4 notes repository split: added `frontend/src/lib/paperRepository/notes.ts` and `notes.test.ts`, moved note select shape, note reads, note creation, and note updates out of `supabasePaperRepository.ts`, preserved the one-way dependency `notes.ts -> highlights.ts -> mappers.ts`, kept the public facade and query hooks unchanged, left the note-count query in `fetchPaperSignals` as a paper-list signal concern, measured `supabasePaperRepository.ts` 1071 -> 971 lines and `notes.ts` at 153 lines, and verified notes/mapper/search tests, frontend build, `git diff --check`, and absence of note CRUD ownership from the facade | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/notes.ts`, `frontend/src/lib/paperRepository/notes.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-14 | Codex | Completed Plan 12 Stage 4 highlight repository split: accepted Claude's Option B recommendation, expanded mapper characterization coverage from 3 to 7 tests for highlight/preset/extraction/title/slug mappers, added `frontend/src/lib/paperRepository/highlights.ts`, moved highlight preset CRUD, highlight CRUD, highlight lookup, existing-highlight lookup, and selection-highlight creation out of `supabasePaperRepository.ts`, kept the public facade and query hooks unchanged, kept note creation wired through extracted highlight helpers, measured `supabasePaperRepository.ts` 1260 -> 1071 lines and `highlights.ts` at 277 lines, and verified mapper/search tests, frontend build, `git diff --check`, and absence of direct highlight queries from the facade | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/highlights.ts`, `frontend/src/lib/paperRepository/mappers.test.ts`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 4 mapper split: added `frontend/src/lib/paperRepository/mappers.ts`, moved repository row types, note-kind mapping, title/slug helpers, selection-anchor normalization, and row-to-app-model mappers out of `supabasePaperRepository.ts`, kept the public facade and query hooks unchanged, added mapper RED/GREEN tests, recorded ADR 0005 for the facade sunset and Q13 fixture stop-gap, measured `supabasePaperRepository.ts` 1421 -> 1260 lines with 1 external facade import, verified frontend mapper/search tests, frontend build, `git diff --check`, and validation-agent no-blocker review, and recorded the non-blocking recommendation to add thin characterization tests for remaining mapper helpers before or during the next Stage 4 slice | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/paperRepository/mappers.ts`, `frontend/src/lib/paperRepository/mappers.test.ts`, `docs/harness/decisions/0005-supabase-paper-repository-facade-sunset.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 3 includePipelineContext cleanup: removed the `includePipelineContext` option from `runTableConversationPipeline`, kept the public table pipeline return limited to `{ conversationId, messageId, hasTable, tableId }`, rewrote table-pipeline tests to observe public results, emitted completion payloads, fake Supabase rows, and injected runtime callback inputs instead of private pipeline context, confirmed no remaining `includePipelineContext` usages in Electron chat modules or desktop tests, recorded D9 measurements (`main.mjs` 2507 lines unchanged, `table-pipeline.mjs` 1115 -> 1086 lines, `table-pipeline.test.mjs` 1159 -> 1158 lines, desktop tests unchanged at 6 suites / 38 tests), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 3 table extraction helper split: added `chat/table-extraction.mjs`, moved `cleanCellValue`, `assembleRagContext`, `assemblePerPaperContext`, `normalizeFallbackTableToSpec`, and `mergeExtractionResults` out of `main.mjs`, updated `chat/table-pipeline.mjs` and `chat/agentic-null-recovery.mjs` to import the helpers directly, removed `assemblePerPaperContextFn`, `mergeExtractionResultsFn`, `assembleRagContextFn`, `normalizeFallbackTableToSpecFn`, and `cleanCellValueFn` from the table pipeline DI surface, added table-extraction RED/GREEN tests, updated table-pipeline fixtures to exercise the real helper behavior, resolved validation-agent P3 by adding direct context assembler coverage, recorded D9 measurements (`main.mjs` 3221 -> 2507 lines, `table-pipeline.mjs` 1262 -> 1115 lines, `agentic-null-recovery.mjs` 178 -> 154 lines, `table-extraction.mjs` 279 lines, desktop tests 5 suites / 33 tests -> 6 suites / 38 tests), and verified `node --check`, desktop tests, desktop build, and `git diff --check` | `apps/desktop/electron/chat/table-extraction.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-extraction.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 3 extraction utils normalization cleanup: added `chat/extraction-utils.mjs`, moved `extractKeyTerms`, `sanitizeColumnNames`, and `normalizeColumnKey` into the shared module, updated `main.mjs`, `chat/agentic-null-recovery.mjs`, and `chat/table-pipeline.mjs` to import shared utilities, removed `sanitizeColumnNamesFn` from `runTableConversationPipeline`, added extraction utility RED/GREEN tests, removed the validation agent's non-blocking ignored `sanitizeColumnNamesFn` test fixture note by using `"Dose\\u00B2"` against the real shared sanitizer, recorded D9 measurements (`main.mjs` 3295 -> 3221 lines, `table-pipeline.mjs` 1268 -> 1262 lines, `agentic-null-recovery.mjs` 242 -> 178 lines, `extraction-utils.mjs` 66 lines, desktop tests 5 suites / 33 tests), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/extraction-utils.mjs`, `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/extraction-utils.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 3 agentic NULL recovery helper extraction: added `chat/agentic-null-recovery.mjs`, moved Stage 3d gate/skip metadata/NULL grouping/recovery query construction/clone helpers/context assembly/high-confidence value application/evidence append identifiers out of `main.mjs`, updated `chat/table-pipeline.mjs` to import those helpers directly, removed temporary Stage 3d helper DI parameters from `runTableConversationPipeline`, kept `runPaperScopedRecoverySearch` in `main.mjs` to avoid exporting `runMultiQueryRag`, added helper-level RED/GREEN coverage, cleaned the old Stage 3d test helper so it only supplies `runPaperScopedRecoverySearchFn` and `extractNullCellsFromPaperFn`, recorded D9 measurements (`main.mjs` 3480 -> 3295 lines, `table-pipeline.mjs` 1332 -> 1268 lines, `agentic-null-recovery.mjs` 242 lines, desktop tests 4 suites / 30 tests), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/agentic-null-recovery.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/agentic-null-recovery.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Plan 12 Stage 3 source evidence helper extraction: added `chat/source-evidence.mjs`, moved main-PDF/supplementary evidence labels, evidence location aggregation, source-ref enrichment, and serialization out of `main.mjs`, updated `chat/table-pipeline.mjs` to import the helper directly instead of receiving `buildEvidenceLocationsByPaperFn`, `serializeEvidenceLocationsFn`, and `enrichSourceRefsWithEvidenceFn`, added source evidence tests for main PDF labels, supplementary PDF labels, and missing source metadata fallback, adjusted table-pipeline tests to the real evidence-location shape, recorded D9 measurements (`main.mjs` 3569 -> 3480 lines, `table-pipeline.mjs` 1352 -> 1332 lines, `source-evidence.mjs` 88 lines, desktop tests 3 suites / 24 tests), removed the validation agent's non-blocking unused-import note, and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/source-evidence.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/source-evidence.test.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Closed Q5/Q6/Q7/Q8/Q10 after Stage 2A: accepted measured Stage 2A KPI gates (`main.mjs <= 3600`, `shellOnly = 0`, table orchestration moved, desktop tests/build passing), locked runtime-code fallback behind explicit user approval, deferred facade sunset timing to Stage 4 call-site measurement, accepted incremental abort coverage per async pipeline, reaffirmed Stage 3 helper extraction after Stage 2A, updated the implementation plan's next step to source evidence helper extraction, and requested Claude review of the closure | `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/decisions.md`, `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-11 | Codex | Completed Stage 2A Tracer 3c-3: moved Stage 4 Guardian verification scheduling into `chat/table-pipeline.mjs`, injected `checkGroundednessFn`, `emitVerificationDone`, and `scheduleImmediateFn`, removed the `shellOnly` continuation from `main.mjs`, made the table branch return `runTableConversationPipeline` directly, kept the default IPC return trimmed to `{ conversationId, messageId, hasTable, tableId }`, added RED/GREEN coverage for Guardian scheduling/verification update/`CHAT_VERIFICATION_DONE` and `shellOnly` removal, resolved validation-agent P2 by making internal pipeline context opt-in through `includePipelineContext: true`, recorded D9 measurements (`main.mjs` 3636 -> 3569 lines, `table-pipeline.mjs` 1258 -> 1352 lines, `table-pipeline.test.mjs` 1398 -> 1483 lines), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker re-review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3c-2: moved final table persistence and `extractionMetadata` assembly into `chat/table-pipeline.mjs`, kept Stage 4 Guardian in `main.mjs` as the remaining `shellOnly` continuation, added helper DI for `cleanCellValue`, source evidence serialization, and source-ref enrichment, added RED/GREEN persistence coverage for insert order, metadata fields, source refs, `CHAT_COMPLETE`, and cleaned cell values, promoted D20 PowerShell encoding guardrail, recorded D9 measurements (`main.mjs` 3734 -> 3636 lines, `table-pipeline.mjs` 1098 -> 1258 lines, `table-pipeline.test.mjs` 1288 -> 1398 lines), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3c-1: moved Stage 3d Agentic NULL Recovery orchestration into `chat/table-pipeline.mjs` while keeping recovery helpers dependency-injected from `main.mjs`, removed `runAgenticNullRecovery` and the Stage 3d flow block from `main.mjs`, returned recovered `tableJson`, `nullSummary`, `agenticRecovery`, `ragResults`, and `evidenceLocationsByPaper` through the shell continuation, added RED/GREEN coverage for Stage 3d recovery success, single-call fallback skip, fail-soft recovery, and Stage 3d abort before shell continuation/persistence, recorded D9 measurements (`main.mjs` 3941 -> 3734 lines, `table-pipeline.mjs` 741 -> 1098 lines, `table-pipeline.test.mjs` 1007 -> 1288 lines), restored `main.mjs` from the UTF-8 HEAD source after a PowerShell rewrite corrupted Korean literals, and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3b-3-3: moved Stage 3c merge/fallback into `chat/table-pipeline.mjs` as `runStage3cMergeFallback`, passed merge/fallback helpers by dependency injection, returned `tableJson`, `nullSummary`, `extractionMode`, `agenticRecovery`, and `tableSpecAdherence` to `main.mjs` for Stage 3d continuation, added RED/GREEN coverage for merge success, all-fail single-call fallback, merged-empty fallback diagnostics, and fallback-generation abort before normalization, recorded D9 measurements (`main.mjs` 3972 -> 3941 lines, `table-pipeline.mjs` 638 -> 741 lines, `table-pipeline.test.mjs` 677 -> 1007 lines), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3b-3-2: moved Stage 3b per-paper extraction into `chat/table-pipeline.mjs` as `runPerPaperExtraction`, passed `assemblePerPaperContext`, `extractColumnsFromPaper`, and `sanitizeColumnNames` by dependency injection, returned `tableSpec`, `extractionResults`, `extractionFallbackNeeded`, and `stage3bMs` to `main.mjs` for Stage 3c continuation, added RED/GREEN coverage for successful per-paper extraction plus parent abort during extraction, recorded D9 measurements (`main.mjs` 4083 -> 3972 lines, `table-pipeline.mjs` 477 -> 638 lines, `table-pipeline.test.mjs` 521 -> 677 lines), and verified `node --check`, desktop tests, desktop build, `git diff --check`, and validation-agent no-blocker review | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3b-3-1: accepted D19 with a circular-import safety correction, added Stage 3a parsing regression coverage for code parser success plus LLM fallback, moved OCR table parsing into `chat/table-pipeline.mjs`, returned `figuresByPaper`, `chunksByPaper`, `allPaperIds`, and `parsedMatrices` to `main.mjs` for Stage 3b continuation, fixed the validation agent's P1 `allPaperIds` continuation finding, recorded D9 measurements (`main.mjs` 4174 -> 4083 lines, `table-pipeline.mjs` 353 -> 477 lines, helper references 10 -> 8), and verified `node --check`, desktop tests, desktop build, and `git diff --check` | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3b-2: accepted D17/D18, added clarify guardrail regression coverage, moved table Stage 2 RAG/no-data handling and Stage 2b paper metadata/table-figure backfill into `chat/table-pipeline.mjs`, made folder-scope filtering pipeline-owned through injected helpers, returned `ragResults`, `paperMetadata`, `paperRefMap`, and `evidenceLocationsByPaper` to `main.mjs` for Stage 3a continuation, recorded D9 measurements (`main.mjs` 4249 -> 4174 lines, `table-pipeline.mjs` 174 -> 353 lines, helper references 11 -> 10), and verified `node --check`, desktop tests, and desktop build | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3b-1: moved table setup context loading, Stage 1 orchestrator invocation, clarify guardrail, and clarify response persistence/streaming into `chat/table-pipeline.mjs`; wired `main.mjs` through the shell without recomputing setup/orchestrator work by continuing Stage 2+ only when `shellOnly: true`; added desktop tests for setup context and clarify handling; recorded D14-D16; verified `node --check`, desktop tests, desktop build, and `git diff --check` | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-10 | Codex | Completed Stage 2A Tracer 3a: added `runTableConversationPipeline({...})` as a shell in `chat/table-pipeline.mjs`, added a chat-flow abort regression with recording fake Supabase and injected orchestrator/RAG dependencies, confirmed abort after orchestration prevents RAG, assistant message persistence, generated table persistence, and completion emission, closed Q12 as D13 with frontend Vitest mocks plus desktop dependency injection, left Q13 deferred, verified `node --check`, desktop tests, and desktop build, sent Claude a review request before moving real table branch code, and resolved validation P3 follow-ups by fixing the shell status text and clarifying that the test covers only the orchestrator abort seam until Tracer 3b wires RAG/persistence | `apps/desktop/electron/chat/table-pipeline.mjs`, `apps/desktop/tests/table-pipeline.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `docs/agents/codex-claude/decisions.md`, `docs/agents/codex-claude/open-questions.md`, `AGENTS.md` |
| 2026-05-09 | Codex | Asked Claude to draft the next Stage 2A work composition before Codex starts another code-moving slice, including proposed scope, `runTableConversationPipeline` interface, state ownership split, first abort regression, Q12/Q13 handling, implementation order, verification commands, and stop risks | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-09 | Codex | Added a consolidated Claude review request for the completed Stage 2A status-event and abort-guard tracers, asking whether to proceed to `runTableConversationPipeline` shell extraction or add another safety tracer first | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-09 | Codex | Completed the Stage 2A abort persistence guard tracer with TDD: added a failing desktop test for `chat/abort-guards.mjs`, implemented `createChatAbortError` and `throwIfChatAborted`, inserted delayed-abort guards after RAG/orchestrator/generation boundaries and before QA/table final persistence starts, documented the non-transactional persistence limit, verified `node --check`, desktop tests, and desktop build, and sent Claude a review request before larger table pipeline extraction | `apps/desktop/electron/chat/abort-guards.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-09 | Codex | Completed the first Stage 2A tracer bullet with TDD: added a failing desktop test for `chat/status-events.mjs`, implemented `createChatStatusPayload` and `createChatStatusEmitter`, rewired `main.mjs` QA/table `CHAT_STATUS` sends through `emitStatus(...)`, recorded D9 measurements (`main.mjs` 4321 -> 4317 lines, direct `IPC_EVENTS.CHAT_STATUS` references 12 -> 0), verified `node --check`, desktop tests, and desktop build, and sent Claude a review request before larger table pipeline extraction | `apps/desktop/electron/chat/status-events.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Applied Pre-Stage 2A readiness reinforcements from Claude S12-S16: expanded the Stage 1 mutable-state table, clarified RAG abort no-persistence expectations, added R21-R25 regression scenarios, strengthened ADR 0003/0004 test gates and Stage 3d metadata fixture expectations, fixed `ChatStatusEvent.stage` to allow `null`, added an `apps/desktop` Node test script plus IPC channel placeholder test, verified the desktop dry-run passes with approved escalation, sent Claude a follow-up review request, and resolved the validation agent's two P3 wording follow-ups | `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`, `docs/harness/decisions/0004-chat-pipeline-contract.md`, `docs/agents/codex-claude/open-questions.md`, `frontend/src/types/desktop.ts`, `apps/desktop/package.json`, `apps/desktop/tests/desktop-placeholder.test.mjs`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Completed Stage 1 chat/table pipeline state audit: mapped shared `CHAT_SEND_MESSAGE` setup, QA branch, table branch, mutable state ownership, status/event contract, abort cleanup behavior, 20 regression scenarios, and extraction targets; added ADR 0004 to define the future chat pipeline contract and called out pre-Stage 2A risks around `runMultiQueryRag` abort propagation, Stage 3d fail-soft abort behavior, `CHAT_STATUS stage: null` typing, and post-completion Guardian verification | `docs/harness/detail/electron/chat-table-pipeline-state.md`, `docs/harness/decisions/0004-chat-pipeline-contract.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Strengthened the Stage 0.5 Claude review request by spelling out the exact search-scope fixture, why the pure `searchModel` test is an appropriate tracer-bullet bootstrap, what ADR 0003 gates before Stage 2A, and the review questions Claude should answer about Electron/IPC proximity, LLM mock, Supabase fixture, abort helper, supplementary `source_file_id`, authenticated scope, and Stage 3d metadata preservation | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Completed Stage 0.5 test infrastructure bootstrap: added the first frontend Vitest characterization test for direct folder-scoped search membership, documented the targeted command and future Electron/preload contract, LLM mock, Supabase fixture, and abort-helper strategy in ADR 0003, verified the target test passes with approved escalation after the default sandbox hit Vite/esbuild `spawn EPERM`, and sent Claude a review request for the new test gate | `frontend/src/features/search/searchModel.test.ts`, `docs/harness/decisions/0003-test-infrastructure-bootstrap.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Applied Claude's Stage 0 reinforcement suggestions inline: expanded the glossary with missing retrieval/table/agent terms, added ADR 0001 D9/D10 compliance language, added ADR 0002 D8 mapping plus DB whitelist ownership and whitelist migration path, clarified Stage -1 branch hygiene details for `entity_extraction_model` and frontend type union conflict resolution, marked Q9/Q11 answered, and sent Claude a follow-up review request | `docs/harness/main/glossary.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/decisions/0002-module-ownership.md`, `docs/features/proposals/2026-05-08-branch-hygiene-analysis.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Completed Stage 0 docs-only architecture context work: added `CONTEXT.md` as a thin index, created the canonical Redou glossary at `docs/harness/main/glossary.md`, added ADR 0001 for the debuggable module split, added ADR 0002 for module ownership and `main.mjs` boundaries, linked the new docs from `AGENTS.md`, and sent Claude a review request for terminology, ADR placement, and whether the Stage 0 docs satisfy D6/D8 before runtime refactor | `CONTEXT.md`, `docs/harness/main/glossary.md`, `docs/harness/decisions/0001-debuggable-module-split.md`, `docs/harness/decisions/0002-module-ownership.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Verified `lessons-to-skill` structure and improved trigger coverage by adding Korean trigger phrases such as "실수 저장", "교훈으로 남겨", "다음부터 안 틀리게", "기억해", and "방지 규칙으로 만들어" to the skill description, so it is more likely to trigger for the user's natural Korean phrasing after Codex reloads project skills | `.agents/skills/lessons-to-skill/SKILL.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Added the user-approved `lessons-to-skill` project skill, inspired by the Ouroboros Interview -> Seed -> Execute -> Evaluate -> Evolve loop, so repeated mistakes, missing checks, and workflow lessons can be converted into small reusable guardrails, docs updates, decisions, open questions, or skill patches; updated the Skill Policy to allow this custom skill only for mistake/lesson capture and not as authorization for runtime code changes | `.agents/skills/lessons-to-skill/SKILL.md`, `AGENTS.md` |
| 2026-05-08 | Codex | Completed Stage -1 branch hygiene analysis without running a real merge: measured local HEAD `76401b1`, `origin/main` `3799fd2`, merge base `f8dec9c`, `main.mjs` at 4,321 lines with 30 direct IPC registrations and 21 direct imports, and 24 merge-tree conflict files against `origin/main`; recommended continuing Stage 0 docs-only work now while deferring runtime refactor until integration branch cleanup or explicit user approval | `docs/features/proposals/2026-05-08-branch-hygiene-analysis.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Reflected Claude's S1-S6 implementation-plan review into the architecture/debuggability implementation plan: Stage 3 now updates all source-evidence callers and forbids duplicate formatter logic, each refactor stage records D9 KPI baseline/current values, code-changing stages start with designated code-writing agent availability checks, Stage 1 now requires mutable-state/abort-cleanup/regression-scenario deliverables, later extraction stages include D8 `main.mjs` scope checks, and Stage 0 has a 0a/0b escape hatch; also cleaned up `open-questions.md` and added Q9/Q10 for user decisions | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `docs/agents/codex-claude/open-questions.md`, `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Added a Codex-to-Claude review request for the architecture/debuggability implementation plan, asking Claude to review blocking risks, D4-D12 alignment, stage ordering, verification realism, backend/frontend separation, and any user-decision items before Stage -1 begins | `docs/agents/codex-claude/codex-to-claude.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Created the concrete architecture/debuggability implementation plan that turns the v2 review and Codex-Claude D4-D12 decisions into executable slices: Stage -1 branch hygiene analysis, Stage 0 domain context/ADRs, Stage 0.5 test bootstrap, Stage 1 chat/table state audit, Stage 2A chat extraction, Stage 2B PaperDetail split, Stage 3 source evidence/Stage 3d helper extraction, Stage 4 repository split, and Stage 5 import/processing extraction, each with write scope, tasks, acceptance criteria, verification commands, and stop points | `docs/features/fix/12-architecture-debuggability-implementation-plan.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Rewrote the architecture/debuggability review as v2 by accepting the core Claude annotations, correcting the merge-tree conflict count to 24 files, adding Stage -1 branch hygiene, Stage 0.5 test infrastructure bootstrap, state/order/abort audit gates, adjusted stage ordering, and a Codex-Claude file exchange workflow with inbox, open-question, and decision files; also updated `AGENTS.md` and `CLAUDE.md` to require the shared exchange folder for cross-agent review instead of long unresolved inline proposal comments | `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`, `docs/agents/codex-claude/**`, `AGENTS.md`, `CLAUDE.md` |
| 2026-05-07 | Codex | Created an architecture/debuggability review proposal that ranks the largest structural risks, identifies deepening opportunities for Electron runtime, chat/table pipeline, Paper detail UI, repository organization, tests, and domain docs, and recommends a staged cleanup order starting with context/ADR and pure helper tests | `docs/features/proposals/2026-05-07-architecture-debuggability-review.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Added `Redou Spec Loop` as a workflow document, not an active skill: it composes Matt Pocock skills with Ouroboros-inspired clarify/seed/slice/build/verify/evolve gates, ambiguity scoring, Redou-specific source-trust checks, and default command flows while preserving the Matt Pocock-only active skill policy | `docs/agents/redou-spec-loop.md`, `AGENTS.md` |
| 2026-05-07 | Codex | Restricted Redou project-local skills to Matt Pocock usage: added a Skill Policy to `AGENTS.md`, moved non-Matt `karpathy-guidelines` from `.agents/skills` to `.agents/skills.disabled`, and verified the active `.agents/skills` list no longer includes the Karpathy skill | `.agents/skills.disabled/karpathy-guidelines/**`, `AGENTS.md` |
| 2026-05-06 | Codex | Implemented G3 supplementary source labels: RAG RPCs now return source file metadata, Q&A and table RAG context labels distinguish `Main PDF` and `Supplementary`, final Q&A source lines/table refs/CSV export preserve evidence locations, Stage 3d recovered evidence is merged into source labels when applied, the local DB migration was applied without reset, builds and smoke checks passed, and the verification agent confirmed no blocking issue remains | `supabase/migrations/20260506010000_add_rag_source_file_metadata.sql`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/llm-qa.mjs`, `frontend/src/types/chat.ts`, `frontend/src/features/chat/ChatTableReport.tsx`, `docs/goals/2026-05-05-research-os-goal.md`, `docs/features/new/10-supplementary-files.md`, `AGENTS.md` |
| 2026-05-06 | Codex | Runtime-verified G2 supplementary PDF attach in Electron: selected the actual Redou renderer window with `window.redouDesktop`, confirmed the PDF side panel renders `SUPPLEMENTARY PDFS (0)` and `Supplementary PDF 추가`, copied test PDF `01-valid.pdf` through the Electron file import bridge, inserted a `supplementary_pdf` non-primary `paper_files` row and queued `import_pdf` job with matching `source_file_id`, confirmed the primary source job stayed `succeeded` and primary sections/chunks stayed `21/51`, then removed the copied test file and DB rows so no queued/running jobs or runtime test artifacts remained | `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Implemented G2 supplementary PDF attach with minimal frontend/repository changes: Paper Detail PDF sidebar now lists supplementary PDFs and attaches one PDF at a time; repository inserts `paper_files.file_kind = 'supplementary_pdf'` with `is_primary = false`, queues the existing `import_pdf` job with `source_file_id`, cleans up copied files/rows/jobs on attach failure, and keeps paper processing status tied to the primary source so supplementary jobs do not hide the main PDF reader. QA subagent found no blocking issues; `frontend` build, `apps/desktop` build, and `git diff --check` passed | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/types/paper.ts`, `docs/goals/2026-05-05-research-os-goal.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Created the Research OS goal plan using the project-local `plan` and `karpathy-guidelines` skills plus three subagents, integrated findings for G1 table-spec guard, G2 supplementary attach, and G4 Research Goal MVP, then implemented and verified G1: single-call fallback output is normalized or blocked against `tableSpec.column_definitions`, with `tableSpecAdherence` diagnostics recorded in metadata | `docs/goals/2026-05-05-research-os-goal.md`, `apps/desktop/electron/main.mjs`, `AGENTS.md` |
| 2026-05-05 | Codex | Verified the Stage 3d single-call fallback metadata fix: `node --check` and `apps/desktop` build passed; scoped fallback runtime table `6b62d202-5c2c-4ab1-a535-3092b7245c64` stored `nullSummary: null`, `agenticRecovery.skippedReason: "single_call_fallback"`, and zero before/after recovery counters; temporary folder membership was removed and the user LLM preference was restored to `gemma4:31b` | `apps/desktop/electron/main.mjs`, `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Applied a minimal Stage 3d metadata fix for single-call fallback: fallback now records `skippedReason: "single_call_fallback"` in `agenticRecovery` and clears stale per-paper `nullSummary` so fallback tables do not persist misleading per-paper NULL counters with `agenticRecovery: null` | `apps/desktop/electron/main.mjs`, `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Ran Stage 3d Electron IPC runtime checks with the existing authenticated session: observed a real `researching` Stage 3d path on generated table `787dc23d-b697-4842-9aec-4caf30c8cee4`, confirmed recovery metadata was written, confirmed an abort run saved no generated table, restored the user's LLM model preference to `gemma4:31b`, and documented that V1/V2 remain pending because metadata-only prompts still take the full slow table pipeline | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Executed Stage 3d V0 static verification: `node --check` passed for `apps/desktop/electron/main.mjs` and `apps/desktop/electron/llm-orchestrator.mjs`, `cmd /c npm run build` passed in both `frontend` and `apps/desktop`, and recorded the result while noting the existing frontend chunk-size warning | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Created the Stage 3d runtime verification plan before integration, splitting checks into V0 static health, V1 gate-not-met, V2 no-new-context, V3 high-confidence recovery, V4 low-confidence ignore, and V5 abort/timeout safety, with explicit blockers and minimal-fix ownership | `docs/features/fix/10-stage-3d-runtime-verification.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Created the Option B+ pre-merge preservation audit, naming the exact security/RLS, supplementary source tracking, Stage 3d, V2-only pipeline, and entity graph files/functions/migrations that must survive the later merge; also recorded conflict-resolution order and validation checks | `docs/features/proposals/2026-05-05-pre-merge-preservation-audit.md`, `AGENTS.md` |
| 2026-05-05 | Codex | Created a 2026-05-05 integration strategy update after checkpointing and pushing `1637751`, re-ran merge-tree against `origin/main`, confirmed the 22 conflict files still hold, and upgraded the recommendation from Option B to Option B+ with explicit preservation audit guardrails for security fixes, supplementary source tracking, Stage 3d, and entity graph integration | `docs/features/proposals/2026-05-05-integration-strategy-update.md`, `AGENTS.md` |
| 2026-05-04 | Codex | Uploaded the reusable Codex skills package to `https://github.com/huckwnmo99/Skills` on `main` with commit `affe12f`, verified the remote `skills` directory contains 29 skill folders, and left the Redou-local export copy in `docs/exports/Skills` | external repo `huckwnmo99/Skills`, `AGENTS.md` |
| 2026-05-04 | Codex | Prepared a reusable GitHub skills repository package under `docs/exports/Skills`, copied the project-local skills into `skills/<skill-name>/SKILL.md`, and added README install instructions for global Codex, project-local Codex, and single-skill reuse | `docs/exports/Skills/**`, `AGENTS.md` |
| 2026-05-04 | Codex | Applied a minimal Redou Style cleanup to the PDF import dialog by replacing developer-facing pipeline copy, hiding full source paths and internal queue IDs, and keeping the existing import, result, and job-status logic unchanged | `frontend/src/features/import/ImportPdfDialog.tsx`, `AGENTS.md` |
| 2026-05-04 | Codex | Downloaded `VoltAgent/awesome-design-md` as a project-local design reference under `docs/reference/awesome-design-md`, removed its nested `.git` metadata, and left it as standalone Markdown reference material for future UI work | `docs/reference/awesome-design-md/**`, `AGENTS.md` |
| 2026-05-04 | Codex | Used parallel subagents to plan the next supplementary implementation slices and updated the feature plan with the locked order: supplementary PDF attach first, RAG/source attribution labels second, DOCX/DOC to PDF conversion third | `docs/features/new/10-supplementary-files.md`, `AGENTS.md` |
| 2026-05-04 | Codex | Implemented the first supplementary prerequisite slice: added source-file tracking/backfill migration for sections, chunks, and processing jobs; applied it to local Supabase without reset; changed Electron extraction persistence to delete/insert by `source_file_id`; made import jobs resolve the actual paper file instead of always primary; queued embeddings per source file; and passed the new source file id from the frontend main-PDF import path | `supabase/migrations/20260504010000_add_supplementary_source_tracking.sql`, `apps/desktop/electron/main.mjs`, `frontend/src/lib/supabasePaperRepository.ts`, `AGENTS.md` |
| 2026-05-04 | Codex | Installed project-local Codex skills from `forrestchang/andrej-karpathy-skills` and `mattpocock/skills`, including the Karpathy guideline skill plus Matt Pocock engineering, productivity, misc, personal, and deprecated skill folders with `SKILL.md` files | `.agents/skills/**`, `AGENTS.md` |
| 2026-05-04 | Codex | Planned supplementary file support with source-scoped extraction, PDF-first ingestion, DOCX-to-PDF conversion as a later slice, and RAG/source attribution labels that keep paper citations as `[N]` while marking supplementary evidence in the source line | `docs/features/new/10-supplementary-files.md`, `AGENTS.md` |
| 2026-05-03 | Codex | Fixed critical review findings in small slices: chat user scoping/RLS, Electron detached-window and `redou-file` bounds, import-only PDF readiness, per-user LLM preference persistence, opt-in CrossRef DOI lookup, default highlight presets, guarded preset deletion, text fallback for tables/equations, orphan PDF cleanup, first-chat abort ID sync, validation follow-up for constrained file deletion, per-request LLM preference application, and generated-table RLS message/conversation consistency | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/preload.mjs`, `frontend/src/lib/chatQueries.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabaseAuthRepository.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/search/searchModel.ts`, `frontend/src/types/desktop.ts`, `supabase/migrations/20260503010000_secure_chat_tables.sql`, `AGENTS.md` |
| 2026-03-09 | Main | Initial project analysis and first shared context document | `AGENTS.md` |
| 2026-03-09 | Main | Local Supabase setup, initial schema migration, seed data, and IPC implementation | `supabase/**`, `apps/desktop/electron/**`, `apps/desktop/src/types/**`, `apps/desktop/package.json`, `AGENTS.md` |
| 2026-03-09 | Codex | Frontend baseline created and expanded with library, search, notes, figures, settings, paper detail, nested folders, and workspace flows | `frontend/**`, `AGENTS.md` |
| 2026-03-09 | Main | `frontend` auth switched from local mock auth to Supabase auth adapter | `frontend/src/lib/auth.ts`, `frontend/src/lib/supabase.ts`, `frontend/src/lib/supabaseAuthRepository.ts`, `frontend/package.json`, `supabase/seed.sql` |
| 2026-03-09 | Codex | Shared docs recovered, frontend dev/preview port standardized to `4173`, and Electron updated to prefer the `frontend` renderer | `AGENTS.md`, `README.md`, `apps/desktop/README.md`, `apps/desktop/electron/main.mjs`, `frontend/vite.config.ts` |
| 2026-03-09 | Main | Mock paper/folder/note repositories replaced with Supabase adapters; seed notes added | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/queries.ts`, `supabase/seed.sql`, `AGENTS.md` |
| 2026-03-09 | Codex | Auth screen visual polish: upgraded the login/register layout, copy, and demo access presentation to match the frontend product baseline | `frontend/src/features/auth/AuthView.tsx`, `AGENTS.md` |
| 2026-03-09 | Codex | Added a safe frontend desktop bridge and surfaced real Electron runtime, file dialog, backup, and Explorer actions in settings/auth | `frontend/src/lib/desktop.ts`, `frontend/src/types/desktop.ts`, `frontend/src/features/settings/SettingsView.tsx`, `frontend/src/features/auth/AuthView.tsx`, `AGENTS.md` |
| 2026-03-09 | Codex | Started Phase 3 with the first import slice: Add Paper now opens an import dialog and creates paper, file, and queued processing job records from selected PDFs | `frontend/src/app/TopBar.tsx`, `frontend/src/features/import/ImportPdfDialog.tsx`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/types/paper.ts`, `AGENTS.md` |
| 2026-03-09 | Codex | Continued Phase 3 with processing-state surfaces across library, paper detail, and inspector so imported papers expose queued, running, failed, and ready states | `frontend/src/components/ProcessingBadge.tsx`, `frontend/src/types/paper.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/library/PaperCard.tsx`, `frontend/src/features/library/PaperListItem.tsx`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/app/RightInspector.tsx`, `AGENTS.md` |
| 2026-03-09 | Codex | Continued Phase 3 with the first Electron queue consumer and live renderer refresh for processing jobs | `apps/desktop/electron/main.mjs`, `frontend/src/lib/desktop.ts`, `frontend/src/app/AppShell.tsx`, `frontend/src/types/desktop.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Continued Phase 3 by turning the PDF tab into a desktop reader entry backed by primary `paper_files`, resolved desktop paths, and system file actions | `frontend/src/types/paper.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/types/desktop.ts`, `apps/desktop/electron/types/ipc-channels.mjs`, `apps/desktop/electron/preload.mjs`, `apps/desktop/electron/main.mjs`, `AGENTS.md` |
| 2026-03-10 | Codex | Reviewed another agent's error concerns for the reader entry, accepted the browser-preview desktop-action issue, fixed it, and confirmed PDF.js/anchor support was still intentionally deferred at that point | `frontend/src/features/paper/PaperDetailView.tsx`, `AGENTS.md` |
| 2026-03-10 | Codex | Installed `pdfjs-dist` and replaced the file-based PDF tab with a basic PDF.js workspace including canvas rendering, page navigation, zoom, and desktop fallback actions | `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/features/paper/PdfReaderWorkspace.tsx`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/types/paper.ts`, `frontend/src/types/desktop.ts`, `apps/desktop/electron/types/ipc-channels.mjs`, `apps/desktop/electron/preload.mjs`, `apps/desktop/electron/main.mjs`, `AGENTS.md` |
| 2026-03-10 | Codex | Extended the PDF.js workspace with a selectable text layer, current-page anchors, and local selection metadata surfaced in paper detail | `frontend/src/features/paper/PdfReaderWorkspace.tsx`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/types/paper.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Completed Phase 4 slice 1 by persisting PDF.js selection highlights in Supabase and linking notes back to saved PDF source pages from paper detail and the notes workspace | `frontend/src/features/paper/PdfReaderWorkspace.tsx`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/notes/NotesView.tsx`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/queries.ts`, `frontend/src/stores/uiStore.ts`, `frontend/src/types/paper.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Completed Phase 4 slice 2 by adding saved-highlight lifecycle controls: preset switching, note creation from existing highlights, safe deletion, and linked-note save protection | `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/notes/NotesView.tsx`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/lib/queries.ts`, `frontend/src/types/paper.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Applied Claude-agent review fixes for active-scope runtime risks: auth session safety, import cleanup rollback, reader mutation error handling, stale anchor clearing, selection throttling, desktop URL encoding, and Electron IPC/path guards | `frontend/src/lib/auth.ts`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/features/paper/PdfReaderWorkspace.tsx`, `apps/desktop/electron/main.mjs`, `AGENTS.md` |
| 2026-03-10 | Codex | Completed the first Phase 3 extraction slice by adding heuristic PDF extraction in Electron, persisting `paper_sections` / `paper_chunks` / `figures`, invalidating renderer queries on worker events, and surfacing extracted sections and figure captions in paper detail and the inspector | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/pdf-heuristics.mjs`, `frontend/src/lib/desktop.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/app/RightInspector.tsx`, `frontend/src/types/paper.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Connected the global figures workspace and search surfaces to real extracted data from Supabase, including global chunk and figure queries, scoped search grouping, and note/figure navigation from search results | `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/search/SearchView.tsx`, `frontend/src/features/search/SearchSidebar.tsx`, `frontend/src/features/search/searchModel.ts`, `frontend/src/features/figures/FiguresView.tsx`, `AGENTS.md` |
| 2026-03-10 | Codex | Improved extraction quality by switching the Electron helper to PDF.js page-text parsing with heuristic fallback, persisting page-aware section/chunk/figure metadata, and surfacing page hints across paper detail, inspector, search, and global figures | `apps/desktop/electron/pdf-heuristics.mjs`, `apps/desktop/electron/main.mjs`, `frontend/src/features/paper/PaperDetailView.tsx`, `frontend/src/app/RightInspector.tsx`, `frontend/src/features/figures/FiguresView.tsx`, `AGENTS.md` |
| 2026-03-10 | Codex | Hardened the desktop-side PDF.js dependency story by declaring `pdfjs-dist` in `apps/desktop`, preferring the local desktop install in the extraction helper, and re-verifying the frontend build plus Electron syntax checks | `apps/desktop/package.json`, `apps/desktop/electron/pdf-heuristics.mjs`, `AGENTS.md` |
| 2026-03-10 | Codex | Installed `apps/desktop` dependencies, verified the desktop build, and confirmed the local desktop `pdfjs-dist` path now exists for the extraction helper | `apps/desktop/package-lock.json`, `apps/desktop/package.json`, `apps/desktop/node_modules/**`, `AGENTS.md` |
| 2026-03-10 | Codex | Verified desktop runtime launch by adding a safe renderer fallback from the unavailable dev URL to `frontend/dist`, then re-checking the Electron build and live `Redou` window launch | `apps/desktop/electron/main.mjs`, `apps/desktop/.electron-runtime.log`, `AGENTS.md` |
| 2026-03-10 | Codex | Documented the current reliable run path, optional live renderer mode, and local auth seed across the root, desktop, and frontend README files | `README.md`, `apps/desktop/README.md`, `frontend/README.md`, `AGENTS.md` |
| 2026-03-10 | Codex | Added a user-selectable Korean display mode in Settings and translated the core shell so the workspace is readable in Korean while still tolerating partial English in deeper surfaces | `frontend/src/lib/locale.ts`, `frontend/src/stores/uiStore.ts`, `frontend/src/App.tsx`, `frontend/src/app/LeftSidebar.tsx`, `frontend/src/app/TopBar.tsx`, `frontend/src/features/settings/SettingsView.tsx`, `frontend/src/features/library/LibraryView.tsx`, `frontend/src/features/search/SearchSidebar.tsx`, `frontend/src/features/search/SearchView.tsx`, `frontend/src/features/figures/FiguresView.tsx`, `AGENTS.md` |
| 2026-03-10 | Codex | Removed demo auth/sample seed exposure, simplified the auth entry screen, added a Google sign-in entry point, bootstrapped real user workspace rows/presets, replaced sample search hints, and reset local Supabase to a clean first-user state | `frontend/src/features/auth/AuthView.tsx`, `frontend/src/lib/auth.ts`, `frontend/src/lib/supabaseAuthRepository.ts`, `frontend/src/features/search/SearchView.tsx`, `frontend/src/mock/repository/authRepository.ts`, `README.md`, `frontend/README.md`, `supabase/config.toml`, `supabase/seed.sql`, `AGENTS.md` |
| 2026-03-10 | Codex | Hardened Supabase auth recovery by switching to a dedicated storage key, purging legacy auth tokens, and clearing stale refresh-token state after local DB resets | `frontend/src/lib/supabase.ts`, `frontend/src/lib/supabaseAuthRepository.ts`, `AGENTS.md` |
| 2026-03-10 | Codex | Forced the auth intro panel copy into English while leaving the right-side login form and behavior unchanged | `frontend/src/features/auth/AuthView.tsx`, `AGENTS.md` |
| 2026-03-11 | Codex | Fixed imported-paper scope and ingestion quality: folder views now show direct membership only, Add Paper inspects PDFs for cleaner pre-import metadata, the desktop worker now upgrades filename-like titles from extracted document titles, and the current locally imported paper was reprocessed with the improved heuristic | `frontend/src/lib/supabasePaperRepository.ts`, `frontend/src/features/search/searchModel.ts`, `frontend/src/features/import/ImportPdfDialog.tsx`, `frontend/src/lib/desktop.ts`, `frontend/src/types/desktop.ts`, `apps/desktop/electron/preload.mjs`, `apps/desktop/electron/types/ipc-channels.mjs`, `apps/desktop/electron/main.mjs`, `apps/desktop/electron/pdf-heuristics.mjs`, `AGENTS.md` |
| 2026-03-11 | Codex | Added drag-and-drop paper movement from library cards/list rows into folder-tree targets, backed by a folder-move mutation so dropped papers switch folders instead of duplicating across many folders | frontend/src/features/library/drag.ts, frontend/src/features/library/PaperCard.tsx, frontend/src/features/library/PaperListItem.tsx, frontend/src/features/library/CategoryTree.tsx, frontend/src/lib/queries.ts, frontend/src/lib/supabasePaperRepository.ts, AGENTS.md |
| 2026-04-15 | Codex | Rebuilt the first lecture hero SVG so the left message block, top flow cards, connector arrows, and bottom outputs follow a tighter alignment grid with more consistent typography | `docs/presentation_assets/redou-agent/slide-01-hero-illustration.svg`, `AGENTS.md` |
| 2026-04-15 | Codex | Added separate Q&A mode and Table mode SVG diagrams in the same visual system as the OCR augmentation flow so the two agent branches can be explained independently in class | `docs/presentation_assets/redou-agent/visual-05-qa-mode.svg`, `docs/presentation_assets/redou-agent/visual-06-table-mode.svg`, `AGENTS.md` |
| 2026-04-15 | Codex | Updated the Q&A and Table mode SVGs to show which steps reuse the same active LLM and which step switches to a separate guardian model, using explicit labeled ranges and color-coded badges | `docs/presentation_assets/redou-agent/visual-05-qa-mode.svg`, `docs/presentation_assets/redou-agent/visual-06-table-mode.svg`, `AGENTS.md` |
| 2026-04-16 | Codex | Created a standalone one-page HTML slide that introduces the future ontology and Graph RAG direction as a visual knowledge-graph workflow, including linked concept nodes, relation-based retrieval, and a lecture-friendly summary message | `docs/presentation_assets/redou-agent/redou-ontology-future-slide.html`, `AGENTS.md` |
| 2026-04-16 | Codex | Simplified the ontology and Graph RAG future slide into a diagram-first lecture asset with a larger graph board, short chips, and minimal captions so the flow reads mostly from visuals | `docs/presentation_assets/redou-agent/redou-ontology-future-slide.html`, `AGENTS.md` |
| 2026-04-16 | Codex | Performed a screenshot-based visual pass on the ontology and Graph RAG slide, then reworked the board so the in-graph numbered badges align with the footer steps and the visual flow reads as one connected path | `docs/presentation_assets/redou-agent/redou-ontology-future-slide.html`, `AGENTS.md` |
| 2026-04-21 | Codex | Completed C3-C11 V2-only cleanup: rewrote PDF pipeline harness docs, corrected external service degraded-mode notes, removed requested dead code, guarded GROBID calls by availability, added GLM-OCR timeout, and deleted the stray desktop npm file | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/pdf-heuristics.mjs`, `apps/desktop/electron/ocr-extraction.mjs`, `docs/harness/detail/electron/pdf-pipeline.md`, `docs/harness/detail/electron/main-process.md`, `docs/harness/detail/services/external.md`, `apps/desktop/npm`, `AGENTS.md` |
| 2026-04-22 | Codex | Implemented Stage 3d Agentic NULL Recovery for SRAG table generation, including LLM null-cell recovery helper, paper-scoped recovery search gates, metadata, frontend status stage, and harness docs | `apps/desktop/electron/main.mjs`, `apps/desktop/electron/llm-orchestrator.mjs`, `frontend/src/types/desktop.ts`, `frontend/src/features/chat/ChatPipelineStatus.tsx`, `docs/harness/main/feature-status.md`, `docs/harness/detail/electron/llm.md`, `docs/harness/detail/electron/rag-pipeline.md`, `AGENTS.md` |

---

## 9. Latest Handoff

```md
DONE | Codex - Research OS G2 supplementary PDF attach runtime verified
- Done: Electron runtime loaded the actual Redou renderer with `window.redouDesktop`.
- UI verified: PDF side panel renders `SUPPLEMENTARY PDFS (0)` and `Supplementary PDF 추가`.
- Runtime verified: Electron bridge copied `01-valid.pdf`, created `paper_files.file_kind = "supplementary_pdf"` with `is_primary = false`, and queued `processing_jobs.job_type = "import_pdf"` with matching `source_file_id`.
- Guard verified: latest paper-level import job was the supplementary queued job, while the primary source job remained `succeeded`.
- Data verified: primary sections/chunks stayed `21/51`; copied runtime test file and DB rows were removed; queued/running jobs are zero.
- Next: commit this verification note, then continue G3 source labels so `[N] Supplementary` evidence is visible in answers.
```

## 10. Known Issues & Potential Bugs

> **DO NOT DELETE THIS SECTION.** This section was created at the project owner's explicit request for code review documentation. Agents must resolve issues listed here rather than removing them. When an issue is fixed, mark it `RESOLVED` with the date and agent name ??do not delete the entry. If you believe an entry is wrong, add a `DISPUTED` note with your reasoning below it.

### Severity Guide

- **CRITICAL**: Will crash or corrupt data at runtime.
- **HIGH**: Incorrect behavior that users will hit in normal use.
- **MEDIUM**: Edge-case bugs, performance risks, or security gaps.
- **LOW**: Code quality, maintainability, or minor UX concerns.

---

### A. Data Layer ??`frontend/src/lib/supabasePaperRepository.ts` / `frontend/src/lib/paperRepository/mappers.ts`

**A-1 (MEDIUM) ??`DB_TO_KIND` / `KIND_TO_DB` mapping is lossy** (`frontend/src/lib/paperRepository/mappers.ts`)
Multiple DB types map to the same frontend kind (`presentation_note` ??`insight`, `result_note` ??`summary`, `custom` ??`summary`). Round-tripping through create ??update silently changes `note_type`. No `custom` kind exists on the frontend, so custom notes can never be created or preserved.

**A-2 (MEDIUM) ??`fetchPaperSignals()` fetches ALL rows from `notes`, `figures`, and `processing_jobs` every time** (`frontend/src/lib/paperRepository/paperSignals.ts`)
Called on every paper list/detail query. With hundreds of papers this becomes an N-row full-table scan 횞 3 on each navigation. Should use aggregate queries (`count`) or per-paper joins instead.

**A-3 (HIGH) - `currentUserId()` falls back to hardcoded seed UUID - RESOLVED 2026-03-10 Codex**
Fixed by throwing when the auth session is missing or unreadable, so writes no longer fall through to the seed user.

**A-4 (HIGH) - `createImportedPaper()` has no transaction - RESOLVED 2026-03-10 Codex**
Fixed with compensating cleanup: if a later import step fails, the newly-created paper row is deleted so incomplete imports do not linger. This flow is still multi-statement, but it no longer leaves orphan paper records behind on normal failures.

**A-5 (LOW) ??`authors: []` always hardcoded** (line 246)
The `papers` table has no `authors` join table, so the frontend always shows empty authors. The schema has no `paper_authors` table ??this is a schema gap, not just a frontend issue.

**A-6 (LOW) ??`citationCount: 0` always hardcoded** (line 255)
No column or table stores citation counts. Metadata enrichment will need a schema change.

**A-7 (MEDIUM) ??`reading_status` cast is unchecked** (line 251)
`row.reading_status as Paper["status"]` trusts the DB value without validation. If the enum is extended or a migration adds a new value, the frontend will pass it through silently and could break conditional rendering.

**A-8 (MEDIUM) ??`paper_folders?.[0]?.folder_id` only returns first folder** (line 256)
Papers can belong to multiple folders. The UI only shows one `folderId`, so folder membership is lossy in the frontend model.

**A-9 (MEDIUM) ??JSONB `.contains()` query reliability for dedup** (lines 478-488)
`findExistingHighlight` uses `.contains("start_anchor", { anchorId: selection.anchorId })` to match highlights. Supabase JSONB `@>` containment works, but the `anchorId` is generated client-side from `paper:${paperId}:page:${pageNumber}` ??two selections on the same page with different text will share the same `anchorId`. The dedup also checks `selected_text` equality (line 484), which mitigates this, but the `anchorId` match alone is not unique.

**A-10 (MEDIUM) ??`getDefaultHighlightPresetId()` throws if no active preset** (lines 456-471)
If a user has no active presets (all deactivated or deleted), `createHighlight` and `createNote` with selections will crash with an opaque error. Should create a fallback preset or return a more descriptive error.

---

### B. Build & Type Issues ??`frontend/src/lib/queries.ts`, `frontend/src/types/paper.ts`

**B-1 (CRITICAL) ??`fileKeys` was undefined** ??RESOLVED 2026-03-10 Codex
Fixed by adding `fileKeys` object at line 31.

**B-2 (CRITICAL) ??`PrimaryFileRow` type was undefined** ??RESOLVED 2026-03-10 Codex
Fixed by adding the interface at lines 106-112 of `supabasePaperRepository.ts`.

**B-3 (LOW) ??`useImportDesktopPapers` processes drafts sequentially** (queries.ts lines 156-167)
The for-loop imports PDFs one at a time. For batch imports (10+ files), this creates a long blocking mutation. Could use `Promise.all` with concurrency control.

---

### C. Auth ??`frontend/src/lib/auth.ts`, `frontend/src/lib/supabaseAuthRepository.ts`

**C-1 (MEDIUM) - Module-level `onAuthStateChange` has no cleanup - RESOLVED 2026-03-10 Codex**
Fixed by keeping a single shared auth listener and unsubscribing it during Vite HMR disposal.

**C-2 (LOW) ??`register()` does not handle email confirmation** (supabaseAuthRepository.ts)
Local Supabase has email confirmation disabled, but if it's ever enabled, `register()` will return a session of `null` and the UI will show a blank state with no explanation.

**C-3 (LOW) ??Hardcoded anon key in `supabase.ts`**
The Supabase anon key is committed in source. Acceptable for local-only, but should be in `.env` for future deployment.

---

### D. Electron / IPC ??`apps/desktop/electron/main.mjs`

**D-1 (CRITICAL) - `dialog.showOpenDialog(mainWindow, ...)` null crash - RESOLVED 2026-03-10 Codex**
`mainWindow` can be `null` (after window close on non-macOS, or during startup). If `FILE_SELECT_DIALOG` is invoked while `mainWindow` is null, Electron throws. Should guard with `if (!mainWindow)` or use `BrowserWindow.getFocusedWindow()`.

**D-2 (HIGH) - `DB_QUERY` only supports `select` method - RESOLVED 2026-03-10 Codex**
The handler checks `if (method === "select")` but has no else branch for unsupported methods. Any non-select query silently returns all rows from the table with no filter.

**D-3 (HIGH) - `DB_MUTATE` has no table allowlist - RESOLVED 2026-03-10 Codex**
Any renderer code can insert, update, upsert, or delete from any table (including `auth.users`, `app_users`, etc.) through IPC. This is a privilege escalation path. Should restrict to known tables.

**D-4 (MEDIUM) ??`BACKUP_RESTORE` does not clear existing data first** (main.mjs lines 589-617)
Upsert means existing rows that aren't in the backup remain. A "restore" that is expected to be a clean slate will leave stale data behind.

**D-5 (MEDIUM) ??Processing worker race condition** (main.mjs lines 162-293)
`processingJobInFlight` is a simple boolean guard, but `processNextQueuedJob` is async. If the interval fires while the previous invocation is in the `finally` block (after setting `processingJobInFlight = false` but before the function returns), a second invocation could start. The window is narrow but real under heavy load.

**D-6 (MEDIUM) - `FILE_IMPORT_PDF` / `FILE_DELETE` / `FILE_OPEN_PATH` accept unvalidated paths - RESOLVED 2026-03-10 Codex**
No path validation: `sourcePath`, `storedPath`, `filePath` could be any path on the filesystem. Should restrict to paths under `LIBRARY_ROOT` or at least validate they're absolute and don't escape the library.

**D-7 (LOW) ??`FILE_DELETE` has no usage guard** (main.mjs lines 745-753)
The handler now validates paths with `assertLibraryPath` (D-6 fix), but still deletes without checking whether the file is referenced by other papers. Deleting a shared file breaks other paper entries.

**D-8 (MEDIUM) - Detached window loads legacy dist path - RESOLVED 2026-03-10 Codex**
In packaged mode, detached windows load `../dist/index.html` (the legacy desktop renderer), not the `frontend/dist` path. This will break once the legacy renderer is removed.

**D-9 (HIGH) ??`persistHeuristicExtraction()` has no transaction wrapper** (main.mjs lines 327-435)
The function deletes all existing sections (line 341), chunks (line 331), and figures (line 336) for a paper, then re-inserts new data (lines 348-411). These are separate Supabase calls with no transaction. If any insert fails after the deletes succeed, the paper is left with missing extraction data and no way to recover without re-running the processing job. A partial failure (e.g. chunks insert fails) leaves the paper with sections but no chunks and no figures.

**D-10 (MEDIUM) ??`BACKUP_RESTORE` does not validate `backupPath`** (main.mjs lines 919-947)
The restore handler reads any file path with `fs.readFile(backupPath)` (line 921) without path restriction. Unlike file operations which now use `assertLibraryPath`, the backup restore can read arbitrary files from the filesystem. Should validate that `backupPath` is within the expected backup directory (`~/Documents/Redou/Backups/`).

**D-11 (LOW) ??`BACKUP_RESTORE` upserts ignore errors** (main.mjs lines 936-941)
The restore loop does not check `supabase.from(table).upsert(rows)` for errors. If any table fails to restore, the process continues silently to the next table, leaving the database in a partially restored state with no indication of which tables failed.

**D-12 (LOW) ??`BACKUP_CREATE` uses `err.message` directly** (main.mjs line 906)
Uses `err.message` instead of the project's `getErrorMessage(err)` helper. If a non-Error value is thrown, accessing `.message` on it returns `undefined`, producing an unhelpful error response.

---

### E. PDF.js Workspace ??`frontend/src/features/paper/PdfReaderWorkspace.tsx`

**E-1 (MEDIUM) - `selectionchange` fires on every cursor movement - RESOLVED 2026-03-10 Codex**
The listener calls `onSelectionChange` on every `selectionchange` event (dozens per second while selecting text). No debounce. With complex parent re-renders (React Query invalidation), this can cause layout thrashing.

**E-2 (LOW) ??PDF document not destroyed on component unmount if load is in-flight** (lines 184-249)
The cleanup sets `cancelled = true` and calls `loadingTask.destroy()`, but if the promise already resolved and set `loadedDocument`, there's a double-destroy risk: the cleanup destroys `loadedDocument`, and then `setPdfDocument` in the next render might try to use a destroyed proxy.

**E-3 (LOW) ??`pageProxy.cleanup()` called after render completion** (line 317)
PDF.js `cleanup()` releases internal resources. If the component immediately re-renders the same page (e.g., zoom change), the page must be fetched again. This is correct behavior but could be optimized by caching the page proxy.

**E-4 (MEDIUM) ??Highlight overlay rects are relative to the page container, but canvas size depends on zoom** (lines 494-511)
Highlight rects are stored as normalized 0-1 values relative to the text layer container. If the container size doesn't exactly match the canvas size (rounding from `Math.floor`), overlays will be slightly misaligned at certain zoom levels.

---

### F. Paper Detail & Notes ??`PaperDetailView.tsx`, `NotesView.tsx`

**F-1 (MEDIUM) - No error handling on reader highlight/note actions - RESOLVED 2026-03-10 Codex**
Both use `mutateAsync` but don't catch errors. If `getDefaultHighlightPresetId` throws (no active preset), the promise rejects unhandled. Should use try/catch or `.catch()` with user-facing error feedback.

**F-2 (LOW) ??`highlights.slice(0, 6)` arbitrary limit** (PaperDetailView.tsx line 477)
Only 6 highlights shown in the sidebar with no "show more" or pagination. Users with many highlights lose visibility.

**F-3 (LOW) - `readerTargetAnchor` is not cleared after navigation - RESOLVED 2026-03-10 Codex**
The target anchor persists in Zustand until another action clears it. If the user navigates away and back, the reader will jump to the old anchor again.

**F-4 (LOW) ??Shared mutation pending states disable all highlight controls** (PaperDetailView.tsx lines 813, 838, 846)
`updateHighlight.isPending` and `deleteHighlight.isPending` are hook-level states shared across all rendered highlights. When any single highlight's preset is being changed or any highlight is being deleted, ALL highlight preset dropdowns, link-note buttons, and delete buttons are disabled simultaneously. Should use per-highlight pending tracking (e.g. a `Set<string>` of in-flight highlight IDs).

---

### G. Schema & Seed ??`supabase/migrations/`, `supabase/seed.sql`

**G-1 (MEDIUM) ??No RLS policies on any table**
All tables have no Row-Level Security. Any authenticated user can read/write all data. Acceptable for single-user local mode, but must be addressed before any multi-user or cloud deployment.

**G-2 (LOW) ??No `paper_authors` table**
The schema has no way to store structured author data. `authors` in the frontend is always `[]`.

**G-3 (LOW) ??No folder cycle prevention ??also causes stack overflow in `collectDescendantIds`**
`folders.parent_folder_id` is a self-referencing FK with no check constraint or trigger preventing circular references (A ??B ??A). If a cycle exists, `collectDescendantIds()` in `supabasePaperRepository.ts` (lines 493-503) recurses infinitely and crashes with a stack overflow. Used by `getPapersByFolder()` and `getAllFolders()`.

**G-4 (LOW) ??Seed data has no `is_active` column in highlight_presets insert**
The seed insert (seed.sql lines 306-313) doesn't specify `is_active`, relying on the column default (`true`). This works, but is fragile if the default ever changes.

---

### H. Desktop Bridge ??`frontend/src/lib/desktop.ts`

**H-1 (MEDIUM) - `toDesktopFileUrl()` encoding edge case - RESOLVED 2026-03-10 Codex**
`encodeURI` does not encode `#`, `?`, or `&` characters. Windows file paths with these characters (rare but legal) will produce broken URLs. Should use a more robust encoding or path-to-URL conversion.

**H-2 (LOW) - `useResolvedDesktopFilePath` returns raw `storedPath` in browser mode - RESOLVED 2026-03-10 Codex**
When the desktop API is unavailable, it returns the raw Windows path (e.g., `C:\Users\...`). This path is unusable in browser context and will produce a broken `file:///` URL if passed to `toDesktopFileUrl`.

---

### Summary Table

| ID | Severity | Status | Area |
|----|----------|--------|------|
| A-1 | MEDIUM | OPEN | Data layer ??lossy kind mapping |
| A-2 | MEDIUM | OPEN | Data layer ??full-table signal fetches |
| A-3 | HIGH | RESOLVED | Data layer - hardcoded fallback user |
| A-4 | HIGH | RESOLVED | Data layer - import cleanup rollback |
| A-5 | LOW | OPEN | Data layer ??no authors |
| A-6 | LOW | OPEN | Data layer ??no citation count |
| A-7 | MEDIUM | OPEN | Data layer ??unchecked status cast |
| A-8 | MEDIUM | OPEN | Data layer ??single folder only |
| A-9 | MEDIUM | OPEN | Data layer ??JSONB dedup reliability |
| A-10 | MEDIUM | OPEN | Data layer ??preset required |
| B-1 | CRITICAL | RESOLVED | Build ??fileKeys |
| B-2 | CRITICAL | RESOLVED | Build ??PrimaryFileRow |
| B-3 | LOW | OPEN | Queries ??sequential import |
| C-1 | MEDIUM | RESOLVED | Auth - listener leak |
| C-2 | LOW | OPEN | Auth ??no confirmation handling |
| C-3 | LOW | OPEN | Auth ??hardcoded key |
| D-1 | CRITICAL | RESOLVED | Electron - null window crash |
| D-2 | HIGH | RESOLVED | Electron - DB_QUERY select-only |
| D-3 | HIGH | RESOLVED | Electron - no table allowlist |
| D-4 | MEDIUM | OPEN | Electron ??restore doesn't clear |
| D-5 | MEDIUM | OPEN | Electron ??worker race |
| D-6 | MEDIUM | RESOLVED | Electron - unvalidated paths |
| D-7 | LOW | OPEN | Electron ??file delete no usage guard |
| D-8 | MEDIUM | RESOLVED | Electron - detached window path |
| D-9 | HIGH | OPEN | Electron ??extraction no transaction |
| D-10 | MEDIUM | OPEN | Electron ??backup restore path unvalidated |
| D-11 | LOW | OPEN | Electron ??backup restore ignores errors |
| D-12 | LOW | OPEN | Electron ??backup create error handling |
| E-1 | MEDIUM | RESOLVED | PDF.js - selectionchange flood |
| E-2 | LOW | OPEN | PDF.js ??double destroy risk |
| E-3 | LOW | OPEN | PDF.js ??page proxy not cached |
| E-4 | MEDIUM | OPEN | PDF.js ??highlight alignment |
| F-1 | MEDIUM | RESOLVED | Detail - unhandled mutation error |
| F-2 | LOW | OPEN | Detail ??highlight limit |
| F-3 | LOW | RESOLVED | Detail - stale target anchor |
| F-4 | LOW | OPEN | Detail ??shared mutation pending state |
| G-1 | MEDIUM | OPEN | Schema ??no RLS |
| G-2 | LOW | OPEN | Schema ??no authors table |
| G-3 | LOW | OPEN | Schema ??folder cycles + stack overflow |
| G-4 | LOW | OPEN | Seed ??implicit is_active |
| H-1 | MEDIUM | RESOLVED | Desktop - URL encoding |
| H-2 | LOW | RESOLVED | Desktop - raw path in browser |

---

## 11. Rules

1. Read this file before starting work.
2. Add an `IN PROGRESS` row before editing files.
3. Update `Current Verified Status`, `Key Paths`, and `Work Log` when work lands.
4. Avoid editing the same files as another agent at the same time.
5. Keep work scoped: UI, data, IPC, schema, ingestion, and test concerns should be separated whenever possible.
6. Record risks and next steps before handing work off.
7. **DO NOT delete Section 10 (Known Issues & Potential Bugs).** Mark issues as RESOLVED when fixed ??never remove them.






























