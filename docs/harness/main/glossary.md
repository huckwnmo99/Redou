# Redou Glossary

Status: canonical glossary
Last updated: 2026-05-08

This file owns Redou's canonical project language. `CONTEXT.md` is only an index.

## Main PDF

The primary paper PDF imported for a paper record.

The main PDF is represented by a `paper_files` row with `is_primary = true`. It is the default source for paper reading, primary extraction, paper-level metadata, and the first processing pipeline run.

Main PDF extraction must not be overwritten by later supplementary PDF processing.

## Supplementary PDF

An additional PDF attached to an existing paper.

A supplementary PDF is represented by a non-primary `paper_files` row, currently with `file_kind = 'supplementary_pdf'`. It may produce its own sections, chunks, figures, tables, equations, and RAG evidence, but it belongs to the same paper record.

Supplementary PDF evidence should keep the normal paper citation number, then mark the source line or source label as supplementary.

Example:

```text
[3] source: Supplementary: file-name.pdf, p. 4
```

## Source File

A concrete file associated with a paper, stored as a `paper_files` row.

Source files include the main PDF and supplementary PDFs. Future source files may include converted DOCX/DOC files if they are normalized into PDF before extraction.

Source file identity is important because extraction rows can belong to a paper but still come from different files.

## `source_file_id`

The database foreign key that identifies which `paper_files` row produced an extracted row or processing job.

Current source-scoped entities include processing jobs and extraction outputs such as sections, chunks, and figures. A source-scoped pipeline must delete and replace rows only for its own `source_file_id`, not all rows for the paper.

## Evidence Location

A human-readable location for where a claim, table cell, chunk, or source reference came from.

Examples:

- `Main PDF, p. 7`
- `Supplementary: appendix-a.pdf, p. 3`
- `Table 2`
- `Section 3.1`

Evidence locations are display labels, not ownership checks. Ownership and source identity must come from IDs such as `paper_id` and `source_file_id`.

## Generated Table

A structured table produced by the chat/table pipeline and persisted in `chat_generated_tables`.

Generated tables should retain:

- conversation ownership
- table title
- headers and rows
- source references
- verification metadata
- Stage 3d / agentic recovery metadata when applicable

Generated table persistence must remain scoped to the authenticated user through the owning conversation.

## Agentic Recovery

An LLM-assisted recovery pass that tries to fill missing structured table values after normal extraction and merge stages have already run.

In the current pipeline, Agentic Recovery refers to Stage 3d. It should be treated as a bounded recovery mechanism, not as permission to invent values. Recovered values are applied only when they meet the stage confidence rules.

## Stage 3d

Stage 3d is Agentic NULL Recovery in the structured table pipeline.

It runs after Stage 3c merge and before final table persistence when enough NULL cells remain. It performs paper-scoped recovery search and applies only high-confidence recovered values.

Important Stage 3d outputs:

- `agenticRecovery`
- `nullSummary`
- `stage: "researching"` status event
- `skippedReason`, including `single_call_fallback` where applicable

Stage 3d must not be bypassed by future RAG, graph search, or table pipeline refactors.

## RAG Context

The set of retrieved chunks, figures, tables, equations, source labels, and optional graph/entity hits passed to an LLM for answering or table generation.

RAG context is evidence input, not final truth. It should carry enough source metadata for answers and tables to expose where the information came from.

## Chunk

A text unit stored in `paper_chunks`.

Chunks are the primary text retrieval unit for embedding search, BM25 search, RAG context assembly, and table extraction. A chunk belongs to a paper and may also belong to a specific `source_file_id`.

## Figure / Table / Equation

Structured visual or layout-derived evidence stored in the `figures` table.

The `item_type` discriminator separates figure-like, table-like, and equation-like records. RAG and table generation should preserve this distinction because table and equation evidence often needs different prompts, labels, and verification than ordinary prose chunks.

## Hybrid Search

The retrieval approach that combines vector similarity and lexical BM25 results.

Hybrid search commonly uses Reciprocal Rank Fusion (RRF) or similar rank combination so semantically similar chunks and exact keyword matches can both reach RAG context.

## Reranker

A second-pass ranking model that reorders candidate retrieval results after initial vector/BM25 retrieval.

Redou currently uses a cross-encoder style reranker where available. The reranker should improve ordering but should not remove required ownership, folder scope, or source-file checks.

## Orchestrator

The LLM-driven planning step for chat/table requests.

The orchestrator interprets the user's message, decides whether to clarify or generate/modify a table, and produces search queries plus a table specification for later stages.

## Table Agent

The table-generation agent that turns RAG context and a table specification into structured JSON table output.

The Table Agent should obey the requested table schema and should preserve source references. It is distinct from retrieval, per-paper extraction, merge, and Stage 3d recovery.

## Per-Paper Extraction Agent

The structured extraction step that extracts requested table columns from one paper's assembled context.

This stage is part of SRAG. It works per paper so later merge and verification stages can compare paper-level evidence and preserve paper references.

## Processing Job

A queued local desktop work item stored in `processing_jobs`.

Current examples:

- `import_pdf`
- `generate_embeddings`

`origin/main` also introduces entity graph related work such as entity extraction/backfill. Integration must preserve both the current supplementary/source-file behavior and the entity graph job behavior.

A processing job may be paper-scoped and source-file-scoped. If `source_file_id` is present, the worker should process only that source file.

## Job Status

The state of a `processing_jobs` row.

Common statuses are:

- `queued`
- `running`
- `succeeded`
- `failed`

The UI may surface job status to explain whether a paper is ready, processing, or failed. Code should not infer source ownership from status alone.

## Paper Reference

A numbered paper citation used in chat and generated table outputs.

Example:

```text
[3] Doe et al., 2024
```

Paper references identify the paper. They do not by themselves distinguish main PDF from supplementary evidence. Use source evidence labels for that.

## Source Evidence Label

The display label that clarifies whether evidence came from the main PDF or a supplementary file.

The citation number should remain paper-level, while the evidence label carries source-file detail.

Examples:

- `[3] source: Main PDF, p. 5`
- `[3] source: Supplementary: methods.pdf, p. 2`

## Runtime Refactor

Any code movement that changes Electron main process, IPC handlers, preload contract, chat/table pipeline, import/processing workers, or frontend runtime contracts.

Runtime refactor is currently blocked on branch hygiene and integration risk unless the user explicitly approves deferring integration.

## Docs-Only Work

Work that changes only planning, glossary, ADR, agent coordination, or harness documentation.

Docs-only work may proceed before integration as long as it does not pretend a runtime behavior has already changed.
