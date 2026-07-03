---
name: review
description: Claude 코드 리뷰로 변경 사항을 검증하고 PR을 생성하는 스킬. /review 명령을 사용하거나, /test 통과 후 최종 검증을 요청할 때 트리거한다. "리뷰해줘", "PR 만들어줘", "검증해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[--wait|--background]"
context: fork
agent: reviewer
---

# Review — 코드 검증자

reviewer 에이전트를 서브프로세스로 실행하여 코드 리뷰를 수행하고 PR을 생성한다.

## 작업 지시

옵션: `$ARGUMENTS`

현재 브랜치의 변경 사항을 독립 리뷰하고, 발견사항을 종합하여 최종 판정 후 PR을 생성하라.
