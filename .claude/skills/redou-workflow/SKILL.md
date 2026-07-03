---
name: redou-workflow
description: Redou에서 비단발 작업(기능·수정·리팩터·문서)을 시작할 때 따르는 프로젝트 방법론. 계획·구현·검증·갱신의 1 사이클과 단일 진실원천(SSoT) 규율을 안내한다. "어떻게 작업 시작하지", "이거 구현 절차", "방법론대로 진행" 같은 상황에서 트리거. 구현 주체(메인 Claude 오케스트레이터 + 서브에이전트)는 CLAUDE.md가 정의한다.
user-invocable: true
---

# Redou 작업 방법론

> 이 스킬은 **얇은 진입점**이다. 정의를 복제하지 않고 canonical 문서를 가리킨다.
> 구현 주체·협업 방식(누가 코드를 쓰는가)은 **`CLAUDE.md`가 정의**한다 — 메인 Claude(오케스트레이터)가 `planner`/`developer`/`fixer`/`tester`/`reviewer` 서브에이전트에 위임.

## 1. 언제 무엇을

- **동작이 안 바뀌는 사소 수정**(오타·로그·포맷·주석·미사용 import) → ledger 없이 git 커밋만.
- **동작이 바뀌는 수정·기능·6파일↑·DB 변경** → ledger 먼저 (소규모 `/fix`·대규모 `/develop`).

판단 축은 '파일 수'가 아니라 **'동작이 바뀌나'**. 상세 트리거·운영 규칙: `docs/tasks/README.md`.

## 2. 작업 1 사이클 (매번 반복)

```
1. READ      관련 ledger README 먼저 읽기 (없으면 새 작업 → bootstrap)
2. PLAN      docs/tasks/<work>/planned/ 에 슬라이스를 작게 계획 (가정·검증기준 명시)
3. BUILD     코드/문서 구현·변경
4. VERIFY    Success Criteria 대조 + 빌드·타입·테스트
5. UPDATE    슬라이스 planned/ → completed/, ledger README 상태 갱신
6. HARNESS   시스템이 바뀌었으면 docs/harness 갱신 + VERSION 범프
7. COMMIT    슬라이스 단위 커밋
```

멈출 때 ledger README의 **Current Status / Next Action / Last Updated** 3개만 정확하면, 다음 세션이 그것만 읽고 이어간다.

ledger 운영 상세 → `docs/tasks/README.md`.

## 3. 단일 진실원천(SSoT) 지도 — "무엇을 어디서"

| 알고 싶은 것 | 본다 |
|-------------|------|
| 시스템이 지금 어떤지 (기능·흐름·상태) | `docs/harness/` (특히 `main/feature-status.md`) |
| 지금 무슨 작업을 어디까지 | `docs/tasks/<work>/README.md` (ledger) |
| 용어 정의 | `docs/harness/main/glossary.md` |
| 아키텍처 결정 (ADR) | `docs/harness/decisions/` |
| 전체 문서 지도 | `docs/README.md` |
| 아이디어 / 보관 | `docs/backlog/` / `docs/archive/` |

## 4. 핵심 규율

- **컨텍스트는 작게**: 얇은 인덱스 먼저 읽고 필요한 링크 1개만. 한 파일에 내용을 몰지 않는다. **문서는 ~500줄 상한(300줄+면 분할 검토), 진입점·README는 ~150줄, harness는 '현재 상태'만(과정 로그 누적 금지).** 상세 규약: `CLAUDE.md`.
- **코드와 문서 정합**: harness가 코드와 다르면 코드를 믿고 harness를 갱신. 작업 후 harness·ledger 갱신은 의무.
- **삭제 대신 보관**: 완료·레거시 문서는 삭제가 아니라 `docs/archive/`로.
- **데이터 기반**: 제안·진단은 이론이 아닌 실제 코드·DB·로그 근거로.

## 5. 구현 주체·협업 모델 (→ CLAUDE.md)

- 메인 Claude(오케스트레이터)가 `planner`(설계) → `developer`/`fixer`(구현) → `tester`(검증) → `reviewer`(리뷰·PR) 서브에이전트에 위임한다. 이 스킬은 ledger 기계장치만 다루며, 역할 분리 정의는 `CLAUDE.md`가 소유한다.
