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
  golden-path-v0.json        # planned in Phase 2B
```

Runtime eval fixture files belong under `apps/desktop/tests/fixtures/evals/` once a runner exists. This docs directory owns the schema and policy.

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
