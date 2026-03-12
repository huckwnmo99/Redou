# Redou - Agent Shared Context

Read this file before starting work. Update it when you finish.

---

## 1. Project Overview

- Product: Windows desktop research workspace for reading, organizing, annotating, and recalling papers.
- Core idea: import PDFs, generate structured paper cards, notes, figures, and searchable research context.
- Current renderer baseline: `frontend`
- Current desktop shell: `apps/desktop`

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

### Verified Today (2026-03-11)
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
- `frontend/src/features/notes/NotesView.tsx`
- `frontend/src/features/paper/PaperDetailView.tsx`
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
- `frontend/src/mock/repository/paperRepository.ts` (retained as fallback)
- `frontend/src/types/desktop.ts`
- `frontend/src/types/paper.ts`

### Desktop Shell
- `apps/desktop/package.json`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `apps/desktop/src/types/electron-api.d.ts`
- `apps/desktop/src/App.tsx`

### Supabase
- `supabase/config.toml`
- `supabase/migrations/20260309050635_initial_schema.sql`
- `supabase/seed.sql`

---

## 6. Recommended Next Work

1. Improve the extraction worker from heuristic PDF text parsing into layout-aware and OCR-backed section, chunk, and figure extraction.
2. Decide whether to retire `apps/desktop/src` or fully replace it with the `frontend` renderer.
3. Walk through import, extraction, and reader flows inside the launched Electron window, or add automation for those runtime checks.
4. Add preset CRUD plus existing-note reassignment if highlight management needs to go beyond the current reader-local controls.
5. Only after that: detached panels, vector generation, and advanced retrieval work.

---
## 7. Active Work

Add `IN PROGRESS` here before editing files. Move finished work into the log below.

| Status | Date | Agent | Scope | Files | Out of Scope | Dependency |
|--------|------|-------|-------|-------|--------------|------------|
| IN PROGRESS | 2026-03-11 | Codex | Move Phase 3 extraction from heuristic text parsing toward layout-aware ordering with OCR-ready scanned-PDF hooks and worker messaging | AGENTS.md, pps/desktop/electron/pdf-heuristics.mjs, pps/desktop/electron/main.mjs, rontend/src/types/desktop.ts | Cloud OCR provider integration, embeddings, retrieval, detached panels | Local desktop build and Supabase available |
| READY FOR ASSIGNMENT | 2026-03-10 | Desktop/Platform Agent | Wire `frontend` to `window.redouDesktop` and define the migration path away from `apps/desktop/src` legacy renderer | `apps/desktop/electron/**`, `apps/desktop/src/types/**`, `frontend/src/**` | Paper data migration, PDF.js, retrieval | Data layer contracts should stay stable |

---

## 8. Work Log

| Date | Agent | Work | Files |
|------|-------|------|-------|
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

---

## 9. Latest Handoff

```md
DONE | Codex - Imported-paper scope and metadata cleanup
- Done: changed folder views and search folder scope to direct membership only, added pre-import PDF inspection for cleaner titles/years, improved desktop extraction title heuristics, and reprocessed the latest local paper so the stored record now uses the extracted title/year instead of the filename slug
- Changed files: frontend/src/lib/supabasePaperRepository.ts, frontend/src/features/search/searchModel.ts, frontend/src/features/import/ImportPdfDialog.tsx, frontend/src/lib/desktop.ts, frontend/src/types/desktop.ts, apps/desktop/electron/preload.mjs, apps/desktop/electron/types/ipc-channels.mjs, apps/desktop/electron/main.mjs, apps/desktop/electron/pdf-heuristics.mjs, AGENTS.md
- Verified: frontend `npm run build` passes, apps/desktop `npm run build` passes, `node --check` passes for main.mjs and pdf-heuristics.mjs, and the latest local paper now shows the extracted title `Optimization and kinetic analysis on the sulfuric acid ? Catalyzed depolymerization of wheat straw` with publication year 2015
- Risks: extraction is still a first-pass heuristic, so some PDFs will still need OCR/layout-aware parsing to get perfect section boundaries and cleaner abstract text
- Next: continue improving first-page abstract/section detection and move the worker from heuristic parsing toward layout-aware or OCR-backed extraction
```

## 10. Known Issues & Potential Bugs

> **DO NOT DELETE THIS SECTION.** This section was created at the project owner's explicit request for code review documentation. Agents must resolve issues listed here rather than removing them. When an issue is fixed, mark it `RESOLVED` with the date and agent name ??do not delete the entry. If you believe an entry is wrong, add a `DISPUTED` note with your reasoning below it.

### Severity Guide

- **CRITICAL**: Will crash or corrupt data at runtime.
- **HIGH**: Incorrect behavior that users will hit in normal use.
- **MEDIUM**: Edge-case bugs, performance risks, or security gaps.
- **LOW**: Code quality, maintainability, or minor UX concerns.

---

### A. Data Layer ??`frontend/src/lib/supabasePaperRepository.ts`

**A-1 (MEDIUM) ??`DB_TO_KIND` / `KIND_TO_DB` mapping is lossy** (lines 18-35)
Multiple DB types map to the same frontend kind (`presentation_note` ??`insight`, `result_note` ??`summary`, `custom` ??`summary`). Round-tripping through create ??update silently changes `note_type`. No `custom` kind exists on the frontend, so custom notes can never be created or preserved.

**A-2 (MEDIUM) ??`fetchPaperSignals()` fetches ALL rows from `notes`, `figures`, and `processing_jobs` every time** (lines 313-343)
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






























