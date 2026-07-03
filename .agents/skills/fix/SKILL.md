---
name: fix
description: 소규모 수정을 fixer 에이전트에 위임한다. /fix 명령 또는 "버그 고쳐줘", "오류 수정해줘", "이거 바꿔줘", "안 돼", "깨졌어" 같은 요청 시 트리거한다.
user-invocable: true
argument-hint: "[수정할 내용 또는 ledger 경로]"
context: fork
agent: fixer
---

# Fix — 소규모 수정

fixer 에이전트를 서브프로세스로 실행하여 계획서 기반 소규모 수정을 수행한다.

## 판단 기준

- **소규모** (1~5개 파일, DB 변경 없음) → fixer가 ledger 계획서대로 수정
- **대규모** (6개 파일 이상 또는 DB 변경) → 중단하고 `/plan` → `/develop` 권장

## 작업 지시

수정 요청 또는 ledger 경로: `$ARGUMENTS`

fixer 에이전트로 위 수정을 처리하라. 계획서(ledger)가 없으면 중단하고 `/plan`을 먼저 권장하라.
수정 범위가 대규모라고 판단되면 중단하고 `/plan` 사용을 권장하라.
