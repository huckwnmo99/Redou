---
name: review
description: Codex + Codex 이중 리뷰로 코드를 검증하고 PR을 생성하는 스킬. /review 명령을 사용하거나, /test 통과 후 최종 검증을 요청할 때 트리거한다. "리뷰해줘", "PR 만들어줘", "검증해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[--wait|--background]"
context: fork
agent: reviewer
---

# Review — 이중 코드 검증자

reviewer 에이전트를 서브프로세스로 실행하여 Codex + Codex 이중 리뷰를 수행한다.

## 작업 지시

옵션:
`$ARGUMENTS`

현재 브랜치의 변경 사항에 대해 이중 리뷰(Codex → Codex)를 실행하고, 결과를 종합하여 PR을 생성하라.
