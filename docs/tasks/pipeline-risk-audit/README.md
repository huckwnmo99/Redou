# Pipeline Risk Audit — 핵심 파이프라인 위험 감사

## Purpose

Redou 핵심 파이프라인(PDF 임포트→추출→임베딩→RAG 검색→채팅/테이블)에서 **문제 소지가 있는 부분을 찾아 기록**하는 감사 ledger. 발견을 근거(`파일:줄`)와 함께 정리해, 이후 개별 fix/develop으로 승격할 후보 풀로 쓴다.

이 감사는 **분석·문서화 전용** — 코드는 아무것도 수정하지 않았다.

## Current Status

- Status: 감사 완료 + **A-R1·A-R2·B-R1(P0) 수정 완료** (2026-07-03). 남은 P0 1건 A-D1/B-D1은 **보류(기록만)** — 다계정/동기화 착수 전 필수.
- 발견 총 **28건** — 파트 A(PDF→임베딩) 15건 + 파트 B(RAG→채팅) 13건
- 심각도: **P0 4건** (중복 1건 병합 시 실질 4건), P1 12건, P2 12건
- 방식: planner 2명 병렬 감사 → 발견 문서 2개 → 이 README가 종합 → 선택 항목 개별 slice로 승격·수정

## Next Action

**P0 3건(A-R1·A-R2·B-R1)은 `/test`(65건 통과)·`/review`(PASS) 완료 → PR #3 (https://github.com/huckwnmo99/Redou/pull/3) merge 대기 — 사용자 판단.**

**A-D1/B-D1(RLS 무스코프)은 보류 — 기록만.** 현재 로컬 1인 사용이라 실피해 없음. **다계정·동기화·클라우드 착수 시점에 반드시 `/develop`으로 처리**(`db:query`/`db:mutate`에 인증+owner 스코프 강제 = 앱 전역 영향, 대규모·회귀 위험). 그 외 승격 후보는 P1(A-R4 임베딩 타임아웃, B-R4 chunks 쏠림, A-D2 figure_no 충돌, B-D2 QA Guardian 등).

## 우선순위 요약 (P0 / 상위 P1)

| ID | 심각도 | 위치 | 요지 |
|----|--------|------|------|
| **A-D1 / B-D1** ⏸ | P0 (보류) | `main.mjs:1776,1808` · `graph-search.mjs:79,119` | service_role RLS 우회 + `db:query/mutate` 무인증·무스코프. **다계정 전 필수, 지금은 기록만**(로컬 1인이라 실피해 없음). |
| ~~**A-R1**~~ ✅ | P0 | `embedding-worker.mjs:82` | ~~청크 임베딩 `Promise.all` 배치 실패~~ → **allSettled 격리 + 성공분만 저장으로 수정 완료** |
| ~~**A-R2**~~ ✅ | P0 | `main.mjs:587` | ~~`persistV2Results` delete→insert 비트랜잭션~~ → **지연 삭제로 수정 완료**(old-id 보관 후 전 insert 성공 시점에 삭제) |
| ~~**B-R1**~~ ✅ | P0 | `main.mjs:2684,2768` | ~~같은 conversationId 동시 전송 시 abort 컨트롤러 덮어쓰기~~ → **in-flight 거부 가드 + finally identity guard로 수정 완료** |
| A-R4 | P1 | `embedding-worker.mjs:38` | vLLM 임베딩 호출 타임아웃 부재 → hang 시 임베딩 파이프라인 전체 정지 |
| B-R4 | P1 | `table-pipeline.mjs:465` | per-paper chunks 쏠림 → 특정 논문 0 chars → 데이터 있어도 N/A (fix 19 P1 미구현, 실재) |
| A-D2 | P1 | `mineru-client.mjs:404,440` | `figure_no` 충돌 시 그림/테이블 이미지 상호 덮어쓰기 |
| B-D2 | P1 | `main.mjs:2558-2582` | QA 답변 인용에 Guardian 검증 전무 (table엔 있음) |
| A-M2 / B-M3 | P1 | `tests/` | 추출·임베딩·QA 경로 단위 테스트 공백 |

전체 발견·나머지 P1/P2는 아래 두 문서 참조.

## Success Criteria

- 모든 발견이 `파일:줄` + 재현 시나리오 + 근거를 갖는다 (일반론 배제). ✅
- 기존 테스트가 이미 커버하는 항목은 제외한다. ✅
- 감사는 코드를 수정하지 않는다. ✅
- 수정 승격은 사용자 승인 후 개별 ledger/slice로 분리한다.

## Documents To Read

- `completed/01_2026-07-02_pdf-embedding-audit.md` — 파트 A (PDF 임포트→추출→임베딩) 15건.
- `completed/02_2026-07-02_rag-chat-audit.md` — 파트 B (RAG 검색→채팅/테이블) 13건.

## E2E 실증 (2026-07-03, 헤드리스 실구동)

`runTableConversationPipeline`을 실 DB+실 Ollama(gemma4:31b)+실 vLLM으로 UI 없이 직접 구동(main.mjs 배선 복제, `.tmp_e2e-table.mjs`). 논문 2편 스코프, 실사용 쿼리("흡착제/q_max/온도 비교표").

- **성공**: 13.1분 완주. orchestrator 스펙 6열 → RAG(RRF+rerank) → OCR 테이블 15개 파싱 → per-paper 추출 2/2 성공(83+29행) → 병합 79행 → Stage 3d NULL 회복 2셀 → persist. 표 `44ac02a6`(대화 `a8f32c19`, 보존됨 — 앱에서 확인 가능). source_refs에 DOI·저자·페이지 근거 정상.
- **fix 20 실증**: per-paper 추출 209s/165s — 구 60s 하드코딩이면 둘 다 타임아웃(원 버그 재현 조건: gemma4:31b)이었을 것. env 기본 240s로 성공.
- **신규 관찰 (P2 후보)**: ①마지막 행에 LLM 파편 셀 유입(`" uma T (K) : \"308.15\", "` — cleanCellValue가 못 거름, B-R3 계열 LLM 출력 정화 이슈) ②79행 = 전 등온선 데이터점 추출(요약 아님 — 모델 행동 관찰, gemma). Guardian 검증은 시작됐으나 테스트 스크립트 조기 종료로 미완(스크립트 사유, 앱에선 정상 완료 흐름 — verification=null 잔존).

### 원문 대조 검증 (2026-07-03, 실제 PDF 페이지 텍스트와 셀 단위 대조)

- **수치 충실도: 탁월 (조작 0건)**. 논문2 Table 2(p.4) 등온선 21+개 점(552.91→3.4300 등) 원문과 **자릿수까지 전부 일치**(원문 "2.543" 표기까지 보존). 논문1 Table 3(p.8, ≤1000 kPa) KACa CO₂ q_m 8.69/8.07/7.39 ✓, Table 4(p.8, ≤100 kPa 저압) CO₂ 4.45·N₂ 2.56/2.49 ✓. 검증 범위에서 지어낸 수치 없음.
- **의미 매핑 결함 4건 (신규 P1~P2 후보)**:
  1. **파라미터 세트 혼입**: Table 3(전범위)·Table 4(저압) Langmuir q_m이 구분 열 없이 혼재 → (KACa,CO₂,293K,Langmuir)에 8.69와 4.45가 공존, 압력범위 맥락 소실. 사용자는 어느 값이 뭔지 알 수 없음.
  2. **q_max 의미 오류**: 논문2에서 "q_max" 열에 압력별 평형 흡착량 q(P)를 채움(~50행) — 포화 용량 아님. 논문2의 진짜 파라미터(Table 4 DSL/Sips)는 미추출.
  3. **Stage 3d 오귀속**: NULL recovery가 실험 데이터 행 2개에 DSL/Sips 모델 라벨을 채움 — 실험점엔 model이 없음(그럴듯하지만 부정확한 채움).
  4. garbage cell(위 ①)로 KACa CH₄ 308.15K의 실값 5.05 소실 + 인접 행 Adsorbent 라벨 1건 누락.
- 시사점: 추출은 "숫자"를 정확히 옮기나 "무엇의 숫자인지"(표 맥락·컬럼 정의)를 구분 못함 → 컬럼 스펙에 조건 열(압력범위 등) 유도 또는 표 캡션 컨텍스트 강화가 개선 방향.

## 알려진 항목 재검증 결과 (감사 부산물)

- **fix 17** (`getEntityGraphEnabled` throw → QA 붕괴): **이미 해결됨** (`main.mjs:530-535` graceful degrade). → `feature-status.md`의 "📋 계획됨"이 **stale**. harness 갱신 대상.
- **fix 19 P1** (chunks 쏠림): **실재** → B-R4로 특정.
- **"chat Supabase null 처리"**: 백엔드 실체 = B-R3 (`persistTableReport` 무검증 insert).

## Planned

- (없음 — 수정 항목은 사용자 선택 후 개별 승격)

## In Progress

- (없음)

## Completed

- 파트 A 감사 — `completed/01_2026-07-02_pdf-embedding-audit.md`
- 파트 B 감사 — `completed/02_2026-07-02_rag-chat-audit.md`
- **A-R1 (P0) 수정** — `completed/03_2026-07-02_ar1-embedding-batch-resilience.md` (2026-07-03). 청크 임베딩 배치 `Promise.allSettled` 격리 + 성공분만 upsert + 부분 실패 정책. 2파일 수정(`embedding-worker.mjs`, `main.mjs`) + 단위 테스트 신설. `chunksToEmbed` 미임베딩분만 선별 [가정] 코드로 검증됨.
- **A-R2 (P0) 수정** — `completed/04_2026-07-03_ar2-persist-deferred-delete.md` (2026-07-03). `persistV2Results` 맨 앞 3개 delete 제거 → old-id 지연 삭제(모든 insert·링크 성공 후 삭제). `figure_chunk_links`가 old figure를 참조하지 않도록 tables/equations insert에 `.select` 추가. 1파일 수정(`main.mjs`). CASCADE [가정] 성립 확인(chunk_embeddings/figure_chunk_links ON DELETE CASCADE, figure 임베딩은 컬럼). 단위 테스트는 supabase 강결합·미export로 미추가 → 수동 검증 절차 문서화.
- **B-R1 (P0) 수정** — `completed/05_2026-07-03_br1-concurrent-chat-abort-registry.md` (2026-07-03). 같은 conversationId 동시 `CHAT_SEND_MESSAGE` abort 레지스트리 붕괴 수정. 1파일(`main.mjs`, CHAT_SEND_MESSAGE 범위) 4지점: abort 컨트롤러 변수 상단 호이스팅 + **in-flight 가드**(convId 확정 직후·user insert 전 `has(convId)`면 DB·이벤트 없이 직접 return, 기존 에러 반환 형태 `{conversationId,error}` 일치) + **finally identity guard**(`get(convId)===abortController`일 때만 delete) + CHAT_ABORT 무변경(조합 안전 교차확인). DB/IPC/frontend/`CURRENT_EXTRACTION_VERSION` 무변경. 핸들러 미export·supabase 강결합으로 단위 테스트 미추가 → 수동 검증 3절차 문서화. `node --check` 통과 · 회귀 65건 전부 통과.

## Last Updated

2026-07-03 — P0 3건 /test(65건)·/review(PASS) 통과, PR #3 생성(merge 대기). A-D1/B-D1은 보류(다계정 전 필수) 확정.
