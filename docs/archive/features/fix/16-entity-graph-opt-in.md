# Fix: Entity Graph를 opt-in으로 전환

> 유형: fix | 작성일: 2026-05-27 | 작성: planner
> 대상 브랜치: `codex/rag-infra-extraction` (entity-graph 통합본) — **이 브랜치에서 작업**
> 작업 위치: 메인 워킹트리 `C:\Users\admin\Desktop\Server\Redou\V3` (worktree `bold-hofstadter-a85d9f`는 main 브랜치라 entity 코드 없음 — 건드리지 말 것)

## 문제 (왜 바꾸는가)

entity graph 추출이 현재 **모든 import에 강제(자동)**되고 **모든 QA가 무조건 graph 경로**를 타는데, 실측 결과 비용이 크고 가치는 미검증이다. 사용자가 "graph 전체를 opt-in으로" 결정했다.

- **처리 시간 실측**: `extract_entities`가 편당 ~104초 = 전체 처리의 **약 60%**. import 시간을 거의 2배로 늘림. (참고: import_pdf ~64초, embedding ~4초)
- **QA 비용**: QA가 매 질문마다 `extractQueryEntities`(LLM 호출)를 추가로 수행.
- **가치 미검증**: graph가 QA를 실제로 개선하는지(graph vs plain) 아직 측정 안 됨.

### 근거 (코드 — 메인 워킹트리, codex 브랜치)

1. **자동 큐잉 (두 지점)**: `enqueueEntityExtractionIfNeeded`가 import/embedding 완료 직후 무조건 호출되어 모든 논문이 graph를 자동 빌드한다.
   - `apps/desktop/electron/main.mjs:1441` — `processEmbeddingJob` 정상 종료 직전.
   - `apps/desktop/electron/main.mjs:1226` — `processEmbeddingJob`의 "이미 임베딩됨(0건)" 조기 종료 경로. **사용자 노트는 1곳(embedding 후)만 언급했으나 실제로는 이 2번째 지점도 있음** — 둘 다 게이트해야 자동 큐잉이 완전히 멈춘다.
   - 함수 정의: `main.mjs:1137-1175`.

2. **QA 항상 graph**: `apps/desktop/electron/main.mjs:2433` — `handleQaPipeline`이 분기 없이 `runGraphEnhancedRag`를 호출한다. (사용자 노트의 "2433")
   - **git 확인 결과**: graph-search.mjs의 `runGraphEnhancedRag`(graph-search.mjs:148-201)는 **내부에서 먼저 `runMultiQueryRag`(=plain)를 호출**(graph-search.mjs:166)해 `baseResults`를 만들고, **`mode === "qa"`일 때만** 그 위에 `extractQueryEntities` + graph chunk fusion을 얹는다(graph-search.mjs:171-200). 즉 graph를 끄는 것은 곧 "baseResults(plain RAG)를 그대로 쓰는 것"과 동치다.
   - 테이블 파이프라인은 지금도 plain `runMultiQueryRag`를 직접 사용(`main.mjs:2596` `runMultiQueryRagFn: runMultiQueryRag`) — graph 미사용. 변경 대상 아님.

3. **수동 백필 버튼 이미 존재**: 추가 구현 불필요, 문구/맥락만 정리.
   - `enqueueEntityBackfill`(`main.mjs:2818`) + `getEntityBackfillStatus`(`main.mjs:2788`)
   - IPC: `ENTITY_BACKFILL`(`main.mjs:2909`), `ENTITY_BACKFILL_STATUS`(`main.mjs:2900`)
   - Settings 버튼: `frontend/src/features/settings/SettingsView.tsx:379` ("엔티티 그래프 백필", Entity Graph 패널 내부 `:332-421`)

### 설계 자산 (이미 있어서 그대로 재사용)

- **preferences 테이블에 사용자별 플래그를 넣는 패턴**: `user_workspace_preferences`에 `llm_model`, `entity_extraction_model` 컬럼이 이미 있고, 동일 패턴의 GET/SET IPC가 동작 중이다.
  - GET/SET 모델 IPC: `main.mjs:2868`(ENTITY_GET_MODEL), `main.mjs:2886`(ENTITY_SET_MODEL)
  - 읽기 헬퍼: `getEntityExtractionModel`(`main.mjs:473-486`) — `user_workspace_preferences`에서 컬럼 읽어 fallback.
  - 채널 정의: `apps/desktop/electron/types/ipc-channels.mjs:45-48`
  - preload 브리지: `apps/desktop/electron/preload.mjs:115-120` (`entity.getModel/setModel/backfill/getBackfillStatus`)
  - 프론트 훅: `frontend/src/lib/chatQueries.ts:361-423` (`useActiveEntityModel`/`useSetEntityModel`/`useEntityBackfillStatus`/`useStartEntityBackfill`), 쿼리키 `entityKeys`(`chatQueries.ts:39-42`)
  - → **새 boolean 플래그 + GET/SET IPC를 같은 모양으로 복제하면 됨.** 새 모듈/새 컴포넌트 불필요.

## 설계 (opt-in)

토글 기본값 = **OFF** (graph 미사용이 기본). 사용자가 Settings에서 켜야만 자동 추출 + QA graph가 동작.

### (a) DB — preference 플래그 추가

`user_workspace_preferences`에 boolean 컬럼 1개 추가.

```sql
-- supabase/migrations/{타임스탬프}_add_entity_graph_enabled.sql
alter table public.user_workspace_preferences
  add column if not exists entity_graph_enabled boolean not null default false;

comment on column public.user_workspace_preferences.entity_graph_enabled is
  '엔티티 그래프 기능 opt-in 플래그. false(기본): import 시 자동 추출 안 함, QA는 plain RAG. true: 자동 추출 큐잉 + QA graph 경로.';
```

- 타임스탬프는 기존 최신(`20260423010000`)보다 뒤. 작성 시점 기준 `2026XXXX` 형식 유지.
- **기본 false** → 마이그레이션 적용 즉시 기존 사용자도 opt-out 상태가 됨(원하는 동작).
- DB 화이트리스트: `user_workspace_preferences`는 `DB_QUERY_TABLES`/`DB_MUTATE_TABLES`에 **이미 등록**(`main.mjs:137,161`) — 추가 불필요. (컬럼 추가는 화이트리스트와 무관)

### (b) Electron (Backend) — 읽기 헬퍼 + 게이트 + QA 분기 + GET/SET IPC

**B1. preference 읽기 헬퍼 추가** (`main.mjs`, `getEntityExtractionModel` 근처 `:473` 부근에 신규)

```js
async function getEntityGraphEnabled(userId = null) {
  if (!userId) return false;            // 비로그인/시스템 컨텍스트 → 기본 OFF
  const { data: pref, error } = await supabase
    .from("user_workspace_preferences")
    .select("entity_graph_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return pref?.entity_graph_enabled === true;   // null/미설정 → false
}
```

**B2. 자동 큐잉 게이트** — `enqueueEntityExtractionIfNeeded`(`main.mjs:1137`) 진입부에서 플래그 확인.
- 가장 안전한 단일 지점 게이트: 함수 맨 앞에서 `userId` 기준으로 `getEntityGraphEnabled(userId)`가 false면 즉시 `return false`. → 호출처 2곳(`:1226`, `:1441`)을 모두 자동으로 커버. 호출처는 손대지 않음.
- 주의: 이 함수는 `userId`를 인자로 받음(`paperId, userId, ...`). 현재 호출은 `job.user_id`를 넘김(`:1226`,`:1441`). 게이트는 그 `userId`로 판정.
- **백필 경로는 게이트 영향 없음**: `enqueueEntityBackfill`(`main.mjs:2818`)은 `enqueueEntityExtractionIfNeeded`를 거치지 않고 직접 insert하므로, 토글 OFF여도 수동 백필 버튼은 계속 동작(의도된 동작 — "수동으로만 추출"). 단 아래 결정 D1 참고.

**B3. QA graph 분기** — `handleQaPipeline`(`main.mjs:2416`, 호출 지점 `:2433`).
- 권장 방식: `runGraphEnhancedRag` 호출 직전에 플래그를 읽어, 끌 때는 plain `runMultiQueryRag`를 직접 호출.

```js
// 현재 (main.mjs:2431-2445 부근)
emitStatus({ stage: "graphing", message: "Expanding entity graph context..." });
const entityModelName = await getEntityExtractionModel(ownerId);
const ragResults = await runGraphEnhancedRag(searchQueries, keyTerms, filterPaperIds, "qa", supabase, {
  generateEmbedding, runMultiQueryRag, modelName: entityModelName, abortSignal: abortController.signal,
});

// 변경 후 (의사코드)
const graphEnabled = await getEntityGraphEnabled(ownerId);
let ragResults;
if (graphEnabled) {
  emitStatus({ stage: "graphing", message: "Expanding entity graph context..." });
  const entityModelName = await getEntityExtractionModel(ownerId);
  ragResults = await runGraphEnhancedRag(searchQueries, keyTerms, filterPaperIds, "qa", supabase, {
    generateEmbedding, runMultiQueryRag, modelName: entityModelName, abortSignal: abortController.signal,
  });
} else {
  // 통합 이전 동작 복귀: plain multi-query RAG
  ragResults = await runMultiQueryRag(searchQueries, keyTerms, filterPaperIds, "qa", {
    abortSignal: abortController.signal,
  });
}
```

- **반환 형식 호환 확인 완료**: QA 하류 코드는 `ragResults.chunks` / `ragResults.figures`만 소비(`main.mjs:2449,2462-2465,2478-2481`). `runMultiQueryRag`의 반환(=`runGraphEnhancedRag`의 `baseResults`)이 곧 그 형태이므로 그대로 호환. graph 끌 때 `ragResults.graph` 필드만 없어지는데, 하류에서 사용 안 함(grep 확인 권장).
- OFF일 때 `emitStatus({ stage: "graphing" })`를 건너뛰면 불필요한 "그래프 확장 중" 상태가 안 뜸(UX 개선). `searching` 상태는 `runMultiQueryRag` 내부 흐름상 이미 위(`:2421`)에서 emit됨.
- **대안(미채택)**: `runGraphEnhancedRag`에 `graphEnabled` 옵션을 추가해 내부에서 분기. 반환에 `graph:{enabled:false}` 필드가 유지되는 장점이 있으나, graph-search.mjs까지 손대야 하고 `extractQueryEntities` 비용 회피 로직이 함수 안으로 숨음. → main.mjs에서 명시적으로 분기하는 게 읽기 쉬워 권장.

**B4. GET/SET IPC 추가** — `ENTITY_GET_MODEL`/`SET_MODEL`(`main.mjs:2868-2898`) 바로 아래에 동일 패턴으로 2개 핸들러.

```js
ipcMain.handle(IPC_CHANNELS.ENTITY_GET_GRAPH_ENABLED, async (_event, authContext = {}) => {
  try {
    const ownerId = await resolveAuthenticatedUserId(authContext);
    return { success: true, data: { enabled: await getEntityGraphEnabled(ownerId) } };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle(IPC_CHANNELS.ENTITY_SET_GRAPH_ENABLED, async (_event, { enabled, userId, accessToken }) => {
  try {
    const ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
    const { error } = await supabase
      .from("user_workspace_preferences")
      .upsert({ user_id: ownerId, entity_graph_enabled: enabled === true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { success: true, data: { enabled: enabled === true } };
  } catch (err) { return { success: false, error: err.message }; }
});
```

### (c) IPC 채널 + preload 브리지

- `apps/desktop/electron/types/ipc-channels.mjs` — `ENTITY_GET_GRAPH_ENABLED: 'entity:get-graph-enabled'`, `ENTITY_SET_GRAPH_ENABLED: 'entity:set-graph-enabled'` 2개 추가(`:48` 뒤).
- `apps/desktop/electron/preload.mjs` — `entity` 객체(`:115-120`)에 `getGraphEnabled: (args) => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_GET_GRAPH_ENABLED, args)`, `setGraphEnabled: (args) => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_SET_GRAPH_ENABLED, args)` 추가. (preload 상단에도 채널 상수 미러가 있으면 같이 추가 — `preload.mjs:34-37` 확인)

### (d) Frontend — 훅 + Settings 토글 UI

**D-types.** preload 타입 선언이 있는 곳(`window.redouDesktop` 타입; `frontend/src/types/` 또는 desktop 타입 파일)에 `entity.getGraphEnabled`/`setGraphEnabled` 시그니처 추가. (developer가 `redouDesktop` 타입 정의 위치 grep으로 확정 — `EntityModelInfo` 정의 근처)

**D1. 훅** — `frontend/src/lib/chatQueries.ts`
- `entityKeys`(`:39`)에 `graphEnabled: ["entity-graph-enabled"] as const` 추가.
- `useEntityGraphEnabled()` (useQuery) + `useSetEntityGraphEnabled()` (useMutation, onSuccess에서 `entityKeys.graphEnabled` invalidate). `useActiveEntityModel`/`useSetEntityModel`(`:361-391`) 패턴 복제.

**D2. Settings 토글** — `frontend/src/features/settings/SettingsView.tsx`, Entity Graph 패널(`:332-421`) 상단(설명문 `:337-342` 바로 아래)에 체크박스/스위치 1개.
- 훅 연결: `const { data: graphEnabled } = useEntityGraphEnabled(); const setGraphEnabled = useSetEntityGraphEnabled();`
- 라벨: `t("Enable entity graph (opt-in)", "엔티티 그래프 사용 (선택)")` + 짧은 설명: `t("Off by default. Adds ~100s per import and an extra LLM call per question.", "기본 꺼짐. 켜면 import당 약 100초, 질문당 LLM 호출이 추가됩니다.")`
- 토글 OFF일 때, 하단 모델 select/백필 버튼(`:343-420`)을 `disabled` 처리할지 여부 → 결정 D1.

## 펜딩 fix #15 reconcile (필수)

직전 `/fix`(계획서 `docs/features/fix/15-library-complete-status-entity-mismatch.md`, 옵션 A1)가 막판 크래시로 **미커밋 변경**을 남겼다. `git status`로 확인된 미커밋 파일:

| 파일 | #15 변경 내용 | opt-in 전환 후 처리 |
|------|--------------|---------------------|
| `frontend/src/lib/paperRepository/paperSignals.ts` | `import_pdf`+`generate_embeddings` 합성(둘 다 succeeded여야 Complete). `CORE_JOB_TYPES`/`STATUS_PRECEDENCE` 도입. entity 제외. | **유지(merge).** entity와 무관하게 "import만 보던" 버그를 고치는 독립적 개선. opt-in이어도 import+embedding은 항상 돌므로 여전히 유효. |
| `frontend/src/features/processing/ProcessingView.tsx` | 삼항→`jobTypeLabels` 매핑. `extract_entities`→"Entities/엔티티" 라벨. | **유지(merge).** opt-in ON이면 entity job이 ProcessingView에 뜨므로 올바른 라벨이 여전히 필요. OFF면 entity job 자체가 안 생겨 무해(매핑 객체에 남아있어도 문제 없음). |
| `frontend/src/lib/paperRepository/paperSignals.test.ts` | 합성 로직 테스트(신규) | **유지(merge).** paperSignals.ts 변경과 짝. |
| `docs/harness/main/flows.md` | 임포트 흐름에 entity 큐잉/`processEntityExtractionJob` 단계 추가, "Complete 판정 범위" 노트 | **유지 + opt-in 보정.** 흐름도에 "(opt-in: `entity_graph_enabled`=true일 때만 큐잉)" 조건 명시. |
| `docs/harness/main/feature-status.md` | 엔티티 그래프 "✅ 구현됨", 라이브러리 카드 상태 항목 | **유지 + opt-in 보정.** "엔티티 추출 (graph)" 행을 "opt-in(기본 OFF)"으로 갱신. |
| `docs/harness/detail/frontend/stores-queries.md` | 카드 상태=core job 합성, entity는 보조 | **유지.** 그대로 정확. |
| `docs/harness/VERSION.md` | 하네스 버전 범프 | **유지 + 본 작업분 추가 범프.** |

**reconcile 결론**:
- #15의 코드/테스트 변경은 **전부 유지**한다(폐기/되돌림 없음). import+embedding 합성은 entity 정책과 독립적으로 옳다.
- **단, opt-in 전환이 #15의 "동기"를 대부분 무력화**한다: 자동 entity job이 사라지므로 #15가 잡으려던 "Complete인데 entity 진행중/실패" 불일치(예: paper `62fad6d4`)는 신규 import에서 더 이상 발생하지 않는다. (이미 빌드된 graph가 있는 기존 논문/수동 백필 시에만 entity job 존재)
- entity 상태 라벨(ProcessingView)은 그대로 두되, opt-in 맥락임을 하네스에 기록.
- **#15 문서 처리**: 본 16번 작업과 함께 커밋. #15 계획서는 "코드는 유지, 동기는 16에서 opt-in으로 흡수됨"이라는 1줄 추기(또는 16에서 참조)로 추적성 유지. 코드 변경 자체는 16 커밋에 포함되어도 무방(같은 브랜치 미커밋분).

## 결정이 필요한 사항 (developer 진행 전 사용자 확인 권장)

- **D1. 토글 OFF일 때 모델 select + 백필 버튼 비활성화 여부**
  - (가) **비활성화**: opt-in OFF면 graph를 안 쓰니 모델 선택/백필도 막아 일관성↑. 켜야만 백필 가능.
  - (나) **활성화 유지**: OFF여도 "지금 한 번만 수동으로 그래프 빌드"를 허용. 사용자 노트의 "graph 추출 = 수동 버튼으로만"과 더 부합.
  - **planner 권장: (나) 유지.** 사용자가 "수동 버튼으로만 추출"을 명시했으므로, 토글은 "자동 큐잉 + QA graph 경로"만 제어하고, 수동 백필은 토글과 독립적으로 항상 가능하게 둔다. 토글 설명에 "토글은 자동화/QA 사용만 제어, 수동 백필은 아래 버튼으로 언제든 가능"을 명기. (D1=나 가정으로 작업 분해 작성)

- **D2. 토글 ON 전환 시 기존 미추출 논문 자동 백필 트리거 여부**
  - opt-in을 켜는 순간 기존 논문들을 자동 백필할지, 아니면 사용자가 백필 버튼을 따로 눌러야 할지.
  - **planner 권장: 자동 트리거 안 함(수동 버튼 유지).** 토글 ON은 "앞으로의 import부터 자동 추출 + QA에서 graph 사용"을 의미. 과거 논문 일괄 추출(비싼 작업)은 사용자가 명시적으로 백필 버튼을 눌러 시작. (자동 트리거는 의도치 않은 대량 비용 유발 위험)

## 영향 범위

- **수정/생성 파일** (D1=나, D2=수동 기준):
  1. `supabase/migrations/{ts}_add_entity_graph_enabled.sql` (신규)
  2. `apps/desktop/electron/main.mjs` (헬퍼 추가 + 게이트 1줄 + QA 분기 + IPC 2개)
  3. `apps/desktop/electron/types/ipc-channels.mjs` (채널 2개)
  4. `apps/desktop/electron/preload.mjs` (브리지 2개 + 상단 상수 미러)
  5. `frontend/src/lib/chatQueries.ts` (훅 2개 + 쿼리키)
  6. `frontend/src/features/settings/SettingsView.tsx` (토글 UI)
  7. preload 타입 선언 파일 (`redouDesktop` 타입에 메서드 2개) — 위치 developer 확정
  - **추가로 #15 미커밋분 7파일**(위 reconcile 표) 동반 커밋.
- **DB 변경**: 컬럼 1개 추가(boolean, default false). RLS 영향 없음(기존 정책이 row 단위라 컬럼 무관).
- **새 IPC**: 2개(get/set graph enabled). 기존 entity IPC 패턴 복제.
- **CURRENT_EXTRACTION_VERSION 범프**: **불필요.** 추출 *로직* 변경이 아니라 추출 *실행 여부* 게이트. 기존 논문 강제 재처리 불필요(오히려 재처리 시 자동 entity가 다시 도는 걸 막는 게 목적).
- **CURRENT_ENTITY_EXTRACTION_VERSION**: 변경 없음.
- **사이드 이펙트**:
  - QA: OFF(기본) 시 graph fusion + `extractQueryEntities` LLM 호출이 사라짐 → QA가 통합 이전(plain RAG)과 동일 동작. 응답 품질이 graph 대비 달라질 수 있으나, 가치 미검증이므로 의도된 회귀.
  - import: OFF 시 `extract_entities` job이 큐잉 안 됨 → import 체감 시간 ~60% 단축. ProcessingView에 entity 단계 안 보임(정상).
  - 테이블 파이프라인: 영향 없음(원래 plain RAG).

## 규모 판단

| 기준 | 본 작업 | fix 상한 |
|------|---------|----------|
| 수정 파일 수 | 7개(+#15 reconcile 7개 = 동반 커밋) | 1~5개 |
| DB 변경 | 있음(컬럼 1개) | 없음 |
| 새 IPC | 있음(2개) | 없음 |
| 새 컴포넌트 | 없음(기존 패널에 토글 추가) | 없음 |
| 새 모듈 | 없음 | 없음 |

→ **엄밀히는 fix 상한을 초과**(DB 변경 + 새 IPC + 7파일). 표 기준만 보면 `/develop` 신호.

**그러나 planner 판단: `/fix`로 진행 권장.** 근거:
1. **새 로직이 거의 없다.** DB 컬럼·IPC·preload·훅·UI 토글 모두 **기존 `entity_extraction_model` 자산을 1:1 복제**하는 보일러플레이트다. 설계 위험이 낮다.
2. **핵심 코드 변경은 3줄 수준**: (a) 게이트 함수 진입부 early-return 1개, (b) QA의 if/else 분기 1개, (c) 읽기 헬퍼 1개. 나머지는 배선(wiring).
3. 새 모듈/새 컴포넌트/새 테이블 없음. 사용자도 "소규모 /fix 예상"으로 동일하게 판단.

**단, 사용자 선택지 제공**: DB+IPC가 포함되므로 워크플로우 엄격성을 우선하면 `/develop`도 정당하다. 아래 둘 중 택1:
- (권장) `/fix` — fixer가 위 7파일 + #15 reconcile을 한 번에 처리하고 자체 검증.
- (대안) `/develop` — DB/IPC 포함을 이유로 정식 개발 트랙. 작업 분해는 본 문서 그대로 사용 가능.

## 작업 분해 (구현 순서)

1. [x] DB 마이그레이션: `entity_graph_enabled boolean default false` 추가 (`20260527073618_add_entity_graph_enabled.sql`)
2. [x] `main.mjs`: `getEntityGraphEnabled(userId)` 헬퍼 추가
3. [x] `main.mjs`: `enqueueEntityExtractionIfNeeded` 진입부 게이트(false면 return) — 자동 큐잉 차단
4. [x] `main.mjs`: `handleQaPipeline` graph/plain 분기(OFF 시 `runMultiQueryRag` 직접 호출, `graphing` 상태 스킵)
5. [x] `main.mjs`: `ENTITY_GET_GRAPH_ENABLED`/`SET_GRAPH_ENABLED` IPC 핸들러 2개
6. [x] `ipc-channels.mjs`: 채널 상수 2개
7. [x] `preload.mjs`: `entity.getGraphEnabled/setGraphEnabled` 브리지(+상단 상수 미러)
8. [x] preload 타입: `redouDesktop.entity`에 메서드 2개 선언 (`desktop.ts` + `EntityGraphEnabledInfo`)
9. [x] `chatQueries.ts`: `useEntityGraphEnabled`/`useSetEntityGraphEnabled` + `entityKeys.graphEnabled`
10. [x] `SettingsView.tsx`: Entity Graph 패널에 opt-in 토글 추가(기본 OFF 표시), 수동 백필은 독립 유지(D1=나)
11. [x] #15 미커밋분 reconcile: 코드/테스트 유지, 하네스에 opt-in 맥락 보정
12. [x] 하네스 갱신(아래 섹션)

## 검증 방법

1. **문법/타입/빌드**:
   - `node --check apps/desktop/electron/main.mjs`
   - `node --check apps/desktop/electron/preload.mjs`
   - `cd frontend && npm run build` (tsc -b 통과 — 새 훅/타입)
   - `cd frontend && npm run lint`
2. **단위 테스트**: `cd frontend && npm run test` — #15의 `paperSignals.test.ts` 그대로 통과.
3. **DB 마이그레이션 적용 확인**: psql로 `\d user_workspace_preferences`에 `entity_graph_enabled` 컬럼 존재 + default false.
4. **수동 동작 확인(dev)**:
   - 토글 OFF(기본): 새 PDF import → `processing_jobs`에 `extract_entities` row가 **안 생기는지** 확인. import 완료까지 체감 시간 단축.
   - 토글 OFF: QA 질문 → 로그에 `extractQueryEntities`/`graphing` 단계가 **안 나오는지**, plain `runMultiQueryRag` 경로로 답이 나오는지.
   - 토글 ON: 새 import → `extract_entities` 큐잉 발생. QA → graph 경로(`graphing` 상태) 동작.
   - 수동 백필 버튼: 토글 OFF여도 클릭 시 백필 큐잉(D1=나) 동작.
5. **회귀**: 테이블 생성 채팅(table 모드)은 토글과 무관하게 기존대로 동작(plain RAG).

## 하네스 갱신 (작업 시 함께)

- `docs/harness/main/feature-status.md` — "엔티티 추출 (graph)" 행(`:38`)을 **"✅ 구현됨 (opt-in, 기본 OFF)"**으로 갱신. QA가 토글에 따라 graph/plain 분기함을 비고에 명시. ROADMAP 통합 행(`:63`)도 opt-in 반영.
- `docs/harness/main/flows.md` — PDF 임포트 흐름(섹션 1)의 `enqueueEntityExtractionIfNeeded`(`:36`)에 **"(opt-in: `entity_graph_enabled`=true일 때만 큐잉)"** 조건 추가. Q&A 흐름(섹션 4)에 graph/plain 분기 명시(현재 `runMultiQueryRag`로 적혀 있으나 실제 코드는 graph 강제였음 → "기본 plain, opt-in 시 `runGraphEnhancedRag`"로 정정).
- `docs/harness/detail/electron/` (llm.md 또는 rag-pipeline.md) — QA opt-in 분기 + `getEntityGraphEnabled` 헬퍼 + 새 IPC 2개 기록.
- `docs/harness/detail/frontend/stores-queries.md` — `entityKeys.graphEnabled` 쿼리키 + 토글 훅 추가.
- `docs/harness/VERSION.md` — 버전 범프(현재 미커밋 #15분과 합산).

## 가정 사항

- **[가정]** opt-in 플래그는 **사용자별**(`user_workspace_preferences.user_id`)이 적절하다(기존 모델 설정과 동일 축). 워크스페이스/전역 플래그가 아님. — 기존 패턴과의 일관성 근거.
- **[가정]** 비로그인/시스템 컨텍스트(`userId=null`)에서는 graph OFF가 안전한 기본값. (`getEntityGraphEnabled`가 null → false)
- **[가정]** QA에서 graph를 끄면 응답이 통합 이전(plain RAG) 품질로 돌아가며, 이는 "가치 미검증" 상태에서 의도된 동작이다. graph의 QA 개선 효과 측정은 별도 백로그(graph vs plain A/B).
- **[가정/주의]** 사용자 노트는 자동 큐잉 지점을 `main.mjs:1153-1169`(=`enqueueEntityExtractionIfNeeded` 정의)로 봤으나, **실제 호출처는 `:1226`과 `:1441` 2곳**이다. 함수 진입부 게이트로 두 곳을 동시에 커버하는 방식을 택했다(호출처 미변경).
- **[가정]** `runMultiQueryRag`를 QA에서 직접 호출해도 반환 형식이 호환된다(코드 확인: `runGraphEnhancedRag`가 내부적으로 동일 함수를 baseResults로 사용). developer는 `ragResults.graph` 필드를 하류에서 쓰지 않는지 최종 grep으로 확인.
- **[작업 위치 주의]** 대상 코드는 `codex/rag-infra-extraction` 브랜치(메인 워킹트리 `C:\Users\admin\Desktop\Server\Redou\V3`). worktree `bold-hofstadter-a85d9f`(main 브랜치)에는 entity 코드가 없으므로 그쪽에서 작업 금지.
