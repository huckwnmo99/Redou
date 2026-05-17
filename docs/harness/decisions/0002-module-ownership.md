# ADR 0002: Module Ownership

Status: accepted
Date: 2026-05-08

## Context

`apps/desktop/electron/main.mjs` is currently too broad. Codex-Claude decision D8 states that `main.mjs` should own only lifecycle, IPC registration, client initialization, and whitelist definitions.

Without a module ownership rule, future fixes will continue adding domain logic back into `main.mjs`, undoing the refactor.

## D8 Mapping

This ADR is the canonical implementation detail for decision D8 in `docs/agents/codex-claude/decisions.md`.

Future changes to `main.mjs` scope should update the accepted decision first, then this ADR. If they disagree, D8 is the higher-level source of truth and this ADR should be corrected.

## Decision

`apps/desktop/electron/main.mjs` owns only:

- Electron app lifecycle (`whenReady`, `will-quit`, `activate`)
- BrowserWindow creation and management
- app-level protocol registration
- Supabase/Ollama/client initialization wiring
- DB query/mutate whitelist definitions while those whitelists remain there
- table/file whitelist definitions while those whitelists remain there
- thin IPC registration calls or delegation to registration modules

`main.mjs` must not own long-lived domain logic for:

- chat/table orchestration
- RAG retrieval
- Stage 3d recovery logic
- source evidence formatting
- import PDF processing internals
- embedding job internals
- graph/entity extraction internals
- frontend data repository implementation

## Target Owners

| Responsibility | Owner |
|----------------|-------|
| Chat send pipeline | `apps/desktop/electron/chat/table-pipeline.mjs` |
| QA pipeline | `apps/desktop/electron/chat/qa-pipeline.mjs` or existing `llm-qa.mjs` after integration |
| Status events | `apps/desktop/electron/chat/status-events.mjs` |
| Source evidence labels | `apps/desktop/electron/chat/source-evidence.mjs` or a RAG helper |
| Stage 3d recovery | `apps/desktop/electron/chat/agentic-null-recovery.mjs` |
| Import PDF job | `apps/desktop/electron/pipeline/import-processing.mjs` |
| Embedding job | `apps/desktop/electron/pipeline/embedding-processing.mjs` |
| Job coordination | `apps/desktop/electron/pipeline/job-coordinator.mjs` |
| Entity graph extraction/search | entity graph modules from `origin/main`, preserved during integration |
| Frontend paper data implementation | `frontend/src/lib/paperRepository/*` |
| Frontend paper UI leaves | `frontend/src/features/paper/Paper*Tab.tsx` components |

Exact filenames can change if implementation discovers a better local pattern, but the ownership boundary should remain.

## Whitelist Migration Path

DB query/mutate, file, and table whitelists may remain in `main.mjs` during the first behavior-preserving extraction stages.

Longer term, those whitelists should move to a dedicated registry or IPC validation module so `main.mjs` does not become the permanent home for policy details.

Do not move the whitelists in the same slice as chat/table pipeline extraction unless the plan explicitly scopes that work.

## Dependency Rule

Extracted modules receive dependencies explicitly.

Examples:

- `supabase`
- `ownerId`
- `scope`
- `abortSignal`
- `emitStatus`
- selected LLM/RAG helper functions

Avoid hidden imports of mutable global state unless the dependency is truly app-wide infrastructure.

## IPC Rule

IPC handlers should validate input and delegate.

A handler can:

- authenticate
- validate and normalize arguments
- choose the right coordinator
- convert result/error shape for the renderer

A handler should not contain the full domain pipeline body.

## Abort Rule

Every async pipeline extracted from `main.mjs` must either:

- accept and propagate `AbortSignal`, with at least one regression test or documented smoke check, or
- explicitly document why it is non-abortable and what the caller is responsible for.

## Review Rule

When reviewing future refactors, flag additions to `main.mjs` if they introduce domain logic instead of lifecycle, initialization, IPC registration, or validation.

Suggested PowerShell check after extraction stages:

```powershell
Select-String -Path apps\desktop\electron\main.mjs -Pattern "runMultiQueryRag|runAgenticNullRecovery|extractColumnsFromPaper|generateTableFromSpec|persistEntities" | Measure-Object -Line
```

The expected count depends on the current stage, but increases should be explained.
