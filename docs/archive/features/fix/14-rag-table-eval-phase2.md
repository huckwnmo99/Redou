# Phase 2 RAG/Table Eval Schema Plan

Status: Phase 2B runnable tracer in progress
Date: 2026-05-25

## Context

Phase 1 built a disposable Supabase integration harness and a tiny deterministic golden-path fixture. It now covers:

- a paper-to-RAG-to-table happy path;
- table abort safety;
- non-abort per-paper extraction fallback;
- one queued embedding worker failure path.

Claude accepted Phase 1C closure on 2026-05-25 and recommended moving to Phase 2 instead of adding more failure-path variants.

## Goal

Define a small RAG/table eval schema before implementing a runner.

The first eval layer should answer:

1. Did RAG retrieve the expected paper evidence for a query?
2. Did table generation preserve the requested headers and expected cells?
3. Did evidence/source references stay honest enough to diagnose failures?

## Non-Goals

- Do not call real MinerU, GROBID, Ollama, Transformers, or remote LLMs.
- Do not launch browser UI or the Electron app.
- Do not claim the golden-path fixture exercises real import/extraction; it is still row-seeded.
- Do not tune RAG weights or table prompts in this slice.
- Do not build a large benchmark suite before the first tiny eval proves the schema.

## Phase 2A Deliverables

- `docs/harness/evals/README.md`: eval corpus layout and run philosophy.
- `docs/harness/evals/rag-table-eval-schema.md`: v0 schema for RAG and table eval cases.
- `docs/harness/decisions/0007-rag-table-eval-strategy.md`: accepted strategy proposal for deterministic local evals.
- Claude review request before runtime evaluator implementation.

## Eval Case Shape

The schema is intentionally small and JSON-friendly.

Common fields:

- `id`: stable eval id.
- `description`: short human-readable intent.
- `fixture`: fixture corpus id, initially `golden-path`.
- `mode`: `rag_retrieval`, `table_generation`, or `combined`.
- `input`: query, table request, scope, and fake-service scenario.
- `expected`: observable expectations.
- `metrics`: scoring rules and pass thresholds.

RAG expected fields:

- `mustIncludeChunks`: chunk ids that must appear by rank ceiling.
- `mustIncludeFigures`: figure ids that must appear by rank ceiling.
- `forbiddenPaperIds`: paper ids that must not appear.
- `sourceCoverage`: expected paper/source-file labels.

Table expected fields:

- `headers`: exact expected headers after normalization.
- `cells`: row/column/value matchers.
- `references`: expected paper ids or ref numbers.
- `metadata`: required metadata keys such as `extractionMode` or `sourceEvidenceLocations`.

## First Tiny Eval Set

The first eval set should reuse the existing golden-path fixture and contain only two cases:

1. `golden-path-table-rag`: table-mode RAG should retrieve the fixture chunk and table figure for the adsorption-capacity query.
2. `golden-path-table-output`: table generation with deterministic fake services should persist the expected headers/cells and source metadata.

This is deliberately smaller than a benchmark. Its purpose is to validate the schema and runner contract.

## Runtime Strategy After Review

Claude accepted Phase 2A on 2026-05-25 with one P2: a `cellExactMatchMin` threshold is too weak for a three-cell tiny table. Phase 2B therefore starts with:

1. Strengthen the table cell gate to `cellExactMatch: "all_asserted"`.
2. Add JSON eval fixtures under `apps/desktop/tests/fixtures/evals/`.
3. Add a small evaluator helper that can run the golden-path RAG/table cases against the disposable Supabase target.
4. Reuse `npm run test:integration:supabase` unless the current integration runner becomes too crowded.

## Known Gaps To Preserve

- The golden-path fixture seeds paper/chunk/figure rows directly; it does not validate real PDF import/extraction.
- The first eval set has one paper and one table question, so it cannot measure broad retrieval quality.
- The first table eval uses deterministic fake LLM responses, so it validates Redou pipeline contracts rather than model quality.
- Metrics should be treated as schema and harness checks until a broader corpus exists.

## Review Questions

1. Is this schema small enough for the first Phase 2 eval runner?
2. Are the proposed RAG/table metrics the right first contract surface?
3. Should Phase 2B implement JSON schema validation first, or go directly to a runnable disposable-Supabase eval case?
