# Read-only First Before Event Logging

Status: archived
Type: decision
Created: 2026-06-01
Updated: 2026-06-01
Related: ../../README.md
Archive Index: ../README.md

## Decision

The Improvement Advisor should start by analyzing existing local Redou database state. It should not add raw event logging, daily rollups, migrations, or LLM-required diagnostics in the MVP.

## Context

The user wants the app to notice where it can improve and propose those improvements. The main concern is whether this requires large or ever-growing data. Redou already stores useful local state for processing jobs, papers, chunks, embeddings, figures, generated tables, notes, highlights, folders, entities, and relations.

## Options Considered

- Read-only analyzer first - Low storage, low privacy risk, no migrations, enough signal for an MVP.
- Raw event stream first - Better UX friction visibility, but adds retention, privacy, and storage design immediately.
- LLM-first advisor - Faster prose, but risks invented evidence and makes diagnostics depend on model availability.

## Chosen Because

Existing Redou data can already expose high-signal issues: stuck jobs, missing chunks or embeddings, sparse extraction, table NULL/source-ref problems, and library cleanup candidates. This avoids making the first version heavier than the product question requires.

## Consequences

- MVP suggestions may miss UX friction that only event logs can reveal.
- Suggestion evidence stays explainable and local.
- Event logging remains available as a later phase with explicit TTL and daily rollup rules.
- LLM prose generation can be layered on top of deterministic analyzer evidence later.

## Revisit Trigger

Revisit this decision if read-only suggestions are useful but repeatedly fail to explain real UX friction, such as repeated dialog cancellation, repeated searches, or abandoned workflows.
