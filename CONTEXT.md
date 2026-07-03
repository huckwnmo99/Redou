# Redou Context Index

Status: canonical entrypoint
Last updated: 2026-06-16

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

Project agent rules, workflow, and role split:

- `CLAUDE.md` (repo root) — orchestrator + subagent model (`planner` / `developer` / `fixer` / `tester` / `reviewer`), workflow, and absolute rules.
- `.claude/agents/` — subagent definitions.

Current work state:

- `docs/tasks/<work>/README.md` — per-work ledger.
- `docs/harness/main/feature-status.md` — system feature status (SSoT).

Codex is not part of the workflow. Implementation, verification, and review are all handled by Claude subagents.

## Current Refactor Rule

Docs-only architecture clarification may proceed now.

Runtime refactor touching `apps/desktop/electron/main.mjs`, chat pipeline, preload, IPC channels, or conflict-prone frontend files should wait until branch integration is handled or explicitly deferred by the user.
