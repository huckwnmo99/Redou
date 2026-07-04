# 슬라이스 02: docling 사이드카 + 표 A/B (게이트 산출)

> 유형: 대규모 (develop) — Python 사이드카 신설(docker) + docling-client 어댑터(최소) + A/B 하네스. 단 **프로덕션 파이프라인 무변경**(도입 판단용 측정 전용).
> 상태: 계획 | 의존: 슬라이스 01(3.4 기준선) | 작성일: 2026-07-04

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

1. [ ] **docling 사이드카 이미지** (`apps/ocr-server/` 또는 신규 `apps/docling-server/`)
   - `Dockerfile.docling`: python base + `pip install docling`(+ CPU/GPU 선택). docling은 build-time에 TableFormer 등 모델 다운로드(오프라인 실행). ocr-server Dockerfile 구조 차용.
   - `docling-server.py`: FastAPI. `POST /parse`(multipart PDF) → DoclingDocument를 표 중심 JSON으로 반환(표 HTML + 셀 bbox + 캡션 + 페이지). `/health`.
   - compose 항목 추가(docker-compose.yml 또는 별도): 포트 8011, gpu(옵션), healthcheck. **A/B 기간만 띄우는 임시 서비스**로 취급(프로덕션 상시화는 03에서 결정).
   - [실사] docling 모델 크기·CPU 실행 가능성(GPU 경합 회피) 확인 — ocr-server가 이미 GPU 1장 점유 중.

2. [ ] **docling-client 어댑터** (`apps/desktop/electron/docling-client.mjs`, 측정 전용)
   - `isDoclingAvailable()`(health), `parsePdfDocling(pdfBuffer)` → `{ tables: [{html, cells:[{bbox,text}], caption, page}], equations?, processingTime }`.
   - **mineru-client.mjs와 대칭 인터페이스**로 만들어 A/B 스크립트가 동일 shape로 비교. 프로덕션 import에서 호출하지 않음(무배선).

3. [ ] **A/B 대조 하네스** (`apps/desktop/scripts/ab-table-parse.mjs`, 수동·CI-off)
   - 논문 5편의 저장된 PDF를 MinerU 3.4(`parsePdf`)와 docling(`parsePdfDocling`) 양쪽으로 파싱.
   - **5축 대조**: (1) 표 구조 정확도(행/열/셀 수, 병합셀 처리) (2) 수식 LaTeX(docling이 수식 표를 어떻게) (3) 캡션 연결(Table N ↔ 표 매칭) (4) 셀 bbox 유무·정밀도 (5) 파싱 시간.
   - **fidelity eval 연동**: 두 파서 산출을 각각 표 생성 파이프라인에 태워 `table_fidelity`(`e2e-table-fidelity.mjs` 로직 재사용)로 점수화 — 동일 fixture(`adsorption-groundtruth-v0.json`)·동일 LLM. 이게 게이트의 정량 심판.
   - **수동 대조 병행**: 정량 점수 + 사람이 표 몇 개를 눈으로(구조·값) — 정답 fixture가 2편뿐이라 나머지 3편은 정성 관찰.

4. [ ] **A/B 리포트 산출 → 게이트 판정**
   - MinerU 3.4 vs docling 5축 + fidelity 점수 표. **승/패 판정 + 근거** 명문화.
   - 판정 기준(사전 정의): docling이 (표 구조 or 셀 bbox or 캡션 연결)에서 **명확 우위** + fidelity 비열세 → 03 진행. 아니면 03 보류(MinerU 유지).
   - 결과를 `completed/02`에 기록 + README Next Action을 게이트 결과대로 갱신.

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
