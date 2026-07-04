# 슬라이스 02: docling 사이드카 + 표 A/B (게이트 산출)

> 유형: 대규모 (develop) — Python 사이드카 신설(docker) + docling-client 어댑터(최소) + A/B 하네스. 단 **프로덕션 파이프라인 무변경**(도입 판단용 측정 전용).
> 상태: **Phase A 완료(빌드 비의존 구현)** / Phase B 대기(오케스트레이터: build→기동→A/B 실행→게이트 판정) | 의존: 슬라이스 01(3.4 기준선) | 작성일: 2026-07-04

## 진행 상태

- **Phase A (완료, developer 2026-07-04)** — 빌드에 의존하지 않는 모든 정의·코드 작성:
  - docling 사이드카 3종(`apps/docling-server/`): `Dockerfile.docling`·`docling-server.py`·`requirements.txt` + 별도 `compose.docling.yaml`(포트 8011, 기본 CPU / GPU 프로필 옵션).
  - `docling-client.mjs`(측정 전용 어댑터, mineru-client 대칭) + `ab-docling-tables.mjs`(5축 A/B + 골든 43셀 재발견 + 게이트 판정).
  - 자기검증: `node --check` 2파일 PASS, `python -m py_compile` 서버 PASS, `docker compose config` YAML VALID, 기존 테스트 **148 pass/0 fail**(프로덕션 무변경 확인). docker build/run·13분 fidelity E2E는 미실행(오케스트레이터 몫).
- **Phase B (대기, 오케스트레이터)** — 장시간 작업:
  1. `docker compose -f apps/docling-server/compose.docling.yaml build docling` → `up -d docling`, `/health` 200 확인.
  2. `cd apps/desktop && node scripts/ab-docling-tables.mjs` — 논문 5편 5축 리포트 + 게이트 verdict 산출.
  3. `node scripts/e2e-table-fidelity.mjs`(동일 fixture·LLM)로 생성-테이블 fidelity 대조 병행.
  4. verdict(PASS→03 / HOLD→MinerU 유지) 근거를 `completed/02`에 기록, README Next Action 갱신.

## 목적

- **무엇을**: docling(IBM/LF AI, MIT, v2.108.0)을 **표 파싱 A/B용 사이드카**로 띄우고, 논문 5편의 표를 MinerU 3.4 vs docling으로 비교한다.
- **왜**: backlog/18의 표 하이브리드는 "표=docling(TableFormer, 셀 bbox)"이 MinerU보다 나을 때만 가치가 있다. **채택 전 측정**(A/B 게이트 원칙).
- **범위**: 최소 사이드카 + 표 파싱 대조 리포트 산출. **프로덕션 임포트 경로는 손대지 않는다**(main.mjs·mineru-client.mjs 무변경).
- **제외**: 채택 구현(03), bbox DB 저장, ③④ 후속 job, 스캔 OCR(②).

## 선례 (실사 확인)

- `apps/ocr-server/`가 **Python FastAPI 사이드카 패턴의 완성 선례**: `Dockerfile`(`nvidia/cuda:12.8.0` base + torch cu128 + `requirements.txt` + build-time 모델 다운로드 + `uvicorn server:app`), `server.py`(FastAPI, `/health`·`/predict` 엔드포인트, lifespan 모델 로드), `docker-compose.yml`(gpu reservation·healthcheck). docling 사이드카는 이 구조를 복제한다.
- 포트 관례: 8010(ocr-server/UniMERNet)·8001(MinerU)·8070(GROBID). docling은 **새 포트**(예: 8011) 배정.
- 환경변수 관례: `REDOU_<SERVICE>_URL`(external.md). docling은 `REDOU_DOCLING_URL` 신설.

## 작업 분해

1. [x] **docling 사이드카 이미지** (신규 `apps/docling-server/`) — *Phase A 완료*
   - [x] `Dockerfile.docling`: `nvidia/cuda:12.8.0-cudnn-runtime` base + torch cu128 + `pip install -r requirements.txt`(docling>=2.108,<3) + build-time `docling-tools models download`(레이아웃+TableFormer 오프라인) + `uvicorn`. ocr-server Dockerfile 구조 그대로 차용.
   - [x] `docling-server.py`: FastAPI(lifespan 모델 로드, ocr-server server.py 스타일). `POST /parse`(multipart PDF) → 표 중심 JSON(셀 grid[row/col/span/header] + **셀별 bbox** + 캡션 + caption_ref "Table N" + 페이지 + HTML + 수식 LaTeX + figure 수 + 파싱시간). `/health`. docling API 버전 드리프트에 `getattr`/try-except로 방어(DocumentStream import 폴백 포함).
   - [x] `compose.docling.yaml`(**별도 파일** — compose.mineru.yaml·docker-compose.yml 무침범): `docling`(기본 CPU, GPU 경합 회피) + `docling-gpu`(profile gpu 옵션), 포트 8011, healthcheck, `restart:no`(A/B 임시).
   - [실사·미완] docling 모델 크기·CPU 실행 성능은 **Phase B(build+run)에서 실측** — ocr-server가 GPU 1장 점유 중이라 기본 CPU로 설계.

2. [x] **docling-client 어댑터** (`apps/desktop/electron/docling-client.mjs`, 측정 전용) — *Phase A 완료*
   - [x] `isDoclingAvailable()`(`/health`), `parsePdfDocling(pdfBuffer)` → `{ tables:[{figureNo,caption,page,numRows,numCols,html,cells:[{text,row,col,rowSpan,colSpan,columnHeader,rowHeader,bbox}],cellsWithBbox}], equations:[{latex,page}], numFigures, doclingVersion, processingTime, serverProcessingTime }`.
   - [x] **mineru-client.mjs와 대칭**(isXxxAvailable/parsePdf 패턴). 프로덕션 import 무배선(main.mjs 미참조).

3. [x] **A/B 대조 하네스** (`apps/desktop/scripts/ab-docling-tables.mjs`, 수동·CI-off) — *Phase A 완료(코드), 실행은 Phase B*
   - [x] 논문 5편의 저장 PDF(`paper_files.stored_path`)를 MinerU 3.4(`parsePdf`+`parseMineruResult`)와 docling(`parsePdfDocling`) 양쪽 파싱.
   - [x] **5축 대조**: ①표 구조(행/열 수 + 파서 간 셀텍스트 Jaccard + **골든 43셀 값 재발견율**) ②수식 LaTeX(개수+샘플) ③캡션 연결("Table N" ref 공유 수) ④셀 bbox 존재율(docling 셀별 vs MinerU 0) ⑤파싱 시간.
   - [x] **골든 fixture 연동**: `loadFidelityGroundTruth('adsorption-groundtruth-v0.json')`로 2편 43셀 값을 축 ①에 주입 — 파서가 못 낸 값은 LLM도 못 뽑는다는 상한 측정.
   - [~] **fidelity eval 병행**: 생성-테이블 fidelity는 기존 `e2e-table-fidelity.mjs`(동일 fixture·LLM)가 담당 — **Phase B에서 함께 구동**(이 스크립트는 파서 원천 표 품질만).

4. [~] **A/B 리포트 산출 → 게이트 판정** — *스크립트에 로직 내장(Phase A), 산출은 Phase B*
   - [x] 게이트 기준 **사전 정의 코드화**: docling이 {표 구조 | 셀 bbox | 캡션 연결} 중 ≥1 **명확 우위** + 골든 재발견 비열세(−10%p 이내) → PASS(03 진행), 아니면 HOLD(MinerU 유지). 스크립트가 5축 요약 + `VERDICT: PASS/HOLD` 출력.
   - [ ] **Phase B**: build→run→`node scripts/ab-docling-tables.mjs` 실행 → verdict + 근거를 `completed/02`에 기록 + README Next Action 갱신.

## 영향 범위

- 신규: docling 사이드카(docker), `docling-client.mjs`(측정 전용), `ab-table-parse.mjs`(스크립트). compose 항목 1개.
- **무변경**: `main.mjs`·`mineru-client.mjs`·DB·IPC·Frontend·`CURRENT_EXTRACTION_VERSION`. (측정 슬라이스이므로 프로덕션 경로 불변.)

## 검증 방법

- docling 사이드카 health 200 + 논문 1편 `/parse` 성공(표 JSON 반환).
- `node --check docling-client.mjs` + `ab-table-parse.mjs`.
- 5편 양쪽 파싱 완주 + 5축 리포트 + fidelity 점수(동일 fixture·모델)로 A/B 표 산출.
- 게이트 판정(승/패 + 근거) 기록. **프로덕션 회귀 없음**(import 경로 무변경 → 기존 140/140 테스트 불변).

## 가정 사항

- **[가정]** docling이 스칼라 표 HTML + 셀 bbox를 안정적으로 낸다(TableFormer). 논문 표(다열·병합·단위 헤더)에서 실측 검증.
- **[가정]** GPU 1장 경합 — docling을 CPU로 돌리거나 A/B 시에만 MinerU와 시분할. [실사] docling CPU 성능 허용치.
- **[가정]** fidelity eval을 docling 산출로 재구동하려면 docling 표 HTML을 기존 `parseAllHtmlTables`/`extractMatrixFromHtml` 입력 형태로 맞춰야 함 — 어댑터가 이 변환 담당. 변환 손실이 A/B 공정성을 해치지 않는지 확인(리스크).
- **[리스크]** A/B 공정성: MinerU는 3.4(01 완료 후), docling은 최신, **동일 논문 5편·동일 LLM·동일 fixture**. 파서만 바꾸고 하류(생성·검증) 고정.

## Phase B 실측 결과 (오케스트레이터, 2026-07-04)

docling 2.109 사이드카(8011, CPU) 기동 후 `ab-docling-tables.mjs` 실행 — fixture 2편 대상 5축:

| 축 | MinerU 3.4 | docling 2.109 |
|----|-----------|---------------|
| 표 수(Σ) | 17 | 16 |
| 골든 43셀 재발견 | **43/43 (100%)** | **43/43 (100%)** |
| 교차 셀 일치(Jaccard 평균) | 66.1% (분할 방식 차이) | — |
| 수식 LaTeX | **44** | 0 (사이드카 수식 enrichment 미활성) |
| 캡션 연결(Table N refs) | 14 | **16** |
| 셀 bbox | 0% | **100%** |
| 파싱 시간 평균 | **14.0s (GPU)** | 149.2s (CPU — GPU 프로필 미사용, 축 불공정) |

**GATE: PASS** (사전 정의 기준: 명확 우위 ≥1 [bbox·캡션] + 골든 비열세 [동률]).

**정직한 해석**: docling의 승리는 **provenance(셀 좌표)·캡션 연결**이고, **값 추출 품질은 동률**(둘 다 골든 100%) — 즉 슬라이스 03의 기대 효과는 "표 값이 좋아진다"가 아니라 "셀→PDF 좌표 사슬(클릭 점프)·조건 대조 UX"다. 수식은 계획대로 MinerU 유지(하이브리드)라 0이어도 게이트 무관. 파싱 시간 10배는 CPU 실행 탓 — 채택 시 GPU 프로필+비동기 완화 필요.
