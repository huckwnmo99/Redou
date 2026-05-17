# Branch Hygiene Analysis - 2026-05-08

Status: completed Stage -1 analysis
Scope: architecture/debuggability refactor readiness
Related plan: `docs/features/fix/12-architecture-debuggability-implementation-plan.md`

## Summary

Do not start runtime refactor on the current branch yet.

The current branch can safely continue with docs-only architecture work, especially Stage 0 domain context and ADRs. But any runtime extraction from `apps/desktop/electron/main.mjs`, chat/table pipeline work, frontend repository split, or import/processing refactor should wait until branch integration is handled or explicitly deferred by the user.

Reason:

- `git merge-tree` currently reports 24 conflict files against `origin/main`.
- The conflicts include the highest-risk files: `main.mjs`, preload, IPC channels, chat query/types, settings, and harness docs.
- Both sides changed the same functional areas: chat/table LLM flow, graph/entity retrieval, security/auth scoping, supplementary source-file handling, and harness documentation.

No real merge was executed.

## Current Measurements

Measured from local repository state on 2026-05-08.

| Item | Value |
|------|-------|
| Current branch | `feature/pipeline-v2-only` |
| Local HEAD | `76401b1` |
| Tracking state | ahead of `origin/feature/pipeline-v2-only` by 4 commits |
| Local `origin/main` | `3799fd2` |
| Merge base | `f8dec9c8aeb2999f3c663d6485f50f311df5f9a8` |
| `apps/desktop/electron/main.mjs` line count | 4,321 |
| Direct `ipcMain.handle` / `ipcMain.on` count in `main.mjs` | 30 |
| Direct `import` count in `main.mjs` | 21 |
| Conflict files from `git merge-tree <base> HEAD origin/main` | 24 |
| Clean remote additions shown by merge-tree | 4 |

Working tree note:

The worktree is already dirty with architecture/planning docs, agent-skill changes, and one unrelated untracked fix doc. This analysis did not revert or normalize those changes.

## Merge-Tree Conflict Shape

Conflict sections:

| Merge-tree section | Count | Meaning |
|--------------------|-------|---------|
| `changed in both` | 11 | Same tracked files changed on both sides |
| `added in both` | 13 | Same paths added independently on both sides |
| `added in remote` | 4 | Clean remote additions, not direct conflicts but must be integrated |

### Changed In Both

- `CLAUDE.md`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/ocr-extraction.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
- `frontend/src/features/settings/SettingsView.tsx`
- `frontend/src/lib/chatQueries.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/types/desktop.ts`

### Added In Both

- `apps/desktop/electron/llm-qa.mjs`
- `docs/harness/VERSION.md`
- `docs/harness/detail/database/rpc.md`
- `docs/harness/detail/database/schema.md`
- `docs/harness/detail/electron/llm.md`
- `docs/harness/detail/electron/main-process.md`
- `docs/harness/detail/electron/pdf-pipeline.md`
- `docs/harness/detail/electron/rag-pipeline.md`
- `docs/harness/detail/frontend/stores-queries.md`
- `docs/harness/detail/services/external.md`
- `docs/harness/main/feature-status.md`
- `docs/harness/main/flows.md`
- `docs/harness/main/overview.md`

### Clean Remote Additions To Preserve

- `apps/desktop/electron/entity-extractor.mjs`
- `apps/desktop/electron/graph-search.mjs`
- `docs/features/fix/08-entity-graph-critical-issues.md`
- `supabase/migrations/20260423010000_add_entity_graph.sql`

## Conflict Groups

### 1. Agent Workflow And Shared Instructions

Files:

- `CLAUDE.md`

Risk: medium.

Redou-side behavior to preserve:

- Codex/Claude file exchange policy.
- Project-local Matt Pocock skill policy.
- Current Redou agent context and workflow notes.

`origin/main` behavior to preserve:

- The stricter `/plan -> /develop -> /test -> /review` workflow language.
- Subagent role separation language used by the merged main branch.

Resolution direction:

Compose the workflows instead of choosing one side wholesale. The likely target is:

- keep Redou-specific Codex-Claude file exchange;
- keep the Matt Pocock-only project skill policy;
- preserve main branch's strict workflow language where it does not conflict with current Codex runtime reality.

### 2. Electron Runtime And IPC

Files:

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/llm-qa.mjs`
- `apps/desktop/electron/ocr-extraction.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`

Risk: high.

Redou-side behavior to preserve:

- Auth-scoped chat and LLM IPC calls using `userId` and `accessToken`.
- Chat conversation/table ownership checks.
- Guarded file deletion and `redou-file` library path constraints.
- Stage 3d Agentic NULL Recovery, including `researching` status, `agenticRecovery` metadata, and `single_call_fallback` skip metadata.
- Supplementary source-file handling through `source_file_id`.
- Source-scoped extraction persistence so supplementary PDFs do not overwrite main-PDF sections/chunks/figures.
- RAG source labels that distinguish main PDF from supplementary evidence.
- V2-only PDF/OCR pipeline behavior already present in this branch.

`origin/main` behavior to preserve:

- Entity graph extraction and graph search integration.
- New standalone graph/entity modules.
- Entity backfill job behavior and IPC surface.
- Entity model preference behavior.
- Any critical fixes included in `origin/main` commit `3799fd2`.

Resolution direction:

Do not extract modules from `main.mjs` until this conflict is resolved or intentionally postponed.

When the merge happens, resolve smaller IPC/preload/type conflicts before `main.mjs`, then compose `main.mjs` around both behavior sets:

- feature branch: security, supplementary, Stage 3d, V2 source-file behavior;
- `origin/main`: entity graph, graph backfill, graph-enhanced retrieval.

### 3. Frontend Contract And UI

Files:

- `frontend/src/types/desktop.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/lib/chatQueries.ts`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
- `frontend/src/features/settings/SettingsView.tsx`

Risk: high.

Merge-tree detail:

- `frontend/src/types/desktop.ts` is `changed in both`.
- `frontend/src/types/chat.ts` is `changed in both`.
- The likely resolution is union extension, not either-side replacement: preserve this branch's `researching` stage and auth-scoped desktop/chat arguments while adding `origin/main` entity model, entity backfill, and graph-related type surface.

Redou-side behavior to preserve:

- Chat/LLM calls include auth context.
- `ChatPipelineStage` includes `researching`.
- Frontend query hooks remain scoped to the authenticated user.
- Generated table/source references preserve supplementary evidence labels.

`origin/main` behavior to preserve:

- Entity model types and IPC API.
- Entity backfill status hooks.
- Settings UI for entity extraction/backfill.
- Graph-enhanced QA frontend contract.

Resolution direction:

Resolve `frontend/src/types/desktop.ts` and `frontend/src/types/chat.ts` before query/UI files. Then update `chatQueries.ts`, `ChatPipelineStatus.tsx`, and `SettingsView.tsx` against the composed types.

### 4. Harness Documentation

Files:

- `docs/harness/VERSION.md`
- `docs/harness/detail/database/rpc.md`
- `docs/harness/detail/database/schema.md`
- `docs/harness/detail/electron/llm.md`
- `docs/harness/detail/electron/main-process.md`
- `docs/harness/detail/electron/pdf-pipeline.md`
- `docs/harness/detail/electron/rag-pipeline.md`
- `docs/harness/detail/frontend/stores-queries.md`
- `docs/harness/detail/services/external.md`
- `docs/harness/main/feature-status.md`
- `docs/harness/main/flows.md`
- `docs/harness/main/overview.md`

Risk: medium.

Redou-side behavior to preserve:

- Supplementary source-file tracking.
- Stage 3d `researching` flow.
- V2-only PDF/OCR pipeline documentation.
- Security/RLS chat hardening notes.

`origin/main` behavior to preserve:

- Entity graph and graph-enhanced search documentation.
- Main-branch critical-fix documentation.
- Harness version/history entries.

Resolution direction:

Do harness docs after code shape is settled. The docs conflict is broad because both branches created the harness from similar starting points. Compose behavior truth from the resolved code rather than mechanically accepting either side.

### 5. Migrations And Graph Files

File-level conflict: none in merge-tree for the main migration paths.

Still risky because `origin/main` adds:

- `supabase/migrations/20260423010000_add_entity_graph.sql`

Confirmed `origin/main` migration details:

- Adds `job_type` enum value `extract_entities`.
- Adds `papers.entity_extraction_version`.
- Adds `user_workspace_preferences.entity_extraction_model`.
- Adds entity graph tables/RPCs.

This branch adds later migrations:

- `supabase/migrations/20260503010000_secure_chat_tables.sql`
- `supabase/migrations/20260504010000_add_supplementary_source_tracking.sql`
- `supabase/migrations/20260506010000_add_rag_source_file_metadata.sql`

Risk: medium.

Resolution direction:

During actual integration, preserve all migrations and review order explicitly:

1. entity graph migration from `origin/main`;
2. secure chat tables migration;
3. supplementary source tracking migration;
4. RAG source file metadata migration.

Do not collapse or delete the 202605 migrations just because `origin/main` does not contain them.

## Recommendation

Recommended path:

1. Continue with Stage 0 docs-only context and ADRs if the user wants architecture planning momentum.
2. Do not start Stage 2A, Stage 2B, Stage 3, Stage 4, or Stage 5 runtime refactors until integration is handled or explicitly deferred.
3. Before actual integration, checkpoint the current docs/agent work so the worktree is reviewable.
4. Create a dedicated integration branch only after user approval.
5. Merge `origin/main` into that integration branch and resolve conflicts by group.

The likely integration conflict order remains:

1. `CLAUDE.md` / agent workflow policy
2. IPC constants and preload
3. frontend types
4. LLM orchestrator and `llm-qa.mjs`
5. graph/entity standalone files and migration
6. `main.mjs`
7. frontend query/settings/status UI
8. harness docs

## Decision Point

Choose one:

1. Proceed with Stage 0 docs-only glossary and ADRs now.
2. Checkpoint current docs/agent work, then prepare an integration branch plan.
3. Approve actual integration branch creation and merge conflict resolution.
4. Pause architecture work and return to product feature work.

Codex recommendation:

Proceed with option 1 now, then do integration branch cleanup before any runtime refactor.

This keeps momentum while avoiding the riskiest `main.mjs` conflict until the codebase is ready.

## Verification Commands Used

```powershell
git status --short --branch
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git rev-parse --short origin/main
git merge-base HEAD origin/main
git merge-tree f8dec9c8aeb2999f3c663d6485f50f311df5f9a8 HEAD origin/main
(Get-Content -Path apps\desktop\electron\main.mjs).Count
(Select-String -Path apps\desktop\electron\main.mjs -Pattern "ipcMain\.(handle|on)\(" -AllMatches).Matches.Count
(Select-String -Path apps\desktop\electron\main.mjs -Pattern "^import\s" -AllMatches).Matches.Count
```

Note:

`rg` was unavailable in this environment due access denial, so follow-up symbol checks used PowerShell `Select-String`.
