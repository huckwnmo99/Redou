# 슬라이스 09 — D-b 조건 열 코드 파생(pivot) + D-f 범위 표기 규약

> 유형: fix | 상태: 완료(fixer 2026-07-04) | 작성일: 2026-07-04

> **구현 결과(fixer 2026-07-04)**: 4파일(table-extraction·llm-orchestrator·adsorption-domain + frontend `types/chat.ts`) + 테스트 2를 계획대로 구현. **(1) D-b pivot**: 신규 export `deriveConditionColumns`(순수 함수)가 `mergeExtractionResults` 말미 후처리로 cellTuples.condition을 "측정 조건 (원열명)" 열로 결정적 파생 — headers/rows/cellTuples/columnSemanticTypes/conditionConflicts.columnIndex+derivedColumnIndex/nullSummary.details를 **원자적으로 shift**(충돌 right-to-left 처리, `tableJson.headers`/`rows`·`nullSummary.details` 동일 참조라 in-place splice 전파). **(2) D-f 범위**: EXTRACTION_AGENT 규칙 4 서브불릿("303–343"+cell_meta.condition)·출력 few-shot 범위 1행 + ADSORPTION_HINT 1줄 + `normalizeConditionKey` dash 정규화(en/em/figure/minus→hyphen) + clean/validate 범위 훼손·거부 방지 단위 테스트. **프론트 무수정 자동 렌더**(headers.map + columnIndex 매칭이 shift와 정합), 타입만 `ConditionConflict.derivedColumnIndex?` 추가. **LLM 호출 0 증가·`CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경·외부 라이브러리 0.** `node --test tests/*.test.mjs` **174/174**(기존 163 + 신규 11, 회귀 0). `node --check` 3 .mjs + 테스트 2 + frontend tsc(any 0)+build. **계획 대비 유일한 변경**: 중복 가드를 semantic-type("condition") 기준→**파생 이름 기준**으로 조정 — 정체성 열(흡착제/가스/모델)도 "condition"이라 타입 기준이면 모든 흡착 pivot을 잘못 억제(D-b 무력화)함을 구현 중 실사 발견. 기존 merge/pipeline 테스트 3건은 pivot이 실제로 흐르게 되어 파생 열 반영해 갱신(의도된 동작 전파, 회귀 아님). 13분 실 LLM after는 미실행(오케스트레이터가 08·09 after 측정). 상세는 README "Completed" 09 + VERSION v1.27.

## 개요

- **목적**: 두 결함을 한 슬라이스로(상호 보강 — 조건 충전율).
  - **D-b (conflictHandling 0/2)**: `detectConditionConflicts`가 조건 혼재를 잡기만 하고 표에 반영 안 함. 이미 저장 중인 `cellTuples[r][c].condition`을 **결정적 코드로 "측정 조건" 열로 파생**(tidy data pivot, LLM 0회).
  - **D-f (T(K)=N/A)**: 온도의존 파라미터가 범위(303–343 K)로 피팅됐는데 단일 값이 없어 N/A. **추출 프롬프트에 범위 표기 규약 1줄** + 밸리데이터가 `303–343`을 훼손 안 함을 단위 테스트로 고정.
- **범위**: `chat/table-extraction.mjs`(mergeExtractionResults 파생 열 삽입 + 범위 정규화) + `llm-orchestrator.mjs`/`adsorption-domain.mjs`(범위 표기 프롬프트) + 단위 테스트. eval의 conflictHandling·missing 축으로 측정.
- **제외**: 스테이지·LLM 호출 증가 없음(파생은 순수 코드, 범위는 프롬프트 1줄). DB 마이그레이션 없음(headers/rows/metadata JSONB에 열 하나 추가).

## 근거

- **backlog/20 D-b**: tidy data 원칙 — 측정 조건은 변수이므로 셀 부속물이 아니라 **열**이어야. pivot은 전부 코드 변환(LLM 개입 지점 없음). 데이터(cellTuples.condition)는 이미 저장돼 있음 → LLM 0회·DB 무변경.
- **backlog/20 D-f**: MeasEval 표준(범위+한정자) + AIF(등온선 온도 필수 메타). "단일 값이 아니면 범위" 규약으로 N/A 셀 회복 + D-b 조건 충전율 동반 상승.
- **fixture 실증**: paper2는 T(K)가 N/A(원문 303–343 K 범위, table-semantics README "Phase 2 후보 관찰 1"). D-b는 conflictHandling 0/2가 즉시 작동 대상.

## 코드 실사 결과 (계획 확정 근거 + 핵심 주의점)

- **`detectConditionConflicts`(table-extraction.mjs:249)**가 이미 `{ column, columnIndex, conditions[] }`를 반환 — 어느 열이 혼재인지 안다. 파생은 이 결과를 소비.
- **`mergeExtractionResults`(:283)**가 headers·rows·cellTuples·columnSemanticTypes·conditionConflicts를 **모두 한 함수에서** 생성 → 파생 열 삽입을 이 함수 말미(conditionConflicts 산출 직후)에 하면 5개 배열을 **한자리에서 정합 유지**하며 확장 가능.
- **[핵심 주의점 — 인덱스 정합]**: 파생 "측정 조건" 열을 혼재 열 **뒤에 삽입**하면 그 뒤 열들의 인덱스가 +1 밀린다. 영향받는 것:
  - `conditionConflicts[].columnIndex` — 파생 후 재계산 필요.
  - 프론트 `ChatTableReport.tsx:124-128`이 `conflict.columnIndex`로 헤더 경고를 매칭 → 인덱스가 rows/headers와 일치해야 함(확인: 프론트는 `headers.map`으로 렌더하고 conditionConflicts.columnIndex로 배지 → **삽입을 headers/rows/cellTuples/columnSemanticTypes/conditionConflicts에 원자적으로 반영**하면 프론트 무수정으로 자동 렌더).
  - `nullSummary.details[].columnIndex`·`nullDetails` — 파생 열은 파라미터가 아니므로 nullSummary 대상 아님(파생은 조건 문자열 or N/A). 단 삽입 위치 뒤 컬럼의 columnIndex가 밀리므로 **파생을 nullSummary 생성 이후·반환 직전에** 수행하거나, details의 columnIndex도 함께 shift. **[가정 A]** 파생을 merge 말미(nullSummary·conditionConflicts 산출 완료 후)에 **후처리 단계**로 두고, 삽입 시 뒤 컬럼 인덱스를 참조하는 모든 구조(conditionConflicts, nullSummary.details)를 일괄 shift — 가장 안전.
- **`cleanCellValue`(:22)**: `.replace(/(\d)\.\s/g, "$1 ")`·`/(\d)\.$/` 등 — `303–343`(en-dash)에는 소수점 규칙이 안 걸림(하이픈/en-dash는 `.`이 아님). **범위 훼손 없음이 예상**되나 **단위 테스트로 고정**(D-f 요구).
- **`validateCellValue`(extraction-utils.mjs:99)**: `303–343`은 따옴표·중괄호·control·`key:value` 없음·60자 미만 → **통과 예상**. 단 `303–343 K`에 공백 콜론 없음 확인됨. 단위 테스트로 고정.
- **`normalizeConditionKey`(table-extraction.mjs:225)**: 공백·구두점 제거하나 **en-dash(–)와 hyphen(-)을 구분** → "303-343K" vs "303–343 K"가 다른 키로 잡혀 D-b 파생 시 중복 조건. **dash 정규화 1줄 추가**(backlog/20 D-f (3) 선택항) → 중복 방지.

## 설계

### (1) D-b 조건 열 파생 — `mergeExtractionResults` 말미 후처리

conditionConflicts가 비어있지 않을 때만(혼재 감지된 열 존재 시) 실행:
1. 혼재 열마다(또는 전체에 대해 1개 통합 "측정 조건" 열 — **[가정 B]** 우선 **혼재 열 바로 뒤에 그 열 전용 파생 열 1개**) 파생:
   - 새 헤더: `측정 조건 (${원열명})` 또는 `Measurement condition`.
   - 각 행 값: `cellTuples[r][conflictColIndex].condition` (없으면 `N/A`).
   - headers/rows/cellTuples/columnSemanticTypes 동시 삽입: 파생 열의 semanticType = `"condition"`, cellTuples는 조건 문자열을 담은 tuple(또는 null).
2. 삽입 후 **뒤 컬럼 인덱스 shift**: conditionConflicts[].columnIndex, nullSummary.details[].columnIndex 중 삽입 위치 이상인 것 +1.
3. `conditionConflicts[i].derivedColumnIndex` 필드 추가(렌더러가 "자동 파생" 배지 달 수 있게 — backlog/20 D-b).
4. **[가정 C]** 파생 열이 이미 존재하는 조건 열과 중복되면(orchestrator가 이미 "T (K)" 같은 조건 열을 뒀으면) 파생 생략 — 중복 방지 가드(원 헤더 어휘에 condition 열이 있으면 skip).

### (2) D-f 범위 표기 규약 — 프롬프트 + 정규화

- **프롬프트(1줄)**: `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 4(수치 원본 유지) 뒤 또는 규칙 12(cell_meta) 안에:
  > 파라미터가 온도(또는 압력) **범위에서 피팅**된 값이면 T 열에 N/A 대신 `303–343` 형식의 범위를 기입하고, cell_meta.condition에 `fitted over 303–343 K`를 기록하십시오.
  + few-shot 예시 1개(ΔH·Arrhenius류)를 출력 포맷 예시(:522) 근처에 1개.
- `ADSORPTION_EXTRACTION_HINT`에도 동일 취지 1줄(도메인 게이트 내).
- **정규화(1줄)**: `normalizeConditionKey`에 `.replace(/[–—−]/g, "-")`(en/em/minus dash → hyphen) 추가 → "303-343K" vs "303–343 K" 동일 키.

### (3) 단위 테스트

- `cleanCellValue("303–343")` → `"303–343"`(불변), `cleanCellValue("303–343 K")` → 불변, `cleanCellValue("303.15")` → 불변(회귀).
- `validateCellValue("303–343 K")` → `{ ok: true }`, `validateCellValue("303–343")` → ok.
- `normalizeConditionKey("303-343K") === normalizeConditionKey("303–343 K")`.
- `mergeExtractionResults` — 혼재 열(condition 2종) 입력 → 파생 "측정 조건" 열이 headers/rows/cellTuples/columnSemanticTypes에 삽입되고, conditionConflicts[].derivedColumnIndex가 파생 열을 가리키며, nullSummary.details의 뒤 컬럼 인덱스가 정확히 shift됨. 혼재 없음 입력 → 파생 없음(회귀).

## 작업 분해

1. [ ] `chat/table-extraction.mjs` — `normalizeConditionKey` dash 정규화 1줄. `mergeExtractionResults` 말미에 조건 열 파생 후처리(headers/rows/cellTuples/columnSemanticTypes/conditionConflicts/nullSummary 원자적 삽입+shift, `derivedColumnIndex`, 중복 가드).
2. [ ] `llm-orchestrator.mjs` — EXTRACTION_AGENT_SYSTEM_PROMPT 범위 규약 1줄 + few-shot 1개.
3. [ ] `chat/adsorption-domain.mjs` — ADSORPTION_EXTRACTION_HINT 범위 표기 1줄.
4. [ ] `tests/table-extraction.test.mjs` — cleanCellValue/validateCellValue/normalizeConditionKey 범위 케이스 + merge 파생 열 삽입·인덱스 shift·중복 가드 케이스.
5. [ ] `tests/extraction-utils.test.mjs` — validateCellValue 범위 값 통과 케이스(있으면 여기, 없으면 table-extraction에).
6. [ ] `node --test` 전건 회귀 + `node --check`.
7. [ ] **프론트 확인**: `ChatTableReport.tsx`가 파생 열을 자동 렌더하고 conditionConflicts.columnIndex/derivedColumnIndex 배지가 올바른 헤더에 붙는지 — frontend `npm run build`(tsc) + 수동 관찰(오케스트레이터/tester).
8. [ ] **eval 재측정(07 전제)**: conflictHandling 0/2 → 작동 확인 + paper2 T(K) N/A 회복(missing 감소), fabrication 0 유지.

## 영향 범위

- 수정 파일: 3개(table-extraction·orchestrator·adsorption-domain) + 테스트 2.
- **프론트**: `ChatTableReport.tsx` **무수정 예상**(headers.map + columnIndex 매칭이 파생 열을 자동 수용). 단 파생 열 배지를 위한 `derivedColumnIndex` 활용은 선택(무시해도 렌더 정상). **타입**: `frontend/src/types/chat.ts`의 `ConditionConflict`에 `derivedColumnIndex?: number` 옵셔널 추가(any 0 유지).
- `CURRENT_EXTRACTION_VERSION` **무변경**(채팅 경로). DB 마이그레이션 없음(JSONB에 열 추가).
- 사이드 이펙트: 파생 열이 헤더 수를 늘림 → CSV 내보내기·표 폭에 반영(의도된 정보 추가). D2 회귀(원시점 유입)는 범위 표기가 유발하지 않음(범위는 파라미터 셀의 조건 표기).

## 검증 기준

- 혼재 열 감지 시 파생 "측정 조건" 열이 정확한 값·인덱스로 삽입(단위 테스트).
- 혼재 없으면 파생 없음(회귀).
- `303–343`이 clean/validate/normalize 전 과정에서 훼손·거부·중복되지 않음(단위 테스트).
- 프론트 빌드 통과 + 파생 열 렌더 확인.
- eval(07 인프라): conflictHandling detected 상승(0/2 → ≥1/2) + paper2 T 회복, fabrication·misattribution 0 유지.

## 규모 판단

**소규모 (fix)** — 코어 3파일 + 테스트 2 + 프론트 타입 1(옵셔널 필드). DB/IPC/버전 무변경. 파생은 순수 코드, 범위는 프롬프트 1줄. **단, merge 파생 열 삽입의 인덱스 정합이 세밀**하므로 단위 테스트가 성공 게이트. 다음: `/fix`.

## 가정 사항

- **[가정 A]** 파생을 merge **말미 후처리**로 두고 뒤 컬럼 인덱스를 일괄 shift(conditionConflicts·nullSummary.details) — nullSummary 생성 도중 삽입보다 안전. Stage 3d는 파생 열을 회수 대상으로 보지 않음(condition 열, parameter 아님).
- **[가정 B]** 혼재 열마다 전용 파생 열 1개(통합 1열 아님) — 여러 파라미터가 서로 다른 조건이면 조건도 분리돼야 정확. 통합이 더 낫다는 판단 시 후속 조정.
- **[가정 C]** orchestrator가 이미 조건 열(T/P/Model)을 둔 경우 파생 생략(중복 가드) — 원 헤더 어휘 대조로 판정.
- **[리스크]** 파생 열 삽입이 07의 eval identity 매칭(row 전체 substring)에 영향? → eval은 identity를 "row의 leading 비수치 셀 substring"으로 매칭하므로 파생 조건 열 추가는 매칭을 깨지 않음(오히려 condition 근거 강화). 07 스코프 채점과 상호작용은 07 회귀 테스트로 확인.
