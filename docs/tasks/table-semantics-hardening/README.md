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

- Status: **Phase 1 완료(PR #4 merge) + Phase 2 진행중(슬라이스 02·03 구현 완료)** (2026-07-03). Phase 1은 단위/타입/빌드 전부 통과 + E2E 원문 대조 재실증에서 D1~D4 개선 확인(아래 "E2E 재실증 결과"). **슬라이스 03**(골든 픽스처 + `table_fidelity` eval, `completed/03`)·**슬라이스 02**(값 역매칭 검증기 + Guardian 좁히기, `completed/02`) 구현·검증 완료(developer). 02: cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 **코드 역매칭**→"code-verified"(결정적), 실패분만 Guardian에 MeasHalu 유형별 좁은 질문, verification에 검증 주체(code/guardian) 저장 + 프론트 표시. 신규 `chat/value-backmatch.mjs` + `runCodeBackMatchPass`. `node --test` **123/123**(신규 value-backmatch 22 + 파이프라인 1). 프로덕션 DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. 나머지 04·05·06 계획 상태.
- 규모: Phase 1은 대규모(완료). Phase 2는 슬라이스별 상이 — 02(완료)·03(완료)·04 대규모(develop), 05·06 소규모(fix, 04 이후/독립).

## Next Action

**슬라이스 04(QA 파이프라인 분리, develop) 착수.** 사용자 확정 실행 순서: 03(완료) → 02(완료) → **04(QA 분리) → 05(QA 인용 검증, 04 필수 선행)**, 06(RAG config + A-R6 UI)은 전부와 독립·병행 가능(04와 병행 착수 가능). 03의 fidelity eval + 02의 검증 주체 분포 축이 갖춰졌으므로 이후 추출 프롬프트 개선은 이 eval로 측정하며 진행. 각 슬라이스 완료 시 `/test` → `/review`. **외부 라이브러리 0개 유지.** 02의 after 측정(13분 실 LLM E2E `scripts/e2e-table-fidelity.mjs` — 이제 "code back-match N / Guardian M/T" 분포 리포트)은 오케스트레이터가 별도 수행(baseline 44.2% fidelity·Guardian 31/44 대비).

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
- **Phase 3 (도구 시험, 사용자 채택 확정)**: **로컬 MinerU 3.4 업그레이드 선행**(A/B 기준선) → **docling**(표+bbox provenance ①, 그림 분류·설명 ③, 수식 보강 ④ — 비동기 job, backlog/18) 및 **LangExtract**(Stage 3b 대안 추출기, ~150KB·Ollama 백엔드) 각각 **독립 A/B 후 도입**. ②스캔 OCR 폴백은 MinerU 3.4 확인 후 재평가.
- **장기 보류**: 측정 튜플 저장소 전환(경로 C — 병합 제거), 로컬 모델 파인튜닝(Dagdelen — 지금은 데이터 축적만).

## 사용자 결정 기록

- 셀 튜플은 `chat_generated_tables.metadata`(기존 JSONB)에 저장 — **DB 마이그레이션 없이 진행**(코드 검증으로 확정: metadata 컬럼 존재).
- 흡착 도메인 사전(NIST AIF 필드)은 **범용성을 해치지 않게 도메인 감지 시에만** 적용.
- 표 렌더의 셀 튜플 노출은 **hover 또는 확장** 방식(사용자 표 형태는 유지, 부가 정보만).
- 구현은 Claude 서브에이전트(`developer`)로 — Codex 미사용.

## Planned

Phase 2 슬라이스 5개 (본질: 신뢰를 측정 가능하게 — 검증 결정화 + 자동 측정). 실행 순서 03(완료)→02(완료)→04→05, 06은 병행.

- `planned/04_2026-07-03_qa-pipeline-extraction.md` — **QA 파이프라인 분리** (대규모 develop, 동작 보존). `main.mjs`의 `handleQaPipeline`(~116줄) → `chat/qa-pipeline.mjs`(table-pipeline과 동일 DI). 회귀 테스트 신설(graph on/off·no-data·abort·out-of-scope). ADR 0002 이행 + B-M3(QA 테스트 0) 해소. **동작 무변경이 합격선. 다음 착수(Next Action).**
- `planned/05_2026-07-03_qa-citation-deterministic-check.md` — **QA 인용 결정적 검증** (소규모 fix, 04 필수 선행). [N] 인용의 존재·범위·paperId 정합 코드 체크 + refNo 결정적 순서(B-D3) + metadata 기록. **LLM groundedness 제외**(명시).
- `planned/06_2026-07-03_rag-config-and-ar6-warning-ui.md` — **부속 2건** (소규모 fix, 독립·병행). (A) RAG 튜닝 상수 `rag/config.mjs` 통합(B-M2, 무동작 리팩터) (B) A-R6 경고 UI fix — succeeded job의 error_message를 `ProcessingView.tsx:256`이 렌더 안 하는 문제(조건 확장으로 경고 표시).

## In Progress

- (없음)

## Completed

- `completed/02_2026-07-03_value-backmatch-guardian-narrowing.md` — Phase 2 슬라이스 02: **값 역매칭 검증기 + Guardian 좁히기**(8항목). Stage 4를 결정적으로: cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 코드 역매칭(정규화 완전일치, 스코프 source_hinted>any_matrix>none)→"code-verified", `scope==="none"`만 Guardian에 MeasHalu 유형별(unit/condition/value_fabrication) 좁은 claim. 신규 `chat/value-backmatch.mjs`(`normalizeNumericValue`/`buildMatrixValueIndex`/`backMatchCell`/`extractTableToken`/`pickCheckType`/`buildNarrowGuardianClaim`) + `table-pipeline.mjs`에 export한 순수 `runCodeBackMatchPass`. `CellVerification`에 `method`/`checkType`/`scope`(선택, 하위호환) + 프론트 배지 툴팁("코드 대조 N / Guardian M")·셀 hover 검증주체. `scripts/e2e-table-fidelity.mjs`에 검증주체 분포 리포트. **결정성 실증**: 매트릭스 값→Guardian mock 미호출·code-verified, 미매치값→Guardian 호출을 단위 테스트로 고정. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경(verification JSONB 필드 부가). `node --test` **123/123**(신규 value-backmatch 22 + 파이프라인 1, 회귀 0) + frontend tsc(any 0)+build. 계획 대비: 코드 패스를 export 함수로 분리(테스트 용이), identity claim이 값 열 제외(정밀화), eval 배선 추가. 구현·검증 완료(2026-07-03, developer). 13분 실 LLM after 측정은 오케스트레이터 별도. 커밋 대기.
- `completed/01_2026-07-03_phase1-cell-tuple-schema.md` — Phase 1 전체(8항목: 열 의미 타입·셀 튜플·조건 충돌 감지·셀 밸리데이터·흡착 도메인 사전·A-R6 청크0 경고·프론트 타입/렌더·테스트). 구현·단위검증 완료(2026-07-03). E2E 원문 대조 재실증 대기.
- `completed/03_2026-07-03_golden-fixture-fidelity-eval.md` — Phase 2 슬라이스 03: 골든 픽스처 + `table_fidelity` eval(7항목). 원문 PDF 재추출로 논문 2편 Table 3/4 정답 43셀 확정(`adsorption-groundtruth-v0.json`, `table-fidelity-v0`) + `eval-runner.mjs`에 `evaluateTableFidelityCase`/`evaluateTableFidelityFixture`(fidelity·misattribution[D1]·fabrication[D2/D4]·conflictHandling 4축 비이진 리포트) + `scripts/pdf-page-text.mjs`·`scripts/e2e-table-fidelity.mjs` 승격(수동·CI-off) + 결정적 단위테스트 10건. 프로덕션/DB/IPC/추출 무변경. `node --test` 100/100. 구현·검증 완료(2026-07-03, developer). 13분 실 LLM baseline은 오케스트레이터 별도. 커밋 대기.

## Last Updated

2026-07-03 — Phase 2 슬라이스 02 구현 완료(developer): 값 역매칭 검증기 + Guardian 좁히기. Stage 4를 결정적으로 — cellTuples의 source_hint로 Stage 3a 파싱 매트릭스에서 셀 값을 코드 역매칭(정규화 완전일치)→code-verified, 실패분만 MeasHalu 유형별 좁은 claim으로 Guardian. 신규 `chat/value-backmatch.mjs` + export `runCodeBackMatchPass`(단위 테스트 결정성 실증). `CellVerification`에 method/checkType/scope + 프론트 배지/hover 검증주체 + e2e 스크립트 분포 리포트. `node --test` **123/123**(신규 value-backmatch 22 + 파이프라인 1) + frontend tsc(any 0)+build. DB/IPC/`CURRENT_EXTRACTION_VERSION` 무변경. 슬라이스→completed/02. harness: `llm.md`(Stage 4 2단계 계약)·`chat-table-pipeline-state.md`(Stage 4 행)·`feature-status.md`·`flows.md`(Stage 4)·`VERSION.md`(v1.20). **Next Action=슬라이스 04(QA 파이프라인 분리).** 02 after 측정(실 LLM E2E)은 오케스트레이터 별도. 커밋은 사용자.
