# Redou Spec Loop

Status: workflow document, not an active skill
Date: 2026-05-07

## Purpose

Redou Spec Loop is the project-local workflow for turning an unclear research-product idea into a small verified implementation slice.

It keeps the active skill policy simple:

- Use Matt Pocock skills as the actual active skills.
- Do not install or invoke Ouroboros for normal Redou work.
- Borrow only the useful workflow ideas from Ouroboros: spec-first thinking, ambiguity reduction, ontology checks, and evaluation loops.

## When To Use

Use this workflow when a request is broader than a one-line fix, especially for:

- new product features
- research workflow changes
- LLM/RAG behavior changes
- UI/UX direction changes
- database or IPC contract changes
- anything that could produce misleading research artifacts

For tiny bugs, use `fix` directly.

## Skill Mapping

This is the overlap between the Matt Pocock skills and the Ouroboros-style loop:

| Loop stage | Matt Pocock skills | Borrowed Ouroboros idea | Output |
|------------|--------------------|--------------------------|--------|
| Clarify | `grill-me`, `grill-with-docs`, `zoom-out` | interview, hidden assumptions | sharp problem statement |
| Seed | `plan`, `to-prd` | seed spec, ambiguity gate | accepted mini-spec |
| Slice | `to-issues`, `triage`, `develop` | acceptance criteria decomposition | smallest safe implementation slice |
| Build | `develop`, `fix`, `tdd` | execute phase | code/doc change |
| Verify | `test`, `review`, `diagnose` | mechanical, semantic, consensus checks | verified checkpoint |
| Evolve | `plan`, `to-issues`, `triage` | feedback becomes next seed | next goal or residual list |

## The Loop

### 1. Clarify

Goal: do not start from a vague instruction.

Ask:

- What is the user trying to decide, improve, or prevent?
- What object is being changed: paper, supplementary file, goal, table, note, chat, search result, figure, or source evidence?
- What would make the result unacceptable?
- What existing Redou behavior must not change?
- What is explicitly out of scope?

Use:

- `grill-me` when the user's intent is still fuzzy.
- `grill-with-docs` when the answer should update domain docs or architectural language.
- `zoom-out` when the code area is unfamiliar or likely connected to other workflows.

Exit condition:

- The request can be summarized in one concrete paragraph.

### 2. Seed

Goal: turn the clarified request into a small spec.

Write:

- goal
- non-goals
- affected surfaces
- acceptance criteria
- verification plan
- rollback or cleanup expectations
- smallest implementation slice

Ambiguity check:

Score each from 0 to 2.

- Goal clarity: is the desired outcome concrete?
- Constraint clarity: are boundaries and out-of-scope items named?
- Success clarity: can we verify it without guessing?
- Context clarity: do we know the relevant Redou files/data flow?

Proceed when the total is at least 7 out of 8.

If the total is 6 or lower, keep clarifying or reduce scope.

Use:

- `plan` for implementation plans.
- `to-prd` for user-facing product shape.
- `to-issues` only after the slice boundaries are stable.

Exit condition:

- A tiny implementation slice has named files and acceptance criteria.

### 3. Slice

Goal: avoid a broad, tangled implementation.

Rules:

- Prefer one behavior change per slice.
- Touch the smallest set of files.
- Keep database, Electron, frontend, and docs changes separable where possible.
- Do not add a new active skill for workflow convenience.
- Do not install external runtime systems unless the user explicitly asks.

Typical slice examples:

- migration only
- repository contract only
- Electron IPC only
- one UI panel only
- source-label rendering only
- verification/doc update only

Exit condition:

- The slice can be committed with a single clear message.

### 4. Build

Goal: implement the slice with minimal disturbance.

Use:

- `develop` for approved plans.
- `fix` for narrow behavior fixes.
- `tdd` when a reliable test can be written before the change.

Engineering rules:

- Match existing Redou patterns.
- Preserve user changes.
- Avoid speculative abstractions.
- Keep generated research artifacts trustworthy over visually impressive.

Exit condition:

- The slice is implemented and ready for verification.

### 5. Verify

Goal: prove the slice works at the right level.

Mechanical checks:

- TypeScript build or `node --check` for touched JavaScript modules.
- SQL smoke checks for migration/RPC changes.
- `git diff --check`.

Semantic checks:

- Does the behavior match the user-facing goal?
- Does it preserve paper/source ownership?
- Does it avoid misleading generated research output?
- Does it keep main paper and supplementary evidence distinguishable?

Consensus checks:

- Use a verification subagent for risky changes.
- Ask the subagent for blocking or high-risk findings only.
- Patch blocking findings before closing the loop.

Use:

- `test` for build/test verification.
- `review` for final patch review.
- `diagnose` if behavior diverges from intent.

Exit condition:

- Checks pass, or remaining gaps are explicitly documented.

### 6. Evolve

Goal: make verification results feed the next checkpoint.

After every meaningful slice:

- update `AGENTS.md`
- update the relevant feature or goal doc
- record residual risks
- choose the next smallest checkpoint

Common next-checkpoint choices:

- runtime walkthrough
- UI cleanup
- source-quality panel
- Research Goal MVP
- DOCX conversion after supplementary PDF path is stable

Exit condition:

- The next step is clear, or the work is intentionally paused.

## Redou-Specific Gates

Before implementing a research-artifact feature, confirm:

- Evidence source is traceable to a `paper_files` row.
- Main PDF and supplementary evidence cannot overwrite each other.
- LLM body citations remain compact.
- Source references can show `Main PDF` or `Supplementary`.
- Generated tables cannot silently present unrelated columns as valid output.
- Runtime checks do not leave temporary DB rows or copied files behind.

## Relationship To Ouroboros

Ouroboros is a full spec-first workflow engine with CLI commands, MCP integration, event persistence, ambiguity scoring, ontology convergence, and multi-agent evaluation.

Redou does not currently adopt Ouroboros as a runtime dependency.

Instead, Redou Spec Loop borrows these ideas:

- interview before implementation
- seed spec before code
- ambiguity gate before scope expansion
- evaluation before evolution
- feedback becomes the next checkpoint

This keeps Redou aligned with the current skill policy while preserving the best part of the idea.

## Default Command Flow

For a normal feature:

```text
grill-me or zoom-out
plan
develop
test
review
update AGENTS.md and feature docs
```

For a risky RAG/table feature:

```text
grill-with-docs
plan
tdd or develop
test
verification subagent
review
runtime walkthrough
update AGENTS.md and goal docs
```

For a small bug:

```text
fix
test
review if risk is non-trivial
```
