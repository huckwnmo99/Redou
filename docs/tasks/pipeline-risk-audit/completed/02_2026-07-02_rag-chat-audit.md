# 파이프라인 위험 감사 B — RAG 검색→채팅/테이블
> 유형: audit | 작성일: 2026-07-02 | 담당: planner-B

분석 범위: `rag/multi-query-rag.mjs`, `graph-search.mjs`, `reranker-worker.mjs`, `llm-chat/orchestrator/qa.mjs`, `chat/*`, `main.mjs`의 채팅 IPC(`CHAT_SEND_MESSAGE`/`CHAT_ABORT`/`CHAT_EXPORT_CSV`)·`getEntityGraphEnabled`·`handleQaPipeline`, chat/entity 마이그레이션 + RPC. **코드 미수정.**

## 요약
- 발견 총 13건: 런타임 5 / 아키텍처 4 / 데이터·보안 4
- 심각도: **P0 2건**, **P1 6건**, **P2 5건**
- 최우선 3건:
  - **B-D1 (P0)**: graph QA의 `entities` exact-match 조회가 owner/paper 필터 없이 전체 테이블 조회 → 타 사용자 엔티티가 canonical_name 일치 시 그래프 컨텍스트로 유입 (service_role RLS 우회 환경).
  - **B-R1 (P0)**: 같은 conversationId 동시 `CHAT_SEND_MESSAGE` 시 `chatAbortControllers` 덮어쓰기 + 첫 요청 `finally`가 두 번째 컨트롤러 삭제 → abort 불능 + 중복 assistant/table 영속화.
  - **B-D2 (P1)**: QA 답변 인용([N])은 Guardian 검증이 전혀 없음 — LLM이 근거 없는 수치·귀속을 써도 그대로 저장·표시.

> **알려진 항목 재검증**: fix 17(`getEntityGraphEnabled` throw)은 **이미 해결됨** — `main.mjs:530-535`가 `console.warn`+`return false`로 graceful degrade. `feature-status.md`의 "📋 계획됨"(66행)은 **stale**이므로 하네스 갱신 필요(오케스트레이터). fix 19 P1(chunks 쏠림)은 **실재** → B-R4. "chat Supabase null 처리"의 백엔드 실체는 B-R3.

---

## 1. 런타임 버그·안정성

### B-R1. 같은 conversationId 동시 요청 시 abort 레지스트리 붕괴 — P0, 높음
- 위치: `main.mjs:2642-2643`(set), `2701-2703`(finally delete), `2724-2728`(CHAT_ABORT lookup)
- 시나리오: 사용자가 같은 대화에서 빠르게 두 번 전송(또는 프론트 재시도). 요청1이 컨트롤러A를 `set(convId, A)`. 요청2가 `set(convId, B)`로 덮어씀 → A는 맵에서 사라져 **abort 불가능**(CHAT_ABORT는 B만 취소). 요청1이 먼저 끝나면 `finally`의 `chatAbortControllers.delete(convId)`가 **아직 실행 중인 B의 엔트리를 삭제** → 이후 B에 대한 CHAT_ABORT는 no-op. 두 요청 모두 완주하면 같은 대화에 **assistant 메시지·generated table이 2개** 영속화.
- 근거: 맵 키가 convId 단일. set은 조건 없이 덮어쓰고, delete는 키만 보고 삭제(자기 컨트롤러인지 확인 안 함). Stage 1 감사 R23이 "미정의"로 명시한 바로 그 지점이며 현재도 미구현.
- 권장 조치: convId당 진행 중 요청이 있으면 두 번째를 거부하거나 첫 요청을 abort 후 교체. delete 시 `if (map.get(convId) === myController)` 가드.

### B-R2. QA 파이프라인 에러가 사용자 메시지만 남기고 assistant 에러행 없이 실패 처리 — P1, 중간
- 위치: `main.mjs:2647-2649`(QA는 `handleQaPipeline` 직접 호출·자체 try 없음), `2679-2700`(공통 catch)
- 시나리오: QA 모드에서 `runMultiQueryRag`/`generateQaResponse`가 throw(Ollama 다운, DB 에러 등). 공통 catch가 `chat_messages`에 `message_type:"error"` 행을 insert하지만(2689) — 이는 정상. 다만 **스트리밍 도중** 실패 시 이미 `CHAT_TOKEN`으로 부분 텍스트가 렌더러에 전송된 상태에서 최종 `CHAT_ERROR`가 오면, 프론트에 부분 답변과 에러가 공존(부분 답변은 어디에도 persist 안 됨 → 새로고침 시 소실). Table 파이프라인과 달리 QA는 no-data 외 중간 실패의 결과 salvage가 없음.
- 근거: `handleQaPipeline`의 스트리밍 루프(2558-2561)는 실패 시 부분 `fullResponse`를 버리고 상위 catch로 전파. table 경로의 fix 18식 salvage 없음.
- 권장 조치: QA 스트리밍 실패 시 부분 응답+주석을 저장하거나, 최소한 부분 토큰을 폐기하는 UX를 명시. (확인 필요: 프론트가 CHAT_ERROR 수신 시 부분 버퍼를 비우는지 — frontend 범위)

### B-R3. `persistTableReport`가 headers/rows 누락 tableJson을 무검증 insert — P1, 중간
- 위치: `chat/table-pipeline.mjs:920-957`, 특히 `920`(`if (tableJson.rows)`), `949`(`JSON.stringify(tableJson)`), `986-989`(insert)
- 시나리오: `generateTableFromSpec`(single-call fallback) LLM이 스키마를 어기고 `headers` 없이 반환(format 강제가 있어도 로컬 모델은 이따금 위반). fallback catch(610-633)는 throw만 salvage하고 **정상 반환이지만 필드 결손인 JSON은 그대로 통과**. `tableJson.rows`가 undefined면 `cleanCellValue` 매핑은 건너뛰지만(920 가드), insert 시 `chat_generated_tables.rows`(NOT NULL, 마이그레이션 `20260328010000:44`)에 `undefined`→`null`이 들어가 **DB NOT NULL 위반으로 insert 실패** → 전체 파이프라인 throw → 공통 catch. 사용자 관점에선 "table 생성 실패".
- 근거: fallback 정상 반환 경로에 `normalizeFallbackTableToSpec`가 있으나(607) 이는 `headers`가 있을 때만 정규화. `headers`/`rows`가 아예 없으면 `Array.isArray` 가드로 `[]` 처리되긴 하나(`normalizeFallbackTableToSpec:154-157`), per-paper 경로(`extractionMode==="per_paper"`)의 `mergeExtractionResults`는 항상 배열을 보장하는 반면 **single-call 정상 반환은 normalize를 거쳐도 `title`만 있고 `rows:[]`가 될 수 있음** → 빈 테이블은 DB엔 들어가나 사용자엔 무의미. 진짜 위험은 `notes` 등 부가 필드만 있고 `title` 미정의 시 `table_title:undefined`.
- 권장 조치: insert 직전 `tableJson.headers ??= []; tableJson.rows ??= []; tableJson.title ??= tableSpec.title` 방어. (확인 필요: `chat_generated_tables.rows/headers` NOT NULL이라 실제로 null insert가 나면 크래시인지 빈배열인지 — 로컬 DB 재현 권장)

### B-R4. per-paper 컨텍스트 chunks 쏠림 → 특정 논문 0 chars 추출 — P1, 높음 (fix 19 P1 미구현)
- 위치: `chat/table-pipeline.mjs:465-470`(assemblePerPaperContext 호출), `chat/table-extraction.mjs:93-145`
- 시나리오: `runMultiQueryRag`가 reranker top-15 chunks를 반환(mode=table). 여러 논문 대상이어도 chunks가 특정 인기 논문에 몰리면, `parseTableMatrices`가 만든 `chunksByPaper`(table-pipeline.mjs:328-332)에서 **어떤 논문은 chunk 0개**. 그 논문에 OCR figure도 없으면 `assemblePerPaperContext`가 빈 문자열 반환 → `runPerPaperExtraction:472-481`이 LLM 호출 없이 `data_rows:[]` success 처리 → fix 19 placeholder(전 셀 N/A) 행만 생김. 실제로 그 논문에 데이터가 있어도 검색 top-15에서 밀리면 영구히 N/A.
- 근거: rerank는 전체 chunk 풀에서 top-K를 뽑을 뿐 논문별 최소 할당이 없음(`multi-query-rag.mjs:81-101`, `196-207`). backfill은 table figure만 보강(table-pipeline.mjs:266-297)하고 chunk는 보강 안 함. fix 19 문서가 P1로 남긴 항목과 정확히 일치.
- 권장 조치: per-paper 추출 전 논문별 chunk 최소 N개 보장(paper-scoped 재조회) 또는 rerank를 논문별로 분리. 부작용: 검색 비용 증가.

### B-R5. Stage 3a LLM 파서 예외가 top-level abort를 삼킴 — P2, 중간
- 위치: `chat/table-pipeline.mjs:379-396`(try/catch), 특히 `393-395`
- 시나리오: Stage 3a에서 `extractMatrixFromHtml`(LLM 폴백)이 사용자 abort로 throw. catch가 `console.error`만 하고 **삼킴** → 루프가 다음 figure로 진행. abort가 걸렸는데도 파싱 단계를 계속 돌다가 Stage 3b 진입 직전 `runPerPaperExtraction`의 첫 `throwIfChatAborted`가 없어(아래 B-R 참고) 실제 취소가 지연됨.
- 근거: catch 블록(393)이 `err?.name === "AbortError"` 재throw 없이 무조건 삼킴. `ollamaSignal`이 사용자 signal을 합성하므로 abort 시 AbortError가 나지만 여기서 소거됨. Stage 1 감사 abort 테이블도 "decide whether top-level abort should rethrow here"로 미결 표시.
- 권장 조치: catch에서 `if (err?.name === "AbortError") throw err;` 추가(다른 chat 모듈과 일관).

---

## 2. 아키텍처·유지보수 리스크

### B-M1. `handleQaPipeline`이 main.mjs에 잔존 — ADR 0002 위반 — P2, 높음
- 위치: `main.mjs:2475-2590`(약 116줄의 QA 도메인 로직)
- 근거: ADR 0002는 QA를 `chat/qa-pipeline.mjs`(또는 llm-qa 통합 후)로 옮기라 명시(0002 Target Owners 표). table 파이프라인은 `chat/table-pipeline.mjs`로 추출됐으나 QA는 미추출 상태로 RAG 스코프·evidence 조립·인용·persist가 전부 main.mjs에 있음. ADR 0004의 "main.mjs gains new chat/table domain logic" 리뷰 플래그 대상.
- 권장 조치: QA를 별도 모듈로 추출(table 파이프라인과 동일 DI 패턴). 추출 시 B-R2/B-D2도 함께 다룰 수 있음.

### B-M2. RAG 튜닝 상수가 모듈 3곳에 하드코딩 산재 — P2, 중간
- 위치: `rag/multi-query-rag.mjs:9-10,68`(RRF 가중·topK), `40`(TABLE_BOOST), `118-147`(threshold 0.2/0.15·count 60/30), `graph-search.mjs:7-8`(graph 가중), `table-extraction.mjs:4-9,16-20`(예산)
- 근거: match_threshold(0.2), match_count(60), RRF 가중(table 0.6/0.4, qa 0.3/0.7), graph 가중(0.78/0.22), reranker topK(15/10), 예산(70K/35K/120K) 등 검색 품질을 좌우하는 값이 여러 파일에 흩어져 env 노출 없이 매직넘버로 존재. per-paper 타임아웃만 fix 20으로 env화됨(대조).
- 권장 조치: `rag/config.mjs` 등 단일 상수 모듈로 수렴(중복 제거·튜닝 용이). 동작 무변경 리팩터.

### B-M3. QA 파이프라인에 회귀 테스트 공백 — P1, 중간
- 위치: 테스트 없음(`tests/`에 table-pipeline은 있으나 qa-pipeline 테스트 부재)
- 근거: `runTableConversationPipeline`은 21건 테스트(abort/no-data/fallback/Stage3d). 반면 `handleQaPipeline`은 main.mjs 안에 있어 단위 테스트가 없고, graph on/off 분기(2493-2515)·no-data(2519-2529)·source attribution(2565)·abort 전파가 전부 미검증. B-R2·B-D2·B-D3의 회귀 방지 수단이 없음.
- 권장 조치: QA 추출(B-M1) 후 table 파이프라인 수준의 회귀 테스트 추가(graph on/off, no-data, abort, out-of-scope 필터).

### B-M4. `formatSourceAttribution` 로직이 llm-qa와 source-evidence에 중복 — P2, 낮음
- 위치: `llm-qa.mjs:86-105`(`dedupeLocations`/`getEvidenceLocationsForPaper`)와 `chat/source-evidence.mjs:19-57`(동일 시그니처 `dedupeEvidenceLocations`/`getEvidenceLocationsForPaper`)
- 근거: 두 함수가 이름만 다르고 로직 동일. evidence location 포맷 변경 시 두 곳을 동기화해야 함(drift 위험).
- 권장 조치: source-evidence.mjs로 단일화하고 llm-qa가 import.

---

## 3. 데이터 정합성·보안

### B-D1. graph QA의 entities exact-match 조회가 owner/paper 필터 없이 전체 조회 — P0, 높음
- 위치: `graph-search.mjs:48-52`(`.from("entities").select(...).in("canonical_name", canonicalNames)` — **paper_id 필터 없음**), JS 필터는 `79-82`에서 `filterPaperIds.length > 0`일 때만
- 시나리오: entity graph ON인 사용자가 QA 질의. 질의 엔티티 canonical_name(예: "zeolite")이 **다른 사용자 논문의 entities와 일치**하면, main.mjs가 service_role로 RLS를 우회(`main.mjs:100-102`)하므로 exact-match SELECT가 **전 사용자 entities를 반환**. 이후 `filterPaperIds`(=ownerPaperIds)로 JS 필터가 걸리므로(79-82) 최종 그래프 확장은 방어되지만 — `matchQueryEntitiesToGraph`가 exact-match에서 rows>0이면 semantic 경로(match_entities RPC, filter_paper_ids 인자 있음)를 아예 건너뜀(59). 즉 **exact-match 단계에서 타 사용자 entity id가 seed로 잡히고**, `resolve_same_as`/`graph_traverse_1hop`(paper 필터 인자 없음, `20260423010000:150,179`)이 그 seed로 확장 → `fetchGraphChunks`의 chunk 필터(119-121)가 `filterPaperIds.length>0`이면 걸리지만, 만약 ownerPaperIds가 비면(논문 0편이나 스코프 결과 공집합) `[]`이라 `length>0`이 false → **필터 미적용으로 타 사용자 chunk 유입 가능**.
- 근거: JS 필터 3곳 모두 `Array.isArray && length > 0` 가드라 **빈 배열이면 필터 자체가 무력화**됨(graph-search.mjs:79, 119). RPC `resolve_same_as`/`graph_traverse_1hop`은 paper 필터 파라미터가 없어 seed만 맞으면 무제한 확장. service_role이라 RLS 방어선 없음.
- 권장 조치: exact-match SELECT에 `.in("paper_id", filterPaperIds)` 추가(빈 배열이면 조기 return). JS 필터의 `length>0` 가드를 제거하고 빈 배열=결과 0으로 처리. 부가 기능이지만 누출은 P0.

### B-D2. QA 답변에 groundedness 검증 부재 — 근거 없는 인용/수치 무검증 저장 — P1, 중간
- 위치: `main.mjs:2558-2582`(스트리밍→formatSourceAttribution→persist, 검증 단계 없음), 대조 table은 `table-pipeline.mjs:1020-1087` Guardian
- 시나리오: QA에서 LLM이 컨텍스트에 없는 수치를 답하거나 잘못된 [N]에 귀속. `formatSourceAttribution`(llm-qa.mjs:121)은 텍스트의 `[N]`을 파싱해 paperId만 매핑할 뿐 **그 인용이 실제 근거와 맞는지 검증하지 않음**. table 파이프라인은 Guardian이 수치 셀을 샘플 검증하지만 QA는 전무.
- 근거: `handleQaPipeline`에 `checkGroundedness` 호출 없음. `referenced_paper_ids`는 LLM이 쓴 숫자 기반이라 hallucinated 인용도 그대로 metadata에 저장(2577).
- 권장 조치: QA에도 선택적 groundedness 힌트(핵심 문장 샘플 검증) 또는 최소한 "인용은 LLM 자기보고" 경고. 데이터 신뢰도 이슈로 우선순위 존재.

### B-D3. QA `[N]` 인용 인덱스와 paperMetadata 순서 불일치 시 오귀속 — P2, 중간
- 위치: `llm-qa.mjs:47-52`(system 프롬프트의 refList = paperMetadata 순서), `126-135`(응답 [N]→paperMetadata[N-1] 매핑)
- 시나리오: `paperMetadata`는 `papers` 테이블 `.in("id", paperIds)` 조회 결과(main.mjs:2536)로 **DB 반환 순서에 의존**(정렬 미지정). 프롬프트의 refList도 같은 배열이라 내부적으론 일관되지만, RAG chunk가 실제로 근거한 논문과 LLM이 부여한 [N]이 어긋날 수 있음. LLM이 [2]를 썼는데 그 주장이 실제로 refList[0] 근거면 오귀속. `formatSourceAttribution`은 인덱스 범위만 검사(128)하고 내용 정합은 확인 안 함.
- 근거: paperIds 순서가 `[...new Set([...chunks.map, ...figures.map])]`(2532-2535)로 chunk 등장 순서에 의존 → 안정적이지 않음. table 파이프라인의 paperRefMap도 같은 방식이나 table은 셀에 [refNo]를 코드가 부여(merge)하는 반면 QA는 LLM이 자유 부여.
- 권장 조치: paperMetadata를 결정적 순서(예: 첫 등장 chunk의 rerank 순위)로 고정하고 프롬프트에 근거 스니펫과 refNo를 명시적으로 페어링. (B-D2와 함께 다루면 효율적)

### B-D4. Guardian 검증이 conversation 삭제 후에도 유령 update 시도 — P2, 낮음
- 위치: `chat/table-pipeline.mjs:1031-1086`(`setImmediate` 콜백), `1080`(update by tableId)
- 시나리오: table 완료 후 Guardian이 `setImmediate`로 백그라운드 실행(비차단). 그 사이 사용자가 대화 삭제 → `chat_generated_tables`는 CASCADE 삭제(마이그레이션 `20260328010000:38-39`). Guardian의 `update(...).eq("id", tableId)`는 존재하지 않는 행을 갱신(0 rows affected, 에러 아님) → 무해하지만 `emitVerificationDone`이 삭제된 대화에 이벤트 emit(1081). 프론트가 없는 대화의 verification 이벤트를 받음.
- 근거: 콜백 전체가 try/catch로 감싸져 있어(1032,1083) 크래시는 없음. Stage 1 감사 R25가 "non-fatal"로 이미 규정. 데이터 오염은 없으나 이벤트 누수.
- 권장 조치: emit 전 tableId 존재 확인 또는 프론트에서 unknown tableId 이벤트 무시(문서화). 현행도 non-fatal이라 P2.

---

## 범위 밖 메모 (파트 A / frontend)
- **frontend**: B-R2/B-D4 관련 — 프론트가 `CHAT_ERROR` 수신 시 부분 스트리밍 버퍼 처리 및 unknown tableId `CHAT_VERIFICATION_DONE` 무시 여부 확인 필요(`frontend/src/features/chat/`, `chatStore.ts`).
- **frontend**: feature-status의 "채팅 UI 텍스트 선택 + optimistic update" "chat Supabase null 처리" 📋 항목 — optimistic update가 중복 전송을 유발하면 B-R1을 악화시킬 수 있음(프론트 디바운스 확인).
- **파트 A**: `getEntityGraphEnabled` throw 이슈는 QA(B담당)에선 해결 확인. 단 import 경로 `enqueueEntityExtractionIfNeeded`(main.mjs:1192)의 동일 게이트도 같은 함수를 쓰므로 파트 A에서 별도 문제 없음(공유 확인).
- **하네스 갱신 필요**(오케스트레이터): `feature-status.md` 66행 fix 17을 "✅ 구현됨"으로, `entity-graph.md:43`은 이미 반영됨. B-D1은 신규 항목으로 등록 권장.
