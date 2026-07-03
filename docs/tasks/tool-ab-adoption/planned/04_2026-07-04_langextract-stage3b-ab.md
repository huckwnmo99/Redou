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

## 작업 분해

1. [ ] **LangExtract 사이드카** (최소)
   - `Dockerfile.langextract`: python base + `pip install langextract`. 모델 무동봉이라 build 가벼움. Ollama를 백엔드로 지정(host.docker.internal:11434 또는 네트워크 공유).
   - `langextract-server.py`: FastAPI. `POST /extract`(본문: 텍스트/청크 + few-shot 스키마 + attributes) → `{ extractions: [{value, unit, condition, char_offset, ...}] }`. `/health`.
   - compose 항목(포트 8012). A/B 기간 임시 서비스.
   - [실사] LangExtract의 Ollama 연동 방식(base_url·model 지정) + 청킹/멀티패스 옵션.

2. [ ] **스키마 정의 (A/B용 최소)**
   - 물성+조건 스키마 few-shot: `{property, value, unit, condition(qualifier), source_span}`. 흡착 도메인(NIST AIF 필드, `chat/adsorption-domain.mjs` 참조)으로 예시 구성 — 기존 도메인 사전과 정합.
   - 이 스키마가 D1(qualifier)·D2(파라미터vs데이터점)를 추출 시점에 강제하는지 관찰.

3. [ ] **A/B 대조 하네스** (`apps/desktop/scripts/ab-langextract.mjs`, 수동·CI-off)
   - 동일 논문 5편·동일 쿼리로 (a) 현 Stage 3b(`runPerPaperExtraction`/SRAG) vs (b) LangExtract `/extract`.
   - 두 결과를 각각 표로 합쳐 `table_fidelity`(`e2e-table-fidelity.mjs` 로직, 동일 fixture·동일 LLM)로 점수화.
   - **특히 grounding 축 관찰**: LangExtract의 char_offset가 셀→원문 하이라이트로 얼마나 정확·활용 가능한지(D3 provenance 이득 정량화). 현 파이프라인은 source_hint 문자열(셀 튜플, 슬라이스 02 of table-semantics)뿐 — offset 정밀도 비교.

4. [ ] **A/B 리포트 → 게이트 판정**
   - 현 Stage 3b vs LangExtract: fidelity + misattribution(D1) + fabrication(D2/D4) + **grounding 활용성**. 승/패 + 근거.
   - 판정 기준(사전): LangExtract가 fidelity 비열세 + grounding(char-offset)이 실제 하이라이트로 유용 → 05 진행. 아니면 보류(현 SRAG + 셀 튜플 유지).
   - `completed/04` 기록 + README 갱신.

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
