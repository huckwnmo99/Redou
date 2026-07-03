# Table Semantics Hardening — 테이블 의미 보존 강화

## Purpose

Redou 테이블 파이프라인(chat-table)의 **의미 매핑 결함 4건(D1~D4)**을 라이브러리 없이 스키마·계약 보강만으로 봉쇄한다. 근거: `pipeline-risk-audit`의 E2E 실증(2026-07-03) + 원문 대조 검증에서 확인된 실측 결함 — 수치 충실도는 탁월(조작 0건)하나 "무엇의 숫자인지"(표 맥락·컬럼 정의)를 구분 못함.

| ID | 결함 | 발생 스테이지 |
|----|------|--------------|
| D1 | 측정 조건이 다른 파라미터 세트가 구분 열 없이 혼입 (qualifier 소실) | Stage 1 spec + 3b 추출 |
| D2 | "q_max(포화 용량)" 열에 압력별 원시 데이터점 주입 (파라미터 vs 데이터점 혼동) | Stage 3b 추출 |
| D3 | 행별 source_hint("Table 4")가 병합에서 폐기 (provenance 소실) | Stage 3c 병합 |
| D4 | LLM 파편의 셀 유입 + NULL 채움 시 그럴듯한 오답 라벨 | Stage 3c 정화 / Stage 3d 복구 |

학술 근거(backlog/17): MeasEval(qualifier 스키마), IRCDL 2026(binding drift·numeric misattribution·instance compression), SemTab CTA(열 의미 타입), NIST AIF/ISODB(파라미터/원시점 분리 표준), DTBench(스키마 준수·충돌해소), MeasHalu(환각 유형), SCITAB(표-주장 검증).

## Current Status

- Status: **Phase 1 완료(PR #4 merge) + Phase 2 전체 완료(슬라이스 02·03·04·05·06 구현·검증 완료)** (2026-07-03). Phase 1은 단위/타입/빌드 전부 통과 + E2E 원문 대조 재실증에서 D1~D4 개선 확인(아래 "E2E 재실증 결과"). **슬라이스 06**(RAG config 통합 + A-R6 경고 UI, `completed/06`)·**슬라이스 05**(QA 인용 결정적 검증, `completed/05`)·**슬라이스 04**(QA 파이프라인 분리, 동작 보존, `completed/04`)·**슬라이스 03**(골든 픽스처 + `table_fidelity` eval, `completed/03`)·**슬라이스 02**(값 역매칭 검증기 + Guardian 좁히기, `completed/02`) 구현·검증 완료. 06: (A) RAG 튜닝 상수(RRF 가중·match_threshold/count·RERANKER_TOPK·GRAPH_TOP_K·graph 가중)를 신규 `rag/config.mjs` 단일 모듈로 수렴 — **값·소비처 로직 무변경(무동작 리팩터)**, `multi-query-rag.mjs`·`graph-search.mjs`를 config import로 치환. (B) `ProcessingView.tsx`가 succeeded job의 `error_message`(chunkCount0 경고)를 렌더하도록 조건 확장(failed danger와 구분되는 `--color-warning` caution 톤). `node --test` **140/140** 회귀(값 무변경) + frontend tsc(any 0)+build+vitest 32/32. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. 04: `main.mjs`의 `handleQaPipeline`(~116줄)을 `chat/qa-pipeline.mjs`의 `runQaConversationPipeline`(table-pipeline 동일 DI)로 **순수 이동** — 전역 참조 전부 인자화, 이벤트/persist/metadata 동작 무변경. main.mjs **3097→2996(−101줄)**. 신규 회귀 테스트 6건(graph on/off·no-data·abort·out-of-scope·attribution). 02: cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 **코드 역매칭**→"code-verified"(결정적), 실패분만 Guardian에 MeasHalu 유형별 좁은 질문, verification에 검증 주체(code/guardian) 저장 + 프론트 표시. 신규 `chat/value-backmatch.mjs` + `runCodeBackMatchPass`. 프로덕션 DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. 05: qa-pipeline.mjs에 refNo 결정 순서(`orderPaperMetadataDeterministic`, B-D3) + `[N]` 인용 코드 검증(`checkQaCitations` — 범위·존재·paperId 정합, LLM 없음) 국소 추가, `metadata.citationCheck` 기록(기록-only, 답변 무변경).
- 규모: Phase 1은 대규모(완료). Phase 2는 슬라이스별 상이 — 02(완료)·03(완료)·04(완료)·05(완료)·06(완료). **Phase 2 전체 완료.**

## Next Action

**Phase 2 슬라이스 전체(02·03·04·05·06) 구현·검증 완료.** 다음: `/test`(tester 빌드/타입/린트/테스트 종합) → `/review`(reviewer 코드 리뷰 → PR) → PR merge → **Phase 3**(도구 시험: 로컬 MinerU 3.4 업그레이드 선행 → docling·LangExtract 각각 독립 A/B, backlog/18). 사용자 확정 실행 순서 03→02→04→05→06 전부 소진. Phase 3의 A/B 심판은 03의 `table_fidelity` eval + 02의 검증 주체 분포 축(이후 추출 프롬프트 개선도 이 eval로 측정). **외부 라이브러리 0개 유지**(Phase 3부터 docling/LangExtract 도입 검토). 남은 후속(비차단, 별도 slice): (a) 02의 after 측정 13분 실 LLM E2E(`scripts/e2e-table-fidelity.mjs` — "code back-match N / Guardian M/T" 분포)는 오케스트레이터 별도 수행(baseline 44.2% fidelity·Guardian 31/44 대비), (b) conflictHandling 0/2 개선·QA groundedness(LLM)·열 이름 grounding은 eval 기반 측정 대상. 커밋은 사용자(브랜치 `feature/table-semantics-phase2b`).

## Fidelity Baseline (슬라이스 03 직후, 2026-07-03, gemma4:31b — 슬라이스 02의 "before")

`scripts/e2e-table-fidelity.mjs` 실측 (정답 43셀 대비):
- **fidelity 44.2% (19/43)** — 논문1 40.7%(11/27), 논문2 50.0%(8/16)
- **misattribution 0 · fabrication 0** — 표에 들어간 값은 전부 옳음. 낮은 fidelity는 **커버리지**(missing 24: 모델이 논문당 한 파라미터 세트만 선택 — perPaperReasons에 선택 근거 서술됨)
- conflictHandling 0/2 · Guardian 31/44 verified
- **런 간 변동 주의**: 동일 조건 직전 런과 nulls 32→42, Guardian 48/49→31/44 차이 — LLM 비결정성. 슬라이스 02 비교 시 축별 해석(신뢰 축=오귀속·조작·검증주체 / 변동 축=커버리지) 필요.

## Fidelity After — 슬라이스 02 이후 (2026-07-03, 동일 조건)

- **검증(02의 목표 축): 31/44 (70%, 샘플링 절반) → 86/86 (100%) verified — code back-match 84 / Guardian 2/2.** Guardian LLM 호출 44→2 (−95%). 수치 셀 전수가 결정적으로 검증됨.
- 신뢰 축 유지: misattribution 0 · fabrication 0 (양 런 동일).
- fidelity 41.9%(18/43) vs baseline 44.2%(19/43) — 런 간 변동 범위(커버리지 축, rows 32→31). 회귀 아님.
- conflictHandling 0/2 유지 — 후속 프롬프트 개선(eval로 측정하며 진행) 대상.

## E2E 재실증 결과 (2026-07-03, 기준선과 동일 조건: gemma4:31b·논문 2편·동일 쿼리)

| 결함 | 기준선(수정 전) | Phase 1 후 | 판정 |
|------|----------------|-----------|------|
| D1 조건 혼입 | 8.69/4.45 무구분 공존 | Model 열에 압력범위 표기(`DSL(~600 kPa)`/`(~100 kPa)`) + 셀 condition + **conditionConflicts 1건 기록**(q_max 열 조건 5종 명시) + perPaperReasons에 Table3 vs 4 선택 근거 서술 | ✅ 침묵→가시화 |
| D2 파라미터 vs 데이터점 | 등온선 원시 점 ~50행이 q_max 열에 | **원시 점 0행** — 양 논문 모두 파라미터 표(Table 4)에서 추출, 79행→32행. `adsorption domain detected -> injecting AIF extraction rules` 로그 확인 | ✅ |
| D3 provenance 폐기 | source_hint 전부 소실 | **cellTuples 192개 persist**(unit·condition·source_hint), columnSemanticTypes 저장 | ✅ |
| D4 파편 | JSON 파편 셀 + 5.05 소실 | 파편 0건 (밸리데이터 경로 + 단위 테스트 픽스처 고정) | ✅ |
| Guardian | 미완(스크립트 사유) | **48/49 verified 완주** | ✅ |

**원문 대조(수치 충실도)**: 논문2 Table 4의 DSL/Sips q_m 8개(2.400/2.328/2.450/2.00/4.89/2.95/6.91/6.07) 전부 자릿수까지 일치. 논문1의 4.45/4.02/3.78/2.91은 이전 대조에서 검증 완료(Table 4 ≤100 kPa 세트, 이번엔 선택 근거가 perPaperReasons에 명시됨). 조작 0건 유지.

**Phase 2 후보 관찰 (신규·비차단)**:
1. 논문2 파라미터 행의 `T (K)`=N/A — 온도의존 모델 파라미터라 단일 온도가 없음(원문 303–343 K 범위). 조건 범위 표기("303–343 K")로 개선 여지. Stage 3d 재검색은 30s 타임아웃으로 중단(기존 동작).
2. `R2` 열 — orchestrator가 만든 열 이름인데 원문 지표는 MAPE/DQaver. 값은 MAPE로 정확(튜플 condition="MAPE %"로 정직 표기)하나 **열 이름 grounding** 필요 + 1셀에 리터럴 "R2" 유입(파편 아님·짧은 문자열이라 밸리데이터 통과).
3. DSL q_max=qm1만 추출(2-사이트 합계 qm1+qm2 아님) — 흡착 사전의 파라미터 정밀화 후보. 튜플 provenance로 추적 가능해 치명적이지 않음.

## Success Criteria

- **D1~D4 재발 여부를 E2E 재실증으로 확인**: `apps/desktop/.tmp_e2e-table.mjs` 재실행 후 원문 대조로 (a) 조건 혼입 시 condition 열/주석 발현 (b) parameter 열에 원시 데이터점 미유입 (c) 셀 provenance(source_hint) metadata 보존 (d) 파편 셀 차단·미발견값 "N/A" 고정.
- **기존 단위 테스트 회귀 무결**: `node --test apps/desktop/tests/*.test.mjs` 전건 통과(현 65건 기준). `table-extraction.test.mjs`·`table-pipeline.test.mjs`는 새 계약에 맞춰 갱신하되 기존 시나리오 의미 보존.
- 신규 단위 테스트: 셀 튜플 파싱/병합 보존, 열 의미 타입 불일치 드롭, 조건 충돌 감지, 셀 밸리데이터 파편 차단, 단위 정규화(흡착) 각각 커버.
- **범용성 회귀 없음**: 흡착 사전은 도메인 감지 시에만 적용 — 비흡착 논문 테이블 생성이 변하지 않음을 테스트로 고정.
- `CURRENT_EXTRACTION_VERSION` 무변경(추출 파이프라인 아닌 채팅 경로), DB 마이그레이션 없음, 새 IPC 채널 없음 — 검증에 명시.
- harness 갱신: `detail/electron/llm.md`·`rag-pipeline.md`(셀 튜플·의미 타입 계약) + `feature-status.md` + `VERSION.md` 범프.

## Documents To Read

- `planned/01_2026-07-03_phase1-cell-tuple-schema.md` — Phase 1 상세 계획(작업 분해·파일별 수정·가정·검증·기존 테스트 영향).
- 근거 ledger: `../pipeline-risk-audit/README.md` (E2E 실증 + 원문 대조 검증 섹션).
- 근거 리서치: `../../backlog/17-table-extraction-semantics-research.md` (경로 A/B/C, 결함↔자료 매핑).
- 도구 후속: `../../backlog/18-docling-hybrid-adoption.md` (Phase 3 몫).

## 로드맵 (사용자 확정 2026-07-03)

전체 방향은 backlog/17의 **경로 A(단기) → 경로 B(중기) → 경로 C(장기)**를 Phase로 재편한 것.

- **Phase 1 (지금, 이 ledger 대상)**: 스키마·계약 보강 — **코드만, 외부 라이브러리 0개**. 셀 튜플·열 의미 타입·조건 충돌 감지·셀 밸리데이터·흡착 도메인 사전·임포트 청크 0 경고.
- **Phase 2 (다음)**: Guardian 재설계(SCITAB 표-주장 대조 + MeasHalu 환각 유형 체크 + 값 역매칭) + `rag-table-eval` 확장(충실성·충돌해소 축, ADR 0007) + ground-truth 축적 포맷.
- **Phase 3 (도구 시험, 사용자 채택 확정) → 별도 ledger [`../tool-ab-adoption/`](../tool-ab-adoption/README.md)로 분리**: **로컬 MinerU 3.4 업그레이드 선행**(A/B 기준선) → **docling**(표+bbox provenance ①, 그림 분류·설명 ③, 수식 보강 ④ — 비동기 job, backlog/18) 및 **LangExtract**(Stage 3b 대안 추출기, ~150KB·Ollama 백엔드) 각각 **독립 A/B 후 조건부 도입**. ②스캔 OCR 폴백은 MinerU 3.4 확인 후 재평가. **A/B 심판 = 이 ledger의 `table_fidelity` eval(슬라이스 03) + 검증 주체 분포(슬라이스 02).** 실행 이미지 실측 MinerU 2.7.6(2026-07-04).
- **장기 보류**: 측정 튜플 저장소 전환(경로 C — 병합 제거), 로컬 모델 파인튜닝(Dagdelen — 지금은 데이터 축적만).

## 사용자 결정 기록

- 셀 튜플은 `chat_generated_tables.metadata`(기존 JSONB)에 저장 — **DB 마이그레이션 없이 진행**(코드 검증으로 확정: metadata 컬럼 존재).
- 흡착 도메인 사전(NIST AIF 필드)은 **범용성을 해치지 않게 도메인 감지 시에만** 적용.
- 표 렌더의 셀 튜플 노출은 **hover 또는 확장** 방식(사용자 표 형태는 유지, 부가 정보만).
- 구현은 Claude 서브에이전트(`developer`)로 — Codex 미사용.

## Planned

Phase 2 슬라이스 5개 전부 완료 (본질: 신뢰를 측정 가능하게 — 검증 결정화 + 자동 측정). 실행 순서 03→02→04→05→06 전부 소진. **남은 계획 없음** — 다음은 Phase 3(별도 ledger 예정, 도구 A/B).

- (없음)

## In Progress

- (없음)

## Completed

- `completed/06_2026-07-03_rag-config-and-ar6-warning-ui.md` — Phase 2 슬라이스 06: **부속 2건**(소규모 fix, 독립·02~05와도 독립). **(A) RAG 튜닝 상수 `rag/config.mjs` 통합(B-M2, 무동작 리팩터)** — 검색 품질을 좌우하는 매직넘버가 `multi-query-rag.mjs`·`graph-search.mjs`에 산재하던 것을 신규 단일 모듈 `apps/desktop/electron/rag/config.mjs`(named export 12종)로 수렴. **값 100% 동일, 위치만 이동(동작 무변경)**: `RRF_K`(60)·`RRF_WEIGHTS`(table 0.4/0.6·qa 0.7/0.3)·`FIGURE_RRF_WEIGHTS`(0.4/0.6)·`TABLE_BOOST`(0.005)·`RRF_RESULT_LIMIT`(40)·`RERANKER_TOPK`({table:15,qa:10})·`MATCH_CHUNK`({threshold:0.2,count:60,sectionBoost:0.08})·`MATCH_FIGURE`({threshold:0.15,count:30})·`GRAPH_TOP_K`(18)·`GRAPH_RRF_WEIGHTS`(qa base0.78/graph0.22·table base0.9/graph0.1). 두 소비처를 config import로 치환(RPC 파라미터·`slice` 상한·모듈-지역 const 제거), 호출 형태·전달값 무변경. [가정 A] `table-extraction.mjs`의 컨텍스트 예산(프롬프트 예산)은 성격이 달라 미이동(RAG 검색 상수만). **(B) A-R6 경고 UI 표시 fix**(reviewer info 해소) — 백엔드는 chunkCount0 succeeded job의 `error_message`에 경고를 기록하나(`main.mjs:1181-1193`), `ProcessingView.tsx`가 `status==="failed"`일 때만 error_message를 렌더 → succeeded 경고가 미표시(조용한 실패). `JobCard`에 `status==="succeeded" && error_message` 분기 추가로 경고 배너 렌더 — failed의 danger(`#dc2626`)와 구분되는 `--color-warning`(#c0841a, `tokens.css` 기존 토큰 재사용) caution 톤. [가정 B 확인] 정상 succeeded는 `error_message: null`이라 조건이 A-R6 경고만 포착. `paperSignals.ts`·백엔드 무변경. 검증: `node --check` 3파일 + `node --test` **140/140 회귀**(값 무변경, `section_boost===0.08` 직접 assert 포함) + frontend tsc(any 0)+build+vitest 32/32. DB/IPC/`CURRENT_EXTRACTION_VERSION`/컴포넌트 계약 무변경. 계획 대비: (A) 명세 그대로, (B) warning 토큰 실재 확인해 인라인 hex 대신 토큰 재사용. 구현·검증 완료(2026-07-03, fixer). 커밋 대기.
- `completed/05_2026-07-03_qa-citation-deterministic-check.md` — Phase 2 슬라이스 05: **QA 인용 결정적 검증**(소규모 fix, 04 선행 충족). 04로 분리된 `chat/qa-pipeline.mjs`에 국소로 얹음 — 인용 표시 자체 보존, 검증·순서 결정성만 추가. **(1) refNo 결정 순서(B-D3)**: 신규 export `orderPaperMetadataDeterministic(paperMetadata, ragResults)`가 기존 `[...new Set([...chunks.map, ...figures.map])]`(chunk 등장 순서·실행 간 비결정)를 대체 — ① chunks 첫 등장 순위(rerank됨) → ② figures 첫 등장 순위(chunk 수 오프셋으로 chunk-backed 우선) → ③ paperId 사전순. 입력 불변. paperMetadata 로드 직후 적용 → paperRefMap·프롬프트 refList·`formatSourceAttribution`·persist가 같은 순서 공유(대화 내부 일관, 신규 대화부터·과거 metadata 미재작성). **(2) 인용 코드 검증**: 신규 export `checkQaCitations(text, orderedMeta, ragResults) → { citationCount, inRange, outOfRange, grounded, ungroundedRefs }` — `[N]` 파싱 후 범위·존재(`outOfRange`) + paperId 정합(인용 논문이 `chunks∪figures` 근거 집합에 부재면 `ungroundedRefs`). 중복 1회 카운트. **LLM groundedness 명시 제외** — 코드 확정 가능한 약한 정합만. **(3) 배선**: 두 헬퍼를 DI(import 기본값+override), `formatSourceAttribution` 뒤 실행, `metadata.citationCheck: { citationCount, outOfRange, ungroundedRefs }` 기록(기록-only, 답변 텍스트·흐름 무변경, gate C), 문제 인용 시 `console.warn` 1줄. `types/chat.ts`에 `QaCitationCheck` + `ChatMessageMetadata.citationCheck?`(any 0). DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. `node --check` 2파일 + `node --test` **140/140**(기존 129 + 신규 11: order 5·check 5·pipeline 1, 회귀 0) + frontend tsc(any 0)+build. 계획 대비: `checkQaCitations` 반환에 inRange/grounded 포함(관측성), 프론트 타입은 선택이었으나 계약 문서화 위해 추가(비용 0), 문제 인용 warn 1줄(차단 없음). 구현·검증 완료(2026-07-03, fixer). 커밋 대기.
- `completed/04_2026-07-03_qa-pipeline-extraction.md` — Phase 2 슬라이스 04: **QA 파이프라인 분리(동작 보존 리팩터)**. `main.mjs`의 `handleQaPipeline`(2547-2663, ~116줄)을 `chat/qa-pipeline.mjs`의 `export runQaConversationPipeline({...})`로 **순수 이동** — table-pipeline과 동일한 명시적 DI(supabase·abortSignal·emitStatus/Token/Complete·RAG/graph/embedding/folder/QA 함수 주입, 순수 헬퍼 4종은 import 기본값+override, default intersect/unwrap 재정의). 로직·조건·상태 이벤트·persist·metadata 형태 전부 동일. 이벤트 계약을 table-pipeline과 통일(emitter 주입, `abortController.signal`→`abortSignal`, fire 지점 보존). main.mjs는 얇은 호출부만 남김 + 이 함수 전용이 된 dead import 4종 제거 → **3097→2996(−101줄)**(ADR 0002 방향). 신규 `tests/qa-pipeline.test.mjs` **6건**: graph OFF(multi-query 호출·graph 미호출), graph ON(graphing 방출·graph 호출), no-data(assistant insert + emitComplete, 스트리밍 미진입), abort(RAG 직후 fire→AbortError·미persist), out-of-scope(폴더 교집합이 스코프 제한), source attribution(실 formatSourceAttribution로 `referenced_paper_ids`·`source_evidence_locations` metadata 고정). `node --check` 3파일 + `node --test` **129/129**(기존 123 + QA 6, 회귀 0). frontend·DB·IPC·`CURRENT_EXTRACTION_VERSION` 무변경. B-M3(QA 테스트 0) 해소, 05의 전제 충족. 계획 대비: 순수 헬퍼 import 기본값 노출·dead import 정리·attribution 테스트 실함수 사용. 구현·검증 완료(2026-07-03, developer). 커밋 대기.
- `completed/02_2026-07-03_value-backmatch-guardian-narrowing.md` — Phase 2 슬라이스 02: **값 역매칭 검증기 + Guardian 좁히기**(8항목). Stage 4를 결정적으로: cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 코드 역매칭(정규화 완전일치, 스코프 source_hinted>any_matrix>none)→"code-verified", `scope==="none"`만 Guardian에 MeasHalu 유형별(unit/condition/value_fabrication) 좁은 claim. 신규 `chat/value-backmatch.mjs`(`normalizeNumericValue`/`buildMatrixValueIndex`/`backMatchCell`/`extractTableToken`/`pickCheckType`/`buildNarrowGuardianClaim`) + `table-pipeline.mjs`에 export한 순수 `runCodeBackMatchPass`. `CellVerification`에 `method`/`checkType`/`scope`(선택, 하위호환) + 프론트 배지 툴팁("코드 대조 N / Guardian M")·셀 hover 검증주체. `scripts/e2e-table-fidelity.mjs`에 검증주체 분포 리포트. **결정성 실증**: 매트릭스 값→Guardian mock 미호출·code-verified, 미매치값→Guardian 호출을 단위 테스트로 고정. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경(verification JSONB 필드 부가). `node --test` **123/123**(신규 value-backmatch 22 + 파이프라인 1, 회귀 0) + frontend tsc(any 0)+build. 계획 대비: 코드 패스를 export 함수로 분리(테스트 용이), identity claim이 값 열 제외(정밀화), eval 배선 추가. 구현·검증 완료(2026-07-03, developer). 13분 실 LLM after 측정은 오케스트레이터 별도. 커밋 대기.
- `completed/01_2026-07-03_phase1-cell-tuple-schema.md` — Phase 1 전체(8항목: 열 의미 타입·셀 튜플·조건 충돌 감지·셀 밸리데이터·흡착 도메인 사전·A-R6 청크0 경고·프론트 타입/렌더·테스트). 구현·단위검증 완료(2026-07-03). E2E 원문 대조 재실증 대기.
- `completed/03_2026-07-03_golden-fixture-fidelity-eval.md` — Phase 2 슬라이스 03: 골든 픽스처 + `table_fidelity` eval(7항목). 원문 PDF 재추출로 논문 2편 Table 3/4 정답 43셀 확정(`adsorption-groundtruth-v0.json`, `table-fidelity-v0`) + `eval-runner.mjs`에 `evaluateTableFidelityCase`/`evaluateTableFidelityFixture`(fidelity·misattribution[D1]·fabrication[D2/D4]·conflictHandling 4축 비이진 리포트) + `scripts/pdf-page-text.mjs`·`scripts/e2e-table-fidelity.mjs` 승격(수동·CI-off) + 결정적 단위테스트 10건. 프로덕션/DB/IPC/추출 무변경. `node --test` 100/100. 구현·검증 완료(2026-07-03, developer). 13분 실 LLM baseline은 오케스트레이터 별도. 커밋 대기.

## Last Updated

2026-07-03 — Phase 2 슬라이스 06 구현 완료(fixer): **부속 2건**. (A) RAG 튜닝 상수 `rag/config.mjs` 통합(B-M2, 무동작 리팩터) — 산재한 매직넘버(RRF 가중·match_threshold/count·section_boost·TABLE_BOOST·RERANKER_TOPK·RRF_RESULT_LIMIT·GRAPH_TOP_K·graph 가중)를 신규 단일 모듈 named export 12종으로 수렴, `multi-query-rag.mjs`·`graph-search.mjs`를 config import로 치환. **값 100% 동일·호출 형태 무변경**. [가정 A] `table-extraction.mjs` 컨텍스트 예산은 프롬프트 예산이라 미이동. (B) A-R6 경고 UI fix — `ProcessingView.tsx` `JobCard`에 `status==="succeeded" && error_message` 분기 추가(chunkCount0 경고 렌더), failed danger와 구분되는 `--color-warning` caution 톤(기존 토큰 재사용). `paperSignals.ts`·백엔드 무변경. `node --test` **140/140 회귀**(값 무변경) + frontend tsc(any 0)+build+vitest 32/32. 슬라이스→completed/06. harness: `rag-pipeline.md`(상수 위치를 config.mjs로 정정·함수 위치 04 반영)·`paper.md`(ProcessingView succeeded 경고 배너)·`feature-status.md`(Phase 2 행 06 ✅ + Phase 2 완료)·`VERSION.md`(v1.22). **Next Action=`/test`→`/review`→PR→Phase 3.** **Phase 2 전체 완료.** 커밋은 사용자.

2026-07-03 — Phase 2 슬라이스 05 구현 완료(fixer): **QA 인용 결정적 검증**(좁게). 04로 분리된 `chat/qa-pipeline.mjs`에 국소로 얹음. refNo 결정 순서(`orderPaperMetadataDeterministic`, B-D3 — chunks/figures 첫 등장 순위 + paperId 사전순, 입력 불변, paperMetadata 로드 직후 적용해 refList·귀속·persist 공유) + `[N]` 인용 코드 검증(`checkQaCitations` — 범위·존재·paperId 정합, LLM 없음, 중복 1회) + `metadata.citationCheck` 기록(기록-only, 답변 무변경). `types/chat.ts`에 `QaCitationCheck` 타입(any 0). **LLM groundedness 명시 제외.** DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. `node --test` **140/140**(기존 129 + 신규 11: order 5·check 5·pipeline 1) + frontend tsc(any 0)+build. 슬라이스→completed/05. harness: `llm.md`(qa-pipeline 인용 검증 섹션·v1.21)·`feature-status.md`(Q&A 행 보강·v1.21)·`VERSION.md`(v1.21). **Next Action=슬라이스 06(RAG config + A-R6 UI, 마지막).** 커밋은 사용자.

2026-07-03 — Phase 2 슬라이스 04 구현 완료(developer): **QA 파이프라인 분리(동작 보존)**. `handleQaPipeline`(~116줄)→`chat/qa-pipeline.mjs`의 `runQaConversationPipeline`(table-pipeline 동일 DI, 전역 참조 전부 인자화). 이벤트/persist/metadata 동작 무변경, emitter·abortSignal 주입으로 통일. main.mjs **3097→2996(−101줄, dead import 4종 정리 포함)**. 신규 `tests/qa-pipeline.test.mjs` 6건(graph on/off·no-data·abort·out-of-scope·attribution). `node --test` **129/129**(기존 123 + QA 6). frontend·DB·IPC·`CURRENT_EXTRACTION_VERSION` 무변경. 슬라이스→completed/04. harness: `chat-table-pipeline-state.md`(Owner를 qa-pipeline.mjs로)·`llm.md`(qa-pipeline 모듈 행)·`main-process.md`(handleQaPipeline 제거)·`feature-status.md`(Phase 2 행 04 ✅ + 02 stale 정정)·`VERSION.md`(v1.20). **Next Action=슬라이스 05(QA 인용 검증, 06 병행 가능).** 커밋은 사용자.

2026-07-03 — Phase 2 슬라이스 02 구현 완료(developer): 값 역매칭 검증기 + Guardian 좁히기. Stage 4를 결정적으로 — cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 코드 역매칭(정규화 완전일치)→code-verified, 실패분만 MeasHalu 유형별 좁은 claim으로 Guardian. 신규 `chat/value-backmatch.mjs` + export `runCodeBackMatchPass`(단위 테스트 결정성 실증). `CellVerification`에 method/checkType/scope + 프론트 배지/hover 검증주체 + e2e 스크립트 분포 리포트. `node --test` **123/123**(신규 value-backmatch 22 + 파이프라인 1) + frontend tsc(any 0)+build. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. 슬라이스→completed/02. harness: `llm.md`(Stage 4 2단계 계약)·`chat-table-pipeline-state.md`(Stage 4 행)·`feature-status.md`·`flows.md`(Stage 4)·`VERSION.md`(v1.20). **Next Action=슬라이스 04(QA 파이프라인 분리).** 02 after 측정(실 LLM E2E)은 오케스트레이터 별도. 커밋은 사용자.
