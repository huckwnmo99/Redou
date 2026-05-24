# Harness Fixtures

Status: runtime fixture created
Date: 2026-05-23

This directory documents the canonical fixture corpus for reliability tests.

It began as a contract first. The first runtime test artifacts now live in `apps/desktop/tests/fixtures/golden-path/`.

## Layout

```text
docs/harness/fixtures/
  README.md
  golden-path/
    README.md
```

Runtime layout:

```text
apps/desktop/tests/fixtures/
  golden-path/
    source/
    expected/
    fakes/
```

## Fixture Rules

- Keep fixtures tiny and deterministic.
- Prefer normalized JSON outputs over large opaque snapshots.
- Do not store user documents, private PDFs, API keys, or real model responses copied from private runs.
- Every fixture should name the workflow contract it verifies.
- Every expected output should explain whether order, score, or exact text is significant.
- If a fixture must change, update the related test intent and this documentation in the same slice.

## Current Fixture Sets

| Fixture | Status | Purpose |
|---------|--------|---------|
| `golden-path` | implemented as opt-in integration fixture | First deterministic paper/chunk/embedding/search/table persistence spine |
