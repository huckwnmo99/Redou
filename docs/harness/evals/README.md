# Redou Eval Harness

Status: v0 schema draft
Date: 2026-05-25

This directory defines deterministic local evals for Redou retrieval and table generation.

The eval harness is not a model benchmark yet. The first purpose is to catch regressions in Redou's RAG/table pipeline contracts using the existing disposable Supabase fixture strategy.

## Layout

```text
docs/harness/evals/
  README.md
  rag-table-eval-schema.md

apps/desktop/tests/fixtures/evals/
  golden-path-v0.json
  adsorption-groundtruth-v0.json

apps/desktop/scripts/
  pdf-page-text.mjs        # ground-truth extraction tool (manual, pure pdfjs)
  e2e-table-fidelity.mjs   # live E2E → table_fidelity report (manual, CI-off)
```

Runtime eval fixture files belong under `apps/desktop/tests/fixtures/evals/`. This docs directory owns the schema and policy.

## Principles

- Keep cases tiny until the runner is proven.
- Prefer stable ids and normalized values over broad text snapshots.
- Assert observable pipeline outputs, not private implementation steps.
- Keep external services fake or deterministic.
- Run real Supabase/RPC behavior only against disposable local targets.
- Record known gaps instead of implying the eval measures the full product.

## Eval Types

`rag_retrieval`

- Verifies query-to-evidence behavior.
- First metrics: required chunk/figure within rank ceiling, no forbidden paper ids, source-label coverage.

`table_generation`

- Verifies persisted table shape and metadata.
- First metrics: header exact match, normalized cell match, source/reference coverage, required metadata keys.

`combined`

- Verifies retrieval and table generation in one case.
- Use sparingly because failures are harder to diagnose.

`table_fidelity` (score mode)

- Grades a persisted generated table against hand-verified ground-truth cells
  taken directly from the source PDF tables.
- Reports scores (fidelity / misattribution / fabrication / conflictHandling),
  not pass/fail, so it can judge extraction changes and Phase 3 A/B swaps.
- Schema + report axes: `rag-table-eval-schema.md` (Table Fidelity section).

## Ground-Truth Fixture

`table_fidelity` needs values that are **actually in the paper**, not values we
wish for. The first ground-truth corpus is `adsorption-groundtruth-v0.json`: two
hand-verified papers (KOH-treated activated carbon; zeolite 13X) with their
isotherm `q_m` parameters and conditions from the original PDF Tables 3/4.

This is the start of a Dagdelen-style ground-truth store (Nat. Commun. 2024):
accumulating hand-verified answers is itself a durable asset — the fixture format
outlives any single model or parser and becomes the judge for prompt changes and
Phase 3 tool A/B.

### How to (re)generate ground truth

1. Extract the relevant table pages from the original PDF (pure pdfjs, no
   services): from `apps/desktop`,
   `node scripts/pdf-page-text.mjs "<pdf path>" <page> [<page> ...]`
   (on Git Bash pipe through `tr -d '\000'` before grepping — the text can
   contain NUL bytes).
2. Read off the parameter, unit, and condition (pressure range / temperature)
   for each cell. Record `paperId`, `identity` (row tokens, **not** the
   condition), `column`, `value`, `unit?`, `condition?`, `sourceTable`.
3. Mark inherently condition-mixed columns (same parameter reported under two
   conditions, e.g. `q_m` in both `<=1000 kPa` Table 3 and `<=100 kPa` Table 4)
   in `conditionMixedColumns` so `conflictHandling` can be scored.
4. Cross-check against any prior hand-collation notes (ledger
   `pipeline-risk-audit` / `table-semantics-hardening` "원문 대조"), but the PDF
   is the source of truth.

### Recording a current score (live E2E)

`node scripts/e2e-table-fidelity.mjs` (from `apps/desktop`) runs the real table
pipeline against live Supabase/Ollama/vLLM and prints a `table_fidelity` report.
It is **manual and CI-off** (many minutes, real services, non-deterministic
LLM). The deterministic regression tests live in
`apps/desktop/tests/table-fidelity.test.mjs` on fixed synthetic tables.

Measurement protocol env (the LLM varies ~23%p run-to-run, so a single run
cannot judge a before/after change):

- `REDOU_E2E_RUNS` — number of pipeline runs (default 1, recommend 3). Runs the
  pipeline N times (fresh conversation each) and reports the **median** overall
  fidelity plus min/max/spread. Example:
  `REDOU_E2E_RUNS=3 node scripts/e2e-table-fidelity.mjs`.
- `REDOU_E2E_SCOPE` — optional scope label (e.g. `low_pressure`, comma-separated
  for several). When the query targets one scenario, grades against just that
  golden subset (see the schema doc's "Query-scoped grading").

A run that ends in **clarify / no-data** (the pipeline returns `hasTable:false`
and persists an assistant message instead of a table) is reported as `[CLARIFY]`
and **excluded from the fidelity sample** — it is "not measurable", not "0%
fidelity". The script exits 0 even if every run clarifies.

## First Corpus

The first corpus is `golden-path`.

It reuses the existing integration fixture:

- one paper;
- one section;
- one chunk;
- one table figure;
- deterministic 2048-dim embedding;
- deterministic LLM/table fake responses.

This corpus is intentionally too small to estimate user-facing model quality. It is large enough to verify eval schema and runner mechanics.
