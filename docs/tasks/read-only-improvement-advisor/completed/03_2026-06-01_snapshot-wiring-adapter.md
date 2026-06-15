# Snapshot Wiring Adapter

Status: completed
Type: implementation
Created: 2026-06-01
Updated: 2026-06-01
Related: ../README.md

## Summary

Implemented option A's first adapter layer: existing app/domain data shapes can now be converted into the advisor analyzer snapshot without adding UI, DB migrations, event logging, or LLM integration.

## Details

Completed scope:

- added a pure snapshot builder for existing frontend data types
- mapped papers, primary files, chunks, sections, figures, processing jobs, generated tables, and folders
- supported optional embedded chunk IDs so missing embeddings can be diagnosed when that data is available
- tested the mapping contract with fixture data

The adapter should not query Supabase directly. It should accept already-loaded app data and return `AdvisorWorkspaceSnapshot`.

## Code Boundaries

Boundary Confidence: high

Likely Module:
- `frontend/src/lib/advisor/`

Safe To Edit:
- `frontend/src/lib/advisor/buildWorkspaceSnapshot.ts`
- `frontend/src/lib/advisor/buildWorkspaceSnapshot.test.ts`
- `frontend/src/lib/advisor/index.ts`

Edit With Care:
- `docs/tasks/read-only-improvement-advisor/README.md`
- `docs/features/new/17-read-only-improvement-advisor.md`
- `AGENTS.md`

Do Not Touch Without Approval:
- `frontend/src/features/settings/SettingsView.tsx` because Settings UI is out of option A.
- `frontend/src/lib/queries.ts` because broad query hook changes are not required for this adapter.
- `supabase/migrations/` because no persistence is needed.

Required Checks:
- `cmd /c npm run test -- --run src/lib/advisor/analyzeWorkspace.test.ts src/lib/advisor/buildWorkspaceSnapshot.test.ts`: pass, 2 files / 4 tests
- `cmd /c npm run build` in `frontend`: pass with existing large chunk warnings
- `git diff --check`: pass with LF-to-CRLF warnings only
- trailing whitespace scan: pass

## Links

- `docs/tasks/read-only-improvement-advisor/planned/02_2026-06-01_snapshot-wiring-and-settings-card.md`
- `frontend/src/lib/advisor/analyzeWorkspace.ts`

## Next

Next slice should choose between query/data loading from existing repositories and a compact Settings card.
