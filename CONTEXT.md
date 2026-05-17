# Redou Context Index

Status: canonical entrypoint
Last updated: 2026-05-08

This file is intentionally thin. It points agents to the canonical project language and decisions without duplicating the definitions.

## Product

Redou is a Windows desktop research workspace for importing, reading, extracting, searching, and recalling scientific papers and their related source files.

Core product surfaces:

- Electron desktop shell: `apps/desktop`
- React renderer baseline: `frontend`
- Local Supabase data layer: `supabase`
- Harness and architecture docs: `docs/harness`

## Canonical Language

Use the detailed glossary here:

- `docs/harness/main/glossary.md`

That glossary owns definitions for terms such as main PDF, supplementary PDF, source file, `source_file_id`, evidence location, generated table, Stage 3d, RAG context, processing job, paper reference, and source evidence label.

Do not add competing definitions to this file. If terminology changes, update the glossary and link from here.

## Architecture Decisions

Persistent architecture decisions live in:

- `docs/harness/decisions/`

Current Stage 0 decisions:

- `docs/harness/decisions/0001-debuggable-module-split.md`
- `docs/harness/decisions/0002-module-ownership.md`

## Agent Coordination

Project agent rules and current work state:

- `AGENTS.md`

Codex-Claude exchange folder:

- `docs/agents/codex-claude/`

Accepted Codex-Claude decisions:

- `docs/agents/codex-claude/decisions.md`

Open questions:

- `docs/agents/codex-claude/open-questions.md`

## Current Refactor Rule

Docs-only architecture clarification may proceed now.

Runtime refactor touching `apps/desktop/electron/main.mjs`, chat pipeline, preload, IPC channels, or conflict-prone frontend files should wait until branch integration is handled or explicitly deferred by the user.
