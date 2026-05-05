---
name: develop
description: 계획서를 기반으로 Codex에 구현을 위임하는 스킬. /develop 명령을 사용하거나, /plan으로 만든 계획서를 승인한 후 구현을 시작할 때 트리거한다. "구현해줘", "개발 시작해", "코딩해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[기능명 또는 계획서 경로]"
context: fork
---

# Develop — Codex 구현 위임

> **코드 구현은 Codex(`codex:rescue`)가 담당한다.** Claude는 계획서를 준비하고 Codex에 위임한다.

## 작업 지시

대상 기능/계획서: `$ARGUMENTS`

1. `docs/features/new/`에서 해당 계획서를 확인하라. 지정되지 않았으면 가장 최근 계획서를 사용하라.
2. 계획서가 존재하고 사용자 승인이 완료된 상태인지 확인하라.
3. `codex:rescue` 스킬을 호출하여 계획서 기반 구현을 위임하라.
4. Codex 완료 후 `/test`로 검증을 진행하라.
