# 슬라이스 01: MinerU 2.7.6 → 3.4 업그레이드 + 기준선 재측정

> 유형: 대규모 후보 (develop) — 실 코드 수정은 작을 수 있으나 **DB 재추출 + `CURRENT_EXTRACTION_VERSION` 범프 가능성 + API 계약 검증**이 걸려 있어 신중 경로. 실사 결과 무범프·무수정으로 끝나면 fixer 승격 가능(아래 "규모 재판단" 참조).
> 상태: 계획 | 작성일: 2026-07-04

## 목적

- **무엇을**: 실행 중인 MinerU 이미지를 2.7.6에서 3.4.0으로 올린다.
- **왜**: (1) 3.4는 OCR +11%·속도 2배(PP-OCRv6) — 그 자체로 임포트 품질/속도 이득. (2) **docling·LangExtract A/B의 공정한 기준선**이 되려면 "최신 MinerU"여야 한다(backlog/18 선행 조건 2). 구식 2.7.6과 비교하면 docling이 부당하게 유리/불리해진다.
- **범위**: 이미지 갱신 + API 계약 재검증 + 기존 논문 재추출 + 3.4 기준선 fidelity 재측정 + 스캔 PDF 처리 확인.
- **제외**: docling·LangExtract 도입(02~05). 표 파싱 로직 개선(3.4가 자동으로 주는 것 외 추가 튜닝 없음).

## 확정 사실 (실측, 2026-07-04)

- 실행 컨테이너 `mineru-api`: `pip show mineru` → **Version 2.7.6**.
- API: `GET /openapi.json` paths = `['/file_parse']` 단일. health는 `mineru-client.mjs:24`가 `/docs`로 확인.
- 현재 `/file_parse` form 필드(16개): `files`(required), `output_dir`, `lang_list`(기본 `['ch']`), `backend`(기본 `hybrid-auto-engine`), `parse_method`(기본 `auto`), `formula_enable`(True), `table_enable`(True), `server_url`, `return_md`(True), `return_middle_json`(False), `return_model_output`(False), `return_content_list`(False), `return_images`(False), `response_format_zip`(False), `start_page_id`(0), `end_page_id`(99999).
- **클라이언트가 보내는 8개 필드**(`mineru-client.mjs:44-51`): `files`·`backend="pipeline"`·`lang_list="en"`·`return_md=true`·`return_content_list=true`·`return_images=true`·`formula_enable=true`·`table_enable=true` — **전부 현 API에 존재**. 단, 클라이언트는 `backend="pipeline"`을 명시(현 기본은 `hybrid-auto-engine`).
- `Dockerfile.mineru:17` = `pip install -U 'mineru[core]>=2.7.0'` — **상한 핀 없음**. 빌드 캐시 때문에 2.7.6이 고정된 것. `--no-cache` rebuild = 그 시점 최신(3.4.x) 설치.
- 이미지 크기: `mineru:latest` = 61GB(모델 동봉, build-time `mineru-models-download -s huggingface -m all`).
- compose 3종: `apps/ocr-server/compose.mineru.yaml`(프로필 openai-server[port 30000, vllm-engine]/api[8001]/gradio[7860]) + `apps/ocr-server/docker-compose.yml`(mineru+grobid+ocr-server 통합, `redou-mineru` 이름·8001). **현재 뜬 컨테이너 이름은 `mineru-api`** → compose.mineru.yaml의 `api` 프로필로 기동된 것으로 보임(확인 필요).

## 코드 계약 (건드릴 수 있는 지점)

| 파일 | 계약 | 3.4에서 깨질 수 있는 부분 |
|------|------|--------------------------|
| `apps/desktop/electron/mineru-client.mjs:17` | `REDOU_MINERU_URL` 기본 `http://localhost:8001` | 포트 유지하면 무변경 |
| `mineru-client.mjs:22-29` | health = `GET /docs` ok | 3.4도 FastAPI `/docs` 제공 확인 필요 |
| `mineru-client.mjs:39-83` | `parsePdf` — `/file_parse` POST, 8필드, 응답 `results[key].{md_content,content_list,images}` | **content_list 요소 스키마**(type: text/table/equation/image/discarded, `text_level`·`table_body`·`bbox`·`img_path` 등)가 3.4에서 유지되는가 = 최대 리스크 |
| `mineru-client.mjs:92-103` | `parseMineruResult` — content_list를 sections/tables/equations/figures로 변환 | 위 스키마 의존. 필드명 바뀌면 파싱 깨짐 |
| `main.mjs:944` | `parsePdf(pdfBuffer, { backend: "pipeline", lang: "en" })` | `backend="pipeline"`이 3.4에서 유효한 값인지 |
| `main.mjs:114` | `CURRENT_EXTRACTION_VERSION = 25` | 추출 산출물이 바뀌면 범프(컨벤션) |

## 작업 분해 (구현 순서)

1. [ ] **이미지 갱신 방법 확정**
   - 옵션 A(권장): `Dockerfile.mineru`를 `--no-cache`로 rebuild → 최신 mineru 설치. 재현 가능·리포에 정의됨. 단점: 61GB 빌드 + 모델 재다운로드(수십 분~시간).
   - 옵션 B: MinerU 공식 이미지 pull(있으면). 단점: 리포의 Dockerfile 정의와 괴리(우리 이미지는 vllm-openai base 커스텀). **비권장** — 우리 build가 SSoT.
   - [실사 필요] 3.4를 명시 핀(`mineru[core]==3.4.x` 또는 `>=3.4,<3.5`)으로 `Dockerfile.mineru` 수정할지 결정 — **재현성 위해 핀 권장**(현 `>=2.7.0`은 "언제 rebuild하냐"에 따라 버전이 달라지는 잠복 리스크).
   - [x] 실행 중 컨테이너가 어느 compose로 떴는지 확인(`compose.mineru.yaml` api 프로필 vs `docker-compose.yml`) → 갱신 후 동일 방식으로 재기동. **[A-4 완료]** compose `mineru-api`(api 프로필)로 확정. 재기동 절차는 하단 A-4 참조.

2. [x] **API 계약 재검증** (rebuild 후, 코드 수정 전) — **[B-1 완료]** `verify-mineru-api.mjs` Check 1·2·3 라이브(3.4.2) 전부 PASS. `/file_parse` 존재 + 8필드 수용 + `/docs` 200. backend enum 3.4에서 `["pipeline","vlm-engine","hybrid-engine","vlm-http-client","hybrid-http-client"]`로 생겼으나 `"pipeline"` 유효 → backend 값 무변경. content_list 실측: 신규 타입 6종·필드 7종(하단 Phase B 참조).
   - `curl http://localhost:8001/openapi.json` → `/file_parse` 존재 + 8개 클라이언트 필드 전부 수용 확인.
   - `curl http://localhost:8001/docs` 200 확인(health 계약).
   - **backend 값 검증**: 3.4에서 `backend="pipeline"`이 유효한지. 만약 제거/개명되면 `mineru-client.mjs:45`·`main.mjs:944` 수정(예: `pipeline`→새 값 또는 기본값 위임). [실사] openapi enum 확인.
   - 논문 1편으로 실제 `/file_parse` 호출 → 응답 JSON의 `results[key].content_list` 요소를 덤프해 **스키마 대조**(type·text_level·table_body·image_caption·bbox·img_path 필드명이 `parseMineruResult` 기대와 일치하는지). 불일치 시 파서 수정.

3. [x] **코드 수정 (계약이 깨진 경우에만)** — **[B-2 완료]** 기존 계약(8필드·/file_parse·table_body/table_caption/img_path/image_caption·backend "pipeline")은 전부 PASS. 깨진 것은 없고 **신규 타입/필드가 추가**됨 → `mineru-client.mjs` `parseMineruResult`를 국소 확장(chart→figures, non-ref list→본문, boilerplate 명시 무시). 상세는 하단 Phase B.
   - backend 값·필드명·응답 형태 차이만큼 `mineru-client.mjs` 국소 수정. 깨진 게 없으면 **무수정**.
   - `services/external.md`의 API 오기 정정은 4번(harness)에서. (현 하네스가 `POST /predict`로 잘못 기록 → 실제 `/file_parse`.)

4. [x] **`CURRENT_EXTRACTION_VERSION` 범프 판단** — **[B-3 완료]** 25→**26** 범프(`main.mjs:116`). 3.4 산출물이 실제로 달라짐(chart 편입·list 본문·boilerplate 정리) + A/B 공정성 위해 범프 후 재추출이 옳다는 판단. 기동 시 `requeueOutdatedPapers` 자동 재큐.
   - 판단 기준(CLAUDE.md 컨벤션): "추출 로직 변경 시 범프 → 기존 논문 자동 재처리". 3.4는 **추출 산출물(텍스트·표·수식 품질)이 실제로 달라짐** → **범프 권장**(25→26). 범프하면 `resetStaleRunningJobs`/기동 시 `extraction_version < CURRENT`인 논문이 자동 재큐(`main.mjs:1775-1779`).
   - [가정] 범프 = 기존 5편(+전체 라이브러리) 재추출 트리거. 재추출 비용(논문당 파싱 시간 × 편수, 3.4가 2배속이라 부담 완화)은 리스크에 기재.
   - 범프 안 하는 경우: 3.4 이미지지만 기존 논문은 2.7.6 산출물 유지 → **A/B 기준선이 오염**(일부는 구버전 파싱). A/B 공정성 위해 **범프 후 재추출이 옳다.**

5. [ ] **기존 논문 재추출 + 3.4 기준선 fidelity 재측정** (오케스트레이터 몫)
   - 범프 후 자동 재큐 or 수동 재추출로 논문 5편(최소 e2e fixture 2편: `7536d494…`·`5e0f399d…`)을 3.4로 재처리.
   - `apps/desktop/scripts/e2e-table-fidelity.mjs` 실행(실 LLM, 동일 gemma4:31b·동일 쿼리) → **3.4 기준선 fidelity 기록**. 2.7.6 baseline 44.2%(19/43)와 나란히 표로.
   - 이 수치가 **02·04 A/B의 새 기준선**. table-semantics-hardening README의 baseline 섹션에도 3.4 기준선을 추가(또는 이 ledger가 소유하고 링크).

6. [ ] **스캔 PDF 처리 확인 (backlog/18 ② 재평가 데이터)**
   - 스캔본(텍스트 레이어 없는) PDF 1편을 3.4로 임포트 → 청크 수·표 인식 확인. 3.4 PP-OCRv6가 스캔을 얼마나 살리는지 = ②(docling 스캔 OCR 폴백)이 여전히 필요한지 판단 근거.
   - `parse_method`(auto/txt/ocr) 활용 여지 확인 — 현재 클라이언트는 미전송(기본 auto). 스캔에 `ocr` 강제가 도움되는지 관찰만(구현은 이 슬라이스 밖).

## 규모 재판단 (실사 후 확정)

- **범프 O + 코드 수정 O** → 대규모(`/develop`): DB 재추출 파급 + 계약 수정.
- **범프 O + 코드 무수정** → 경계. 코드 diff는 `Dockerfile.mineru` 1줄(버전 핀) + `main.mjs` 상수 1줄이지만 **재추출 파급**이 있어 develop 권장.
- **범프 X + 코드 무수정** → 소규모(`/fix`): Dockerfile 핀 + harness 정정만. 단 A/B 공정성 위해 범프 권장이므로 이 경우는 드묾.

→ **기본 경로는 `/develop`**(재추출·기준선 재측정 포함). 실사 2번에서 계약이 완전 정합이고 범프를 미루기로 하면 fixer 강등 가능 — 슬라이스 완료 시 확정 기록.

## 영향 범위

- 수정 가능 파일: `apps/ocr-server/Dockerfile.mineru`(버전 핀), `apps/desktop/electron/mineru-client.mjs`(계약 깨진 경우만), `apps/desktop/electron/main.mjs`(범프 + backend 값), compose(재기동 방식 정합 시).
- DB: 범프 시 `papers.extraction_version < 26` 논문 재추출 → `paper_sections`/`paper_chunks`/`figures`/`chunk_embeddings` 재생성(`persistV2Results` 지연 삭제 경로, A-R2). 마이그레이션 없음(스키마 불변, 데이터 재생성만).
- IPC: 무변경.
- Frontend: 무변경.
- `CURRENT_EXTRACTION_VERSION`: 25→26 (범프 시).

## 검증 방법

- rebuild 후 `mineru-api` health `/docs` 200 + `openapi.json`에 `/file_parse` + 8필드 수용.
- 논문 1편 `/file_parse` 응답 content_list 스키마가 `parseMineruResult` 기대와 정합(불일치 0 또는 수정 반영).
- `node --check apps/desktop/electron/mineru-client.mjs` + `main.mjs`(수정 시).
- `node --test apps/desktop/tests/*.test.mjs` 회귀(현 140/140 — mineru 파싱 단위 테스트가 있으면 그 픽스처도 3.4 응답으로 갱신).
- 논문 5편 재추출 성공(job succeeded, 청크>0, 표/수식 개수 로그 정상).
- `e2e-table-fidelity.mjs`로 3.4 기준선 수치 기록 + 2.7.6 44.2%와 비교표.
- 스캔 PDF 1편 임포트 결과(청크 수·OCR 인식) 관찰 기록.

## 가정 사항

- **[가정]** 3.4가 `/file_parse` 엔드포인트와 content_list 스키마(type/text_level/table_body/bbox/img_path)를 하위호환 유지한다 → 실사 2번이 검증. 깨지면 파서 수정이 슬라이스에 포함(규모↑).
- **[가정]** `backend="pipeline"`이 3.4에서 유효 또는 안전한 기본값으로 대체 가능 → openapi enum으로 확인.
- **[가정]** 범프 후 자동 재큐(`main.mjs` 기동 로직)가 5편을 정상 재처리한다(A-R2 지연 삭제로 빈껍데기 없음 — 이미 fix됨).
- **[가정]** rebuild 시간(61GB + 모델)이 수용 가능 — 아니면 야간/백그라운드로. 실행 방식은 오케스트레이터가 결정.
- **[결정 필요]** `Dockerfile.mineru`를 `>=2.7.0` 그대로 둘지 `>=3.4,<3.5`로 핀할지 — **핀 권장**(재현성). 사용자 확인.

---

## 구현 중 변경 사항 (Phase A — 빌드 비의존 준비, 2026-07-04)

> Phase A = 빌드와 무관한 준비만 수행(오케스트레이터가 `Dockerfile.mineru` 핀 변경 + `docker build --no-cache -t mineru:3.4 -t mineru:latest` 백그라운드 빌드를 이미 시작). 이 작업은 harness 정정 · 재검증 스크립트 준비 · 컨테이너 실행 방식 실사 · 범프 파급 확인만 하고, **rebuild/API 검증/범프/재추출은 전부 Phase B**(빌드 완료 후).

### A-1. `Dockerfile.mineru` 핀 (오케스트레이터 처리, 승인됨)
- `mineru-client.mjs` 헤더 주석은 이미 `POST /file_parse`로 **정확**했음 → 코드 무변경. 오기는 harness(external.md)뿐 → A-2에서 정정.
- Dockerfile 17행 = `pip install -U 'mineru[core]>=3.4,<3.5'` (핀 완료). 이 슬라이스의 "[결정 필요]"(핀 권장)가 이행됨.

### A-2. harness 오기 정정 (완료)
- `docs/harness/detail/services/external.md` MinerU 항목: `POST /predict` → **`POST /file_parse`**(multipart/form-data)로 정정. health를 `GET /docs` 200으로 명기, 포트 8001(호스트)→8000(컨테이너), 실행 이미지·컨테이너명, 코드 참조 `mineru-client.mjs:53`(parsePdf) 추가. (근거: 코드가 진실 — `mineru-client.mjs:53`이 `/file_parse` POST.)

### A-3. API 재검증 스크립트 준비 (완료, 미실행)
- 신규 `apps/desktop/scripts/verify-mineru-api.mjs` (`node --check` 통과, **미실행** — 현재 2.7.6이 떠 있어 Phase B에서 새 이미지 기동 후 실행).
- 검증 3단계: **Check 1** `GET /docs` 200(health) / **Check 2** `GET /openapi.json`에서 `/file_parse` 존재 + 클라이언트 8개 form 필드(`files`·`backend`·`lang_list`·`return_md`·`return_content_list`·`return_images`·`formula_enable`·`table_enable`) 전부 수용 + `backend` enum이 `"pipeline"` 수용(enum 없으면 free-string으로 통과) / **Check 3(옵션 PDF 인자)** 실제 `/file_parse` 파싱 응답의 `content_list` 요소 스키마를 `parseMineruResult` 기대(type text/table/equation/image/discarded · text_level · text · table_body · table_caption · image_caption · img_path · bbox)와 대조, 미지의 신규 필드·타입은 INFO로 리포트.
- 사용법(from `apps/desktop`): `node scripts/verify-mineru-api.mjs`(Check 1·2) / `node scripts/verify-mineru-api.mjs "<pdf path>"`(+Check 3). 타겟 오버라이드 `REDOU_MINERU_URL=...`. exit 0=전부 통과, 1=불일치 ≥1. **READ-ONLY**(컨테이너 무변경). 계약은 `mineru-client.mjs`에서 미러링 — 클라이언트 수정 시 이 스크립트 상단 상수도 동기 필요.

### A-4. 컨테이너 실행 방식 실사 (완료 — `docker inspect mineru-api`만, 무중단)
확정 결과(계획서 21행 "확인 필요"를 해소):

| 항목 | 실측값 |
|------|--------|
| 기동 방식 | **compose** (수동 run 아님). `com.docker.compose.project=ocr-server`, `service=mineru-api`, `oneoff=False` |
| compose 파일 | 라벨상 `...\Redou\**V1**\apps\ocr-server\compose.mineru.yaml` (주의: **V1** 트리에서 뜸, 현재 작업 트리는 V4) |
| 프로필 | `api` (계획서 추정 `redou-mineru`/docker-compose.yml이 아니라 **compose.mineru.yaml의 `mineru-api` 서비스**로 확정) |
| 이미지 | `mineru:latest` |
| ENTRYPOINT / CMD | `mineru-api` / `--host 0.0.0.0 --port 8000` |
| 포트 | `8001:8000` (호스트 8001 → 컨테이너 8000) |
| GPU | nvidia, `device_ids:["0"]`, capabilities gpu |
| env | `MINERU_MODEL_SOURCE=local` |
| restart | `always` |
| ipc / ulimits | `ipc: host`, memlock -1 / stack 67108864 |

- V4의 `apps/ocr-server/compose.mineru.yaml` `mineru-api` 서비스 정의와 **대조 결과 동치**(이미지·엔트리포인트·포트·GPU·env·restart 모두 일치). 즉 어느 트리에서 띄우든 재현 가능.

**Phase B 재기동 절차 (권고)** — 빌드가 `mineru:3.4`·`mineru:latest` 두 태그를 붙이므로, `mineru-api`는 `mineru:latest`를 참조 → **태그만 새 이미지로 바뀌면 컨테이너 재생성으로 3.4 적용**:
```
# 현재 컨테이너를 뜨운 트리에서 (compose가 SSoT):
docker compose -f apps/ocr-server/compose.mineru.yaml --profile api up -d --force-recreate mineru-api
# (--force-recreate로 latest 재태그된 새 이미지 반영. 기존 8001:8000·GPU·env 그대로 재현)
```
- **권고: compose 재기동으로 전환**(수동 `docker run` 재현 금지). 단, 현재 컨테이너가 **V1 트리 compose 라벨**을 갖고 있어, 재기동을 V1에서 할지 V4로 이관할지는 오케스트레이터 결정 — 서비스 정의가 동치라 어느 쪽이든 동일 컨테이너가 뜬다. V4로 이관 시 기존 `mineru-api`를 내리고(`... down` 또는 `rm -f`) V4 compose로 `up -d` 하면 프로젝트 라벨이 V4로 정리됨.
- 재기동 후 즉시 A-3 스크립트(Check 1·2, 그 다음 논문 1편 Check 3) 실행이 Phase B의 첫 관문.

### A-5. `CURRENT_EXTRACTION_VERSION` 범프 파급 (확인만 — **범프 안 함**)
- 위치: `main.mjs:114` `const CURRENT_EXTRACTION_VERSION = 25;` (주석 111-113에 "추출 로직 변경 시 범프 → 구버전 논문 기동 시 자동 재큐" 명시).
- 파급 경로(범프 25→26 시): 앱 기동 `whenReady`에서 `resetStaleRunningJobs()` → **`requeueOutdatedPapers()`**(`main.mjs:1773`, 호출 `main.mjs:2362`) → `papers`에서 `extraction_version < 26` 행 조회(`:1779`) → 그중 queued/running job 없고 `paper_files.is_primary` 저장본 있는 논문마다 기존 succeeded/failed job 삭제 후 `processing_jobs`에 `import_pdf` **재큐**(`:1818`) → `startProcessingLoop()`가 재추출. 재추출 persist는 A-R2 지연 삭제 경로(`persistV2Results`)라 중간 실패에도 빈껍데기 없음.
- **범프는 Phase B**: 새 이미지가 산출물을 실제로 바꾸므로 A/B 공정성 위해 범프 권장이나, **새 이미지 검증(A-3 통과) 후**에 범프해야 함(구버전 계약이 깨진 채 범프하면 재추출이 전부 실패). Phase A에서는 **미변경 유지**.

### Phase A 완료 / Phase B 대기
- **Phase A 완료**: harness 정정(A-2) · 재검증 스크립트 준비(A-3, node --check 통과·미실행) · 컨테이너 실행 방식 실사+재기동 절차 기록(A-4) · 범프 파급 확인(A-5, 미범프). Dockerfile 핀은 오케스트레이터 처리(A-1). **커밋 없음**(슬라이스 완료 시 일괄).
- **Phase B 대기(빌드 완료 후 순서)**:
  1. `mineru-api` 재기동(A-4 절차, `--force-recreate`로 3.4 반영).
  2. API 검증 — `node scripts/verify-mineru-api.mjs`(Check 1·2), 이어 논문 1편 경로로 Check 3(content_list 스키마 대조).
  3. 계약 깨진 경우에만 `mineru-client.mjs`/`main.mjs:944`(backend 값) 국소 수정 — 안 깨지면 무수정.
  4. 범프 판단·이행(권장 25→26, `main.mjs:114`) → 기동 시 `requeueOutdatedPapers` 자동 재큐.
  5. 논문 5편(최소 e2e fixture 2편) 재추출 성공 확인 → `e2e-table-fidelity.mjs`로 **3.4 기준선 fidelity** 기록(2.7.6 44.2% 대비표).
  6. 스캔 PDF 1편 임포트 결과 확인(backlog/18 ② 재평가 데이터).
- **규모 재판단**: A-4에서 계약 정합·범프 결정이 확정되면 develop/fix 최종 판정(슬라이스 완료 시 기록). 현 시점 기본 경로 `/develop` 유지(재추출·기준선 재측정 파급).

---

## 구현 중 변경 사항 (Phase B — 3.4 스키마 드리프트 대응 + 범프, 2026-07-04)

> Phase B = 오케스트레이터가 MinerU **3.4.2** 컨테이너를 띄운 상태에서 실 응답을 실측하고, 파서를 국소 대응 + 버전 범프. **git 커밋 없음·브랜치 main 유지·docker 무변경**. 재추출→기준선 재측정→스캔 확인(item 5·6)은 오케스트레이터 몫으로 남김.

### B-0. 실측 (라이브 3.4.2, `verify-mineru-api.mjs` + 소형 덤프)
- 실 논문(KOH-treated AC, 2022 CEJ) `/file_parse` → `version=3.4.2 backend=pipeline`, content_list **265요소**. 타입 분포: text 139 · chart 38 · header 39 · equation 17 · page_number 16 · table 8 · page_footnote 3 · image 2 · list 2 · footer 1.
- **신규 타입 6종**: `chart`·`list`·`header`·`footer`·`page_number`·`page_footnote`. **신규 필드**: `text_format`(equation), `image_footnote`(image), `chart_caption`/`chart_footnote`/`content`(chart), `list_items`/`sub_type`(list).
- **기존 계약 전부 PASS**: 8 form 필드·`/file_parse`·`table_body`/`table_caption`/`img_path`/`image_caption`·`el.text`(equation) 불변. backend enum이 3.4에서 5종(`pipeline`/`vlm-engine`/`hybrid-engine`/`vlm-http-client`/`hybrid-http-client`) 생겼으나 `"pipeline"` 유효 → **`main.mjs` backend 값 무변경**.

### B-1·B-2. 파서 국소 대응 (`mineru-client.mjs` `parseMineruResult`) — 타입별 결정+근거
| 타입 | 결정 | 근거(실측) |
|------|------|-----------|
| `chart` | `parseFigures`가 `image`와 함께 수용 → `item_type: figure`. caption=`chart_caption`, 없으면 `content`를 캡션 대체 | chart도 `img_path` 보유한 그림형. 265요소 중 **38건** — 미처리 시 전부 유실. figures로 살릴 가치 충분 |
| `list` (`sub_type ≠ ref_text`) | `list_items[]` 줄바꿈 조인 → 본문(섹션 rawText + buildRawText 대칭) | 목록=결론·절차 등 실질 본문, 유실 불가 (신규 헬퍼 `listElementToBodyText`) |
| `list` (`sub_type = ref_text`) | **본문 제외** | 실측: 본 논문 list **2건 전부 ref_text**(서지 14+54=68항목). 참고문헌은 GROBID→`paper_references` 소유 → 본문 청크로 넣으면 임베딩/검색 오염 (데이터 근거로 무조건 본문화 거부) |
| `header`/`footer`/`page_number`/`page_footnote` | **명시적 무시** (`IGNORED_BOILERPLATE_TYPES` Set + 주석) | 실측: 저널 러닝헤드("Chemical Engineering Journal 431…")·copyright/DOI 줄·페이지번호·"* Corresponding authors." = 검색/임베딩 가치 없음. 묵시 무시와 구분 |
| `equation`(`text_format`)·`image`(`image_footnote`) | **무수정** | 파서가 읽는 `el.text`/`el.image_caption` 계약 불변, 신규 필드 미사용 |
- 실 265요소 파서 통과 결과: sections 26 · chunks 47 · tables **8/8** · equations **17/17** · figures **40**(image 2+chart 38) · ref_text 서지·boilerplate 전부 본문 미포함 확인.

### B-3. 범프 (`main.mjs:116`)
- `CURRENT_EXTRACTION_VERSION` **25 → 26** (주석에 3.4 대응 명기). 기동 시 `requeueOutdatedPapers`가 `extraction_version < 26` 논문 자동 재큐(A-5 파급 경로). 재추출 실행·검증은 오케스트레이터.

### B-4. 테스트 (실 응답 기반 fixture)
- 신규 `tests/mineru-client.test.mjs` **7건** + fixture `tests/fixtures/mineru-34-content-list.json`(실 3.4.2 응답 축약 — 전 타입 커버, 비-ref `list` 1건만 합성[본 논문은 ref_text만이라]). assert: (1) fixture가 신규 타입 6종 실제 포함 (2) table/equation 회귀(신규 필드에도 파싱 유지) (3) chart→figures 편입+caption/content 폴백 (4) non-ref list→본문 (5) **ref_text 서지 본문 제외** (6) boilerplate 4종 무시 (7) 헤딩→섹션·chunk.
- `node --test tests/*.test.mjs` **147/147**(기존 140 + 신규 7, 회귀 0). `node --check` `mineru-client.mjs`·`main.mjs`·`verify-mineru-api.mjs` 통과. `verify-mineru-api.mjs` 3.4.2 라이브 Check 1·2·3 전부 PASS(계약 미러 상수를 파서와 동기 → "no unexpected element types").

### B-5. verify 스크립트 동기 (스코프 인접)
- `scripts/verify-mineru-api.mjs`의 `EXPECTED_CONTENT_TYPES`/`EXPECTED_CONTENT_FIELDS`를 파서와 동기(스크립트 헤더가 "클라이언트 수정 시 동기 필요"라고 명시). 3.4 신규 타입 6종·필드 4종(chart_caption/content/list_items/sub_type)을 기대 목록에 추가 → 재검증 시 이들을 "unexpected"로 오탐하지 않음.

### 규모 확정 & 남은 것
- **규모 확정**: 코드 수정 `mineru-client.mjs`(+테스트·fixture) + `main.mjs` 1줄 + verify 동기 = 소규모(fixer)로 수행. 단 범프에 따른 **재추출 파급**이 있어 오케스트레이터 후속(재측정)이 필수. DB 마이그레이션 없음(스키마 불변).
- **남은 것(오케스트레이터)**: item 5(논문 5편 재추출 → `e2e-table-fidelity.mjs`로 3.4 기준선 fidelity, 2.7.6 44.2% 대비) · item 6(스캔 PDF 1편 확인). 커밋도 오케스트레이터/사용자.

## Phase C 실측 결과 (오케스트레이터, 2026-07-04)

- 재기동: `docker compose -f compose.mineru.yaml --profile api up -d --force-recreate mineru-api` — 10초 내 healthy. 이미지 내 mineru **3.4.2**.
- API 검증: `verify-mineru-api.mjs` Check 1·2 전부 PASS(+신규 `/health`·`/tasks*` 확인). Check 3에서 스키마 드리프트 발견 → Phase B 파서 대응 후 재실행 전부 PASS.
- 재추출: Electron 기동 → `requeueOutdatedPapers` 자동 재큐 → **5편 전부 v26, import/embedding 각 5 succeeded, 실패 0**. chunks 207(임베딩 100%), tables 30, figures 112, equations 54. CO 논문 chunks=47은 Phase B 라이브 파싱 실측과 일치(교차 검증).
- **3.4 기준선 fidelity: 67.4% (29/43) — 2.7.6 대비 +23.2%p** (동일 gemma4:31b·fixture·쿼리. 논문1 40.7→77.8%, 논문2 50.0 유지. misattribution·fabrication 0 유지. 검증 130/132 = code 130/Guardian 2. 표 48행). 런 간 변동(±2~3%p)을 크게 상회 — 파서 개선 효과 확실.
- 스캔 PDF(backlog/18 ②): **보류** — 라이브러리 5편 전부 정상 텍스트 PDF라 스캔 샘플 부재. 샘플 확보 시 재평가.
