# 슬라이스 08 — D-a 커버리지 스펙: completeness enum + 세트 열거 프롬프트 + 병합 카운터

> 유형: fix | 상태: 완료(fixer 2026-07-04) | 작성일: 2026-07-04

> **구현 결과(fixer 2026-07-04)**: 3파일(llm-orchestrator·adsorption-domain·table-extraction) + 테스트 1을 계획대로 수정. (1) `ORCHESTRATOR_SCHEMA.table_spec.completeness` enum `all_sets|representative`(옵셔널·하위호환) + 오케스트레이터 프롬프트 규칙 9·말미 규칙 7·few-shot 예시 2 주석 + `extractColumnsFromPaper`가 `tableSpec.completeness ?? "all_sets"`로 specSection `완전성:` 1줄 주입([가정 B·C] 이행 — 별도 배선 없음, `plan.table_spec`에 실려 전달됨을 `table-pipeline.mjs:509` 실사로 확인). (2) `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 5를 "세트 열거 후 세트마다 정확히 1행"으로 교체(압력 범위 다르면 별개 세트=별개 행, notes 세트 수) + **단위 발명 방지 서브라인**(원문 라벨 그대로, mmol/g vs mg/g — 계획 "핵심 4"·기준선 스펙 표류 대응) + `ADSORPTION_EXTRACTION_HINT`에 "압력 범위별 세트를 각각 행으로"(도메인 게이트 내). (3) `mergeExtractionResults`가 `reasons[]`에 `extractedRowCount`·`distinctConditionCount`([가정 A]대로 경량, `normalizeConditionKey` 재사용) + coverage 로그. **동작 무변경**(rows/tableJson/nullSummary/cellTuples 불변). `node --test tests/*.test.mjs` **163/163**(기존 157 + 신규 6, 회귀 0). `node --check` 3 .mjs + 테스트 파일. **13분 실 LLM E2E는 미실행**(오케스트레이터가 RUNS=3 중앙값+spread로 before 41.9%/34.9p 대비 after 측정). 상세는 README "Completed" 08 항목.

## 개요

- **목적**: 최대 결손 D-a(missing 14/43셀 — "논문당 한 파라미터 세트만 추출")를 **스키마·프롬프트·결정적 카운터**만으로 줄인다. 반복 엔티티의 완전 열거는 LLM의 알려진 약점(backlog/20 D-a: LlamaIndex·LangExtract·SciEx 공통 진단)이며, 처방은 열거 지시 강화 + 커버리지 관측이다.
- **범위**: `llm-orchestrator.mjs`(ORCHESTRATOR_SCHEMA + 오케스트레이터 프롬프트 + EXTRACTION_AGENT_SYSTEM_PROMPT) + `chat/table-extraction.mjs`(mergeExtractionResults 커버리지 카운터). eval 재측정.
- **제외**: 멀티패스(호출 +N)는 `tool-ab-adoption/planned/04`(LangExtract A/B)가 이미 심판 예정 — **중복 도입 금지**. 스테이지 추가·LLM 호출 증가 없음(기존 3b 프롬프트 강화만).

## 근거

- **backlog/20 D-a**: missing 14/43이 fidelity 최대 결손. 처방은 (1) 완전성 의도를 스펙으로 명문화 (2) "세트 열거 후 세트마다 1행" 프롬프트 (3) 커버리지 카운터(측정만).
- **fixture 실증**: paper1은 Table 3(full_range 15셀)+Table 4(low_pressure 12셀) **두 세트**를 모두 담아야 하는데, 실측에서 모델이 한 표만 선택 → 27셀 중 절반 missing. `perPaperReasons`에 "Table3 vs 4 선택 근거"가 서술됨(=편향의 자백). 3.4 기준선(67.4%)은 논문1이 40.7→77.8%로 오르며 "양쪽 세트 추출"이 지렛대임을 이미 입증(tool-ab README) — **08은 이 효과를 프롬프트로 안정화·강화**.
- **런 변동 축소 기대**: "세트 열거"를 명시적 서브태스크로 만들면 "어느 세트를 고를까"의 비결정성이 줄어 07의 23%p 변동도 완화 기대.

## 코드 실사 결과 (계획 확정 근거)

- `ORCHESTRATOR_SCHEMA.table_spec`(llm-orchestrator.mjs:40-58)은 `column_semantic_types`를 이미 병렬 배열로 추가한 선례가 있음 → `completeness` enum 추가는 동일 패턴(옵셔널·하위호환).
- 오케스트레이터 프롬프트(ORCHESTRATOR_SYSTEM_PROMPT, :97-203)에 column_definitions 규칙 8개 + few-shot 3개. `completeness` 규칙 1줄 + few-shot 주석 1줄 추가 지점 명확.
- 추출 프롬프트(EXTRACTION_AGENT_SYSTEM_PROMPT, :486-543)의 **규칙 5**("여러 실험 조건이면 여러 행")를 **열거-후-추출**로 강화하는 게 핵심. 규칙 5 자리에서 "값 쓰기 전 세트(온도×압력×모델×물질) 열거 → 세트마다 정확히 1행 → notes에 세트 수 기재"로 확장. `PAPER_EXTRACTION_SCHEMA.notes`(:481)는 이미 존재하므로 세트 수 기록에 스키마 변경 불요.
- `mergeExtractionResults`(table-extraction.mjs:283)는 이미 `nullSummary`·`reasons`·`droppedRowCount`를 반환하고 per-paper 단위로 순회(`for result of extractionResults`). **커버리지 카운터는 이 루프에서 result별 `data_rows.length` vs `parsedMatrices` 행 수를 `reasons[]`에 필드 추가**하면 됨(반환 형태 확장, 동작 무변경).
  - 단, `mergeExtractionResults`는 현재 `parsedMatrices`를 **인자로 받지 않음**(table-pipeline이 별도 보유). 커버리지 지표에 파싱 행 수가 필요하면 (a) 호출부에서 per-paper 파싱 행 수를 계산해 넘기거나 (b) 지표를 "data_rows 수 vs 스코프 논문 기대 행 수" 같은 더 가벼운 형태로. **[가정 A]** 우선 (b) 경량 지표(`extractedRowCount` + `distinctConditionCount`)만 `reasons`에 기록 — parsedMatrices 배선 없이 관측 가능(cellTuples의 condition 개수는 merge가 이미 계산).
- `adsorption-domain.mjs`의 `ADSORPTION_EXTRACTION_HINT`(:127)에도 세트 열거 문구를 흡착 도메인 한정으로 보강 가능(도메인 감지 시에만, 비흡착 무영향).

## 설계

### (1) completeness enum — `llm-orchestrator.mjs` ORCHESTRATOR_SCHEMA

```
table_spec.properties.completeness: {
  type: "string",
  enum: ["all_sets", "representative"],
}
```
- 오케스트레이터 프롬프트에 규칙 1줄: "**completeness**: 사용자가 '대표만'/'하나만'이라 명시하지 않는 한 `all_sets`(모든 조건 세트를 각각 행으로). 명시 시 `representative`." + few-shot 예시 2(등온선)에 `completeness: "all_sets"` 주석 1줄.
- **[가정 B]** 기본값 처리: 스키마 required 아님. 프롬프트가 all_sets를 유도하되, 소비처(추출 프롬프트 조립)에서 `tableSpec.completeness ?? "all_sets"`로 폴백.

### (2) 세트 열거 추출 프롬프트 — `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 5 강화

규칙 5를 다음으로 교체(열거를 명시적 서브태스크로):
> **5. 세트 열거 후 세트마다 1행.** 값을 쓰기 전에, 이 논문에 존재하는 **파라미터 세트**(조건 조합: 온도 × 압력범위 × 모델 × 물질)를 먼저 모두 세십시오. 그런 다음 **각 세트마다 정확히 1행**을 출력하십시오. 같은 물질·모델이라도 압력 범위(예: 저압 피팅 vs 전 범위)가 다르면 **별개의 세트=별개의 행**입니다. notes에 발견한 세트 수를 기재하십시오(예: "2 pressure-range sets per adsorbate").

- `completeness === "representative"`일 때만 "대표 세트 1개"로 축소하는 분기를 추출 프롬프트 조립(`extractColumnsFromPaper` 호출 전 specSection)에 1줄 주입. **[가정 C]** completeness는 tableSpec에 담겨 이미 `extractColumnsFromPaper(tableSpec, ...)`로 전달되므로, 프롬프트 텍스트에 `완전성: ${tableSpec.completeness ?? "all_sets"}` 한 줄을 specSection에 추가(llm-orchestrator.mjs:571 specSection).
- 흡착 도메인 힌트(`ADSORPTION_EXTRACTION_HINT`)에도 "압력 범위별 세트를 각각 행으로"를 1줄 보강(도메인 게이트 내, 비흡착 무영향).

### (3) 병합 커버리지 카운터 — `mergeExtractionResults`

- per-paper 순회에서 result별로 관측 지표 계산 후 `reasons[]` 원소에 부가:
  - `extractedRowCount` — 이 논문이 실제 기여한 데이터 행 수(placeholder 제외).
  - `distinctConditionCount` — 이 논문 행들의 cellTuples에서 나온 **서로 다른 condition 개수**(normalizeConditionKey 재사용 — 이미 detectConditionConflicts에서 쓰는 정규화). 세트 커버리지 프록시.
- 로그 1줄 확장: 현 `[Chat/Merge] rows=… conditionConflicts=…`에 `coverage=[{refNo, rows, conditions}]` 추가(측정 관측).
- **동작 무변경**: 카운터는 기록만. rows/tableJson/nullSummary 산출은 그대로.

## 작업 분해

1. [ ] `llm-orchestrator.mjs` — ORCHESTRATOR_SCHEMA `completeness` enum + 오케스트레이터 프롬프트 규칙 1줄 + few-shot 주석 + `extractColumnsFromPaper` specSection에 완전성 1줄 + EXTRACTION_AGENT_SYSTEM_PROMPT 규칙 5 열거-후-추출 교체.
2. [ ] `chat/adsorption-domain.mjs` — `ADSORPTION_EXTRACTION_HINT`에 압력 범위 세트 열거 1줄 보강(도메인 게이트 내).
3. [ ] `chat/table-extraction.mjs` — `mergeExtractionResults`가 `reasons[]`에 `extractedRowCount`·`distinctConditionCount` 기록 + coverage 로그.
4. [ ] `tests/table-extraction.test.mjs` — 커버리지 카운터 단위 테스트(2세트 입력 → distinctConditionCount≥2, 1세트 → 1). 기존 merge 테스트 회귀 유지.
5. [ ] `tests/*` 회귀(`node --test` 전건) + `node --check llm-orchestrator.mjs`.
6. [ ] **eval 재측정(07 완료 전제)**: `REDOU_E2E_RUNS=3` 중앙값 before/after — paper1 missing 14 감소 확인(오케스트레이터 수동, 실 LLM).

## 영향 범위

- 수정 파일: 3개(orchestrator·adsorption-domain·table-extraction) + 테스트 1.
- **[중요] `CURRENT_EXTRACTION_VERSION` 무변경** — 채팅 파이프라인(추출 파이프라인 아님). backlog/20 명시(추출 프롬프트 변경은 버전 무관).
- DB/IPC/새 컴포넌트/새 모듈 없음.
- 사이드 이펙트: `completeness` 옵셔널·폴백 all_sets라 기존 대화 무영향. 규칙 5 강화는 "행을 더 뽑는" 방향이라 fabrication 리스크 점검 필요 → **07의 fabrication 축(0 유지)이 게이트**. 만약 세트 열거가 원시점 유입(D2 회귀)을 부르면 규칙 11(파라미터 vs 원시점)이 방어 — eval의 fabrication/misattribution으로 확인.

## 검증 기준

- `completeness` 미지정 대화가 기존과 동일 동작(폴백 all_sets).
- 커버리지 카운터가 2세트 논문에서 `distinctConditionCount≥2` 기록(단위 테스트).
- `node --test` 전건 통과.
- eval before/after(07 인프라, 3회 중앙값): paper1 fidelity 상승 + missing 감소, **fabrication·misattribution 0 유지**(신뢰 축 회귀 금지가 성공 조건).

## 규모 판단

**소규모 (fix)** — 3파일+테스트, DB/IPC/버전 무변경, 프롬프트·스키마·카운터 수준. 다음: `/fix`.

## 가정 사항

- **[가정 A]** 커버리지 지표는 경량(`extractedRowCount`·`distinctConditionCount`)으로 시작 — parsedMatrices를 merge에 배선하지 않음(배선은 별도 리팩터로, 지금은 관측 최소). 더 정밀한 "파싱 행 수 대비 추출 행 수"가 필요하면 후속.
- **[가정 B]** `completeness` 기본 all_sets는 소비처 폴백(`?? "all_sets"`)으로 처리 — 스키마 default 미의존(Ollama format 스키마는 default를 강제 안 함).
- **[가정 C]** completeness는 tableSpec에 실려 `extractColumnsFromPaper`로 이미 전달됨 — 추가 배선 없이 프롬프트 텍스트에만 반영.
- **[리스크]** 세트 열거 강화가 행 과다·원시점 유입을 부를 수 있음 → eval의 fabrication/misattribution 축으로 게이트(회귀 시 롤백 또는 규칙 11 강화).
