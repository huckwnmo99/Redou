# Golden-Path Integration Fixture

This runtime fixture backs `apps/desktop/tests/integration/golden-path.test.mjs`.

The fixture is intentionally tiny:

- one owner user;
- one paper;
- one primary PDF row;
- one section, one chunk, one table figure;
- one deterministic 2048-dim embedding provider;
- one deterministic per-paper extraction response.

The test must run only against a disposable local Supabase target. It refuses the normal Redou development ports.

