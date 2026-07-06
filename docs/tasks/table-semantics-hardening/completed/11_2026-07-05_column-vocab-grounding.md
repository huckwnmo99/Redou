# 슬라이스 11 — 열 이름 접지 (10-D 배선 + 스펙 어휘 제약)

> 유형: develop(중) | 계획: 메인 Claude(Fable 5, planner 대체 — 사용자 지시) 2026-07-05 | 구현 위임: developer(Opus 4.8)
> 근거: 품질 라운드 최종 측정의 **유일 잔여 천장** — 논문2 MAPE 8셀이 매 런 미싱. 스펙이 원문 "MAPE"를 "R2"로 발명 → 골든이 열 이름으로 못 붙음. 잡히면 ~90% 사정권.

## 확정된 코드 사실 (메인 Claude 실사)

- 파이프라인 순서: **스펙 생성(`table-pipeline.mjs:1262` `generateOrchestratorPlanFn`, 이때 `setup.paperList.tableCaptions`만 보유) → 표 파싱(`:1298` `parseTableMatrices` → `parsedMatrices[].tables[].headers` = 원문 열 이름 확보) → 추출(`:1307` `runPerPaperExtraction`)**. 열 이름은 **스펙 단계에서 확정**되고, 원문 헤더는 그 뒤에야 생긴다.
- `chat/column-grounding.mjs`(데드코드): `snapColumnsToParsedHeaders`는 **정규화 완전일치**만 스냅 — 주석에 "R2→MAPE는 매칭 안 됨, grounded:false 플래그만"이라 명시. **즉 배선만으로 MAPE는 안 고쳐진다.**
- `loadTableSetup`(`:83`)이 `captionsByPaperId`를 만들지만 캡션이지 열 헤더가 아니다. 단, 표 HTML은 `figures.summary_text`에 있고 Stage 3a `parseAllHtmlTablesFn`이 이미 파싱한다(LLM 불요, 코드만).

## 두 갈래 (방어선 이중화)

### 갈래 1 — 스펙 어휘 제약 (MAPE의 실제 처방, 예방)
- 목표: 스펙이 "R2"를 발명하지 않고 원문의 "MAPE"를 쓰게 한다.
- 방법: 스펙 생성 **이전에** 각 논문의 원문 표 열 헤더 어휘를 확보해 오케스트레이터 프롬프트에 "attested 열 이름 후보"로 제시 + "지표/열 이름은 이 목록에 있으면 그대로 사용, 유사 지표로 개명 금지" 규칙.
  - 어휘 출처: `loadTableSetup`에서 `figures.summary_text`(HTML)를 `parseAllHtmlTablesFn`으로 파싱해 열 헤더를 뽑아 `paperList`에 실어 보낸다(캡션과 병렬). **LLM 호출 0** — 이미 있는 HTML 파싱 재사용.
  - developer 판단: 파싱 비용/중복(Stage 3a와 겹침) 최소화 — setup에서 뽑은 헤더를 3a로 넘겨 재사용할지, 헤더만 가볍게 뽑을지는 코드로 결정하고 슬라이스에 기록.

### 갈래 2 — 10-D 배선 (결정적 백스톱 + 가시성)
- `snapColumnsToParsedHeaders`를 **파싱 직후~추출 직전**(`table-pipeline.mjs:1298`↔`:1307` 사이)에 배선: 스펙 열 이름을 원문 헤더에 스냅(강일치만 교체, 약일치·애매는 무교체 + `grounded:false`).
- 스냅된 열 이름이 **추출에 반영**되도록 배선(추출이 원문 열명으로 채우게). `metadata.columnGrounding` persist + `types/chat.ts` 타입 추가.
- 이 갈래는 갈래 1이 놓친 문자열-매칭 가능 케이스를 잡고, 못 잡은 건 가시화(다음 판단 근거).

## 제약
- 스테이지 추가 ✕, LLM 호출 증가 ✕(HTML 파싱은 코드), 외부 라이브러리 ✕, `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경(채팅 경로).
- 보수성: 갈래 2 스냅은 절대 fuzzy 개명 금지(모듈 계약 유지). 갈래 1은 "후보 제시"이지 강제 치환이 아님.
- `scripts/e2e-table-fidelity.mjs`·fixture 무수정.

## 검증 (성공 게이트)
- 단위: `snapColumnsToParsedHeaders` 배선 경로 + 어휘 주입 + `columnGrounding` persist 테스트. 기존 188건 회귀 0.
- 실측(오케스트레이터, RUNS=3 중앙값): **논문2 MAPE 8셀 회복**(50% → 상승, 목표 ~90% 중앙값) **AND** misattribution·fabrication 0 유지 **AND** conflictHandling 2/2 유지 **AND** 타임아웃 전멸 유지. MAPE가 안 잡히면 최소 "가시화(grounded:false 기록) + 무회귀"가 하한선이고, 그때 갈래 1 강화 여부 재판단.

## 규모
develop(중): `table-pipeline.mjs`(배선·setup 어휘) + `column-grounding.mjs`(배선 소비) + `llm-orchestrator.mjs`(프롬프트 어휘·규칙) + `types/chat.ts` + 테스트. 프론트 배지는 범위 밖(metadata까지).

## 구현 결과 (developer, Opus 4.8, 2026-07-05)

### 갈래 2 — 10-D 배선 (결정적 백스톱)
- `table-pipeline.mjs`: `snapColumnsToParsedHeaders` import(`:18`). 파이프라인 본체 파싱 직후~추출 직전(`parseTableMatrices` ↔ `runPerPaperExtraction` 사이)에 스냅 배선 — `columnGrounding = snapColumnsToParsedHeaders({ columnDefinitions: plan.table_spec?.column_definitions, parsedMatrices })`, `snappedCount > 0`이면 `plan.table_spec.column_definitions`를 스냅 결과로 교체(→ `runPerPaperExtraction`이 `plan.table_spec`을 읽어 자동 반영 → 최종 표까지 전파). `column-grounding.mjs`(순수 함수)는 무수정 소비.
- `persistTableReport`: 시그니처에 `columnGrounding` 추가, `extractionMetadata.columnGrounding` persist(빈 배열 폴백). 호출부에서 `columnGrounding.grounding` 전달.
- `types/chat.ts`: `ColumnGrounding` 인터페이스(`{ column, grounded, snappedFrom? }`) + `ChatTableMetadata.columnGrounding?` 추가(any 0).

### 갈래 1 — 스펙 어휘 제약 (MAPE 실처방)
- `table-pipeline.mjs`: `loadTableSetup`이 `figures.summary_text`도 select, 신규 순수 헬퍼 `collectAttestedColumns(summaryTexts, parseAllHtmlTablesFn)`가 HTML을 파싱해 원문 열 헤더만 추출(중복 제거·논문당 24개·60자 상한) → `paperList[].attestedColumns`. 호출부에서 `parseAllHtmlTablesFn` DI 전달.
- `llm-orchestrator.mjs`: `generateOrchestratorPlan`의 paperList 렌더에 `[실제 표 열 이름(attested): ...]` 줄 추가(캡션과 병렬). `ORCHESTRATOR_SYSTEM_PROMPT` column_definitions 규칙 7에 "attested에 있으면 철자 그대로, 유사 지표 개명 금지(MAPE→R² 금지)" 서브불릿 + 말미 규칙 목록에 동일 취지 규칙 7 신설(completeness는 규칙 8로 밀림).

### 파싱 중복 처리 결정 (계획서가 developer 판단으로 위임)
- **setup 파싱과 Stage 3a 파싱을 재사용 배선하지 않고 각자 파싱하기로 결정.** 근거: (a) 대상 집합이 다르다 — setup은 스펙 생성 전이라 **라이브러리 전체 논문**을, 3a는 스펙 후 **RAG 서브셋** 논문을 파싱. (b) 구조가 다르다 — setup은 `paperList`(제목 기반), 3a는 별도 `ragResults.figures` 로드. 브리징하려면 paperId 매핑 배선이 커진다. (c) **비용 기준이 LLM 호출**인데 둘 다 코드 HTML 파싱(LLM 0)이라 재파싱 비용이 작다(계획서가 "LLM 호출 0"을 예산으로 명시). 경량 파서 신설도 배제 — 기존 `parseAllHtmlTables`를 재호출해 헤더만 취함(모듈 계약·단순성). Stage 3a는 완전 무변경.

### 검증
- `node --check`: `table-pipeline.mjs`·`column-grounding.mjs`·`llm-orchestrator.mjs`·`main.mjs` 전부 OK.
- `node --test tests/*.test.mjs`: **198/198**(기존 188 회귀 0 + 신규 10). 신규: `column-grounding.test.mjs` 순수 함수(강일치 교체/약일치 무교체/애매 무교체/빈 어휘 no-op/undefined 방어/vocab 빌드) + `table-pipeline.test.mjs` 통합(어휘 주입·스냅이 추출+최종 표에 반영·columnGrounding persist[강일치 snap + R² not-grounded]). 계약 변경 반영으로 기존 "loads setup context" 테스트에 `attestedColumns: []` 1줄 갱신(시나리오 의미 보존).
- frontend `npm run build`(tsc -b + vite): 통과(타입 정합). frontend lint는 로컬 eslint 바이너리 PATH 이슈로 미실행(tsc 통과로 타입 안전 확인, `/test` 몫).
- **실 LLM E2E 미실행**(13분 금지 준수) — MAPE 회복·무회귀 측정은 오케스트레이터 RUNS=3 중앙값 몫.

### 계획 대비 변경
- 없음(두 갈래 전부 계획대로). 프론트 배지는 계획대로 범위 밖(metadata persist까지만).
