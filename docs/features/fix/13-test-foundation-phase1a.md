# Test Foundation Phase 1A Plan

Status: accepted after Claude review corrections
Date: 2026-05-22
Scope type: reliability/test-foundation fix
Depends on:

- `docs/agents/codex-claude/decisions.md` D35
- `docs/features/proposals/2026-05-21-post-plan12-roadmap.md`
- `docs/harness/decisions/0006-test-fixture-strategy.md`

## Purpose

Plan 12 is closed after Stage 2B. The next default direction is no longer broad module splitting. It is a test foundation that proves Redou's core research workflow can be verified without touching user development data or calling real external services.

Phase 1A defines the fixture strategy and harness skeleton before the first integration test is written.

## Current Answer

Use a two-tier strategy:

- Integration workflow tests use an isolated local Supabase test instance/database as the primary fixture target.
- Unit and module tests keep using deterministic fakes and dependency injection.

Do not use pglite as the primary integration fixture. Redou depends on Postgres-specific behavior such as pgvector, RPC functions, and auth/RLS-adjacent behavior. pglite can be reconsidered later only for pure helper/repository tests that do not need those contracts.

## Non-Goals

- Do not implement the golden-path integration test in Phase 1A.
- Do not reset or migrate the user's active development database.
- Do not call MinerU, GROBID, Ollama, Transformers, or real LLM providers.
- Do not change runtime import, extraction, RAG, table, or renderer code.
- Do not start entity graph implementation or Plan 12 Stage 5 import/processing refactors.

## Harness Skeleton

Future implementation should use this shape:

```text
apps/desktop/tests/integration/
  golden-path.test.mjs
  support/
    supabase-test-instance.mjs
    deterministic-services.mjs
    file-library-fixture.mjs

apps/desktop/tests/fixtures/
  golden-path/
    README.md
    source/
    expected/
    fakes/
```

Phase 1A records the fixture contract under `docs/harness/fixtures/` first. Runtime fixture files should be created in `apps/desktop/tests/fixtures/` only when Phase 1B implements the first test.

## Fixture Strategy

The first golden-path fixture should model one small imported paper and enough derived data to exercise the production persistence contracts.

Required fixture domains:

- paper metadata: title, year, authors, and primary source file;
- processing jobs: extract sections/chunks/figures, then generate embeddings;
- extraction result: sections, chunks, figures, page hints, and source labels;
- embedding data: deterministic 2048-dim vectors that match the current `chunk_embeddings.embedding` `vector(2048)` contract;
- RAG/search output: ranked chunk/figure results with stable scores or normalized rankings;
- table output: deterministic LLM-style table JSON, evidence references, and persistence assertions.

External service boundaries must be faked at the seam closest to Redou's code:

- MinerU/GROBID/PDF extraction: fixture extraction result or tiny PDF plus fake parser response;
- Ollama/LLM calls: catalogued responses keyed by prompt intent, not broad string snapshots;
- embedding worker: deterministic 2048-dim vector provider;
- file system: temporary file library root, never the user's real library path.

## Schema Provenance

Phase 1B must create the isolated database from the repository migration stream, not from whatever happens to be present in the user's current development database.

Default setup:

1. Create a disposable local Supabase test project or equivalent isolated test database with test-only ports/URL.
2. Apply every `supabase/migrations/*.sql` file in lexicographic order, or run `supabase db reset` only inside that disposable test project after pointing it at the same migration directory.
3. Exclude normal development data and default `seed.sql` unless a test-specific seed file is explicitly chosen.
4. Refuse to run if the target database URL, project ref, or port set matches the normal Redou development Supabase instance.

Do not rely on the current development DB's `supabase_migrations.schema_migrations` rows as the source of truth. That table can drift from the actual local schema history.

## Phase 1B First Test Contract

`apps/desktop/tests/integration/golden-path.test.mjs` should prove one complete deterministic workflow:

1. Create an isolated Supabase test target from the full repository migration stream.
2. Seed a clean test user and one importable paper fixture.
3. Run the production workflow entry points with fake external services.
4. Assert the core spine first: papers, paper files, jobs, sections, chunks, figures, 2048-dim embeddings, one search/RAG result, and one table persistence result.
5. Assert job ordering and terminal status without real worker sleeps.
6. Assert no fixture path points at user development data.

Conversation messages and full source-ref coverage can be included if they are already touched by the table persistence path. They should not expand the first test into a broad chat/table acceptance suite.

The test should not use browser UI. The first pass should stay inside the desktop Node test environment.

## Runtime Budget

The golden-path test must stay useful as a regression guard, so the first budget is:

- target: under 10 seconds locally after Supabase is already running;
- hard stop: under 30 seconds for the single golden-path test;
- no real external network or model download;
- no minute-scale polling loops.

If local Supabase startup dominates runtime, split startup into an explicit setup command and keep the test itself deterministic.

## Stop Points

Stop and ask before implementation if:

- isolated Supabase cannot be created without risking the user's dev database;
- schema setup cannot be traced to the full repository migration stream;
- the only available test path requires a real external service call;
- pgvector/RPC/auth behavior cannot be represented by the chosen test target;
- the test would need broad runtime refactors instead of small injection seams.

## Acceptance Criteria For Phase 1A

- Fixture strategy is recorded as an ADR.
- Golden-path fixture corpus layout is documented.
- Claude review request is filed with blockers/P1/P2 and go/stop questions.
- `AGENTS.md` records that Phase 1A is docs/harness only and Phase 1B is the first code-changing test slice.
- `git diff --check` passes for the changed docs.

## Phase 1B Implementation Update

Date: 2026-05-23

The first golden-path tracer is implemented as an opt-in desktop Node integration test:

- `apps/desktop/tests/integration/golden-path.test.mjs`
- `apps/desktop/tests/integration/support/supabase-test-target.mjs`
- `apps/desktop/tests/integration/support/deterministic-services.mjs`
- `apps/desktop/tests/fixtures/golden-path/`

The default run is safe:

- it refuses the normal Redou development Supabase URL and ports;
- it skips the real database spine unless `REDOU_TEST_SUPABASE_URL`, `REDOU_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `REDOU_TEST_SCHEMA_PROVENANCE=migrations` point at a disposable local Supabase target;
- it does not call browser UI, Electron app launch, MinerU, GROBID, Ollama, Transformers, or remote LLMs.

When a disposable target is configured, the test seeds one paper, one primary file, one section, one chunk, one 2048-dim chunk embedding, one table figure, two succeeded processing jobs, and one chat conversation. It then exercises real Supabase RPC retrieval through `createMultiQueryRag(...)` and real table persistence through `runTableConversationPipeline(...)` with deterministic fake services.

The first local verification used the safety mode because no disposable Supabase test target was configured in that shell. That verified the dev-target refusal guard and script wiring, while leaving the real DB core-spine path pending until a disposable test target was available.

## Phase 1B Disposable Runner Update

Date: 2026-05-24

The real DB branch is now executable through `apps/desktop`:

```text
npm run test:integration:supabase
```

The runner:

- creates a temp Supabase project under the OS temp directory;
- rewrites Supabase ports to the non-dev `55420-55429` range;
- copies the repository `supabase/migrations/` directory into that target;
- writes an empty target seed file and runs `supabase db reset --local --no-seed --yes`;
- keeps Auth enabled so `supabase status -o env` exposes service-role credentials;
- disables test-target Google OAuth env references so the disposable target does not depend on local OAuth secrets;
- runs `npm run test:integration` with disposable URL/key/provenance env vars;
- stops the disposable target afterward unless `--keep` is passed.

The first real run found a schema issue that the safety-mode tracer could not catch: a legacy 4-argument `match_chunks` overload survived earlier embedding/RAG migrations, making REST RPC calls ambiguous. The fix is recorded in `supabase/migrations/20260524010000_drop_stale_match_chunks_overload.sql`, and desktop RAG now calls the current 6-argument `match_chunks` shape explicitly.

Current verification:

- `npm run test:integration:supabase` passes against the disposable target with 2 integration tests and 0 skipped tests;
- default `npm run test:integration` remains safe and skips the real DB spine unless disposable env vars are set;
- default `npm run test` now includes the runner helper coverage and passes with 8 suites / 45 tests.
