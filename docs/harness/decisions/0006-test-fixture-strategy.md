# ADR 0006: Test Fixture Strategy

Status: accepted
Date: 2026-05-22

## Context

Plan 12 created useful module seams, but Redou still lacks integration tests for the core research workflow. The next reliability work must verify behavior across database persistence, import/extraction outputs, search/RAG, and table generation without touching user development data.

The test target has Postgres-specific requirements:

- pgvector indexes and vector comparisons;
- RPC functions such as `match_chunks`;
- Supabase-style schema and auth/RLS-adjacent contracts;
- persisted job, paper, chunk, figure, embedding, conversation, and table rows.

Pure mocked tests are not enough for this layer, but real external services would make the test slow and flaky.

## Decision

Use a two-tier fixture strategy.

Tier 1, integration workflow tests:

- primary target is an isolated local Supabase test instance or isolated test database;
- never reset or mutate the user's active development database;
- use the real schema and database contracts needed by the workflow;
- use deterministic service fakes for external extraction, embedding, LLM, and file-library boundaries.

Tier 2, unit/module tests:

- keep using deterministic fakes, dependency injection, and small in-memory builders;
- keep these tests fast and independent from Supabase.

pglite is not the primary integration fixture. It may be reconsidered later for pure helpers or repository slices that do not require pgvector, RPC, or Supabase-specific behavior.

## Fixture Corpus

Define the canonical fixture contract in `docs/harness/fixtures/`.

Runtime fixture artifacts should later live under `apps/desktop/tests/fixtures/` when Phase 1B writes the first golden-path test.

The first corpus is `golden-path`:

- one small paper;
- one primary source file;
- deterministic extraction result;
- deterministic 2048-dim embedding response;
- deterministic LLM/table response;
- expected persisted database rows and normalized search/table outputs.

## Schema Provenance

The integration fixture must be built from the repository migration stream.

Accepted Phase 1B default:

- create a disposable local Supabase test project or isolated test database;
- apply all `supabase/migrations/*.sql` files in lexicographic order, or run `supabase db reset` only inside that disposable project after it is wired to the repository migration directory;
- do not use the user's current development database as the schema source;
- do not rely on current `supabase_migrations.schema_migrations` rows as proof that the test schema is current;
- fail fast if the test target matches the normal Redou development DB URL, project ref, or port set.

Schema-only isolation inside the active development database is not the default. It can be reconsidered only if the Phase 1B harness proves that the migration SQL is safe under that isolation model.

## Consequences

This keeps the first integration test honest about real database behavior while avoiding real model/service dependencies.

The tradeoff is setup work: Phase 1B must build a safe Supabase fixture harness before it can assert workflow behavior. That setup is worth doing because it becomes the base for abort/error tests and later quality measurement.

## Implementation Guardrails

- Add a visible guard that refuses to run integration tests against the normal development DB URL.
- Prefer a unique database name or disposable project instance per test run.
- Keep temporary file-library roots under the test temp directory.
- Make fake service catalogs explicit files, not hidden inline blobs.
- Make the deterministic embedding fake return 2048 dimensions.
- Assert terminal job states and persisted rows instead of relying on log text.
- Keep the first golden-path test below the agreed runtime budget.

## Claude Review Resolution

Claude reviewed Phase 1A on 2026-05-22 and gave GO with no blocker. The review required two corrections before Phase 1B:

- fix the embedding fixture contract from 384 dimensions to 2048 dimensions;
- define the schema provenance mechanism before runtime test implementation.

Both corrections are reflected in this ADR.
