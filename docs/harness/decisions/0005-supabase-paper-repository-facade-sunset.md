# ADR 0005: Supabase Paper Repository Facade Sunset

Status: accepted
Date: 2026-05-11

## Context

Plan 12 Stage 4 splits `frontend/src/lib/supabasePaperRepository.ts` without changing query hooks or renderer call sites.

The repository is still the frontend data facade for papers, files, extraction data, highlights, notes, folders, and imports. Removing that facade during the first split would couple the refactor to broad query hook churn.

Measured before Stage 4 code movement:

- `supabasePaperRepository.ts`: 1421 lines.
- External facade import count: 1, in `frontend/src/lib/queries.ts`.
- Frontend test baseline: 1 Vitest suite, `frontend/src/features/search/searchModel.test.ts`.

## Decision

Keep `supabasePaperRepository` as the public facade for Stage 4.

Extract implementation modules behind the facade in small slices:

- mapper rows and app-model conversion first;
- source-file/import helpers next;
- then one domain at a time, such as highlights or notes.

The facade may be removed only after:

- all high-churn implementation areas are behind focused modules;
- query hook call sites are measured again;
- the user approves a separate query-hook migration slice.

## Test Strategy

The first Stage 4 slice uses frontend Vitest unit coverage for pure mappers.

Q13 is closed by D30 for the Stage 4 repository split cycle. Mocked frontend Vitest coverage with `vi.mock` and builder-style Supabase stubs is accepted for the small helper splits that keep public query-hook behavior unchanged.

Do not introduce real Supabase fixture isolation merely to finish Stage 4. Reopen the fixture strategy only for a later DB-heavy, auth/RLS, workflow-integration, Stage 5 import/processing, or reliability-focused series.

## Consequences

This preserves UI/query behavior while reducing repository size.

The tradeoff is temporary indirection: `supabasePaperRepository.ts` remains large enough to coordinate extracted modules until later Stage 4 slices move source-file/import and note/highlight behavior.

## 2026-05-15 Measurement Update

After the mapper, highlights, notes, source-files, paperSignals, folders, and first papers helper splits:

- `supabasePaperRepository.ts`: 673 lines.
- Focused implementation modules under `frontend/src/lib/paperRepository/`: 1292 non-test lines.
- External facade import count: 1 production import, still `frontend/src/lib/queries.ts`.
- Direct focused-module production imports outside the facade: 0.
- `paperRepository.*` calls inside `queries.ts`: 38 occurrences, 37 unique method names.
- Frontend targeted repository/search coverage: 7 Vitest suites / 26 tests.

Call-site distribution:

| Domain | Facade methods called from `queries.ts` | Occurrences | Migration posture |
|--------|------------------------------------------|-------------|-------------------|
| Paper app-model reads and star toggle | `getAllPapers`, `getPaperById`, `getPapersByFolder`, `getStarredPapers`, `getRecentPapers`, `searchPapers`, `togglePaperStar` | 8 | Keep behind facade until a paper app-model read adapter exists; these compose `papers.ts`, `paperSignals.ts`, and sometimes `folders.ts`. |
| Files and import workflows | `getPrimaryPaperFile`, `getSupplementaryPaperFiles`, `createImportedPaper`, `attachSupplementaryPdfToPaper` | 4 | File reads are direct-migration candidates; import workflows stay in the facade under D26/D28. |
| Extraction, references, semantic search | `getAllChunks`, `getSectionsByPaper`, `getAllFigures`, `getFiguresByPaper`, `getReferencesByPaper`, `semanticSearch`, `semanticPaperSearch`, `semanticFigureSearch` | 8 | Not ready for query-hook migration; extraction/search/reference helpers should be split first if Stage 4 continues. |
| Highlights and highlight embeddings | `getHighlightPresets`, `createHighlightPreset`, `deleteHighlightPreset`, `getHighlightsByPaper`, `createHighlight`, `updateHighlightPreset`, `deleteHighlight`, `upsertHighlightEmbedding`, `searchHighlightEmbeddings` | 9 | Read-only highlight queries can migrate after import policy is chosen; user-scoped mutations need a shared auth/current-user helper first. |
| Notes | `getAllNotes`, `getNotesByPaper`, `getNoteById`, `createNote`, `updateNote` | 5 | Read-only note queries are direct-migration candidates; mutations need shared auth/current-user handling and highlight dependency review. |
| Folders | `getAllFolders`, `createFolder`, `movePaperToFolder` | 3 | `getAllFolders` is a direct-migration candidate; mutations/workflows stay behind the facade until auth/current-user extraction and app-model reload policy are decided. |
| Delete workflow | `deletePaper` | 1 | Keep in facade; disk cleanup and hard delete sequencing remain a cross-process workflow. |

Updated decision:

Do not sunset the facade immediately. The next safe step is not broad hook migration; it is either:

- a docs-only migration plan that groups read-only query hooks by module and keeps workflows behind the facade, or
- a tiny read-only tracer, such as moving `usePrimaryPaperFile` or `useAllNotes` to a focused query adapter after the user approves a code-changing slice.

Do not move import, supplementary, delete, or app-model-composition workflows without a separate D26 confirmation.

## 2026-05-15 Closure Update

Stage 4 is complete after seven repository domain splits plus the query hook migration measurement.

Closure state:

- `supabasePaperRepository.ts` remains the public facade.
- D29 records that facade sunset requires a query adapter step.
- D30 closes Q13 for this cycle with the mocked-unit-test stop-gap.
- The next architecture priority moves out of Stage 4 unless the user explicitly asks for a small query-adapter tracer.
