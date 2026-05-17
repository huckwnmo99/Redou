# ADR 0003: Test Infrastructure Bootstrap

Status: accepted
Date: 2026-05-08

## Context

Stage 0.5 exists to prove that at least one automated test can run before Redou starts runtime refactors.

The immediate refactor risk is not frontend search itself. The risk is that future movement of Electron, IPC, chat/table, RAG, and source-file logic happens without a repeatable check. This ADR records the first small working path and the next test categories required before higher-risk stages.

## Decision

Use the existing frontend Vitest setup as the first automated test path.

The first characterization test is:

```text
frontend/src/features/search/searchModel.test.ts
```

It verifies that folder-scoped search uses direct paper membership instead of implicitly including descendant folder papers.

This was chosen because:

- `frontend/package.json` already has a `test` script.
- no new dependency install was needed.
- the behavior is user-visible and has been an intentional Redou search-scope rule.
- it avoids Electron, Supabase, and LLM setup while still proving the test runner path.

## Command

Run from `frontend`:

```powershell
cmd /c npm run test -- --run src/features/search/searchModel.test.ts
```

In the Codex sandbox, the first run may fail with `Error: spawn EPERM` while Vite/esbuild loads the config. If that happens, rerun the same command with approved escalation. The same command passed with escalation on 2026-05-08.

## Future Strategy

### Electron / Preload Contract Tests

Before extracting IPC handlers, add contract tests around the preload API surface and IPC channel names.

The tests should verify:

- renderer-facing method names stay stable;
- required auth arguments remain present on chat/LLM calls;
- new channels are added through the shared IPC channel definition file;
- table/file/DB whitelist policy remains enforced by the IPC layer.

### LLM / Ollama / VLLM Mock

Before Stage 2A chat/table pipeline extraction, define an injectable LLM client boundary.

Tests should use deterministic fake responses for:

- clarify vs answer/table intent;
- valid table JSON;
- malformed table JSON;
- Stage 3d no-new-context skip;
- high-confidence recovery application;
- abort or timeout.

No test should depend on a live local model for normal CI-style verification.

### Supabase Fixture

Before moving database-heavy chat/table code, define a fixture strategy for authenticated user scope and source-file ownership.

The minimum fixture data should cover:

- one user;
- one conversation owned by that user;
- one paper;
- one main PDF source file;
- one supplementary PDF source file;
- chunks/figures tied to different `source_file_id` values.

Tests should fail if supplementary extraction can overwrite main-PDF extraction or if generated tables can be persisted outside the authenticated conversation scope.

Stage 3d preservation fixtures should also cover:

- `chat_generated_tables.metadata.agenticRecovery`;
- `chat_generated_tables.metadata.nullSummary`;
- `agenticRecovery.skippedReason`, including `single_call_fallback`;
- the `researching` status event emitted during Agentic NULL Recovery.

### Abort Test Helper

Before extracting async pipelines, define a small abort helper that can trigger an `AbortSignal` at controlled points.

The helper should be able to verify:

- no generated table is persisted after abort;
- in-flight status events stop cleanly;
- temporary state is cleaned up;
- abort behavior remains consistent after code movement.

## Gate

Stage 2A should not begin until the LLM mock and Supabase fixture strategy above is either implemented or explicitly accepted as a documented stop-gap by the user.

The desktop-side test path must also have a placeholder test that passes through:

```powershell
cmd /c npm run test
```

This was added on 2026-05-08 using the Node built-in test runner in `apps/desktop`. The default Codex sandbox hit `spawn EPERM`, and the same command passed with approved escalation.

Stage 0.5 is complete when:

- the first characterization test exists;
- the targeted test command is documented;
- the targeted test passes locally;
- this ADR records the next test infrastructure requirements.
