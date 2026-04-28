# Agentic 재검색 루프 (NULL 셀 기반)

> 유형: feature | 상태: 계획 | 작성일: 2026-04-21
> 백로그: [16-agentic-research-null.md](../../backlog/16-agentic-research-null.md)
> 출처: [Table RAG improvement report §6](../../01-Idea/Table_RAG_improvement_report.md#6-agentic-재검색-루프-null-셀-기반)

## 개요
- **목적**: SRAG Stage 3c 병합 직후 `nullSummary`로 남은 NULL 셀을 감지해, 해당 (논문, 컬럼) 쌍만 타겟으로 **최대 1회** 재검색 + 재추출을 돌려 빈 셀을 채운다.
- **범위**:
  - Electron: `main.mjs`에 Stage 3d (Agentic 재검색) 추가, `llm-orchestrator.mjs`에 컬럼 단위 재검색 쿼리 빌더 + 셀 단위 추출 에이전트 추가.
  - Frontend: `ChatPipelineStage`에 `researching` 단계 추가, 진행률 UI에 단계 노출.
  - DB: `chat_generated_tables.metadata`에 `agenticRecovery` 필드 추가 (마이그레이션 불필요 — 기존 JSONB 재활용).
- **제외**:
  - 재검색 루프 2회 이상 (Step 5 Agentic RAG 범주).
  - CRAG 수치 검증 (별도 계획).
  - 쿼리 재작성(HyDE) 등 LLM 기반 쿼리 변환.
  - Orchestrator/Table Agent 경로 (현재 구현은 SRAG per_paper 경로만 nullSummary를 생산하므로 그 경로에 한정).

## 핵심 아이디어 — 2-Gate 할루시네이션 방지 설계

없는 데이터를 LLM이 만들어내는 것을 방지하기 위해 **두 단계 게이트**를 거친다.

```
Stage 3c (기존): mergeExtractionResults → { tableJson, nullSummary }
  │
  └─ nullSummary.details = [{paperId, paperTitle, column, columnIndex, rowIndex}]
        │
        ▼
Stage 3d (신규): Agentic NULL 재검색 루프 (최대 1회)
  │
  ├─ groupBy(nullSummary.details, paperId) → 논문별 NULL 컬럼 집합
  ├─ 각 논문마다:
  │   │
  │   ├─ [Gate 1] 새 컨텍스트 존재 확인 — LLM 미호출
  │   │   ├─ buildRecoveryQueries(columnSet, paperTitle, keywordHints)
  │   │   │   └─ 코드 기반 쿼리 합성 (LLM 호출 없음)
  │   │   ├─ runPaperScopedRecoverySearch(queries, paperId)
  │   │   │   └─ 논문 단일 범위 재검색
  │   │   ├─ 기존 SRAG chunk_id/figure_id와 비교
  │   │   │   ├─ 신규 ID 없음 → LLM 호출 없이 N/A 유지 (데이터 자체가 없는 것)
  │   │   │   └─ 신규 ID 존재 → Gate 2로 진행
  │   │
  │   └─ [Gate 2] 신규 컨텍스트 기반 LLM 재추출 — confidence 필터
  │       ├─ assembleRecoveryContext(newChunksOnly, newFiguresOnly, missingColumns)
  │       │   └─ 신규 content만 전달 (기존 내용 중복 제외)
  │       ├─ extractNullCellsFromPaper(tableSpec, nullColumns, context, title)
  │       │   └─ PAPER_EXTRACTION_SCHEMA 재활용, nullColumns만 집중
  │       └─ applyRecoveredValues — confidence = "high"인 셀만 채움
  │           ├─ "high" (테이블에서 직접 읽음) → 셀 덮어쓰기
  │           └─ "medium" / "low" / null → N/A 유지 (만들어낸 값 거부)
  │
  └─ nullSummary 갱신 + agenticRecovery 메타데이터 기록
```

**Gate 1 목적**: 동일한 컨텍스트를 다시 보여주면 LLM이 같은 결과를 내거나 억지로 값을 만들 위험이 있다. 새로운 내용이 없으면 LLM을 아예 호출하지 않는다.

**Gate 2 목적**: 새 내용이 있더라도 LLM이 확실히 테이블에서 읽은 값(`confidence = "high"`)만 채운다. 텍스트 추론이나 불확실한 값(`"medium"`, `"low"`)은 N/A를 유지한다.

## 재활용 분석 (중복 방지 우선)

백로그 요구사항: **기존 코드 재활용을 우선 점검하고 중복을 피할 것**.

| 기존 자산 | 재활용 여부 | 활용 방식 |
|----------|------------|---------|
| `nullSummary.details` (main.mjs:2657) | **핵심 입력** | `mergeExtractionResults`가 이미 `[{paperId, paperTitle, column, columnIndex, rowIndex}]` 형식으로 산출. 별도 감지 로직 불필요. |
| `runMultiQueryRag()` (main.mjs:2229) | **부분 재활용** | `filterPaperIds`에 단일 paperId만 전달해 **논문 스코프 검색**으로 사용. 그대로 호출. |
| `assemblePerPaperContext()` (main.mjs:2431) | **직접 재활용** | 재검색으로 얻은 새 chunks/figures를 기존 논문별 context에 합쳐 LLM 입력 생성. |
| `extractColumnsFromPaper()` (llm-orchestrator.mjs:512) | **스키마 재활용, 래퍼 추가** | `PAPER_EXTRACTION_SCHEMA`는 그대로 유효 (values의 key가 column_definitions 부분집합이어도 문제 없음). 하지만 프롬프트가 "전체 열 추출"을 요구하므로 **NULL 컬럼만 집중하도록 `extractNullCellsFromPaper()` 얇은 래퍼** 추가. |
| `sanitizeColumnNames()` (main.mjs:2502) | **재활용** | 재검색용 컬럼 이름 정규화에 그대로 사용. |
| `normalizeColumnKey()` (main.mjs:2541) | **재활용** | values key ↔ header fuzzy matching에 사용. |
| `extractKeyTerms()` (main.mjs:2085) | **재활용** | keyword_hints 보강에 사용. |
| `rerankChunksIfAvailable()` (main.mjs:2210) | **재활용** | 재검색 결과 재정렬. |
| Guardian (`checkGroundedness`) | **재활용** | Stage 4에서 이미 전체 테이블을 검증하므로 Stage 3d가 끝난 후 기존 Stage 4가 그대로 적용됨. 추가 호출 불필요. |
| `generateOrchestratorPlan()` (llm-orchestrator.mjs:237) | **재사용 안 함** | 재검색은 Orchestrator 재호출 없이 **코드 기반 쿼리 합성**만 수행 (호출 폭발 방지, 백로그 요구사항). |
| Frontend `ChatPipelineStatus` | **확장** | TABLE_STAGES에 `researching` 1개 추가. |

**중복 회피 결정:**
- Orchestrator를 재호출해 새 `search_queries`를 생성하는 접근은 **명시적으로 제외**. 이유: (1) 호출 폭발, (2) 이미 컬럼 이름/단위가 명확한 상황에서 LLM planning은 과잉, (3) 백로그가 "최대 1회"로 제한.
- Table Agent(`generateTableFromSpec`)를 재호출하는 접근도 제외. 이유: SRAG per_paper 경로를 유지하면서 NULL 셀만 보강하는 것이 목적.
- nullSummary 구조를 새로 만들지 않음. 기존 `details` 배열을 그대로 소비.

## 설계

### DB 변경
**마이그레이션 불필요.** `chat_generated_tables.metadata` JSONB에 기존 `extractionMetadata` 구조를 확장:

```jsonc
{
  "extractionMode": "per_paper",
  "stage3bMs": 12345,
  "perPaperTiming": [...],
  "partialFailures": [...],
  "nullSummary": {
    "totalNulls": 18,   // Stage 3d 이후 갱신된 값
    "totalCells": 240,
    "droppedRowCount": 0,
    "details": [...]    // 여전히 남은 NULL만
  },
  // ↓ 신규 필드
  "agenticRecovery": {
    "attempted": true,
    "ms": 8421,
    "nullsBeforeRecovery": 42,
    "nullsAfterRecovery": 18,
    "recoveredCellCount": 24,
    "perPaper": [
      { "paperId": "...", "nullColumns": ["T (K)", "R2"], "queriesUsed": 2, "recoveredCount": 3, "success": true }
    ]
  }
}
```

DDL 변경 없음. `docs/harness/detail/database/` 갱신만 필요.

### Electron (Backend)

**수정 대상**
- `apps/desktop/electron/main.mjs` — Stage 3d 삽입 (Stage 3c 이후, DB insert 이전). import 갱신.
- `apps/desktop/electron/llm-orchestrator.mjs` — `extractNullCellsFromPaper()` 래퍼 + 프롬프트 추가.
- `apps/desktop/electron/types/ipc-channels.mjs` — 변경 없음 (기존 `CHAT_STATUS` 재사용).

**신규 함수 (모두 `main.mjs` 내부 순수 함수, 호출 순서대로)**

1. `shouldTriggerAgenticRecovery(nullSummary, tableJson)` — gate 함수.
   - 조건: `nullSummary.totalNulls > 0` AND `tableJson.rows.length > 0` AND 재검색 대상 논문 ≥ 1.
   - 임계: 전체 셀 중 NULL 비율 ≥ 5%일 때만 트리거 (비용 대비 효과).
   - AbortSignal이 이미 aborted이면 false.

2. `groupNullsByPaper(nullSummary)` — `Map<paperId, { paperTitle, nullCells: [{column, columnIndex, rowIndex}] }>` 반환. 기존 `groupBy` 활용.

3. `buildRecoveryQueries(paperTitle, columns, keywordHints)` — **LLM 호출 없음**.
   - 입력: 논문 제목, 부족한 컬럼 이름(정규화 포함), Orchestrator의 기존 keyword_hints.
   - 출력: `[{query: string, intent: "recovery"}]` 2~3개.
   - 쿼리 합성 전략:
     - `q1 = "{column1} {column2} {keyword_hints}"` (단위 포함)
     - `q2 = "{paperTitle 앞 10단어} {column1}"` — 해당 논문 본문 매칭 강화
     - `q3 = "methods experimental conditions {columns}"` (전형 섹션 타겟)
   - 컬럼 이름에서 단위 `()` 내부만 추출해 부스트.

4. `runPaperScopedRecoverySearch(queries, paperId, abortSignal)` — 기존 `runMultiQueryRag(queries, [], [paperId], "table")` 호출 래퍼.
   - `filter_paper_ids`에 단일 UUID → RPC가 해당 논문 청크/figure만 반환.
   - threshold 낮춤(vector 0.15 → 0.10) — 단일 논문 풀이 작으므로 리콜 우선. 별도 RPC 호출.

5. `assembleRecoveryContext({ existingChunks, existingFigures, existingTables, newChunks, newFigures, missingColumns, paperTitle })` —
   - `assemblePerPaperContext`를 그대로 부르되, chunks/figures를 기존 + 신규 dedup 병합(`chunk_id`/`figure_id` 기준).
   - 컨텍스트 헤더에 `=== 재검색 대상 컬럼 ===\n${missingColumns.join(", ")}` 추가.

6. `extractNullCellsFromPaper(tableSpec, nullColumns, paperContext, paperTitle, abortSignal)` — `llm-orchestrator.mjs`.
   - 내부적으로 `extractColumnsFromPaper`와 동일한 `PAPER_EXTRACTION_SCHEMA` + 동일 Ollama 호출 구조.
   - 차이점: 시스템 프롬프트에 "이전 추출에서 찾지 못한 다음 컬럼만 집중적으로 찾으세요: {nullColumns}. 찾을 수 없으면 그대로 null로 반환하세요." 추가. temperature 0.1 유지.
   - `tableSpec.column_definitions` → `nullColumns` 부분집합으로 교체해서 LLM에게 전달 (토큰 절약).
   - 재시도는 동일한 "JSON 파싱 실패 시 1회" 정책.

7. `applyRecoveredValues(tableJson, paperRefMap, paperId, recoveredRows, nullSummary)` — **순수 코드**.
   - 기존 테이블의 해당 논문 행들을 `nullSummary.details`로 찾아 (paperId + columnIndex + rowIndex) 매칭.
   - 재추출 결과 `values[column]`이 non-null일 때만 덮어쓰기 + 참조번호 `[refNo]` 부착 (기존 `mergeExtractionResults`와 동일 규칙).
   - NULL 제거된 셀에 대해 `nullSummary.details`에서 제거 + `totalNulls` 감소.
   - rowIndex 매칭이 모호하면 (재추출이 여러 행 반환) → 첫 번째 NULL row에 우선 적용, 나머지는 skip (안전 우선).

8. `runAgenticNullRecovery({ tableJson, nullSummary, extractionResults, paperRefMap, paperMetadata, tableSpec, keywordHints, ragResults, abortSignal, onStatus })` — **Stage 3d 오케스트레이션**.
   - gate → 논문별 group → 각 논문 재검색/재추출/덮어쓰기.
   - 논문당 30초 타임아웃 (Stage 3b의 60초 대비 축소 — 컬럼 부분집합이므로).
   - 실패/timeout은 skip + agenticRecovery.perPaper[].success=false 기록. 상위 에러 전파 안 함 (fail-soft).
   - 반환: `{ tableJson, nullSummary, agenticRecovery }`.

**Stage 3d 삽입 위치 (main.mjs)**
- Stage 3c 직후, `tableJson.rows = tableJson.rows.map(...cleanCellValue...)` **앞**에 삽입.
- Stage 3c의 fallback 경로(`single_call_fallback`)에서는 skip — `nullSummary`가 없음.
- 삽입 후 `extractionMetadata.nullSummary` 및 `extractionMetadata.agenticRecovery`를 갱신된 값으로 교체.

**IPC status broadcast**
- 단계 시작 시: `CHAT_STATUS { stage: "researching", message: "NULL 셀 재검색 중...", detail: "(1/3) {논문 제목}" }`
- 단계 종료 시: `CHAT_STATUS { stage: "assembling", message: "..." }`로 전환 후 기존 post-process 진행.

**새 IPC 채널**: 없음. 기존 `CHAT_STATUS` 이벤트 재사용.

**CURRENT_EXTRACTION_VERSION 범프**: **불필요**. 임베딩/추출 스키마 변경 아님.

### Frontend

**타입** (`frontend/src/types/desktop.ts`)
- `ChatPipelineStage`에 `"researching"` 추가 (기존 union에 한 줄).

**네비게이션** — 변경 없음.

**컴포넌트**
- `frontend/src/features/chat/ChatPipelineStatus.tsx`:
  - `TABLE_STAGES` 배열에 `extracting` 뒤 `assembling` 앞으로 `{ key: "researching", icon: Sparkles, label: "NULL 셀 재검색 중..." }` 삽입.
  - 아이콘은 `lucide-react`의 `Sparkles` 또는 `Wand2` (Stage가 "추론 보강" 느낌이라 Sparkles 권장). 추가 import.
- `frontend/src/features/chat/ChatMessageList.tsx` — 변경 없음 (`ChatPipelineStage` 타입만 참조).
- 테이블 렌더러에 "n개 셀이 재검색으로 복원됨" 뱃지 표시는 **제외** (본 계획 스코프 외 — 후속 UX 과제).

**Store** (`frontend/src/stores/chatStore.ts`) — 변경 없음. `pipelineStage`는 이미 `ChatPipelineStage | null` 타입.

**Query 훅** — 변경 없음.

### 프롬프트 설계 (llm-orchestrator.mjs 신규)

`NULL_RECOVERY_EXTRACTION_PROMPT` (EXTRACTION_AGENT_SYSTEM_PROMPT의 집중형 변형):

```
당신은 "Redou" 앱의 NULL 셀 보강 에이전트입니다.
이전 추출에서 이 논문의 일부 컬럼 데이터를 찾지 못했습니다.
제공된 재검색 컨텍스트에서 **다음 컬럼만 집중적으로** 찾아 반환하세요:
  - nullColumns: {열 목록}

규칙:
1. 원래 column_definitions 전체가 아니라 위 nullColumns만 values의 key로 사용.
2. 여전히 찾을 수 없으면 null로 반환 (만들어내지 말 것).
3. 이전에 이미 추출된 값이 옳다고 간주 — 재검증이나 수정 시도 금지.
4. 수치/단위 원본 그대로, 한 논문의 data_rows는 최대 10행.
5. **confidence**: 테이블에서 직접 읽은 경우만 "high". 텍스트 추론이면 "medium" 또는 "low". 절대 높게 부풀리지 말 것.
6. notes는 영어.
```

PAPER_EXTRACTION_SCHEMA는 `additionalProperties: { type: ["string", "null"] }`라 스키마 수정 불필요.

### 성능 예측

| 시나리오 | 추가 비용 | 비고 |
|---------|---------|------|
| NULL 비율 < 5% | 0회 호출 | Gate에서 skip |
| 논문 3편, 2편에 NULL | LLM 2회 추가 (~30초) | 컬럼 부분집합이므로 Stage 3b 대비 입력 짧음 |
| 논문 10편, 5편에 NULL | LLM 5회 추가 (~75초) | 진행률 UI로 체감 완화 |

## 작업 분해

`/develop`이 이 순서대로 실행한다.

1. [ ] `llm-orchestrator.mjs` — `NULL_RECOVERY_EXTRACTION_PROMPT` 상수 + `extractNullCellsFromPaper(tableSpec, nullColumns, paperContext, paperTitle, abortSignal)` 함수 + export.
2. [ ] `main.mjs` — 헬퍼 순수 함수 추가:
   - `shouldTriggerAgenticRecovery(nullSummary, tableJson)`
   - `groupNullsByPaper(nullSummary)`
   - `buildRecoveryQueries(paperTitle, columns, keywordHints)`
   - `applyRecoveredValues(tableJson, paperRefMap, paperId, recoveredRows, nullSummary)`
3. [ ] `main.mjs` — `runAgenticNullRecovery()` 통합 함수 + import 갱신.
4. [ ] `main.mjs` — Stage 3c 직후 Stage 3d 호출 삽입, `extractionMetadata`에 `agenticRecovery` 추가, CHAT_STATUS broadcast.
5. [ ] `frontend/src/types/desktop.ts` — `ChatPipelineStage`에 `"researching"` 추가.
6. [ ] `frontend/src/features/chat/ChatPipelineStatus.tsx` — `TABLE_STAGES`에 `researching` 단계 삽입 + Sparkles 아이콘 import.
7. [ ] `docs/harness/main/feature-status.md` — Step 4 "Agentic 재검색 (NULL 셀)" 상태를 `📋 계획됨` → `✅ 구현됨`으로 (구현 완료 후).
8. [ ] `docs/harness/detail/electron/llm.md` + `rag-pipeline.md` — 함수 목록에 Stage 3d 반영.
9. [ ] 수동 검증: (a) 단일 논문 NULL 재검색 복원, (b) 다수 논문 일부 복원, (c) gate 비활성(NULL=0) 동작, (d) abort 시 graceful skip.

## 영향 범위

**수정되는 기존 파일**
| 파일 | 변경 규모 |
|------|---------|
| `apps/desktop/electron/main.mjs` | 신규 함수 ~180줄, Stage 3d 삽입 ~40줄 |
| `apps/desktop/electron/llm-orchestrator.mjs` | 신규 프롬프트 + 함수 ~60줄 |
| `frontend/src/types/desktop.ts` | 1줄 추가 |
| `frontend/src/features/chat/ChatPipelineStatus.tsx` | import 1줄 + 배열 1항목 |
| `docs/harness/main/feature-status.md` | 상태 갱신 |
| `docs/harness/detail/electron/llm.md` | 함수 목록 갱신 |
| `docs/harness/detail/electron/rag-pipeline.md` | 함수 목록 갱신 |

**총 수정 파일: 7개** (백엔드 2개 + 프론트엔드 2개 + 하네스 3개). → **대규모 변경(6개 이상)** 기준 충족.

**CURRENT_EXTRACTION_VERSION 범프**: 불필요.
**DB 마이그레이션**: 불필요 (JSONB 재활용).
**새 IPC 채널**: 없음.

## 리스크 & 대안

| 리스크 | 대응 |
|-------|------|
| 재검색이 또 다른 NULL을 반환해 체감 효과 없음 | Gate 임계(≥5%) + per-paper 성공률을 `agenticRecovery.perPaper`에 기록해 추후 튜닝 가능하도록. |
| LLM 호출 폭발 (논문 × 컬럼) | **논문 단위**로만 루프 (컬럼은 한 번에 묶음), 최대 1회 재시도, 논문당 30초 timeout. |
| 기존 Stage 3b가 이미 본 컨텍스트만 다시 보면 동일 결과 | `runPaperScopedRecoverySearch`가 threshold 낮추고(`0.10`) 쿼리 조합 변경 → 동일 논문 내 다른 섹션 청크/figure 재호출 유도. |
| Stage 4 Guardian이 복원된 셀을 검증 안 함 | Guardian은 이미 `setImmediate` 블록에서 전체 `tableJson.rows`를 스캔하므로 자동 포함. 추가 작업 불필요. |
| 한 논문의 여러 NULL row 매칭 실패 | 안전 우선: 첫 번째 매칭 NULL row에만 적용, 나머지 skip. `agenticRecovery.perPaper[].success=false` 기록. |
| Abort 타이밍 (사용자 중단) | 각 LLM 호출 전 `abortSignal.aborted` 체크, AbortError는 상위로 전파해 기존 `CHAT_ABORT` 경로 그대로 사용. |
| fallback 경로(`single_call_fallback`)에서 Stage 3d 호출 | `nullSummary === null`이면 gate가 자동 false → skip. |

## 가정 사항

- **[가정 A]** 재검색 후에도 남은 NULL은 현재처럼 "N/A"로 표기하고 추가 처리하지 않음. CRAG는 별도 계획.
- **[가정 B]** UI의 테이블 렌더러가 재검색으로 복원된 셀을 시각적으로 구분할 필요는 **없음**. (값이 채워지면 사용자에게 이득이고, 뱃지/툴팁은 후속 UX.)
- **[가정 C]** Orchestrator가 제공한 `keyword_hints`를 `plan.keyword_hints` 형태로 Stage 3d까지 전달해야 함. 현재 `main.mjs` Stage 2 이후 지역 변수에서 이미 접근 가능.
- **[가정 D]** `runMultiQueryRag`에 단일 `paperId` 배열을 전달했을 때 기존 RPC가 정확히 필터링한다 — 실제로 `filter_paper_ids` 파라미터가 있고 테스트됨.
- **[가정 E]** 백로그 "최대 1회 재검색"은 **논문별** 1회를 의미 (논문 × 1회). 전체 시스템에서 1회로 해석하면 너무 제한적이므로.
- **[가정 F]** `agenticRecovery` 메타데이터는 UI 노출 없이 metadata에 기록만 — 후속 관측/튜닝 용도.

## Step 5 연결점

이 기능이 들어가면 Step 5 "CRAG 자가 검증"의 입력으로 `agenticRecovery.perPaper[]`가 "재검증이 필요한 셀 우선순위" 신호가 된다. 구조 변경 없이 후속 단계가 소비 가능.
