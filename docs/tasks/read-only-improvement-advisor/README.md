# Read-only Improvement Advisor

## Purpose

Track the work needed for Redou to inspect its own local workspace state and suggest evidence-backed improvements to the user.

This ledger keeps implementation context small: read this README first, then open only the linked plan, active detail, completed summary, or decision record that matches the next step.

## Current Status

- Status: in-progress
- Size: Large
- Current phase: analyzer and snapshot adapter implemented, seven-page presentation draft, PPT deck, and overview infographic generated; query/data loading and UI not started
- Owner: Codex
- Stakeholders: User, future Redou runtime implementer
- Source of truth: `docs/features/new/17-read-only-improvement-advisor.md`
- Review cadence: milestone

## Non-Technical Summary

The app should eventually notice where the research workspace is weak, such as failed processing, missing searchable data, weak table evidence, sparse extraction, or messy library organization. The first implementation should only read existing local data and present suggestion cards; it should not change data, collect long-lived behavior logs, or depend on an LLM.

## Next Action

Choose whether the next slice should add actual read-only query/data loading only, or also include a compact Settings card.

## Success Criteria

- The first implementation can run without DB migrations or raw event logging.
- Every suggestion includes evidence, impact, confidence, risk, and a recommended next action.
- Suggestions never include raw PDF text, note bodies, or chat prompt text.
- The feature works without an LLM.
- The user must approve any future mutation or task creation.

## Documents To Read

- `docs/features/new/17-read-only-improvement-advisor.md` - feature plan, analyzer categories, data retention strategy, and MVP boundaries.
- `CLAUDE.md` (repo root) - workflow, rules, skill policy. (AGENTS.md was removed in docs-cleanup; CLAUDE.md is the active agent-context file.) Current status: `docs/harness/main/feature-status.md`.
- `docs/agents/codex-claude/decisions.md` - D38 context that entity graph work is accepted and paused by default.

## Planned

- Query/data loading and optional Settings card - `planned/02_2026-06-01_snapshot-wiring-and-settings-card.md`

## In Progress

- None.

## Completed

- PPT deck from presentation draft - `completed/05_2026-06-10_presentation-deck.md`
- Seven-page non-technical presentation draft - `completed/04_2026-06-10_non-technical-presentation.md`
- Snapshot wiring adapter - `completed/03_2026-06-01_snapshot-wiring-adapter.md`
- Analyzer-only implementation - `completed/02_2026-06-01_analyzer-only-implementation.md`

## Recent Archive

- Read-only first before event logging - `archive/decisions/01_2026-06-01_read-only-first-before-events.md`
- Superseded MVP analyzer plan - `archive/planned/01_2026-06-01_mvp-read-only-analyzer.md`

## Last Updated

2026-06-10
