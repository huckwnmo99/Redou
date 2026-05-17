---
name: lessons-to-skill
description: Turn Codex mistakes, repeated failures, missing checks, or workflow lessons into reusable guardrails, docs updates, or skill patches. Use when the user asks to capture a mistake, remember a lesson, prevent repeated errors, apply an Ouroboros-style reflection loop, or says in Korean things like "실수 저장", "교훈으로 남겨", "다음부터 안 틀리게", "기억해", "반복 오류", "검증 누락", "잘못한 부분", "방지 규칙으로 만들어".
---

# Lessons To Skill

Use this skill to convert a concrete failure or near-miss into a small reusable prevention rule.

This skill is inspired by the Ouroboros loop:

```text
Interview -> Seed -> Execute -> Evaluate -> Evolve
```

For Redou, translate that into:

```text
Mistake Interview -> Lesson Seed -> Guardrail Execute -> Verification Evaluate -> Skill Evolve
```

## Boundaries

- Do not change runtime app code just because a lesson exists.
- Do not create broad rules from a one-off accident.
- Do not turn project facts into a skill. Put project state in `AGENTS.md`.
- Do not turn unresolved debate into a decision. Put it in `docs/agents/codex-claude/open-questions.md`.
- Keep new guardrails short enough that future agents will actually follow them.

## Workflow

### 1. Mistake Interview

Identify the smallest concrete failure.

Ask or infer:

- What happened?
- What should have happened?
- What assumption caused the gap?
- Was this a one-off mistake, a repeated pattern, or a missing workflow gate?
- What would have prevented it before files changed?

### 2. Lesson Seed

Write the lesson in this shape:

```text
When [trigger], check [condition] before [action], so [failure] does not recur.
```

Good:

- When merge work is requested, run read-only branch hygiene analysis before any real merge.
- When `rg` fails in this Windows workspace, fall back to `Select-String` instead of stopping the investigation.
- 사용자가 "이 실수 기억해"라고 하면, 먼저 lesson 저장 위치를 고르고 runtime code 변경으로 넘어가지 않는다.

Too broad:

- Be careful.
- Always test everything.

### 3. Guardrail Execute

Choose one storage target:

| Lesson type | Storage target |
|-------------|----------------|
| Project status or active workflow | `AGENTS.md` |
| Accepted architecture/process decision | `docs/agents/codex-claude/decisions.md` |
| Open Codex/Claude/user question | `docs/agents/codex-claude/open-questions.md` |
| Reusable behavior across tasks | this skill or another `SKILL.md` |
| Detailed case history | `docs/agents/lessons/` |

If the lesson belongs in a skill, add the smallest possible checklist item or trigger note.

### 4. Verification Evaluate

Before finishing, verify the new rule is usable:

- Trigger is specific.
- Action is observable.
- Storage location is correct.
- Rule does not conflict with `AGENTS.md`.
- Rule does not add a heavy ritual for a low-risk task.

### 5. Skill Evolve

Escalate only when repetition justifies it:

- First occurrence: record a lesson or work-log note.
- Second occurrence: add an `AGENTS.md` guardrail or decision.
- Third occurrence: update or create a skill.

If the same lesson keeps appearing, simplify the workflow instead of adding more warnings.

## Output Format

When applying this skill, report:

```text
Lesson captured:
- Trigger:
- Prevention rule:
- Stored in:
- Why this location:
- Follow-up:
```

If no storage change is needed, say that directly and explain why.
