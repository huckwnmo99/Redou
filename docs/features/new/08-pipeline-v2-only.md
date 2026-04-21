# PDF 처리 파이프라인 V2 단일화 (V1 휴리스틱 폴백 제거)

> 유형: feature | 상태: 계획 | 작성일: 2026-04-18

## 개요

- **목적**: PDF 처리 파이프라인을 V2(MinerU + GROBID)로 단일화한다. V1(pdfjs 휴리스틱 + GLM-OCR + UniMERNet) 폴백 경로를 제거하여 파이프라인을 단순화하고 유지보수 부담을 줄인다.
- **전제**: MinerU(port 8001), GROBID(port 8070), UniMERNet(port 8010), Ollama(GLM-OCR 용)는 항상 가동 중이라고 가정한다. 즉, 서비스 불가용 시에는 "처리 실패"로 명확히 에러를 반환하고, 오래된 V1 휴리스틱으로 대체하지 않는다.
- **범위 (포함)**:
  - `processImportPdfJob`의 V1 폴백 분기 제거 (pdfjs 휴리스틱 → persistHeuristicExtraction → GLM-OCR 테이블/수식 → UniMERNet 보강의 전체 경로).
  - V2 성공 흐름 단일화: MinerU/GROBID 호출 → parseMineruResult → persistV2Results → 임베딩 큐 등록.
  - 수식/테이블 OCR 보강(UniMERNet, GLM-OCR)은 V2 파이프라인의 "후속 보강 스테이지"로 **재설계**하여 편입.
    - V2에서 빈 테이블에 대한 GLM-OCR 폴백(`enhanceEmptyTablesWithOcr`)은 이미 존재 → 유지.
    - 수식은 현재 V1 전용 경로에서만 UniMERNet/GLM-OCR 병합이 돌아감 → V2 결과에도 동일 품질의 수식 LaTeX 보강이 필요한지 판단 후 편입 또는 제거.
  - MinerU/GROBID 미가용 시: 임포트 작업 실패 + 사용자에게 명확한 메시지.
  - `CURRENT_EXTRACTION_VERSION` bump → 기존 논문 자동 재추출 트리거.
  - 하네스 문서 개편 (V1 언급 제거, "단일 파이프라인"으로 재정리).
- **범위 (제외)**:
  - `inspectPdfMetadata` (임포트 전 제목/저자 미리보기)는 **유지**. MinerU 호출 없이 빠르게 제목/연도만 뽑는 경량 기능이므로 통합 대상 아님. (단, 의존하는 pdf-heuristics의 헬퍼는 유지할 범위 확정 필요.)
  - `extractFigureImagesFromPdf` (V2에서 이미지 없는 figure 폴백으로 사용 중)는 **유지**.
  - V1 시절 생성된 DB 데이터의 마이그레이션/삭제. (extraction_version bump로 자동 재추출되므로 별도 마이그레이션 불필요.)
  - GLM-OCR / UniMERNet / pdfjs 라이브러리 자체의 제거. (보강용으로 일부 코드 경로에서 계속 필요.)

## 배경 & 현재 상태

`main.mjs:1163~1574`의 `processImportPdfJob`는 아래 구조로 되어 있다.

```text
isMineruAvailable() 확인
├─ true → processWithMineruGrobid (V2)
│   ├─ 성공 → V2 결과 저장 → 빈 테이블 GLM-OCR 폴백 → embedding 큐 → return
│   └─ 실패 → catch (warn) → 아래 V1 폴백으로
└─ false → "MinerU not available, using V1 pipeline" 로그
   ↓
V1 폴백: persistHeuristicExtraction
├─ extractHeuristicPaperData (pdfjs + 섹션/청크 휴리스틱)
├─ 섹션/청크/figure/table/equation 저장
├─ GLM-OCR (테이블 HTML + 수식 LaTeX)
├─ UniMERNet + GLM-OCR 수식 품질 기반 병합
└─ embedding 큐
```

V1 폴백 분기는 약 250줄(main.mjs 1313~1574) + V1 전용 함수 `persistHeuristicExtraction`(520~742), `describeExtractionMode`(428~438), `buildHeuristicSummaryPayload`(440~472), `upsertCurrentPaperSummary`(474~518)로 구성되어 있다. V2 경로에는 별도의 `upsertPaperSummaryV2`(1041~1087)가 따로 존재한다.

## 설계

### 1. 분기 제거 & 에러 정책

**before (main.mjs 1216~1311):**
```js
const mineruAvailable = await isMineruAvailable();
if (mineruAvailable) {
  try { const v2Result = await processWithMineruGrobid(...); if (v2Result) { ... return; } }
  catch (v2Err) { /* warn, fall through to V1 */ }
} else { /* log, fall through to V1 */ }
// --- V1 폴백 ---
```

**after:**
```js
// V2 단일 파이프라인 — 서비스 미가용 또는 실패 시 즉시 에러 throw
const [mineruOk, grobidOk] = await Promise.all([
  isMineruAvailable(),
  isGrobidAvailable(),
]);
if (!mineruOk) throw new Error("MinerU is not available (http://localhost:8001). Start MinerU service before importing PDFs.");
// GROBID는 degraded mode 허용 (메타데이터 누락만 감수, 구조화는 MinerU만으로 가능)
if (!grobidOk) console.warn("[pipeline] GROBID not available, proceeding with MinerU-only metadata");

const v2Result = await processWithMineruGrobid({ ... });
if (!v2Result) throw new Error("Pipeline V2 (MinerU+GROBID) failed to produce a valid result.");
// V2 성공 후: 빈 테이블 GLM-OCR 폴백 → 임베딩 큐 → 완료 broadcast
```

**MinerU는 필수 / GROBID는 degraded mode 허용**으로 분리한다. 근거:
- MinerU가 없으면 sections/chunks/figures/tables/equations 자체가 없다 → 진행 불가.
- GROBID가 없어도 MinerU sections/title로 메타데이터 병합은 가능 (현재 mergeMetadata가 이미 `fallbackTitle` 처리).

[가정] GROBID degraded mode를 허용하는지 사용자 확인 필요. "항상 켜져 있다고 가정"이라면 GROBID도 필수(`throw`)로 처리. 기본은 "MinerU 필수 / GROBID 선택"으로 두되 사용자 승인 시 둘 다 필수로 변경.

### 2. 수식 LaTeX 보강 (UniMERNet + GLM-OCR) 위치 재검토

현재 UniMERNet 수식 병합은 V1 경로에서만 돈다. V2(MinerU)는 수식 LaTeX를 자체적으로 추출하지만, 품질이 UniMERNet 대비 낮을 수 있다. 3가지 옵션:

| 옵션 | 설명 | 리스크 |
|------|------|--------|
| A. 제거 | V1과 함께 UniMERNet/GLM-OCR 수식 병합 로직도 제거 | MinerU 수식 품질이 부족하면 퇴행 |
| B. V2에 편입 | V2 성공 후 수식 보강 스테이지 실행 (V1의 heuristicEquations 대신 DB에서 방금 저장한 equations를 읽어와 figureNo/page 정보로 UniMERNet 입력 구성) | 좌표 기반 크롭은 V1 전용 휴리스틱 데이터에 의존 → 적응 필요 |
| C. 보류 | 당분간 V1 수식 품질 보강 코드는 V2 경로에서 돌지 않게 두고, 별도 후속 작업으로 추적 | 단기 품질 저하 가능성 |

**권장**: 기본은 **A(제거)**. 이유: MinerU는 이미 `formula_enable: true`로 LaTeX를 추출하며, UniMERNet 크롭은 `heuristicEquations`의 coordinate 필드(_bodyYEnd 등)에 의존하므로 V2 MinerU bbox로 치환하는 것 자체가 별도 작업. 품질 퇴행이 확인되면 후속으로 옵션 B를 계획.

[가정] 사용자 확인 필요: MinerU 수식 품질이 실무에서 충분한지. 불충분하면 옵션 B를 택해야 하며 계획서를 확장해야 함.

### 3. 하네스 문서 일원화

이 변경은 "V1 파이프라인" 개념을 없앤다. 다음 문서의 V1/V2 이원 서술을 단일 파이프라인 서술로 개편한다.

- `docs/harness/main/overview.md` (Pipeline V1/V2 용어집 항목)
- `docs/harness/main/flows.md` (§1 PDF 임포트 흐름)
- `docs/harness/main/feature-status.md` (V1(휴리스틱)+V2(MinerU+GROBID) → V2 단일)
- `docs/harness/detail/electron/pdf-pipeline.md` (V1/V2 섹션 → 단일 파이프라인)

### 4. 코드 변경 상세

#### `apps/desktop/electron/main.mjs`

| 대상 | 동작 | 줄 범위 |
|------|------|---------|
| `CURRENT_EXTRACTION_VERSION` | 24 → 25로 bump | 98 |
| imports | `extractHeuristicPaperData` 제거. `inspectPdfMetadata`, `extractFigureImagesFromPdf`는 유지 | 11 |
| OCR imports | `extractTablesAndEquationsWithOcr`, `enhanceEquationsWithUniMERNet`는 V1 전용이면 제거 (옵션 A 선택 시) | 주변 imports |
| `describeExtractionMode` | V1 전용 → 삭제 | 428~438 |
| `buildHeuristicSummaryPayload` | V1 전용 → 삭제 | 440~472 |
| `upsertCurrentPaperSummary` | V1 전용 → 삭제 (V2는 `upsertPaperSummaryV2` 사용 중) | 474~518 |
| `persistHeuristicExtraction` | V1 전용 → 삭제 | 520~742 |
| `crossValidateV2` 내 pdfjsData 비교 | V1 데이터에 의존 → 삭제 또는 단순화 (현재도 경고 로그뿐이므로 제거 권장) | 759~776, 그리고 1119~1126의 호출부 |
| `processImportPdfJob` | V1 폴백 블록 전체 삭제, V2 분기 단순화, MinerU 미가용 시 throw | 1163~1574 |
| `requeueOutdatedPapers` | 변경 없음 (bump만으로 자동 트리거) | 2005~2068 |

#### `apps/desktop/electron/pdf-heuristics.mjs`

| 대상 | 동작 |
|------|------|
| `extractHeuristicPaperData` 및 그 헬퍼들 (extractHeuristicPaperData가 호출하는 섹션/청크/figure/table/equation 휴리스틱) | 삭제 검토. 그러나 `inspectPdfMetadata`와 `extractFigureImagesFromPdf`가 참조하는 헬퍼(readPdfPagesWithPdfJs, chooseDerivedTitle, detectPublicationYearFromText, extractFirstAuthor, extractAuthors 등)는 유지해야 함. 공유 유틸과 V1 전용 로직을 분리해 V1 전용만 제거 |
| 파일 전체를 둘로 쪼개는 안 | `pdf-preview.mjs` (유지) + `pdf-figure-images.mjs` (유지) + V1 전용 파일 삭제 — [가정] 리팩토링 범위가 커질 수 있어, 1차는 한 파일에서 V1 전용 블록만 주석 삭제 방식으로 진행 |

주의: 2303줄짜리 파일에서 V1 전용 블록을 정확히 잘라내려면 `extractHeuristicPaperData` 함수 body와 그 내부 호출 의존성을 추적해야 한다. 삭제 범위는 `/develop` 단계에서 최종 확정.

#### `apps/desktop/electron/ocr-extraction.mjs`

- `extractTablesAndEquationsWithOcr` — V1 전용. 옵션 A 선택 시 삭제 대상.
- `enhanceEquationsWithUniMERNet` — V1 전용(heuristicEquations 좌표 의존). 옵션 A 선택 시 삭제.
- `enhanceEmptyTablesWithOcr` — V2에서 사용 중 → **유지**.
- 내부 헬퍼(`renderPageToPng`, `cropEquationRegion`, `cropTableRegion` 등) 중 enhanceEmptyTablesWithOcr에서 쓰는 것만 남기고 V1 크롭 전용은 삭제.

#### DB 영향

- 스키마 변경 없음.
- 기존 데이터: `CURRENT_EXTRACTION_VERSION` bump로 모든 논문이 자동 재추출 큐에 올라간다. MinerU가 없으면 작업 실패 상태가 됨 → 사용자에게 서비스 기동 안내 UI 필요 [가정: ProcessingView/Toast 메시지 확인 필요].

#### Frontend 영향

- UI에 노출되는 파이프라인 버전 문구가 있다면 제거. `pipelineVersion: "v2"` 문자열이 JOB_COMPLETED payload에 포함되어 있으나 프론트엔드에서 사용되는 흔적은 grep 결과 없음 → 제거 가능.
- `JOB_PROGRESS` 메시지에서 "Pipeline V2: ..." 문구를 "PDF 분석 중..."으로 개편하여 파이프라인 노출을 줄인다.

### 5. 에러 UX

MinerU(및 옵션에 따라 GROBID)가 꺼져 있으면 import job이 실패한다. 사용자에게 다음과 같은 안내가 필요하다:

- `JOB_FAILED` payload에 사용자 친화적 메시지: "MinerU 서비스가 실행되지 않았습니다. Docker 컨테이너를 시작한 뒤 다시 시도해주세요."
- `apps/desktop/electron/main.mjs`의 에러 처리에서 MinerU/GROBID 관련 에러는 별도 에러 코드/메시지로 분류.

[가정] 프론트엔드에 "서비스 상태" 표시가 있는지는 추후 확인. 없다면 별도 이슈로 백로그 추가.

## 작업 분해

`/develop` 에이전트가 이 순서대로 실행한다.

1. [ ] (계획) 사용자와 3가지 결정사항 확정
   - GROBID degraded mode 허용 여부 (기본 권장: 허용)
   - 수식 LaTeX 보강(UniMERNet + GLM-OCR) 처리 방침 (기본 권장: 옵션 A - 제거)
   - `extractTablesAndEquationsWithOcr`, `enhanceEquationsWithUniMERNet` 전면 삭제 승인 여부
2. [ ] `CURRENT_EXTRACTION_VERSION` 24 → 25 bump
3. [ ] `processImportPdfJob` 리팩토링:
   - V2 분기를 기본 흐름으로 승격
   - MinerU 미가용 시 throw
   - GROBID 미가용 시 경고 로그 + 진행
   - V1 폴백 블록(1313~1574) 전체 삭제
4. [ ] V1 전용 함수 삭제: `describeExtractionMode`, `buildHeuristicSummaryPayload`, `upsertCurrentPaperSummary`, `persistHeuristicExtraction`
5. [ ] `crossValidateV2` 및 `processWithMineruGrobid` 내부의 pdfjs 교차검증 블록(1119~1126) 제거
6. [ ] `pdf-heuristics.mjs`에서 `extractHeuristicPaperData` 및 V1 전용 헬퍼 제거. 공유 헬퍼(`readPdfPagesWithPdfJs`, `chooseDerivedTitle`, title/year 감지 유틸)는 보존해 `inspectPdfMetadata` + `extractFigureImagesFromPdf`가 정상 작동하는지 보장
7. [ ] `ocr-extraction.mjs`에서 V1 전용 함수/헬퍼 제거 (옵션 A 기준). `enhanceEmptyTablesWithOcr`와 그 의존 헬퍼만 유지
8. [ ] `main.mjs`의 import 구문 정리 (불필요 import 제거)
9. [ ] `JOB_PROGRESS`/`JOB_FAILED` 메시지 개편:
   - "Pipeline V2: ..." → "PDF 분석 중..."
   - MinerU 미가용 에러는 사용자 친화적 메시지로 변환
10. [ ] Node 문법 체크: `node --check apps/desktop/electron/main.mjs`, `pdf-heuristics.mjs`, `ocr-extraction.mjs`
11. [ ] 하네스 갱신
    - `docs/harness/main/overview.md` 용어집: "Pipeline V1" 항목 삭제, "Pipeline V2"를 "PDF 처리 파이프라인"으로 변경
    - `docs/harness/main/flows.md` §1: V1/V2 분기를 단일 흐름으로 재작성
    - `docs/harness/main/feature-status.md`: 해당 행 "V1(휴리스틱)+V2(MinerU+GROBID)" → "V2 단일 (MinerU+GROBID)" + 이 기능 행을 "✅ 구현됨 (V2 단일화, 이번 작업)"으로 업데이트
    - `docs/harness/detail/electron/pdf-pipeline.md` 전면 개편
12. [ ] (develop 후 tester 단계에서) 기존 논문 1건을 수동으로 재추출 돌려 정상 작동 확인

## 영향 범위

- **수정되는 기존 파일**:
  - `apps/desktop/electron/main.mjs` (대폭 축소, -약 450줄 추정)
  - `apps/desktop/electron/pdf-heuristics.mjs` (V1 전용 로직 삭제, -수백줄)
  - `apps/desktop/electron/ocr-extraction.mjs` (V1 전용 함수 삭제)
  - `docs/harness/main/overview.md`
  - `docs/harness/main/flows.md`
  - `docs/harness/main/feature-status.md`
  - `docs/harness/detail/electron/pdf-pipeline.md`
- **CURRENT_EXTRACTION_VERSION bump**: **필요** (24 → 25)
- **DB 스키마 변경**: 없음
- **새 IPC 채널**: 없음
- **새 컴포넌트**: 없음
- **화이트리스트**(DB_QUERY_TABLES / DB_MUTATE_TABLES) 변경: 없음

## 리스크 & 대안

| 리스크 | 대안 |
|--------|------|
| MinerU가 꺼져 있으면 임포트 자체가 실패 → 사용자 경험 악화 | `JOB_FAILED` 메시지에 서비스 기동 안내. 장기적으로 설정 페이지에 서비스 상태 표시 위젯 추가(별도 백로그). |
| MinerU 수식 LaTeX가 UniMERNet 대비 품질 저하 가능 | 옵션 B(UniMERNet을 V2에 편입)를 후속 작업으로 추적. 먼저 옵션 A로 단순화한 뒤 품질 데이터 수집. |
| `pdf-heuristics.mjs`의 V1 로직 제거 시 `inspectPdfMetadata`/`extractFigureImagesFromPdf` 공유 헬퍼를 실수로 삭제 | 삭제 전 grep으로 의존성 그래프 재확인. 1차는 `extractHeuristicPaperData` 함수만 제거하고 나머지 헬퍼는 남기는 보수적 접근. |
| bump에 의해 전체 논문이 재추출 큐에 올라감 — 많은 논문이 있으면 MinerU 부하 | 기존에도 bump마다 발생하는 정상 동작. MinerU 동시성 설정은 별도 이슈. |
| V1 코드 삭제가 곧 기능 회귀를 유발하지 않는지(예: UniMERNet 수식 품질) | tester 단계에서 대표 논문 1~2건 재처리 후 figures/equations 품질 육안 확인. 회귀 발견 시 옵션 B 경로로 전환. |

## 가정 사항 (사용자 확인 필요)

1. **GROBID degraded mode 허용 여부**
   - 기본 제안: MinerU는 필수(throw), GROBID는 선택(경고 후 진행).
   - 대안: 요청 문구대로 "항상 켜져 있다고 가정" → GROBID도 필수(throw).
2. **UniMERNet/GLM-OCR 수식 보강 처리 방침**
   - 기본 제안: 옵션 A (삭제, MinerU 기본 LaTeX만 사용).
   - 대안: 옵션 B (V2에 편입), 옵션 C (당분간 보류하고 후속 작업으로).
3. **V2 OCR 빈 테이블 폴백(`enhanceEmptyTablesWithOcr`) 유지**
   - 기본 제안: 유지.
4. **`inspectPdfMetadata` 유지**
   - 기본 제안: 유지 (임포트 다이얼로그 프리뷰에 필수).
5. **프론트엔드 수정 범위**
   - 기본 제안: IPC payload의 `pipelineVersion` 필드 제거, JOB_PROGRESS 메시지 문구 정리 정도. 추가 UI 변경 없음.

## 검증 방법

- `node --check` 3개 파일 통과
- 기존 논문 1건을 version bump 트리거로 자동 재추출 → 섹션/청크/figures/tables/equations가 V2 경로로 정상 저장
- MinerU 서비스를 내린 상태로 import 시도 → 친화적 에러 메시지 확인
- 하네스 문서에서 "V1", "휴리스틱 폴백" 잔존 언급 없는지 grep 확인
