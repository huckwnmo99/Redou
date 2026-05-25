# ADR 0007: RAG/Table Eval Strategy

Status: proposed
Date: 2026-05-25

## Context

Phase 1 created a disposable Supabase test target and a golden-path fixture. The harness now catches several pipeline and failure-path regressions, but it does not yet define a reusable eval corpus or scoring schema.

The next roadmap step is Phase 2: RAG/table eval schema plus a first tiny eval set.

## Decision

Adopt a deterministic local eval strategy before building a larger benchmark.

The first eval schema will:

- use JSON-friendly cases;
- separate `rag_retrieval`, `table_generation`, and `combined` modes;
- measure required chunk/figure retrieval by rank ceiling;
- measure table headers, normalized cells, references, and required metadata;
- run real Supabase/RPC behavior only against disposable local targets;
- keep LLM and embedding boundaries deterministic until a separate model-quality benchmark exists.

## Rationale

Redou's current risk is not only model quality. The immediate risk is silent contract drift:

- RAG may stop returning the expected evidence;
- table generation may persist plausible but incorrectly shaped tables;
- evidence metadata may become incomplete;
- fixture tests may overclaim what they cover.

A tiny deterministic eval set gives the project a stable regression language before adding corpus size or model variability.

## Consequences

- Phase 2A is docs/schema only.
- Phase 2B should add JSON eval fixtures and schema validation before or alongside the first runnable eval helper.
- The first eval set should reuse the golden-path fixture rather than inventing a new corpus.
- The eval docs must keep the known gap explicit: row-seeded golden-path data does not validate the real import/extraction chain.

## Open Follow-Up

Claude should review whether Phase 2B should implement:

1. JSON schema validation first; or
2. a runnable disposable-Supabase eval case first.
