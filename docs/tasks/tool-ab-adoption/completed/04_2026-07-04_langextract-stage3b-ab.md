# 슬라이스 04: LangExtract Stage 3b A/B (독립)

> 유형: 대규모 (develop) — Python 사이드카(최소) + A/B 하네스. **프로덕션 파이프라인 무변경**(측정 전용).
> 상태: 계획 | 의존: 슬라이스 01(동일 기준선 LLM). **02·03과 독립 — 병행 가능.** | 작성일: 2026-07-04

## 목적

- **무엇을**: LangExtract(Google, Apache-2.0, v1.6.0, ~150KB wheel·모델 무동봉·Ollama 백엔드)를 **Stage 3b 대안 추출기**로 띄우고, 동일 논문·쿼리로 기존 추출(현 SRAG per-paper) vs LangExtract 추출을 대조한다.
- **왜**: backlog/17 경로 B — provenance(D3)는 사후 보존보다 **추출 시점에 문자 오프셋 grounding**으로 만드는 게 강건. LangExtract는 추출물마다 원문 char-offset을 부여 → 셀→원문 하이라이트가 공짜. 채택 전 **측정**(A/B 게이트).
- **범위**: 최소 사이드카 + Stage 3b 대안 경로 A/B 리포트. **프로덕션 채팅/추출 경로 무변경**.
- **제외**: 채택 구현(05), 스키마 강제 정밀 설계(A/B에서 유효성 확인 후 05에서).

## 왜 02·03과 독립인가

- docling은 **파싱(3a)** 도구, LangExtract는 **추출(3b)** 도구 — 파이프라인 단계가 다르다. 서로의 산출을 침범하지 않는다.
- 단, **A/B 기준선 LLM은 동일**(gemma4:31b) 해야 공정 → 슬라이스 01(3.4 기준선 확정) 이후 착수. 02·03의 진행/결과와 무관하게 병행 가능.

## 선례 (실사 확인)

- Python FastAPI 사이드카 = `apps/ocr-server/` 패턴(02와 동일 근거). LangExtract는 모델 무동봉이라 이미지가 가벼움(docling보다 유리) — `pip install langextract` + Ollama 백엔드 지정.
- Ollama는 이미 11434에서 상시(external.md) → LangExtract가 기존 로컬 LLM 스택 그대로 사용(신규 모델 다운로드 0).
- 포트: 신규(예: 8012), `REDOU_LANGEXTRACT_URL`.

## Phase 진행

- **Phase A 완료 (2026-07-06, developer)** — 빌드 비의존 구현(정의 파일·클라이언트·A/B 스크립트·테스트). docker build/run·실 LLM A/B는 **Phase B(오케스트레이터)**.
- **Phase B (오케스트레이터, 남음)**: `docker compose -f apps/langextract-server/compose.langextract.yaml build langextract` → `up -d` → health 200 확인 → `node apps/desktop/scripts/ab-langextract.mjs`(RUNS 없음, 단발; 기준선 skip 시 `REDOU_AB_SKIP_BASELINE=1`) → 게이트 verdict 판독 → `completed/04` 기록.

## 작업 분해

1. [x] **LangExtract 사이드카** (최소) — `apps/langextract-server/`
   - `Dockerfile.langextract`: **python:3.11-slim**(docling/ocr-server와 달리 **CUDA·torch 불필요** — LangExtract 모델 무동봉, 원격 Ollama 호출) + `pip install langextract`. build 수초.
   - `langextract-server.py`: FastAPI. `POST /extract`(본문: `text` + `prompt_description` + few-shot `examples[]` + `model_id?`) → `{ extractions:[{property,value,unit,condition,extraction_class,extraction_text,char_start,char_end,alignment_status,...}], grounded_extractions, ... }`. `/health`(langextract 버전·Ollama URL·import 오류). **1.x API 드리프트 방어**(`model_url`↔`base_url` 순차 시도, `char_interval.start_pos/.end_pos`↔`char_start/.end` getattr, ExampleData/Extraction 빌드) — docling-server 선례.
   - `compose.langextract.yaml`: **포트 8012**, 기존 compose 무침범. **GPU 예약 없음**(모델은 상시 Ollama에서 실행). `host.docker.internal:11434`(env `REDOU_LANGEXTRACT_OLLAMA_URL`) + `extra_hosts: host-gateway`(Linux 정합) + `REDOU_LANGEXTRACT_MODEL=gemma4:31b`(01 기준선 LLM 동일).
   - [실사 반영] LangExtract Ollama 연동 = `lx.extract(model_id=..., model_url=<ollama>, fence_output=False, use_schema_constraints=False)`. 청킹 = `max_char_buffer`(기본 6000), 멀티패스 = `extraction_passes`(기본 1) — 요청 본문으로 노출. **패키지 미설치 환경이라 라이브 확인은 Phase B**; import·kwarg 실패는 방어(getattr/try-except + `/health` import_error 보고).

2. [x] **스키마 정의 (A/B용 최소)** — `electron/langextract-client.mjs`의 `ADSORPTION_PROMPT_DESCRIPTION`·`ADSORPTION_EXAMPLES`
   - 물성+조건 few-shot `{property, value, unit, condition}`(각 추출물에 char offset은 서버가 부여). 흡착 도메인(NIST AIF: q_m/K_L/K_F/n/Henry/ΔH/MAPE, 조건=흡착제·가스·온도·**압력범위**)과 정합 — `adsorption-domain.mjs` 필드 미러. fixture의 `{identity, column, value, condition}` 모양에 맞춰 A/B가 fidelity 스코어러에 그대로 접합 가능.
   - D1(qualifier=condition) 강제: 프롬프트가 압력범위(`<=1000 kPa` vs `<=100 kPa`, `~600` vs `~100`)를 condition에 필수 기입하도록 지시. 같은 q_m을 **다른 조건 두 값**으로 예시 → 추출 시점 조건 분리를 학습. (A/B에서 유효성 관찰.)

3. [x] **A/B 대조 하네스** (`apps/desktop/scripts/ab-langextract.mjs`, 수동·CI-off)
   - 동일 논문(fixture 2편 기본, `REDOU_E2E_PAPER_IDS`로 5편 확장)·동일 쿼리로 (a) 현 Stage 3b(`runTableConversationPipeline` = **e2e-table-fidelity 실 파이프라인 그대로**, SRAG) vs (b) LangExtract `/extract`(paper_chunks + OCR 표 HTML → 추출).
   - 두 결과 모두 `evaluateTableFidelityFixture`(동일 fixture·동일 LLM·**동일 metric 스코프**)로 점수화. **갱신 기준 반영**: `REDOU_E2E_METRIC` 기본 **capacity**(88.6% in-scope 기준선과 동일 스코프) — `GRADING_OPTIONS`를 양쪽에 동일 적용해 공정. `REDOU_AB_SKIP_BASELINE=1`이면 (a) 생략하고 기록 기준선(0.886, `REDOU_AB_BASELINE_FIDELITY`) 사용.
   - (b) LangExtract 추출을 `foldExtractionsIntoTable`로 표(headers/rows/cellTuples)로 접합 — condition을 식별 열 + 값 셀 튜플에 넣어 스코어러의 identity·rowCarriesCondition 계약 충족(실 fixture로 fold 검증: perfect 3추출 → 3매치·misattr 0·fab 0).
   - **grounding 축(D3, 결정 축)**: `buildChunkSpans`+`mapOffsetToChunk`로 char_offset를 Redou 청크(startCharOffset 좌표)로 역매핑 — offset 보유율·청크 적중률 측정. 현 파이프라인은 source_hint 문자열뿐(구조상 offset 0) — 리포트에 명시.

4. [x] **A/B 리포트 → 게이트 판정** — `ab-langextract.mjs` 말미
   - 현 Stage 3b vs LangExtract: fidelity + misattribution(D1) + fabrication(D2/D4) + **grounding 활용성**. verdict 출력.
   - 판정 기준(사전, 코드 고정): (1) fidelity 비열세(≥ 기준선 − 5%p, 런 변동대) **AND** (2) grounding 유용(offset 보유 + offset의 ≥50%가 청크 매핑) → PASS(05 진행). 아니면 HOLD(현 SRAG + 셀 튜플). **실행·최종 판정 기록은 Phase B(오케스트레이터) → `completed/04`.**

## 영향 범위

- 신규: LangExtract 사이드카(docker), `langextract-client.mjs`(측정 전용), `ab-langextract.mjs`(스크립트). compose 1개.
- **무변경**: `main.mjs`·`chat/table-pipeline.mjs`·`chat/table-extraction.mjs`·DB·IPC·Frontend·`CURRENT_EXTRACTION_VERSION`. (측정 슬라이스.)

## 검증 방법

- LangExtract 사이드카 health 200 + 청크 1개 `/extract` 성공(char_offset 포함 반환).
- `node --check` client + script.
- 5편 양쪽 추출 완주 + fidelity + grounding 리포트로 A/B 산출.
- 게이트 판정 기록. **프로덕션 회귀 없음**(추출 경로 무변경 → 140/140 불변).

## 가정 사항

- **[가정]** LangExtract가 Ollama 백엔드로 로컬 LLM(gemma4:31b 등)을 안정 구동 — 실측 검증. 안 되면 A/B 공정성(동일 모델) 확보 위해 대안 모델 지정 필요.
- **[가정]** char_offset를 Redou 청크 좌표계(startCharOffset 기반, `mineru-client.mjs` buildChunks)로 매핑 가능 — 하이라이트 활용성의 전제.
- **[리스크]** A/B 공정성: 동일 논문 5편·동일 fixture·동일 LLM. 추출기만 교체, 파싱(MinerU 3.4)·병합·검증 하류 고정.
- **[리스크]** LangExtract few-shot 스키마 품질이 결과를 좌우 → 스키마를 흡착 도메인 사전과 정합시켜 편향 제거.

## Phase B 실측 결과 + 게이트 판정 (오케스트레이터, 2026-07-05/06)

사이드카 기동(8012, langextract 1.6.0, Ollama gemma4:31b) 후:

- **스모크(깨끗한 소형 텍스트)**: 정상 — 값 정확 추출 + `char_start/end` `match_exact` + 조건(qualifier) 풍부 포착("at 293.15 K under pressures up to 1000 kPa"). **grounding·qualifier 역량은 실재 확인**(연구 예측 D3·D1 이득).
- **실 A/B(논문 2편, 76930/70283자, capacity metric)**: 양쪽 실행 **0 추출**(fidelity 0%). 서버 로그: 모든 6000자 청크가 JSON 파싱 실패 — `Unterminated string`(gemma가 JSON 중간 절단) + `char 1 column 2`(코드펜스) + `missing 'extractions' key`(잘못된 모양). `fence_output=False→True` 수정으로도 지배적 에러(절단)는 잔존.
- 진단: gemma-4:31b(Ollama)는 dense OCR 표 청크에서 strict/완결 JSON을 신뢰성 있게 못 만든다. LangExtract(Gemini function-calling·schema-constraint 전제 설계)는 malformed 청크를 통째 스킵 → 0. **grounding 이득은 실재하나 현 로컬 모델로는 도달 불가.**

**VERDICT: HOLD** (채택 슬라이스 05 미착수). 이유는 "LangExtract 열세"가 아니라 **로컬 모델×strict-JSON 미스매치**. 재검토 조건: (a) dense 청크에서 strict JSON을 내는 더 강한 로컬 모델 확보, 또는 (b) provenance(셀→원문 정밀 하이라이트)가 우선순위가 되어 무거운 통합을 감수할 때. 현 incumbent(SRAG + 셀 튜플 source_hint + 코드 역매칭)는 이미 **in-scope 88.6%** 달성, char-offset 없이도 신뢰 축 0.

수정: `langextract-server.py` `fence_output`를 요청 오버라이드 필드(기본 True)로 — 향후 재검토 시 튜닝 가능하게 남김. 사이드카는 A/B 종료로 정지(정의 파일 보존).
