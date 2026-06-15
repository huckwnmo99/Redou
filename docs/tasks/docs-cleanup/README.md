# Docs Cleanup — ledger 기반 문서 재편

## Purpose

`docs/` 전체를 ledger 철학(작은 인덱스 + 링크된 작은 파일, "인덱스 먼저 읽고 필요한 것만 연다")에 맞춰 재편한다. 외부 vendored 자료·발표 산출물 노이즈를 제거하고, 단일 진입점을 만들고, 완료된 계획서를 archive로 보내 활성 문서만 표면에 남긴다.

이 README가 ledger 본체다. 먼저 여기서 현재 상태·다음 액션을 확인하고, 링크된 상세 계획만 연다.

## Current Status

- Status: in-progress
- Size: Large (시작 시 `docs/` 367파일 / 전체 `.md` 379)
- Current phase: **Phase 1(vendored + 발표자료 245개 삭제) 작업 트리에 스테이징됨(미커밋).** Phase 2~4는 계획 수립 완료, 승인 대기.
- Owner: Claude(계획·문서 이동) — 코드 영향 없는 문서 작업
- Source of truth: this README + `planned/01_2026-06-15_phase-plan.md`
- Review cadence: phase별

## Non-Technical Summary

문서 폴더에 외부에서 긁어온 참고자료와 발표 슬라이드가 실제 프로젝트 문서와 뒤섞여 있어, "무엇이 어디 있는지" 찾기 어렵다. 이걸 (1) 노이즈 제거, (2) 단일 안내 페이지 추가, (3) 끝난 계획서는 보관함으로 이동, (4) 진행 중인 일만 ledger로 추적하도록 정리한다. 앱 코드와 시스템 진실원천(harness)은 건드리지 않는다.

## Next Action

Phase 1 삭제 커밋 여부 + Phase 2(단일 인덱스)·Phase 3/4(완료 계획서·레거시 폴더 처리) 방침을 승인받는다. → `planned/01_2026-06-15_phase-plan.md`의 "결정 필요" 참고.

## Success Criteria

- `docs/README.md` 단일 진입점이 존재하고, 흩어진 루트 인덱스 문서가 통합/정리됨.
- `docs/harness/`는 시스템 단일 진실원천(SSOT)으로 유지.
- 활성 작업은 `docs/tasks/<work>/` ledger로만 추적.
- 완료된 계획서·제안서·레거시는 삭제가 아니라 `docs/archive/`로 이동(이력 보존).
- 내부 문서 간 깨진 링크 0.
- `docs/` 파일 수가 대폭 감소(Phase 1만으로 245개↓).
- 앱 코드·DB·harness 무변경.

## Documents To Read

- `planned/01_2026-06-15_phase-plan.md` — 현황 실측 데이터, 목표 구조, 단계별 파일 처리, 결정 필요 항목, 검증 기준.
- `docs/harness/main/overview.md` — 시스템 SSOT 진입점.

## Planned

- Phase 2~4 (단일 인덱스 / features 재편 / 레거시·루트 통합) — `planned/01_2026-06-15_phase-plan.md`

## In Progress

- Phase 1 — vendored(reference 146 + exports 66) + presentation_assets 33 삭제. **스테이징됨, 커밋 대기.**

## Completed

- (없음 — Phase 1 커밋 후 `completed/`로 이동)

## Last Updated

2026-06-15
