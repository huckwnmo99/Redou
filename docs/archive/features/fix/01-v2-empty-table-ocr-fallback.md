# V2 빈 테이블 OCR 폴백

> 유형: fix | 상태: 계획 | 작성일: 2026-04-08

## 문제

MinerU (V2 파이프라인)가 테이블을 감지하지만 `table_body` HTML 추출에 실패하면, 해당 테이블이 `summary_text`, `plain_text` 모두 빈 상태로 DB에 저장된다. V2 파이프라인은 `main.mjs:1250`에서 `return`하므로 V1 전용 OCR 보강 단계(1289~1344행)에 도달하지 않는다.

**증거**: 33개 테이블 중 1개 (ethane/ethylene 논문의 Table 9, page 13 부록)에서 확인.

## 근본 원인

```js
// main.mjs:1250
return; // V2 성공 — 여기서 종료 → GLM-OCR 보강(1289~1344행) 도달 불가
```

## 설계 결정

**기존 `extractTablesAndEquationsWithOcr()` 재사용 불가:**
- V1 휴리스틱 좌표계(`_captionY`, `_bodyYEnd` 등)를 기대
- V2 테이블은 MinerU의 `bbox` 형식 → 좌표 변환이 부정확

**선택: 전체 페이지 OCR (full-page)**
- 빈 테이블이 있는 페이지만 렌더링 → GLM-OCR `FULLPAGE_TABLE_PROMPT`
- 크롭 좌표 불필요
- 빈 테이블이 극소수이므로 성능 영향 최소

## 수정 내용

### 1. `ocr-extraction.mjs` — `enhanceEmptyTablesWithOcr()` 추가

```js
/**
 * V2에서 MinerU가 table_body 추출 실패한 테이블을 GLM-OCR로 보강.
 * @param {Buffer} pdfBuffer
 * @param {Array<{figureNo, page}>} emptyTables
 * @returns {Array<{figureNo, page, summaryText}>}
 */
export async function enhanceEmptyTablesWithOcr(pdfBuffer, emptyTables)
```

로직:
1. `isOllamaAvailable()` 확인
2. 테이블을 페이지별 그룹핑
3. 각 페이지: `callWithScaleRetry()` → `parseAllTablesFromResponse()` → `validateTableHtml()`
4. 빈 테이블 수만큼 순서대로 매칭

### 2. `main.mjs` — V2 성공 후 빈 테이블 OCR 폴백 삽입

위치: `return;` (1250행) 바로 앞.

1. DB에서 `summary_text`가 null/빈 값인 테이블 조회
2. 있으면 `enhanceEmptyTablesWithOcr()` 호출
3. 결과로 DB 업데이트

### 3. `main.mjs` — import 수정

`enhanceEmptyTablesWithOcr` import 추가.

## 수정 파일

| 파일 | 변경 |
|------|------|
| `apps/desktop/electron/ocr-extraction.mjs` | `enhanceEmptyTablesWithOcr()` 함수 추가 (~30행) |
| `apps/desktop/electron/main.mjs` | import 수정 + V2 빈 테이블 OCR 폴백 블록 삽입 |

## 테스트

1. Table 9 (page 13) 재처리 → `summary_text`가 유효한 HTML인지 확인
2. 정상 테이블 32개가 불필요하게 OCR되지 않는지 확인
3. Ollama 미설치 시 graceful skip 확인
4. OCR 실패 시 non-fatal → 나머지 파이프라인 정상 동작

## 리스크

- 빈 테이블 극소수 (33개 중 1개) → 추가 OCR 호출 1~2회 수준
- try-catch로 감싸서 실패해도 V2 결과 유지
- `plain_text`는 미업데이트 (향후 필요시 추가)
