# 슬라이스 12 — eval 지표 스코프 (MAPE out-of-query 감점 종식)

> 유형: fix(소, eval 자산만) | 상태: 완료(fixer, 2단계) | 계획: 메인 Claude(Fable 5, planner 대체) 2026-07-06 | 구현 위임: fixer(Opus 4.8)
> 근거: 슬라이스 11 측정에서 규명 — 논문2의 "missing 8"은 파이프라인 결함이 아니라 **eval이 쿼리가 요청 안 한 MAPE(오차지표) 셀을 채점**하는 fixture 이슈. 기본 쿼리("흡착제·q_max·온도 비교")는 오차지표를 요청하지 않으므로 모델이 MAPE 열을 안 만드는 게 정답인데 8셀 감점 발생.

> **구현 결과(fixer, 2단계 마무리)**: (1단계, 앞선 fixer) fixture metric 태그(capacity 35/accuracy 8 + `metricVocabulary`) + scorer 필터(`normalizeMetricRequest`, scope와 독립 축·AND 결합, `metricScoped` 반환, shape 검증) — 보고 유실. (2단계, 이번 fixer) 나머지 3조각: **e2e 배선**(`scripts/e2e-table-fidelity.mjs` `REDOU_E2E_METRIC` env, 기본 `capacity`·`all`=필터 해제·빈문자→capacity 폴백, `GRADING_OPTIONS`로 scope와 병합, 리포트·usage·protocol 로그에 metric 축) + **단위 테스트 9건**(`tests/table-fidelity.test.mjs`: capacity 기본 시 MAPE 제외 / accuracy opt-in / capacity∩full_range AND / 미요청 전체 / 하위호환[metric 필드 부재] / fixture 집계 capacity 35 vs 전체 43) + **ledger·harness**(이 이동 + README + `evals/*` metric 축 + VERSION). `node --check scripts/e2e-table-fidelity.mjs` OK + `node --test tests/*.test.mjs` **207/207**(기존 198 + 신규 9, 회귀 0). fixture JSON 유효. 앱 코드·DB·`CURRENT_EXTRACTION_VERSION` 무변경(eval 자산·문서만), 브랜치 `feature/table-quality-round2` 커밋 없음. **새 in-scope(capacity) baseline 재측정은 오케스트레이터 몫**(RUNS=3, 기본=capacity → 논문2 q_m 8/8 회복 확인). 상세는 README "Completed" 12 항목.

## 확정된 코드 사실 (메인 Claude 실사)

- `eval-runner.mjs`: `normalizeScopeRequest`(:214)가 `options.scope`로 골든 셀을 `cell.scope` 집합 멤버십 필터. scope 미요청 시 전체 채점. **단일 축(문자열)** — 현재 압력(full_range/low_pressure) 용도.
- 실측: 논문2 골든 16셀 = q_m 8(capacity) + MAPE 8(accuracy). **둘 다 압력 scope를 가짐** → 압력 필터로는 분리 불가. `metricVocabulary`/`cell.metric` 부재.
- e2e 기본 쿼리는 capacity(q_max) 요청이나 `REDOU_E2E_METRIC` 개념이 없어 accuracy(MAPE)까지 채점 → 8셀 부당 감점(모든 라운드에서 논문2 50% 천장).

## 구현 (eval 자산만, 파이프라인 무변경)

1. **fixture** (`adsorption-groundtruth-v0.json`): 각 `groundTruthCell`에 `metric` 필드 — q_m 셀 = `"capacity"`, MAPE 셀 = `"accuracy"`. 상단에 `metricVocabulary: ["capacity","accuracy"]`(scopeVocabulary 미러). 스키마 버전 유지(옵셔널 필드 = 하위호환).
2. **scorer** (`eval-runner.mjs`): `options.metric` 필터를 `options.scope`와 **동일 패턴·독립 축(AND 결합)**으로 추가 — `normalizeMetricRequest`, 셀은 (scope 통과) AND (metric 통과)일 때만 채점. metric 미요청 시 전체(하위호환). `assertFidelityGroundTruthShape`에 `metricVocabulary`/`cell.metric` 옵셔널 검증.
3. **e2e 기본값** (`e2e-table-fidelity.mjs`): `REDOU_E2E_METRIC` env(콤마 다중). **기본 쿼리가 capacity 요청이므로 기본 metric = `"capacity"`** → MAPE 8셀 기본 제외(쿼리 의도 정합). accuracy/양쪽은 env로 opt-in. usage 주석·기본 전환 명기.

## 정직성 계약 (계획서에 명시)
- 이것은 **점수 조작이 아니라 채점을 쿼리 의도에 정렬**하는 교정. 파이프라인 실력 불변, 측정 정확도만 개선.
- 기존 baseline 수치(41.9%→72.1%)는 MAPE 포함 채점이었음 — 기본 metric 전환 후 **새 in-scope baseline을 재측정**해 기록(과거 수치와 비교 불가 명시). 이 새 baseline이 LangExtract A/B(tool-ab 슬라이스 04)의 공정 기준선.

## 검증
- 단위: capacity 기본 시 MAPE 제외 / accuracy 명시 시 포함 / 양축(scope∩metric) 결합 / metric 필드 없는 셀 하위호환 / 미요청 전체 채점. 기존 198건 회귀 0.
- 실측(오케스트레이터, RUNS=3, 기본=capacity): 논문2 q_m 8/8 회복(50%→~100% in-scope), 전체 in-scope 중앙값 상승, 신뢰 축(오귀속·조작 0·conflictHandling) 유지 확인.

## 규모
fix(소): fixture + eval-runner + e2e 스크립트 + 테스트. 앱 코드·DB·IPC·`CURRENT_EXTRACTION_VERSION` 무변경. 슬라이스 11과 같은 브랜치(`feature/table-quality-round2`)에서 함께 PR.

## in-scope 기준선 재측정 (오케스트레이터, RUNS=3, 기본 metric=capacity, 2026-07-06)

- **중앙값 fidelity 88.6%** [71.4–88.6, spread 17.1p] (per-run 88.6/71.4/88.6)
- **논문2 q_m 8/8 회복** (missing 0) — MAPE 8셀 제외로 억울한 50% 천장 해소.
- misattribution 0·fabrication 0·conflictHandling 1/1 전 런 — 신뢰 축 완벽 유지.
- 변동폭 48.8p→**17.1p** 안정화(MAPE 노이즈 제거 + 논문 전멸 없음).
- **이 88.6%가 LangExtract A/B(tool-ab 슬라이스 04)의 공정 기준선.** 과거 MAPE-포함 수치(41.9→72.1%)와 직접 비교 불가(채점 범위 다름).
- 잔여(정상 변동): run2 71.4% = 논문1 몇 셀 누락(전멸 아님). 다논문 커버리지·변동은 향후 관찰.
