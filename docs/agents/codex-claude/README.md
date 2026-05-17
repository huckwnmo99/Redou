# Codex-Claude File Exchange

Status: active workflow document
Date: 2026-05-07

## Purpose

This folder is the shared file-based workspace for Codex and Claude to exchange plans, critiques, handoffs, and decisions without mixing unresolved comments directly into execution documents.

Use this folder when:

- Codex wants Claude to review a plan, implementation slice, or risk list.
- Claude wants Codex to implement, verify, or inspect code.
- A proposal has competing opinions and needs a clean decision trail.
- A future agent needs to see what was asked, what was answered, and what was accepted.

## Files

- `codex-to-claude.md`: Codex writes requests, implementation notes, and questions for Claude.
- `claude-to-codex.md`: Claude writes review notes, orchestration comments, and requests for Codex.
- `open-questions.md`: unresolved questions that need the user, Claude, or Codex to decide.
- `decisions.md`: accepted decisions only. Do not put speculative comments here.

## Protocol

1. Append, do not rewrite history.
2. Use the template below for every entry.
3. Keep one topic per entry.
4. When a question is answered, mark the original entry as `ANSWERED` by adding a short line under it.
5. Promote only confirmed outcomes to `decisions.md`.
6. Link the relevant proposal, code file, or command result.
7. Do not use this folder as a scratchpad for long raw logs.

## Entry Template

```md
## YYYY-MM-DD - Agent - Short Topic

Status: OPEN | ANSWERED | INFO | DECISION REQUEST
Related files:
- `path/to/file`

Message:

Question or note here.

Requested response:

What the other agent should answer or do.
```

## Decision Promotion Rule

An item can move to `decisions.md` only when at least one of these is true:

- the user explicitly approved it
- both agents agree and the change is docs-only
- the decision is required to avoid unsafe implementation
- it records a fact verified from the repo

## Current Workstream

The first workstream using this exchange is:

- `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`
