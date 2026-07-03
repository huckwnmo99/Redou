---
name: develop
description: 계획서를 기반으로 developer 에이전트에 구현을 위임하는 스킬. /develop 명령을 사용하거나, /plan으로 만든 계획서를 승인한 후 구현을 시작할 때 트리거한다. "구현해줘", "개발 시작해", "코딩해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[기능명 또는 ledger 경로]"
context: fork
agent: developer
---

# Develop — 기능 구현

developer 에이전트를 서브프로세스로 실행하여 계획서 기반 구현을 수행한다.

## 작업 지시

대상 기능/계획서: `$ARGUMENTS`

1. `docs/tasks/<work>/` ledger(README + `planned/` 슬라이스)에서 해당 계획서를 확인하라. 지정되지 않았으면 가장 최근 진행 중 ledger를 사용하라.
2. 계획서가 존재하고 사용자 승인이 완료된 상태인지 확인하라. 없으면 중단하고 `/plan`을 권장하라.
3. 계획서의 "작업 분해" 순서대로 구현하라.
4. 구현 완료 후 `/test`로 검증을 진행하라.
