# Phase 2-1 — 값 역매칭 검증기 + Guardian 좁히기

> 유형: feature (대규모 develop) | 상태: 구현 완료 | 작성일: 2026-07-03 | 슬라이스: 02

## 개요

- **목적**: Stage 4 검증을 **결정적(deterministic)**으로 만든다. cellTuples의 `source_hint`로 Stage 3a 파싱 매트릭스에서 셀 값을 코드로 되찾아(back-match) 찾으면 "code-verified"로 확정하고, **못 찾은 셀만** Guardian에 넘긴다 — 그것도 MeasHalu 유형별 좁은 질문으로. 검증 결과에 검증 주체(code/guardian)를 저장하고 프론트에 반영한다.
- **왜**: 현재 Guardian(`scheduleGuardianVerification`, `table-pipeline.mjs:1054`)은 **모든 수치 셀**을 자유형 "For X, the value of Y is Z" 질문으로 로컬 LLM(granite-guardian)에 던진다. SCITAB(EMNLP 2023)이 보인 대로 "표-주장 검증"은 GPT-4 제외 전 모델이 랜덤 수준인 본질적 난제다. 반면 셀 값의 상당수는 우리가 이미 파싱한 매트릭스(`parsedMatrices`)에서 **글자 그대로 되찾을 수 있다** — 이건 LLM 없이 확정 가능하다. Guardian은 "코드로 못 찾은 값"에만, MeasHalu(ACL 2026) 유형(단위 불일치·조건 불일치·값 조작)으로 좁혀 써야 신뢰할 수 있다.
- **범위**: (1) 값 역매칭 검증기(신규 `chat/value-backmatch.mjs`) (2) Guardian 대상 축소(역매칭 실패분만) (3) Guardian 질문을 MeasHalu 유형별로 좁힘 (4) `CellVerification`에 `method: "code" | "guardian"` + `checkType` 추가 (5) 프론트 배지/툴팁에 검증 주체 반영.
- **제외**: **추출 프롬프트 개선 금지**(R2 열 이름 grounding·T(K) 범위 등은 슬라이스 2 eval 이후 측정 기반). **외부 라이브러리 0개**. Guardian을 완전히 없애지 않음(역매칭 실패분의 안전망). DB 마이그레이션·새 IPC·`CURRENT_EXTRACTION_VERSION` 무변경(`verification` JSONB 재사용).

## 현재 동작 근거 (코드 실측)

- **Guardian은 전량 무차별**: `scheduleGuardianVerification`(`table-pipeline.mjs:1076-1091`)이 `tableJson.rows`의 모든 non-N/A 수치 셀(`/\d/.test`)을 `cellsToVerify`에 모으고, 50개 초과 시 균등 샘플링(`maxVerify=50`) 후 `checkGroundednessFn(combinedSource, claim)`으로 검증. claim은 `For ${headers[0..1] 값}, the value of ${headers[col]} is ${cleanValue}`(1103행) 자유형. `combinedSource`는 figure summary_text 1000자 + chunk 800자를 12000자로 자른 뭉치(1070-1074).
- **Guardian 응답은 이진**: `checkGroundedness`(`llm-chat.mjs:89`)는 granite-guardian에 "Context+Claim → Yes(ungrounded)/No(grounded)"만 물음. `{ status: "verified"|"unverified", evidence }` 반환.
- **파싱 매트릭스가 값의 원천**: `parseTableMatrices`(`table-pipeline.mjs:312`)가 OCR figure를 `parseAllHtmlTables`로 파싱해 `parsedMatrices[].tables[] = { headers, rows, caption, source:"code"|"llm", source_file_id, page }`를 만든다. 이 `rows`가 셀 값의 결정적 원천 — LLM이 여기서 값을 옮겼으므로 되찾을 수 있다.
- **source_hint가 매트릭스로의 포인터**: cellTuples[r][c].source_hint는 "Table 3"·"Fig. 2 caption"·"Section 3.2" 형식(`llm-orchestrator.mjs:514` 프롬프트)으로 저장됨. 매트릭스의 `caption`(예: "Table 3 ...")과 대조해 후보 테이블을 좁힐 수 있다. **단 source_hint가 비면**(로컬 모델이 안 채우면) 전체 매트릭스에서 역매칭(fail-soft).
- **verification 소비**: 프론트 `ChatTableReport.tsx:90-95`가 `verification` 배열을 집계해 "Verified"/"N unverified" 배지를 만들고, `getCellVerification`(32행)이 셀별 배경색·hover title(`v.status: v.evidence`)을 만든다. `CellVerification` 타입(`types/chat.ts:52`)은 `{ row, col, status, sourceChunkId?, evidence? }` — **검증 주체 필드 없음**.
- **파이프라인 배선**: `runTableConversationPipeline`(`table-pipeline.mjs:1280`)이 persist 후 `scheduleGuardianVerification`를 호출. `parsedContext.parsedMatrices`는 이 시점에 이미 존재하나 **scheduleGuardianVerification에 전달되지 않음** — 배선 추가 필요.

## 설계

### DB 변경

**없음.** verification 결과는 `chat_generated_tables.verification`(기존 JSONB 컬럼)에 저장. 각 원소에 `method`/`checkType` 필드를 추가할 뿐 컬럼 스키마 무변경.

### Electron (Backend)

**신규 모듈** `apps/desktop/electron/chat/value-backmatch.mjs` (ADR 0002 module ownership — 검증 로직을 파이프라인에서 분리):

- `normalizeNumericValue(raw) → string | null` — 셀에서 참조태그(`[1]`)·단위·공백을 벗겨 순수 숫자 문자열로 정규화(예: `"8.69 [1]"` → `"8.69"`). 비수치는 null.
- `buildMatrixValueIndex(parsedMatrices) → { byTable: Map<captionKey, Set<string>>, all: Set<string> }` — 모든 파싱 매트릭스 셀 값을 정규화해 (a) 캡션 키별 값 집합 (b) 전체 값 집합으로 인덱싱. 캡션 키는 source_hint 대조용으로 정규화(소문자·"table 3" 등 패턴 추출).
- `backMatchCell({ cellValue, sourceHint, valueIndex }) → { matched: boolean, scope: "source_hinted" | "any_matrix" | "none" }` — 정규화한 셀 값이 (1) source_hint가 가리키는 테이블 값 집합에 있으면 `source_hinted`(가장 강함) (2) 아무 매트릭스에나 있으면 `any_matrix` (3) 없으면 `none`. source_hint 부재 시 (1) 스킵.
- `MEASHALU_CHECK_TYPES` — Guardian에 넘길 좁은 질문 유형 상수: `unit_mismatch`·`condition_mismatch`·`value_fabrication`(MeasHalu 유형학). 각 유형별 claim 템플릿 함수.
- `buildNarrowGuardianClaim(cell, tuple, checkType) → string` — cellTuple의 unit/condition을 넣은 유형별 좁은 claim. 예:
  - `value_fabrication`: `"The value ${value} for ${identity} appears in the source"` (역매칭 실패분의 최종 확인).
  - `unit_mismatch`(tuple.unit 있을 때): `"${identity} ${column} is reported in ${tuple.unit}"`.
  - `condition_mismatch`(tuple.condition 있을 때): `"${identity} ${column}=${value} was measured ${tuple.condition}"`.

**수정** `apps/desktop/electron/chat/table-pipeline.mjs`:

- `scheduleGuardianVerification`를 **`runCellVerification`**(가칭)으로 재구성. 두 단계:
  1. **코드 역매칭 패스**(동기, LLM 없음): 모든 수치 셀에 `backMatchCell`. `matched`면 `{ row, col, status: "verified", method: "code", checkType: "backmatch", scope }`를 verification에 push. **이 셀들은 Guardian 대상에서 제외.**
  2. **Guardian 패스**(비동기, 역매칭 실패분만): `scope === "none"`인 셀만 `cellsToVerify`로 모아 기존 샘플링(maxVerify)·배치(batchSize=5) 적용. claim은 `buildNarrowGuardianClaim`으로 유형별 생성. 결과에 `method: "guardian"`, `checkType`(사용한 유형) 부착.
  - `combinedSource` 조립·`setImmediate`·`emitVerificationDone`·비차단 try/catch는 **보존**(Stage 4 계약 무변경).
- `runTableConversationPipeline`의 `scheduleGuardianVerification` 호출부(1280행)에 `parsedMatrices: parsedContext.parsedMatrices`, `cellTuples: stage3dContext.cellTuples` 인자 추가.

> [가정 A] 역매칭은 **정규화된 문자열 완전일치**로 판정(부분·근사 매칭 아님). 소수점 자릿수·단위 표기가 파싱 매트릭스와 최종 셀에서 동일하다는 전제 — E2E 원문 대조에서 "자릿수까지 일치" 확인됨(README). 불일치 시 `none`으로 Guardian 폴백하므로 안전(과소검증 아님).
> [가정 B] source_hint↔caption 대조는 "table N" 숫자 토큰 일치로 좁힘. caption 형식이 다양("Table 3", "TABLE 3.", "Table 3: ...")하므로 정규식으로 숫자만 추출해 비교. 실패 시 `any_matrix`로 폴백.

### Frontend

**타입** (`frontend/src/types/chat.ts`)
- `CellVerification`에 추가: `method?: "code" | "guardian"`, `checkType?: string`, `scope?: string`. 전부 선택(하위호환 — 기존 테이블 verification엔 없음).

**컴포넌트** (`frontend/src/features/chat/ChatTableReport.tsx`)
- 배지 집계(90-95행): 현재 "Verified"/"N unverified" 유지하되, **code-verified 개수**를 별도 계산해 툴팁에 노출(예: "검증됨 (코드 대조 N / Guardian M)"). 최소 구현은 배지 title 확장.
- 셀 hover title(`getCellVerification`→`verificationTitle`, 252행): `v.method === "code"`면 "코드 대조 확인", `guardian`이면 "Guardian: {checkType}" 문구를 evidence 앞에 붙임. `buildCellTitle`이 이미 tuple+verification title을 결합하므로 그 안에서 처리.
- 셀 배경색(`cellBgColor`): code-verified와 guardian-verified를 **같은 초록**으로 유지(둘 다 verified)하되, 최소 시각 구분이 필요하면 code-verified에 약간 더 진한 톤(선택, 후속 가능).

**네비게이션**: 변경 없음.

## 작업 분해

`/develop`가 이 순서대로 실행한다.

1. [x] **역매칭 코어** — 신규 `chat/value-backmatch.mjs`: `normalizeNumericValue`·`buildMatrixValueIndex`·`backMatchCell`(+ `extractTableToken`). 순수 함수, DB/LLM 무관.
2. [x] **MeasHalu 좁은 claim** — `value-backmatch.mjs`에 `MEASHALU_CHECK_TYPES`·`buildNarrowGuardianClaim`(+ `pickCheckType`). tuple의 unit/condition 유무로 유형 선택(condition > unit > fabrication).
3. [x] **Stage 4 재구성** — `table-pipeline.mjs`의 `scheduleGuardianVerification`를 코드 패스+Guardian 패스 2단계로. 코드 패스는 export한 순수 함수 `runCodeBackMatchPass`로 분리(단위 테스트 용이). 코드 패스 결과 즉시 push, Guardian은 `scope==="none"`분만. `method`/`checkType`/`scope` 부착. 기존 setImmediate·combinedSource·샘플링·batch·emit·비차단 계약 보존.
4. [x] **배선** — `runTableConversationPipeline` 호출부에 `parsedMatrices`(=`parsedContext.parsedMatrices`)·`cellTuples`(=`stage3dContext.cellTuples`) 전달.
5. [x] **프론트 타입** — `CellVerification`에 `method?`/`checkType?`/`scope?`(전부 선택, 하위호환).
6. [x] **프론트 렌더** — 배지 툴팁에 "코드 대조 N / Guardian M"(`verifiedBreakdownTitle`), 셀 hover에 검증 주체 문구(code="코드 대조 확인", guardian="Guardian: {checkType}").
7. [x] **테스트** — 신규 `tests/value-backmatch.test.mjs` 22건(정규화/캡션토큰/인덱스/역매칭 스코프/checkType/claim/`runCodeBackMatchPass`) + 파이프라인 테스트 신규 1건(매트릭스 백매치→Guardian 미호출·code-verified 원소 검증) + 기존 Guardian 테스트 갱신(claim MeasHalu화 + method/checkType 반영). `checkGroundednessFn` mock으로 코드 확정분 Guardian 미호출·실패분만 호출을 고정.
8. [x] **eval 배선(계획 취지 확장)** — `scripts/e2e-table-fidelity.mjs`(수동·CI-off)가 `emitVerificationDone` payload에서 검증 주체 분포("code back-match N / Guardian M/T")를 리포트에 출력. baseline "Guardian N/M verified" 축과 대응.

## 영향 범위

- 수정되는 기존 파일: `chat/table-pipeline.mjs`(Stage 4 함수 + 호출부), `frontend/src/types/chat.ts`, `frontend/src/features/chat/ChatTableReport.tsx`.
- 신규 파일: `chat/value-backmatch.mjs` + 그 테스트 `tests/value-backmatch.test.mjs`.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**(채팅 검증 경로).
- DB 마이그레이션: **불필요**(`verification` JSONB에 필드 부가).
- 새 IPC 채널: **없음**(`CHAT_VERIFICATION_DONE` 기존 이벤트에 확장 payload).

## 리스크 & 대안

- **R-1 역매칭 과소일치**: 셀 값이 파싱 매트릭스와 미세하게 다르면(반올림·단위 병기) code-verified를 놓쳐 Guardian으로 감 → **안전한 방향**(과대검증 아님, Guardian이 잡음). 완전일치가 너무 빡빡하면 정규화 규칙 강화(공백·천단위 구분·단위 분리)로 완화하되 근사매칭은 도입 안 함(오탐 위험).
- **R-2 source_hint 부재**: 로컬 모델이 source_hint를 잘 안 채우면 `any_matrix` 스코프로 폴백 — 여전히 코드 검증 가능(약간 약함). condition/unit이 비면 좁은 claim이 `value_fabrication`로 폴백.
- **R-3 single_call_fallback 경로**: 이 경로는 `cellTuples=null`·`parsedMatrices`는 있으나 셀↔source_hint 매핑 없음 → 역매칭은 `any_matrix`만, Guardian은 기존 자유형 claim로 폴백. 문서화(R-5 계열).
- **R-4 verification 이벤트 payload 확장**: 프론트가 새 필드를 모르면 무시(선택 필드라 안전). frontend 타입 먼저 반영.
- **R-5 Guardian 호출 급감의 착시**: 역매칭으로 Guardian 대상이 크게 줄면 "미검증"이 사라져 보일 수 있음 → 배지 툴팁에 "코드 대조 N / Guardian M"을 명시해 **무엇으로 검증됐는지 정직하게** 노출(투명성).

## 가정 사항 (developer 확인/판단)

- [가정 A] 역매칭 = 정규화 문자열 완전일치(근사 아님). 실패는 Guardian 폴백이라 안전.
- [가정 B] source_hint↔caption = "table N" 숫자 토큰 매칭. 실패 시 any_matrix 폴백.
- [가정 C] Guardian은 유지하되 역매칭 실패분·좁은 claim에만. 완전 제거 아님(안전망).
- [가정 D] `CellVerification` 신규 필드는 전부 선택(하위호환). 기존 테이블 verification 렌더 무영향.

## 검증 기준

1. `node --check`: `value-backmatch.mjs` + `table-pipeline.mjs` 통과.
2. `node --test tests/*.test.mjs`: 기존 90건 회귀 통과 + 신규 역매칭/claim/2단계 케이스.
3. **결정성 실증(단위)**: 파싱 매트릭스에 있는 값 → `checkGroundednessFn` mock이 **호출되지 않고** code-verified 확정. 매트릭스에 없는 값 → Guardian mock 호출됨. 이걸 테스트로 고정(핵심).
4. `frontend`: `npm run build`(tsc+vite) + vitest 회귀 통과, any 0. 배지/hover가 code/guardian 구분 노출.
5. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경 확인.
6. harness 갱신: `detail/electron/llm.md`(Stage 4 2단계 검증 계약) + `chat-table-pipeline-state.md`(Stage 4 행) + `feature-status.md`(Guardian 검증 행) + `VERSION.md` 범프.

## 실행 순서 메모

이 슬라이스가 **Phase 2의 1번**. 슬라이스 03(골든 픽스처 eval)이 이 검증기의 code-verified/guardian 분포를 측정 대상으로 삼으므로 **02 → 03 순서 권장**. 단 03의 fixture 포맷 설계는 02와 독립 착수 가능. (실제 실행은 사용자 확정 순서로 03이 먼저 완료됨 — 이제 02가 그 eval의 검증 주체 축을 채운다.)

## 구현 결과 (2026-07-03, developer)

### 역매칭 알고리즘 (결정적)
- **정규화**(`normalizeNumericValue`): 참조태그(`[1]`) 제거 → 첫 숫자 토큰(부호·소수점·과학표기) 추출·소문자화. `"8.69 [1]"`→`"8.69"`, `"25 mg"`→`"25"`, `"3.0E-3"`→`"3.0e-3"`, 비수치/`N/A`→`null`. **완전일치**(가정 A)이며 근사 없음 — 불일치는 `none`으로 Guardian 폴백(과대검증 아님).
- **인덱스**(`buildMatrixValueIndex`): 파싱 매트릭스 전 셀을 정규화해 (a) `byTable`(캡션의 "table N" 숫자 토큰 → 값 집합) (b) `all`(전체 값 집합). 캡션에 table 번호 없으면(그림) 버킷 없이 `all`에만.
- **역매칭**(`backMatchCell`): 스코프 우선순위 `source_hinted`(source_hint가 가리키는 테이블에 값 존재) > `any_matrix`(아무 매트릭스에나 존재) > `none`. source_hint↔caption은 "table N" 숫자 토큰 매칭(가정 B), 실패 시 `any_matrix` 폴백.

### 검증 주체 저장 구조
- `CellVerification`(프론트 타입) + verification JSONB 원소에 선택 필드 추가:
  - **code-verified**: `{ row, col, status:"verified", method:"code", checkType:"backmatch", scope:"source_hinted"|"any_matrix" }`
  - **guardian**: `{ row, col, method:"guardian", checkType:"unit_mismatch"|"condition_mismatch"|"value_fabrication", ...checkGroundedness결과 }`
- DB 컬럼 스키마 무변경(`chat_generated_tables.verification` JSONB에 필드 부가). 하위호환: 기존 테이블 verification엔 method 없음 → 프론트가 무시.

### 계획 대비 변경
1. **코드 패스를 export 순수 함수 `runCodeBackMatchPass`로 분리** — 계획은 `scheduleGuardianVerification` 내부 2단계였으나, 결정성 실증(검증기준 3)을 단위 테스트로 직접 고정하려 코드 패스를 `table-pipeline.mjs`에서 export. 스케줄러(`scheduleGuardianVerification`)는 이 함수를 호출해 코드분 push + 실패분만 Guardian. 함수명은 계획의 "가칭 `runCellVerification`" 대신 기존 `scheduleGuardianVerification` 유지(내부 재구성, 미export라 외부 계약 무영향) + 신설 `runCodeBackMatchPass`.
2. **`buildNarrowGuardianClaim`의 identity가 값 열(valueCol)을 제외** — 계획엔 없던 정밀화. 2열 테이블에서 앞 2열을 identity로 잡으면 값 열 자신이 subject에 들어가는 문제(예: `"For KACa, 8.69, ... 8.69 ..."`)를 발견해, identity를 "현재 값 셀을 뺀 앞 2개 열"로 구성. 기존 Guardian claim 관습(`headers.slice(0,2)`)보다 의미상 정확. 기존 Guardian 테스트 기대 claim도 이에 맞춰 갱신.
3. **eval 배선 추가**(작업 8) — 오케스트레이터 지시("역매칭 결과를 eval/리포트에 노출하도록 정하면 배선 포함")에 따라 `scripts/e2e-table-fidelity.mjs`가 검증 주체 분포를 리포트. 프로덕션 로직 아닌 수동 스크립트 진단 출력.

### 영향 범위 실제
- 신규: `chat/value-backmatch.mjs`, `tests/value-backmatch.test.mjs`.
- 수정: `chat/table-pipeline.mjs`(import + `runCodeBackMatchPass` + `scheduleGuardianVerification` 2단계 재구성 + 호출부 배선), `frontend/src/types/chat.ts`(`CellVerification` 3필드), `frontend/src/features/chat/ChatTableReport.tsx`(배지 툴팁 + 셀 hover 검증주체), `tests/table-pipeline.test.mjs`(기존 Guardian 테스트 갱신 + 신규 1건), `scripts/e2e-table-fidelity.mjs`(검증주체 분포 리포트).
- **single_call_fallback 경로 보존**(R-3): `cellTuples=null` → 튜플 없음 → `pickCheckType(null)`=`value_fabrication`, source_hint 없음 → `any_matrix`/`none`만. parsedMatrices가 있으면 여전히 코드 역매칭 가능(약간 약함), Guardian은 좁은 value_fabrication claim.

### 검증 결과
- `node --check`: `value-backmatch.mjs`·`table-pipeline.mjs`·`e2e-table-fidelity.mjs` 통과.
- `node --test tests/*.test.mjs`: **123/123 통과**(회귀 0). 신규 value-backmatch 22 + 파이프라인 code-verify 1. **결정성 실증**(검증기준 3): 매트릭스에 있는 값 → `checkGroundednessFn` mock **미호출**·code-verified 확정 / 매트릭스에 없는 값 → Guardian mock 호출을 테스트로 고정.
- frontend `npx tsc --noEmit`(any 0) + `npm run build`(tsc+vite) 통과.
- `CURRENT_EXTRACTION_VERSION`/DB 마이그레이션/새 IPC **무변경**(검증기준 5).
- **13분 실 LLM E2E 미실행**(오케스트레이터 별도 baseline·after 측정) — 역매칭은 결정적이라 단위 테스트로 커버.
