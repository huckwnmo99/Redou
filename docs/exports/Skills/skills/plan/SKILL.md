---
name: plan
description: 기능 구현 계획서를 작성하는 스킬. 사용자가 새 기능 추가, 기능 설계, 구현 방향 정리, 아키텍처 설계를 요청하거나, /plan 명령을 사용할 때 반드시 트리거한다. "~기능 추가해줘", "~만들어줘", "~설계해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[기능 설명]"
context: fork
agent: planner
---

# Plan — 기능 구현 계획자

planner 에이전트를 서브프로세스로 실행하여 기능 계획서를 작성한다.

## 작업 지시

사용자의 기능 요청:
`$ARGUMENTS`

위 요청에 대해 `docs/features/new/` (기능) 또는 `docs/features/fix/` (수정)에 계획서를 작성하라.
계획서 작성 완료 후 핵심 내용을 요약하고 사용자 승인을 요청하라.
