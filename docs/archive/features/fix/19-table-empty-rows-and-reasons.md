# Fix: 테이블 생성 결과 개선 — 논문별 행 강제 + 빈 셀 명시("없음") + 사유 노출

> 유형: fix | 작성일: 2026-06-09 | 브랜치: `codex/rag-infra-extraction`
> 선행: fix 18(`18-table-generation-timeout.md`, P0-A/P0-B 완료) — 본 fix는 그 후속(P1 계열 + 사유 노출 신규)

## 문제

- **증상(실측)**: 흡착 논문 4편으로 "각 논문의 흡착제·q_max·온도를 비교 테이블로" 생성 시, 헤더(6열)와 references(4편)는 렌더되지만 **데이터 행이 0개**(헤더만, 내용 비어있음)다.
- **사용자 핵심 요구**: "데이터가 없으면 빈 테이블로 두지 말고, **뭐가 왜 없는지** 명시해야 한다."
  1. **논문별 행 강제 + 빈 셀 명시**: 비교 테이블이면 스코프 논문 각각이 행으로 나와야 함. 못 찾은 셀은 빈칸이 아니라 **"없음"/"N/A"**.
  2. **사유 노출**: 데이터를 못 찾았으면 **왜 없는지**(per-paper notes: "이 논문엔 q_max 데이터 없음" / "본문 검색 실패")를 사용자에게 보여줘야 함.

### 원인 추정 (코드 분석으로 확정)

이 증상은 **per-paper 추출 빈 결과 → 병합이 통째로 빈 테이블 생성 → 사유 폐기**의 연쇄다. fix 18의 P0가 "에러 화면"은 없앴지만 "빈 테이블 + 사유 누락"은 그대로 남았다.

#### (1) 왜 논문별 행이 안 만들어지고 통째 비는가 — `mergeExtractionResults`가 빈 결과 논문을 건너뜀

- `apps/desktop/electron/chat/table-extraction.mjs:233-289` `mergeExtractionResults`:
  - `for (const result of extractionResults)` 루프에서
    - `:234` `if (!result.success) continue;` — 실패 논문 스킵
    - `:235-236` `const dataRows = result.extraction?.data_rows ?? []; if (!Array.isArray(dataRows) || dataRows.length === 0) continue;` — **`data_rows`가 빈 배열이면 그 논문은 행을 아예 만들지 않고 건너뜀.**
  - 흡착 4편이 모두 `data_rows=[]`(아래 (3) 참조) → `rows.push`가 한 번도 일어나지 않음 → `rows=[]` 반환.
- 그 결과 `chat/table-pipeline.mjs:573` `if (!tableJson.rows || tableJson.rows.length === 0)`가 참 → `extractionFallbackNeeded=true`로 single-call fallback 진입.
- fallback도 데이터가 없으면(또는 timeout) `chat/table-pipeline.mjs:609-619`에서 **빈 테이블(`rows: []`) + 일반 notes**만 반환. (fix 18 P0-A로 추가된 salvage 경로 — 에러 대신 빈 테이블.)
- 즉 **논문별 행을 강제하는 로직이 어디에도 없다.** 병합은 "데이터가 있는 행만" 만들고, fallback은 "단일 LLM이 만든 행"만 만든다. 둘 다 0행이면 빈 테이블.

#### (2) per-paper notes(사유)가 어디서 버려지는가 — 추출→병합→persist 전 구간에서 notes 미사용

- **추출 단계(생성됨)**: `extractColumnsFromPaper`(`llm-orchestrator.mjs:527-591`)의 반환 스키마 `PAPER_EXTRACTION_SCHEMA`(`:424-450`)에 **`notes` 필드 존재**. 프롬프트(`:493`, `:497`)가 "데이터 없으면 그 사유를 영어 notes로" 쓰도록 지시. 로그의 "no fitted isotherm model parameters reported"가 바로 이 `extraction.notes`.
- **파이프라인 저장(보존됨)**: `runPerPaperExtraction`(`chat/table-pipeline.mjs:495-501`, `:506-513`)이 `extractionResults`에 `extraction`(전체 객체) 통째로 저장 → `extraction.notes`는 메모리상 **살아있음**.
- **병합 단계(폐기됨 ①)**: `mergeExtractionResults`(`table-extraction.mjs:222-327`)는 `result.extraction.data_rows`만 읽고 **`result.extraction.notes`를 한 번도 참조하지 않음**. 반환 `tableJson.notes`는 `:312`에서 **항상 빈 문자열 `""`**.
- **저장 단계(전달 안 됨 ②)**: `persistTableReport`(`chat/table-pipeline.mjs:887-999`):
  - `chat_messages.content`에는 `JSON.stringify(tableJson)`(`:930`)로 `tableJson.notes`가 들어가지만(현재 항상 ""),
  - **프론트가 읽는 `chat_generated_tables`에는 `notes`/사유가 매핑되지 않음**. `extractionMetadata`(`:913-922`)에 `partialFailures`(`:917`, error만)는 있어도 per-paper **notes(사유)는 없음**.
- **프론트 단계(표시 안 됨 ③)**: `frontend/src/features/chat/ChatTableReport.tsx`는 `table.headers`/`table.rows`만 렌더(`:53-54`). `notes`/`metadata`를 **표시하는 UI가 전혀 없음**. `ChatGeneratedTable` 타입(`frontend/src/types/chat.ts:60-70`)에도 `notes`/`metadata` 필드 없음.

→ **결론**: per-paper가 낸 사유는 `extractionResults[i].extraction.notes`까지는 살아있으나, **병합에서 읽지 않고 → metadata에 담지 않고 → 타입/렌더에 없어서** 3중으로 버려진다.

#### (3) 왜 4편 모두 `data_rows=0`인가 (P1 — 데이터를 더 찾게)

fix 18이 분석한 그대로(중복 분석 생략, 요지만):
- **(3-a) chunks 쏠림**: 테이블 모드 청크는 `rerankChunksIfAvailable`의 전역 top-15만 반환 → 특정 논문에 쏠려 일부 논문은 `chunksByPaper.get(pid)`가 비고 per-paper 컨텍스트 `chunks 0 chars`(`chat/table-pipeline.mjs:330`, `:458`). 테이블 figure만 backfill된 논문은 OCR/parsed table만으로 추출.
- **(3-b) 실제 데이터 부재**: 그 논문에 spec이 요구한 파라미터(q_max 등)가 실제로 없으면 LLM이 정당하게 빈 배열 반환(`EXTRACTION_AGENT_SYSTEM_PROMPT:502`). **버그 아님 — 코드로 못 없앰.**
- **(3-c) 60초 타임아웃**: per-paper 논문당 60초(`chat/table-pipeline.mjs:478`), 초과 시 fail.

→ **본 fix의 우선순위는 "없으면 명시"(1·2)다.** (3)은 빈 결과를 **줄이는** 보조(P1)일 뿐 본질이 아니다. (3-b)는 어차피 코드로 제거 불가하므로, (3)을 완벽히 고쳐도 "데이터가 진짜 없는 논문"은 남는다 → 그 논문을 **빈 행 + 사유로 보여주는 게 정답**(1·2)이라 (1·2)가 (3)보다 사용자 가치가 크고 우선이다.

## 수정 방안

핵심 설계: **빈 결과 논문도 "논문명 행 + 전 셀 N/A + 사유"로 만든다.** 사유는 per-paper `extraction.notes`를 살려 (i) 행 메타로 묶고 (ii) `chat_generated_tables.metadata`(기존 JSONB, **DB 변경 불필요**)에 담아 (iii) `ChatTableReport`가 표시한다.

### 처리 위치 결정

- **논문별 행 강제 + 빈 셀 N/A**: **`mergeExtractionResults`(병합)** 에서 처리. 이유 — 병합은 이미 스코프 논문 전체(`paperMetadata` + `paperRefMap`)와 per-paper 결과를 모두 보유. per-paper는 자기 논문만 알고, fallback은 비상 경로라 부적합.
- **사유(notes) 수집**: 같은 `mergeExtractionResults`에서 `result.extraction.notes`를 논문별로 모아 반환. persist에서 metadata로 저장.
- **fallback 진입 억제**: 병합이 "논문별 행"을 항상 만들면 `rows.length === 0`이 사라져 single-call fallback 자체가 거의 안 일어남(부수 효과로 fix 18의 timeout 경로도 함께 줄어듦).

| 우선순위 | 파일 | 수정 내용 |
|------|------|-----------|
| **P0-1** (논문별 행 강제) | `apps/desktop/electron/chat/table-extraction.mjs` | `mergeExtractionResults`(`:222-327`): per-paper 결과를 순회한 뒤, **데이터 행이 하나도 안 만들어진 스코프 논문**(빈 `data_rows` 또는 `success=false`)에 대해 **placeholder 행**을 생성한다 — 식별 열(헤더 첫 칸, 보통 Adsorbent)은 **논문 제목/식별값**, 나머지 셀은 모두 `"N/A"`(또는 로케일에 맞춘 "없음"; UI 표기 통일은 P1-3). `:236`의 `continue`를 "행 0개면 placeholder 1행 push"로 대체. 단 **이미 데이터 행이 있는 논문은 placeholder를 추가하지 않음**(중복 방지). placeholder 행은 N/A 비율 50% 폐기 규칙(`:270`)에서 **제외**(placeholder는 의도적으로 비는 행). |
| **P0-2** (사유 수집) | `apps/desktop/electron/chat/table-extraction.mjs` | 같은 함수에서 `result.extraction?.notes`(영어 사유)와 `result.success/error`를 논문별로 모아 `reasons` 구조를 만들어 반환. 형태(초안): `reasons: [{ paperId, paperTitle, refNo, hadRows: boolean, note: string, failed: boolean }]`. 데이터 행이 있던 논문은 `hadRows=true`(사유 불필요), 빈 논문은 LLM notes 또는 기본 사유("No matching data found in this paper" / 실패 시 error 요약). 반환 시그니처를 `{ tableJson, nullSummary, reasons }`로 확장(기존 호출부 1곳만 영향). |
| **P0-3** (metadata 전달) | `apps/desktop/electron/chat/table-pipeline.mjs` | (a) `runStage3cMergeFallback`(`:567`)에서 `mergeExtractionResults` 반환의 `reasons`를 받아 `stage3cContext`로 전달. (b) `persistTableReport`(`:913-922`)의 `extractionMetadata`에 `perPaperReasons`(= reasons) 필드 추가. **`chat_generated_tables.metadata`(기존 JSONB 컬럼)** 에 저장되므로 마이그레이션 불필요. (c) [선택] `tableJson.notes`에 "N편 중 M편은 데이터 없음" 요약 1줄을 영어로 세팅(현재 항상 ""). |
| **P0-4** (타입) | `frontend/src/types/chat.ts` | `ChatGeneratedTable`(`:60-70`)에 옵셔널 `metadata?: ChatTableMetadata \| null` 추가. `ChatTableMetadata` 타입 신설: `{ extractionMode?: string; perPaperReasons?: PerPaperReason[]; partialFailures?: {paperId; paperTitle?; error}[]; ... }`. `useChatTable`이 `select("*")`(`chatQueries.ts:122`)라 매핑 변경 없이 그대로 전달됨. `notes`도 옵셔널로 추가 가능(`chat_generated_tables`엔 notes 컬럼이 없으므로 metadata 경유 권장). |
| **P0-5** (사유 렌더) | `frontend/src/features/chat/ChatTableReport.tsx` | 테이블 하단(References 위 또는 verification legend 근처)에 **"데이터 없음 안내" 섹션** 추가: `table.metadata?.perPaperReasons` 중 `hadRows=false`인 항목을 "[refNo] 논문 제목 — 사유" 리스트로 표시. 사유 문자열은 영어(LLM notes)지만 라벨/제목은 `t()` i18n. 항목이 없으면 섹션 미렌더. (placeholder 행의 N/A 셀은 기존 렌더로 이미 보임 — 추가 작업 불필요.) |
| **P1-1** (chunks 쏠림 완화, 선택) | `apps/desktop/electron/chat/table-pipeline.mjs` | (fix 18 P1-A 계승) `chunks 0 chars`인 논문에 backfill table figure의 `summary_text`가 per-paper 컨텍스트에 확실히 포함되는지 점검 + 빠지는 케이스 로깅. 빈 결과 자체를 **줄임**(없앰 아님). **본 fix 범위에 포함할지 사용자 판단 필요**(아래 "P1 포함 여부" 참조). |
| **P1-2** (CSV 사유 포함, 선택) | `apps/desktop/electron/main.mjs` | `CHAT_EXPORT_CSV`(`:2696-2746`)의 select에 `metadata` 추가(`:2702`), References 섹션 뒤에 "Notes / Missing data" 섹션으로 `perPaperReasons` 출력. CSV에도 "왜 없는지" 남김. |
| **P1-3** (셀 표기 통일, 선택) | `frontend/src/features/chat/ChatTableReport.tsx` 또는 병합 | placeholder/누락 셀을 "N/A" 대신 로케일 "없음"으로 표기 통일. **표기 정책은 가정 사항**(아래) — 코드 일관성상 셀 값은 "N/A" 유지(검증/CSV 호환), UI 라벨만 조정 권장. |

### placeholder 행 생성 상세 (P0-1 핵심 — 구현자 참고)

`mergeExtractionResults`에서 데이터 행 push가 끝난 뒤:

1. `coveredPaperIds = usedPaperIds`(데이터 행을 만든 논문). `:276`의 기존 set 재활용.
2. **스코프 논문 전체** = `paperMetadata` (병합에 이미 인자로 들어옴, `:291`).
3. `for (const p of paperMetadata)` 중 `!coveredPaperIds.has(p.paperId)`인 논문마다 placeholder 행 1개 생성:
   - `row[0]` = 식별값. **[미결]** 식별 열이 "Adsorbent" 같은 물질명일 때 논문 제목을 넣으면 의미가 안 맞을 수 있음 → 옵션: (A) 식별 열에 논문 제목, (B) 식별 열도 "N/A"로 두고 사유 섹션 + references[refNo]로 논문을 식별, (C) per-paper extraction이 식별값만이라도 뽑게 프롬프트 보강. **권장: (B)** — 식별 열에 가짜 물질명을 만들지 않음(추측 금지 원칙 유지), 어느 논문인지는 `[refNo]` + 하단 사유 섹션으로 연결. row 전체 N/A이되 references와 reasons로 추적.
   - 나머지 셀 = `"N/A"`.
   - 단 (B)면 row 전체가 N/A라 50% 폐기 규칙에 걸리므로 **placeholder는 폐기 규칙 우회 플래그**로 강제 포함.
4. placeholder 행에는 `[refNo]` 참조 태그를 식별 열 또는 별도 처리로 부여해 references와 연결(references는 `usedPaperIds` 기준이므로 **placeholder 논문도 references에 포함되도록** `usedPaperIds.add(p.paperId)` 필요 — 그래야 "헤더+references 4편"이 아니라 "행 4개+references 4편"이 됨).

> **[미결 A]** 식별 열 값 정책((A)/(B)/(C)) — 권장 (B). 사용자 승인 필요.
> **[미결 B]** placeholder 행을 표 안에 넣을지 vs 표는 데이터 행만 두고 "데이터 없는 논문"은 하단 사유 섹션으로만 보여줄지. 사용자 핵심 요구("빈 테이블로 두지 마라")는 **행으로 보이는 것**을 시사 → 권장: 표에 행으로 포함(B 방식 N/A 행) + 하단 사유. 사용자 승인 필요.

## 영향 범위

- **수정 파일**: P0만 **4개** (`table-extraction.mjs`, `table-pipeline.mjs`, `types/chat.ts`, `ChatTableReport.tsx`). P1 포함 시 최대 **6개**(+`main.mjs` CSV, +pipeline 로깅).
- **DB 변경**: **없음** — `chat_generated_tables.metadata`(기존 JSONB, 20260410012147) 재활용.
- **새 IPC**: **없음**.
- **새 컴포넌트/모듈**: **없음** — 기존 `ChatTableReport` 내 섹션 추가만.
- **`CURRENT_EXTRACTION_VERSION` 범프**: **불필요** — PDF 추출 산출물/임베딩 스키마 불변, 채팅 런타임 로직 + 표시 레이어만 변경.
- **사이드 이펙트**:
  - 병합이 항상 논문별 행을 만들면 `rows.length === 0`이 사라져 **single-call fallback 진입 빈도 급감** → fix 18 timeout 경로도 동반 감소(긍정적 부수효과).
  - placeholder 논문을 `usedPaperIds`에 넣으면 references가 "사용 논문만"에서 "스코프 논문 전체"에 가까워짐 — 의도된 변화(비교 테이블은 스코프 전체를 보여줘야 함). 단 `enrichSourceRefsWithEvidence`(`source-evidence.mjs`)가 evidence 없는 ref를 처리하는지 1회 확인.
  - Guardian 검증(`scheduleGuardianVerification`, `table-pipeline.mjs:1023-1032`)은 N/A·비수치 셀을 이미 스킵하므로 placeholder N/A 행은 검증 대상에서 자동 제외 — 영향 없음.
  - `mergeExtractionResults`는 단위 테스트 대상일 가능성(아래 검증) → placeholder 로직이 기존 "데이터 있는 행" 케이스를 깨지 않아야 함(데이터 있는 논문엔 placeholder 미추가).

## 검증 방법

1. **문법 체크**: `node --check apps/desktop/electron/chat/table-extraction.mjs` / `node --check apps/desktop/electron/chat/table-pipeline.mjs` (+CSV 수정 시 `main.mjs`).
2. **단위/회귀 (vitest, `apps/desktop`)**: 기존 `tests/table-pipeline.test.mjs`(fix 18에서 21건) + `mergeExtractionResults` 테스트가 있으면 통과 확인. 신규 케이스 추가 권장:
   - 4편 모두 `data_rows=[]` → 병합 결과 `rows.length === 4`(논문별 placeholder), 각 행 전 셀 N/A, `reasons` 4건(hadRows=false + note), references 4건.
   - 일부 논문만 데이터 있음(2편 데이터/2편 빈) → 데이터 행 + placeholder 2행 공존, 데이터 논문엔 placeholder 미생성(중복 없음).
   - `extraction.notes`가 metadata `perPaperReasons`로 전달되는지(persist 더블로 확인).
3. **프론트 빌드/타입**: `cd frontend && npm run build`(tsc -b) — `metadata`/`ChatTableMetadata` 타입 정합성.
4. **실앱 재현(흡착 4편)**: 동일 요청으로 (a) 표에 **논문 4행**이 보이는지(빈 셀 N/A), (b) 하단에 **"데이터 없음 + 사유"** 섹션이 보이는지, (c) `CHAT_SEND_MESSAGE error`/빈-헤더-only가 사라졌는지.
5. **빈 테이블 렌더 회귀**: 진짜로 RAG가 0건(`handleNoDataAction`)인 경우는 기존대로 "관련 데이터 없음" 텍스트 메시지로 가는지(이 경로는 placeholder 대상 아님 — 스코프 논문이 없으므로).

## P1 포함 여부 판단 (사용자 결정 요청)

- **P0(1~5)** = 사용자 핵심 요구 직접 충족("없으면 명시 + 사유"). **본 fix의 필수 범위.**
- **P1-1(chunks 쏠림)** = 빈 결과를 줄여 placeholder/N/A를 덜 나오게 함. **별도 후속 권장.** 이유: (i) RAG 검색 파이프라인(`runMultiQueryRag`/reranker) 영역이라 표시 레이어와 결합도가 낮고 회귀 위험이 다름, (ii) fix 18에서 이미 P1으로 분리·미구현 상태라 그 연장선, (iii) P0만으로 "왜 없는지"는 충족되며 P1은 "있는 데이터를 더 찾는" 직교 개선. → **권장: P0 먼저 본 fix로, P1-1은 별도 fix로 분리.**
- **P1-2(CSV 사유), P1-3(표기 통일)** = 저비용. **본 fix에 함께 넣어도 무방**(같은 파일군). 사용자 선호에 따라 포함/제외.

## 규모 판단

- 수정 파일 P0 4개(P1 포함 시 6개), **DB/IPC/새 컴포넌트/새 모듈 없음**, 기존 metadata JSONB 재활용 → **소규모 수정(fix) 기준 충족**.
- 단, `mergeExtractionResults`의 행 생성 로직 변경은 파급(병합→fallback→persist→타입→렌더)이 여러 파일에 걸치고 placeholder 정책에 [미결 A/B]가 있어, **fix이되 구현 전 정책 승인이 필요**한 케이스.
- **권장 경로**: `/fix`. P0(1~5)를 한 묶음으로 구현 → 검증 → P1은 별도 판단. [미결 A](식별 열 값), [미결 B](placeholder 행 vs 사유-섹션-만)는 구현 착수 전 사용자 승인.

## 가정 사항

- **[가정]** per-paper가 데이터 없을 때 `extraction.notes`에 사유를 비교적 일관되게 채운다(프롬프트가 지시하나 LLM이 빈 notes를 줄 수도 있음). → notes가 비면 기본 사유("No matching data found in this paper" / 실패 시 "Extraction failed: {error}")로 폴백한다(P0-2).
- **[가정]** `chat_generated_tables.metadata` JSONB는 임의 구조를 허용하며(`COMMENT`상 SRAG metadata 용도), `perPaperReasons` 추가가 기존 `nullSummary`/`agenticRecovery` 소비 코드를 깨지 않는다. → 검증 2로 확인.
- **[가정]** `ChatTableReport`가 `rows`에 N/A 행이 늘어도 정상 렌더(기존에도 N/A 셀 존재). verification 색상은 N/A 셀에 안 붙음(검증이 N/A 스킵). → 검증 4로 확인.
- **[가정·미결]** placeholder 식별 열 정책은 (B)(식별 열도 N/A, references+reasons로 논문 식별)을 기본 권장하나 사용자가 (A)(제목 표기)를 원하면 변경. → [미결 A].
