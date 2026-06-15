# Redou Integration Strategy Update — 2026-05-05

> Type: strategy update
> Base document: `docs/features/proposals/2026-04-28-integration-strategy.md`
> Current branch: `feature/pipeline-v2-only`
> Current checkpoint: `1637751` (`Checkpoint before integration strategy update`)
> Remote status: checkpoint pushed to `origin/feature/pipeline-v2-only`

This document updates the 2026-04-28 integration proposal against the current repository state.
It is still **not** an execution plan. Do not start the merge from this document alone.

---

## 1. Current Facts

### Branch State

- `feature/pipeline-v2-only` is now at `1637751`.
- `origin/main` is still at `3799fd2` (`Fix #08: 엔티티 그래프 critical 이슈 + 문서 정합성 보강 (#1)`).
- Merge base remains `f8dec9c`.
- The working tree was clean immediately after the checkpoint commit and push.

### Latest Feature-Branch Delta

The feature branch now includes more than the 2026-04-28 proposal assumed:

- V2-only PDF pipeline.
- Stage 3d Agentic NULL Recovery.
- Project-local Codex skills.
- External design reference material.
- Redou Style import-dialog copy cleanup.
- Critical security/workflow fixes from 2026-05-03:
  - chat ownership/auth scoping
  - chat table RLS migration
  - guarded desktop file access
  - user-scoped LLM model preference handling
  - safer import cleanup
- Supplementary-file prerequisite work from 2026-05-04:
  - `source_file_id` on `paper_sections`, `paper_chunks`, and `processing_jobs`
  - source-scoped extraction persistence
  - per-source embedding queueing

### Latest Merge-Tree Result

`git merge-tree feature/pipeline-v2-only origin/main` still reports 22 conflict files.

Code and config conflicts:

- `CLAUDE.md`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/ocr-extraction.mjs`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
- `frontend/src/features/settings/SettingsView.tsx`
- `frontend/src/lib/chatQueries.ts`
- `frontend/src/types/desktop.ts`

Harness/documentation conflicts:

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

This mostly confirms the 2026-04-28 proposal's conflict model, but the semantic content behind the conflicts has grown.

---

## 2. Updated Judgment

The original proposal is still directionally sound.

The recommendation should remain:

> **Option B: debt cleanup before integration.**

However, the reason has shifted slightly.

On 2026-04-28, the largest risk was Stage 3d being under-verified.
That is still true, but the feature branch now also contains security fixes and supplementary source-file ownership work.
Those changes are valuable and should not be casually mixed into a large manual merge without explicit preservation checks.

So the updated recommendation is:

> **Option B+, safety-first integration with a pre-merge preservation audit.**

---

## 3. What Changed Since The Original Proposal

### D-1: Stage 3d Verification Still Matters

Stage 3d has syntax/build-level confidence, but it still has not been fully exercised through a real table-generation scenario with:

- remaining NULL cells
- paper-scoped recovery search
- Gate 1 new-context detection
- Gate 2 `confidence === "high"` application
- timeout behavior
- abort behavior

This remains the highest runtime risk.

### D-2 / D-3: Harness VERSION Debt Still Exists

`docs/harness/VERSION.md` still ends at v1.2 in the feature branch.

The integration plan must not pretend the harness is current. It needs entries for:

- V2-only pipeline
- Stage 3d Agentic NULL Recovery
- 2026-05-03 security/workflow hardening
- 2026-05-04 supplementary source tracking
- final integration with entity graph

### D-4: `flows.md` Is Still Missing Stage 3d

`docs/harness/main/flows.md` documents the table pipeline through Stage 3c and Guardian, but it does not include the Stage 3d `researching` recovery pass.

### New Risk: Source-File Ownership Vs Entity Graph

The 2026-04-28 proposal predates supplementary source tracking.

`origin/main` adds entity graph extraction and graph-enhanced RAG.
The feature branch now adds source-file scoped chunks/sections/jobs.

Before merging, we must decide whether entity extraction is:

- paper-scoped: main PDF + supplementary evidence all contribute to one paper graph
- source-scoped: entities retain `source_file_id` or source labels

Short-term recommendation:

- keep entity graph paper-scoped for the first integration
- do not add `source_file_id` to entity tables during the merge
- ensure graph extraction does not undo source-scoped chunk persistence
- document that source-aware graph labels are a later supplementary/RAG slice

### New Risk: Security Fixes Must Survive The Merge

The merge must explicitly preserve:

- chat auth requirements
- RLS migrations for chat tables
- user-owned chat conversation/message/table access
- constrained `redou-file://` and desktop file access
- authenticated file cleanup/delete paths
- user-scoped model preference reads/writes

These were not part of the original proposal and are now integration guardrails.

---

## 4. Updated Execution Order

### Phase 0 — Completed

Checkpoint current feature branch state.

- Commit: `1637751`
- Pushed to: `origin/feature/pipeline-v2-only`

### Phase 1 — Pre-Merge Preservation Audit

Before resolving any merge conflict, create a short checklist of behavior that must survive the integration:

- 2026-05-03 security/RLS fixes
- 2026-05-04 supplementary `source_file_id` persistence
- Stage 3d recovery code paths
- V2-only pipeline behavior
- origin/main entity graph behavior

This is a read-only audit first. No code changes.

### Phase 2 — Stage 3d Runtime Verification

Run one focused verification pass before the merge:

- table mode with at least one expected NULL cell
- confirm `agenticRecovery.perPaper[]` metadata is written
- confirm no recovery extraction runs when Gate 1 has no new context
- confirm abort/timeout returns original table fail-soft

Minimum acceptable result:

- build/syntax pass
- one successful runtime table case
- one abort or timeout path checked

### Phase 3 — Harness Debt Fix

Update the feature-branch harness before integration:

- `docs/harness/VERSION.md`
- `docs/harness/main/flows.md`
- `docs/harness/detail/electron/llm.md`
- `docs/harness/detail/electron/rag-pipeline.md`
- relevant database/frontend harness files for supplementary source tracking

This should be a documentation-only commit.

### Phase 4 — PR #1 Follow-Up Decision

Re-check the PR #1 follow-up items against `origin/main`.

The most important remaining question is `graph-search.mjs` folder behavior:

- `origin/main` intentionally lets graph traversal leave folder scope.
- That may be correct for graph exploration, but it is risky for folder-scoped QA expectations.

Decision needed:

- keep graph expansion cross-folder and label it clearly
- or constrain graph expansion to `filter_paper_ids`

Do not silently inherit the current behavior without naming the product decision.

### Phase 5 — Actual Merge Plan

Only after Phases 1-4:

1. Create a dedicated integration branch from the checkpoint.
2. Merge `origin/main` into it.
3. Resolve conflicts by group:
   - IPC/preload/type additions
   - `main.mjs` pipeline orchestration
   - LLM orchestrator additions
   - frontend chat/settings/query changes
   - harness docs
4. Validate:
   - `node --check apps/desktop/electron/main.mjs`
   - `node --check apps/desktop/electron/preload.mjs`
   - `node --check apps/desktop/electron/llm-orchestrator.mjs`
   - frontend build
   - apps/desktop build
   - migration ordering review

---

## 5. Updated Recommendation

Proceed with **Option B+**.

Do not choose Option A now.
The feature branch is no longer just a feature branch; it is carrying important safety and supplementary groundwork.
A fast merge would create too much ambiguity around which behavior is intentionally preserved.

Option C is still viable if reviewability becomes the main priority, but it is less attractive now because the checkpoint commit groups several cross-cutting changes together.
Cherry-picking would require more manual separation than it saves.

---

## 6. Immediate Next Action

The next executable task should be:

> Create a pre-merge preservation audit for `1637751` versus `origin/main`.

Output should be a checklist, not code.
It should list the exact functions, migrations, IPC channels, and frontend query paths that must survive the later merge.

After that, run Stage 3d verification.

---

## 7. Bottom Line

The 2026-04-28 proposal was reasonable.
As of 2026-05-05, the correct answer is not to discard it, but to update it.

The safe path is:

1. checkpoint current work
2. preserve latest security and supplementary changes explicitly
3. verify Stage 3d
4. fix harness drift
5. then merge `origin/main`

Phase 0 is already complete.
