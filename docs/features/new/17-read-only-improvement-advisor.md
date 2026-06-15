# Read-Only Improvement Advisor

> Type: feature plan | Status: analyzer-only slice implemented | Created: 2026-06-01

## Summary

Redou should be able to inspect its own workspace state and suggest concrete product or workflow improvements to the user.

The first version must be read-only. It should not mutate papers, notes, jobs, settings, files, prompts, database rows, or code. It should produce suggestion cards backed by observable evidence from existing local data.

The intent is not "the app changes itself." The intent is "the app notices friction, quality gaps, and maintenance risks, then asks the user what to do next."

## Goals

- Surface useful improvement candidates from existing local Redou data.
- Keep the first implementation low-risk by avoiding persistent raw event collection.
- Explain every suggestion with evidence, impact, confidence, and recommended next action.
- Let the user dismiss, snooze, or convert a suggestion into a future task.
- Avoid storing paper text, note bodies, chat contents, or PDF contents as diagnostic data.

## Non-Goals

- No automatic code edits.
- No automatic DB repair or file mutation.
- No normal dev DB reset or migration application as part of analysis.
- No broad telemetry or cloud sync.
- No long-term storage of raw user behavior in the first version.
- No real-model quality benchmark in the first version.

## Product Shape

Working name: `Improvement Advisor`.

Likely UI location:

- Settings: small "Workspace health" card.
- Later: dedicated `Insights` or `Advisor` view if the cards become useful enough.

First screen should show a short prioritized list:

- `title`
- `category`
- `severity`
- `evidence`
- `why_it_matters`
- `recommended_next_action`
- `risk`
- actions: `Create task`, `Snooze`, `Dismiss`

Example card:

```text
Search quality may be weak

Evidence:
- 7 of the last 20 chat retrieval attempts returned no chunks.
- 3 papers have chunks but no embeddings.

Impact:
- Questions may fall back to no-data or weak answers.

Recommendation:
- Check embedding job failures first, then consider query expansion or BM25 fallback tuning.

Risk:
- Low. This is a read-only diagnostic.
```

## MVP Principle

Start with existing database state. Do not add `app_events` yet.

Reason:

- Redou already has enough state to detect many useful issues.
- A no-event MVP avoids storage growth, privacy concerns, and retention design.
- If the cards are useful, add short-lived raw events and daily rollups in a second slice.

## Read-Only Analyzers

### 1. Processing Health

Reads:

- `processing_jobs`
- `papers`
- `paper_files`
- `paper_chunks`
- `figures`
- `entities`
- `entity_relations`

Signals:

- queued/running jobs older than a threshold
- repeated failed jobs by `paper_id` or `job_type`
- papers with no primary PDF file
- papers with primary file rows but missing local path evidence
- papers with no chunks after extraction
- chunks without embeddings
- entity extraction version missing or stale
- entity rows with very low relation count

Useful suggestions:

- "Reprocessing controls should be easier to reach."
- "Embedding worker failure visibility needs improvement."
- "Entity relation extraction may need prompt or post-processing hardening."

### 2. Search And RAG Quality

Reads:

- existing chat messages and generated metadata where available
- `paper_chunks`
- `chunk_embeddings`
- `figures`
- generated table source references

Signals:

- no-data chat responses
- low chunk count for selected paper scopes
- missing embeddings for otherwise searchable papers
- generated answers or tables with few source references
- graph RAG enabled but graph evidence count is zero

First version caveat:

- Without event logs, the advisor can inspect stored outcomes but cannot reliably know every search attempt.
- That is acceptable for MVP.

Useful suggestions:

- "Add a visible search health indicator."
- "Improve fallback when semantic search has no embeddings."
- "Add graph relation diagnostics before investing in more graph UI."

### 3. Extraction Completeness

Reads:

- `paper_sections`
- `paper_chunks`
- `figures`
- `paper_files`
- `processing_jobs`

Signals:

- papers with zero sections
- papers with very low chunk count relative to PDF page count when page count exists
- figures with missing captions
- chunks/figures without page hints
- extraction succeeded but produced suspiciously sparse data

Useful suggestions:

- "Layout-aware extraction would have high impact."
- "Figure extraction needs page/caption diagnostics."
- "Paper detail should show extraction completeness warnings."

### 4. Table Quality

Reads:

- `chat_generated_tables`
- generated table metadata
- source refs / evidence locations

Signals:

- high NULL cell ratio
- high `single_call_fallback` usage
- missing source refs per row
- Guardian verification failures or unverified numeric cells
- repeated missing values for the same column names

Useful suggestions:

- "Stage 3d recovery should target specific recurring missing columns."
- "Source evidence display should be improved before adding more table automation."
- "Guardian verification needs clearer user-facing status."

### 5. Library Organization

Reads:

- `papers`
- `paper_folders`
- `folders`
- `paper_files`
- notes/highlights if available

Signals:

- papers without folders
- duplicate title/year candidates
- missing title/year/authors
- imported papers never opened or never processed
- folders with zero papers
- very large folders that may need subfolders

Useful suggestions:

- "Add automatic folder suggestions."
- "Add duplicate-paper review."
- "Add metadata repair workflow."

### 6. Notes And Highlight Use

Reads:

- `notes`
- `highlights`
- highlight presets
- source anchors

Signals:

- many highlights but few notes
- notes without source anchors
- highlights not linked to notes
- papers frequently used but not summarized

Useful suggestions:

- "Offer highlight-to-summary conversion."
- "Add note anchor repair."
- "Suggest a paper summary when many highlights exist."

## Data Requirements

The MVP does not require large new data.

It can run from current state:

- papers
- paper files
- processing jobs
- chunks
- embeddings
- figures
- entities and relations
- generated tables
- notes/highlights
- folders

No raw event stream is required for MVP.

## Optional Phase 2: Short-Lived Events

If the MVP proves useful, add `app_events` with strict retention.

Example event categories:

- `search.no_results`
- `chat.no_data`
- `import.cancelled`
- `import.failed`
- `settings.changed`
- `paper.opened`
- `dialog.dismissed`

Retention:

- raw events: 30 days by default
- daily rollups: 1 year
- no paper text, note bodies, PDF text, or chat content in events by default

Example raw event shape:

```json
{
  "event_type": "search.no_results",
  "created_at": "2026-06-01T00:00:00Z",
  "scope": "library",
  "metadata": {
    "result_count": 0,
    "duration_ms": 420,
    "has_embeddings": true
  }
}
```

Example daily rollup:

```json
{
  "date": "2026-06-01",
  "metric": "search.no_results.count",
  "value": 12
}
```

## Suggestion Model

Suggested internal shape:

```ts
type AdvisorSuggestion = {
  id: string;
  category:
    | "processing"
    | "search"
    | "extraction"
    | "table"
    | "library"
    | "notes"
    | "ux";
  severity: "info" | "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  title: string;
  evidence: Array<{
    label: string;
    value: string | number;
    source: string;
  }>;
  whyItMatters: string;
  recommendedAction: string;
  risk: string;
  createdAt: string;
};
```

The first version can compute suggestions on demand and does not need to persist them.

Persist only user dispositions later:

- dismissed suggestion id
- snooze until date
- created task reference

## LLM Use

MVP should not require an LLM.

Recommended split:

- deterministic analyzers produce evidence and candidate suggestions
- optional LLM turns evidence into clearer prose
- LLM never invents evidence
- LLM output must include only IDs and evidence already supplied by analyzers

This keeps the advisor useful in offline/local mode and avoids making diagnostics depend on model quality.

## Privacy And Storage Rules

- Do not store PDF body text in diagnostic logs.
- Do not store note body text in diagnostic logs.
- Do not store chat prompt text in diagnostic logs by default.
- Prefer counts, ratios, durations, statuses, and row IDs.
- Any raw event retention must be visible in Settings.
- Provide a clear "clear diagnostics" action before raw event logging is enabled.

## Implementation Slices

### Slice 1: Read-Only Analyzer Module

Add a desktop or frontend-side service that reads existing repository data and returns suggestion candidates.

Candidate path:

- `frontend/src/features/advisor/`
- or `frontend/src/lib/advisor/`

No DB migrations.

Tests:

- fixture-based unit tests for analyzer outputs
- no Electron launch required

### Slice 2: Advisor UI Card

Add a small Settings card or simple Advisor view.

Controls:

- refresh
- dismiss in memory
- show evidence

No persistence required yet.

### Slice 3: Persist Dispositions

If the UI is useful, add lightweight persistence for:

- dismissed
- snoozed
- converted to task/doc

This may require a migration.

### Slice 4: Optional Event Logging

Only after read-only suggestions prove useful.

Add:

- `app_events`
- `app_event_daily_rollups`
- retention cleanup
- Settings controls

Keep this separate from MVP.

## First MVP Suggestions

Recommended initial suggestion set:

1. Processing jobs stuck or repeatedly failed.
2. Papers imported but not searchable because chunks or embeddings are missing.
3. Tables with high NULL ratio or missing source refs.
4. Papers with sparse extraction outputs.
5. Library cleanup candidates: missing metadata, no folder, duplicate candidates.

These are high-signal and require no new event collection.

## Acceptance Criteria For MVP

- The advisor can run without mutating any database rows.
- It returns at least five suggestion categories from fixture data.
- Every suggestion includes evidence source and a recommended action.
- Suggestions do not include raw PDF text, note body text, or chat prompt text.
- The UI clearly labels suggestions as advisory, not automatic fixes.
- The feature works when LLM features are unavailable.

## Risks

- False positives: noisy suggestions can erode trust.
- Overreach: the app may imply it understands more than it does.
- Privacy: behavior logs can become sensitive if not scoped tightly.
- Storage creep: raw events can grow without retention.
- Misprioritization: easy-to-measure issues may crowd out important product work.

Mitigations:

- Start read-only and evidence-first.
- Keep suggestion count small.
- Require user action before any mutation.
- Add raw events only after the first version proves useful.
- Make retention and clearing diagnostics explicit.

## Open Questions

1. Should the first UI live in Settings or a dedicated Advisor view?
2. Should suggestions be computed on demand or cached for a day?
3. Should dismissed suggestions persist before the event-log phase?
4. Should "Create task" write to the codex-claude exchange, a local markdown file, or a future issue tracker?
5. Which analyzer should be first: processing health, RAG quality, or table quality?

## Recommended First Slice

Build only a read-only analyzer first. A simple Settings card can follow after the data wiring shape is clear.

Start with:

- processing health
- searchable-data health
- table NULL/source-ref health
- extraction completeness
- library cleanup

Defer:

- raw app events
- daily rollups
- LLM prose generation
- automatic task creation
- real UX friction analysis

## Implementation Update - 2026-06-01

Status: analyzer-only slice and snapshot adapter implemented.

What landed:

- Added `frontend/src/lib/advisor/types.ts` with the read-only suggestion contract and lightweight workspace snapshot types.
- Added `frontend/src/lib/advisor/analyzeWorkspace.ts`, a pure deterministic analyzer with no Supabase, React Query, Electron, migration, event logging, or LLM dependency.
- Added `frontend/src/lib/advisor/index.ts` exports.
- Added `frontend/src/lib/advisor/analyzeWorkspace.test.ts` fixture coverage for processing, search, extraction, table, and library suggestions.
- Added `frontend/src/lib/advisor/buildWorkspaceSnapshot.ts`, a pure adapter from existing frontend domain data into `AdvisorWorkspaceSnapshot`.
- Added `frontend/src/lib/advisor/buildWorkspaceSnapshot.test.ts` coverage for paper/chunk/job/table/folder mapping and analyzer interop.

Verification:

- First frontend Vitest run hit the known sandbox `spawn EPERM`; approved rerun passed.
- `cmd /c npm run test -- --run src/lib/advisor/analyzeWorkspace.test.ts` passes: 1 test file, 2 tests.
- `cmd /c npm run test -- --run src/lib/advisor/analyzeWorkspace.test.ts src/lib/advisor/buildWorkspaceSnapshot.test.ts` passes: 2 test files, 4 tests.
- `cmd /c npm run build` in `frontend` passes with existing large chunk warnings.

Next recommended slice:

- Build read-only query/data loading from existing app repositories into the snapshot adapter.
- Optionally add a small Settings card or dedicated advisor panel after the data shape is proven.
