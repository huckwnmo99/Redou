# 슬라이스 07 — eval 보강: 쿼리-스코프 태그 + 3회 중앙값 + clarify 인지

> 유형: fix (도구/측정 인프라만, 프로덕션 무변경) | 상태: 완료(fixer 2026-07-04) | 작성일: 2026-07-04

> **구현 결과(fixer 2026-07-04)**: 4파일 계획대로 수정(fixture scope 태그 + eval-runner 스코프 필터 + e2e 3회 중앙값/clarify + 단위 테스트). `node --test tests/*.test.mjs` **157/157**(기존 147 + 신규 fidelity 10, 회귀 0). scope 미지정 채점 비트 동일 확인. 프로덕션 무변경. 13분 실 LLM E2E는 미실행(오케스트레이터가 새 프로토콜로 baseline 재확립). 상세는 README "Completed" 07 항목.

## 개요

- **목적**: Phase 2.5(경량 품질 라운드)의 **심판 자(尺)를 먼저 신뢰 가능하게** 만든다. 08~10 개선을 before/after로 재려면 eval 자체가 (a) 쿼리 스코프를 반영하고 (b) 런 간 변동을 흡수하고 (c) clarify를 실패로 오판하지 않아야 한다.
- **범위**: `tests/fixtures/evals/adsorption-groundtruth-v0.json`(스코프 태그 추가) + `tests/integration/support/eval-runner.mjs`(스코프 필터 채점) + `scripts/e2e-table-fidelity.mjs`(3회 중앙값 프로토콜 + clarify 리포트). 결정적 단위 테스트.
- **제외**: 프로덕션 파이프라인(`main.mjs`·`electron/chat/**`·`electron/rag/**`·`llm-orchestrator.mjs`) 무변경. 새 스테이지·LLM 호출 증가 없음. 채점 로직만 바뀐다.

## 근거 (5회 실측, 2026-07-04)

- **RUN1 재현**: 동일 조건 fidelity **44.2% ↔ 직전 67.4%**, 런 간 **23%p 변동** (신뢰 축은 안정: 오귀속·조작 0, 검증 86/87). → 단일 런 점수로 08~10 효과를 판정하면 변동에 묻힌다. **3회 중앙값 필요.**
- **RUN3 오판**: 쿼리가 "저압만"으로 세트를 제한했고 추출도 저압 세트만 뽑았는데, eval이 **골든 43셀 전체**(저압+고압)로 채점 → 25.6%로 **부당 감점**. → 골든 셀에 스코프 태그를 달고 쿼리가 스코프를 지정하면 그 서브셋으로만 채점해야 공정.
- **RUN4 무의미**: kinetics 466셀 대형 표는 fixture(흡착 q_m/MAPE) 밖이라 fidelity 0%. → fixture 밖 쿼리는 애초에 이 eval 대상이 아님(스코프 태그의 부수 효과로, 매칭 골든 0이면 "해당 없음"으로 구분 리포트).
- **하네스 결함**: `e2e-table-fidelity.mjs`가 clarify(정상 발동: `hasTable:false` + 명확화 메시지)를 **테이블 없음=FAIL**로 집계(현 `scripts/e2e-table-fidelity.mjs:160-164` `no generated table persisted` → `process.exit(1)`). RUN2·5에서 clarify는 앱의 **강점**(라이브러리 인지 선택지 제시)인데 eval이 실패로 깎는다. → **CLARIFY로 별도 리포트**, FAIL 아님.

## 코드 실사 결과 (계획 확정 근거)

- 골든 fixture(`adsorption-groundtruth-v0.json`)의 각 셀은 이미 `condition`("<=1000 kPa"/"<=100 kPa"/"~600 kPa"/"~100 kPa") 필드를 가진다 — **스코프 태그의 자연 축이 이미 존재**. 새 필드는 이 condition을 이산 라벨로 승격한 `scope`만 추가하면 된다.
- 채점 진입점은 `evaluateTableFidelityCase(groundTruth, tableRow)`(eval-runner.mjs:173). `groundTruthCells`를 순회하며 매칭. **여기서 셀 집합을 스코프로 선(先)필터**하면 나머지 로직(identity/value/condition 매칭·misattribution·fabrication)은 무변경으로 재사용된다.
- `evaluateTableFidelityFixture`(eval-runner.mjs:307)가 paper별 case를 돌리고 overall 집계. 스코프 옵션은 여기로 흘려보내 각 case에 전달.
- e2e 스크립트는 파이프라인 1회 실행 후 1회 채점(`scripts/e2e-table-fidelity.mjs:126,199`). clarify면 `tables.length===0`으로 조기 exit(1). 3회 반복·중앙값·clarify 분기는 이 스크립트 `main()`에만 얹으면 되고 **eval-runner 순수 함수는 그대로**.
- `assertFidelityGroundTruthShape`(eval-runner.mjs:291)가 fixture 스키마를 검증 — `scope` 추가 시 이 검증에 옵셔널로 반영(하위호환: 없어도 통과).

## 설계

### (1) fixture 스코프 태그 — `adsorption-groundtruth-v0.json`

각 `groundTruthCells[]` 원소에 **옵셔널** `scope` 문자열 추가(기존 `condition`을 이산 라벨로 정규화):

| paper | 기존 condition | 신규 scope |
|-------|----------------|-----------|
| paper1 (Table 3) | `<=1000 kPa` | `full_range` |
| paper1 (Table 4) | `<=100 kPa` | `low_pressure` |
| paper2 (Table 4) | `~600 kPa` | `full_range` |
| paper2 (Table 4) | `~100 kPa` | `low_pressure` |

- 파일 상단에 `scopeVocabulary: ["full_range", "low_pressure"]`(paper 공통 어휘) + `description`에 "쿼리가 특정 scope만 요구하면 그 서브셋으로 채점" 1줄.
- **[가정 A]** scope 어휘는 2종(full_range/low_pressure)으로 충분 — 5회 테스트에서 조건 타게팅은 압력 범위 축뿐이었음. 온도/물질 타게팅이 나오면 후속 확장(스키마는 자유 문자열이라 무마이그레이션).
- 스키마 버전은 `table-fidelity-v0` 유지(옵셔널 필드 추가는 하위호환). 만약 tester/reviewer가 버전 명시를 원하면 `table-fidelity-v0.1`로 범프(assert도 함께) — **[가정 B]** 우선 v0 유지, 필드만 옵셔널 추가.

### (2) 스코프 필터 채점 — `eval-runner.mjs`

- `evaluateTableFidelityCase(groundTruth, tableRow, options)` 3번째 인자 추가(옵셔널, **기존 호출 무변경**):
  - `options.scope?: string | string[]` — 지정 시 `groundTruthCells`를 `cell.scope ∈ scope`로 선필터한 뒤 기존 로직 실행.
  - 필터 후 `groundTruthCells`가 비면 `fidelity.total===0` → 기존 코드가 `score=1`을 반환하는데, 이건 오해 소지 → 반환에 `scoped: { requested, matchedCells, applicable: filtered.length>0 }` 부가. `applicable:false`면 리포트에서 "해당 없음(N/A)"으로 표기(fabrication/misattribution도 스코프 내로 한정).
- `evaluateTableFidelityFixture(groundTruth, tableByPaperId, options)` 3번째 인자로 `options.scope`를 각 case에 전달. overall 집계는 `applicable:true`인 case만 합산(fixture 밖/스코프 밖 paper가 0%로 overall을 오염시키지 않게).
- **결정성 유지**: 순수 함수, LLM 없음. 스코프 미지정(`options` 없음)이면 현재와 100% 동일 동작(전 셀 채점).

### (3) 3회 중앙값 + clarify 인지 — `scripts/e2e-table-fidelity.mjs`

- **반복 실행**: env `REDOU_E2E_RUNS`(기본 1, 권장 3). N회 파이프라인 실행 → 각 회 overall fidelity 수집 → **중앙값**(짝수면 하위 중앙) 리포트 + min/max/spread 병기. 각 회는 **새 conversation**(현재도 매 실행 conversation insert하므로 루프만 감싸면 됨).
- **clarify 분기**: 실행 결과가 clarify(테이블 미persist + assistant text 메시지 존재)이면 `tables.length===0`이어도 **FAIL 아님** → `[CLARIFY]` 리포트(발동 사유·메시지 앞부분)하고 그 회는 fidelity 표본에서 제외(clarify는 "측정 불가"이지 "0점"이 아님). 전 회가 clarify면 exit 0 + "clarify only, no fidelity sample".
  - 판별: 파이프라인 결과 `hasTable` 플래그 활용(파이프라인은 clarify 시 `{ hasTable: false, messageId }` 반환 — `table-pipeline.mjs:179` `handleClarifyAction`). e2e 스크립트가 `runTableConversationPipeline` 반환을 받도록 조정(현재 반환 미수신 → `const outcome = await runTableConversationPipeline(...)`).
- **스코프 주입**: env `REDOU_E2E_SCOPE`(예: `low_pressure`) 지정 시 `evaluateTableFidelityFixture(..., { scope })`로 채점 — RUN3 유형(조건 타게팅) 공정 측정.
- 헤더 주석의 usage 블록에 `REDOU_E2E_RUNS`/`REDOU_E2E_SCOPE` 문서화.

### (4) 결정적 단위 테스트 — `tests/table-fidelity.test.mjs`

기존 합성 tableRow(FAITHFUL/CONDITION_MIXED/FABRICATED)에 스코프 케이스 추가:
- `scope:"low_pressure"` 지정 시 골든이 저압 셀로 한정되고, 저압만 담은 합성 테이블이 **부당 감점 없이** 고득점.
- `scope` 미지정 시 기존 점수와 동일(회귀 고정).
- fixture 밖 스코프(`scope:"nonexistent"`) → `applicable:false`, overall 미오염.
- `scopeVocabulary`/옵셔널 `scope` 필드에 대한 `assertFidelityGroundTruthShape` 하위호환(없어도 통과, 있으면 타입 체크).

## 작업 분해 (developer/fixer 실행 순서)

1. [ ] `adsorption-groundtruth-v0.json` — 43셀에 `scope` 필드 추가(condition→라벨 매핑) + `scopeVocabulary` + description 1줄.
2. [ ] `eval-runner.mjs` — `evaluateTableFidelityCase`에 `options.scope` 선필터 + `scoped`/`applicable` 반환. `evaluateTableFidelityFixture`에 `options` 전파 + `applicable` 집계. `assertFidelityGroundTruthShape` 옵셔널 `scope` 검증.
3. [ ] `scripts/e2e-table-fidelity.mjs` — `REDOU_E2E_RUNS` 반복+중앙값, `hasTable` 기반 `[CLARIFY]` 분기(FAIL 제외), `REDOU_E2E_SCOPE` 주입, usage 주석 갱신.
4. [ ] `tests/table-fidelity.test.mjs` — 스코프 필터·중앙값 무관(스크립트는 수동이라 단위테스트는 순수 함수 대상)·applicable·하위호환 케이스 추가.
5. [ ] `node --test` 전건 회귀(기존 fidelity 10건 + 신규) + `node --check` 스크립트.

## 영향 범위

- 수정 파일: 4개 (fixture 1 + eval-runner 1 + e2e 스크립트 1 + 테스트 1). 전부 **테스트/측정 자산** — 프로덕션 무변경.
- 프로덕션(`main.mjs`·`electron/**`·frontend·DB·IPC·`CURRENT_EXTRACTION_VERSION`) 무변경.
- 사이드 이펙트: `evaluateTableFidelityCase`/`Fixture`에 옵셔널 3번째 인자 추가 — 기존 2-인자 호출부(e2e 스크립트, 테스트)는 무변경 동작. **하위호환 100%**.

## 검증 기준 (성공 정의)

- 스코프 미지정 채점이 현재와 비트 동일(회귀 0).
- `scope:"low_pressure"`로 저압-only 합성 테이블 채점 시 RUN3식 부당 감점이 사라짐(단위 테스트로 고정).
- fixture 밖 스코프가 overall을 0%로 끌어내리지 않음(`applicable:false` 제외).
- e2e 스크립트가 clarify 실행을 `[CLARIFY]`로 리포트하고 exit 0(FAIL 아님).
- `REDOU_E2E_RUNS=3` 시 중앙값+spread 출력.
- `node --test` 전건 통과.

## 규모 판단

**소규모 (fix)** — 4파일, DB/IPC/새 컴포넌트/새 모듈 없음, 프로덕션 로직 무변경(측정 자산만). 다음: `/fix`.

## 가정 사항 (사용자/후속 확인)

- **[가정 A]** scope 어휘 2종(full_range/low_pressure)으로 시작 — 5회 테스트의 조건 타게팅이 압력 축뿐이라 충분. 온도/물질 타게팅 시 확장(무마이그레이션).
- **[가정 B]** 스키마 버전 `table-fidelity-v0` 유지(옵셔널 필드 추가는 하위호환) — reviewer가 버전 명시를 요구하면 v0.1 범프.
- **[가정 C]** 중앙값은 3회 기준(짝수 표본 시 하위 중앙). 표본 수는 env로 조절 가능하게 열어둠 — 실 LLM 13분×3=약 40분/측정은 오케스트레이터 수동 수행(CI-off 유지).

## 새 프로토콜 기준선 (오케스트레이터, RUNS=3, gemma4:31b)

- **중앙값 fidelity 41.9% [min 30.2 / max 65.1 / spread 34.9%p]** — per-run 41.9/65.1/30.2. clarify 0회.
- 런3 관찰: 컬럼 스펙 자체가 표류(`q_max (mg/g)` 단위 변형) → 논문2 0/16 + **misattribution 1건**(KACa/N2/323.15 q_m=2.49@<=100kPa) — 신뢰 축도 가장자리에서 흔들림 확인.
- 해석: 변동의 뿌리는 세트 선택+스펙 생성의 비결정성. 슬라이스 08의 성공 기준 = 중앙값 상승 **및 spread 축소** (+오귀속 0 복원).
