# LLM 모듈
> 하네스 버전: v1.19 | 최종 갱신: 2026-07-03

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
| `apps/desktop/electron/chat/*` | 테이블 파이프라인 스테이지 분리(table-pipeline, table-extraction, agentic-null-recovery, source-evidence, status-events, abort-guards, extraction-utils) — 6월 ADR 0001. + `adsorption-domain.mjs`(7월 Phase 1, 흡착 도메인 사전) | → `chat-table-pipeline-state.md`, 하단 Phase 1 계약 |
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
| `formatSourceAttribution(text, paperMeta)` | [1], [2] 참조번호 → paperId 매핑 |

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
