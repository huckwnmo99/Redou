# PDF 처리 파이프라인
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
PDF 임포트 시 텍스트 추출, 구조화(섹션/청크), Figure/Table/Equation 감지, OCR 보강을 수행한다. V2(MinerU+GROBID)를 우선 시도하고 실패 시 V1(pdfjs 휴리스틱+OCR)로 폴백한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/main.mjs` | 파이프라인 오케스트레이션 (processImportPdfJob) | 해당 구간 ~400줄 |
| `apps/desktop/electron/pdf-heuristics.mjs` | V1: pdfjs 텍스트 추출, 레이아웃 분석, figure/table/equation 휴리스틱 감지 | ~2303 |
| `apps/desktop/electron/mineru-client.mjs` | V2: MinerU API → 마크다운+JSON+이미지 | ~456 |
| `apps/desktop/electron/grobid-client.mjs` | GROBID API → TEI XML (메타데이터+참고문헌) | ~297 |
| `apps/desktop/electron/ocr-extraction.mjs` | GLM-OCR (테이블→HTML, 수식→LaTeX), UniMERNet (수식→LaTeX) | ~1016 |

## 주요 함수/컴포넌트

### main.mjs
| 함수 | 줄 | 역할 |
|------|------|------|
| `processImportPdfJob(job)` | 1163 | 파이프라인 진입점: V2 시도 → V1 폴백 |
| `persistHeuristicExtraction(...)` | 520 | V1 결과 DB 저장 (sections, chunks, figures, tables, equations) |
| `persistV2Results(...)` | 778 | V2 결과 DB 저장 |
| `processWithMineruGrobid(...)` | (위) | V2 파이프라인 실행 |
| `crossValidateV2(parsed, pdfjsData)` | 759 | V2와 V1 결과 교차 검증 (경고 로그) |
| `mergeMetadata(...)` | 748 | GROBID + MinerU 메타데이터 병합 |
| `upsertCurrentPaperSummary(...)` | 474 | 자동 요약 생성/갱신 |

### pdf-heuristics.mjs
| 함수 | 줄 | 역할 |
|------|------|------|
| `extractHeuristicPaperData(pdfBuf, title, opts)` | 2230 | V1 메인: pdfjs → 섹션+청크+figures+tables+equations |
| `inspectPdfMetadata(pdfBuf, fallbackTitle)` | 1760 | PDF 메타데이터 미리보기 (임포트 전) |
| `extractFigureImagesFromPdf(pdfBuf, figures)` | 1802 | pdfjs operator list에서 이미지 추출 → PNG |

### ocr-extraction.mjs
| 함수 | 줄 | 역할 |
|------|------|------|
| `extractTablesAndEquationsWithOcr(pdfBuf, opts)` | 257 | GLM-OCR: 테이블→HTML, 수식→LaTeX |
| `enhanceEmptyTablesWithOcr(pdfBuf, tables)` | 480 | V2 빈 테이블 OCR 폴백 |
| `enhanceEquationsWithUniMERNet(pdfBuf, equations)` | 925 | UniMERNet: 수식 이미지 크롭 → LaTeX |
| `renderPageToPng(pdfBuf, page, scale)` | 25 | 페이지 렌더링 (OCR 입력용) |
| `cropEquationRegion(...)` | 599 | 수식 영역 크롭 |
| `cropTableRegion(...)` | 692 | 테이블 영역 크롭 |

### mineru-client.mjs
| 함수 | 역할 |
|------|------|
| `parsePdf(pdfBuf, opts)` | MinerU API 호출 (PDF → 구조화 결과) |
| `parseMineruResult(result)` | MinerU 출력 파싱 → sections/chunks/figures/tables/equations |
| `flattenTableHtml(html)` | HTML 테이블 → plain text |
| `flattenEquationLatex(latex)` | LaTeX 정리 |
| `saveFigureImages(paperId, figures, root)` | MinerU 이미지 저장 |

### grobid-client.mjs
| 함수 | 역할 |
|------|------|
| `extractMetadataAndReferences(pdfBuf)` | GROBID TEI XML → {title, abstract, authors, doi, year, journal, references} |
| `linkReferencesToExistingPapers(refs, supabase)` | 참고문헌 → 기존 DB 논문 매칭 (normalized_title) |

## 데이터 흐름

### V2 파이프라인 (MinerU + GROBID)
1. `isMineruAvailable()` 확인
2. `parsePdf()` → MinerU 구조화 결과
3. `parseMineruResult()` → sections, chunks, figures, tables, equations
4. `isGrobidAvailable()` → `extractMetadataAndReferences()` → 메타데이터+참고문헌
5. `crossValidateV2()` → V1과 비교 로깅
6. `persistV2Results()` → DB 저장
7. 빈 테이블 OCR 폴백 (`enhanceEmptyTablesWithOcr`)
8. embedding 큐 등록

### V1 파이프라인 (휴리스틱 + OCR)
1. `extractHeuristicPaperData()` → pdfjs 텍스트 추출
2. `persistHeuristicExtraction()` → sections, chunks, figures, tables, equations DB 저장
3. `extractTablesAndEquationsWithOcr()` → GLM-OCR (테이블 HTML, 수식 LaTeX)
4. `enhanceEquationsWithUniMERNet()` → 고품질 LaTeX
5. 수식 병합: UniMERNet(우선) + GLM-OCR(폴백), quality gate 적용
6. embedding 큐 등록

## 의존성
- 이 모듈이 사용하는 것: Supabase DB, MinerU API, GROBID API, Ollama(GLM-OCR), UniMERNet API, pdfjs-dist
- 이 모듈을 사용하는 것: main.mjs 폴링 루프

## 현재 상태
- 구현 완료: V1, V2, OCR 보강, 수식 병합 (UniMERNet + GLM-OCR)
- V2는 MinerU 가용 시에만 동작. GROBID 없이도 V2 부분 동작 가능
