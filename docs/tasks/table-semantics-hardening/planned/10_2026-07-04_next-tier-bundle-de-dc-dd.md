# 슬라이스 10 — 차순위 묶음(조건부): D-e 예산 재배분 + D-c 열이름 grounding + D-d per-paper quota floor

> 유형: fix | 상태: **10-A만 축소 발동됨 → `completed/10-A`. D-e·D-c·D-d는 이번 라운드 보류(미착수)** | 작성일: 2026-07-04

> **발동 결과(2026-07-04, fixer)**: 오케스트레이터의 08 상태 측정(RUNS=3)이 이 슬라이스 착수 게이트에 걸린 **결손 2건**을 특정 — 하지만 그것은 아래 후보(D-e/D-c/D-d)가 아니라 **(1) cell_meta 키 붕괴**(gemma가 여러 메타를 unit 문자열에 뭉쳐 condition 부재 → 09 pivot 무력화·eval 오귀속·D-f 범위 소실)와 **(2) per-paper 타임아웃**(08의 풍부한 출력이 240초 초과 → 논문 전체 abort)이었다. 따라서 planned/10을 **10-A(측정 결손 2건 핫픽스)로 축소 발동**하고 `completed/10-A_2026-07-04_cellmeta-resplit-timeout.md`로 이동. **원 후보 D-e/D-c/D-d는 이번 라운드에서 하지 않는다**(아래 게이트 규칙대로 "관측 후 잔여 결손에 한정" — 이번 측정이 지목한 건 D-e/D-c/D-d가 아닌 계약 결손이었다). D-e/D-c/D-d는 10-A + 라운드 재측정 후 다시 판단(향후 슬라이스로 남겨둠).

## 개요

- **목적**: top3(D-a/D-b/D-f) 이후 남은 차순위 3건을 묶어 관측·방어한다. **전부 ◎/◎+○(코드·설정·프롬프트)**. 단 **조건부**: 07~09를 3회-중앙값 eval로 측정한 뒤, 그 결과가 남긴 잔여 결손에 따라 **착수 항목을 선별**한다(전부 강행 아님).
- **범위(후보)**:
  - **D-e (◎)**: NULL 재검색 예산 재배분(30s 논문별 고정 → 스테이지 총예산 배분) + 게이트 강화 + fill-rate 재측정.
  - **D-c (◎+○)**: 열 이름 grounding — 캡션 어휘 대조 플래그(코드) + 오명명 방지 프롬프트 1줄.
  - **D-d (◎)**: 다논문 per-paper quota floor(RRF 후보에서 논문별 최소 청크 보장).
- **제외**: 스테이지·LLM 호출 증가 없음(D-e는 오히려 게이트로 진입 축소, D-d 보충은 DB RPC). 외부 라이브러리 0.

## 착수 게이트 (이 슬라이스의 핵심 규칙)

> **07~09 after 측정 후, 잔여 결손을 보고 항목을 켠다.**

- 07(eval 인프라) → 08(D-a) → 09(D-b/D-f) 순으로 각각 3회-중앙값 before/after 측정.
- 측정 결과에 따라:
  - missing이 여전히 특정 논문에서 크면 → **D-e**(NULL 회수) 켬.
  - 헤더 오명명으로 골든이 열 매칭에 실패(missing으로 새는)하는 케이스가 관측되면 → **D-c** 켬.
  - 논문 수를 3편+로 늘린 eval에서 특정 논문 전멸(행 전체 missing)이 나오면 → **D-d** 켬.
- 어느 것도 안 걸리면 이 슬라이스는 **미착수로 종결**(과잉 구현 방지). backlog/20 차순위 판단과 일치.

## 근거

- **D-e (backlog/20)**: 최근 RAG 합의는 "필요할 때만·단일 패스". `NULL_RECOVERY_TIMEOUT_MS=30s`(table-pipeline.mjs:44)인데 내부 호출은 Stage 3b와 동일 스키마·`num_ctx 131072` LLM(`extractNullCellsFromPaper`) — 3b엔 240s, 3d엔 30s만 주는 **예산 비대칭이 중단의 직접 원인**. 회수 기대값 낮은 재검색은 줄이는 쪽이 문헌 방향.
- **D-c (backlog/20)**: closed-world grounding으로 스키마 환각 차단. R²/MAPE 혼동 실측(README "Phase 2 후보 관찰 2": orchestrator가 만든 "R2" 열이 원문은 MAPE). 오명명 헤더는 골든 셀이 열 매칭 실패 → missing으로 샘.
- **D-d (backlog/20)**: Elastic diversified sampler(출처별 상한)의 거울상 = 출처별 하한(quota floor). 현 2편 eval엔 중립, 논문 수 확장 시 회귀 방어.

## 코드 실사 결과 (계획 확정 근거 + 주의점)

### D-e
- `NULL_RECOVERY_TIMEOUT_MS`(table-pipeline.mjs:44)는 이미 env화됨. **총예산 배분**은 `runAgenticNullRecovery`(:680)의 per-paper 루프에서 `groupedNulls.size`로 나눠 `Math.max(min, total/n)` 계산.
- 게이트는 `shouldTriggerAgenticRecovery`(agentic-null-recovery.mjs:4) — 현재 `totalNulls/totalCells >= 0.05`만. **강화**: `column_semantic_types==="parameter"` 열의 null로 한정 + 논문당 기대 회수 ≥임계 미만 skip. columnSemanticTypes는 nullSummary/tableJson 경로로 접근 가능한지 확인 필요 → **[가정 A]** gate에 columnSemanticTypes를 인자로 추가(호출부 table-pipeline이 보유).
- `agenticRecovery` metadata는 이미 fill-rate 기록 중(`recoveredCellCount`·`nullsBeforeRecovery`) → 재측정 인프라 존재. backlog/20 D-e (3): 관측 후 여전히 0~2셀이면 `REDOU_NULL_RECOVERY_OFF` 플래그로 비활성이 정답.

### D-c
- `loadTableSetup`(table-pipeline.mjs:79)이 `figures` item_type='table'의 caption을 이미 로드(`captionsByPaperId`) → 캡션 어휘 대조의 소스 존재. 단 이 캡션은 **오케스트레이터 입력**으로만 쓰이고 추출 후 열 검증엔 미사용.
- plan 수신 직후(table-pipeline.mjs:1257 `plan` 확정 후) `column_definitions` 각 열의 기저 명칭(단위 괄호 제거, `normalizeColumnKey` 재사용)을 캡션 어휘 + `keyword_hints`와 대조 → 미근거 열 `metadata.columnGrounding: [{column, grounded:false}]` 기록. **측정만**(동작 무변경, 렌더러가 경고 표시).
- 프롬프트: 오케스트레이터 규칙 7(캡션에 없는 파라미터 금지)에 "지표 명칭은 캡션·원문 표기 그대로(축약·유사 지표 재작명 금지)" + R²/MAPE 혼동 few-shot 1개.

### D-d — **[주의점 크다]**
- `runMultiQueryRag`(multi-query-rag.mjs:110)는 **reranked 15개(chunks)만 반환**하고 `rankedChunks`(RRF 40)는 **반환하지 않음**(:218 `return { chunks: rerankedChunks, figures: allFigures }`). backlog/20 D-d는 "RRF 후보 40에서 논문별 최상위 끌어올림"을 전제하나 **현재 반환 구조는 40을 노출 안 함** → quota floor를 하려면 (a) `runMultiQueryRag` 반환 직전에 논문별 집계 후 `rankedChunks`(함수 내부에 있음)에서 보충하거나 (b) 반환에 `rankedChunks`를 추가.
- **[가정 B]** (a) 채택 — `runMultiQueryRag` **내부**(:214~218, rerankedChunks 확정 후 return 전)에서 scope 논문별 청크 수 집계 → 0개 논문은 `rankedChunks`(내부 40)에서 해당 논문 최상위 `PER_PAPER_MIN_CHUNKS`(config 신규, 기본 2)개를 rerankedChunks에 편입. 40에도 없으면 그 논문 한정 `match_chunks` 1회(DB RPC, LLM 아님) 보충. **반환 형태(`{chunks, figures}`) 무변경**, 내용만 보강.
  - 단 `runMultiQueryRag`는 filterPaperIds를 받지만 "scope 논문 전체 목록"과 다를 수 있음(folder scope) → quota floor의 "대상 논문"은 filterPaperIds 기준. filterPaperIds가 넓으면(scope_all·다수) 전 논문 floor는 과함 → **[가정 C]** floor는 filterPaperIds가 소수(예: ≤10)일 때만 적용하거나, "결과에 등장한 논문 + filterPaperIds 교집합" 기준. 우선 **filterPaperIds 전체가 아니라 "RAG 결과에 1개라도 잡힌 논문들"에는 floor 미적용, 0개 논문만 보충** — 즉 "전멸 방지"에 한정.
- 상수는 `rag/config.mjs`(신규 `PER_PAPER_MIN_CHUNKS`) — 기존 튜닝 상수 중앙화 원칙(슬라이스 06).

## 설계 (항목별, 게이트 통과분만 구현)

### D-e — 예산 재배분 + 게이트
1. `runAgenticNullRecovery`: per-paper 타임아웃을 `NULL_RECOVERY_TIMEOUT_MS` 고정 대신 `총예산/진입논문수`(하한 min)로 배분. 총예산 env `REDOU_NULL_RECOVERY_TOTAL_MS`(기본 90000).
2. `shouldTriggerAgenticRecovery`: parameter 열 null 한정 + 논문당 기대 회수 임계(≥2) 미만 skip.
3. 재측정: `agenticRecovery` fill-rate before/after. 여전히 0~2셀이면 `REDOU_NULL_RECOVERY_OFF` 플래그 경로 추가(존폐 결정).

### D-c — grounding 플래그 + 프롬프트
1. table-pipeline: plan 확정 직후 열-캡션 대조 → `metadata.columnGrounding` 기록(측정만).
2. orchestrator 규칙 7 보강 + R²/MAPE few-shot 1개.
3. (선택) frontend 타입 `columnGrounding` + 미근거 헤더 경고(무시해도 렌더 정상).

### D-d — quota floor
1. `rag/config.mjs`: `PER_PAPER_MIN_CHUNKS` (기본 2).
2. `runMultiQueryRag` 내부: RAG 결과 0개 scope 논문만 rankedChunks(40)에서 보충, 없으면 논문 한정 match_chunks 1회.
3. 반환 형태 무변경.

## 작업 분해 (게이트 통과 항목만)

1. [ ] **측정 선행**: 07~09 after 3회-중앙값 → 잔여 결손 분류 → 착수 항목 확정(이 단계에서 미착수 결정 가능).
2. [ ] (D-e 시) `agentic-null-recovery.mjs` 게이트 강화 + `table-pipeline.mjs` 예산 배분 + 테스트.
3. [ ] (D-c 시) `table-pipeline.mjs` grounding 대조 + `llm-orchestrator.mjs` 규칙 7/few-shot + 테스트.
4. [ ] (D-d 시) `rag/config.mjs` 상수 + `multi-query-rag.mjs` 내부 floor + `tests/multi-query-rag.test.mjs`.
5. [ ] `node --test` 전건 + `node --check`. (D-d) fill/floor 단위 테스트.
6. [ ] eval 재측정(해당 축).

## 영향 범위

- 수정 파일(전 항목 착수 시): `agentic-null-recovery.mjs`·`table-pipeline.mjs`·`llm-orchestrator.mjs`·`rag/config.mjs`·`multi-query-rag.mjs` + 테스트 2~3. **게이트 통과분만 → 실제로는 부분집합.**
- `CURRENT_EXTRACTION_VERSION` 무변경(채팅·RAG 경로). DB/IPC 무변경.
- **D-d 사이드 이펙트 주의**: `runMultiQueryRag`는 QA 파이프라인·recovery search도 사용(multi-query-rag.mjs:228 runPaperScopedRecoverySearch가 재호출) → floor가 recovery의 single-paper 검색에 오작동하지 않게 **"결과 0개 논문 보충"은 filterPaperIds가 2개+일 때만**(single-paper recovery는 floor 무의미하게). 회귀 테스트로 QA·recovery 경로 무영향 고정.
- **D-c**: columnGrounding은 기록-only(답변·표 무변경). 프론트 무시해도 정상.

## 검증 기준

- (D-e) 예산 배분 후 진입 논문이 완주(중단 감소), fill-rate 관측. 게이트가 parameter 열로 한정됨.
- (D-c) 오명명 열이 `columnGrounding:false`로 기록됨(단위 테스트). 답변·표 무변경.
- (D-d) 2편+ eval에서 0청크 논문이 floor로 보충됨(단위 테스트). QA·single-paper recovery 경로 무영향(회귀).
- 전 항목: `node --test` 전건 통과, 신뢰 축(fabrication·misattribution 0) 유지.

## 규모 판단

**소규모 (fix)** — 항목별 1~2파일, DB/IPC/버전 무변경. **단 D-d는 `runMultiQueryRag` 내부 변경으로 QA·recovery 공유 경로에 영향** → 회귀 테스트가 성공 게이트(경계 조건 주의). 전체는 여전히 fix 범위(6파일 미만·동작 국소). 다음: `/fix`. (만약 D-d의 반환 구조 변경까지 필요하다고 판단되면 그 항목만 develop 승격 검토.)

## 가정 사항

- **[가정 A]** D-e 게이트에 columnSemanticTypes 인자 추가(호출부 보유) — parameter 열 null 한정.
- **[가정 B]** D-d는 `runMultiQueryRag` 반환 형태 무변경, 내부에서 rankedChunks(40)로 0청크 논문만 보충(반환에 40 노출 안 함).
- **[가정 C]** floor는 "결과 0개 scope 논문 전멸 방지"에 한정(전 논문 강제 floor 아님) + filterPaperIds 2개+ 조건 — QA·single-paper recovery 무영향.
- **[핵심]** 이 슬라이스는 **조건부**: 07~09 측정이 남긴 결손에 따라 항목 선별. 결손 없으면 미착수 종결(과잉 구현 금지, backlog/20 차순위 취지).
