# ADR 0001: Debuggable Module Split

Status: accepted
Date: 2026-05-08

## Context

Redou's Electron main process has accumulated many responsibilities:

- Electron lifecycle
- BrowserWindow management
- IPC registration
- local Supabase access
- file and backup handling
- PDF import processing
- OCR and extraction orchestration
- embedding jobs
- chat and table generation
- RAG retrieval
- Stage 3d Agentic NULL Recovery
- source evidence labeling
- LLM preference handling

Stage -1 measured `apps/desktop/electron/main.mjs` at 4,321 lines with 30 direct IPC registrations and 21 direct imports. It also found 24 merge-tree conflict files against `origin/main`, including `main.mjs`, preload, IPC channels, chat types, chat queries, settings, and harness docs.

This makes debugging difficult because a failure in one domain can be hidden inside a large mixed file. It also increases merge risk because independent feature work touches the same file.

## Decision

Split Redou runtime behavior into debuggable modules by responsibility, while keeping behavior-preserving slices small.

Target ownership:

| Area | Target module family |
|------|----------------------|
| Electron lifecycle and BrowserWindow | `main.mjs` |
| IPC registration and validation | `ipc/` or thin registration helpers |
| Chat/table orchestration | `chat/` |
| RAG retrieval and source evidence | `rag/` or `chat/` helpers |
| Import and extraction jobs | `pipeline/` |
| Embedding jobs | `pipeline/` or embedding worker modules |
| PDF/OCR helpers | existing focused helper modules |
| Frontend Supabase repository implementation | `frontend/src/lib/paperRepository/` |
| Frontend paper detail UI leaves | `frontend/src/features/paper/` leaf components |

## Rules

- Do not combine backend Electron extraction and frontend UI component extraction in the same PR.
- Keep each slice behavior-preserving unless a plan explicitly says otherwise.
- Define input/output contracts before moving async pipeline code.
- Record abort behavior for every async pipeline extracted from `main.mjs`.
- Keep IPC channel names and frontend event names stable unless there is a separate migration plan.
- Prefer pure helpers first when they reduce risk.
- Pause runtime code-changing stages when the designated code-writing agent is unavailable, per D10.

## Sequence

The current architecture plan uses this order:

1. Stage -1: branch hygiene analysis.
2. Stage 0: glossary and ADRs.
3. Stage 0.5: first test infrastructure slice.
4. Stage 1: chat/table state audit.
5. Stage 2A: chat/table pipeline extraction.
6. Stage 2B: `PaperDetailView` mechanical split.
7. Stage 3: source evidence and Stage 3d helper extraction.
8. Stage 4: frontend repository implementation split.
9. Stage 5: import/processing pipeline extraction.

Stage -1 found that runtime refactor should wait until integration is handled or explicitly deferred.

## Consequences

Benefits:

- Smaller files with clearer owners.
- Easier debugging and targeted testing.
- Lower future merge conflict pressure.
- More useful code review boundaries.

Costs:

- Requires careful characterization before moving code.
- Existing conflict with `origin/main` means runtime extraction cannot safely start immediately.
- Temporary facades may remain during transition.

## Verification

Each extraction stage should record:

- what moved
- what stayed
- current measured size/count baseline
- verification commands
- abort behavior for async pipelines
- any intentionally deferred cleanup

## D9 Compliance

Each refactor stage records measurable gates in its closing notes:

- `main.mjs` measurement before and after: line count, direct IPC registration count, and direct import count.
- New module measurement: file count, line count, and exported entrypoints.
- Test or smoke coverage delta when applicable.
- Hard-gate pass/fail using the latest accepted decision for the relevant stage.
- Soft target notes when the stage improves directionally but exact hard gates are not yet approved.

Q5 is closed in D21. Stage 2A used measured closure gates (`main.mjs <= 3600`, `shellOnly = 0`, table orchestration moved, desktop tests/build passing). Later stages should add their own measured gates before closure rather than inheriting the early R1 proposal blindly.

## D10 Compliance

Runtime code-changing stages must verify that the designated code-writing agent is available before edits start.

If unavailable:

- docs, planning, review, and decision recording may continue;
- runtime code changes pause;
- the user must explicitly approve any fallback code-writing path.
