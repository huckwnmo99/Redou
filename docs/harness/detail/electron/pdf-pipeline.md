# PDF Pipeline
> 하네스 버전: v2.2 | 최종 갱신: 2026-07-04

## 개요
현재 Electron PDF 처리는 V2 단일 파이프라인이다. 구조 추출은 MinerU **3.4.2**가 담당하며, MinerU가 없거나 MinerU 추출이 실패하면 PDF 임포트 작업은 실패한다. GROBID는 메타데이터와 참고문헌 품질을 높이는 선택 서비스이며, 미가용 시 MinerU 결과만 저장하는 degraded mode로 진행한다. V1 휴리스틱 구조 추출, Tesseract OCR 폴백, V1 figure/table/equation 후보 추출 함수는 더 이상 파이프라인의 일부가 아니다.

## MinerU 3.4 content_list 타입 처리
MinerU 3.4.2는 2.7.6 대비 `content_list` 요소 타입을 더 세분화한다(실측 2026-07-04). `parseMineruResult`(`mineru-client.mjs`)가 타입별로 다음과 같이 매핑한다.

| 3.4 요소 타입 | 처리 | 근거 |
|---------------|------|------|
| `text`(text_level) | 섹션 헤딩 | 기존과 동일 |
| `text`(no level) | 본문 문단 → 섹션 rawText·chunks | 기존과 동일 |
| `table` | `parseTables` (table_body HTML·caption·footnote) | 기존과 동일 |
| `equation` | `parseEquations` (el.text의 `$$…$$`). 신규 `text_format=latex` 필드는 미사용(el.text가 계약) | 기존 계약 유지 |
| `image` | `parseFigures` → figures. 신규 `image_footnote` 필드는 미사용 | 기존 계약 유지 |
| `chart` **(3.4 신규)** | `parseFigures`가 image와 함께 수용 → `item_type: figure`. caption은 `chart_caption`, 없으면 `content`(구조화 텍스트)를 검색용 캡션 대체로 | chart도 `img_path` 보유한 그림형 요소. 실측 265요소 중 38건 chart — 미처리 시 전부 유실 |
| `list` **(3.4 신규)** | `list_items[]`를 줄바꿈 조인해 본문으로 수용. **단 `sub_type === "ref_text"`는 제외** | 목록=결론·절차 등 실질 본문. ref_text는 서지목록이라 GROBID→`paper_references` 소유(실측: 본 논문 list 2건 전부 ref_text=68항목 → 본문 주입 시 임베딩/검색 오염) |
| `header`/`footer`/`page_number`/`page_footnote` **(3.4 신규)** | **명시적 무시**(`IGNORED_BOILERPLATE_TYPES` 상수 + 주석) | 러닝헤드·꼬리말·페이지번호·코레스폰딩저자 각주 = 검색/임베딩 가치 없음. 묵시 무시와 구분해 명시화 |
| `discarded` | 스킵 | 기존과 동일 |

- 검증: `parseMineruResult` 단위 테스트(`tests/mineru-client.test.mjs`, 7건)가 실 3.4.2 응답 축약 fixture(`tests/fixtures/mineru-34-content-list.json`)로 위 매핑을 고정 — chart→figures 편입, non-ref list→본문, ref_text 제외, boilerplate 무시를 각각 assert.
- API 계약 재검증: `scripts/verify-mineru-api.mjs`가 3.4.2에서 Check 1·2·3 전부 PASS(backend enum `["pipeline","vlm-engine","hybrid-engine","vlm-http-client","hybrid-http-client"]`에 `"pipeline"` 유효 → `main.mjs`의 `backend="pipeline"` 무변경). 스크립트의 기대 타입/필드 상수는 파서와 동기됨.
- `CURRENT_EXTRACTION_VERSION` 25→**26**: 3.4 산출물 변화(chart 편입·list 본문·boilerplate 정리) 반영 → 기동 시 구버전 논문 자동 재큐(`requeueOutdatedPapers`).

## 핵심 파일
| 파일 | 역할 | 현재 줄 수 |
|------|------|------------|
| `apps/desktop/electron/main.mjs` | 작업 큐, V2 파이프라인 오케스트레이션, DB 저장, embedding 큐 등록 | 3519 |
| `apps/desktop/electron/mineru-client.mjs` | MinerU health check, PDF 구조 추출, MinerU 결과 파싱(3.4 타입 매핑), 이미지 저장 | 515 |
| `apps/desktop/electron/grobid-client.mjs` | GROBID health check, TEI 메타데이터/참고문헌 파싱, 기존 논문 링크 | 297 |
| `apps/desktop/electron/pdf-heuristics.mjs` | 임포트 전 PDF 메타데이터 미리보기와 V2 figure 이미지 보강만 유지 | 1280 |
| `apps/desktop/electron/ocr-extraction.mjs` | MinerU가 비워 둔 table body에 대한 GLM-OCR 보강만 유지 | 226 |

## main.mjs 주요 함수
| 함수/상수 | 줄 | 역할 |
|-----------|----|------|
| `CURRENT_EXTRACTION_VERSION` | 116 | 현재 추출 버전 **26**(MinerU 3.4). 낮은 버전의 기존 논문은 재처리 대상 |
| `mergeMetadata(...)` | 413 | GROBID metadata, MinerU section title, 기존 paper row를 병합 |
| `persistV2Results(...)` | 424 | V2 결과를 `paper_sections`, `paper_chunks`, `figures`, `paper_references`, `papers`, `paper_summaries`에 저장 |
| `upsertPaperSummaryV2(...)` | 687 | V2 section 결과 기반 시스템 요약 생성/갱신 |
| `processWithMineruGrobid(...)` | 734 | MinerU 필수 실행, GROBID 조건부 실행, V2 결과 파싱/저장 |
| `updateJobStatus(...)` | 799 | `processing_jobs` 상태 갱신 공통 헬퍼 |
| `processImportPdfJob(...)` | 806 | PDF import job 본체. MinerU/GROBID 가용성 확인, V2 실행, OCR 보강, embedding job 큐 등록 |
| `processEmbeddingJob(...)` | 989 | chunk/paper/figure/table/equation embedding 생성 |
| `tryStartExtractionJob(...)` | 1265 | queued extraction job 하나를 running으로 전환하고 `processImportPdfJob` 실행 |
| `tryStartEmbeddingJob(...)` | 1314 | queued `generate_embeddings` job 하나를 실행 |
| `processNextQueuedJob()` | 1363 | extraction과 embedding 큐를 각각 한 개씩 시도 |
| `startProcessingLoop()` | 1368 | 2.5초 간격으로 큐 폴링 시작 |
| `resetStaleRunningJobs()` | 1380 | 앱 재시작 후 stale running job을 queued로 되돌림 |

## V2 실행 흐름
1. `tryStartExtractionJob()`가 `processing_jobs`에서 `generate_embeddings`가 아닌 queued job을 하나 가져온다.
2. `processImportPdfJob()`가 paper row와 primary `paper_files` row를 로드하고 저장된 PDF 경로를 검증한다.
3. `processImportPdfJob()`가 `isMineruAvailable()`과 `isGrobidAvailable()`을 동시에 확인한다.
4. MinerU가 미가용이면 즉시 오류를 던져 임포트 job을 실패 처리한다. V1 폴백은 없다.
5. GROBID가 미가용이면 warning만 남기고 `processWithMineruGrobid(..., grobidAvailable: false)`로 진행한다.
6. `processWithMineruGrobid()`는 `parsePdf()`를 반드시 실행하고, `grobidAvailable`이 true일 때만 `extractMetadataAndReferences()`를 실행한다. false이면 `Promise.resolve(null)`을 사용해 120초 GROBID 대기를 만들지 않는다.
7. MinerU 결과는 `parseMineruResult()`로 sections, chunks, figures, tables, equations로 정규화된다.
8. `mergeMetadata()`가 GROBID metadata가 있으면 우선 사용하고, 없으면 MinerU/기존 paper/fallback title 기준으로 paper metadata를 구성한다.
9. `persistV2Results()`가 V2 결과를 저장한다. 재추출 시 **지연 삭제(A-R2)**: 함수 진입 시 기존 `paper_chunks`/`figures`/`paper_sections`의 old id만 조회·보관하고, 새 행을 old와 공존시켜 전부 insert한 뒤 모든 insert·링크가 성공하면 그 시점에 old id만 삭제한다(중간 실패 시 old 보존 → "빈껍데기" 방지, 완전 원자성은 아님). old chunk/figure 삭제 시 `chunk_embeddings`·`figure_chunk_links`는 ON DELETE CASCADE로 함께 정리되고, `figure_chunk_links`는 새로 insert한 figure id로만 생성한다. figure 이미지는 MinerU 이미지 저장을 우선하고, 누락된 figure에 대해서만 `extractFigureImagesFromPdf()`를 보강용으로 사용한다.
10. 저장 후 빈 table body가 있으면 `enhanceEmptyTablesWithOcr()`가 GLM-OCR로 table HTML/plain text를 보강한다. 이 단계는 V2 후처리이며 구조 추출 폴백이 아니다.
11. chunk가 하나 이상이면 `generate_embeddings` job을 큐에 추가한다.
12. `processEmbeddingJob()`가 chunk, paper, figure/table/equation embedding을 생성한다.

## 서비스별 실패 동작
| 서비스 | 현재 기준 |
|--------|-----------|
| MinerU | 필수. health check 실패 또는 `parsePdf()` 실패 시 import job 실패 |
| GROBID | 선택. health check 실패 시 metadata/references 일부 누락 degraded mode로 진행 |
| GLM-OCR/Ollama | 선택 후처리. 빈 table OCR 보강 실패는 non-fatal warning |
| pdfjs/mupdf figure image extraction | 선택 보강. MinerU figure image 누락 시만 시도하고 실패는 non-fatal warning |
| Embedding worker/vLLM | 별도 `generate_embeddings` job에서 처리. extraction 성공 자체를 되돌리지 않음 |

## 보조 모듈 함수
| 함수 | 줄 | 역할 |
|------|----|------|
| `isMineruAvailable()` | mineru-client.mjs:45 | MinerU API health check |
| `parsePdf(...)` | mineru-client.mjs:62 | MinerU PDF 구조 추출 요청 |
| `parseMineruResult(...)` | mineru-client.mjs:115 | MinerU 응답을 Redou V2 구조로 변환(3.4 타입 매핑) |
| `saveFigureImages(...)` | mineru-client.mjs:451 | MinerU figure 이미지 저장 |
| `saveTableImages(...)` | mineru-client.mjs:489 | MinerU table 이미지 저장 |
| `isGrobidAvailable()` | grobid-client.mjs:21 | GROBID `/api/isalive` health check |
| `extractMetadataAndReferences(...)` | grobid-client.mjs:37 | GROBID TEI metadata/reference 추출 |
| `linkReferencesToExistingPapers(...)` | grobid-client.mjs:262 | 참고문헌과 기존 paper 매칭 |
| `inspectPdfMetadata(...)` | pdf-heuristics.mjs:811 | 임포트 전 title/year/author preview |
| `extractFigureImagesFromPdf(...)` | pdf-heuristics.mjs:853 | V2 figure 이미지 누락 시 pdfjs/mupdf 보강 |
| `renderPageToPng(...)` | ocr-extraction.mjs:18 | GLM-OCR 입력용 페이지 렌더링 |
| `enhanceEmptyTablesWithOcr(...)` | ocr-extraction.mjs:179 | V2 빈 table body OCR 보강 |

## 현재 유지/삭제 기준
- 유지: MinerU V2 구조 추출, GROBID degraded metadata, MinerU image 저장, pdfjs/mupdf figure image 보강, GLM-OCR 빈 table 보강, embedding 큐.
- 삭제됨: V1 휴리스틱 sections/chunks/figures/tables/equations 추출, optional Tesseract OCR 폴백, V1 table crop/UniMERNet cleanup 전용 dead code.
- 금지: MinerU 미가용 시 V1으로 돌아가는 설명이나 구현을 추가하지 않는다.
