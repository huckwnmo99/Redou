# MVP Read-only Analyzer

Status: archived
Type: implementation
Created: 2026-06-01
Updated: 2026-06-01
Related: ../../README.md

## Summary

Original plan for the first Improvement Advisor slice: a no-migration, read-only analyzer. This was superseded by the completed analyzer-only implementation summary.

## Details

First analyzer categories:

- processing health
- searchable-data health
- extraction completeness
- table quality
- library cleanup

Initial suggestion contract:

- title
- category
- severity
- confidence
- evidence entries with source labels
- why it matters
- recommended action
- risk

The first UI can be a compact Settings card or a small read-only view. It should support refresh and evidence expansion. Dismiss/snooze persistence can wait.

No raw event collection is included in this slice. If UX friction analysis becomes important later, add `app_events` and daily rollups in a separate phase with explicit retention controls.

## Code Boundaries

Boundary Confidence: medium

Likely Module:
- `frontend/src/features/advisor/`
- `frontend/src/lib/advisor/`

Safe To Edit:
- new advisor analyzer files
- new advisor unit tests
- Settings card integration if the user approves UI implementation

Edit With Care:
- `frontend/src/features/settings/SettingsView.tsx` because it already has several settings surfaces.
- existing repository/query modules because the first slice should read data without broad facade churn.

Do Not Touch Without Approval:
- Supabase migrations because MVP should not add tables.
- event logging/runtime telemetry because raw events are a later phase.
- desktop processing workers because advisor should not mutate job state.

Required Checks:
- targeted frontend unit tests for analyzer outputs
- `cmd /c npm run build` in `frontend` if UI code changes

## Links

- `docs/features/new/17-read-only-improvement-advisor.md`
- `AGENTS.md`

## Next

See `../../completed/02_2026-06-01_analyzer-only-implementation.md`.
