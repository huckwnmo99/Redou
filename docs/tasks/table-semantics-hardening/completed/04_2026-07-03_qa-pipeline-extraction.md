# Phase 2-3 — QA 파이프라인 분리 (동작 보존 리팩터)

> 유형: feature (대규모 develop) | 상태: 완료 | 작성일: 2026-07-03 | 완료일: 2026-07-03 | 슬라이스: 04

## 개요

- **목적**: `main.mjs`의 `handleQaPipeline`(~116줄)을 `chat/qa-pipeline.mjs`로 추출한다 — table-pipeline과 동일한 DI(의존성 주입) 패턴. 회귀 테스트를 신설한다(graph on/off·no-data·abort·out-of-scope). **동작 무변경이 합격선.**
- **왜**: ADR 0002(module ownership)가 QA를 `chat/qa-pipeline.mjs`로 옮기라 명시(감사 B-M1). table 파이프라인은 이미 `chat/table-pipeline.mjs`로 추출됐으나 QA만 main.mjs에 남아 RAG 스코프·evidence 조립·인용·persist가 전부 main.mjs 인라인이다. 그 결과 **QA 경로에 단위 테스트가 0건**(B-M3) — graph 분기·no-data·abort·source attribution이 전부 미검증이다. 다음 슬라이스(05 QA 인용 검증)가 QA 로직을 건드리려면 먼저 테스트 가능한 모듈로 분리돼야 한다.
- **범위**: (1) `handleQaPipeline` → `chat/qa-pipeline.mjs`의 `runQaConversationPipeline`(DI 패턴) 추출 (2) main.mjs는 배선만 (3) 회귀 테스트 신설. **로직·동작 무변경**(순수 이동 + DI 경계).
- **제외**: **QA 인용 검증 로직 추가는 슬라이스 05**(여기선 순수 이동). B-R2(스트리밍 실패 salvage)·B-D2(groundedness)·B-D3(refNo 순서) 등 **QA의 알려진 결함은 이 슬라이스에서 고치지 않음** — 분리 후 05에서. **외부 라이브러리 0개**. DB·새 IPC·`CURRENT_EXTRACTION_VERSION` 무변경.

## 현재 동작 근거 (코드 실측)

- **handleQaPipeline 위치**: `main.mjs:2548-2663`. 시그니처 `handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController, ownerPaperIds, ownerId)`. `broadcastToWindows`·`supabase`·`getEntityGraphEnabled`·`getEntityExtractionModel`·`runGraphEnhancedRag`·`runMultiQueryRag`·`generateEmbedding`·`getPaperIdsInFolderTree`·`extractKeyTerms`·`assembleRagContext`·`buildEvidenceLocationsByPaper`·`serializeEvidenceLocations`·`generateQaResponse`·`formatSourceAttribution`·`unwrapSingle`·`intersectPaperIds`·`throwIfChatAborted`·`createChatStatusEmitter`·IPC_EVENTS를 **모듈 전역으로 직접 참조**(DI 아님).
- **호출부**: `main.mjs:2729-2731` — `if (conversationType === "qa") return await handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController, ownerPaperIds, ownerId);` (공통 setup 후 분기).
- **QA 흐름**(chat-table-pipeline-state.md QA-1~8): (1) `searching` 상태 (2) 폴더 스코프 교집합 (3) graph on/off 분기(`getEntityGraphEnabled` → `runGraphEnhancedRag` 또는 `runMultiQueryRag`) (4) no-data 시 assistant text insert + `CHAT_COMPLETE` (5) paperMetadata 로드 + paperRefMap + evidenceLocations (6) `assembleRagContext`(matrices 없음) (7) `answering` 스트리밍(`generateQaResponse` → `CHAT_TOKEN`) (8) `formatSourceAttribution` (9) assistant text insert(metadata: source_chunk_ids·referenced_paper_ids·source_evidence_locations) + phase=follow_up + `CHAT_COMPLETE`.
- **table-pipeline의 DI 선례**: `runTableConversationPipeline`(`table-pipeline.mjs:1129`)이 `supabase`·`emitStatus/Token/Complete`·`abortSignal`·`runMultiQueryRagFn`·`getPaperIdsInFolderTreeFn`·`intersectPaperIdsFn`·`generateOrchestratorPlanFn` 등 **전부 인자로 주입**받고, `defaultIntersectPaperIds`·`defaultUnwrapSingle` 등 기본값 제공. 테스트가 fake 서비스로 구동 가능(`table-pipeline.test.mjs` 21건). **이 패턴을 QA에 복제.**
- **status emitter**: QA는 `createChatStatusEmitter({ conversationId, send: broadcastToWindows })`(2550행)를 자체 생성. table은 emitStatus를 주입받음 — QA도 주입 패턴으로 통일.
- **graph 의존**: `getEntityGraphEnabled`·`getEntityExtractionModel`·`runGraphEnhancedRag`는 entity-graph 계열(main.mjs 전역). QA 추출 시 이들도 주입 대상.
- **테스트 부재 확인**: `tests/`에 qa-pipeline 테스트 없음(table-pipeline·multi-query-rag·source-evidence는 있음). B-M3 명시.

## 설계

### DB 변경

**없음.**

### Electron (Backend)

**신규 모듈** `apps/desktop/electron/chat/qa-pipeline.mjs`:
- `export async function runQaConversationPipeline({ ... })` — table-pipeline과 동일한 DI 계약. 주입 목록(최소):
  - 값: `conversationId`(=convId), `message`, `history`, `scopeFolderId`, `scopeAll`, `ownerPaperIds`, `ownerId`.
  - 의존: `supabase`, `abortSignal`, `emitStatus`, `emitToken`, `emitComplete`.
  - 함수: `runMultiQueryRagFn`, `runGraphEnhancedRagFn`, `getEntityGraphEnabledFn`, `getEntityExtractionModelFn`, `generateEmbeddingFn`, `getPaperIdsInFolderTreeFn`, `generateQaResponseFn`, `formatSourceAttributionFn`.
  - 기본값 제공: `intersectPaperIdsFn = defaultIntersectPaperIds`, `unwrapSingleFn = defaultUnwrapSingle`, `assembleRagContextFn`, `buildEvidenceLocationsByPaperFn`, `serializeEvidenceLocationsFn`, `extractKeyTermsFn`(이미 순수 함수라 import 기본값 가능).
- **로직은 handleQaPipeline를 그대로 옮김** — 전역 참조를 인자로 치환하는 것 외 **흐름·조건·상태 이벤트·persist·metadata 형태 전부 동일**. `broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, ...)` → `emitToken(token)`, `IPC_EVENTS.CHAT_COMPLETE` → `emitComplete(result)`로 치환(table-pipeline과 동일 이벤트 계약).
- abort: 기존 `throwIfChatAborted(abortController.signal)` → `throwIfChatAborted(abortSignal)`. abort 지점 동일 위치 보존.

**수정** `apps/desktop/electron/main.mjs`:
- `handleQaPipeline` 정의(2548-2663) **삭제**.
- 호출부(2729-2731)를 `runQaConversationPipeline` 호출로 교체 — 필요한 의존을 주입. `emitStatus`는 이미 setup에서 생성됨(2726행 `createChatStatusEmitter`), `emitToken`/`emitComplete`는 `(token) => broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, { conversationId: convId, token })`·`(payload) => broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, payload)` 형태 인라인(table 호출부 선례 재사용 가능).
- import 추가: `import { runQaConversationPipeline } from "./chat/qa-pipeline.mjs";`.

> [가정 A] `assembleRagContext`·`buildEvidenceLocationsByPaper`·`serializeEvidenceLocations`·`extractKeyTerms`는 이미 별도 모듈(`chat/table-extraction.mjs`·`chat/source-evidence.mjs`·`chat/extraction-utils.mjs`)에서 export되므로 qa-pipeline이 직접 import(기본값)하거나 주입 — developer가 "테스트 격리 위해 주입" vs "직접 import 단순" 판단. table-pipeline은 일부 주입/일부 import 혼용이므로 그 관례 따름.
> [가정 B] `defaultIntersectPaperIds`·`defaultUnwrapSingle`은 table-pipeline에 이미 있음 → qa-pipeline에서 재정의(중복 최소·독립성) 또는 공용 모듈로 추출. **동작 무변경이므로 재정의 우선**(공용화는 별도).

### Frontend

**없음.** 순수 백엔드 리팩터. IPC 이벤트 계약(`CHAT_STATUS`/`CHAT_TOKEN`/`CHAT_COMPLETE`/`CHAT_ERROR`) 무변경이므로 프론트 무영향.

## 작업 분해

`/develop`가 이 순서대로 실행한다.

1. [x] **모듈 생성** — `chat/qa-pipeline.mjs`에 `runQaConversationPipeline` + `defaultIntersectPaperIds`/`defaultUnwrapSingle`(재정의, 동작 무변경 우선). handleQaPipeline 로직을 인자 치환하며 이식.
2. [x] **배선 교체** — main.mjs에서 `handleQaPipeline` 삭제, 호출부를 `runQaConversationPipeline`(의존 주입)로. import 추가.
3. [x] **회귀 테스트 신설** — `tests/qa-pipeline.test.mjs` (6건). fake 서비스로:
   - graph OFF: `getEntityGraphEnabledFn → false` → `runMultiQueryRagFn` 호출(graph 미호출), 정상 완주. ✅
   - graph ON: `→ true` → `runGraphEnhancedRagFn` 호출, `graphing` 상태 방출. ✅
   - no-data: RAG가 chunks/figures 0 → no-data assistant insert + `emitComplete(hasTable:false)`, 스트리밍 미진입. ✅
   - abort: `abortSignal` 사전 fire → `throwIfChatAborted`가 AbortError, assistant 메시지 미insert. ✅
   - out-of-scope: filterPaperIds 교집합이 산출 범위를 제한(폴더 스코프). ✅
   - source attribution: 실 `formatSourceAttribution` 결과가 persist metadata의 `referenced_paper_ids`·`source_evidence_locations`에 반영. ✅
4. [x] **동작 동치 확인** — 테스트가 handleQaPipeline의 관측 가능한 출력(이벤트 순서·persist 형태·metadata 키)을 그대로 재현.

## 구현 결과 (2026-07-03, developer)

- **이동된 함수**: `handleQaPipeline`(main.mjs:2547-2663, ~116줄) → `chat/qa-pipeline.mjs`의 `export async function runQaConversationPipeline({...})`(183줄, 문서/DI 포함). 로직·조건·상태 이벤트·persist·metadata 형태 전부 동일. 전역 참조를 전부 인자로 치환(순수 이동 + DI 경계).
- **DI 시그니처**: `{ conversationId, message, history, scopeFolderId, scopeAll, ownerPaperIds, ownerId, supabase, abortSignal, emitStatus, emitToken, emitComplete, runMultiQueryRagFn, runGraphEnhancedRagFn, getEntityGraphEnabledFn, getEntityExtractionModelFn, generateEmbeddingFn, getPaperIdsInFolderTreeFn, generateQaResponseFn, formatSourceAttributionFn, intersectPaperIdsFn=default, unwrapSingleFn=default, assembleRagContextFn=import, buildEvidenceLocationsByPaperFn=import, serializeEvidenceLocationsFn=import, extractKeyTermsFn=import }`. 순수 헬퍼 4종(assembleRagContext·buildEvidenceLocationsByPaper·serializeEvidenceLocations·extractKeyTerms)은 [가정 A]에 따라 **import 기본값 + override 가능**(table-pipeline 관례). LLM 접점(runMultiQueryRag·runGraphEnhancedRag·getEntityGraphEnabled·getEntityExtractionModel·generateEmbedding·getPaperIdsInFolderTree·generateQaResponse·formatSourceAttribution)은 주입 필수.
- **이벤트 계약 통일(R-3)**: 원본은 내부에서 `createChatStatusEmitter`를 자체 생성했으나, table-pipeline과 동일하게 **emitStatus/emitToken/emitComplete를 주입**받도록 통일(호출부에서 `broadcastToWindows(IPC_EVENTS.CHAT_TOKEN/COMPLETE, …)` 인라인 래핑, [가정 C]). `abortController.signal` → 주입 `abortSignal`로 통일, `throwIfChatAborted` fire 지점 2곳 동일 위치 보존.
- **default 헬퍼([가정 B])**: `defaultIntersectPaperIds`/`defaultUnwrapSingle`을 qa-pipeline.mjs에 재정의(동작 무변경 우선, 공용화는 별도 slice).
- **main.mjs 전/후 줄수**: **3097 → 2996 (−101줄)**. handleQaPipeline 116줄 + 이 함수 전용이 된 dead import 4종(`throwIfChatAborted`·`extractKeyTerms`·`assembleRagContext`·`buildEvidenceLocationsByPaper`/`serializeEvidenceLocations`) 제거, 호출부 배선(+23줄)로 상쇄. ADR 0002 방향(main.mjs 축소) 이행.
- **검증**: `node --check` qa-pipeline.mjs + main.mjs + qa-pipeline.test.mjs 통과. `node --test tests/*.test.mjs` **129/129**(기존 123 + 신규 QA 6, 회귀 0). frontend 무변경(순수 백엔드 리팩터, IPC 이벤트 계약 무변경). DB·새 IPC·`CURRENT_EXTRACTION_VERSION` 무변경.
- **계획 대비 변경**: (1) 순수 헬퍼 4종을 import 기본값으로 노출(테스트 override 용이) — 가정 A 범위 내. (2) main.mjs에서 dead import 4종을 제거(내 변경으로 생긴 dead code만) — 계획 미명시였으나 수술적 정리. (3) attribution 테스트는 mock 대신 **실 `formatSourceAttribution`**로 `[1]→paperId`·evidence 매핑을 결정적으로 고정(관측 출력 동치 강화).

## 영향 범위

- 수정되는 기존 파일: `main.mjs`(handleQaPipeline 삭제 + 호출부 교체 + import).
- 신규 파일: `chat/qa-pipeline.mjs` + `tests/qa-pipeline.test.mjs`.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**(순수 리팩터).
- DB 마이그레이션: **불필요**.
- 새 IPC 채널: **없음**(이벤트 계약 무변경).

## 리스크 & 대안

- **R-1 은닉 전역 누락**: handleQaPipeline이 참조하는 전역을 하나라도 인자로 안 넘기면 런타임 ReferenceError. → 근거 섹션의 전역 목록을 체크리스트로. `node --check` + 테스트로 조기 검출.
- **R-2 동작 미세 변경**: 이벤트 순서·metadata 키·no-data 문구가 조금이라도 바뀌면 프론트 회귀. → "동작 무변경이 합격선" — 테스트가 관측 출력을 고정. 문구·순서 그대로 이식.
- **R-3 abort 전파 차이**: table-pipeline은 `abortSignal` 주입, QA는 `abortController.signal`을 직접 씀 → 주입 시 `abortSignal`로 통일하되 fire 지점 동일. abort 테스트로 고정.
- **R-4 graph 의존 주입 복잡도**: entity-graph 함수 3개를 주입하면 시그니처가 길어짐 → table-pipeline이 이미 긴 DI 목록을 감내하므로 관례 일치. 기본값 제공으로 호출부 부담 완화.
- **R-5 중복 헬퍼**: `defaultIntersectPaperIds`/`defaultUnwrapSingle`이 table·qa 양쪽에 생김 → **동작 무변경 우선**이라 재정의 수용. 공용 모듈 추출은 이 슬라이스 밖(별도 정리 slice).

## 가정 사항 (developer 확인/판단)

- [가정 A] 순수 헬퍼(assembleRagContext 등)는 직접 import vs 주입 — table-pipeline 관례 따라 developer 판단.
- [가정 B] default 헬퍼는 재정의(동작 무변경 우선). 공용화는 별도.
- [가정 C] emitToken/emitComplete는 호출부에서 broadcastToWindows 래핑 인라인(table 선례).
- [가정 D] **이 슬라이스는 순수 이동** — B-R2/B-D2/B-D3 결함은 05에서. 여기서 고치지 않음.

## 검증 기준

1. `node --check`: `qa-pipeline.mjs` + `main.mjs` 통과.
2. `node --test tests/*.test.mjs`: 기존 90건 회귀 통과 + 신규 qa-pipeline 케이스(graph on/off·no-data·abort·attribution).
3. **동작 동치**: 이벤트 순서·persist metadata 키(`source_chunk_ids`·`referenced_paper_ids`·`source_evidence_locations`)·no-data 문구가 이식 전과 동일(테스트로 고정).
4. **QA 경로 테스트 0 → N**: B-M3 해소(graph 분기·no-data·abort 커버).
5. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경.
6. harness 갱신: `chat-table-pipeline-state.md`(Extraction Targets의 qa-pipeline.mjs를 "추출됨"으로) + `detail/electron/llm.md`(qa-pipeline 모듈 행) + `main-process.md`(handleQaPipeline 제거·qa-pipeline 의존) + `VERSION.md` 범프.

## 실행 순서 메모

**Phase 2의 3번**. **05(QA 인용 검증)의 전제** — QA 로직이 테스트 가능한 모듈로 분리돼야 05가 인용 검증을 안전하게 얹는다. 02·03(테이블 검증·eval)과는 **독립적**(QA vs table 경로)이라 병행 가능하나, 04 → 05는 순서 고정. 리팩터라 리스크 낮음.
