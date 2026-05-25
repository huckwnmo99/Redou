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
    "cellExactMatchMin": 1,
    "requiredMetadataKeysPresent": true
  }
}
```

## Normalization Rules

Initial normalization should be intentionally boring:

- trim leading/trailing whitespace;
- collapse repeated whitespace to one space;
- compare strings case-sensitively unless a case-insensitive matcher is explicitly chosen;
- do not strip citation tags unless the matcher says so.

## Pass/Fail Rules

The first runner should fail a case when any required metric fails.

Future runners may report scores separately from pass/fail, but the v0 gate should stay binary so it is useful in CI and local smoke checks.

## Versioning

Add `schemaVersion` to runtime JSON fixtures when Phase 2B creates them. The draft version is `rag-table-eval-v0`.
