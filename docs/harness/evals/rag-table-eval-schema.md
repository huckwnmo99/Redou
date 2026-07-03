# RAG/Table Eval Schema

Status: v0 draft
Date: 2026-05-25

## Case Envelope

```json
{
  "id": "golden-path-table-rag",
  "description": "Table-mode RAG retrieves the expected adsorption evidence.",
  "fixture": "golden-path",
  "mode": "rag_retrieval",
  "input": {},
  "expected": {},
  "metrics": {}
}
```

Required fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable, kebab-case id. |
| `description` | string | One-sentence behavior description. |
| `fixture` | string | Fixture corpus id. Initial value: `golden-path`. |
| `mode` | string | `rag_retrieval`, `table_generation`, or `combined`. |
| `input` | object | Query/request/scope/fake-service input. |
| `expected` | object | Observable expected outputs. |
| `metrics` | object | Pass thresholds and scoring rules. |

## RAG Retrieval Input

```json
{
  "mode": "rag_retrieval",
  "input": {
    "ragMode": "table",
    "queries": [
      {
        "query": "adsorption capacity 42 mmol/g",
        "intent": "primary"
      }
    ],
    "keywordHints": ["adsorption", "capacity"],
    "filterPaperIds": ["10000000-0000-4000-8000-000000000101"]
  }
}
```

## RAG Retrieval Expected Output

```json
{
  "expected": {
    "mustIncludeChunks": [
      {
        "chunkId": "10000000-0000-4000-8000-000000000401",
        "rankAtOrBefore": 1
      }
    ],
    "mustIncludeFigures": [
      {
        "figureId": "10000000-0000-4000-8000-000000000501",
        "rankAtOrBefore": 5
      }
    ],
    "forbiddenPaperIds": [],
    "sourceCoverage": [
      {
        "paperId": "10000000-0000-4000-8000-000000000101",
        "sourceFileId": "10000000-0000-4000-8000-000000000201"
      }
    ]
  },
  "metrics": {
    "chunkRecallAtK": {
      "k": 5,
      "min": 1
    },
    "figureRecallAtK": {
      "k": 10,
      "min": 1
    },
    "forbiddenPaperCount": {
      "max": 0
    }
  }
}
```

## Table Generation Input

```json
{
  "mode": "table_generation",
  "input": {
    "conversationId": "10000000-0000-4000-8000-000000000601",
    "ownerId": "10000000-0000-4000-8000-000000000001",
    "ownerPaperIds": ["10000000-0000-4000-8000-000000000101"],
    "message": "Create a table with material, adsorption capacity, and condition.",
    "fakeServiceScenario": "happyPath"
  }
}
```

## Table Generation Expected Output

```json
{
  "expected": {
    "tableTitle": "Adsorption capacity table",
    "headers": ["Material", "Capacity", "Condition"],
    "cells": [
      {
        "row": 0,
        "column": "Material",
        "equalsNormalized": "Golden Path Framework [1]"
      },
      {
        "row": 0,
        "column": "Capacity",
        "equalsNormalized": "42 mmol/g [1]"
      },
      {
        "row": 0,
        "column": "Condition",
        "equalsNormalized": "298 K, 1 bar [1]"
      }
    ],
    "references": [
      {
        "paperId": "10000000-0000-4000-8000-000000000101",
        "refNo": "1"
      }
    ],
    "metadata": {
      "requiredKeys": [
        "extractionMode",
        "sourceEvidenceLocations"
      ],
      "extractionMode": "per_paper"
    }
  },
  "metrics": {
    "headerExactMatch": true,
    "cellExactMatch": "all_asserted",
    "requiredMetadataKeysPresent": true
  }
}
```

## Table Fidelity (score mode)

`table_fidelity` grades a persisted generated table against **hand-verified
ground-truth cells taken directly from the source PDF tables**. Unlike
`table_generation` (binary pass/fail on a seeded golden-path table), this mode
reports **scores** so it can grade extraction changes and Phase 3 A/B swaps
(docling / LangExtract). It reuses `normalizeEvalString`; no live services.

Runner: `evaluateTableFidelityCase(groundTruthBlock, tableRow)` and
`evaluateTableFidelityFixture(groundTruth, tableByPaperId)` in
`apps/desktop/tests/integration/support/eval-runner.mjs`.

Ground-truth fixture schema `table-fidelity-v0`
(`apps/desktop/tests/fixtures/evals/adsorption-groundtruth-v0.json`):

```json
{
  "schemaVersion": "table-fidelity-v0",
  "fixture": "adsorption-groundtruth",
  "papers": [
    {
      "paperId": "5e0f399d-...",
      "provenance": "Table 4 (page 6), qm1 in mol/kg + MAPE %.",
      "conditionMixedColumns": [{ "column": "q_m", "note": "same param, two pressure ranges (D1)" }],
      "groundTruthCells": [
        { "identity": ["Ethane", "DSL"], "column": "q_m", "value": "2.400", "unit": "mol/kg", "condition": "~600 kPa", "sourceTable": "Table 4" }
      ]
    }
  ]
}
```

Cell fields:

| Field | Type | Notes |
|-------|------|-------|
| `identity` | string[] | Row identity tokens (adsorbent/gas/model). **Not** the condition. All must appear (case-insensitive substring) in the row's cells. |
| `column` | string | Target column; matched tolerantly (separators/case stripped, substring fallback) so `q_m` binds to `q_m (mol/kg)`. |
| `value` | string | Exact expected value; compared after `normalizeEvalString` + citation-tag strip. |
| `unit` / `condition` | string? | Documentation + condition disambiguation (which pressure range / temperature the value belongs to). |
| `sourceTable` | string? | Provenance (`Table 3` / `Table 4`) for auditability. |

Report axes (per paper block):

- **fidelity** `{matched, total, score}` — ground-truth cells found at the right
  identity+column with the right value **and** the correct condition kept on the
  row (identity cells or `metadata.cellTuples[r][c].condition`).
- **misattribution** `{count, cells}` — value is present but under the wrong /
  missing condition (D1: same parameter, two conditions collapsed).
- **fabrication** `{count, cells}` — numeric cells in ground-truth columns, inside
  identity-matched rows, whose value appears in **no** ground-truth cell for that
  paper (D2/D4 made-up values). Conservative (fixture is a curated subset, so this
  is scoped to matched rows + known columns, not the whole table).
- **conflictHandling** `{expected, detected, score}` — did
  `metadata.conditionConflicts` flag the columns the fixture marks
  `conditionMixedColumns` (D1 detection surfaced by Phase 1).
- **missing** `{count, cells}` — ground-truth cells with no matching value at all.

Scoring is non-binary by design (ADR 0007: "Future runners may report scores
separately from pass/fail"). A regression gate (e.g. fidelity must not drop) is
optional and, if used, should run on a **deterministic synthetic `tableRow`** —
the live E2E table output is non-deterministic (local LLM), so it is for
**recording the current score**, not for CI gating.

## Normalization Rules

Initial normalization should be intentionally boring:

- trim leading/trailing whitespace;
- collapse repeated whitespace to one space;
- compare strings case-sensitively unless a case-insensitive matcher is explicitly chosen;
- do not strip citation tags unless the matcher says so.

## Pass/Fail Rules

The first runner should fail a case when any required metric fails.

For table cells, `cellExactMatch: "all_asserted"` means every cell listed under `expected.cells` must match after normalization. A minimum passing count is intentionally not part of v0 because it can let a mostly-wrong tiny table pass.

Future runners may report scores separately from pass/fail, but the v0 gate should stay binary so it is useful in CI and local smoke checks.

## Versioning

Add `schemaVersion` to runtime JSON fixtures when Phase 2B creates them. The draft version is `rag-table-eval-v0`.
