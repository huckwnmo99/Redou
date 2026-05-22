# 엔티티 그래프 기능을 Plan 12 리팩토링 본선에 통합

> 유형: feature (브랜치 통합) | 상태: 계획 | 작성일: 2026-05-22

## 개요

- **목적**: `origin/main`에만 존재하는 엔티티 그래프 기능(PR #1, 커밋 `3799fd2`)을 Plan 12로 모듈화된 개발 본선(`codex/rag-infra-extraction`)에 통합한다.
- **범위**:
  - 온톨로지 엔티티 추출 (`entity-extractor.mjs`) + 자동 큐잉
  - Graph-Enhanced RAG (`graph-search.mjs`) — Q&A 파이프라인에 base(vector+BM25+reranker) ⊕ graph 2-way RRF 결합
  - 엔티티 추출 모델 설정 / 백필 IPC + 프론트엔드 UI
  - DB 마이그레이션 `20260423010000_add_entity_graph.sql` 적용
- **제외**:
  - Table 파이프라인에 graph 적용 (원본 PR #1도 QA에만 적용, table은 `runMultiQueryRag` 직접 호출 유지) — 통합 후 별도 검토
  - 엔티티 추출 알고리즘/프롬프트 개선 (원본 그대로 가져옴)

## 핵심 분석 결과 (git diff 기반)

### 결정적 발견 1: PR #1은 merge-base에서 직접 분기한 단일 커밋

`3799fd2`의 부모는 merge-base `f8dec9c`다 (`git merge-base --is-ancestor 3799fd2~1 codex` = YES). 따라서 PR #1은 "엔티티 그래프만"이 아니라 **merge-base 이후의 여러 공통 기능(BM25 / conversation_type / contextual chunking 등) + 엔티티 그래프를 한 커밋에 묶은 것**이다. codex 본선은 동일 기능들을 28개 커밋으로 각자 구현했다.

→ **89개 "공통 수정 파일" 대부분은 실제로는 충돌이 아니다.** codex가 이미 동등 구현을 보유. 진짜 신규는 엔티티 전용 파일/코드뿐.

### 결정적 발견 2: `runGraphEnhancedRag`는 의존성 주입 패턴 → 모듈 구조와 호환

`graph-search.mjs:170`의 시그니처:
```js
runGraphEnhancedRag(searchQueries, keywordHints, filterPaperIds, mode, supabase, { generateEmbedding, runMultiQueryRag, modelName })
```
`runMultiQueryRag`를 **함수 인자로 주입**받는다. codex가 이미 `createMultiQueryRag({ supabase })`로 `runMultiQueryRag`를 만들어 주입하는 패턴(`main.mjs:94`)과 완벽히 호환. base RAG 내부 로직을 건드리지 않고 바깥에서 graph를 ⊕ 결합하는 구조라 재배선이 단순하다.

### 결정적 발견 3: PR #1의 main.mjs +1417줄 중 엔티티 전용은 일부

`main.mjs` codex-vs-entity diff는 3323줄이지만, 이는 codex 모듈화로 인한 구조 차이가 대부분이다. 엔티티 전용 추가 코드는 아래 6개 배선 지점으로 국한된다 (PR #1의 `git diff 3799fd2~1..3799fd2`에서 entity 키워드로 추출):

1. **import 2줄**: `entity-extractor.mjs`(`extractEntitiesFromPaper`, `CURRENT_ENTITY_EXTRACTION_VERSION`), `graph-search.mjs`(`runGraphEnhancedRag`)
2. **DB 화이트리스트**: `entities`, `entity_relations`를 `DB_QUERY_TABLES`/`DB_MUTATE_TABLES`에 추가
3. **자동 큐잉**: `processEmbeddingJob` 완료 후 `extract_entities` job 큐 등록 (entity_extraction_version 비교)
4. **Job 처리**: `getEntityExtractionModel`, `processEntityExtractionJob`, `tryStartEntityExtractionJob`, `enqueueEntityBackfill` 함수군 + `processNextQueuedJob`에 `tryStartEntityExtractionJob()` 추가 + 다른 job 셀렉트에서 `extract_entities` 제외 처리
5. **Graph-Enhanced RAG 배선**: QA 파이프라인의 `runMultiQueryRag(...)` 호출(codex `main.mjs:2304`)을 `runGraphEnhancedRag(...)`로 교체
6. **IPC 핸들러 4개**: `ENTITY_BACKFILL`, `ENTITY_BACKFILL_STATUS`, `ENTITY_GET_MODEL`, `ENTITY_SET_MODEL`

## 89개 충돌 후보 분류 (실제 diff 측정)

### 분류 A: 신규 파일 — 그대로 가져옴 (충돌 없음)

| 파일 | 처리 |
|------|------|
| `apps/desktop/electron/entity-extractor.mjs` | `git checkout 3799fd2 -- <path>` 그대로 |
| `apps/desktop/electron/graph-search.mjs` | 그대로 |
| `supabase/migrations/20260423010000_add_entity_graph.sql` | 그대로 |

### 분류 B: 동일 내용 — 작업 불필요 (diff 0 측정 완료)

`git diff HEAD 3799fd2 -- <path>` = 0줄. codex와 PR #1이 완전 동일.

| 파일 | diff |
|------|------|
| 공통 마이그레이션 6개 (`20260406`~`20260410`: conversation_type, llm_model_preference, bm25, figures_bm25, chat_generated_tables_metadata, fix_bm25_or_tsquery) | 각 0줄 |
| `apps/desktop/electron/reranker-worker.mjs` | 0줄 |
| `apps/desktop/electron/llm-qa.mjs`* | *88줄 차이 있음 — 분류 D 참조 |
| `frontend/src/features/chat/ChatView.tsx` | 0줄 |
| `frontend/src/features/chat/ChatMessageList.tsx` | 0줄 |
| `frontend/src/stores/chatStore.ts` | 0줄 |

→ 이 파일들은 **건드리지 않는다.** PR #1이 추가했지만 codex가 이미 보유.

### 분류 C: 순수 추가(addition) — entity 블록만 삽입 (충돌 없음, 수동 적용)

기존 코드 변경 없이 entity 전용 라인만 추가됨. codex 현재 파일에 해당 블록만 삽입.

| 파일 | 추가 내용 | codex 삽입 위치 |
|------|-----------|----------------|
| `electron/types/ipc-channels.mjs` | `ENTITY_*` 채널 4개 (16줄) | `LLM_SET_MODEL` 다음 |
| `frontend/src/types/desktop.ts` | `EntityModelInfo`, `EntityBackfillStatus` 인터페이스 + `entity: {...}` API 타입 (97줄) | LLM 타입 인접 |
| `frontend/src/lib/chatQueries.ts` | `entityKeys`, `useEntityModel`, `useSetEntityModel`, `useEntityBackfillStatus`, `useEntityBackfillMutation` (328줄, 전부 신규 export) | 파일 말미 |

### 분류 D: 수동 재적용 — 엔티티 로직을 모듈 구조에 재배선 (핵심 작업)

| 파일 | 난이도 | 처리 방법 |
|------|--------|-----------|
| `apps/desktop/electron/main.mjs` | **상** | 발견 3의 6개 배선 지점을 codex 모듈 구조에 수동 적용 (아래 상세) |
| `frontend/src/features/settings/SettingsView.tsx` | 중 | codex-vs-entity 176줄 차이. 엔티티 모델 선택 + 백필 버튼 UI 섹션만 추출해 codex SettingsView에 추가. **3-way 수동 머지** (양쪽 모두 merge-base에서 독립 수정) |
| `frontend/src/features/chat/ChatPipelineStatus.tsx` | 하 | 18줄 차이. graph 단계 표시 라벨만 추가 |
| `apps/desktop/electron/preload.mjs` | 하 | **충돌 주의**: PR #1은 `entity: {...}` 추가(원함) + `getModel: (args)`→`getModel: ()` 변경(원치 않음). codex 핸들러는 `authContext`(args)를 받으므로(`main.mjs:2602`) **codex의 `getModel: (args)`를 유지**하고 `entity: {...}` 블록만 추가 |

### 분류 E: 무시 — 문서/메타 (충돌 무관)

PR #1이 추가한 `docs/backlog/*`, `docs/features/*`, `docs/harness/detail/*`, `docs/harness/VERSION.md`, `skills-lock.json` 등. codex가 이미 자체 문서를 보유. **harness 문서는 본 통합 후 codex 기준으로 갱신**(아래 하네스 갱신 참조). PR #1 문서를 그대로 덮어쓰지 않는다.

## main.mjs 엔티티 통합 — 모듈 구조 재배선 상세

codex `main.mjs`(2647줄) 구조 기준. PR #1의 (구)monolithic main.mjs(3257→4490줄)에서 아래 코드를 추출해 재배치한다.

### 배선 1: import (파일 상단, ~line 18 인접)
```js
import { extractEntitiesFromPaper, CURRENT_ENTITY_EXTRACTION_VERSION, assemblePaperContextForEntities } from "./entity-extractor.mjs";
import { runGraphEnhancedRag } from "./graph-search.mjs";
```
※ `persistEntities`, `buildChunkIndexForPaper` 등 `processEntityExtractionJob`이 실제 사용하는 export를 PR #1 main.mjs에서 확인해 함께 import (entity-extractor.mjs는 `persistEntities`, `buildChunkIndexForPaper`, `assemblePaperContextForEntities` 등을 export).

### 배선 2: DB 화이트리스트 (`DB_QUERY_TABLES` line 111, `DB_MUTATE_TABLES` line 134)
양쪽 Set에 `"entities"`, `"entity_relations"` 추가. (CLAUDE.md 규칙: DB 테이블 추가 시 화이트리스트 갱신)

### 배선 3: 자동 큐잉 (`processEmbeddingJob` 끝, line 1108~ 함수 종료부)
embedding job 성공 직후 entity 큐잉 블록 삽입:
```js
// --- Auto-queue entity extraction after successful embeddings ---
try {
  const { data: paperRow } = await supabase.from("papers").select("entity_extraction_version").eq("id", job.paper_id).single();
  const currentVersion = paperRow?.entity_extraction_version ?? 0;
  if (currentVersion < CURRENT_ENTITY_EXTRACTION_VERSION) {
    await supabase.from("processing_jobs").insert({ paper_id: job.paper_id, user_id: job.user_id, job_type: "extract_entities", status: "queued" });
  }
} catch (entityQueueErr) {
  console.warn("[embedding] entity job queue failed (non-fatal):", entityQueueErr.message);
}
```

### 배선 4: Job 처리 함수군 + 루프 (line 1388~1500 영역)
- `getEntityExtractionModel()`, `processEntityExtractionJob(job)`, `tryStartEntityExtractionJob()`, `enqueueEntityBackfill()` 함수를 PR #1에서 그대로 추출해 추가. 모듈 가드 변수 `let entityExtractionInFlight = false;` 선언.
- `processNextQueuedJob()` (line 1486)에 `void tryStartEntityExtractionJob();` 추가.
- `tryStartExtractionJob`(line 1398)의 `.neq("job_type", "generate_embeddings")` 셀렉트가 entity job을 잡지 않도록 PR #1처럼 `.not("job_type", "in", "(generate_embeddings,extract_entities)")` 형태로 보정.

### 배선 5: Graph-Enhanced RAG (QA 파이프라인, codex line 2301~2306)
codex 현재:
```js
const searchQueries = [{ query: message, intent: "qa" }];
const keyTerms = extractKeyTerms(message);
const ragResults = await runMultiQueryRag(searchQueries, keyTerms, filterPaperIds, "qa", { abortSignal: abortController.signal });
```
PR #1 방식으로 교체 (코드 블록 거의 동일, abortSignal 옵션 보존 주의):
```js
const searchQueries = [{ query: message, intent: "qa" }];
const keyTerms = extractKeyTerms(message);
const entityModel = await getEntityExtractionModel();
const ragResults = await runGraphEnhancedRag(searchQueries, keyTerms, filterPaperIds, "qa", supabase, {
  generateEmbedding, runMultiQueryRag, modelName: entityModel,
});
if (ragResults.graph) {
  console.log(`[Chat/QA] Graph: seeds=${ragResults.graph.seedCount}, expanded=${ragResults.graph.expandedCount}, graphChunks=${ragResults.graph.graphChunkCount}`);
}
```
※ **검증 필요**: `runMultiQueryRag`에 codex가 넘기던 `{ abortSignal }` 옵션을 `runGraphEnhancedRag`가 base RAG로 전달하는지 graph-search.mjs:181(`runMultiQueryRag(searchQueries, keywordHints, filterPaperIds, mode)`) 확인 — 현재 PR #1 구현은 abortSignal을 전달하지 않음. QA 취소 동작 회귀 가능성 → 리스크 항목 참조.
※ table 파이프라인(`runTableConversationPipeline` 주입, line 2457)은 PR #1도 graph 미적용이므로 **변경하지 않음**.

### 배선 6: IPC 핸들러 4개 (IPC 핸들러 영역, `LLM_GET_MODEL` 핸들러 line 2602 인접)
`ENTITY_BACKFILL`, `ENTITY_BACKFILL_STATUS`, `ENTITY_GET_MODEL`, `ENTITY_SET_MODEL` 핸들러를 PR #1에서 추출해 추가. `ENTITY_GET/SET_MODEL`은 `user_workspace_preferences.entity_extraction_model` 컬럼 사용 (codex의 `llm_model` 핸들러와 동일 테이블).

## DB 변경

### 마이그레이션 적용 상태 (실측)

| 마이그레이션 | DB 적용 상태 | 근거 |
|------|------|------|
| conversation_type (`20260406`) | ✅ 적용됨 | `chat_conversations.conversation_type` 존재 |
| bm25 (`20260408`, `20260409`) | ✅ 적용됨 | `match_chunks_bm25`, `match_figures_bm25` proc 존재 |
| **entity graph (`20260423`)** | ❌ **미적용** | `entities`/`entity_relations` 테이블 없음, `match_entities`/`graph_traverse_1hop` proc 없음, `papers.entity_extraction_version` 컬럼 없음 |

※ `supabase_migrations.schema_migrations` 추적 테이블은 2건만 기록(`20260309`, `20260311`)하나 실제 스키마는 더 진행됨 → **추적 테이블과 실제 스키마 불일치**. 마이그레이션 적용은 추적 테이블이 아니라 실제 객체 존재로 판단해야 함. entity 마이그레이션은 실제 객체 부재로 미적용 확정.

### 적용할 마이그레이션: `20260423010000_add_entity_graph.sql`

PR #1 파일 그대로 사용. 멱등성 보장 확인 완료:
- `CREATE TABLE IF NOT EXISTS entities` / `entity_relations` (+ 임베딩 컬럼, 인덱스)
- `ALTER TABLE papers ADD COLUMN IF NOT EXISTS entity_extraction_version int DEFAULT 0`
- `ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS entity_extraction_model text`
- `CREATE OR REPLACE FUNCTION` ×4: `match_entities`, `resolve_same_as`, `graph_traverse_1hop`, `god_nodes`
- RLS enable (`entities`, `entity_relations`)

적용 명령:
```bash
docker exec -i supabase_db_Supabase_Redou psql -U postgres < supabase/migrations/20260423010000_add_entity_graph.sql
```

## 작업 분해

`/develop` 에이전트가 아래 순서로 실행한다. 각 단계 후 검증.

1. [ ] **신규 파일 가져오기** (분류 A): `git checkout 3799fd2 -- apps/desktop/electron/entity-extractor.mjs apps/desktop/electron/graph-search.mjs supabase/migrations/20260423010000_add_entity_graph.sql`
   - 검증: `node --check apps/desktop/electron/entity-extractor.mjs && node --check apps/desktop/electron/graph-search.mjs`
2. [ ] **DB 마이그레이션 적용**: 위 psql 명령 실행
   - 검증: `psql -c "SELECT proname FROM pg_proc WHERE proname IN ('match_entities','graph_traverse_1hop','resolve_same_as','god_nodes');"` 4건 + `entities`/`entity_relations` 테이블 확인
3. [ ] **IPC 채널 추가** (분류 C): `ipc-channels.mjs`에 `ENTITY_*` 4개
   - 검증: `node --check apps/desktop/electron/types/ipc-channels.mjs`
4. [ ] **preload 배선** (분류 D): `entity: {...}` 블록만 추가, codex `getModel: (args)` 유지
   - 검증: `node --check apps/desktop/electron/preload.mjs`
5. [ ] **main.mjs 재배선** (분류 D, 핵심): 배선 1~6 순서대로 적용
   - 검증: `node --check apps/desktop/electron/main.mjs`
6. [ ] **CURRENT_EXTRACTION_VERSION 검토**: entity는 별도 `CURRENT_ENTITY_EXTRACTION_VERSION`(=2, entity-extractor.mjs 소유)을 쓰므로 **`CURRENT_EXTRACTION_VERSION`(=25) 범프 불필요**. (추출 파이프라인 자체 변경 아님)
7. [ ] **Frontend 타입** (분류 C): `desktop.ts`에 `EntityModelInfo`/`EntityBackfillStatus`/`entity` API 타입 추가
8. [ ] **Frontend 쿼리 훅** (분류 C): `chatQueries.ts`에 `entityKeys` + 4개 훅 추가
9. [ ] **SettingsView 통합** (분류 D): 엔티티 모델 선택 + 백필 UI 섹션을 codex SettingsView에 3-way 머지
10. [ ] **ChatPipelineStatus** (분류 D): graph 단계 라벨 추가
11. [ ] **하네스 갱신**: feature-status / flows / detail 갱신 (아래)

## 단계별 검증 명령

```bash
# Electron 문법 (각 단계)
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/entity-extractor.mjs
node --check apps/desktop/electron/graph-search.mjs
node --check apps/desktop/electron/preload.mjs
node --check apps/desktop/electron/types/ipc-channels.mjs

# Frontend 빌드/타입 (7~10단계 후)
cd frontend && npm run build   # tsc -b && vite build
cd frontend && npm run lint

# DB 적용 확인 (2단계 후)
docker exec supabase_db_Supabase_Redou psql -U postgres -c "\dt entit*"
docker exec supabase_db_Supabase_Redou psql -U postgres -c "SELECT proname FROM pg_proc WHERE proname LIKE '%entit%' OR proname IN ('graph_traverse_1hop','god_nodes','resolve_same_as');"
```

`/test` 에이전트는 전체 빌드 + lint + (있으면) vitest를 수행한다.

## 영향 범위

- **신규 파일 3개**: `entity-extractor.mjs`, `graph-search.mjs`, `20260423010000_add_entity_graph.sql`
- **수정되는 기존 파일 6개**: `main.mjs`, `preload.mjs`, `ipc-channels.mjs`, `desktop.ts`, `chatQueries.ts`, `SettingsView.tsx`, `ChatPipelineStatus.tsx` (7개)
- **`CURRENT_EXTRACTION_VERSION` 범프**: **불필요** (entity는 독립 버전 상수 사용)
- **DB 변경**: 테이블 2개 + 함수 4개 + 컬럼 2개 + RLS (멱등 마이그레이션 1개)
- **새 IPC 채널**: 4개 (`entity:*`)

## 리스크 & 대안

| 리스크 | 영향 | 대안/완화 |
|--------|------|-----------|
| **QA abortSignal 회귀** | graph RAG가 abortSignal을 base RAG에 전달 안 함 → QA 취소가 검색 단계에서 안 먹힐 수 있음 | `runGraphEnhancedRag` 호출부에서 abortSignal을 옵션으로 넘기고, 필요 시 graph-search.mjs의 `runMultiQueryRag(...)` 호출에 4번째 옵션 인자 추가 (소규모 수정). `/test`에서 QA 취소 시나리오 확인 |
| **graph 빈 결과 시 동작** | 엔티티 미추출 라이브러리(백필 전)에서 graph 0건 | 설계상 `wGraph=0` 패스스루(base RAG와 동일) → 안전. graph-search.mjs:262 주석 확인됨 |
| **persist 임베딩 의존성** | `persistEntities`가 `generateEmbeddingFn` 주입 필요 | main.mjs의 `generateEmbedding`을 주입. PR #1 `processEntityExtractionJob` 시그니처 확인해 동일 배선 |
| **user_workspace_preferences 컬럼** | `entity_extraction_model` 컬럼 부재 시 ENTITY_GET/SET_MODEL 실패 | 마이그레이션(2단계)에서 컬럼 추가됨. 마이그레이션 적용 전 IPC 호출 금지 (단계 순서 준수) |
| **SettingsView 3-way 충돌** | 양쪽 독립 수정 → 수동 머지 실수 가능 | entity 섹션은 독립 UI 블록이므로 codex 레이아웃 보존 + entity 카드만 추가. lint/build로 검증 |
| **schema_migrations 추적 불일치** | 향후 `supabase db push` 시 혼란 | 본 작업은 psql 직접 적용. 추적 테이블 보정은 범위 외 (별도 fix) |

### 롤백 전략

- **코드**: 통합 작업은 codex 본선의 새 브랜치(예: `feature/entity-graph-merge`)에서 수행. 문제 시 브랜치 폐기로 롤백. 본선 직접 수정 금지.
- **DB**: entity 마이그레이션은 추가 전용(테이블/컬럼/함수 신규). 롤백 시:
  ```sql
  DROP TABLE IF EXISTS entity_relations; DROP TABLE IF EXISTS entities;
  DROP FUNCTION IF EXISTS match_entities; DROP FUNCTION IF EXISTS graph_traverse_1hop;
  DROP FUNCTION IF EXISTS resolve_same_as; DROP FUNCTION IF EXISTS god_nodes;
  ALTER TABLE papers DROP COLUMN IF EXISTS entity_extraction_version;
  ALTER TABLE user_workspace_preferences DROP COLUMN IF EXISTS entity_extraction_model;
  ```
  기존 데이터 손실 없음 (엔티티 데이터만 삭제, papers/chunks 무영향).
- **부분 통합 가능**: 1~6단계(백엔드 + DB)만 적용해도 자동 엔티티 추출 + graph QA가 동작. 7~10단계(설정 UI)는 후속 가능. graph 0건 패스스루 덕분에 점진 배포 안전.

## 가정 사항

- **[가정]** PR #1의 엔티티 추출/그래프 알고리즘은 검증 완료된 상태로 간주하고 로직 수정 없이 그대로 이식한다. (원본 계획서 `snug-orbiting-wren.md` 기준)
- **[가정]** `processEntityExtractionJob`의 임베딩 생성은 codex의 `generateEmbedding` 함수와 호환된다 (둘 다 vLLM 2048-dim). 배선 시 시그니처 확인 필요.
- **[가정]** Table 파이프라인 graph 미적용은 PR #1 설계 의도이며, 본 통합에서도 유지한다 (QA 전용).
- **[확인 필요]** `runGraphEnhancedRag`의 abortSignal 미전달이 의도된 것인지, 누락인지 — 통합 후 QA 취소 동작 테스트로 판단.

## 하네스 갱신 (작업 완료 후)

- `docs/harness/main/feature-status.md`: "엔티티 그래프 추출" + "Graph-Enhanced RAG (Q&A)" 행 추가 (상태: ✅ 구현됨, codex 통합 후)
- `docs/harness/main/flows.md`: PDF 파이프라인에 "embedding 후 자동 entity 추출 큐잉" 추가, Q&A 흐름에 "Graph-Enhanced RAG (base ⊕ graph 2-way RRF)" 단계 추가
- `docs/harness/detail/electron/rag-pipeline.md`: graph-search 로직 문서화
- `docs/harness/detail/database/schema.md` + `rpc.md`: `entities`/`entity_relations` 테이블 + 4개 RPC 추가
- PR #1의 harness 문서를 통째로 덮어쓰지 않고, codex 현재 문서에 엔티티 항목만 병합한다.
