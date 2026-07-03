# Phase 2-2 — 골든 픽스처 + 자동 대조 eval

> 유형: feature (대규모 develop) | 상태: 구현 완료(검증 통과, 커밋 대기) | 작성일: 2026-07-03 | 완료일: 2026-07-03 | 슬라이스: 03

## 개요

- **목적**: 손 검증된 논문 2편의 **정답 값(ground-truth)**을 고정 픽스처로 만들고, E2E 산출 테이블과 자동 diff해 **충실성(fidelity)·충돌 처리** 점수 리포트를 낸다(DTBench 축, ADR 0007 확장). 이 eval이 Phase 3(docling·LangExtract A/B)의 심판이 된다.
- **왜**: Phase 1은 E2E "정성 관찰"로 D1~D4 개선을 확인했으나(README "E2E 재실증 결과"), **재현 가능한 수치 점수가 없다**. 추출 프롬프트를 고치거나 새 파서를 A/B 하려면 "얼마나 좋아졌나"를 자동 측정해야 한다. Dagdelen(Nat.Commun. 2024)이 보인 대로 손 검증 정답의 축적은 그 자체가 자산이다 — 이 fixture 포맷이 그 시작이다.
- **범위**: (1) 골든 정답 fixture 2편(원문 Table 3/4의 파라미터·단위·조건) (2) 자동 대조 eval 모드 `table_fidelity`(기존 eval-runner 확장) (3) 충실성·충돌처리 점수 리포트 (4) 임시 스크립트(`.tmp_e2e-table.mjs`·`.tmp_pdftext.mjs`) 정식 승격 판단.
- **제외**: **추출 로직 변경 없음**(eval은 측정만, 개선은 이 eval이 생긴 뒤). 새 코퍼스 발명 금지 — 기존 논문 2편 재사용(README의 원문 대조 기록이 근거). **외부 라이브러리 0개**. DB 마이그레이션·새 IPC·`CURRENT_EXTRACTION_VERSION` 무변경.

## 현재 동작 근거 (코드 실측)

- **eval 인프라 이미 존재**: `tests/integration/support/eval-runner.mjs`에 `loadEvalCaseSet`·`assertEvalCaseSetShape`·`normalizeEvalString`·`evaluateRagRetrievalCase`·`evaluateTableGenerationCase`·`runEvalCase`·`runEvalCaseSet` 구현됨. 스키마 v0(`rag-table-eval-v0`)은 `mode: rag_retrieval | table_generation | combined`(`rag-table-eval-schema.md`).
- **골든 픽스처 존재**: `tests/fixtures/evals/golden-path-v0.json` — 1 case set, 2 case(rag+table). `table_generation` case는 `expected.cells[]`에 `{ row, column, equalsNormalized }`로 셀 정답을 명시하고 `cellExactMatch: "all_asserted"` 게이트(모든 명시 셀이 정규화 후 일치해야 통과). 이건 **합성 golden-path**(1 paper·1 chunk·seeded)라 실제 추출 체인을 검증 못 함(ADR 0007 "known gap" 명시).
- **normalizeEvalString**: 공백 트림·중복 공백 축약만(보수적, `rag-table-eval-schema.md` Normalization Rules). 인용태그 미제거.
- **E2E 스크립트 구조**: `.tmp_e2e-table.mjs`(gitignore `.tmp_*`)가 `runTableConversationPipeline`을 실 Supabase+Ollama+vLLM로 UI 없이 구동. `OWNER_ID`·`PAPER_IDS`(2편)·`QUERY` 하드코딩. main.mjs 배선을 복제(unwrapSingle·intersectPaperIds·loadSourceFileMetadataMap 등). `.tmp_pdftext.mjs`는 pdfjs로 PDF 페이지 텍스트를 라인 재구성해 출력(원문 대조용).
- **원문 대조 정답의 출처**: README "원문 대조(수치 충실도)" — 논문2 Table 4의 DSL/Sips q_m 8개(2.400/2.328/2.450/2.00/4.89/2.95/6.91/6.07), 논문1 Table 3/4의 q_m(8.69/8.07/7.39 전범위, 4.45/2.56/2.49 저압). 이 값들이 fixture 정답의 씨앗.

## 설계

### DB 변경

**없음.** eval은 fixture JSON + 순수 대조 함수. 실 DB 접근이 필요한 combined 모드는 기존 `runEvalCase`의 disposable-Supabase 정책을 따르나, 이 슬라이스의 **핵심 대조는 산출 tableJson vs fixture 정답**이라 DB 불요(오프라인 대조 우선).

### Electron (Backend)

**신규 fixture** `apps/desktop/tests/fixtures/evals/adsorption-groundtruth-v0.json`:
- 포맷: 논문별 정답 셀 목록. 각 셀 = `{ identity, column, value, unit?, condition?, sourceTable }`. 예:
  ```json
  {
    "schemaVersion": "table-fidelity-v0",
    "papers": [
      {
        "paperId": "5e0f399d-...",
        "title": "...",
        "groundTruthCells": [
          { "identity": "DSL", "column": "q_m", "value": "2.400", "unit": "mmol/g", "condition": "303 K", "sourceTable": "Table 4" }
        ]
      }
    ]
  }
  ```
- **정답 값 확정**: README 원문 대조 기록의 값을 1차 seed로 쓰되, **구현 단계에서 `.tmp_pdftext.mjs`(또는 승격판)로 원문 PDF Table 3/4를 재추출해 값·단위·조건을 확정**(가정 A). 정답은 "우리가 원하는 것"이 아니라 "논문에 실제로 있는 것".

**신규 eval 모드** `table_fidelity` — `eval-runner.mjs`에 `evaluateTableFidelityCase(groundTruth, tableRow) → report` 추가:
- **fidelity score**: groundTruthCells 중 산출 테이블에서 (identity 행 + column 열)을 찾아 값이 `normalizeEvalString` 후 일치하는 비율. `matched / total`.
- **misattribution count**: 산출 테이블에 값은 맞으나 **condition이 정답과 다른** 셀 수(D1 충돌 처리 측정 — cellTuples.condition 대조).
- **fabrication count**: 산출 테이블에 있으나 groundTruth 어디에도 없는 non-N/A 수치 셀 수(D2/D4 측정 — 지어낸 값).
- **conflictHandling score**: `metadata.conditionConflicts`가 정답상 실제 혼재하는 열을 잡아냈는지(정답 fixture에 "이 열은 조건 혼재 열"이라고 표기해 대조).
- 반환은 pass/fail 이진이 아니라 **점수 리포트**(ADR 0007 "Future runners may report scores separately from pass/fail"). 회귀 게이트로 쓸 최소 임계(예: fidelity ≥ 직전 값)는 선택.

**임시 스크립트 승격 판단** (가정 B, 이 슬라이스에서 결정):
- `.tmp_e2e-table.mjs` → `apps/desktop/scripts/e2e-table.mjs`로 승격 검토. 이유: gitignore(`.tmp_*`)되어 재현 자산이 소실됨. 승격 시 (a) OWNER_ID/PAPER_IDS/QUERY를 CLI 인자 또는 상단 config 블록으로 (b) main.mjs 배선 복제분을 주석으로 명시 (c) 실 서비스 의존이므로 CI 비대상·수동 실행 문서화.
- `.tmp_pdftext.mjs` → `apps/desktop/scripts/pdf-page-text.mjs` 승격 검토(fixture 정답 생성·검증 도구). 순수 pdfjs·부작용 없음 → 승격 부담 적음.
- **결정 기준**: developer가 "재현 가치 > 리포 노이즈"면 승격, 아니면 fixture 생성 절차만 문서화(`docs/harness/evals/`에 "정답 생성법" 섹션). **둘 중 하나는 반드시 이 슬라이스에서 문서로 확정**.

### Frontend

**없음.** eval은 개발/검증 도구 — 런타임 UI 무관.

## 작업 분해

`/develop`가 이 순서대로 실행한다.

1. [x] **정답 확정** — `scripts/pdf-page-text.mjs`(승격판)로 논문 2편의 원문 Table 3/4 재추출 → 파라미터·단위·조건 확정. README seed 값과 대조(완전 일치).
2. [x] **fixture 작성** — `tests/fixtures/evals/adsorption-groundtruth-v0.json`(`table-fidelity-v0` 스키마), 43셀. 조건 혼재 열(`conditionMixedColumns`) 표기 포함.
3. [x] **eval 함수** — `eval-runner.mjs`에 `evaluateTableFidelityCase`(fidelity·misattribution·fabrication·conflictHandling·missing). `normalizeEvalString` 재사용 + 헬퍼(`stripCitationTags`·`isNumericCellValue` 등).
4. [x] **리포트 형식** — 점수 리포트 객체(pass/fail 이진 아님, 4축+missing 수치). 회귀 임계는 미설정(합성 케이스로 결정성 확보 — 가정 C).
5. [x] **스크립트 승격 판단** — `.tmp_pdftext.mjs`→`scripts/pdf-page-text.mjs`·`.tmp_e2e-table.mjs`→`scripts/e2e-table-fidelity.mjs` **둘 다 승격**(수동·CI-off 배너) + README 생성법 문서화. `.tmp_*` 원본 제거.
6. [x] **테스트** — 신규 `tests/table-fidelity.test.mjs` 10건(정답 일치/misattribution/fabrication/집계 합성 tableRow 결정적 검증).
7. [x] **문서** — `docs/harness/evals/rag-table-eval-schema.md`(`table_fidelity` 모드) + `README.md`(정답 생성법·Dagdelen 취지·live E2E 기록법).

## 구현 중 변경 사항

- **identity에서 조건 분리 (설계 정정)**: 계획 예시는 paper2 identity에 압력범위(`~600`)를 포함하는 뉘앙스였으나, D1 misattribution을 판정하려면 identity(행 정체성=흡착제/가스/모델)와 condition(판별자=압력범위/온도)을 **반드시 분리**해야 함을 구현 중 확인. condition을 identity에 넣으면 파이프라인이 조건을 소실(D1)했을 때 identity 매칭 자체가 실패해 misattribution이 아닌 "missing"으로 오분류됨. → fixture의 `identity`는 조건을 제외하고, `condition`은 전용 필드로 분리. 알고리즘: identity 매칭 행들 중 값 일치 + 조건 보유 시 matched, 값 일치 + 조건 소실/오류 시 misattribution, 값 부재 시 missing. paper1은 원래부터 조건 무관 identity(`KACa CO2 293.15`가 Table 3·4 공유)라 무영향.
- **단위 라벨 정정**: README seed는 q_m 단위를 "mmol/g"로 기재했으나 원문 PDF는 **mol/kg**(수치 동일: 1 mol/kg = 1 mmol/g). "정답은 논문에 있는 것"(가정 A) 원칙에 따라 fixture는 `mol/kg` 채택.
- **스크립트 2개 모두 승격**: 계획은 "최소 하나(pdftext 우선)" 승격이었으나, E2E 스크립트도 fidelity 리포트를 배선해 승격(`scripts/e2e-table-fidelity.mjs`)해야 오케스트레이터 baseline 측정이 재현 가능. 둘 다 `.tmp_*` gitignore로 소실되므로 함께 승격.
- **`evaluateTableFidelityFixture` 추가**: 다논문 단일 병합 테이블을 논문별 정답 블록에 각각 대조·집계하는 편의 함수(계획 4번 "리포트 형식"의 자연스러운 확장). E2E 스크립트가 이를 사용.
- **프론트/DB/IPC/추출 무변경 확정**: 계획대로 평가 측만 변경. `CURRENT_EXTRACTION_VERSION` 무변경.

## 영향 범위

- 수정되는 기존 파일: `tests/integration/support/eval-runner.mjs`(신규 함수 추가), `docs/harness/evals/rag-table-eval-schema.md`(모드 추가). (스크립트 승격 시) `.tmp_e2e-table.mjs`·`.tmp_pdftext.mjs` → `scripts/`.
- 신규 파일: `tests/fixtures/evals/adsorption-groundtruth-v0.json` + eval 테스트.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**(검증 자산).
- DB 마이그레이션: **불필요**.
- 새 IPC 채널: **없음**.

## 리스크 & 대안

- **R-1 정답의 정확성**: fixture 정답이 틀리면 eval 전체가 오염. → 원문 PDF 재추출로 확정(가정 A), README seed는 교차검증용으로만. 정답 확정 근거(page·table)를 fixture에 주석으로.
- **R-2 로컬 LLM 비결정성**: E2E 산출이 실행마다 달라 fidelity가 흔들림 → eval을 **결정적 tableRow 픽스처**로도 돌릴 수 있게(합성 산출 대조 테스트) + 실 E2E는 "현재 점수 기록"용. 회귀 게이트는 합성 케이스로 결정성 확보.
- **R-3 스크립트 승격 노이즈**: `scripts/`에 실 서비스 의존 스크립트를 올리면 CI가 오해할 수 있음 → 승격 시 상단에 "수동 전용·CI 비대상·실 Supabase/Ollama 필요" 배너 + `docs/harness/evals/`에서 실행법 문서화.
- **R-4 identity 매칭 모호**: 정답의 identity("DSL")와 산출 행의 identity 열 매칭이 애매할 수 있음(행 라벨 표기 차이) → `normalizeEvalString` + identity는 첫 열 기준 부분일치 허용(값 대조는 완전일치 유지).

## 가정 사항 (developer 확인/판단)

- [가정 A] fixture 정답은 원문 PDF 재추출로 확정(README seed는 교차검증용). 정답 근거를 fixture에 명시.
- [가정 B] `.tmp_*` 스크립트 중 최소 하나(pdftext 우선)를 `scripts/`로 승격하거나, 못 하면 정답 생성 절차를 harness에 문서화. **이 슬라이스에서 확정.**
- [가정 C] eval은 점수 리포트(비이진). 회귀 게이트 임계는 선택(합성 케이스로 결정성 확보).
- [가정 D] 새 코퍼스 발명 안 함 — 기존 논문 2편(`.tmp_e2e-table.mjs`의 PAPER_IDS) 재사용.

## 검증 기준

1. `node --check`: `eval-runner.mjs` (+ 승격 스크립트) 통과.
2. `node --test tests/*.test.mjs`: 기존 90건 회귀 + 신규 fidelity 케이스(정답 일치/misattribution/fabrication를 합성 tableRow로 결정적 검증).
3. **fixture 유효성**: `adsorption-groundtruth-v0.json`이 `table-fidelity-v0` 스키마를 만족하고 정답 근거(page/table)를 담음.
4. **리포트 산출**: `evaluateTableFidelityCase`가 fidelity·misattribution·fabrication·conflictHandling 4축 수치를 반환.
5. 스크립트 승격/문서화 중 하나 완료.
6. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경.
7. harness 갱신: `evals/rag-table-eval-schema.md`(`table-fidelity` 모드) + `evals/README.md`(정답 생성법·ground-truth 취지) + `VERSION.md` 범프.

## 실행 순서 메모

**Phase 2의 2번**. 슬라이스 02(값 역매칭)가 만든 code-verified/guardian 분포와 이 eval의 fidelity는 상호보완 — 02가 "셀별 검증 주체", 03이 "전체 정답 대비 점수". **02 → 03 권장**하나 03의 fixture·eval 함수는 02와 독립 착수 가능. **이 eval이 이후 프롬프트 개선·Phase 3 A/B의 심판**이므로 Phase 2에서 우선순위 높음.
