# LLM 모듈
> 하네스 버전: v1.28 | 최종 갱신: 2026-07-04

## 개요
Ollama 기반 LLM 채팅 스트리밍, 비교 테이블 생성 오케스트레이션, Q&A 응답, Granite Guardian 검증을 담당한다. 사용자가 Settings에서 모델을 변경할 수 있다.

> **이 문서는 LLM 에이전트/프롬프트 계층**(`llm-orchestrator`/`llm-chat`/`llm-qa`)을 다룬다. 테이블 생성 **파이프라인의 모듈 구조·스테이지별 상태**는 6월 리팩터(ADR 0001 debuggable-module-split)로 `chat/*` 모듈에 분리됨 → 권위 문서 `chat-table-pipeline-state.md`. RAG 검색은 `rag-pipeline.md`, 그래프 QA는 `entity-graph.md` 참고.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/llm-chat.mjs` | 스트리밍 채팅 + Guardian + 모델 관리 | ~159 |
| `apps/desktop/electron/llm-orchestrator.mjs` | Orchestrator + Table Agent + Extraction Agent + NULL Recovery Agent | ~660 |
| `apps/desktop/electron/llm-qa.mjs` | Q&A 시스템 프롬프트 + 응답 생성 + 출처 귀속 | ~121 |
| `apps/desktop/electron/html-table-parser.mjs` | HTML 테이블 → headers/rows 파싱 (코드) | ~312 |
| `apps/desktop/electron/chat/*` | 채팅 파이프라인 모듈 분리(table-pipeline, **qa-pipeline**, table-extraction, agentic-null-recovery, source-evidence, value-backmatch, status-events, abort-guards, extraction-utils) — 6월 ADR 0001. + `adsorption-domain.mjs`(7월 Phase 1, 흡착 도메인 사전). **`qa-pipeline.mjs`=슬라이스 04에서 `main.mjs`의 `handleQaPipeline`을 DI로 추출**(`runQaConversationPipeline`, 동작 보존) | → `chat-table-pipeline-state.md`, 하단 Phase 1 계약 |
| `apps/desktop/electron/rag/multi-query-rag.mjs` | 멀티쿼리 RAG (orchestrator에서 분리) | → `rag-pipeline.md` |

## 주요 함수/컴포넌트

### llm-chat.mjs
| 함수 | 역할 |
|------|------|
| `streamChat(messages, abortSignal)` | Ollama NDJSON 스트리밍 (async generator) |
| `checkGroundedness(sourceText, claim)` | Guardian: "Yes"=ungrounded, "No"=grounded |
| `isLlmAvailable()` | 현재 모델 가용 확인 |
| `isGuardianAvailable()` | granite3-guardian 가용 확인 |
| `getActiveModel()` / `setActiveModel(model)` | 런타임 모델 변경 |

### llm-orchestrator.mjs
| 함수 | 역할 |
|------|------|
| `generateOrchestratorPlan(history, papers, prevTable, signal)` | 의도 분석 → {action, search_queries, table_spec, keyword_hints} |
| `generateTableFromSpec(tableSpec, ragContext, paperMeta, signal)` | Table Agent: RAG → 테이블 JSON (single-call fallback) |
| `extractMatrixFromHtml(htmlSnippet, signal)` | Extractor Agent: HTML → {headers, rows} (LLM 폴백) |
| `extractColumnsFromPaper(tableSpec, context, title, signal)` | Per-paper Extraction Agent (SRAG 3b) |
| `extractNullCellsFromPaper(tableSpec, nullColumns, context, title, signal)` | NULL Recovery Extraction Agent (SRAG 3d) |

### llm-qa.mjs
| 함수 | 역할 |
|------|------|
| `generateQaResponse(ragContext, history, paperMeta, signal)` | Q&A 스트리밍 응답 (streamChat 래핑) |
| `formatSourceAttribution(text, paperMeta, evidenceLocationsByPaper?)` | [1], [2] 참조번호 → paperId 매핑 (+ evidence 위치 라인) |

> `llm-qa.mjs`는 **프롬프트·응답·귀속 계층**만 담당한다. QA 대화 **오케스트레이션**(RAG 스코프·graph on/off 분기·evidence 조립·스트리밍·persist)은 슬라이스 04에서 `chat/qa-pipeline.mjs`의 `runQaConversationPipeline`으로 분리됨(table-pipeline과 동일 DI). 흐름·상태 이벤트는 `chat-table-pipeline-state.md` "QA Branch Flow" 참고.

### chat/qa-pipeline.mjs — QA 인용 결정적 검증 (슬라이스 05)
| 함수 | 역할 |
|------|------|
| `orderPaperMetadataDeterministic(paperMetadata, ragResults)` | refNo `[N]` 순서를 **결정적**으로 고정(B-D3). 정렬 기준: ① `ragResults.chunks` 첫 등장 순위(이미 rerank됨) → ② `figures` 첫 등장 순위 → ③ paperId 사전순 tiebreak. 입력 불변(새 배열 반환). paperRefMap·프롬프트 refList·귀속·persist가 이 순서를 공유 → 실행 간 재현성 + 대화 내부 일관. |
| `checkQaCitations(text, orderedMeta, ragResults)` | `[N]` 인용의 **코드 검증**(LLM 미사용) → `{ citationCount, inRange, outOfRange, grounded, ungroundedRefs }`. `outOfRange`=존재하지 않는 [N](범위 밖), `ungroundedRefs`=범위는 맞으나 인용 논문 paperId가 RAG 근거(`chunks∪figures`) 집합에 **부재**(약한 정합 실패). **groundedness(주장 뒷받침)는 아님** — 명시 제외. |

> QA 파이프라인은 `formatSourceAttribution`(범위-only) 뒤 `checkQaCitations`를 실행해 `outOfRange`/`ungroundedRefs`를 **기록만** 한다(답변 차단·텍스트 변경 없음). 결과는 assistant 메시지 `metadata.citationCheck: { citationCount, outOfRange, ungroundedRefs }`(기존 JSONB)에 저장 — 신규 대화부터 적용, 과거 metadata 미재작성. table 파이프라인이 셀 [refNo]를 코드 병합에서 부여하는 것과 대칭으로, QA도 이제 refNo 순서가 코드-결정적이다.

## LLM 에이전트 구조

| 에이전트 | 모델 | 응답 형식 | 온도 | 용도 |
|----------|------|-----------|------|------|
| Orchestrator | 활성 모델 | JSON (ORCHESTRATOR_SCHEMA) | 0.2 | 의도 분석, 쿼리/테이블 사양 설계 |
| Table Agent | 활성 모델 | JSON (TABLE_OUTPUT_SCHEMA) | 0.1 | RAG → 비교 테이블 JSON |
| Extraction Agent | 활성 모델 | JSON (PAPER_EXTRACTION_SCHEMA) | 0.1 | 단일 논문 데이터 추출 (SRAG) |
| NULL Recovery Agent | 활성 모델 | JSON (PAPER_EXTRACTION_SCHEMA) | 0.1 | Stage 3d에서 NULL 컬럼만 재추출 |
| Extractor Agent | 활성 모델 | JSON (EXTRACTOR_OUTPUT_SCHEMA) | 0.0 | HTML 테이블 파싱 (LLM 폴백) |
| Q&A Agent | 활성 모델 | 스트리밍 텍스트 | 0.3 | RAG 기반 질의응답 |
| Guardian | granite3-guardian:8b | "Yes"/"No" | 0.0 | groundedness 검증 |

## Orchestrator action 흐름

```
action = "clarify"
  → clarification_response → 스트리밍 반환 (토큰 분할)

action = "generate_table" / "modify_table"
  → search_queries: 2~5개 (영어, 과학 용어)
  → table_spec: { title, row_axis, column_definitions(4~8), inclusion/exclusion }
  → keyword_hints: 소문자 영어 키워드
```

## Stage 3d Agentic NULL Recovery

> 구현 위치: `chat/agentic-null-recovery.mjs`(6월 분리). 아래 로직 설명은 유효.

테이블 생성의 SRAG 경로에서 `mergeExtractionResults()`가 `nullSummary`를 만든 직후, `cleanCellValue()` 전에 실행된다. `single_call_fallback` 경로는 `nullSummary`가 없으므로 건너뛴다.

핵심 흐름:
- `shouldTriggerAgenticRecovery()`가 NULL 비율 5% 이상, 남은 NULL details, 테이블 row 존재 여부를 확인한다.
- `groupNullsByPaper()`가 `nullSummary.details`를 논문별로 묶고, `buildRecoveryQueries()`가 LLM 없이 컬럼명/단위/keyword_hints 기반 복구 검색 쿼리를 만든다.
- `runPaperScopedRecoverySearch()`는 기존 `runMultiQueryRag()`를 단일 paperId 범위로 호출한다.
- Gate 1: 기존 Stage 2/3b 컨텍스트에 없던 `chunk_id` 또는 `figure_id`가 하나도 없으면 `extractNullCellsFromPaper()`를 호출하지 않는다.
- Gate 2: `applyRecoveredValues()`는 `confidence === "high"`인 결과만 기존 `N/A` 셀에 채운다.
- 전체 `runAgenticNullRecovery()`는 fail-soft이며 오류/timeout/abort 시 원본 `tableJson`과 `nullSummary`를 반환하고 `agenticRecovery` metadata만 기록한다.

## 테이블 의미 보강 Phase 1 계약 (table-semantics-hardening, 2026-07-03)

E2E 원문 대조에서 확인된 의미 매핑 결함 D1~D4를 **외부 라이브러리 없이** 스키마·계약 보강으로 봉쇄. 추출 파이프라인 아닌 채팅 경로 — `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경(metadata JSONB 재사용).

### 스키마 확장 (`llm-orchestrator.mjs`)
- `ORCHESTRATOR_SCHEMA.table_spec.column_semantic_types` (신규, 선택) — `column_definitions`와 **인덱스 정렬된 병렬 배열**. 각 원소 enum `parameter|raw_data|condition`. 객체 배열이 아니라 병렬 배열로 소비처(sanitize/normalize/merge/fallback) 파급 격리(D2). 프롬프트·few-shot 3건에 판정 기준·예시 추가.
- `PAPER_EXTRACTION_SCHEMA.data_rows[].cell_meta` (신규, 선택) — `values`(스칼라) 유지 + 병렬 `{column → {unit?, condition?, source_hint?}}`. 셀별 조건/단위/출처를 부가(C-2 방식). 기존 `values` 스칼라 매칭 로직 무변경(D1/D3). `EXTRACTION_AGENT_SYSTEM_PROMPT`에 cell_meta 지침 + parameter/raw_data 혼동 금지 규칙 추가.

### 셀 밸리데이터 (`chat/extraction-utils.mjs`)
- `validateCellValue(raw) → { ok, cleaned, reason? }` (신규) — 병합이 셀을 채우기 직전 적용(D4). 차단: 이중따옴표/중괄호(`"{}`, json_fragment), 공백 인접 콜론+영문(`key : value`, kv_fragment), 제어문자(control_char), >60자(too_long). 실패 셀은 `CELL_NA("N/A")`로 고정(+ nullDetails 기록 → Stage 3d 재검색 대상). 통과: 순수 수치·단위·참조태그(`5.05 [1]`)·모델/물질명·`1:2` 비율·"N/A". E2E 관찰 파편 `" uma T (K) : \"308.15\", "`가 json_fragment로 차단됨(테스트 고정). `cleanCellValue`(persist 직전 포맷)와 역할 분리: validate=차단(병합), clean=포맷(persist). `CELL_NA` 상수 export.

### 병합 계약 (`chat/table-extraction.mjs`)
- `mergeExtractionResults()` 반환이 `{ tableJson, nullSummary, reasons }` → **`+ cellTuples, columnSemanticTypes, conditionConflicts`**로 확장.
  - `cellTuples[rowIndex][colIndex]`: `{unit?, condition?, source_hint?, confidence?}` 또는 null. `rows`와 정렬(placeholder 행은 null 튜플). 셀 자체 source_hint 부재 시 행 단위 `data_row.source_hint`/`confidence` 폴백(D3 provenance).
  - `columnSemanticTypes`: spec의 `column_semantic_types`를 헤더 길이로 트림(부재 시 null).
  - `conditionConflicts`: `detectConditionConflicts` 결과.
- `detectConditionConflicts(cellTuples, headers, semanticTypes)` (신규) — 같은 **parameter 열**(raw_data/condition 열은 스킵)에서 정규화 후 상이한 non-empty condition이 2종+면 `{column, columnIndex, conditions[]}` 충돌 기록(D1). 열 자동 분리 아님(주석/metadata 기록 우선).

### 흡착 도메인 사전 (`chat/adsorption-domain.mjs`, 신규 모듈)
- `detectAdsorptionDomain(tableSpec, paperMetadata?)` — column_definitions/title/캡션에 흡착 시그널(isotherm·q_max·langmuir·mmol/g 등)이 **≥2종**일 때만 true(보수적 임계, 비흡착 오탐 방지 R-4).
- `ADSORPTION_AIF_FIELDS` — NIST AIF: 핏 파라미터(q_sat/q_max, K_L, n, ΔH) vs 원시점(P, q(P), q(t)) vs 조건(T, 물질, 모델) 분리 규정(D2 정답 스키마).
- `normalizeAdsorptionUnit(value, unit)` — mol/kg↔mmol/g, bar/atm/Pa↔kPa 정규화(부가값, 원본 미변경). 미지 단위/비수치는 null.
- `buildAdsorptionPromptHint(tableSpec)` — 감지 시 AIF 분리 규칙 문자열, 미감지 시 `""`. `runPerPaperExtraction`(`table-pipeline.mjs`)이 per-paper 컨텍스트 뒤에 무조건 append(비흡착=빈 문자열=무동작). spec 자체는 변경 안 함(가정 E).

### persist (`chat/table-pipeline.mjs`)
- `runStage3cMergeFallback` → `persistTableReport` 배선: `metadata.cellTuples`·`metadata.columnSemanticTypes`·`metadata.conditionConflicts` 저장. **single_call_fallback 경로는 셀 단위 추출 없음** → `cellTuples=null`, `conditionConflicts=[]`(R-5, 스칼라 경로).

### 프론트 (`types/chat.ts`, `ChatTableReport.tsx`)
- `CellTuple`/`ConditionConflict`/`ColumnSemanticType` 타입 + `ChatTableMetadata`에 `cellTuples?`/`columnSemanticTypes?`/`conditionConflicts?` 추가(any 0).
- 렌더: 셀에 튜플 있으면 `title` hover로 unit·condition·source_hint 노출(검증 title과 결합). 충돌 열 헤더에 경고 아이콘(AlertTriangle)+툴팁. 표 본체(rows 스칼라)·검증 셀색·references·"데이터 없음" 섹션 전부 보존.

## D-a 커버리지 스펙 계약 (table-semantics-hardening Phase 2.5 슬라이스 08, 2026-07-04)

최대 결손 D-a(반복 조건 세트를 다 담지 못함 — "논문당 한 세트만 추출")를 **스키마·프롬프트·결정적 카운터**로만 겨냥. 스테이지·LLM 호출 증가 없음(기존 3b 프롬프트 강화만). `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경(채팅 경로).

### completeness enum (`llm-orchestrator.mjs`)
- `ORCHESTRATOR_SCHEMA.table_spec.completeness` (신규, 선택) — enum `all_sets|representative`. 옵셔널·하위호환(`table_spec.required` 없음, 최상위는 여전히 `action`만 required). `column_semantic_types`와 동일한 옵셔널 병렬 확장 패턴.
- 오케스트레이터 프롬프트: column 규칙 9 + 말미 규칙 7 + few-shot 예시 2(등온선)에 `completeness: "all_sets"` 주석. 의미 = 사용자가 "대표만/하나만"이라 **명시하지 않는 한** `all_sets`(모든 조건 세트를 각각 행으로).
- **소비처 폴백**: `extractColumnsFromPaper`가 `tableSpec.completeness ?? "all_sets"`로 읽어 specSection에 `완전성:` 1줄 주입(별도 배선 없음 — completeness는 `plan.table_spec`에 실려 이미 전달됨). `representative`면 "대표 세트 1개만" 안내로 축소.

### 세트 열거 추출 프롬프트 (`EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 5)
- 규칙 5를 "여러 조건이면 여러 행" → **"세트 열거 후 세트마다 정확히 1행"**으로 강화. 값 쓰기 전 조건 세트(온도×압력범위×모델×물질)를 먼저 모두 세고, 세트마다 1행, 압력 범위가 다르면 별개의 세트=별개의 행, notes에 세트 수 기재.
- **단위 발명 방지**(기준선 스펙 표류 대응): 규칙 5에 "원본 라벨·단위 그대로(mmol/g vs mg/g 발명 금지)" 서브라인 추가.
- 흡착 힌트(`ADSORPTION_EXTRACTION_HINT`, 도메인 게이트 내)에도 "압력 범위별 세트를 각각 행으로" 1줄 보강(비흡착 무영향).

### 병합 커버리지 카운터 (`chat/table-extraction.mjs` `mergeExtractionResults`)
- `reasons[]` 원소에 `extractedRowCount`(placeholder 제외 실 기여 행 수) + `distinctConditionCount`(그 논문 행들의 cellTuples에서 나온 서로 다른 condition 개수, `normalizeConditionKey` 재사용 — 세트 커버리지 프록시) 부가.
- `[Chat/Merge]` 로그에 `coverage=[{refNo,rows,conditions}]` 추가(관측만).
- **동작 무변경**: 카운터는 기록만. rows/tableJson/nullSummary/cellTuples 산출은 그대로.

## D-b 조건 열 파생(pivot) + D-f 범위 표기 계약 (table-semantics-hardening Phase 2.5 슬라이스 09, 2026-07-04)

두 결함을 한 슬라이스로. **D-b**: `detectConditionConflicts`가 조건 혼재를 잡기만 하고 표에 반영 안 하던 것을, cellTuples에 이미 저장된 condition을 **결정적 코드로 "측정 조건" 열로 파생**(tidy-data pivot, LLM 0회). **D-f**: 온도의존 파라미터가 범위(303–343 K)로 피팅됐는데 단일 값이 없어 N/A 되던 것을 **범위 표기 규약**(프롬프트 1줄)으로 회복. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경(채팅 경로, metadata JSONB 재사용).

### 조건 열 파생 — `deriveConditionColumns` (`chat/table-extraction.mjs`, 신규 export·순수 함수)
- 입력: `{ headers, rows, cellTuples, columnSemanticTypes, conditionConflicts, nullDetails }`. `conditionConflicts`가 비어 있지 않을 때만 동작. 인자 배열을 **in-place 변형**하고 (파생 시) 새 `columnSemanticTypes`를 반환(무파생 시 원본 참조 그대로).
- 혼재 감지된 열마다(가정 B: 열별 전용 파생 1개) 원열 **바로 뒤**에 `측정 조건 (${원열명})` 열 삽입. 각 행 값 = `cellTuples[r][원열].condition`(없으면 `N/A`), 파생 셀 튜플에도 condition 기록(hover 정합), semanticType = `"condition"`.
- **원자적 인덱스 shift**: 삽입 위치 이상인 모든 `conditionConflicts[].columnIndex`·`conditionConflicts[].derivedColumnIndex`·`nullDetails[].columnIndex`를 +1. 충돌은 **높은 인덱스부터**(right-to-left) 처리해 미처리 인덱스 무효화 방지. 파생 열 자체는 nullSummary 대상 아님(condition, parameter 아님 — 가정 A: Stage 3d 회수 대상 아님).
- 각 conflict에 `derivedColumnIndex` 부여(렌더러가 "자동 파생" 배지 달 근거).
- **중복 가드(가정 C)**: 파생 **이름이 이미 존재하면** skip. `"condition"` 의미 타입 기준이 **아님** — 정체성 열(흡착제/가스/모델)도 "condition"이라 타입 기준이면 모든 흡착 pivot을 잘못 억제(D-b 무력화).
- 배선: `mergeExtractionResults` 말미(nullSummary·conditionConflicts 산출 후)에 후처리로 호출. `tableJson.headers`/`rows`·`nullSummary.details`는 동일 배열 참조라 in-place splice가 그대로 전파. 반환 `columnSemanticTypes`는 파생 반영본. `[Chat/Merge]` 로그에 `derivedConditionCols` 카운트 추가.
- **프론트 무수정 자동 정합**: `ChatTableReport.tsx`는 `headers.map`으로 렌더 + `conflictByColumnIndex.get(i)`로 배지 매칭 → 인덱스가 원자 shift돼 있으면 파생 열이 자동 렌더되고 배지가 올바른 헤더에 붙음. CSV 내보내기(`main.mjs` CHAT_EXPORT_CSV)도 `headers`/`rows` 일반 순회라 파생 열 자동 포함. 타입만 `frontend/src/types/chat.ts` `ConditionConflict.derivedColumnIndex?`(옵셔널) 추가.

### D-f 범위 표기 규약 (프롬프트 + dash 정규화)
- `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 4(수치 원본 유지)에 서브불릿: 온도(또는 압력) **범위에서 피팅된 값**이면 조건 열에 null 대신 `303–343` 형식(대시 하나) + `cell_meta.condition`에 "fitted over 303–343 K" 기록. 출력 예시에 범위 few-shot 1행(T (K)="303–343" + cell_meta.condition) 추가.
- `ADSORPTION_EXTRACTION_HINT`(도메인 게이트 내)에도 온도 범위 피팅 파라미터(ΔH·Arrhenius류) 범위 표기 1줄(비흡착 무영향).
- **dash 정규화**: `normalizeConditionKey`에 `.replace(/[‒–—―−]/g, "-")`(en/em/figure/minus dash → hyphen) 추가 → "303-343K" vs "303–343 K"가 동일 키(파생·충돌 감지 시 중복 조건 방지).
- `cleanCellValue`(persist 포맷)·`validateCellValue`(밸리데이터)는 범위(en-dash/hyphen)를 **훼손·거부하지 않음** — 소수점 규칙이 대시에 안 걸리고, 따옴표·중괄호·kv콜론·60자 초과 없음. 단위 테스트로 고정.

## cell_meta 붕괴 재분해 계약 (table-semantics-hardening Phase 2.5 슬라이스 10-A, 2026-07-04)

per-paper 추출 LLM(gemma 관측)이 일부 행에서 여러 메타를 `cell_meta[col].unit` 문자열에 `key: value, key: value` blob으로 뭉쳐 `condition` 필드가 부재하던 결손(실측: DB `chat_generated_tables.metadata->cellTuples`, `{"unit":"unit: mmol/g, condition: at 293.15 K, pressure <= 1000 kPa",…}`)을 **결정적 코드로 재분해**. condition이 살아나야 슬라이스 09 pivot이 "측정 조건" 열을 만들고 fidelity eval이 오귀속하지 않는다. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경(채팅 경로). 함께 per-paper 타임아웃 기본값을 240→300s로 올려(fix 20 권장 상한) 08의 풍부한 출력(37행)이 240s 초과로 논문 전체 abort되던 것을 방지.

### `normalizeCellMeta(meta)` (`chat/table-extraction.mjs`, 신규 export·순수 함수)
- 알려진 키 = `unit`/`condition`/`source_hint`/`source`(source→source_hint 별칭). `unit`/`condition`/`source_hint` 문자열 필드가 **알려진 라벨로 시작**(`^\s*(known)\s*:`)할 때만 붕괴로 판정 — 정상 값(`"mmol/g"`·`"1:2"` 비율·`"12:30"`)은 라벨로 시작 안 하므로 무변경.
- 붕괴 시 전역 라벨 매처(`/(unit|condition|source_hint|source)\s*:/gi`)로 세그먼트 분할, 각 세그먼트를 해당 필드로. **알려지지 않은 라벨은 경계 아님** → `pressure <=` 는 앞 condition 세그먼트에 붙어 조건 통째 보존. 재분해 대상 필드는 덮어쓰고, **다른 필드는 비어 있을 때만** 채움(옳은 값 무클로버). 같은 키 중복 시 첫 세그먼트 우선. null/비객체 무변경.
- **배선**: `mergeExtractionResults`의 cell_meta 수용 루프 `normalizedMeta.set(normalizeColumnKey(k), normalizeCellMeta(v))`(값 객체당 1회) — 이후 tuple/`detectConditionConflicts`/`deriveConditionColumns`(09 pivot)/eval 전부 정상 condition을 본다. `llm-orchestrator.mjs` 파싱부는 스키마 강제(format)만 하고 blob 내용을 몰라 부적합 → merge 수용부가 정답(실사).
- **보수적 경계**: 두 번째 관측 붕괴 형태 `"mmol/g} , 100 kPa"`(키 라벨 없음)는 재분해하지 않음 — 값 열은 D4 `validateCellValue`가 계속 방어. 테스트로 고정.

### per-paper 타임아웃 기본값 (`chat/table-pipeline.mjs`)
- `PER_PAPER_TIMEOUT_MS = parseInt(process.env.REDOU_PER_PAPER_TIMEOUT_MS, 10) || 300000`(240000→300000). fix 20 권장 상한 = 내부 `ollamaSignal`(300s) 정합. env 오버라이드·`setTimeout` 배선·AbortController·`NULL_RECOVERY_TIMEOUT_MS`(30000) 무변경.

### 프롬프트 붕괴 방지 1줄 (`llm-orchestrator.mjs`, 계획 여유 항목)
- `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 12 서브불릿: "각 정보는 별도 키(unit/condition/source_hint)로 나눠 쓰고, unit에 여러 정보를 한 문자열로 뭉치지 말 것." 정규화(결정적 사후 봉쇄)와 함께 이중 방어(빈도 자체 감소). few-shot·스키마는 이미 올바른 키 형태라 무변경.

## Stage 4 검증 2단계 계약 (table-semantics-hardening Phase 2 슬라이스 02, 2026-07-03)

Stage 4 검증(`scheduleGuardianVerification`)을 **결정적 코드 역매칭 → LLM Guardian 폴백**의 2단계로 재구성. 값의 상당수는 Stage 3a 파싱 매트릭스에서 글자 그대로 되찾을 수 있으므로(LLM이 거기서 옮긴 값) LLM 없이 확정한다. Guardian은 코드로 못 찾은 값에만, MeasHalu 유형별 좁은 질문으로. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경(`verification` JSONB에 필드 부가).

### 역매칭 모듈 (`chat/value-backmatch.mjs`, 신규 — 순수 함수)
| 함수 | 역할 |
|------|------|
| `normalizeNumericValue(raw)` | 참조태그(`[1]`)·단위 벗겨 첫 숫자 토큰(부호·소수점·과학표기)으로 정규화. `"8.69 [1]"`→`"8.69"`. 비수치→null. **완전일치**(근사 없음) |
| `extractTableToken(text)` | 캡션/source_hint의 "table N" 숫자 토큰 추출(가정 B). "Table 3."→"3", 그림/섹션→null |
| `buildMatrixValueIndex(parsedMatrices)` | 전 셀 값 정규화 → `{ byTable: Map<tableToken, Set>, all: Set }` |
| `backMatchCell({cellValue, sourceHint, valueIndex})` | 스코프 `source_hinted`(hint 테이블에 값 존재) > `any_matrix`(아무 매트릭스) > `none`. hint 없으면 source_hinted 스킵 |
| `MEASHALU_CHECK_TYPES` / `pickCheckType(tuple)` | Guardian 좁은 질문 유형(unit/condition/value_fabrication). tuple의 condition>unit>fabrication 우선 |
| `buildNarrowGuardianClaim(cell, tuple, checkType)` | 유형별 좁은 claim. condition/unit 임베드, identity는 **값 열 제외** 앞 2열 |

### Stage 4 흐름 (`chat/table-pipeline.mjs`)
- **`runCodeBackMatchPass({tableJson, parsedMatrices, cellTuples})`** (신규 export, 동기·순수): 모든 수치 셀에 `backMatchCell`. matched면 `{row,col,status:"verified",method:"code",checkType:"backmatch",scope}` → `codeVerified`. 아니면 `guardianCandidates`. **결정성 실증의 단위 테스트 대상.**
- `scheduleGuardianVerification`(재구성, 미export): pass 1로 `runCodeBackMatchPass` 호출 → 코드분 push, **`guardianCandidates`(scope=none)만** pass 2 Guardian. combinedSource·`maxVerify=50` 샘플링·`batchSize=5`·`setImmediate`·`emitVerificationDone`·비차단 try/catch **보존**. Guardian 결과에 `method:"guardian"`+`checkType`. 최종 `verification = [...codeVerified, ...guardian]`.
- 배선: `runTableConversationPipeline` 호출부에 `parsedMatrices`(=`parsedContext.parsedMatrices`)·`cellTuples`(=`stage3dContext.cellTuples`) 전달.
- **R-3 single_call_fallback**: `cellTuples=null` → tuple 없음(value_fabrication)·source_hint 없음. parsedMatrices 있으면 여전히 `any_matrix` 코드 검증 가능.

### 프론트 (`types/chat.ts`, `ChatTableReport.tsx`)
- `CellVerification`에 `method?:"code"|"guardian"`·`checkType?`·`scope?` 추가(전부 선택, 하위호환 — 기존 테이블 verification엔 없음 → 무시).
- 배지 툴팁: `verifiedBreakdownTitle`="코드 대조 N / Guardian M"(R-5 투명성 — Guardian 급감이 "미검증"으로 오독되지 않게). 셀 hover: code="코드 대조 확인", guardian="Guardian: {checkType}"를 evidence 앞에 결합.

### eval (`scripts/e2e-table-fidelity.mjs`, 수동·CI-off)
- `emitVerificationDone` payload에서 검증 주체 분포 "code back-match N / Guardian M/T" 리포트. baseline "Guardian N/M verified" 축과 대응(after 측정용).

## 모델 설정
- 기본: `gpt-oss:120b` (환경변수 `REDOU_LLM_MODEL`)
- 사용자 변경: `user_workspace_preferences.llm_model` 컬럼
- 런타임: `setActiveModel()` → `_activeModel` 전역 변수
- 모델 목록: Ollama `/api/tags` (granite3-guardian, glm-ocr 제외)
- 컨텍스트: `num_ctx` = 131072 (환경변수 `REDOU_LLM_CTX`)

## 의존성
- 사용: Ollama API (port 11434)
- 사용됨: main.mjs (채팅 파이프라인), embedding-worker.mjs는 별도 (vLLM)

## 현재 상태
- 구현 완료: 스트리밍 채팅, Orchestrator, Table Agent, Extraction Agent (SRAG), Stage 3d Agentic NULL Recovery, Q&A, Guardian, 모델 선택
- JSON 스키마 강제 모드 사용 (Ollama format 파라미터)
- 1회 재시도: extractColumnsFromPaper에서 JSON 파싱 실패 시

### 알려진 이슈

1. **R² 인코딩 깨짐** — Orchestrator가 `column_definitions`에 `R²`를 넣으면 `R짼`로 깨짐. Ollama JSON 응답에서 ² (U+00B2) 등 유니코드 특수문자가 인코딩 손실됨. SRAG 추출 시 해당 열이 모두 null로 반환. → `sanitizeColumnNames()` 정규화 함수로 수정 (main.mjs Stage 3b 직전).

### 수정 완료 (2026-04-10)

2. ~~**Orchestrator clarify 과다**~~ — 프롬프트에서 "반드시 clarify" 강제 삭제, 포괄적 요청 시 합리적 기본값으로 진행하도록 변경, 2회 이상 clarify 시 진행 가드레일 추가. main.mjs에 코드 가드레일(history에서 3회 이상 clarify면 강제 generate_table) 추가.
3. ~~**LLM 한글 출력 인코딩 깨짐**~~ — EXTRACTION_AGENT_SYSTEM_PROMPT / TABLE_AGENT_SYSTEM_PROMPT에서 notes 필드 영어 작성 강제. paper_title도 원본 영어 제목 사용 명시.
4. ~~**Guardian 검증 0/42**~~ — checkGroundedness()를 표준 Ollama /api/chat 프로토콜로 전환 (role: "system" + role: "user"). combinedSource 길이 최적화 (figure 1000자, chunk 800자, 전체 12000자). claim에 식별 열(Adsorbent, Gas 등) 포함.
