# Fix: 테이블 생성 타임아웃 (single-call fallback DOMException TimeoutError)

> 유형: fix | 작성일: 2026-06-03 | 수정 완료: 2026-06-08 (P0-A + P0-B만, P1/P2 미구현) | 브랜치: `codex/rag-infra-extraction`

## 문제

- **증상**: 테이블 생성 시 `DOMException [TimeoutError]: The operation was aborted due to timeout`로 전체 파이프라인이 실패. 사용자에게 결과 테이블 대신 에러 메시지만 노출됨.
- **에러 체인**: `generateTableFromSpec` → `runStage3cMergeFallback` → `runTableConversationPipeline` → `CHAT_SEND_MESSAGE` catch.
- **재현 로그(실측)**:
  ```
  [Chat] Stage 3b: Per-paper extraction -> 2 success, 2 fail, 174751ms (fallback=false)
  [Chat] Stage 3c: merged result empty -> falling back to single-call Table Agent
  [Chat/RAG] Context: matrices 35016 chars, OCR 69924 chars, chunks 13173 chars   (≈118KB)
  [Chat] CHAT_SEND_MESSAGE error: DOMException [TimeoutError]
    at generateTableFromSpec (llm-orchestrator.mjs:334)
    at runStage3cMergeFallback (chat/table-pipeline.mjs:578)
  ```

### 근본 원인 (3개 결함의 연쇄)

이 버그는 단일 원인이 아니라 **연쇄 실패**다. 데이터 기반(로그/코드)으로 정리한다.

#### 원인 1 — single-call fallback이 118KB 컨텍스트를 통째로 로컬 Ollama에 전송 → 300초 초과

- `assembleRagContext` (`chat/table-extraction.mjs:20-76`)의 예산:
  - `OCR_BUDGET = 70000`, `MATRIX_BUDGET = 35000`, `TOTAL_BUDGET = 120000` (`:4-6`).
  - 즉 fallback 컨텍스트는 **설계상 최대 ~120KB**. 로그의 118KB(matrices 35KB + OCR 70KB + chunks 13KB)는 정확히 이 상한에 도달한 값.
- `generateTableFromSpec` (`llm-orchestrator.mjs:306-354`)은 이 118KB + spec + 메타데이터를 `num_ctx: 131072` (`llm-chat.mjs:14`)로 **단일 요청** 전송.
- `signal: ollamaSignal(abortSignal)` (`:344`). `ollamaSignal`의 기본 타임아웃은 **300초** (`llm-chat.mjs:5`): `AbortSignal.timeout(300_000)`을 `AbortSignal.any([existing, timeout])`로 합성.
- 로컬 Ollama가 118KB 프롬프트(131072 컨텍스트 윈도우)를 300초 내에 처리(prefill+생성)하지 못함 → `AbortSignal.timeout`이 발화 → **`DOMException [TimeoutError]`** (정확히 이 에러 타입).
- **참고**: 이는 undici `UND_ERR_HEADERS_TIMEOUT`(fix 04)과 **다른** 에러다. fix 04의 `ollamaDispatcher`는 현재 브랜치 코드에 **존재하지 않음**(`llm-orchestrator.mjs`/`llm-chat.mjs`에 `dispatcher`/`undici` import 없음 — 실측). 즉 헤더 타임아웃 이전에 `AbortSignal.timeout(300s)` 상한이 먼저 발화한 것. 본 fix는 그 300초 상한과 컨텍스트 크기의 조합 문제.

#### 원인 2 — single-call fallback 실패가 전체 파이프라인을 죽임 (부분 성공분 폐기)

- `runStage3cMergeFallback` (`chat/table-pipeline.mjs:539-596`):
  - per-paper 병합 결과가 비면(`tableJson.rows.length === 0`, `:566`) `extractionFallbackNeeded = true`로 전환.
  - fallback 경로(`:572-586`)에서 `generateTableFromSpecFn(...)`을 **try/catch 없이** 호출(`:578`). 여기서 throw 되면 `runTableConversationPipeline`까지 그대로 전파 → 최상위 catch에서 에러 메시지로 종료.
- 즉 per-paper에서 **2편이 성공(success=true)**했고 그 결과가 `extractionResults`에 살아있는데도, 병합이 비어서 fallback으로 넘어간 뒤 fallback이 timeout으로 죽으면 **부분 성공분이 전부 버려진다.**

#### 원인 3 — per-paper 추출 빈 결과: chunks 0 + LLM "데이터 없음" 판단 + 타임아웃 재시도 누락

로그상 4편 모두 `data_rows=0`이라 병합이 empty가 됐다. 세부 원인이 섞여 있다.

**(3-a) 일부 논문 `chunks 0 chars` — 컨텍스트 조립의 구조적 누락**
- 테이블 모드 RAG는 **두 경로**로 논문을 모은다:
  - `chunks`: `rerankChunksIfAvailable`가 **전역 top-15만** 반환 (`rag/multi-query-rag.mjs:68` `RERANKER_TOPK.table = 15`, `:207`). 즉 청크는 라이브러리 전체에서 가장 점수 높은 15개 → 특정 논문에 쏠림.
  - `figures`: `loadTableRagAndMetadata`의 **backfill**(`chat/table-pipeline.mjs:257-288`)이 관련 논문의 **모든** `item_type='table'` figure를 추가.
- `allPaperIds`는 `figuresByPaper.keys() ∪ chunksByPaper.keys()` (`chat/table-pipeline.mjs:329`). 따라서 **테이블 figure만 backfill되고 청크는 top-15에 못 든 논문**은 `chunksByPaper.get(pid)`가 비어 per-paper 컨텍스트의 chunks 부분이 0이 된다. → 로그의 `chunks 0 chars`.
- 이 논문은 OCR/parsed table만으로 추출해야 하는데, 그 테이블이 spec 컬럼과 무관하면 LLM이 정당하게 빈 배열을 반환.

**(3-b) LLM "데이터 없음" 판단 — 실제 부재일 수 있음 (정상 동작)**
- `EXTRACTION_AGENT_SYSTEM_PROMPT` (`llm-orchestrator.mjs:452-502`)은 "해당 데이터가 전혀 없으면 data_rows를 빈 배열 []로 반환" + "추측 금지"를 명시(`:502`, `:465`).
- 로그의 "no fitted isotherm model parameters reported"는 **프롬프트 규칙대로 동작한 정상 케이스**일 수 있음(그 논문에 spec이 요구한 isotherm 파라미터가 실제로 없음). 이건 버그가 아니라 데이터 부재. → 4편 중 일부는 정당하게 0행.

**(3-c) 타임아웃 시 재시도 안 됨 (잠재적 fail 증폭)**
- per-paper 추출은 논문당 60초 타임아웃(`chat/table-pipeline.mjs:476-477` `setTimeout(() => timeoutController.abort(), 60000)`).
- `timeoutController.abort()`(인자 없음)는 `AbortError`를 만든다. 파이프라인 catch(`:502-514`)는 `abortSignal?.aborted`(사용자 abort)만 재throw하고 나머지는 fail 처리 → 60초 초과 논문은 `success=false`.
- 한편 `extractColumnsFromPaper`의 내부 1회 재시도(`llm-orchestrator.mjs:582-589`)는 `err?.name === "AbortError"`면 재시도하지 않고 throw. 60초 타임아웃은 `AbortError`라 **재시도 없이 즉시 실패**. (※ 이건 합리적 — 60초를 넘긴 논문을 재시도하면 또 60초 소요. 단, JSON 파싱 실패와 타임아웃을 구분 못 하는 구조라 로그 추적이 어려움.)
- 로그상 Stage 3b가 174,751ms(≈175초) 소요 + 2 fail → 일부는 60초 타임아웃으로 fail했을 가능성이 큼(2편 × 60초 + 2편 성공분).

### 종합

```
per-paper 4편 → (chunks 쏠림 + 실제 데이터 부재 + 60초 타임아웃) → 4편 모두 data_rows=0
  → 병합 empty (원인 3)
  → single-call fallback 진입 (원인 2: 부분성공분 폐기)
  → 118KB 컨텍스트 300초 초과 (원인 1)
  → DOMException TimeoutError → 전체 실패
```

## 수정 방안

우선순위 순. **P0 두 개만으로도 "에러 화면"은 사라진다**(빈 테이블이라도 반환). P1은 빈 결과 자체를 줄인다.

| 우선순위 | 파일 | 수정 내용 |
|------|------|-----------|
| **P0-A** (방향 c) | `apps/desktop/electron/chat/table-pipeline.mjs` | `runStage3cMergeFallback`의 fallback 호출(`:578`)을 try/catch로 감싼다. fallback이 throw하면(사용자 abort 제외) **이미 병합한 per-paper 부분 결과**(`mergeExtractionResults`의 `tableJson`)를 살린다. 병합 결과조차 완전 비었으면 빈 테이블(`rows: []`) + notes에 사유를 담아 반환. 사용자 abort(`abortSignal.aborted`)는 그대로 재throw. |
| **P0-B** (방향 a) | `apps/desktop/electron/chat/table-extraction.mjs` | fallback 전용 컨텍스트 상한을 대폭 축소. `assembleRagContext`에 `budget` 파라미터를 추가하거나 fallback 전용 상수(`OCR_BUDGET`/`MATRIX_BUDGET`/`TOTAL_BUDGET`)를 낮춘다. 권장값: OCR 30000, MATRIX 20000, TOTAL 60000(현재의 절반). per-paper 예산(`PER_PAPER_*`)은 건드리지 않음. |
| **P1-A** | `apps/desktop/electron/chat/table-pipeline.mjs` | per-paper 컨텍스트 `chunks 0 chars` 완화: `runPerPaperExtraction`에서 `chunksByPaper.get(pid)`가 비고 parsed/OCR table도 빈약한 논문은 (i) 추출을 건너뛰지 말고, (ii) backfill된 table figure의 `summary_text`(OCR HTML)를 컨텍스트에 확실히 포함시키도록 `assemblePerPaperContext` 입력 점검. 이미 figures는 전달되나(`:459`), `summary_text.length > 30` 필터(`table-extraction.mjs:95`)로 빠지는 케이스 로깅 추가. |
| **P1-B** (선택) | `apps/desktop/electron/chat/table-pipeline.mjs` | per-paper 60초 타임아웃을 컨텍스트 크기에 따라 동적 조정(작은 컨텍스트 60초 유지, PER_PAPER_TOTAL_BUDGET 근접 시 90초). 또는 timeout 시 `timeoutController.abort(reason)`로 사유를 붙여 fail 로그에 "timeout" vs "empty"를 구분 기록. |
| **P2** (미봉책, 비권장 단독 사용) | `apps/desktop/electron/llm-chat.mjs` | `ollamaSignal` 기본 타임아웃(300초)을 키우는 것(`:5`). **단독으로는 권장하지 않음** — UX상 사용자가 5분 이상 대기하게 되고, P0-A/P0-B로 근본 해결되면 불필요. P0 적용 후에도 fallback이 자주 timeout하면 보조로만. |

### Trade-off 분석

- **방향 a (P0-B, 컨텍스트 축소)**: 가장 직접적. 60KB면 동일 모델이 300초 내 처리 가능성 큼. 단점 — fallback 정확도 소폭 하락(컨텍스트 잘림). 하지만 fallback은 어차피 "per-paper가 다 실패한" 비상 경로라 완벽함보다 **완주**가 우선.
- **방향 b (P2, timeout 증가)**: 가장 쉽지만 미봉책. 컨텍스트가 더 커지면 또 깨짐. 사용자 대기시간만 늘어남. **단독 채택 금지.**
- **방향 c (P0-A, 부분성공 활용 + fallback 비차단화)**: 가장 견고. fallback이 실패해도 앱이 죽지 않음. "에러 화면" → "부분 테이블"로 UX 개선. 단점 — 빈 테이블이 나올 수 있으나 이는 에러보다 명백히 나음(notes로 사유 안내).
- **방향 d (큰 컨텍스트 분할)**: 효과는 좋으나 구현 복잡도 큼(분할→부분 테이블→재병합 = 사실상 per-paper의 재발명). per-paper가 이미 그 역할이므로 **중복**. 비채택. 대신 P1으로 per-paper 자체의 빈 결과를 줄이는 게 정공법.

### 부분 성공분이 왜 안 살았나 (원인 2 재확인)

- 로그상 4편 모두 `data_rows=0`이라 **병합 결과 자체가 비어있던 것**이 사실(2 success여도 success는 "예외 없이 호출 완료"를 뜻할 뿐 data_rows>0을 보장하지 않음 — `chat/table-pipeline.mjs:494-501`은 빈 배열 반환도 success=true).
- 따라서 이번 케이스는 "부분성공분을 살린다"가 곧 "빈 테이블을 반환한다"가 된다. 그래도 **에러 화면보다는 낫다**(P0-A). 진짜로 데이터가 있었는데 버려진 게 아니라, per-paper가 다 빈 것 → 근본 개선은 P1(빈 결과 줄이기).

## 영향 범위

- 수정 파일: **2~4개**
  - P0(필수): `chat/table-pipeline.mjs`, `chat/table-extraction.mjs` → **2개**
  - P1 추가 시: 위 2개 내 추가 수정(파일 수 동일) + 필요 시 로깅
  - P2 보조 시: `llm-chat.mjs` 1개 추가 → 최대 3개
- DB 변경: **없음**
- 새 IPC: **없음**
- 새 컴포넌트/모듈: **없음**
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요** (추출 파이프라인 산출물 스키마/임베딩 불변, 채팅 런타임 로직만 변경)
- 사이드 이펙트:
  - P0-B로 fallback 컨텍스트가 작아져 fallback 테이블의 행 수가 줄 수 있음(fallback은 비상 경로라 허용 가능).
  - P0-A로 빈 테이블이 정상 반환될 수 있음 → 프론트의 빈 테이블 렌더링이 깨지지 않는지 확인 필요(`ChatTableReport`가 `rows: []`를 처리하는지). [가정] 기존에도 per-paper 0행 케이스가 있었으므로 빈 테이블 렌더는 이미 지원될 것으로 추정.

## 검증 방법

1. **문법 체크**: `node --check apps/desktop/electron/chat/table-pipeline.mjs` / `node --check apps/desktop/electron/chat/table-extraction.mjs` (P2 시 `llm-chat.mjs`도).
2. **단위/회귀**: 기존 vitest 통과 확인. `assembleRagContext` 예산 축소가 기존 테이블 추출 테스트(있다면)에 영향 없는지.
3. **fallback 비차단 검증**: `generateTableFromSpecFn`을 항상 throw하도록 주입(테스트 더블)해도 `runStage3cMergeFallback`가 부분/빈 테이블을 반환하고 파이프라인이 완주하는지(throw 전파 안 됨). 사용자 abort 시에는 여전히 재throw 되는지.
4. **컨텍스트 크기 로그**: 실제 앱에서 동일 시나리오 재현 시 `[Chat/RAG] Context:` 로그의 fallback 컨텍스트가 60KB 이하로 줄고, `generateTableFromSpec`가 300초 내 완료되는지.
5. **에러 → 결과 전환**: 재현 케이스에서 `CHAT_SEND_MESSAGE error: DOMException [TimeoutError]`가 더는 발생하지 않고, 빈 테이블 or 부분 테이블 + notes가 반환되는지.

## 가정 사항

- [가정] 프론트 `ChatTableReport`가 `rows: []`(빈 테이블) + notes를 깨지지 않게 렌더한다(per-paper 0행 케이스가 기존에도 존재했으므로). → develop/fix 단계에서 1회 확인.
- [가정] 60KB로 줄인 fallback 컨텍스트는 동일 로컬 모델(gpt-oss:120b 등)에서 300초 내 처리된다. → 검증 4로 확인. 미달 시 P2를 보조로 추가.
- [가정] 로그상 4편 data_rows=0은 (chunks 쏠림 + 실제 부재 + 일부 60초 timeout)의 복합. P1으로 chunks 쏠림은 완화 가능하나, "실제 데이터 부재"는 코드로 해결 불가(정상 동작). → P1은 빈 결과를 "줄이는" 것이지 "없애는" 것이 아님.

## 규모 판단

- 수정 파일 2~4개, DB/IPC/컴포넌트 변경 없음 → **소규모 수정(fix)** 기준 충족.
- 단, P0-A는 파이프라인 제어 흐름(fallback 비차단화) 변경이라 신중한 구현·검증 필요. 그래도 신규 모듈/채널이 없어 fix 범위 내.
- **권장 경로**: `/fix`로 진행. P0(A+B) 우선 적용 → 검증 후 P1 추가 여부 판단.
