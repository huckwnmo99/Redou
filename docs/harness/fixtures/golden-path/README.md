# Golden-Path Fixture

Status: implemented as opt-in integration fixture
Date: 2026-05-23

This fixture set backs the first desktop integration test:

```text
apps/desktop/tests/integration/golden-path.test.mjs
```

## Goal

Verify one deterministic Redou research workflow from imported paper data through persisted extraction/search/table outputs, without browser UI and without real external services.

## Runtime Artifacts

```text
apps/desktop/tests/fixtures/golden-path/
  README.md
  source/
    paper.metadata.json
  expected/
    extraction.json
    table.json
  fakes/
    embedding-service.json
    llm-service.json
```

The first implementation uses a fixture extraction result instead of a real PDF. The workflow contract is more important than exercising real PDF parsing in the first golden-path test.

## Minimum Assertions

- The test database starts empty for the fixture user.
- A paper and primary paper file are persisted.
- Processing jobs reach terminal expected states in order.
- Sections, chunks, figures, and 2048-dim embeddings are persisted with stable source/page hints.
- Search/RAG results are deterministic enough to assert normalized ranking.
- Table persistence stores cells, source refs, evidence metadata, and completion messages.
- No path or database URL targets user development data.

`embedding-service.json` must produce deterministic 2048-dim vectors. Smaller vectors are invalid for the current `vector(2048)` schema.

## Run Contract

Default safety run:

```powershell
cd apps/desktop
cmd /c npm run test:integration
```

The real DB spine runs only when these variables point at a disposable local Supabase target:

```powershell
$env:REDOU_TEST_SUPABASE_URL="http://127.0.0.1:<test-api-port>"
$env:REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY="<test-service-role-key>"
$env:REDOU_TEST_SCHEMA_PROVENANCE="migrations"
cmd /c npm run test:integration
```

The harness refuses the normal Redou development Supabase ports.

## Out Of Scope For First Test

- Browser UI rendering.
- Real MinerU, GROBID, Ollama, Transformers, or remote LLM calls.
- Full PDF layout/OCR accuracy.
- Entity graph integration.
- Exhaustive failure-path coverage; that belongs to Phase 1C.
