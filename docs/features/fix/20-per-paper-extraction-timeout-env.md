# Fix: Per-paper 추출 타임아웃 환경변수화 (gemma4 등 느린 모델 대응)

> 유형: fix | 작성일: 2026-06-09 | 수정 완료: 2026-06-09 | 상태: ✅ 구현 | 브랜치: `codex/rag-infra-extraction`

## 문제

- **증상**: `gemma4:31b` 같은 느린 로컬 모델로 비교 테이블 생성 시 per-paper 추출이 전부 실패 → 빈 테이블(placeholder 행만).
- **재현 로그(실측)**:
  ```
  [Chat] Stage 3b: Per-paper extraction -> 0 success, 4 fail, 240043ms (fallback=true)
  ```
  4편 × ~60초 = 240초. 4편 모두 **60초 hard timeout으로 abort**되어 `success=false`.
- **원인 (코드 확인)**: `apps/desktop/electron/chat/table-pipeline.mjs:478`
  ```js
  const timeoutId = setTimeout(() => timeoutController.abort(), 60000); // per-paper hard timeout
  ```
  - 이 wrapper의 `timeoutController.signal`이 `extractColumnsFromPaperFn`에 전달된다 (table-pipeline.mjs:488).
  - 정작 내부 Ollama 호출(`extractColumnsFromPaper`, `llm-orchestrator.mjs:560`)은 `ollamaSignal(abortSignal)` → **기본 300초**(`llm-chat.mjs:5` `ollamaSignal(existingSignal, timeoutMs = 300_000)`)인데, **위 60초 wrapper가 먼저 abort**한다.
  - 즉 **60초 wrapper가 binding constraint**다. 내부 300초는 도달하지 못한다. gemma4가 큰 논문 한 편을 60초 안에 못 끝내므로 매번 timeout.
- **근거 정리**:
  - `chat/table-pipeline.mjs:478` — Stage 3b per-paper 60초 (binding).
  - `chat/table-pipeline.mjs:757` — Stage 3d NULL 재검색(Agentic NULL Recovery) 30초.
  - `llm-orchestrator.mjs:560` — 내부 Ollama 호출, `ollamaSignal(abortSignal)` 기본 300초 (현재 미도달).

## 원인 분석

### 타임아웃 wrapper 구조 (table-pipeline.mjs:475-516)

```js
const t0 = Date.now();
try {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60000);   // ← 하드코딩
  const onAbort = () => timeoutController.abort();
  abortSignal?.addEventListener("abort", onAbort);                        // 사용자 abort 전파

  let extraction;
  try {
    extraction = await extractColumnsFromPaperFn(
      tableSpec, paperContext, pMeta.title, timeoutController.signal,     // ← 60초 signal 전달
    );
  } finally {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener("abort", onAbort);
  }
  // ... success push
} catch (err) {
  if (abortSignal?.aborted) throw err;   // 사용자 abort는 재throw (취소 보존)
  // timeout/일반 에러 → success:false push (error: err.message)
}
```

- `timeoutController`는 **(1) 60초 경과** 또는 **(2) 사용자 abort** 두 경우 모두 abort된다. 두 신호를 합쳐 하나의 signal로 내부에 넘긴다.
- timeout으로 abort되면 `extractColumnsFromPaperFn`이 `AbortError`(또는 `TimeoutError`)를 throw → catch에서 `abortSignal?.aborted`는 false(사용자가 안 누름)이므로 재throw 안 하고 `success:false`로 기록.
- **핵심**: 이 60초만 늘리면 gemma4가 끝낼 시간을 확보한다. wrapper의 사용자 abort 전파/취소 보존 로직은 그대로 유지된다.

### Stage 3d 재검색 타임아웃 (table-pipeline.mjs:756-773)

```js
const timeoutController = new AbortController();
const timeoutId = setTimeout(() => timeoutController.abort(), 30000);   // ← 하드코딩
// ... extractNullCellsFromPaper(tableSpec, nullColumns, recoveryContext, paperTitle, timeoutController.signal)
```

- 구조는 3b와 동일(AbortController + setTimeout + 사용자 abort 전파). NULL 셀만 재추출하므로 컨텍스트가 작아 30초로 잡혀 있으나, **같은 느린 모델이면 30초도 부족**할 수 있다. 같은 방식으로 env화한다.

### 기존 컨벤션 (그대로 따름)

- 수치 env: `parseInt(process.env.REDOU_X, 10) || default` (예: `llm-chat.mjs:14` `LLM_CTX = parseInt(process.env.REDOU_LLM_CTX, 10) || 131072`).
- URL/문자열 env: `process.env.REDOU_X || default` (예: `mineru-client.mjs:17`, `grobid-client.mjs:8`).
- 모든 env는 `REDOU_` 접두어.

### ⚠️ 혼동 주의 (env화 대상 아님)

`chat/table-extraction.mjs:9` `PER_PAPER_TOTAL_BUDGET = 30000` 등은 **문자 수(char) 컨텍스트 예산**이지 네트워크 타임아웃(ms)이 아니다. 이름이 비슷하니 **건드리지 말 것**. 이번 수정 대상은 `table-pipeline.mjs`의 `setTimeout(..., ms)` 2곳뿐이다.

## 적절한 기본값 (트레이드오프 포함)

- **per-paper(3b) 기본값: 240000ms (240초) 제안.**
  - 근거: 로그상 gemma4 한 편이 60초 초과(`240043ms / 4편 ≈ 60초/편`은 timeout 상한에 걸린 값이라 **실제 소요는 그 이상**일 가능성). 안전 마진으로 180~300초 범위에서 **240초**를 기본값으로 권장.
  - **상한은 내부 Ollama 300초(`ollamaSignal` 기본)와의 정합성**: wrapper를 300초보다 키우면 내부 300초가 먼저 끊겨 의미가 없다. 따라서 기본값은 **300초 이하**여야 함(240초는 안전). env로 300 초과를 주려면 내부 `ollamaSignal` timeout도 함께 키워야 하므로 이번 범위에서는 **기본 240초 + 권장 상한 300초**로 가이드한다(가정 1).
- **Stage 3d(:757) 기본값: 현행 유지(30000) 또는 소폭 상향.**
  - NULL 재검색은 작은 컨텍스트 + 부가 단계(실패해도 core 영향 없음, 이미 try/catch로 graceful). 기본값은 **30초 유지**하되 **env로만 조절 가능**하게 빼는 것을 권장(가정 2). 느린 모델 사용자가 필요 시 `REDOU_NULL_RECOVERY_TIMEOUT_MS`로 키울 수 있게.

### 트레이드오프

| 항목 | 영향 |
|------|------|
| 전체 테이블 생성 시간 증가 | per-paper는 **순차 실행**(table-pipeline.mjs:446 for 루프). N편 × (성공 시 실제 소요, 실패 시 타임아웃)이므로, 데이터가 실제로 없는 논문은 240초까지 기다린 뒤 placeholder 처리 → **느려질 수 있음**. 단, 빈 테이블보다 데이터 추출 성공이 우선이므로 수용 가능한 트레이드오프. |
| 빠른 모델(gpt-oss 등)엔 영향 거의 없음 | 정상 추출은 타임아웃 도달 전 완료. 타임아웃은 상한일 뿐 매번 기다리지 않음. |
| 내부 300초 정합성 | 기본 240초 ≤ 300초라 안전. env로 300 초과 지정 시 내부가 먼저 끊김 → 계획서에 명시(가정 1). |
| 사용자 abort | wrapper 로직 불변 → 취소 즉시 전파 유지(table-pipeline.mjs:480, 504). |

## 수정 방안

### 1. per-paper(3b) + Stage 3d(:757) 타임아웃을 모듈 상수 + env로 분리

`apps/desktop/electron/chat/table-pipeline.mjs` 파일 상단(import 블록 직후, 다른 상수와 함께)에 추가:

```js
// Per-paper extraction (Stage 3b) hard timeout. Wraps extractColumnsFromPaper so a
// slow local model (e.g. gemma4:31b) can finish a large paper. Must stay <= the inner
// Ollama ollamaSignal default (300s, llm-chat.mjs); a larger value is cut off by the
// inner timeout first. See docs/features/fix/20-per-paper-extraction-timeout-env.md.
const PER_PAPER_TIMEOUT_MS = parseInt(process.env.REDOU_PER_PAPER_TIMEOUT_MS, 10) || 240000;
// Stage 3d Agentic NULL Recovery per-paper re-extraction timeout (small context).
const NULL_RECOVERY_TIMEOUT_MS = parseInt(process.env.REDOU_NULL_RECOVERY_TIMEOUT_MS, 10) || 30000;
```

| 파일 | 줄 | 수정 내용 |
|------|----|-----------|
| `apps/desktop/electron/chat/table-pipeline.mjs` | 상단 상수부 | `PER_PAPER_TIMEOUT_MS`, `NULL_RECOVERY_TIMEOUT_MS` 상수 추가 (위 코드). |
| `apps/desktop/electron/chat/table-pipeline.mjs` | 478 | `setTimeout(() => timeoutController.abort(), 60000)` → `..., PER_PAPER_TIMEOUT_MS)` |
| `apps/desktop/electron/chat/table-pipeline.mjs` | 757 | `setTimeout(() => timeoutController.abort(), 30000)` → `..., NULL_RECOVERY_TIMEOUT_MS)` |

- wrapper의 나머지 로직(AbortController, 사용자 abort 전파, catch 분기)은 **무변경**.
- (선택) Stage 3b 시작 로그에 적용 타임아웃 노출 — 디버깅 편의(가정 3). 예: `console.log` 한 줄에 `PER_PAPER_TIMEOUT_MS` 포함. 미적용해도 무방.

### 2. fix 19 fail 케이스 — ✅ **이미 구현됨 (신규 코드 불필요, 확인만)**

> **중요 정정**: 작업 지시의 "item 3(안전망: success=false 논문도 placeholder + 사유 생성)"은 **이미 `codex/rag-infra-extraction` 브랜치에 구현·배선 완료**되어 있다. 지시문이 참조한 `table-extraction.mjs:234 if(!result.success) continue`는 **현재 코드와 다르다**(아래). fix 19 P0가 success-but-0-rows뿐 아니라 **fail(success=false)도 처리**한다. 따라서 이 항목은 **신규 구현 대상이 아니라 검증 항목**이다.

코드 확인 (`apps/desktop/electron/chat/table-extraction.mjs`, `mergeExtractionResults`):

- **L237-238**: `if (!result.success) continue` **이전에** notes를 먼저 수집 → 실패 논문의 notes도 보존.
  ```js
  const rawNote = typeof result.extraction?.notes === "string" ? result.extraction.notes.trim() : "";
  if (rawNote) notesByPaperId.set(result.paperId, rawNote);
  if (!result.success) continue;          // L240 — 데이터 추출 루프만 건너뜀
  ```
- **L304-337**: `paperMetadata` 전체를 순회하며 데이터 없는 논문(빈 data_rows **또는** success=false)마다 **전 셀 N/A placeholder 행 생성** + `reasons[]` 수집. 실패 논문은 `failedByPaperId`로 잡아 사유에 `Extraction failed: ...` 포함.
  ```js
  const failedByPaperId = new Map();
  for (const result of extractionResults) {
    if (!result.success) failedByPaperId.set(result.paperId, result.error || "");
  }
  // ... hadRows=false면 placeholder 행 push + reasons.push({..., failed, note: failed ? `Extraction failed: ...` : "No matching data found..."})
  ```
- **반환** (L379): `return { tableJson, nullSummary, reasons }`.

배선 체인 (확인됨):

| 단계 | 위치 | 동작 |
|------|------|------|
| merge 반환 | `table-extraction.mjs:379` | `reasons` 포함 |
| 파이프라인 수집 | `table-pipeline.mjs:575` | `perPaperReasons = merged.reasons ?? []` |
| persist | `table-pipeline.mjs:928` | `extractionMetadata.perPaperReasons` → `chat_generated_tables.metadata` (DB 무변경, 기존 JSONB) |
| 타입 | `frontend/src/types/chat.ts` | `PerPaperReason` + `metadata.perPaperReasons` 존재 |
| 렌더 | `frontend/src/features/chat/ChatTableReport.tsx:68, 260-308` | `hadRows === false` 필터 → "데이터 없음" 섹션 표시 (`[refNo] 제목 — 사유`) |

→ **0 success / 4 fail 케이스도 현재 코드에서**: 4편 모두 placeholder 행 + 각 사유(`Extraction failed: ...` 또는 notes)가 ChatTableReport 하단에 노출된다. **단, 그 전에 `extractionFallbackNeeded`가 true가 되어 single-call fallback으로 빠진다**(아래 상호작용 참고).

### 3. (검토) 타임아웃 상향 ↔ fallback 분기 상호작용

- **현재 흐름**: per-paper가 **전부 실패**(`extractionSuccessCount === 0 && extractionFailCount > 0`)면 `extractionFallbackNeeded = true`(table-pipeline.mjs:518) → Stage 3c가 **single-call fallback**으로 진입. 즉 0/4 케이스는 merge의 placeholder 경로를 **타지 않고** fallback 경로로 간다(merge는 호출되지 않음, table-pipeline.mjs:569 `if (!extractionFallbackNeeded)` 가드).
- **타임아웃 상향의 1차 효과**: gemma4가 240초 안에 **최소 1편이라도 성공**하면 `extractionSuccessCount > 0` → fallback 회피 → `mergeExtractionResults`가 실행되고, 성공 논문은 데이터 행, 실패/빈 논문은 placeholder + 사유로 처리된다. **이것이 방향 A의 목표.**
- 따라서 이번 수정의 본질은 **"타임아웃을 늘려 per-paper 성공률을 높임 → merge 경로 진입 → fix 19의 placeholder/사유가 실제로 발현됨"**. fix 19 코드는 그대로 두면 된다.
- 만약 240초로도 **전부 실패**하면 여전히 fallback(빈 테이블+notes, fix 18 P0-A로 crash는 없음). 이 경우 사용자에게 "시간 내 미완료" 안내가 나간다 — 수용 가능.

## 영향 범위

- **수정 파일: 1개** (`apps/desktop/electron/chat/table-pipeline.mjs`).
- DB 변경: **없음**.
- 새 IPC: **없음**.
- 새 컴포넌트/모듈: **없음**.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요** (PDF 추출 로직 무관, 채팅 런타임 동작만 변경).
- `DB_QUERY_TABLES`/`DB_MUTATE_TABLES`: 무변경.
- 사이드 이펙트:
  - per-paper 전부 데이터 없는 케이스에서 **전체 생성 시간 증가**(N편 × 최대 240초, 순차). 의도된 트레이드오프.
  - 빠른 모델은 영향 거의 없음(타임아웃은 상한).
  - fix 19/fix 18 코드와 **충돌 없음**(타임아웃 상수만 교체, 분기 로직 불변).

## 검증 방법

1. **문법**: `node --check apps/desktop/electron/chat/table-pipeline.mjs`.
2. **단위 테스트** (`apps/desktop/tests/table-pipeline.test.mjs`, DI 기반):
   - 기존 60건+ 회귀 통과 확인(`node --test apps/desktop/tests/table-pipeline.test.mjs`).
   - (권장 신규 1건) `REDOU_PER_PAPER_TIMEOUT_MS`를 작은 값(예: 50ms)으로 설정 + `extractColumnsFromPaperFn`을 "전달받은 signal이 abort될 때까지 대기 후 reject"하도록 주입 → 해당 논문이 `success:false`로 기록되고 **사용자 abort가 아니므로 재throw되지 않음**을 확인. (테스트는 L748 패턴처럼 주입 fn에서 `signal.aborted`/`addEventListener('abort')` 관찰 가능.)
   - (권장 신규 1건) `extractColumnsFromPaperFn`이 즉시 성공 반환 → 타임아웃 무관하게 정상 경로 + merge 진입 확인(기존 테스트로 커버될 수 있음, 중복 시 생략).
3. **fix 19 회귀**: `table-extraction.test.mjs`의 placeholder/reasons 테스트(merge placeholder 2건 + persist→metadata 1건) 그대로 통과 확인 — 본 수정이 merge를 건드리지 않으므로 영향 없음.
4. **수동(선택)**: 실제 앱에서 `set REDOU_PER_PAPER_TIMEOUT_MS=240000` 후 gemma4로 4편 비교 테이블 생성 → `Stage 3b: ... N success`(N>0) 로그 + 데이터 행 + (빈 논문) 하단 "데이터 없음" 사유 확인.

## 규모 판단

**소규모 fix.**

| 기준 | 값 |
|------|----|
| 수정 파일 수 | 1개 (`table-pipeline.mjs`) |
| DB 변경 | 없음 |
| 새 IPC | 없음 |
| 새 컴포넌트/모듈 | 없음 |
| 신규 로직 | 없음 (상수+env 치환 2곳, 분기 불변) |

→ `/fix`로 진행 권장.

## 가정 사항 (사용자 확인 필요)

- **[가정 1]** per-paper 기본 타임아웃 **240000ms(240초)**, 권장 상한 300초(내부 `ollamaSignal` 300초와 정합). env명 `REDOU_PER_PAPER_TIMEOUT_MS`. → 다른 기본값/상한 원하면 알려주세요. (300 초과를 기본으로 원하면 `llm-orchestrator.mjs:560` `ollamaSignal(abortSignal, <더큰값>)`도 함께 손봐야 하므로 별도 결정 필요 — 이번 범위 밖.)
- **[가정 2]** Stage 3d(:757)는 **기본 30초 유지 + env(`REDOU_NULL_RECOVERY_TIMEOUT_MS`)로만 조절** 가능하게 추가. 기본값을 올리길 원하면 알려주세요.
- **[가정 3]** Stage 3b 로그에 적용 타임아웃 값 1줄 추가(디버깅용)는 선택 — 불필요하면 생략.
- **[정정 확인]** 작업 지시의 item 3(fail 케이스 placeholder/사유)은 **이미 구현 완료**라 신규 코드 없음. 이 정정에 동의하는지 확인 부탁드립니다. (혹시 "fail 사유 문구 개선"이나 "CSV에 사유 포함" 같은 **추가 폴리시**를 원하면 별도 항목으로 추가 가능 — 현재 P1으로 fix 19에 미구현 표기되어 있음.)
