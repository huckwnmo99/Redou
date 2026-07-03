# Phase 1 — 셀 튜플 스키마 & 병합 계약 보강

> 유형: feature (대규모 develop) | 상태: 구현 완료(검증 통과, E2E 재실증 대기) | 작성일: 2026-07-03 | 구현일: 2026-07-03

## 개요

- **목적**: chat-table 파이프라인의 의미 매핑 결함 D1~D4를 **외부 라이브러리 없이** 스키마·계약 보강으로 봉쇄. "숫자는 정확한데 무엇의 숫자인지 모름" 문제 해결.
- **범위**: (1) 셀 튜플 `{value, unit, condition, source_hint}` (2) 열 의미 타입 `parameter|raw_data|condition` (3) 조건 충돌 감지 (4) 셀 밸리데이터 (5) 흡착 도메인 사전 (6) 임포트 청크 0 경고(감사 A-R6).
- **제외**: Guardian 재설계·eval 축 확장·ground-truth 포맷(Phase 2). docling·LangExtract·MinerU 3.4·측정 튜플 저장소(Phase 3/장기). **DB 마이그레이션**(metadata JSONB 재사용). **새 IPC 채널**. `CURRENT_EXTRACTION_VERSION` 범프(채팅 경로, 추출 파이프라인 아님).

## 현재 동작 근거 (코드 실측)

핵심 데이터 흐름은 `chat/table-pipeline.mjs` → `runPerPaperExtraction`(3b) → `runStage3cMergeFallback`(3c) → `persistTableReport`.

- **셀은 이미 튜플의 씨앗을 가짐**: `PAPER_EXTRACTION_SCHEMA`(`llm-orchestrator.mjs:424`)의 `data_rows[].values`는 `{column_name → string|null}` 평면 맵이고, 행 단위 `confidence`·`source_hint`가 있으나 **셀 단위 조건/단위/출처가 없음**. `source_hint`는 행 전체에 하나뿐이고, 병합 시 **완전히 폐기**됨(→ D3).
- **병합은 코드 전용**: `mergeExtractionResults`(`chat/table-extraction.mjs:222`)가 `values`를 `normalizeColumnKey`로 매칭해 스칼라 문자열로 평탄화. `source_hint`·`confidence` 미참조. 조건이 다른 두 행이 같은 열에 그대로 쌓임(→ D1).
- **열 정의는 문자열 배열**: `table_spec.column_definitions: string[]`(`ORCHESTRATOR_SCHEMA:45`). 의미 타입 없음 → 3b가 파라미터 열에 원시 데이터점을 넣어도 막을 계약 없음(→ D2).
- **정화는 표면적**: `cleanCellValue`(`table-extraction.mjs:22`)는 소수점 포맷만 손봄. JSON 파편(`" uma T (K) : \"308.15\", "` 같은 E2E 관찰 케이스)은 통과(→ D4). 미발견값은 3b가 `null`→병합이 `"N/A"`로 변환하나 문자열 표기 혼재.
- **metadata는 JSONB**: `chat_generated_tables.metadata`는 `20260410012147_add_chat_generated_tables_metadata.sql`로 이미 존재. `persistTableReport`가 `extractionMetadata`(nullSummary·agenticRecovery·perPaperReasons 등)를 통째로 저장. **셀 튜플을 여기 얹으면 DB 변경 불필요**.
- **프론트 타입/렌더**: `ChatGeneratedTable`(`types/chat.ts:95`)은 `headers/rows/metadata?`. `ChatTableReport.tsx`가 `rows`를 스칼라로 렌더, `metadata.perPaperReasons`만 소비. 셀 튜플 hover 노출은 신규.

## 설계

### DB 변경

**없음.** 셀 튜플은 `chat_generated_tables.metadata.cellTuples`(신규 키, 기존 JSONB 컬럼)에 저장. `column_definitions` 의미 타입은 spec 안에만 존재(영속화 시 metadata에 함께 기록 가능, 컬럼 추가 없음).

> [가정 A] metadata JSONB에 셀 단위 데이터(행×열 규모)를 얹어도 실용 크기 내(테이블당 수백 셀×수십 바이트 = 수십 KB). E2E에서 79행×6열 규모 확인 → 검증 시 실제 저장 크기 로깅으로 확인.

### Electron (Backend)

수정 대상 파일:
1. `apps/desktop/electron/llm-orchestrator.mjs` — 스키마·프롬프트
2. `apps/desktop/electron/chat/table-extraction.mjs` — 병합·정화·조건 충돌
3. `apps/desktop/electron/chat/extraction-utils.mjs` — 셀 밸리데이터 헬퍼(정화 유틸 소유)
4. `apps/desktop/electron/chat/table-pipeline.mjs` — persist에 cellTuples/타입 전달 배선
5. `apps/desktop/electron/chat/adsorption-domain.mjs` — **신규** 흡착 도메인 사전(감지+단위 정규화+AIF 필드)
6. `apps/desktop/electron/main.mjs` — A-R6 임포트 청크 0 경고

새 모듈: `chat/adsorption-domain.mjs` (ADR 0002 module ownership 준수 — 도메인 규칙을 파이프라인에서 분리).

새 IPC 채널: **없음.**

### Frontend

**타입** (`frontend/src/types/chat.ts`)
- `ColumnDefinition` 신규: `{ name: string; semantic_type: "parameter" | "raw_data" | "condition" }` — 단, spec은 백엔드 전용이므로 프론트는 렌더에 필요한 것만.
- `CellTuple` 신규: `{ value: string; unit?: string; condition?: string; source_hint?: string; confidence?: string }`.
- `ChatTableMetadata`에 `cellTuples?: CellTuple[][]`(행×열, null 셀은 null) + `columnSemanticTypes?: string[]`(선택) 추가.

**컴포넌트** (`frontend/src/features/chat/ChatTableReport.tsx`)
- 셀에 `metadata.cellTuples[ri][ci]`가 있으면 hover(title 또는 확장)로 `unit`·`condition`·`source_hint` 노출. 표 본체(`rows` 스칼라)는 그대로 — 사용자 결정(hover/확장, 표 형태 유지).

**네비게이션**: 변경 없음.

## 작업 분해

`/develop`가 이 순서대로 실행한다. 각 항목은 독립 검증 가능하도록 배열.

### 1. [x] 열 의미 타입 선언 (D2 기반, 다른 항목의 계약 전제)

- `llm-orchestrator.mjs` `ORCHESTRATOR_SCHEMA.table_spec.column_definitions`를 **문자열 배열 유지하되**, 병렬로 `column_semantic_types: { type: "array", items: { enum: ["parameter","raw_data","condition"] } }`를 추가. (스키마 하위호환: 기존 `column_definitions[i]`와 인덱스 정렬.)
  - [가정 B] 열 정의를 객체 배열로 바꾸면 3b/3c/fallback/정규화 전부의 `column_definitions` 소비처(`sanitizeColumnNames`·`normalizeColumnKey`·`normalizeFallbackTableToSpec`·`mergeExtractionResults`)가 연쇄 변경됨 → **인덱스 정렬된 병렬 배열**로 파급 최소화. developer가 객체 배열이 더 �ന끗하다 판단하면 대안 제시.
- `ORCHESTRATOR_SYSTEM_PROMPT`(`llm-orchestrator.mjs:121` column_definitions 규칙)에 규칙 추가: 각 열의 semantic_type 판정 기준 — "포화 용량 q_max·Langmuir K = parameter, 압력별 평형 흡착량 q(P)·시계열 = raw_data, 온도·압력범위·모델명 = condition". Few-shot 예시 3건에 `column_semantic_types` 추가.
- `EXTRACTION_AGENT_SYSTEM_PROMPT`(`llm-orchestrator.mjs:452`)에 타입 규칙 반영: "parameter 열에는 피팅된 요약값만, raw_data 열에는 원시 측정점만. 혼동 금지."
- 검증: orchestrator 응답 스키마 파싱 통과 + 타입 배열 길이=열 수. 단위 테스트는 spec 정규화 헬퍼에 타입 병렬 배열 보존 케이스 추가.

### 2. [x] 셀 튜플 추출·보존 (D1·D3 핵심)

- `PAPER_EXTRACTION_SCHEMA`(`llm-orchestrator.mjs:424`) `data_rows[].values`를 **셀 튜플 허용**으로 확장. 두 방식 중 택1(developer 판단, 가정 C):
  - (C-1) `values`를 `{column → {value, unit, condition, source_hint} | null}`로. 프롬프트에서 셀별 조건/단위 요구.
  - (C-2) `values`(스칼라) 유지 + 병렬 `cell_meta: {column → {unit, condition, source_hint}}` 추가. 하위호환 큼.
  - [가정 C] **C-2 권장** — 기존 `values` 스칼라 매칭 로직(`mergeExtractionResults`의 평탄화)을 깨지 않고 튜플을 부가. developer가 C-1의 명료성을 우선하면 병합 로직 전면 갱신 각오하고 선택.
- `EXTRACTION_AGENT_SYSTEM_PROMPT`에 셀별 조건/단위/source_hint 지침 추가(예: "각 셀의 값이 특정 온도·압력범위에서 측정됐으면 condition에 기입. 어느 표/그림에서 왔는지 source_hint에 셀 단위로").
- `mergeExtractionResults`(`table-extraction.mjs:222`): 스칼라 병합은 유지하되 **셀별 `{unit, condition, source_hint, confidence}`를 `cellTuples[rowIndex][colIndex]` 2차원 배열로 수집**해 반환값에 추가(`{ tableJson, nullSummary, reasons, cellTuples }`). placeholder 행은 null 튜플.
- `table-pipeline.mjs`:
  - `runStage3cMergeFallback`이 `merged.cellTuples`를 받아 반환에 포함(fallback 경로는 `cellTuples=null` — 셀 단위 추출 없음).
  - `persistTableReport`의 `extractionMetadata`에 `cellTuples`·`columnSemanticTypes` 추가.
- 검증: 병합 단위 테스트에 튜플 수집 케이스 추가(값=스칼라 유지 + cellTuples[r][c].source_hint 보존). E2E에서 metadata.cellTuples 존재·source_hint 비폐기 확인(D3 재발 방지).

### 3. [x] 조건 충돌 감지 → condition 열 파생/주석 (D1 직접 대응)

- `table-extraction.mjs`에 신규 함수 `detectConditionConflicts(cellTuples, headers, semanticTypes)`:
  - 같은 parameter 열에서 서로 다른 non-empty `condition`이 2종 이상이면 충돌로 판정.
  - 처리(가정 D): **행 단위 condition 주석**을 우선 — 충돌 행의 셀 튜플 condition을 유지하고, `tableJson.notes` 또는 신규 `conditionConflicts` metadata에 "열 X에 조건 {293K,저압}이 혼재" 기록. 열 자동 분리(신규 열 삽입)는 헤더 수·정규화·렌더까지 파급이 커서 **주석 우선**.
  - [가정 D] E2E의 D1 케이스(Table3 전범위 vs Table4 저압 q_m 혼재)에서 압력범위 condition이 셀 튜플에 있으면 감지 가능. condition이 비어 있으면 감지 불가 → 항목 2의 프롬프트가 condition을 채우는 것이 전제.
- `persistTableReport`가 `conditionConflicts`를 metadata에 저장. `ChatTableReport.tsx`가 충돌 열 헤더에 경고 아이콘/툴팁(선택, 최소 구현은 metadata 저장까지).
- 검증: 단위 테스트 — 같은 열 2개 condition 주입 시 충돌 1건 감지, 동일 condition이면 0건.

### 4. [x] 셀 밸리데이터 — 파편 차단 + N/A 고정 (D4)

- `extraction-utils.mjs`에 신규 `validateCellValue(raw)`: 반환 `{ ok, cleaned }`.
  - 차단: JSON 파편 패턴(따옴표·콜론·중괄호 잔재 `["':{}]`가 값 안에 섞이고 숫자·단위 정상 패턴이 아닐 때), 과도한 길이(예: >60자), 제어문자.
  - E2E 관찰 케이스 `" uma T (K) : \"308.15\", "`를 픽스처로 고정 — 이게 반드시 걸려야 함.
  - 통과: 순수 수치+단위+참조태그(`5.05 [1]`), "N/A".
- `mergeExtractionResults`가 셀 채우기 직전 `validateCellValue`를 적용 — 실패 셀은 `"N/A"`로 고정(+ nullDetails 기록해 Stage 3d 재검색 대상). `cleanCellValue`(persist 직전, `table-pipeline.mjs:921`)와 역할 분리: validate=차단(병합), clean=포맷(persist).
- 미발견 값 표기 통일: 병합의 `null|undefined|""|"N/A"` → 항상 `"N/A"` 단일 문자열(현재도 그러하나 밸리데이터 실패분까지 일원화).
- 검증: 단위 테스트 — 파편 픽스처 차단, 정상 수치 통과, "N/A" 보존. 기존 `cleanCellValue` 테스트(`table-extraction.test.mjs:13`) 회귀 유지.

### 5. [x] 흡착 도메인 사전 (D2 도메인 정답지, 범용성 보존)

- 신규 `chat/adsorption-domain.mjs`:
  - `detectAdsorptionDomain(tableSpec, paperMetadata)` — column_definitions/title/논문 캡션에 흡착 시그널(isotherm·q_max·Langmuir·Freundlich·adsorb·uptake·mmol/g 등)이 임계 이상일 때만 true.
  - `ADSORPTION_AIF_FIELDS` — NIST AIF 기반: 등온선 원시 점(pressure, loading) vs 핏 파라미터(q_sat/q_max, K_L, n, ΔH) 분리 규정(D2 정답 스키마). semantic_type 힌트 소스.
  - `normalizeAdsorptionUnit(value, unit)` — mol/kg↔mmol/g, kPa↔bar↔Pa 등 상호변환(원본 보존 원칙과 충돌하지 않게 **정규화값은 셀 튜플 unit 옆에 부가**, rows 스칼라는 원본 유지).
- 배선: `runPerPaperExtraction`(`table-pipeline.mjs:419`)에서 도메인 감지 시에만 (a) EXTRACTION 프롬프트에 AIF 분리 규칙 주입 (b) semantic_type 힌트 강화. **비흡착이면 완전 무동작**.
  - [가정 E] 프롬프트에 도메인 규칙을 조건부 append하는 것이 spec 자체 변경보다 안전. developer가 spec에 힌트를 실어야 한다면 항목 1 타입과 결합.
- 검증: 단위 테스트 — 흡착 spec 감지 true / 일반(촉매·재료) spec 감지 false, 단위 정규화 왕복. **비흡착 테이블 생성 회귀 없음**을 E2E 또는 스냅샷으로 확인(Success Criteria 범용성 조항).

### 6. [x] 임포트 청크 0 "조용한 실패" 경고 (감사 A-R6)

- `main.mjs:1189` `if (extractionResult.chunkCount > 0)` 분기: chunkCount===0이면 임베딩 job이 큐잉되지 않고 job은 succeeded로 끝나 사용자에겐 "완료"로 보임. **경고 노출** 추가:
  - `else` 분기에서 `JOB_PROGRESS`/신규 경고 필드 또는 job의 `error_message`에 "텍스트 추출 0청크(스캔본/빈 PDF 의심) — 검색·채팅 불가" 성격 메시지 기록. UI가 이미 소비하는 채널 재사용(신규 IPC 금지).
  - [가정 F] 판정 로직(`paperSignals.ts` core Complete)까지 바꾸지 않고 **경고 노출에 한정**(감사 권장 = "보이는 실패"). paperSignals 변경은 별도 승격.
- 검증: 코드 경로 확인 + chunkCount=0 시 경고 메시지 방출(수동/단위). 정상 논문(chunkCount>0) 경로 무변경.

### 7. [x] 프론트엔드 타입 + 렌더 (항목 2·3 노출)

- `types/chat.ts`: `CellTuple`·`ColumnDefinition`(선택) + `ChatTableMetadata`에 `cellTuples?`·`columnSemanticTypes?`·`conditionConflicts?` 추가(any 0 유지).
- `ChatTableReport.tsx`: 셀 hover로 튜플(unit·condition·source_hint) 노출 + 조건 충돌 열 헤더 경고(최소 툴팁). 표 본체·검증 셀색·references·"데이터 없음" 섹션 전부 보존.
- 검증: `npm run build`(tsc -b + vite) 통과.

### 8. [x] 기존 테스트 갱신 + 신규 테스트 + E2E 재실증

- 갱신: `tests/table-extraction.test.mjs`(188줄)·`tests/table-pipeline.test.mjs`(1464줄) — `mergeExtractionResults` 반환에 `cellTuples` 추가되므로 기존 assert 확장(기존 rows/nullSummary/reasons 시나리오 의미 보존). fallback·persist 경로의 metadata 어서션에 신규 키 반영.
- 신규: 셀 튜플 보존, 열 타입 병렬 배열, 조건 충돌 감지, `validateCellValue` 파편 차단, 흡착 감지·단위 정규화.
- **E2E**: `apps/desktop/.tmp_e2e-table.mjs` 재실행(동일 논문 2편·동일 쿼리) → 원문 대조로 D1~D4 재발 여부 확인(Success Criteria). E2E 스크립트가 `mergeExtractionResults`/persist를 실 배선으로 호출하므로 별도 배선 수정 최소. 필요 시 스크립트에 cellTuples·conditionConflicts 출력 로깅 추가.

## 영향 범위

- 수정되는 기존 파일: `llm-orchestrator.mjs`, `chat/table-extraction.mjs`, `chat/extraction-utils.mjs`, `chat/table-pipeline.mjs`, `main.mjs`, `frontend/src/types/chat.ts`, `frontend/src/features/chat/ChatTableReport.tsx` + 테스트 2개.
- 신규 파일: `chat/adsorption-domain.mjs` + (선택) 그 테스트.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**(임포트/추출 아닌 채팅 경로. 항목 6은 경고만, 추출 로직 무변경).
- DB 마이그레이션: **불필요**(metadata JSONB 재사용).
- 새 IPC 채널: **없음**.

## 리스크 & 대안

- **R-1 스키마 파급**: 열 정의를 객체 배열로 바꾸면 정규화·병합·fallback 전부 연쇄 변경(회귀 위험 큼). → 병렬 배열(가정 B)로 파급 격리. 실패 시 항목 1을 spec-only로 축소.
- **R-2 프롬프트 준수율**: LLM이 셀별 condition/source_hint를 성실히 안 채울 수 있음(로컬 모델). condition이 비면 항목 3(충돌 감지)이 무력. → 항목 2 프롬프트에 few-shot 강화 + E2E로 실측. 못 채우면 조건 감지는 "가능할 때만" 동작(fail-soft).
- **R-3 metadata 크기**: 셀 튜플 2D 배열이 metadata를 키움(가정 A). → 저장 크기 로깅, 필요 시 튜플에서 빈 필드 생략(sparse).
- **R-4 흡착 사전 오탐**: 감지 임계가 낮으면 비흡착 논문에 흡착 규칙 오적용(범용성 훼손). → 임계 보수적 설정 + 비흡착 회귀 테스트를 Success Criteria로 고정.
- **R-5 fallback 경로 튜플 부재**: single_call_fallback은 셀 추출이 없어 cellTuples=null → 그 경로에선 D1/D3 개선 미적용(스칼라만). 수용(fallback은 per-paper 전부 실패 시 한정, fix19로 진입 드묾). 문서화.
- **R-6 E2E 비결정성**: 로컬 LLM(gemma4:31b) 출력이 실행마다 달라 D1~D4 재발 여부가 흔들릴 수 있음. → 재발 "감소"를 정성 확인 + 단위 테스트로 계약(튜플 보존·타입 드롭·파편 차단)을 결정적으로 고정.

## 가정 사항 (developer 확인/판단)

- [가정 A] metadata JSONB에 셀 튜플 2D 저장 크기 실용 범위 — 검증 시 로깅 확인.
- [가정 B] 열 의미 타입은 `column_definitions`와 인덱스 정렬된 **병렬 배열**로(객체 배열 아님) 파급 최소화.
- [가정 C] 셀 튜플은 `values` 스칼라 유지 + 병렬 `cell_meta`(C-2)로 하위호환 — developer가 C-1(중첩 객체) 선택 시 병합 전면 갱신.
- [가정 D] 조건 충돌은 **행 주석/ metadata 기록** 우선(열 자동 분리 아님) — 파급·렌더 복잡도 회피.
- [가정 E] 흡착 규칙은 spec 변경이 아닌 **프롬프트 조건부 주입** — 도메인 감지 시에만.
- [가정 F] A-R6은 **경고 노출에 한정** — `paperSignals.ts` 판정 로직 변경은 별도 승격.
- [가정 G] 표 렌더의 튜플 노출은 **hover title 최소 구현** — 확장 UI는 후속 가능.

## 검증 기준 (Success Criteria 대조)

1. `node --check`: 수정된 electron `.mjs` 전부 통과.
2. `node --test apps/desktop/tests/*.test.mjs`: 기존 65건 회귀 통과 + 신규 케이스 통과.
3. `frontend`: `npm run build`(tsc -b + vite) 통과, `npm run test`(vitest) 회귀 통과, any 0.
4. **E2E 재실증**: `.tmp_e2e-table.mjs` 완주 + 원문 대조로 D1(조건 혼입 시 충돌 기록)·D2(parameter 열에 원시점 미유입)·D3(source_hint metadata 보존)·D4(파편 셀 차단) 재발 여부 확인.
5. **범용성**: 비흡착 spec 감지 false + 비흡착 테이블 생성 무변화(테스트 고정).
6. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경 확인.
7. harness 갱신: `detail/electron/llm.md`(셀 튜플·의미 타입·밸리데이터 계약) + `rag-pipeline.md`(mergeExtractionResults 반환 확장) + `feature-status.md`(항목 추가) + `VERSION.md` 범프.

## 구현 중 변경 사항 (2026-07-03, developer)

계획 대비 실제 구현에서 택한 결정과 미세 편차:

- **[가정 C] C-2 채택** — `PAPER_EXTRACTION_SCHEMA.data_rows[]`에 `values`(스칼라) 유지 + 병렬 `cell_meta: {column → {unit?, condition?, source_hint?}}` 추가. 기존 `values` 스칼라 매칭·평탄화 로직 무변경. 튜플은 순수 부가.
- **[가정 B] 병렬 배열 채택** — `table_spec.column_semantic_types`(enum 배열)를 `column_definitions`와 인덱스 정렬로 추가. 객체 배열로 바꾸지 않음 → 소비처(sanitize/normalize/merge/fallback) 연쇄 변경 회피.
- **[가정 D] 주석/metadata 기록** — `detectConditionConflicts()`가 parameter 열의 상이 condition 2종+를 감지해 `metadata.conditionConflicts`에 기록. 열 자동 분리 없음. 렌더는 충돌 열 헤더에 경고 아이콘+툴팁(최소 구현).
- **[가정 E] 프롬프트 조건부 주입** — `chat/adsorption-domain.mjs`의 `buildAdsorptionPromptHint()`가 도메인 감지 시에만 AIF 규칙 문자열을 반환(미감지 시 `""`). `runPerPaperExtraction`이 per-paper 컨텍스트 뒤에 무조건 append(비흡착은 빈 문자열이라 무동작). spec 자체는 변경 안 함.
- **[가정 F] 경고 노출 한정** — `main.mjs` processImportPdfJob의 chunkCount===0 분기에서 succeeded job의 `error_message`에 경고 기록 + `JOB_PROGRESS` 경고 방출(기존 채널 재사용, 신규 IPC 없음). `paperSignals.ts` 판정 로직 무변경.
- **[가정 G] hover title 최소 구현** — `ChatTableReport.tsx` 셀에 `cellTuples[ri][ci]` 있으면 `title`로 unit·condition·source_hint 노출(검증 title과 결합). 확장 UI는 후속.
- **밸리데이터 규칙(D4)** — `validateCellValue`는 (a) 이중따옴표/중괄호(`"{}`), (b) 공백 인접 콜론+영문(`key : value` 파편), (c) 제어문자, (d) >60자를 차단해 `CELL_NA("N/A")`로 고정. E2E 파편 `" uma T (K) : \"308.15\", "`는 (a)에서 차단(테스트로 고정). 순수 수치·단위·참조태그·모델/물질명·`1:2` 비율은 통과.
- **row-level source_hint 폴백(D3)** — 셀에 자체 source_hint가 없으면 행 단위 `data_row.source_hint`/`confidence`를 셀 튜플로 전파(provenance 폐기 방지).
- **파일 편차**: `extraction-utils.mjs`를 clean 재작성(literal 유니코드 정규식으로 통일, 동작 동일). E2E 스크립트(`.tmp_e2e-table.mjs`)에 cellTuples/semanticTypes/conditionConflicts 진단 로깅 추가(계획 "필요 시" 항목).

### 검증 결과 (2026-07-03)

- `node --check`: main.mjs + 수정/신규 5개 .mjs + E2E 스크립트 전부 통과.
- `node --test tests/*.test.mjs`: **90/90 통과** (기존 65 + 신규 25: validateCellValue 5, adsorption-domain 11, merge/tuple/conflict 5, detectConditionConflicts 4).
- `frontend`: `npx tsc --noEmit` 통과(any 0), `npm run build` 통과, `npm run test` 32/32.
- `CURRENT_EXTRACTION_VERSION`/DB 마이그레이션/새 IPC: 무변경 확인.
- **미완**: 13분 E2E(`.tmp_e2e-table.mjs`) 원문 대조 재실증은 오케스트레이터가 별도 수행(D1~D4 실측).
