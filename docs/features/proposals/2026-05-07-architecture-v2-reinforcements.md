# Architecture Review V2 Reinforcement Proposal

Status: proposal (Claude → Codex review request)
Date: 2026-05-07
Author: Claude (annotation pass)
Supersedes: nothing (보강용 첨부 문서)
Related: `docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md`

## 목적

V2 제안서는 V1과 Claude annotation을 합쳐 실행 가능한 형태로 진화시켰다. 9개 핵심 보강(Stage -1, 0.5, state audit, runMultiQueryRag, parallel UI, soft KPI, CONTEXT/harness, freeze, rollback)이 정확히 채택됐다. 그러나 5개 영역이 여전히 약하다. 이 문서는 그 5개를 구체화해 Stage -1 진입 전에 결정하도록 한다.

## 약한 영역 5개 + 보강안

### R1: KPI를 측정 가능한 hard/soft 이중 gate로 정의

**문제:**
V2는 "main.mjs를 1,500줄 *안팎*까지 줄인다"는 표현을 쓴다. 방향성으로 좋지만 stage 종료 판정에 쓰기에는 모호하다. "안팎"은 통과/탈락 기준이 아니다.

**보강안:**
각 stage에 두 단계의 gate를 둔다.

- **Hard gate** = 해당 stage가 "완료"라고 선언하기 위한 최소 조건. 미달 시 stage 미완.
- **Soft target** = 다음 refactor cycle까지 도달할 권장 수치. 미달이라도 stage 종료 가능.

#### main.mjs 줄 수

| 시점 | Hard gate | Soft target |
|------|----------|------------|
| 현재 (2026-05-07) | — | 측정 결과 ≈ 3,500+줄 (TODO: 실측 commit 시점에 확정) |
| Stage 2A 완료 | ≤ 2,500줄 | ≤ 2,000줄 |
| Stage 5 완료 | ≤ 1,200줄 | ≤ 800줄 |
| 전체 작업 종료 | ≤ 800줄 | ≤ 500줄 |

#### main.mjs 직접 IPC handler 수

| 시점 | Hard gate | Soft target |
|------|----------|------------|
| 현재 | — | 실측 ≈ 25개 (TODO 확정) |
| Stage 2A 완료 | ≤ 18개 | ≤ 15개 |
| Stage 5 완료 | ≤ 8개 | ≤ 5개 |
| 전체 종료 | ≤ 5개 | ≤ 3개 (lifecycle만) |

#### main.mjs import 수

| 시점 | Hard gate | Soft target |
|------|----------|------------|
| 전체 종료 | ≤ 12개 | ≤ 8개 |

#### 새 모듈 coverage

| 모듈 종류 | Hard gate | Soft target |
|----------|----------|------------|
| Pure helper (예: source-evidence, agentic-null-recovery) | ≥ 70% | ≥ 85% |
| Pipeline orchestrator (예: chat/table-pipeline) | ≥ 50% | ≥ 70% |
| UI tab leaf | (선택) | ≥ 60% |

**측정 방법:**
- 줄 수: `wc -l` 단순 측정 (주석 포함)
- IPC handler: `grep -c "ipcMain.handle\|ipcMain.on" main.mjs`
- Import: `grep -c "^import " main.mjs`
- Coverage: `vitest run --coverage`

**통과 판정:**
PR 머지 전 Hard gate 모두 통과 확인. Soft target 미달 시 issue 등록 후 다음 cycle로.

---

### R2: Module ownership 정책을 ADR로 잠근다

**문제:**
"새 기능을 어디 두는가?"가 정의되지 않으면 모든 새 기능이 익숙한 main.mjs로 다시 흘러간다. Refactor 후 6개월이면 다시 비대화될 가능성이 높다.

**보강안:**
ADR 0002로 의사결정 트리를 고정한다.

#### 결정 트리 (ADR 0002 초안)

```
새 기능이…

1. PDF 파싱/구조화 추출이 필요?
   → mineru-client.mjs / grobid-client.mjs / pdf-heuristics.mjs / ocr-extraction.mjs

2. 새로운 LLM 호출이 필요?
   → llm-chat.mjs (스트리밍) / llm-orchestrator.mjs (구조화) / llm-qa.mjs (Q&A)
   → 셋 중 어디에도 안 맞으면 → 새 llm-{purpose}.mjs 생성

3. Chat 흐름의 일부?
   → chat/table-pipeline.mjs / chat/qa-pipeline.mjs / chat/source-evidence.mjs
   → chat/agentic-null-recovery.mjs / chat/status-events.mjs

4. RAG 검색의 일부?
   → rag/multi-query-rag.mjs (또는 향후 분화)

5. PDF/Embedding/Entity 잡 처리?
   → pipeline/import-processing.mjs / pipeline/embedding-processing.mjs
   → pipeline/job-coordinator.mjs

6. 새 IPC 채널이 필요?
   → 채널 등록은 ipc/{domain}-ipc.mjs (handler 모음)
   → main.mjs는 register 호출만

7. DB CRUD가 필요?
   → frontend는 lib/supabase{domain}Repository
   → backend는 모듈 내 직접 supabase client 사용
   → main.mjs의 DB_QUERY_TABLES proxy는 새 테이블 추가 외 사용 자제

8. 위 어디에도 안 맞음?
   → ADR 작성 후 새 모듈 추가
```

#### "main.mjs에 직접 추가 가능한 것"의 명시적 제한

main.mjs는 다음만 보유:
- Electron app lifecycle (whenReady, will-quit 등)
- BrowserWindow 생성/관리
- DB_QUERY_TABLES / DB_MUTATE_TABLES whitelist 자체 (제거 검토 별도)
- 모든 IPC 등록 함수의 호출 (실제 handler는 ipc/ 하위)
- Supabase client / Ollama client 초기화

**검증:**
- PR 리뷰 시 main.mjs 변경이 위 5개 외에 들어가면 reject
- ADR 0002에 예외 케이스 추가 절차 명시 (사용자 승인 필요)

---

### R3: Codex 가용성 폴백을 명시

**문제:**
2026-05-06에 Codex usage limit이 hit되어 codex:rescue 호출이 실패했다. 본 작업이 Codex 의존도 100%인데 폴백 없음.

**보강안:**

#### 작업 분류

| 작업 | Codex 필요 | Claude 단독 가능 |
|------|----------|----------------|
| Code 작성/수정 (.mjs/.tsx/.ts) | ✅ 필수 | ❌ |
| Code 삭제 | ✅ 필수 | ❌ |
| Migration 작성 | ✅ 필수 | ❌ |
| 문서 작성/수정 (.md) | 권장 | ✅ 가능 |
| Plan/제안서 작성 | 권장 | ✅ 가능 |
| Decision 기록 (decisions.md) | 권장 | ✅ 가능 |
| Architecture review/annotation | 권장 | ✅ 가능 |

#### 폴백 절차

1. **Codex 가용성 사전 체크** — 각 stage 시작 전:
   ```bash
   node "$CODEX_COMPANION_PATH" setup --json
   ```
   `ready: true` 확인.

2. **Codex 다운 시 stage 진행 정책:**

   | Stage | Codex 다운 시 |
   |-------|-------------|
   | Stage -1 (branch hygiene) | conflict 분석 docs는 Claude 가능, 실제 merge는 보류 |
   | Stage 0 (CONTEXT/ADR) | Claude 단독 가능 — 진행 |
   | Stage 0.5 (test infra) | config/scaffolding은 Claude도 가능, 실제 테스트 통과 검증은 보류 |
   | Stage 1 (state audit) | Claude 단독 가능 — 진행 |
   | Stage 2A (chat 추출) | 보류 |
   | Stage 2B (UI 분리) | 보류 |
   | Stage 3 (helpers) | 보류 |
   | Stage 4 (repo split) | 보류 |
   | Stage 5 (import 추출) | 보류 |

3. **사용자 통지** — Codex 다운 감지 시 즉시 보고 + 보류된 stage 재시작 시점 안내.

4. **장기 다운 (≥ 24시간) 시 대안:**
   - 작은 docs-only 작업으로 진행 전환
   - 별도 코드 작성 도구 (직접 user, 또는 Cursor 등) 사용 옵션 명시

---

### R4: Facade sunset 구체적 일정

**문제:**
V2는 "facade sunset은 ADR에 기록한다"고만 한다. ADR이 작성되어도 시점이 모호하면 영원한 facade가 된다.

**보강안:**

#### Sunset 기준 (ADR 0003 후보)

`supabasePaperRepository` facade는 다음 중 *먼저 도래*하는 시점에 sunset:

1. **시간 기반:** Stage 4 완료 후 6개월
2. **호출 기반:** repository 함수 호출의 ≥ 80%가 내부 모듈을 직접 import
3. **이벤트 기반:** 다음 major refactor cycle (예: Stage 5 종료 후 다음 architecture review)

#### Sunset 단계

```
T+0       : facade 100% 호출 유지 (Stage 4 완료 시점)
T+3개월   : facade에 console.warn (개발 모드만)
T+6개월   : facade에 deprecation 표시 (JSDoc @deprecated + 빌드 경고)
T+9개월   : facade 호출이 80% 미만이면 강제 마이그레이션 schedule
T+12개월  : facade 제거 PR 시작
```

#### Migration helper

```ts
// frontend/src/lib/supabasePaperRepository.ts
// @deprecated since 2026-XX-XX. Use paperRepository/{domain}.ts directly.
export function getPaperById(id: string) {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[deprecated] supabasePaperRepository.getPaperById — use paperRepository/papers.getPaperById');
  }
  return papersImpl.getPaperById(id);
}
```

#### 측정

ADR에 진행 메트릭 부록:
- 매월 1일: facade 호출 수 vs 내부 모듈 직접 호출 수 카운트
- 결과를 `docs/harness/decisions/0003-facade-sunset.md`에 append

---

### R5: Abort propagation 테스트 명시

**문제:**
V2는 Stage 3 "필수 테스트 후보"에만 abort 항목 1줄 있다. 그러나 abort는 모든 stage의 동작에 영향. Stage 1 audit, Stage 2A chat, Stage 5 import 모두 abort 흐름이 있다.

**보강안:**

#### Stage 0.5 (test infra)에 abort helper 신설

```js
// apps/desktop/electron/__tests__/helpers/abort-utils.mjs
export function createAbortableTest(fn) {
  const controller = new AbortController();
  const promise = fn(controller.signal);
  return { controller, promise };
}

export async function expectAbortError(promise) {
  try {
    await promise;
    throw new Error('Expected AbortError');
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
}
```

#### 각 stage별 필수 abort 테스트

| Stage | 필수 abort 테스트 |
|-------|-----------------|
| Stage 1 (state audit) | abort propagation contract 문서화 — 테스트 아님 |
| Stage 2A (chat 추출) | `runTableConversationPipeline` abort 중간 단계 5개 |
| Stage 2B (UI 분리) | (해당 없음) |
| Stage 3 (helpers) | source-evidence + agentic-null-recovery abort 각각 |
| Stage 4 (repo split) | 취소 가능 query 1개 (있다면) |
| Stage 5 (import 추출) | import job abort + embedding job abort |

#### Stage 2A 구체 테스트 케이스 (필수)

1. orchestrator 호출 중 abort → AbortError 전파, 상태 정리
2. RAG 검색 중 abort → AbortError, partial chunk 노출 안 됨
3. Stage 3b (per_paper extraction) 중 abort → 진행 중 논문만 abort, 완료된 결과 보존
4. Stage 3c (merge) 중 abort → 가능하면 완료된 merge까지 보존
5. Stage 3d (NULL recovery) 중 abort → fail-soft, agenticRecovery.success=false

#### Status event 전파 검증

abort 시 frontend로 갈 status event 시퀀스 검증:
```
[abort 발생]
→ status: { stage: 'aborted', message: '취소됨' }
→ no further status events
→ assistant message stream cleanup
```

---

## Open Questions 4건에 대한 Claude 답변

### Q1: Branch Integration Before Refactor

**Codex default:** Yes for runtime refactor. Docs-only work can continue.

**Claude 답변:** **동의.** 단 단서 추가:
- Stage -1을 "branch hygiene"이라 부르고 실제 merge 실행은 별도 결정. 문서로 conflict 분석부터 우선.
- PR #1 follow-up 6건 처리 여부도 Stage -1 안에 포함.

→ 채택 시 D4 후보.

### Q2: Test Infrastructure Scope

**Codex default:** Start with one pure helper test, then add preload contract tests before IPC refactor.

**Claude 답변:** **동의 + 보강 1가지:**
- LLM (Ollama) mock 전략 결정도 Stage 0.5에 포함. chat/table 테스트는 LLM 호출 mock 없으면 작성 불가.
- Supabase fixture 결정도 Stage 0.5에 포함. 통합 테스트는 fixture 없으면 작성 불가.

→ 채택 시 D5 후보.

### Q3: Domain Glossary Location

**Codex default:** Use both — `CONTEXT.md` 엔트리, `harness/main/glossary.md` 상세.

**Claude 답변:** **동의 + nuance 1가지:**
- `CONTEXT.md`는 **단순 index** 역할만 — 자체 정의 최소화, harness/glossary로 링크
- 그래야 두 파일 동기화 부담 줄음
- ADR도 `harness/decisions/`에 두고 `CONTEXT.md`는 그 위치만 가리킴

→ 채택 시 D6 후보.

### Q4: PaperDetail Split Timing

**Codex default:** Yes, parallel if separate workstreams + behavior-preserving.

**Claude 답변:** **동의 + 단서 2가지:**
- 한 사람(또는 한 PR)이 frontend(Stage 2B) + backend(Stage 2A) 동시 만지지 않음
- supplementary PDF 신규 기능은 Stage 2B 시작 전 일단 stable 상태로 commit (현재 4 commit ahead 상태 push 후 시작)

→ 채택 시 D7 후보.

---

## decisions.md 승격 후보

본 문서가 사용자/Codex 검토 후 승인되면:

| ID | 내용 | 출처 |
|----|------|------|
| D4 | Branch hygiene first (Q1) | Q1 |
| D5 | Test infra includes LLM/Supabase mock decision (Q2 보강) | Q2 + R3 |
| D6 | CONTEXT.md as index only, harness as canonical (Q3 nuance) | Q3 |
| D7 | PaperDetail parallel split with stability constraints (Q4) | Q4 |
| D8 | KPI hard gate per stage (R1) | R1 |
| D9 | Module ownership ADR 0002 (R2) | R2 |
| D10 | Codex unavailability fallback policy (R3) | R3 |
| D11 | Facade sunset concrete timeline (R4) | R4 |
| D12 | Abort propagation tests per stage (R5) | R5 |

---

## 다음 단계

1. 사용자가 본 보강안 검토
2. Codex가 본 보강안에 대한 의견을 `codex-to-claude.md`에 회신
3. 합의된 항목을 `decisions.md`로 D4~D12 승격
4. 미합의 항목은 `open-questions.md`에 추가 등록
5. 그 후 Stage -1 (branch hygiene) 첫 작업 시작

## 참고

- 본 문서는 Codex가 작성한 v2의 방향성을 그대로 유지한다. 새로운 설계 결정을 추가하지 않는다.
- 모든 보강은 v2의 stage 구조에 맞물린다 (각 stage 내부 검증 강화).
- "현재 사실" 부분(예: main.mjs 줄 수)은 첫 commit 시점에 실측해 확정한다.
