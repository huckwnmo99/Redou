# Redou Architecture And Debuggability Review

Status: proposal (with Claude annotations 2026-05-07)
Date: 2026-05-07
Agent: Codex (initial), Claude (annotation)
Skills used: `zoom-out`, `improve-codebase-architecture`, `plan`

> **🔍 Claude 메타 코멘트:**
> 이 문서에 한국어 인라인 코멘트를 추가했다. 원본 Codex 분석은 그대로 보존하고, 각 섹션 뒤에 `**🟦 Claude 의견:**` 블록쿼트로 의견을 단다. 마지막에 종합 평가 섹션이 있다.
>
> 한 줄 요약: **진단은 정확하지만 "현재 상황 무시"라는 큰 결함**이 있다. 분기 상태(22파일 conflict 미해결), 테스트 인프라 구체화 부재, State 추출 위험 미고려가 핵심 누락 사항이다.

## Purpose

This document records the current structural risks in Redou and a staged plan for making the codebase easier to debug without disrupting working product behavior.

The goal is not a broad rewrite. The goal is to turn the largest shallow Modules into deeper Modules with smaller Interfaces, better Locality, and a test surface that can catch regressions before runtime Electron walkthroughs.

## Korean Summary

현재 Redou는 전체 구조가 무너진 상태는 아니지만, 몇몇 큰 Module이 너무 많은 역할을 가지고 있어서 디버깅 비용이 커지고 있다.

가장 중요한 문제는 `apps/desktop/electron/main.mjs`가 Electron shell, IPC, import, extraction, embedding, RAG, chat, table generation, Stage 3d recovery, backup, LLM 설정까지 모두 포함한다는 점이다. 그 다음으로 `PaperDetailView.tsx`와 `supabasePaperRepository.ts`가 너무 넓어져 UI 수정과 데이터 흐름 추적이 어려워지고 있다.

해결 방향은 대규모 재작성보다 작은 단계로 쪼개는 것이다. 먼저 `CONTEXT.md`와 ADR로 용어와 결정 사항을 고정하고, 순수 helper 테스트를 만든 뒤, chat/table pipeline과 source evidence/Stage 3d helper를 `main.mjs`에서 분리한다. 이후 import/processing pipeline, Paper detail UI, frontend repository Implementation을 차례대로 나누는 것이 가장 안전하다.

## Current Shape

Redou is not structurally broken. The codebase has a clear product direction and several useful existing Modules:

- Frontend shell: `frontend/src/app/AppShell.tsx`
- Feature screens: `frontend/src/features/**`
- Query hooks: `frontend/src/lib/queries.ts`, `frontend/src/lib/chatQueries.ts`
- Desktop bridge: `frontend/src/lib/desktop.ts`, `frontend/src/types/desktop.ts`
- Electron shell and runtime: `apps/desktop/electron/main.mjs`
- Extraction helpers: `apps/desktop/electron/pdf-heuristics.mjs`, `apps/desktop/electron/ocr-extraction.mjs`
- LLM helpers: `apps/desktop/electron/llm-chat.mjs`, `apps/desktop/electron/llm-orchestrator.mjs`, `apps/desktop/electron/llm-qa.mjs`
- External adapters: `mineru-client.mjs`, `grobid-client.mjs`, `embedding-worker.mjs`, `reranker-worker.mjs`

The main issue is that a few Modules have grown too wide. Those Modules now carry too much Interface knowledge, so debugging requires loading too many unrelated concepts at once.

> **🟦 Claude 의견 — 현재 상황 인식 보강 필요:**
> 이 리뷰가 작성된 시점(2026-05-07)에 V3 브랜치의 실제 상태:
> - `feature/pipeline-v2-only`는 `origin/main`과 **22파일 conflict** 분기 상태 (PR #1 엔티티 그래프 미통합)
> - 최근 11 commit 동안 main.mjs에 +678줄 추가 (Stage 3d, supplementary PDF, source labels 등)
> - 사용자가 동시에 **Ouroboros 도입 + mattpocock skills 통합 + 옛 워크플로우 정리** 작업을 진행 중
>
> Codex 리뷰는 이 모두를 무시한 "고립된 분석"이다. 실행하려면 **분기 통합과 워크플로우 정리가 선행**되어야 한다. 그렇지 않으면 refactor가 conflict를 폭증시킨다.

## Highest-Risk Findings

### 1. `apps/desktop/electron/main.mjs` is the main bottleneck

Files:

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/types/ipc-channels.mjs`
- `apps/desktop/electron/preload.mjs`

Problem:

`main.mjs` owns window lifecycle, renderer fallback, filesystem import, generic DB query/mutation IPC, backup/restore, Google OAuth, extraction job processing, embedding job processing, RAG, chat, table generation, Stage 3d NULL recovery, CSV export, and LLM model settings.

This makes the Module shallow despite having a large Implementation: callers and maintainers must understand many ordering rules, auth rules, DB tables, abort behavior, and IPC event shapes at the same time. A chat bug can require reading import code, DB proxy code, RAG code, and status broadcasting code in one file.

Solution:

Deepen it by extracting runtime slices behind narrow internal Interfaces:

- `electron/ipc/register-db-ipc.mjs`
- `electron/ipc/register-file-ipc.mjs`
- `electron/pipeline/import-processing.mjs`
- `electron/pipeline/embedding-processing.mjs`
- `electron/chat/chat-table-pipeline.mjs`
- `electron/chat/chat-qa-pipeline.mjs`
- `electron/chat/source-evidence.mjs`
- `electron/chat/agentic-null-recovery.mjs`

Benefits:

- Locality: chat/table bugs live in one chat Module instead of the full Electron shell.
- Leverage: the same chat pipeline Interface can be used by IPC, future automation, and characterization tests.
- Testability: Stage 3d recovery, source evidence labeling, and table merge behavior can be tested without launching Electron.

Priority:

Critical. This is the first structural issue to address.

> **🟦 Claude 의견 — Section 1: main.mjs 분리:**
> **동의하지만 위험 누락 3가지:**
>
> 1. **State leak 위험** — main.mjs는 `paperRefMap`, `ragResults`, `abortController`, `pipelineStage`, `entityExtractionInFlight` 같은 mutable state를 공유한다. 모듈 8개로 추출 시 state 주입 패턴(closure / class instance / 인자 전달) 결정이 선행돼야 한다. 그냥 함수만 떼면 글로벌 변수 의존성이 숨겨진다.
>
> 2. **Order dependency** — Stage 3d는 Stage 3c 직후 실행돼야 하고, 임베딩 잡은 추출 잡 후, 엔티티 잡은 임베딩 잡 후. 현재 main.mjs는 이 ordering을 한 곳에서 강제한다. 분리 후엔 ordering 계약을 명시적으로 만들어야 한다 (예: job state machine).
>
> 3. **`runMultiQueryRag` 호출 그래프** — chat-table-pipeline + chat-qa-pipeline + agentic-null-recovery 모두 `runMultiQueryRag` 호출. 어디 둘 건가? 별도 `electron/rag/` 모듈로 또 분리하는 게 자연스럽다 (제안서엔 없음).
>
> **추가 모듈 제안:**
> - `electron/rag/multi-query-rag.mjs` (3 곳에서 공유)
> - `electron/state/job-coordinator.mjs` (잡 ordering 계약)
>
> **측정 가능한 KPI 추가 권장:**
> - main.mjs ≤ 1,500줄 (현재 ~3,500+줄)
> - main.mjs IPC 핸들러 ≤ 10개 (현재 ~25+)
> - main.mjs import ≤ 8개 (현재 ~15+)

## 2. Chat/RAG/Table pipeline has too many responsibilities in one flow

Files:

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/llm-orchestrator.mjs`
- `apps/desktop/electron/llm-chat.mjs`
- `apps/desktop/electron/llm-qa.mjs`
- `apps/desktop/electron/html-table-parser.mjs`

Problem:

The table chat flow mixes:

- conversation creation/loading
- user message persistence
- orchestrator planning
- multi-query RAG
- paper metadata loading
- table OCR backfill
- per-paper extraction
- merge
- Stage 3d recovery
- generated table persistence
- status streaming
- abort behavior

The current Interface is effectively "send a chat message and know the entire pipeline." That is too broad for debugging. It also makes it easy for fallback paths to carry stale or misleading metadata.

Solution:

Introduce an internal `runTableConversationPipeline` Module with one narrow Interface:

```ts
runTableConversationPipeline({
  conversationId,
  message,
  ownerId,
  scope,
  history,
  abortSignal,
  emitStatus,
})
```

Keep existing behavior first. Move code without redesigning prompts or retrieval. After the move, split pure helpers:

- source evidence formatting
- table spec normalization
- NULL recovery
- generated table metadata assembly

Benefits:

- Locality: generated-table correctness issues become pipeline issues, not Electron-shell issues.
- Leverage: the pipeline can be tested with fake Supabase and fake LLM adapters later.
- Safer future work: supplementary source labels, DOCX conversion, and Graph RAG can attach to the pipeline without inflating `main.mjs`.

Priority:

Critical, immediately after or together with the first `main.mjs` split.

> **🟦 Claude 의견 — Section 2: chat 파이프라인 분리:**
> **`runTableConversationPipeline()` 인터페이스 좋다. 그러나:**
>
> 1. **`emitStatus` 콜백 의존성** — 이 콜백은 IPC broadcast로 연결되어 있다. 분리 시 콜백 시그니처(`{ stage, message, detail }`)를 타입으로 고정해야 한다. 그렇지 않으면 status 이벤트 누락이 silent하게 발생.
>
> 2. **fallback 경로 처리 누락** — 현재 chat 파이프라인은 `extractionFallbackNeeded` 분기가 있고 `single_call_fallback` 모드가 존재. 이를 새 모듈에 어떻게 옮길지 명시 필요. fallback 코드가 main 코드와 섞여 있는 게 현 문제의 핵심 중 하나.
>
> 3. **회귀 테스트 시나리오 부족** — "Existing Electron chat runtime walkthrough for one Q&A and one table generation" → 이건 부족하다. 최소한:
>    - Q&A 정상 흐름
>    - Table 생성 정상 흐름 (per_paper)
>    - Table 생성 fallback 흐름 (single_call_fallback)
>    - Stage 3d trigger (NULL ≥ 5%)
>    - Stage 3d skip (NULL = 0)
>    - Abort 중간 (각 stage)
>    - LLM 타임아웃
>    - 7개 시나리오 + abort 변형
>
> 4. **`html-table-parser.mjs`는 chat에 직접 안 들어감** — Section 2의 Files 목록에 있지만 chat pipeline 내부에서 호출되는 게 아니라 OCR backfill 시점에 호출. 분리 시 import 위치 정리 필요.
>
> **재배치 권장:** 이 Stage를 Section 1과 같이 묶지 말고 **순서대로** 진행. 이유: Section 2의 분리는 Section 1의 `chat-table-pipeline.mjs`/`chat-qa-pipeline.mjs` 안에서 일어남. 동시 진행 시 conflict.

## 3. `PaperDetailView.tsx` is too broad for UI debugging

Files:

- `frontend/src/features/paper/PaperDetailView.tsx`
- `frontend/src/features/paper/PdfReaderWorkspace.tsx`
- `frontend/src/lib/queries.ts`
- `frontend/src/lib/desktop.ts`

Problem:

`PaperDetailView.tsx` contains the overview, PDF tab, supplementary file attach logic, highlight controls, note creation from highlights, figure/table/equation rendering, references, metadata, and page-jump behavior.

The user experience is coherent, but the Module Interface is too large: changing supplementary attach copy or figure rendering requires reading a file that also owns highlight deletion, reader anchors, and metadata display.

Solution:

Split leaf UI Modules while preserving the existing exported `PaperDetailView`:

- `PaperOverviewTab.tsx`
- `PaperPdfTab.tsx`
- `PaperSupplementaryFilesPanel.tsx`
- `PaperFiguresTab.tsx`
- `PaperReferencesTab.tsx`
- `PaperMetadataTab.tsx`

Do this as mechanical extraction first. Do not redesign the UI in this step.

Benefits:

- Locality: UI bugs are closer to the tab/panel they affect.
- Leverage: `PaperDetailView` becomes a small coordinator.
- Testability: future visual or hook tests can target one tab at a time.

Priority:

High. Do this after Electron pipeline extraction or as a separate low-risk frontend-only slice.

> **🟦 Claude 의견 — Section 3: PaperDetailView 분리:**
> **타이밍이 잘못됐다 — 이 Stage를 앞당겨야 한다.**
>
> 사용자가 *지금* supplementary PDF 기능을 추가하고 있다 (commit 76401b1, 36051cf, 206bb3f가 모두 supplementary 관련). 즉:
> - 현재: `PaperDetailView.tsx`에 supplementary attach 코드 추가 중
> - 제안서대로면: Stage 4(이 작업)는 Stage 1-3 후 → **수 주 후**
> - 그 사이 supplementary 코드가 더 비대화 → Stage 4 시점에 더 큰 conflict
>
> **권장: Stage 4를 Stage 1과 병렬로 진행** (frontend-only라서 main.mjs 분리와 독립적).
>
> **추가 우려:**
> 1. **Tab간 state 공유 누락** — 하이라이트/노트 같은 state가 여러 tab에서 사용. 모듈로 빼면 state 위치 결정 (Zustand store / React Context / props drilling) 필요.
> 2. **PdfReaderWorkspace.tsx와의 관계 불명** — Section 3 Files에 있지만 problem 설명에 안 나옴. 같이 분리할지 그대로 둘지 불명확.
> 3. **PaperPdfTab.tsx는 viewer 일부?** — viewer가 PaperDetailView 내부인지 별도 화면인지 코드 보고 결정 필요.

## 4. `supabasePaperRepository.ts` has become a broad repository

Files:

- `frontend/src/lib/supabasePaperRepository.ts`
- `frontend/src/lib/queries.ts`
- `frontend/src/types/paper.ts`

Problem:

The repository currently covers papers, folders, chunks, sections, figures, notes, highlights, highlight presets, primary files, supplementary files, imports, and cleanup behavior.

Centralization was useful earlier, but now the Interface is large enough that unrelated domain rules sit together. A supplementary file change can require understanding note/highlight mapping code and paper list signal aggregation.

Solution:

Keep the existing `supabasePaperRepository` export as a facade for compatibility, but move Implementation into smaller internal Modules:

- `paperRepository/papers.ts`
- `paperRepository/files.ts`
- `paperRepository/extraction.ts`
- `paperRepository/notes.ts`
- `paperRepository/highlights.ts`
- `paperRepository/folders.ts`
- `paperRepository/mappers.ts`

The first slice should only move mapper functions and file-related operations. The external Interface should stay stable until callers can be migrated safely.

Benefits:

- Locality: paper file ownership and supplementary logic become easy to audit.
- Leverage: the facade keeps query hooks stable while Implementation becomes navigable.
- Testability: mapper tests can be added without mounting React.

Priority:

High, but after at least one test scaffold exists.

> **🟦 Claude 의견 — Section 4: supabasePaperRepository 분리:**
> **Facade 패턴 옳지만, 마이그레이션 정책 누락.**
>
> 1. **언제 facade를 걷어내나?** — 영원한 facade는 안티패턴. ADR에 "facade는 X개 PR 동안 유지, 이후 query 훅 직접 호출로 마이그레이션" 같은 sunset 정책 명시 필요.
>
> 2. **`paper_files`/`supplementary_files` 도메인 누락** — 제안서의 모듈 목록(`papers`, `files`, `extraction`, `notes`, `highlights`, `folders`, `mappers`)에서 supplementary file이 `files`에 묶이는데, 사용자의 새 마이그레이션(`20260504_add_supplementary_source_tracking`, `20260506_add_rag_source_file_metadata`)을 보면 supplementary는 별도 도메인 개념(`source_kind`, `source_file_id`). 별도 모듈 권장.
>
> 3. **Mappers 모듈 첫 슬라이스 — 검증 어려움** — "mapper functions and file-related operations 먼저 이동"은 좋다. 그러나 mapper는 type 변환이라 logic이 적음. 첫 slice는 차라리 **highlights 도메인** 같은 self-contained 영역이 더 안전.
>
> **추가 권장:**
> - `paperRepository/source-files.ts` (supplementary 전용)
> - 각 모듈에 README.md 추가 (도메인 경계 문서화)

## 5. There is almost no automatic regression test surface

Files:

- `frontend/package.json`
- `apps/desktop/package.json`
- `apps/desktop/electron/*.mjs`
- `frontend/src/features/search/searchModel.ts`

Problem:

The stack includes Vitest and Playwright, but no `*.test.ts`, `*.spec.ts`, or `*.e2e.ts` files were found in the repo scan. Current verification depends mostly on build checks, `node --check`, manual Supabase checks, and Electron runtime walkthroughs.

This is risky because the most fragile behavior is semantic: citation labels, source evidence, table metadata, abort behavior, import cleanup, and stage status. Build checks cannot prove those.

Solution:

Add characterization tests before major refactors:

- `apps/desktop/electron/html-table-parser.test.mjs`
- `apps/desktop/electron/source-evidence.test.mjs` after extraction
- `apps/desktop/electron/agentic-null-recovery.test.mjs` after extraction
- `frontend/src/features/search/searchModel.test.ts`
- `frontend/src/lib/desktop.test.ts` for result/error normalization

Start with pure functions only. Avoid full Electron automation until the small test surface is useful.

Benefits:

- Locality: tests document the intended Interface.
- Leverage: future refactors can move code while keeping behavior fixed.
- Debugging speed: failures point to a specific Module instead of a full runtime walkthrough.

Priority:

High. Add the first tests before touching the heaviest logic.

> **🟦 Claude 의견 — Section 5: 테스트 표면 부재:**
> **이게 가장 큰 누락이다. 테스트 인프라 자체가 없는데 "테스트 추가"라는 한 줄로 끝.**
>
> **누락된 것:**
>
> 1. **vitest config for ESM .mjs** — `apps/desktop/electron/`은 `.mjs` ESM. vitest는 기본적으로 ESM 지원하지만 Electron-specific import (electron, IPC) mock 방식 결정 필요. 별도 setup 파일 필요.
>
> 2. **Ollama mock 전략** — chat pipeline 테스트하려면 LLM 호출 mock 필수. nock? msw? 직접 fetch mock? 결정 필요.
>
> 3. **Supabase 테스트 환경** — 통합 테스트는 supabase test instance 필요. 현재 `supabase/seed/` 부재. fixture 데이터 어떻게 준비할지.
>
> 4. **frontend ↔ Electron 계약 테스트 부재** — `window.redouDesktop` API 타입이 `frontend/src/types/desktop.ts`에 있지만 실제 preload.mjs export와 일치 검증 없음. 분리 시 깨질 수 있음. 계약 테스트 권장.
>
> 5. **AbortSignal propagation 테스트 부재** — Stage 3d, recovery, multi-query RAG 모두 abort 거침. 분리 후 abort 전파 깨질 수 있음. 제안서에 abort 테스트 1번도 안 적힘.
>
> 6. **Coverage threshold 미정의** — "characterization tests"라고만. 새 모듈이 ≥ 80% coverage 같은 정책 명시 필요.
>
> **권장 — Stage 0.5 신설 (필수):**
> ```
> Stage 0.5: 테스트 인프라 부트스트랩 (1~2일)
> - vitest config for apps/desktop ESM .mjs
> - Ollama mock helper (msw 권장)
> - Supabase fixture/seed 첫 셋
> - frontend ↔ Electron 계약 테스트 1개 (preload export 일치 확인)
> - AbortController propagation 테스트 helper
> - npm run test 동작 확인
>
> 검증:
> - vitest 실행 → 1개 테스트 통과
> - CI 훅 추가 (선택)
> - coverage threshold 정책 ADR 작성
> ```
>
> 이 Stage 없이 Stage 1 들어가면 "테스트 없는 refactor" — 회귀 잡을 수 없다.

## 6. Domain documentation is rich but not centered

Files:

- `AGENTS.md`
- `docs/features/**`
- `docs/harness/**`
- `docs/agents/redou-spec-loop.md`

Problem:

There is no root `CONTEXT.md` and no `docs/adr/` directory. The project has plenty of history, but key domain language is spread across `AGENTS.md`, feature docs, harness docs, and goal docs.

This makes future agent work slower and less reliable. Terms like main PDF, supplementary PDF, source file, evidence location, generated table, and Stage 3d recovery should have one canonical meaning.

Solution:

Create:

- `CONTEXT.md` for core domain terms
- `docs/adr/0001-local-research-workspace.md`
- `docs/adr/0002-source-file-evidence-model.md`
- `docs/adr/0003-electron-pipeline-module-split.md`

Benefits:

- Locality: decisions are not buried in work logs.
- Leverage: new agents and future planning skills can use the same vocabulary.
- Debugging speed: feature behavior and architecture assumptions are easier to verify.

Priority:

Medium-high. It can be done before code refactors because it does not affect runtime.

> **🟦 Claude 의견 — Section 6: 도메인 문서:**
> **`CONTEXT.md`와 `docs/harness/`의 관계 미정 — 정합성 위협.**
>
> V3 `CLAUDE.md`는 `docs/harness/`를 "단일 진실 원천(Single Source of Truth)"으로 명시한다. 새로 `CONTEXT.md`를 만들면 **경쟁하는 진실 원천**이 생김.
>
> **선택지:**
>
> | 옵션 | 결과 |
> |------|------|
> | (A) `CONTEXT.md` 신규 + harness 그대로 | 두 곳 동기화 부담 → 결국 stale |
> | (B) `CONTEXT.md`가 `docs/harness/main/overview.md`를 대체 | 옵션 A보다 깔끔하지만 기존 링크 다수 깨짐 |
> | (C) `docs/harness/main/glossary.md` 신설 (CONTEXT.md 대신) | harness 정책 유지, 새 파일 1개 |
> | (D) `docs/harness/main/overview.md` 안에 "Core Terms" 섹션 추가 | 가장 단순, 기존 위치 유지 |
>
> **권장: (C) 또는 (D).** harness 단일 진실 원천 정책 유지가 우선.
>
> **ADR 위치도 마찬가지:**
> - `docs/adr/0001-...`은 V3 컨벤션과 안 맞음
> - 권장: `docs/harness/decisions/0001-...` (harness 안에서 관리)
>
> **추가 우려:**
> - **ADR 누가 쓰나?** — Codex? Claude? 사용자? 정책 명시 필요. 안 그러면 ADR 0001-0003 후 새 결정에 ADR 안 쓰임.
> - **ADR 변경 정책** — ADR은 보통 append-only. 갱신 시 새 ADR로 supersede. 이 정책 명시 필요.

## Recommended Staged Plan

> **🟦 Claude 의견 — Stage 순서 전반:**
> **권장하는 보강된 Stage 순서:**
>
> ```
> [신규] Stage -1: 분기 통합 + Follow-up 처리 (필수, 가장 먼저)
> [기존] Stage 0:  CONTEXT/ADR 추가 (방법은 (C)/(D)로)
> [신규] Stage 0.5: 테스트 인프라 부트스트랩 (필수)
> [기존] Stage 1:  chat/table 파이프라인 추출
> [기존] Stage 2:  source evidence + Stage 3d helpers
> [수정] Stage 3:  PaperDetailView 분리 (앞당김 — 사용자 작업과 충돌 줄이기)
> [수정] Stage 4:  Import/processing 파이프라인 추출
> [수정] Stage 5:  supabasePaperRepository 분리
> ```
>
> **이유:**
> - Stage -1: refactor 시작 전 brunch hygiene
> - Stage 0.5: 테스트 없으면 refactor 못 함
> - Stage 3 앞당김: 사용자 supplementary 작업과의 conflict 최소화

### Stage 0: Stabilize the map

Scope:

- Create `CONTEXT.md` with core Redou domain terms.
- Create a first ADR for the module-splitting direction.
- Add one small pure test or smoke test if the test runner can execute in this environment.

Out of scope:

- No runtime code movement.
- No UI redesign.
- No DB schema changes.

Verification:

- Docs are readable.
- `npm run build` remains unchanged if no code changes are made.
- If tests are added, run only the new targeted test command.

> **🟦 Claude 의견 — Stage 0:**
> **"Docs are readable"는 검증 기준이 아니다.** 측정 불가.
>
> **권장 검증 강화:**
> - `CONTEXT.md`(또는 glossary)가 최소 12개 핵심 용어 정의 (main PDF, supplementary PDF, source file, evidence location, generated table, Stage 3d, source_kind, 등)
> - 각 용어가 코드 상 어느 파일에 정의되어 있는지 링크
> - ADR 0001은 본 architecture review를 reference
> - 새 plan/feature 작성 시 CONTEXT.md 용어 사용을 강제 (CLAUDE.md에 명시)

### Stage 1: Extract chat/table pipeline from `main.mjs`

Scope:

- Move table chat pipeline orchestration into a new Electron Module.
- Keep IPC channel names and frontend behavior unchanged.
- Keep existing prompts, SQL calls, and status event names unchanged.

Out of scope:

- No prompt rewrite.
- No RAG algorithm change.
- No citation UI redesign.

Verification:

- `node --check apps/desktop/electron/main.mjs`
- `node --check` for the new chat Module.
- Existing Electron chat runtime walkthrough for one Q&A and one table generation.

> **🟦 Claude 의견 — Stage 1:**
> **검증이 너무 약하다.** chat 파이프라인이 가장 fragile한데 walkthrough 2번?
>
> **권장 검증 강화:**
>
> **자동:**
> - `node --check` (모든 변경/추가 파일)
> - vitest: chat-table-pipeline 단위 테스트 ≥ 5개
>   - 정상 per_paper 흐름
>   - single_call_fallback 흐름
>   - Stage 3d trigger (NULL ≥ 5%)
>   - Stage 3d skip (NULL = 0)
>   - Abort 중간
> - vitest: chat-qa-pipeline 단위 테스트 ≥ 3개
> - 계약 테스트: `emitStatus` 콜백 시그니처 일치
> - Coverage: 새 모듈 ≥ 80%
>
> **수동 (보조):**
> - Q&A 정상 (한 번)
> - Table 정상 (한 번)
> - Abort 중간 (한 번)
> - Ollama down 상태 (한 번) — fallback 검증
>
> **추가 위험:**
> - 추출 후 main.mjs에 남은 코드가 새 모듈을 어떻게 호출하는지 명시 — circular import 위험
> - Stage 1 작업 중 main.mjs 신규 변경 freeze 정책 (제안서에 없음)

### Stage 2: Extract source evidence and Stage 3d helpers

Scope:

- Move source evidence formatting and NULL recovery helpers into pure Modules.
- Add characterization tests around supplementary labels and high-confidence recovery behavior.

Out of scope:

- No new LLM behavior.
- No generated table schema change.

Verification:

- Pure helper tests pass.
- `apps/desktop` build passes.
- Runtime generated table still shows main/supplementary evidence correctly.

> **🟦 Claude 의견 — Stage 2:**
> **방향 좋음. 보강 사항 2가지:**
>
> 1. **NULL recovery 동작이 데이터 의존적** — Stage 3d는 LLM이 "high confidence" 셀만 채움. 테스트 시 mock LLM이 실제와 동일한 분포 생성 못 함. **확정 시나리오** 5개 정의 권장:
>    - LLM이 high 반환 → 셀 채워짐
>    - LLM이 medium 반환 → 셀 N/A 유지
>    - LLM이 low 반환 → 셀 N/A 유지
>    - LLM이 null 반환 → nullSummary 유지
>    - LLM 타임아웃 → fail-soft, agenticRecovery.success=false 기록
>
> 2. **source evidence 라벨링** — main vs supplementary PDF 구분이 새 마이그레이션(`20260504_add_supplementary_source_tracking`)에서 들어왔다. 이 분류 정확성이 핵심. 테스트로 잠가야 함:
>    - source_file_id가 main PDF → "Paper [n]" 라벨
>    - source_file_id가 supplementary PDF → "Paper [n] supplementary" 라벨 (또는 정의된 형식)
>    - source_file_id가 null → 처리 정책 (warn? skip?)

### Stage 3: Extract import/processing pipeline

Scope:

- Move import PDF job processing and embedding job processing out of `main.mjs`.
- Keep IPC and DB job table behavior unchanged.
- Preserve source-file-scoped extraction behavior.

Out of scope:

- No OCR provider change.
- No DOCX conversion in this stage.

Verification:

- `node --check` on moved Modules.
- Electron import walkthrough for one main PDF and one supplementary PDF.
- Confirm `paper_sections`, `paper_chunks`, `figures`, and `processing_jobs` keep `source_file_id` behavior.

> **🟦 Claude 의견 — Stage 3 (import/processing 추출):**
> **타이밍 재고 권장.**
>
> 제안서대로면 Stage 3은 PaperDetailView 분리 *전*에 옴. 그러나:
> - import/processing 코드는 main.mjs에 깊이 박혀 있음 (잡 큐, ordering, abortController 공유)
> - 분리 위험도 = chat 파이프라인 분리와 비슷 또는 더 높음
> - 반면 PaperDetailView 분리는 frontend-only, 위험 낮음
>
> **권장: Stage 3을 Stage 5와 자리 바꿈** (낮은 위험 → 높은 위험 순서).
>
> ```
> 새 순서: Stage 1 (chat) → Stage 2 (helpers) → Stage 3 (UI = 옛 Stage 4)
>          → Stage 4 (repo = 옛 Stage 5) → Stage 5 (import = 옛 Stage 3)
> ```
>
> 또는 위에서 제안한 대로 Stage 3 (UI)은 Stage 1과 *병렬* (frontend/backend 독립).
>
> **추가 검증 권장:**
> - 임베딩 잡 ordering 보존 테스트 (먼저 추출 → 임베딩 → 엔티티 순)
> - `processing_jobs` 상태 전이 테스트
> - 잡 실패 시 retry 로직 테스트

### Stage 4: Split `PaperDetailView.tsx`

Scope:

- Move tab/panel code into leaf Modules.
- Keep `PaperDetailView` as the coordinator.
- Preserve all current UI behavior and copy.

Out of scope:

- No visual redesign.
- No new supplementary reader.
- No highlight feature expansion.

Verification:

- `frontend` build passes.
- Manual navigation: overview, PDF, notes, figures, tables, equations, references, metadata.
- Check supplementary attach button and reader page jump still work.

> **🟦 Claude 의견 — Stage 4 (PaperDetailView 분리):**
> **Manual navigation 검증은 너무 약함. 회귀 잡기 어려움.**
>
> **권장 검증 강화:**
>
> **자동:**
> - vitest + React Testing Library: 각 tab 컴포넌트 렌더링 테스트
> - PaperOverviewTab — 메타데이터 표시
> - PaperPdfTab — PDF 로드, 페이지 점프
> - PaperSupplementaryFilesPanel — 첨부 버튼, 목록
> - PaperFiguresTab — figures 갤러리
> - PaperReferencesTab — 참조 목록 + 클릭 링크
> - PaperMetadataTab — DOI, authors 등
> - 각 tab 간 state 공유 검증 (예: 하이라이트 → 노트 생성)
>
> **수동:**
> - 큰 PDF (100쪽+) 페이지 점프
> - supplementary PDF 첨부 후 immediate 표시
> - 하이라이트 + 노트 생성 흐름
>
> **추가 우려:**
> - Tab 간 state 위치 결정 누락 — Zustand `paperStore`로 빼나? React Context? props?
> - URL routing — 현재 PaperDetailView가 query param으로 tab 결정하는지 확인 필요
> - PdfReaderWorkspace.tsx의 운명 — 이 Stage에서 같이 분리? 그대로?

### Stage 5: Split frontend repository Implementation

Scope:

- Keep `supabasePaperRepository` facade.
- Move mappers and domain operations into internal Modules.
- Migrate query hooks only after the facade remains stable.

Out of scope:

- No DB schema change.
- No query-key redesign in the first slice.

Verification:

- Mapper tests or targeted repository smoke checks.
- `frontend` build passes.
- Import, paper list, paper detail, notes, highlights, and supplementary file list still load.

> **🟦 Claude 의견 — Stage 5 (repo 분리):**
> **Facade 패턴 sunset 정책 명시 안 됨 — 영원한 facade는 안티패턴.**
>
> **권장 추가:**
>
> 1. **Facade sunset 일정** — ADR에 명시:
>    - "facade는 6개월 또는 다음 major 리팩토링까지 유지"
>    - "이후 query 훅이 직접 모듈 호출하도록 마이그레이션"
>
> 2. **Migration helper** — facade가 deprecated 표시 + 호출 시 console.warn (개발 모드)
>
> 3. **소스 추적** — 어떤 query 훅이 어떤 도메인을 호출하는지 매트릭스 작성
>
> **추가 모듈 권장:**
> - `paperRepository/source-files.ts` (supplementary 전용 — 새 마이그레이션 반영)
> - 각 모듈에 README.md (도메인 경계 문서화)
>
> **검증 강화:**
> - vitest mapper unit test (DB 안 띄우고)
> - Smoke test: 5개 핵심 query 훅이 정상 동작하는지

## Preferred Order

1. Domain context and ADR docs.
2. Pure helper test scaffold.
3. Chat/table pipeline extraction.
4. Source evidence and Stage 3d helper extraction.
5. Import/processing pipeline extraction.
6. Paper detail UI split.
7. Repository Implementation split.

This order reduces risk because it creates a small test surface before moving the most sensitive runtime logic.

> **🟦 Claude 의견 — Preferred Order 재정렬:**
> 위 순서는 **현재 상태 무시 + 사용자 진행 작업 무시**.
>
> **수정된 순서 (Claude 권장):**
>
> ```
> 0. [신규] 분기 통합: 22파일 conflict 해결 → origin/main 통합
>    + PR #1 follow-up 6건 처리
> 1. Domain context (CONTEXT/glossary) + ADR (필수: docs/harness/decisions/)
> 2. [신규] 테스트 인프라 부트스트랩 (vitest config, Ollama mock, fixture, 계약 테스트)
> 3. 첫 pure helper test (html-table-parser 또는 searchModel)
> 4a. Chat/table pipeline 추출      ┐ (병렬 가능)
> 4b. PaperDetailView 분리           ┘ (사용자 supplementary 작업과 충돌 줄이기)
> 5. Source evidence + Stage 3d helpers
> 6. Repository Implementation 분리 (mapper 대신 highlights부터)
> 7. Import/processing pipeline 추출 (가장 위험 → 마지막)
> ```
>
> **주요 변경 이유:**
> - **0번 추가**: refactor 시작 전 brunch hygiene
> - **2번 추가**: 테스트 인프라 없이 refactor = 회귀 못 잡음
> - **4a/4b 병렬화**: backend(chat) ↔ frontend(UI)는 독립 영역
> - **7번 (import) 마지막**: 잡 큐 ordering이 가장 fragile

## Non-Goals

- Do not rewrite the app shell.
- Do not replace Supabase.
- Do not redesign Redou Style UI in this workstream.
- Do not change citation semantics unless a specific feature plan requests it.
- Do not remove legacy renderer files until a separate migration decision is recorded.
- Do not combine DOCX supplementary conversion with architecture cleanup.

## Success Criteria

The cleanup is successful when:

- `main.mjs` becomes mostly app lifecycle plus IPC registration.
- Chat/table behavior can be debugged without reading import and backup code.
- Paper detail UI changes can be made inside one tab Module.
- Source evidence and Stage 3d behavior have small tests.
- New agents can understand Redou terms from `CONTEXT.md` plus ADRs instead of scanning the whole work log.

## Immediate Next Slice Recommendation

Start with Stage 0.

The smallest useful next slice is:

1. Create `CONTEXT.md` with Redou core terms.
2. Create `docs/adr/0001-debuggable-module-split.md`.
3. Add one pure test target around either `searchModel.ts` or `html-table-parser.mjs`.

This gives the later refactor a shared language and at least one mechanical safety check before touching high-risk runtime code.

> **🟦 Claude 의견 — Immediate Next Slice:**
> **틀렸다. 다음 slice는 Stage 0이 아니라 분기 통합(Stage -1).**
>
> 이유: 22파일 conflict가 있는 상태에서 main.mjs/PaperDetailView/repository를 만지면 conflict가 30+ 파일로 폭증. **refactor 시작 전 분기 hygiene이 필수.**
>
> **Claude 권장 첫 slice:**
>
> ```
> 1. origin/main 가져오기 → conflict 해결
>    - 코드 8개 (main.mjs, ocr-extraction.mjs, preload.mjs,
>                ipc-channels.mjs, ChatPipelineStatus.tsx,
>                SettingsView.tsx, chatQueries.ts, desktop.ts)
>    - 하네스 12개
> 2. PR #1 follow-up 6건 처리 (또는 백로그로 미루기 결정)
> 3. git tag: v3-pre-refactor-2026-05-07
> 4. 그 후에 Stage 0 진입
> ```
>
> 이걸 안 하면 refactor 자체가 무의미. 같은 파일을 두 갈래에서 분리/추가하는 셈.

---

# 🔍 Claude 종합 평가

## 한 줄 평

**진단은 정확하지만 "현재 상황과 분리된 이상론"이라는 큰 결함**이 있다. 실행하려면 **사전 작업(Stage -1, Stage 0.5)** 과 **여러 보강(KPI, freeze 정책, mock 전략)** 이 필수다.

## 평가표

| 항목 | 점수 | 이유 |
|------|-----|------|
| 진단 정확성 | ★★★★★ | main.mjs 비대화는 실측과 일치 |
| 안전 우선 순서 | ★★★★☆ | 기본 방향 맞으나 일부 stage 순서 의문 |
| **현재 분기 상태 인식** | ★☆☆☆☆ | **22파일 conflict 무시 — 치명적** |
| **테스트 인프라 구체화** | ★☆☆☆☆ | "테스트 추가" 한 줄, vitest ESM/mock 정의 없음 |
| **사용자 진행 작업 인식** | ★☆☆☆☆ | supplementary PDF 진행 중 무시 |
| 측정 가능한 성공 기준 | ★★☆☆☆ | "mostly app lifecycle" — 모호 |
| State 추출 안전성 | ★★☆☆☆ | mutable state 추출 위험 미고려 |
| Module ownership 정책 | ★★☆☆☆ | "신기능 어디 둘 건가?" 미정의 |
| Refactor freeze 정책 | ☆☆☆☆☆ | 부재 |
| 롤백 계획 | ☆☆☆☆☆ | 부재 |
| Codex 의존성 폴백 | ☆☆☆☆☆ | 부재 |

## 22개 누락 사항 정리

### 🔴 Critical (5)
1. **분기 통합 사전 작업 부재** — 22파일 conflict 미해결 상태에서 refactor 시작 → conflict 폭증
2. **테스트 인프라 정의 부재** — vitest ESM, Ollama mock, Supabase fixture 미정
3. **State 추출 audit 부재** — mutable state(paperRefMap, ragResults 등) 추출 시 leak 위험
4. **사용자 진행 작업 미고려** — supplementary PDF 작업 중인데 PaperDetailView 분리 후순위
5. **회귀 테스트 시나리오 부족** — Stage 1 검증 = walkthrough 2번 (불충분)

### 🟡 Medium (8)
6. **Stage 순서 의문** — import(Stage 3) vs UI(Stage 4) 우선순위 재고
7. **Refactor freeze 정책 부재** — 분리 중 신규 변경 어떻게 처리?
8. **측정 가능한 KPI 부재** — "mostly app lifecycle" 모호
9. **PR #1 Follow-up 처리 누락** — 6건 어떻게 할지 결정 안 됨
10. **Module ownership 정책 누락** — 새 기능 배치 규칙
11. **AbortSignal propagation 테스트 누락** — 모든 stage에서 abort 위험
12. **롤백 계획 부재** — Stage 망가지면 어떻게 되돌리나
13. **CONTEXT.md ↔ harness/ 정합성 미정** — 경쟁 진실 원천 위험

### 🔵 Minor (9)
14. **`html-table-parser.mjs` 첫 테스트 이유 미설명**
15. **`searchModel.ts`가 ChatTableReport.tsx와 결합** — 곧 변할 수 있음
16. **Codex 한도 의존성** — 폴백 미정의
17. **Ollama mock 전략 미정** — chat 테스트 불가
18. **DB seed/fixture 부재** — 통합 테스트 불가
19. **Frontend ↔ Electron 계약 검증 부재** — 분리 시 깨질 수 있음
20. **Migration 갱신 책임 미정**
21. **Facade sunset 정책 부재** — 영원한 facade는 안티패턴
22. **ADR 작성/유지 책임 미정**

## 사용자가 결정해야 할 사항

이 제안서를 실행하려면 사용자가 답해야 할 12가지:

| # | 결정 사항 | Claude 추천 |
|---|---------|-----------|
| D1 | 분기 통합 시점 (Stage -1 추가?) | 추가 — 가장 먼저 |
| D2 | PR #1 follow-up 6건 처리 | Stage -1과 함께 |
| D3 | 테스트 인프라 부트스트랩 (Stage 0.5) | 추가 — Stage 0과 1 사이 |
| D4 | CONTEXT.md vs harness/ 정합성 | 옵션 (C) 또는 (D) — harness 안에서 관리 |
| D5 | KPI 목표 (main.mjs 줄수, IPC 수 등) | main.mjs ≤1500줄, IPC ≤10개 |
| D6 | Refactor freeze 기간 | 각 Stage 별 1주, 신규 변경 별도 브랜치 |
| D7 | Stage 4(UI) 앞당김? | 예 — Stage 1과 병렬 |
| D8 | Stage 3(import) 후순위? | 예 — 가장 마지막 |
| D9 | Codex 다운 시 폴백 | 메인 Claude로 일부 작업, 또는 작업 보류 |
| D10 | Module ownership ADR 작성? | 예 — ADR 0003 or 0004 |
| D11 | Facade sunset 정책 | 6개월 또는 다음 major 후 마이그레이션 |
| D12 | Ouroboros / mattpocock 통합 시점 | refactor 작업 동안 보류 권장 |

## 다음 단계 — Claude 권장 순서

```
[1] 본 리뷰의 D1~D12에 사용자가 답
[2] 답변 반영해 보강된 architecture review v2 작성
[3] 그 후 새 plan 11번(워크플로우 통일) 폐기 또는 재구성 결정
   → architecture refactor와 통합? 별도?
[4] Stage -1 (분기 통합) 첫 작업 시작
   → /plan 으로 통합 계획 수립
   → /fix 또는 codex:rescue (Codex 한도 reset 후)로 실행
```

## 마무리

이 architecture review는 좋은 진단 + 합리적 분할 방향을 제시한다. 그러나 **"현재 V3 상태"** (분기 충돌, 사용자 진행 작업, 테스트 인프라 부재) 를 놓쳤다.

위 12개 결정 사항(D1~D12)을 사용자가 답하면 **실행 가능한 v2 제안서**로 보강 가능하다. 답변 없이 그대로 실행하면 conflict 폭발 + 회귀 미감지 위험이 크다.

— Claude (annotation 추가, 2026-05-07)
