# Analyzer-only Implementation

Status: completed
Type: implementation
Created: 2026-06-01
Updated: 2026-06-01
Related: ../README.md

## Summary

Implemented the first read-only Improvement Advisor slice as a pure frontend analyzer module with unit tests. This slice did not add UI, DB migrations, raw event logging, repository wiring, or LLM integration.

## Details

Scope:

- defined the suggestion contract
- defined a lightweight workspace snapshot input
- analyzed processing health
- analyzed searchable-data health
- analyzed extraction completeness
- analyzed table quality
- analyzed library cleanup
- tested the analyzer with fixture data

The analyzer should accept plain arrays and return deterministic suggestion cards. It should not import Supabase, React Query, Electron APIs, or runtime repositories.

## Code Boundaries

Boundary Confidence: high

Likely Module:
- `frontend/src/lib/advisor/`

Safe To Edit:
- `frontend/src/lib/advisor/types.ts`
- `frontend/src/lib/advisor/analyzeWorkspace.ts`
- `frontend/src/lib/advisor/analyzeWorkspace.test.ts`
- `frontend/src/lib/advisor/index.ts`

Edit With Care:
- `docs/tasks/read-only-improvement-advisor/README.md` because it is the ledger router.
- `AGENTS.md` because it tracks current shared status.

Do Not Touch Without Approval:
- `frontend/src/features/settings/SettingsView.tsx` because UI is out of this slice.
- `supabase/migrations/` because no migration is needed.
- `apps/desktop/electron/` because no desktop bridge or worker change is needed.

Required Checks:
- `cmd /c npm run test -- --run src/lib/advisor/analyzeWorkspace.test.ts`: pass, 1 file / 2 tests
- `cmd /c npm run build` in `frontend`: pass with existing large chunk warnings
- `git diff --check`: pass with LF-to-CRLF warnings only
- trailing whitespace scan: pass

## Links

- `docs/features/new/17-read-only-improvement-advisor.md`
- `docs/tasks/read-only-improvement-advisor/planned/01_2026-06-01_mvp-read-only-analyzer.md`

## Next

Next slice should decide whether to add a Settings card, a query adapter that builds snapshots from existing repository data, or both.
