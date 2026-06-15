# Snapshot Wiring And Settings Card

Status: planned
Type: implementation
Created: 2026-06-01
Updated: 2026-06-01
Related: ../README.md

## Summary

Remaining optional next slice after analyzer-only and snapshot adapter implementation. Wire the pure analyzer to actually loaded Redou data and decide whether to expose results through a compact Settings card.

## Details

Completed already:

- pure app/domain object to `AdvisorWorkspaceSnapshot` adapter
- adapter unit tests

Remaining possible scope:

- add a query/helper that loads or receives existing read-only data sources
- keep writes, event logging, and migrations out of scope
- add a small `AdvisorPanel` component only if the user wants UI now
- keep Settings integration as a thin call to a dedicated advisor component

## Code Boundaries

Boundary Confidence: medium

Likely Module:
- `frontend/src/lib/advisor/`
- `frontend/src/features/advisor/`

Safe To Edit:
- advisor snapshot/query helper
- advisor UI component if approved

Edit With Care:
- `frontend/src/features/settings/SettingsView.tsx` because it is already large and section-based.
- `frontend/src/lib/queries.ts` because broad query hook churn is not part of this slice.

Do Not Touch Without Approval:
- Supabase migrations
- app event logging
- Electron processing workers

Required Checks:
- targeted advisor tests
- `cmd /c npm run build` in `frontend` if UI or query wiring changes

## Links

- `docs/features/new/17-read-only-improvement-advisor.md`
- `frontend/src/lib/advisor/analyzeWorkspace.ts`
- `frontend/src/lib/advisor/buildWorkspaceSnapshot.ts`

## Next

Ask the user whether to add actual query/data loading only or include a minimal Settings card.
