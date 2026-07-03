# Phase 2-5 — 부속 2건: RAG 상수 통합 + A-R6 경고 UI

> 유형: 2개 fix 묶음 (소규모) | 상태: **완료(구현·검증)** | 작성일: 2026-07-03 | 완료: 2026-07-03 (fixer) | 슬라이스: 06

두 개의 독립적 소규모 항목. 서로 무관하며 **병행 가능**. 각각 개별 커밋 권장.

## 구현 결과 (2026-07-03, fixer)

**(A) RAG 튜닝 상수 `rag/config.mjs` 통합 — 무동작 리팩터, 합격.** 신규 `apps/desktop/electron/rag/config.mjs`에 named export 12종을 계획 명세 그대로 정의(값 100% 동일). 소비처 2파일을 config import로 치환 — **상수 값·호출 형태·전달값 무변경**. [가정 A 이행] `table-extraction.mjs`의 컨텍스트 예산(OCR/MATRIX/TOTAL_BUDGET·FALLBACK_RAG_BUDGET)은 "프롬프트 예산"이라 성격이 달라 이동하지 않음(RAG 검색 상수만 config로). 이동 목록:
- `rag/multi-query-rag.mjs`: `RRF_K`(60)·`RRF_WEIGHTS`(table 0.4/0.6·qa 0.7/0.3)·`FIGURE_RRF_WEIGHTS`(0.4/0.6)·`TABLE_BOOST`(0.005)·`RRF_RESULT_LIMIT`(40, 기존 `slice(0,40)`)·`RERANKER_TOPK`({table:15,qa:10}, 기존 모듈-지역 const 삭제)·`MATCH_CHUNK`({threshold:0.2,count:60,sectionBoost:0.08})·`MATCH_FIGURE`({threshold:0.15,count:30}). RPC 파라미터 리터럴(`match_chunks`/`match_chunks_bm25`/`match_figures`/`match_figures_bm25`)을 상수 참조로.
- `graph-search.mjs`: `GRAPH_TOP_K`(18, 기존 파일-지역 const 삭제)·`GRAPH_RRF_WEIGHTS`(qa base0.78/graph0.22·table base0.9/graph0.1)·`RRF_K`(k 기본값). import는 `./rag/config.mjs`(graph-search가 `rag/` 밖).

**(B) A-R6 경고 UI 표시 fix — 합격.** `ProcessingView.tsx`의 `JobCard`에 succeeded+error_message 경고 배너 분기를 "완료 시간" 블록 뒤·failed 배너 앞에 추가. **렌더 조건 전/후**:
- 전: `job.status === "failed" && job.error_message`일 때만 error_message 렌더 → succeeded 경고(chunkCount0) 미표시.
- 후: 위 분기는 무변경(danger 톤 유지) + **신규** `job.status === "succeeded" && job.error_message` 분기 → 경고 배너 렌더.
- 색상: `--color-warning`(#c0841a, `tokens.css:19`에 기존 정의됨 → **인라인 hex 대신 토큰 재사용**) 텍스트 + `rgba(192,132,26,0.10)` 배경. failed의 danger(`#dc2626`/`rgba(220,38,38,0.10)`)와 시각적으로 구분되는 caution 톤. [가정 B 이행 확인] succeeded+error_message 조합은 `main.mjs`의 chunkCount0 경로만 생성(정상 succeeded는 `error_message: null`) → 조건이 정확히 A-R6 경고만 포착.

**계획 대비**: (A) 계획 명세와 동일(값·소비처 무변경). (B) 계획이 "warning 토큰 있으면 재사용, 없으면 인라인 amber"를 제시했고 `--color-warning` 토큰이 실재함을 확인해 토큰 재사용(디자인 정합·인라인 hex 회피). `paperSignals.ts`·백엔드 경고 기록 로직 무변경(가정 F·계획 제외 준수).

**검증**: `node --check` 3파일(config·multi-query-rag·graph-search) 통과. `node --test tests/*.test.mjs` **140/140 회귀 통과**(값 무변경 → `multi-query-rag.test.mjs`의 `section_boost===0.08` 직접 assert 포함 전건 동일 결과). frontend `npx tsc --noEmit`(any 0) + `npm run build`(tsc -b+vite) + `npx vitest run` **32/32** 통과. eslint는 이 체크아웃에 `eslint.config.js` 미설정이라 실행 불가(tsc가 타입 게이트, 변경은 순수 additive JSX·config import 치환). DB/IPC/`CURRENT_EXTRACTION_VERSION`/컴포넌트 계약 무변경. 브랜치 `feature/table-semantics-phase2b`(신규 브랜치·커밋 없음). 커밋은 사용자.

---

## 항목 A — RAG 튜닝 상수 `rag/config.mjs` 통합 (B-M2, 무동작 리팩터)

### 개요

- **목적**: 검색 품질을 좌우하는 RAG 튜닝 상수가 모듈 3곳에 산재(B-M2)한 것을 단일 `rag/config.mjs`로 수렴한다. **동작 무변경** — 값은 그대로, 위치만 통합.
- **왜**: match_threshold(0.2)·match_count(60/30)·RRF 가중(table 0.6/0.4, qa 0.3/0.7)·figure 가중(0.6/0.4)·TABLE_BOOST(0.005)·reranker topK(15/10)·graph 가중(0.78/0.22)·GRAPH_TOP_K(18) 등이 여러 파일에 매직넘버로 흩어져 튜닝·감사가 어렵다(B-M2). per-paper 타임아웃은 fix 20으로 이미 env화된 것과 대조된다.
- **범위**: 상수 추출·중앙화만. **값·로직 무변경.**
- **제외**: 값 변경·env 노출 확대(이 슬라이스는 통합만, env화는 선택). 검색 알고리즘 변경. 외부 라이브러리 0개.

### 현재 동작 근거 (코드 실측)

산재 위치(전부 실측):
- `rag/multi-query-rag.mjs`: `rrfFusion` 가중 `wBM25 = qa?0.3:0.6`·`wVector = qa?0.7:0.4`(9-10행), `k=60` 기본(8행), `slice(0,40)`(34행) / `rrfFusionFigures` `wBM25=0.6`·`wVector=0.4`·`TABLE_BOOST=0.005`(38-40행) / `RERANKER_TOPK = { table: 15, qa: 10 }`(68행) / RPC 파라미터 `match_threshold: 0.2`·`match_count: 60`·`section_boost: 0.08`(120-124행), `match_threshold: 0.15`·`match_count: 30`(133-134행), figure bm25 `match_count: 30`(144행).
- `graph-search.mjs`: `GRAPH_TOP_K = 18`(4행), `rrfFusionWithGraph` `baseWeight = qa?0.78:0.9`·`graphWeight = qa?0.22:0.1`(7-8행).
- `chat/table-extraction.mjs`: 컨텍스트 예산 `OCR_BUDGET=70000`·`MATRIX_BUDGET=35000`·`TOTAL_BUDGET=120000`·per-paper 예산 3개(4-9행), `FALLBACK_RAG_BUDGET`(16-20행, 이미 export).

> [가정 A] `table-extraction.mjs`의 컨텍스트 예산은 "RAG 튜닝"이라기보다 "프롬프트 예산"이라 성격이 다름 → **RAG 검색 상수(threshold/count/RRF/topK/graph)만 config로 옮기고, 컨텍스트 예산은 table-extraction에 유지**(또는 별도 `chat/budgets.mjs`). developer가 응집도 기준 판단. `FALLBACK_RAG_BUDGET`은 이미 export·소비 중이라 이동 시 import 갱신 필요.

### 설계

**신규 모듈** `apps/desktop/electron/rag/config.mjs`:
- named export 상수: `RRF_K`(60), `RRF_WEIGHTS = { table: { vector: 0.4, bm25: 0.6 }, qa: { vector: 0.7, bm25: 0.3 } }`, `FIGURE_RRF_WEIGHTS = { vector: 0.4, bm25: 0.6 }`, `TABLE_BOOST`(0.005), `RERANKER_TOPK = { table: 15, qa: 10 }`, `RRF_RESULT_LIMIT`(40), `MATCH_CHUNK = { threshold: 0.2, count: 60, sectionBoost: 0.08 }`, `MATCH_FIGURE = { threshold: 0.15, count: 30 }`, `GRAPH_TOP_K`(18), `GRAPH_RRF_WEIGHTS = { qa: { base: 0.78, graph: 0.22 }, table: { base: 0.9, graph: 0.1 } }`.
- **값은 현재와 100% 동일.** 주석에 각 상수의 소비처·의미.

**수정**:
- `rag/multi-query-rag.mjs`: 위 매직넘버를 config import로 치환. RPC 호출의 `match_threshold`/`match_count` 등을 상수 참조로. **호출 형태·전달값 동일.**
- `graph-search.mjs`: `GRAPH_TOP_K`·graph 가중을 config에서 import.

### 검증 기준

1. `node --check`: `rag/config.mjs`·`multi-query-rag.mjs`·`graph-search.mjs` 통과.
2. `node --test tests/*.test.mjs`: `multi-query-rag.test.mjs`·`graph-search.test.mjs` 포함 기존 90건 **전부 회귀 통과**(값 무변경이므로 동일 결과).
3. **동작 동치**: 상수 치환 전후 RRF 점수·rerank 순서·RPC 파라미터가 동일(테스트가 이미 커버하면 그것으로, 아니면 상수 참조=리터럴 확인).
4. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경.
5. harness 갱신: `detail/electron/rag-pipeline.md`(RAG 상수 config 중앙화 언급).

---

## 항목 B — A-R6 경고 UI 표시 fix (reviewer info 반영)

### 개요

- **목적**: chunkCount===0(스캔본/빈 PDF)일 때 **succeeded** job의 `error_message`에 기록된 경고를 `ProcessingView`가 렌더하도록 조건을 확장한다. 현재 백엔드는 경고를 기록하나 **UI가 표시하지 않는다**.
- **왜**: Phase 1(슬라이스 01)이 `main.mjs`에서 chunkCount===0인 succeeded job의 `error_message`에 "텍스트 추출 0청크(스캔본/빈 PDF 의심)…" 경고를 기록했다(`main.mjs:1181-1190`). 하지만 `ProcessingView.tsx:256`은 `job.status === "failed" && job.error_message`일 때만 error_message를 렌더한다 → **succeeded job의 경고는 화면에 안 뜬다**. 조용한 실패가 여전히 조용하다(A-R6의 UI 절반이 미완).
- **범위**: `ProcessingView.tsx`의 렌더 조건 확장(succeeded + error_message → 경고 스타일 렌더). **소규모 fix, 1파일.**
- **제외**: `paperSignals.ts` 판정 로직 변경(Phase 1 [가정 F] 유지 — 경고 노출만). 백엔드 경고 기록 로직 변경(이미 됨). 새 필드/IPC. 외부 라이브러리 0개.

### 현재 동작 근거 (코드 실측)

- **백엔드는 기록함**: `main.mjs:1181` `const noTextExtracted = !(extractionResult.chunkCount > 0);`, `1183` 경고 문자열, `1190` `error_message: zeroChunkWarning`을 succeeded job에 기록. `JOB_PROGRESS`도 방출(Phase 1 구현).
- **프론트는 failed만 렌더**: `ProcessingView.tsx:256-267` — `{job.status === "failed" && job.error_message ? (<div style={{ color: cfg.color, background: cfg.bg, ... }}>{job.error_message}</div>) : null}`. succeeded job은 250-254행에서 "완료 시간"만 표시하고 **error_message 무시**.
- **cfg**: 상단(범위 밖)에서 status별 색/배경 config를 만들 것으로 추정 — succeeded의 cfg는 "완료" 색이라 경고엔 부적절할 수 있음(주의 색 필요).

### 설계

**수정** `frontend/src/features/processing/ProcessingView.tsx`:
- succeeded job이 `error_message`를 가지면 **경고 배너**를 렌더하는 분기 추가(250-254행 "완료 시간" 블록 근처 또는 256행 조건 확장). 예:
  ```tsx
  {job.status === "succeeded" && job.error_message ? (
    <div style={{ /* 주의(amber) 스타일: color/bg를 warning 톤으로 */ }}>
      {job.error_message}
    </div>
  ) : null}
  ```
- 색상은 **failed(위험/빨강)와 구분되는 주의(amber/warning)** 톤 사용(경고지 실패는 아님). `tokens.css`에 warning 토큰이 있으면 재사용, 없으면 인라인 amber(디자인 킷 선례 `#d97706`, `ChatTableReport`의 AlertTriangle 색과 일치).

> [가정 B] "succeeded + error_message = 경고" 규칙이 다른 succeeded job에 오작동하지 않음 — error_message는 정상 succeeded면 null(`main.mjs:1313/1338/1576/1639` 등에서 `error_message: null`). chunkCount0 경로만 succeeded+메시지 조합을 만듦(코드 확인). 따라서 조건이 정확히 A-R6 경고만 잡음.

### 검증 기준

1. `frontend`: `npm run build`(tsc -b + vite) 통과, any 0.
2. **렌더 확인**: succeeded + error_message job → 주의 색 경고 배너. succeeded + error_message null → 배너 없음(정상). failed → 기존 위험 색 유지(무변경).
3. `npm run test`(vitest): 기존 32건 회귀 통과.
4. `CURRENT_EXTRACTION_VERSION`/DB/IPC/백엔드 무변경.
5. harness 갱신: `feature-status.md`의 Phase 1 A-R6 항목에 "UI 표시 완결" 반영(백엔드 기록 + 프론트 렌더 양쪽 완료).

---

## 실행 순서 메모 (슬라이스 06 전체)

**Phase 2의 부속**. 항목 A·B는 서로 독립이고 **02~05와도 독립** → 언제든 병행 가능. 규모 둘 다 **소규모 fix**. 항목 B는 Phase 1 A-R6의 UI 절반을 완결하므로 우선 처리 권장(사용자 가시 효과 즉시). 항목 A는 순수 리팩터라 리스크 최저 — 다른 슬라이스 사이 짬에 처리 가능.
