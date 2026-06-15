# Tasks — Ledger 운영 가이드

`docs/tasks/`는 **진행 중·완료된 작업을 추적하는 ledger들의 모음**이다. 각 작업은 폴더 하나 = ledger 하나. 이 문서는 ledger가 **매번 어떻게 작동해야 하는지** 정의한다.

핵심 철학: **작은 인덱스(README) 먼저 읽고, 필요한 링크 1개만 연다.** 컨텍스트를 작게 유지하는 게 목적.

## 언제 ledger를 만드나 (트리거)

| 작업 | ledger? |
|------|---------|
| 소규모 단발 수정(버그·타입·UI 1~2파일) | ❌ 불필요 — ledger 없이 바로 처리 |
| 6개 파일↑ / DB 변경 / 다단계 / 장기 작업 | ✅ ledger 생성 |

"6파일↑ 또는 DB 변경이면 계획 먼저" 기준과 동일. ledger는 그 계획 산출물이 사는 곳.

## 구조

```
docs/tasks/<work-slug>/
  README.md          ← ledger 본체 (인덱스). 아래 섹션 필수
  planned/           ← 예정 슬라이스   NN_YYYY-MM-DD_<slug>.md
  completed/         ← 완료 슬라이스   NN_YYYY-MM-DD_<slug>.md
  archive/           ← 폐기·대체된 슬라이스/결정 (planned/, decisions/ 등)
```

**README 필수 섹션**: Purpose · Current Status · Next Action · Success Criteria · Documents To Read · Planned · In Progress · Completed · Last Updated.

슬라이스 파일 = 한 작업 단위. 작게 쪼개고 본체 README에서 링크. 슬라이스 1개가 너무 커지면 분리.

## 매번 작동하는 1 사이클 (작업 1회마다)

```
1. READ      관련 ledger README를 먼저 읽는다 (없으면 새 작업 → bootstrap).
2. NEXT      README의 "Next Action" = 이번에 할 일.
3. PLAN      필요 시 planned/NN_*.md에 이번 슬라이스를 작게 계획 (가정·검증기준 명시).
4. BUILD     코드/문서 구현·변경.
5. VERIFY    Success Criteria 대조 + 빌드·타입·테스트.
6. UPDATE    슬라이스를 planned/ → completed/ 이동.
             README의 Status·Next Action·Completed·Last Updated 갱신.
7. HARNESS   시스템이 바뀌었으면 docs/harness 갱신 + VERSION 범프.
8. COMMIT    슬라이스 단위로 커밋.
9. PRUNE     무효해진 계획·결정은 archive/로.
```

이 사이클이 **매번** 반복된다. 멈출 때 README의 Current Status·Next Action만 정확하면, 다음 세션이 그것만 읽고 이어간다.

## ledger를 새로 만들 때 (bootstrap)

1. `docs/tasks/<slug>/README.md` 작성 — 위 필수 섹션. Status=in-progress, Next Action 명시.
2. `planned/01_YYYY-MM-DD_<slug>.md` — 첫 슬라이스(상세 계획·근거·결정·검증).
3. `docs/README.md`(전체 인덱스)와 이 가이드의 "현재 ledger" 목록에 링크.

## 다른 문서와의 관계

- **ledger ↔ harness**: ledger는 "지금 **무슨 작업**을 어디까지"(좁고 한시적). harness(`docs/harness/`)는 "지금 **시스템이 어떤지**"(넓고 항구적, SSoT). 작업 완료 시 ledger→completed **그리고** harness 갱신. 둘 다 코드와 괴리되면 안 됨.
- **ledger ↔ backlog**: 아이디어는 `docs/backlog/`. 착수 결정 시 ledger로 승격.

> **범위 밖(의도적)**: 구현 주체·협업 방식(예: 별도 구현 에이전트와의 분담)은 이 가이드에서 다루지 않는다. ledger 기계장치 자체는 누가 구현하든 동일하게 작동한다. 협업 모델은 추후 별도로 정의·추가한다.

## 네이밍

- 작업 폴더: `kebab-case` slug (예: `docs-cleanup`).
- 슬라이스 파일: `NN_YYYY-MM-DD_<slug>.md` (번호 = 순서, 날짜 = 작성일 절대값).

## 현재 ledger (예시)

- `read-only-improvement-advisor/` — 기능 개발 ledger (planned/completed/archive 풀 구조 예시).
- `docs-cleanup/` — 문서 재편 ledger (Phase별 슬라이스 예시).

## 멈출 때 체크 (다음 세션을 위해)

README의 **Current Status / Next Action / Last Updated** 3개가 현재와 일치하는가? 이것만 맞으면 ledger는 제 역할을 한다.
