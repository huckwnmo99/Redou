---
name: test
description: 구현된 코드를 검증하는 스킬. /test 명령을 사용하거나, /develop 완료 후 테스트를 요청할 때 트리거한다. "테스트해줘", "빌드 확인해줘", "검증해줘" 같은 요청도 포함된다.
user-invocable: true
argument-hint: "[특정 검증 대상 또는 공백]"
context: fork
agent: tester
---

# Test — 코드 테스터

tester 에이전트를 서브프로세스로 실행하여 빌드/타입/린트/테스트 검증을 수행한다.

## 작업 지시

검증 대상:
`$ARGUMENTS`

현재 브랜치의 변경 사항에 대해 전체 검증을 실행하라.
특정 대상이 지정되었으면 해당 항목만 검증하라.
