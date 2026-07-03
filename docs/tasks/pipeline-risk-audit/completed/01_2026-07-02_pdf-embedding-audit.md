# 파이프라인 위험 감사 A — PDF 임포트→추출→임베딩
> 유형: audit | 작성일: 2026-07-02 | 담당: planner-A

담당 범위: 임포트(파일 복사 + 레코드 생성) → MinerU/GROBID/OCR 추출 → 청킹 → 임베딩 생성·저장 → 처리 큐. RAG 검색·채팅·frontend UI는 파트 B/범위 밖.

## 요약
- 심각도: **P0 3건**, **P1 6건**, **P2 6건** (총 15건)
- 최우선 3건:
  - **A-D1 (P0)**: `db:mutate`/`db:query`가 service_role로 RLS 우회 + 인증·소유자 스코프 전무 — RLS 정책이 사실상 무력. (`main.mjs:1776,1808`)
  - **A-R1 (P0)**: 청크 임베딩이 `Promise.all` 배치 — 청크 1개만 vLLM 오류나도 논문 전체 임베딩 job이 실패. (`embedding-worker.mjs:82`)
  - **A-R2 (P0)**: `persistV2Results`의 delete→insert가 비트랜잭션 — 중간 실패 시 청크/그림/섹션이 부분 삭제·삽입된 채로 남음(재처리로만 복구). (`main.mjs:594`)

---

## 1. 런타임 버그·안정성

### A-R1. 청크 임베딩 배치 전체 실패 (1개 오류 → 논문 전체 실패) — P0, 확신도 높음
- 위치: `embedding-worker.mjs:82` (`generateEmbeddings`), 호출부 `main.mjs:1326`
- 시나리오: 한 청크 텍스트가 vLLM에서 500/토큰초과/일시 오류를 내면 `Promise.all(promises)`이 즉시 reject → `processEmbeddingJob`이 throw → job=failed. 이미 성공한 배치 임베딩은 upsert 전이라 폐기. 그림 임베딩(`main.mjs:1439` for 루프 내 try/catch)은 개별 보호되지만 청크 경로는 무보호.
- 근거: `for` 배치 루프가 `await Promise.all(promises)` 하나로 8개를 묶고, 실패 격리·재시도가 없음. `callVllmSingle`에는 timeout도 없어(아래 A-R4) 부분 실패가 전체를 죽인다.
- 권장 조치: `Promise.allSettled`로 배치를 돌려 성공분만 upsert하고 실패 청크는 스킵/기록(그림 경로와 동일 패턴).

### A-R2. `persistV2Results` 비트랜잭션 delete→insert — P0, 확신도 높음
- 위치: `main.mjs:594-596`, 이하 insert들 `600-812`
- 시나리오: 함수 진입 즉시 해당 source_file의 `paper_chunks`/`figures`/`paper_sections`를 지운 뒤 순차 insert. 섹션 insert 후 figures insert가 throw(예: MinerU HTML 이상, DB 제약)하면, 청크는 지워졌는데 새 청크는 삽입 실패 → 논문이 "섹션·청크 없음" 상태로 남음. `extraction_version` 범프는 함수 끝(`839`)이라 재큐잉으로 복구는 되지만, 그 사이 검색·채팅은 빈 데이터.
- 근거: 세 delete가 트랜잭션·롤백 없이 개별 supabase 호출. 재큐잉 실패(파일 삭제됨 등)면 영구 부분 상태.
- 권장 조치: 재추출 성공 산출물이 확정된 뒤 교체하거나(스테이징→스왑), 최소한 delete를 insert 성공 이후로 미루는 순서 변경. RPC 트랜잭션이 이상적.

### A-R3. 파일 복사와 DB 레코드 생성 사이 크래시 → 고아 PDF — P1, 확신도 높음
- 위치: `main.mjs:1863` (copyFile) → `queries.ts:369-377` (importPdfToLibrary → createImportedPaper)
- 시나리오: `FILE_IMPORT_PDF`는 파일만 복사하고 반환. 이후 프론트가 `createImportedPaper`로 papers/paper_files/job을 insert. 이 두 단계 사이에 앱이 죽으면 라이브러리에 `.pdf`만 남고 DB엔 아무 것도 없음(고아 파일). `createImportedPaper`의 보상 삭제(`supabasePaperRepository.ts:194`)는 함수가 throw할 때만 동작하고 프로세스 사망은 못 잡음.
- 근거: 복사→반환→별도 IPC insert의 2-페이즈 구조. cleanupToken은 있으나 크래시 시 호출자가 없음.
- 권장 조치: 시작 시 Library 스캔으로 DB에 없는 고아 PDF 정리 루틴 추가(선택), 또는 임포트를 단일 IPC로 원자화.

### A-R4. vLLM 임베딩 호출에 타임아웃 없음 → 임베딩 job 무한 대기 — P1, 확신도 높음
- 위치: `embedding-worker.mjs:38-58` (`callVllmSingle`, `fetch`에 signal 없음)
- 시나리오: vLLM이 응답을 멈추거나(모델 로드 중 hang, 네트워크 스톨) 느리면 fetch가 무기한 대기. `embeddingInFlight` 가드가 걸려 있어 이후 모든 임베딩 job이 폴링에서 스킵됨 → 임베딩 파이프라인 전체 정지(사용자는 "처리 중" 무한).
- 근거: 다른 클라이언트(mineru 600s, grobid 120s, ocr 60s)는 `AbortSignal.timeout`을 쓰지만 임베딩 워커만 없음. `isModelLoaded`만 3s timeout.
- 권장 조치: `callVllmSingle`에 `AbortSignal.timeout` 부여 + 상위 job에 전체 데드라인.

### A-R5. 처리 중 앱 종료가 in-flight job 미대기 — P1, 확신도 중간
- 위치: `main.mjs:2311` (`before-quit`은 interval clear만), `resetStaleRunningJobs` `1687`
- 시나리오: `processImportPdfJob`/`processEmbeddingJob` 실행 중 종료하면 job은 `running`으로 남고 진행 중 DB 쓰기가 중단됨. 다음 부팅에서 `resetStaleRunningJobs`가 무조건 `queued`로 되돌려 재실행 → 대체로 안전하나, `persistV2Results` 중단과 겹치면 A-R2의 부분 상태에서 재시작.
- 근거: `before-quit`이 in-flight Promise를 await하지 않음. 크래시가 아닌 정상 종료도 마찬가지.
- 권장 조치: 현 재큐 전략 유지가 현실적. A-R2 해결이 병행되면 위험 소멸. (문서화로도 수용 가능)

### A-R6. 빈 PDF / 섹션 0개 → 임베딩 job 미큐 + "Complete" 오판 여지 — P2, 확신도 중간
- 위치: `mineru-client.mjs:285` (`buildChunks`는 섹션 없으면 0청크), `main.mjs:1157` (chunkCount>0일 때만 임베딩 큐)
- 시나리오: 스캔 이미지 PDF/텍스트 없는 PDF는 MinerU가 섹션·청크 0을 반환 → import job은 succeeded지만 임베딩 job은 생성 안 됨. core 판정(import+embedding)에서 embedding job이 아예 없는 상태의 "Complete" 계산은 파트 B(paperSignals) 확인 필요.
- 근거: `parseSections`가 heading·30자 이상 텍스트가 없으면 빈 배열. 하류에서 청크 0 → 임베딩 스킵.
- 권장 조치: 청크 0 케이스를 사용자에게 "추출 실패/스캔본" 경고로 노출. 판정 로직은 파트 B 교차 확인.

### A-R7. MinerU health check 엔드포인트 불일치 가능 — P2, 확신도 확인필요
- 위치: `mineru-client.mjs:24` (`GET /docs`)
- 시나리오: health가 `/docs`(FastAPI 문서 UI)로 판정. MinerU 컨테이너가 `--no-docs`로 뜨거나 문서 라우트가 없으면 서비스는 살아있는데 미가용 판정 → import 즉시 throw. overview.md는 `/predict`, 코드는 `/docs`, 실제 파싱은 `/file_parse` — 3개가 제각각.
- 근거: 파싱은 `/file_parse`인데 health는 `/docs`. 실제 처리 능력과 health 신호가 다른 라우트.
- 권장 조치: health를 `/file_parse` OPTIONS나 전용 health로 통일. 확인 필요(런타임 컨테이너 라우트).

---

## 2. 아키텍처·유지보수 리스크

### A-M1. `main.mjs`가 ADR 0002 위반 — 임포트/임베딩 도메인 로직 상주 — P1, 확신도 높음
- 위치: `main.mjs` 전반 (3010줄). `processImportPdfJob`(979), `processEmbeddingJob`(1234), `persistV2Results`(587), `processWithMineruGrobid`(904), `enqueueEntityExtractionIfNeeded`(1188) 등.
- 근거: ADR 0002는 이들을 `pipeline/import-processing.mjs`·`pipeline/embedding-processing.mjs`·`pipeline/job-coordinator.mjs`로 분리하라고 명시(`decisions/0002-module-ownership.md:48-50`). 채팅/RAG는 이미 분리됐으나 임포트·임베딩 내부는 여전히 main.mjs. `processing/job-runner.mjs`는 얇은 러너만 추출됨.
- 권장 조치: import/embedding 잡 본체를 `pipeline/*`로 이관(동작 보존 리팩터). 하네스 줄번호 드리프트(문서 3519 vs 실제 3010)도 동반 갱신.

### A-M2. 핵심 추출·임베딩 경로 단위 테스트 공백 — P1, 확신도 높음
- 위치: `apps/desktop/tests/` (14개 중 import/embedding 커버 0)
- 근거: `parseMineruResult`/`persistV2Results`/`processImportPdfJob`/`processEmbeddingJob`/`enhanceEmptyTablesWithOcr`/`generateEmbeddings` 배치 실패를 검증하는 테스트 없음(`grep` 0건). `processing-job-runner.test.mjs`는 제네릭 러너만. golden-path 통합은 seed된 행 기반이라 파싱·영속화 로직 미검증.
- 권장 조치: 최소한 `parseMineruResult`(fixture JSON→구조), `generateEmbeddings` 부분 실패, `persistV2Results` figure_no 충돌에 대한 순수 함수 테스트 추가.

### A-M3. 임베딩 차원 스키마 정의 이력 불일치 — P2, 확신도 높음
- 위치: `20260325010000_pipeline_v2_schema.sql:59,74` (vector(384)+HNSW) vs `20260327010000_upgrade_embeddings_vl_2048.sql:24-27`
- 근거: 초기엔 384-dim + HNSW 인덱스로 만들었다가 2048로 ALTER하며 HNSW를 DROP(2048은 pgvector 인덱스 한계 2000 초과). 신규 환경은 마이그레이션 순차 적용으로 정합되지만, 스키마 이해·리뷰 시 혼선. `chunk_embeddings.embedding`은 초기 `vector`(무차원)로 시작(`initial_schema.sql:125`).
- 권장 조치: 문서(embedding.md)에 "384→1024→2048 이력 + exact search" 명기(일부 있음). 코드 영향 없음.

### A-M4. 설정 상수 하드코딩 + 주석/실값 불일치 — P2, 확신도 중간
- 위치: `embedding-worker.mjs:11` (`VLLM_BASE_URL` 하드코딩 8100, 파일 상단 주석 `1-3`은 "port 8000"), `ocr-extraction.mjs:16` (RENDER_SCALES 경험적 하드코딩)
- 근거: vLLM URL이 env 미노출(다른 서비스는 `REDOU_*_URL` env). 주석은 8000, 상수는 8100, overview.md는 8100. GLM-OCR num_ctx 10240 등도 하드코딩.
- 권장 조치: `VLLM_BASE_URL`을 env화하고 주석 정정(수술적 소규모).

---

## 3. 데이터 정합성·보안

### A-D1. `db:query`/`db:mutate`가 service_role + 무인증·무스코프 — P0, 확신도 높음 (일부 앱-와이드, 파트 B 공유)
- 위치: `main.mjs:1776` (DB_QUERY), `1808` (DB_MUTATE), 클라이언트 `102` (service_role 키)
- 시나리오: 두 핸들러는 화이트리스트 테이블 검사만 하고 호출자 인증/`owner_user_id` 스코프를 전혀 안 함. 필터·match·insert 데이터가 100% 렌더러 제공. service_role은 RLS 우회이므로 마이그레이션의 owner 기반 RLS 정책(`enable_rls_all_tables.sql`)이 이 경로에선 무력. 임의 `owner_user_id`로 insert하거나 필터 없이 전 사용자 행 조회 가능.
- 근거: DB_MUTATE의 insert/update/upsert/delete가 `params.data`/`params.match`를 그대로 supabase에 전달. 로컬 단일 사용자 앱이라 실질 영향은 제한적이나 다중 계정·백업 복원·향후 동기화 시 경계 붕괴.
- 권장 조치: 핸들러에서 `resolveAuthenticatedUserId`로 인증 후 owner 스코프 강제 주입(FILE_DELETE는 이미 인증함 — 일관성 필요). 파트 B와 공동 설계 권장.

### A-D2. `figure_no` 충돌 시 그림/테이블 이미지 상호 덮어쓰기 — P1, 확신도 높음
- 위치: `mineru-client.mjs:404,440` (safeName = figureNo 기반 파일명), 번호 부여 `178,222,261`
- 시나리오: 캡션 없는 테이블 2개는 각각 `Table {counter}`로 유일하지만, 캡션이 같은 번호를 담으면(예: 이어지는 페이지의 "Table 1 (continued)") 두 항목이 동일 `figure_no` → `${safeName}.png` 동일 경로에 두 번째가 첫 번째 이미지를 덮어씀. figures row는 둘 다 insert되므로 한 행이 잘못된 이미지를 참조.
- 근거: 파일명이 `figureNo.replace(/[^a-zA-Z0-9]/g,"_")`로만 구성, source 내 유일성 보장 없음. `figure_chunk_links`도 figure_no 아닌 id로 매핑돼 별개.
- 권장 조치: 이미지 파일명에 항목 인덱스/uuid 접미사 부여로 유일화.

### A-D3. 빈 테이블 OCR 보강 트리거가 과도하게 좁음 — P2, 확신도 중간
- 위치: `main.mjs:1110-1141`, 보강 조건 `1117` (`summary_text.is.null,summary_text.eq.`)
- 시나리오: `persistV2Results`에서 테이블은 `summary_text: t.html || t.summaryText`(둘 다 html)로 저장(`720:725`). MinerU가 `table_body`를 조금이라도 반환하면(깨진 HTML이라도) summary_text가 채워져 OCR 보강 대상에서 제외. 즉 "빈"의 정의가 완전 null뿐이라, 내용은 없고 태그만 있는 껍데기 테이블은 미보강.
- 근거: OCR 조건이 텍스트 유무가 아닌 컬럼 null 여부. `flattenTableHtml` 결과 길이 체크 없음.
- 권장 조치: 보강 트리거를 `plainText` 실텍스트 길이 기준으로 보강(선택 개선).

### A-D4. 재큐 시 succeeded/failed job 삭제로 처리 이력 소실 + 잠재 중복 — P2, 확신도 중간
- 위치: `main.mjs:1746-1749` (requeueOutdatedPapers), `2249-2252` (PIPELINE_REQUEUE_ALL)
- 시나리오: 재추출 큐잉 전에 해당 논문의 `succeeded`/`failed` job을 delete → ProcessingView 이력·감사 흔적 소실. 또한 `import_pdf`만 재큐하는데 이전 `generate_embeddings`(succeeded) 레코드도 삭제되므로, 재추출 후 임베딩은 다시 생성되지만 그 사이 임베딩 상태가 비어 "미완료"로 표시. `requeueOutdatedPapers`는 startup에서 매번 도는데 재추출이 계속 실패하면(파일 손상) 부팅마다 재큐 시도.
- 근거: `.delete().in("status",["succeeded","failed"])`가 이력을 물리 삭제. 중복 방지는 queued/running만 확인.
- 권장 조치: 이력 보존이 필요하면 삭제 대신 상태 전이/보관. startup 재큐 실패 루프에 백오프/실패횟수 상한.

### A-D5. job 클레임이 조건부 UPDATE 아님(TOCTOU) — P2, 확신도 중간
- 위치: `main.mjs:1586-1601` (loadNextJob select → job-runner가 update status=running), `job-runner.mjs:46`
- 시나리오: `loadNextJob`이 queued를 select한 뒤 `updateJobStatus(id,{status:"running"})`를 `WHERE id=` 로만 실행(상태 조건 없음). 단일 프로세스 + `extractionInFlight` 가드로 현재는 안전하나, 두 번째 창/향후 멀티 워커가 생기면 같은 job을 둘이 클레임 가능.
- 근거: 원자적 클레임(`UPDATE ... WHERE status='queued' RETURNING`)이 아님. 인메모리 부울 가드에 의존.
- 권장 조치: 조건부 update(RETURNING)로 원자적 클레임 전환(방어적).

### A-D6. `paper_summaries.is_current` 다중 true 가능 — P2, 확신도 중간
- 위치: `upsertPaperSummaryV2` `main.mjs:877-901`, `ensurePaperSummary` `555`
- 시나리오: `is_current`에 유니크 제약이 없음(초기 스키마 `139-141`). `upsertPaperSummaryV2`는 `is_current=true` 1건을 조회해 갱신/삽입하지만, `ensurePaperSummary`(임포트 초기)와 경합하거나 과거 데이터에 current 2건이 있으면 `.maybeSingle()`가 실패하거나 임의 1건만 갱신 → 두 개의 current summary 잔존.
- 근거: DB 레벨 "논문당 current 1건" 보장 부재. 코드가 조회-갱신으로 관리.
- 권장 조치: `(paper_id) WHERE is_current` 부분 유니크 인덱스 추가 검토.

---

## 범위 밖 메모 (파트 B / frontend)
- **RLS 무력화(A-D1)** 는 채팅/검색 경로(`db:query` 사용) 전반에 해당 — 파트 B와 공동 처리 필요.
- **"Complete" 판정(A-R6 연계)**: `frontend/src/lib/paperRepository/paperSignals.ts`가 embedding job 부재(청크 0) 논문을 어떻게 판정하는지 파트 B/frontend 확인 필요.
- **채팅 컨텍스트 예산**(`OCR_BUDGET`/`TOTAL_BUDGET`, main.mjs:2955 근방) 및 테이블 파이프라인 타임아웃(fix 18~20)은 파트 B 범위.
