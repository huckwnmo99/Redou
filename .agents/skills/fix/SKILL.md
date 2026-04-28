---
name: fix
description: 소규모 수정 요청을 Codex로 위임한다. /fix 명령 또는 "버그 고쳐줘", "오류 수정해줘", "이거 바꿔줘", "안 돼", "깨졌어" 같은 요청 시 트리거한다.
user-invocable: true
argument-hint: "[수정할 내용]"
context: fork
---

# Fix — 소규모 수정

> **소규모 수정은 `codex:rescue`를 사용한다.**

## 판단 기준

- **소규모** (6개 파일 미만, DB 변경 없음) → `codex:rescue` 직접 호출
- **대규모** (6개 파일 이상 또는 DB 변경 필요) → `/plan`을 먼저 실행하도록 사용자에게 안내

## 작업 지시

수정 요청: `$ARGUMENTS`

`codex:rescue` 스킬을 호출하여 위 수정 요청을 처리하라.
수정 범위가 대규모라고 판단되면 중단하고 `/plan` 사용을 권장하라.
