# Stage 3d Runtime Verification Plan

Date: 2026-05-05
Branch: `feature/pipeline-v2-only`
Owner: Codex
Status: V0 passed; Stage 3d runtime path observed; fallback metadata fix verified; V1/V2 pending

## Goal

Verify that Stage 3d Agentic NULL Recovery works on the current feature branch before any merge with `origin/main`.

The key risk is not syntax. The key risk is runtime behavior: a table answer with NULL cells must either recover values safely or preserve the original table without corruption.

## Scope

In scope:

- Confirm Stage 3d is reachable after Stage 3c merge.
- Confirm the recovery gate prevents unnecessary LLM calls.
- Confirm paper-scoped recovery search only tries extraction when new chunk or figure context exists.
- Confirm recovered values are applied only when `confidence === "high"`.
- Confirm metadata records the before/after NULL count and per-paper recovery result.
- Confirm the renderer receives the `researching` stage when recovery runs.

Out of scope:

- Merging `feature/pipeline-v2-only` with `origin/main`.
- Changing entity graph behavior from `origin/main`.
- Broad chat pipeline refactors.
- Supabase reset. Use the existing local DB unless the owner explicitly approves a reset.

## Relevant Code

- `apps/desktop/electron/main.mjs`
  - `shouldTriggerAgenticRecovery`
  - `runAgenticNullRecovery`
  - `runPaperScopedRecoverySearch`
  - `applyRecoveredValues`
  - `buildGeneratedTableRecord`
- `apps/desktop/electron/llm-orchestrator.mjs`
  - `extractNullCellsFromPaper`
  - `NULL_RECOVERY_EXTRACTION_PROMPT`
- `frontend/src/types/desktop.ts`
  - `ChatPipelineStage`
- `frontend/src/features/chat/ChatPipelineStatus.tsx`
  - `stageMeta.researching`

## Verification Order

### V0 - Static Health

Run this first because it is fast and catches broken imports or syntax before UI testing.

```powershell
node --check apps\desktop\electron\main.mjs
node --check apps\desktop\electron\llm-orchestrator.mjs
cmd /c npm run build
```

For the frontend build, run inside `frontend` if root build is not configured:

```powershell
cd frontend
cmd /c npm run build
```

Pass criteria:

- Both Electron files pass `node --check`.
- Frontend build passes.
- No runtime code is changed during this step.

Result on 2026-05-05:

- PASS: `node --check apps\desktop\electron\main.mjs`
- PASS: `node --check apps\desktop\electron\llm-orchestrator.mjs`
- PASS: `cmd /c npm run build` in `frontend`
- PASS: `cmd /c npm run build` in `apps/desktop`

Notes:

- The frontend build still reports the existing Vite chunk-size warning for the bundled app/PDF worker output.
- No runtime source code was changed for V0.

### Runtime Observations - 2026-05-05

Environment:

- Electron launched against built `frontend/dist`.
- Existing authenticated session was present for `huckwnmo100@gmail.com`.
- Local Supabase had 4 papers, 237 chunks, and 96 figures for the active user.
- The user's LLM preference was temporarily changed from `gemma4:31b` to `llama3.1:8b` for runtime verification, then restored to `gemma4:31b`.

Observed Stage 3d run:

- Prompt: compact table with `Paper title` and `Publication year`.
- Result: generated table `787dc23d-b697-4842-9aec-4caf30c8cee4`.
- Status events reached `orchestrating`, `searching`, `parsing`, `extracting`, `assembling`, `researching`, then `assembling`.
- `researching` detail targeted one paper: `Adsorptive removal of ultra-low concentration H2S and THT in`.
- `metadata.agenticRecovery.attempted === true`.
- `metadata.agenticRecovery.recoveredCellCount === 0`.
- `metadata.agenticRecovery.nullsBeforeRecovery === 24`.
- `metadata.agenticRecovery.nullsAfterRecovery === 2`.
- Per-paper recovery found new context (`newChunkCount: 15`, `newFigureCount: 8`) but recovered no cells.

Interpretation:

- This run confirms the real Electron IPC path can reach Stage 3d and emits the `researching` renderer status.
- It does not satisfy V1 because the table still produced NULL cells and Stage 3d ran.
- It does not satisfy V2 because paper-scoped recovery found new context rather than taking the `no_new_context` skip path.
- It partially supports V4/V5 safety: no low-confidence value was applied, and no non-NULL overwrite was observed.

Observed abort run:

- Prompt: single-column `Paper title` table.
- Conversation: `9bab5dde-a092-49a5-8d33-77e32e2cedf2`.
- Timeout guard aborted after 6 minutes while the pipeline was still in `extracting (1/4)`.
- No `chat_generated_tables` row was saved for this conversation.
- Only the user message was persisted.

Runtime concerns found:

- Even metadata-only prompts still drive the full table extraction pipeline, including OCR table parsing and per-paper extraction.
- A one-column `Paper title` request did not complete within 6 minutes on `llama3.1:8b`.
- The generated `Paper title` / `Publication year` table contained duplicate rows for one paper and `N/A` for a year that exists in paper metadata. This looks like a broader table-pipeline quality issue, not a Stage 3d-only failure.
- A scoped one-paper fallback table (`81a19a84-ba39-49bb-bfe1-68ac3c9dd84f`) saved stale per-paper `nullSummary` with `agenticRecovery: null` after switching to `single_call_fallback`.

Minimal fix applied:

- In `apps/desktop/electron/main.mjs`, `single_call_fallback` now writes an explicit skipped recovery object with `skippedReason: "single_call_fallback"`.
- The stale per-paper `nullSummary` is cleared after fallback table generation so fallback metadata no longer mixes old per-paper merge counters with fallback output.
- Fallback skipped-recovery counters use `0` because Stage 3d is not applicable to single-call fallback output.

Fix verification:

- PASS: `node --check apps\desktop\electron\main.mjs`.
- PASS: `cmd /c npm run build` in `apps/desktop`.
- PASS: scoped fallback runtime generated table `6b62d202-5c2c-4ab1-a535-3092b7245c64`.
- PASS: table metadata now has `metadata.nullSummary === null`.
- PASS: table metadata now has `metadata.agenticRecovery.skippedReason === "single_call_fallback"`.
- PASS: `nullsBeforeRecovery` and `nullsAfterRecovery` are both `0`.
- PASS: temporary `paper_folders` membership was removed after verification.
- PASS: user LLM preference was restored to `gemma4:31b`.

Remaining quality issue:

- The scoped fallback table still ignored the user-requested `Paper title` column and returned extracted material-property columns instead. This confirms a broader fallback/table-spec adherence issue outside the metadata fix.

### V1 - Gate Not Met

Generate a table from papers that already have enough values, or ask a narrow question likely to produce few NULL cells.

Expected behavior:

- Stage 3d does not run when `nulls / totalCells < 0.05`.
- No `researching` status is emitted.
- Latest generated table metadata includes `agenticRecovery.attempted === false`.
- `agenticRecovery.skippedReason === "gate_not_met"`.

Evidence to capture:

```sql
select
  id,
  table_title,
  metadata->'agenticRecovery' as agentic_recovery
from chat_generated_tables
order by created_at desc
limit 5;
```

### V2 - No New Context

Generate a table with remaining NULL cells where the first-pass table context already contains the same chunk or figure ids that paper-scoped recovery finds.

Expected behavior:

- Stage 3d can enter recovery.
- Per-paper recovery result records a skip reason like `no_new_context`.
- `extractNullCellsFromPaper` is not called for papers without new context.
- The table remains unchanged except for metadata.

Pass criteria:

- No extra values are hallucinated into NULL cells.
- `nullsAfterRecovery` equals `nullsBeforeRecovery`.
- The UI does not show a failed chat message for this skip path.

### V3 - Successful High-Confidence Recovery

Generate a table that leaves at least one NULL cell after Stage 3c, but where paper-scoped recovery finds additional chunk or figure context.

Expected behavior:

- The renderer emits the `researching` stage.
- `extractNullCellsFromPaper` returns structured recovery candidates.
- `applyRecoveredValues` writes only high-confidence recovered values into existing NULL cells.
- `recoveredCellCount > 0`.
- `nullsAfterRecovery < nullsBeforeRecovery`.

Evidence to capture:

- Electron log lines around Stage 3d.
- Screenshot or note of `researching` status in the chat pipeline.
- Latest `chat_generated_tables.metadata.agenticRecovery`.
- Final generated table rows before/after if logs expose them.

### V4 - Low Confidence Is Ignored

Use a prompt/data combination where recovery has weak evidence, or temporarily inspect an LLM response that returns `confidence: "low"` or `"medium"`.

Expected behavior:

- Low/medium confidence candidates are recorded as attempted but not applied.
- Existing NULL cells stay NULL.
- No table row or column shape changes.

Pass criteria:

- No recovered value is applied unless confidence is exactly `"high"`.
- Metadata still explains the attempt.

### V5 - Abort And Timeout Safety

During the `researching` stage, abort the chat run from the UI if possible.

Expected behavior:

- Abort does not save a corrupted generated table.
- The active pipeline status clears or moves into the existing abort/error path.
- The next chat run can still start normally.

Timeout path:

- `extractNullCellsFromPaper` has a 30 second internal timeout.
- If the recovery helper times out internally, the Stage 3d path must fail soft and preserve the original merged table.

Pass criteria:

- No partial row mutation is saved after abort.
- A timeout does not crash Electron.
- Failure metadata or logs are enough to explain what happened.

## Local Runtime Setup

The owner already confirmed the vLLM server is running. Use the existing LLM settings path from the app rather than hardcoding a new endpoint.

Preferred launch order:

```powershell
cd frontend
cmd /c npm run build
cd ..\apps\desktop
cmd /c npm run start:electron
```

If live renderer mode is needed and Vite can start on this machine:

```powershell
cd frontend
cmd /c npm run dev -- --host 127.0.0.1
cd ..\apps\desktop
cmd /c npm run start:electron
```

Known environment note:

- Earlier sessions reported Vite dev/preview may fail with `spawn EPERM` from `esbuild`; fallback to built `frontend/dist` is acceptable.

## Blockers For Merge

Block the integration merge if any of these happen:

- Stage 3d metadata is missing from generated tables.
- A low or medium confidence candidate is applied.
- Recovery can overwrite a non-NULL cell.
- A failed recovery corrupts row or column shape.
- Abort leaves a stuck active chat run.
- Auth/RLS changes prevent the current signed-in user from reading their own generated table.
- The `researching` stage type breaks renderer status handling.

## Minimal Fix Rule

If verification finds a bug, patch only the narrow owning file:

- Recovery gate or application bug: `apps/desktop/electron/main.mjs`.
- LLM recovery schema/timeout bug: `apps/desktop/electron/llm-orchestrator.mjs`.
- UI status type/rendering bug: `frontend/src/types/desktop.ts` or `frontend/src/features/chat/ChatPipelineStatus.tsx`.

Do not combine Stage 3d fixes with merge conflict resolution. Each fix should be committed before integration work resumes.

## Next Step After This Plan

Execute V0 first. If V0 passes, run V1 and V2 in the Electron app. Only proceed to merge planning after at least one non-destructive Stage 3d runtime path has been observed and recorded.
