# Tasks — Ledger 운영 가이드

`docs/tasks/`는 **진행 중·완료된 작업을 추적하는 ledger들의 모음**이다. 각 작업은 폴더 하나 = ledger 하나. 이 문서는 ledger가 **매번 어떻게 작동해야 하는지** 정의한다.

핵심 철학: **작은 인덱스(README) 먼저 읽고, 필요한 링크 1개만 연다.** 컨텍스트를 작게 유지하는 게 목적.

## 언제 ledger를 만드나 (트리거)

| 작업 | ledger? |
|------|---------|
| 로직·동작이 안 바뀌는 사소 수정(오타·디버그 로그·포맷·주석·미사용 import; 크기 무관) | ❌ 불필요 — **git 커밋만** (추적은 git이 담당) |
| 동작이 바뀌는 수정(작아도) | ✅ ledger 생성 (소규모 `/fix`·대규모 `/develop`) |
| 6개 파일↑ / DB 변경 / 다단계 / 장기 작업 | ✅ ledger 생성 (대규모) |

판단 축은 '파일 수'가 아니라 **'로직·동작이 바뀌나'**다. ledger는 '추적'이 아니라 '계획·맥락'을 위한 것 — 추적은 git이 한다. 그래서 계획할 게 없는(동작 무변) 수정은 ledger가 불필요하다.

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

> **구현 주체**: 메인 Claude(오케스트레이터)가 `planner`/`developer`/`fixer`/`tester`/`reviewer` 서브에이전트에 위임한다 (정의: `CLAUDE.md`). ledger 기계장치 자체는 구현 주체와 무관하게 동일하게 작동한다.

## 네이밍

- 작업 폴더: `kebab-case` slug (예: `docs-cleanup`).
- 슬라이스 파일: `NN_YYYY-MM-DD_<slug>.md` (번호 = 순서, 날짜 = 작성일 절대값).

## 현재 ledger (예시)

- `read-only-improvement-advisor/` — 기능 개발 ledger (planned/completed/archive 풀 구조 예시).
- `docs-cleanup/` — 문서 재편 ledger (Phase별 슬라이스 예시).
- `pdf-zoom-app-wide-leak/` — PDF 줌이 앱 UI 전체로 새는 버그 fix ledger (소규모, 계획 작성 완료).
- `pipeline-risk-audit/` — 핵심 파이프라인(임포트→임베딩→RAG→채팅) 위험 감사 ledger (발견 28건, 수정 승격 대기).
- `table-semantics-hardening/` — 테이블 의미 보존 강화 ledger (D1~D4 봉쇄. Phase 1 구현·E2E 재실증 통과, PR #4 merge 대기. Phase 2/3 로드맵 보유).

## 멈출 때 체크 (다음 세션을 위해)

README의 **Current Status / Next Action / Last Updated** 3개가 현재와 일치하는가? 이것만 맞으면 ledger는 제 역할을 한다.
