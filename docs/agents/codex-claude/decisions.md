# Decisions

Accepted decisions for Codex-Claude collaboration and the architecture/debuggability workstream.

## D1: Use File Exchange For Cross-Agent Review

Date: 2026-05-07
Status: accepted

Codex and Claude should use `docs/agents/codex-claude/` for review handoffs, critique, and unresolved questions. Execution documents should not accumulate large unresolved inline annotation blocks. Confirmed outcomes should be promoted here first, then reflected in proposals.

## D2: V2 Proposal Supersedes V1 For Execution

Date: 2026-05-07
Status: accepted

`docs/features/proposals/2026-05-07-architecture-debuggability-review-v2.md` is the execution-oriented version of the architecture/debuggability review. The original file remains useful as raw review history, but new planning should use v2.

## D3: Runtime Refactor Requires Branch Hygiene First

Date: 2026-05-07
Status: accepted

Docs-only architecture clarification may continue immediately. Runtime refactor touching `main.mjs`, chat pipeline, preload, IPC channels, or conflict-prone frontend files should first perform Stage -1 branch hygiene or explicitly document why it is being deferred.

## D4: Stage -1 Is Analysis First, Merge Execution Is A Separate Approval Gate

Date: 2026-05-07
Status: accepted (Codex + Claude agree)
Source: Q1 (open-questions.md), v2 §A, R3-related proposal

Stage -1은 conflict 분석/카테고리화/보존 결정 문서화 작업이며, `origin/main`을 실제로 merge하는 행위는 별도 사용자 명시 승인 후 수행한다. 본 문서의 D3을 보강하며, "분석 = 자유 진행, 실행 = 사용자 게이트"를 명확히 한다.

## D5: Stage 0.5 Must Define LLM Mock And Supabase Fixture Strategy Before Pipeline Extraction

Date: 2026-05-07
Status: accepted (Codex + Claude agree)
Source: Q2 (open-questions.md), v2 §B, R5 proposal

테스트 인프라 부트스트랩(Stage 0.5)은 다음을 stage 종료 전 결정/문서화한다:

- Desktop `.mjs` ESM Vitest 실행 방식
- Electron import/IPC mock 방식
- LLM/Ollama/VLLM 호출 mock 방식 (mock library 또는 직접 fetch mock)
- Supabase fixture 전략 (local DB / mock adapter / seed SQL)
- `window.redouDesktop` preload contract 검증 방식

위 5개 결정 없이 chat/table pipeline extraction(Stage 2A 이후)으로 진입하지 않는다.

## D6: CONTEXT.md Is A Thin Index, harness/glossary.md Is The Canonical Glossary

Date: 2026-05-07
Status: accepted (Codex + Claude agree, docs-only)
Source: Q3 (open-questions.md), v2 §1.3 reorganized as Section 결정

도메인 용어 진실 원천은 다음과 같이 분리한다:

- `CONTEXT.md`: agent가 처음 읽는 얇은 entrypoint/index. 자체 정의는 최소화하고 canonical 위치를 가리킨다.
- `docs/harness/main/glossary.md`: 자세한 canonical glossary. 모든 용어 정의 권한.
- `docs/harness/decisions/`: ADR 위치. 설계 결정 영구 기록.

`CONTEXT.md`와 `harness/`는 경쟁 진실 원천이 되지 않는다.

## D7: PaperDetailView Split Can Run In Parallel With Backend Refactor

Date: 2026-05-07
Status: accepted (Codex + Claude agree)
Source: Q4 (open-questions.md), v2 §E

`PaperDetailView.tsx`의 leaf tab Module 분리(v2 Stage 2B)는 chat/table backend extraction(Stage 2A)과 병렬 진행이 허용된다. 단:

- 한 PR이 backend + frontend를 동시에 만지지 않는다.
- mechanical / behavior-preserving extraction에 한한다 (UI 재설계 금지).
- 진행 중인 supplementary PDF 신규 기능은 Stage 2B 시작 전에 stable commit으로 마무리한다.

## D8: main.mjs Owns Only Lifecycle, IPC Registration, Client Initialization, And Whitelist Definitions

Date: 2026-05-07
Status: accepted (Codex + Claude agree, R2 strongest reinforcement)
Source: R2 reinforcement, v2 Section 1 deepening

`apps/desktop/electron/main.mjs`는 다음만 보유한다:

- Electron app lifecycle (whenReady, will-quit, activate 등)
- BrowserWindow 생성/관리
- Supabase / Ollama / 외부 client 초기화
- DB whitelist 상수 (`DB_QUERY_TABLES` 등 — 마이그레이션 후 별도 모듈로 이동 검토)
- 모든 IPC 등록 함수 호출 (실제 handler 본문은 `electron/ipc/{domain}-ipc.mjs` 등)

도메인 로직은 `chat/`, `rag/`, `pipeline/`, `ipc/`, 또는 frontend repository 모듈로 이동한다. ADR 0002(예정)에 의사결정 트리를 기록한다. PR 리뷰 시 본 정책 위반 변경은 reject 사유.

## D9: Every Refactor Stage Must Have Measurable Hard Gates And Soft Targets

Date: 2026-05-07
Status: accepted (Codex + Claude agree, principle only)
Source: R1 reinforcement (principle)

Refactor stage 종료를 선언하기 위해서는 측정 가능한 hard gate(통과 필수)와 soft target(다음 cycle 권장 수치)을 함께 정의한다. Hard gate는 stage별 minimum 조건이며, 미달 시 stage 미완으로 분류한다.

Hard/Soft 숫자(예: main.mjs 줄 수 1,500/800, IPC handler 5/3 등)는 본 결정에 포함되지 않는다. **Q5 closure에서 Stage -1 측정 후 사용자 승인을 거쳐 별도 결정으로 추가한다.**

## D10: Runtime Code Changes Pause When The Designated Code-Writing Agent Is Unavailable

Date: 2026-05-07
Status: accepted (Codex + Claude agree, principle only)
Source: R3 reinforcement (principle, Codex의 표현 정정 반영)

지정된 code-writing agent (현 시점에서는 Codex)의 가용성이 회복될 때까지 다음 작업은 보류한다:

- `.mjs`/`.tsx`/`.ts` 등 코드 파일 작성/수정/삭제
- Migration 작성
- Production 코드의 schema 변경

다음 작업은 가용성 영향 없이 계속 가능:

- 문서 작성/수정 (`.md`)
- Plan/제안서 작성
- Decision 기록 (`decisions.md`, `open-questions.md`)
- Architecture review/annotation

대체 도구 (Cursor, 직접 사용자 편집 등) 사용 가능 여부는 본 결정에 포함되지 않는다. Q6 closure에서 사용자가 별도 결정한다.

## D11: Stage 4 Cannot Start Without A Defined supabasePaperRepository Facade Sunset Policy

Date: 2026-05-07
Status: accepted (Codex + Claude agree, principle only)
Source: R4 reinforcement (principle)

`supabasePaperRepository` facade의 sunset 정책 — 시간 기반(예: 6개월), 호출 기반(예: ≥80% 직접 호출 마이그레이션), 또는 이벤트 기반(예: 다음 major refactor cycle) — 중 어느 것을 사용할지 Stage 4 시작 전에 결정해 ADR로 기록한다.

구체적 일정/임계값(예: 3/6/9/12개월 단계별 deprecation)은 본 결정에 포함되지 않는다. **Q7 closure에서 Stage 4 계획 시 facade 호출 측정 후 사용자가 별도 결정한다.**

## D12: Every Async Pipeline Extracted From main.mjs Must Define Abort Behavior

Date: 2026-05-07
Status: accepted (Codex + Claude agree)
Source: R5 reinforcement (with Codex's source-evidence correction)

`main.mjs`에서 추출되는 모든 async pipeline 모듈은 다음 중 하나를 충족한다:

- AbortSignal을 받아 propagate하고 회귀 테스트 1개 이상 작성, 또는
- non-abortable임을 명시적으로 문서화 (이유 + 호출자 책임 명시)

순수 formatter (예: `source-evidence.mjs`가 LLM 호출 없이 string formatting만 수행한다면) 같은 동기 helper는 본 결정 적용 대상이 아니다.

Stage 2A 첫 PR에서 5개 abort 케이스 전부 의무화 여부는 본 결정에 포함되지 않는다. **Q8 closure에서 사용자가 별도 결정한다.**

## D13: LLM Mock Strategy Is Two-Track By Test Runtime

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Q12 (`open-questions.md`), Claude Stage 2A Tracer 3 work composition

Stage 2A and later LLM/RAG tests should choose the mock approach by runtime:

- Frontend Vitest tests use `vi.mock` plus direct fetch stubs by default.
- Desktop Node test-runner tests use dependency injection through public module parameters, such as `runTableConversationPipeline({...})`, instead of Vitest-only module mocking.

This keeps desktop `.mjs` tests compatible with Node's built-in test runner and avoids adding a new mocking dependency before the pipeline seam proves it needs one.

## D14: Keep `shellOnly` Marker Until Tracer 3c Removes The Legacy Fallback

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3a review

`runTableConversationPipeline({...})` may return `shellOnly: true` while Stage 2A is partially extracted. This marker is allowed only as a temporary guard while `main.mjs` still owns the remaining legacy table branch body.

Remove `shellOnly` and any fallback branch by the end of Tracer 3c, when Stage 3d, persistence, Guardian verification, and the handler contraction are complete.

## D15: Split Tracer 3b Into Setup/Orchestrator, RAG/Metadata, And Extraction/Merge Sub-Steps

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3a review

Stage 2A Tracer 3b should be implemented as smaller reviewable sub-steps:

- 3b-1: setup plus Stage 1 orchestrator and clarify branch.
- 3b-2: Stage 2 RAG plus Stage 2b metadata/backfill.
- 3b-3: Stage 3a, Stage 3b, and Stage 3c parsing/extraction/merge/fallback.

Each sub-step should run `node --check`, desktop tests, and the desktop build before moving to the next sub-step.

## D16: Wire `main.mjs` Through The Shell With A Temporary `shellOnly` Continuation

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3a review

Stage 2A should begin wiring `main.mjs` through `runTableConversationPipeline({...})` during Tracer 3b rather than waiting until the end.

The wiring must avoid duplicate LLM/orchestrator calls. If the shell returns `shellOnly: true`, `main.mjs` should continue from the returned pipeline context instead of recomputing setup or Stage 1. The fallback path is temporary and must be removed with `shellOnly` by the end of Tracer 3c.

## D17: Lock The Clarify Guardrail With A Regression Test

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3b-1 review

The `applyClarifyGuardrail` behavior must have desktop Node regression coverage before or during Tracer 3b-2.

The required behavior is:

- when the orchestrator returns `action: "clarify"` and the conversation history already contains at least three assistant text clarifications, the pipeline promotes the plan to `action: "generate_table"`;
- the fallback search query is derived from the latest user message when the plan has no search queries;
- `keyword_hints` and a minimal fallback `table_spec` are initialized when absent;
- no clarification assistant message is persisted in that promoted path.

## D18: Table RAG Folder Scope Filtering Is Pipeline-Owned

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3b-1 review

Stage 2 table RAG scope filtering belongs inside `chat/table-pipeline.mjs` once Stage 2 moves out of `main.mjs`.

`main.mjs` should pass caller-owned values and helper dependencies explicitly:

- `ownerPaperIds`
- `scopeFolderId`
- `scopeAll`
- `getPaperIdsInFolderTreeFn`
- `intersectPaperIdsFn`

The pipeline should derive `filterPaperIds` internally and pass that filtered list into `runMultiQueryRagFn(...)`.

## D19: Keep Pure Stage 3 Helpers In `main.mjs` Temporarily And Pass Them By Dependency Injection

Date: 2026-05-10
Status: accepted with Codex safety correction
Source: Claude Tracer 3b-2 review (P8), corrected to avoid circular imports

During Stage 2A Tracer 3b-3, pure helpers such as `mergeExtractionResults`, `assembleRagContext`, and related Stage 3 helper functions may remain in `main.mjs` temporarily.

Because `main.mjs` already imports `chat/table-pipeline.mjs`, `chat/table-pipeline.mjs` must not import from `main.mjs`; that would create a fragile circular dependency. Instead, `main.mjs` should pass these helpers explicitly as dependency-injected function parameters while Stage 2A is still in progress.

Stage 3 of the architecture plan should later extract those pure helpers into a dedicated module, such as `chat/extraction-helpers.mjs`, and replace the temporary injection with normal imports from that module.

## D20: Avoid PowerShell Text Rewrites For Files With Korean Literals

Date: 2026-05-10
Status: accepted (Codex + Claude agree)
Source: Claude Tracer 3c-1 review and Codex Tracer 3c-1 recovery incident

Files containing Korean user-facing literals should not be rewritten with broad PowerShell text-processing patterns.

For these files, prefer:

- restore from a known UTF-8 source when recovery is needed;
- make surgical edits with `apply_patch`;
- avoid large script-based rewrites unless encoding handling is explicitly verified;
- run `node --check`, relevant tests, and a focused string sanity check when Korean literals may have been touched.

This guardrail was added after a temporary PowerShell rewrite corrupted Korean literals in `apps/desktop/electron/main.mjs` during Tracer 3c-1. The file was restored from the UTF-8 HEAD source and the intended code changes were reapplied surgically.

## D21: Stage 2A KPI Gates Use Measured Closure Numbers

Date: 2026-05-11
Status: accepted (user approved default closure after Claude review)
Source: Q5 (`open-questions.md`), Stage 2A Tracer 3c-3 closure

Use measured, stage-specific gates for Stage 2A instead of enforcing the early R1 proposal as written.

Stage 2A is closed with these hard gates:

- `apps/desktop/electron/main.mjs` line count is `<= 3600` at closure; measured value: 3569.
- `shellOnly` is absent from `main.mjs` and `chat/table-pipeline.mjs`; measured value: 0.
- table orchestration is owned by `apps/desktop/electron/chat/table-pipeline.mjs`.
- `main.mjs` returns the table pipeline result directly for table conversations.
- desktop Node tests pass; closure measurement: 2 suites, 21 tests.
- desktop build passes.

Stage 2A soft targets:

- further reduce `main.mjs` during Plan 12 Stage 3 helper extraction;
- treat the earlier `main.mjs <= 2500` proposal as a later architecture-cycle target, not a retroactive blocker for Stage 2A closure.

The next KPI review should happen after Stage 3 helper extraction and again after Stage 4/5 repository and processing extraction.

## D22: Runtime Code Fallback Requires Explicit User Approval

Date: 2026-05-11
Status: accepted (user approved default closure)
Source: Q6 (`open-questions.md`)

When the designated code-writing agent is unavailable:

- docs, planning, review, and decision recording may continue;
- runtime code changes pause;
- migration/schema changes pause;
- a fallback code-writing path requires explicit user approval before edits start.

This keeps D10 strict while still allowing the Codex-Claude planning files to move forward.

## D23: Measure Repository Facade Call Sites Before Sunset Timeline

Date: 2026-05-11
Status: accepted (user approved default closure)
Source: Q7 (`open-questions.md`)

Do not choose a fixed `supabasePaperRepository` facade sunset timeline now.

Stage 4 must first measure:

- facade call-site count;
- direct repository implementation call-site count;
- domains still relying on the facade;
- query-hook compatibility risks.

Stage 4 may split implementation modules while keeping the existing facade export stable. The exact sunset policy must be proposed after measurement and before any facade removal.

## D24: Abort Matrix Expands Incrementally Per Async Pipeline

Date: 2026-05-11
Status: accepted (user approved default closure)
Source: Q8 (`open-questions.md`), Stage 2A abort regression results

Stage 2A did not require the full five-case abort matrix before the first tracer could close.

The accepted policy is:

- every async pipeline extracted from `main.mjs` must define abort behavior;
- every async pipeline extraction should add at least one targeted abort regression or document why the path is non-abortable;
- broaden the abort matrix as the module stabilizes;
- abort before final table persistence must not persist an assistant table message or generated table.

Stage 2A now has multiple table-pipeline abort regressions, including abort before persistence and abort after Stage 3d recovery before persistence.

## D25: Stage 3 Helper Extraction Follows Stage 2A And Updates Existing Callers

Date: 2026-05-11
Status: accepted (user approved default closure)
Source: Q10 (`open-questions.md`), D15, D16, D19

Stage 3 helper extraction happens after Stage 2A.

The next helper extraction should:

- extract source evidence formatting first;
- update both `main.mjs` and `chat/table-pipeline.mjs` to import the extracted formatter;
- avoid duplicate source evidence formatter logic;
- then extract Stage 3d and related table extraction helpers into focused modules;
- preserve Stage 3d metadata and abort behavior.

The temporary dependency-injection pattern from D19 remains acceptable only until these helpers have a stable module home.

## D26: Confirm Collision-Risk Slices Before Runtime Edits

Date: 2026-05-15
Status: accepted (user approved proceeding after Claude folders review)
Source: Claude Stage 4 paperSignals and folders reviews; Codex process correction after supplementary-status ambiguity

Before starting a runtime slice that may collide with active or planned supplementary/import work, Codex must explicitly confirm:

- the exact option or implementation scope the user is approving;
- whether supplementary/import work is stable, actively in progress, or intentionally paused;
- which multi-step workflows stay in the facade for the current slice;
- which workflows are out of scope.

This applies especially to the next Paper CRUD split because `createImportedPaper`, `attachSupplementaryPdfToPaper`, `deletePaper`, source-file rows, folder assignment, and processing jobs can overlap if the slice is too broad.

Ambiguous approval such as "proceed" is enough for docs/planning/decision recording, but not enough to start a collision-risk runtime code slice unless the scope has already been stated and confirmed.

## D27: Cross-Domain Join Helpers Live With The Owner Domain

Date: 2026-05-15
Status: accepted (user approved proceeding after Claude folders review)
Source: Claude Stage 4 folders split review

For cross-domain join tables, place helper ownership with the domain that owns the relationship, while dependent domains keep references only.

Applied Stage 4 example:

- `paper_folders` helpers live in `frontend/src/lib/paperRepository/folders.ts` because folder membership is folder-domain ownership.
- `paper` keeps folder references as metadata and workflow inputs.
- Multi-step workflows that combine helper updates with a full `Paper` reload can remain in `supabasePaperRepository` while the facade exists.

Do not create a separate join-table module such as `assignments.ts` unless the relationship behavior grows large enough to justify its own domain boundary.

## D28: First Paper CRUD Split Extracts Low-Level Paper Row Helpers Only

Date: 2026-05-15
Status: accepted (user approved Q15 as A + default)
Source: Q15 (`open-questions.md`), Claude Stage 4 folders review

The first Paper CRUD runtime slice may proceed with supplementary/import treated as stable enough for the narrow default scope.

For this slice:

- extract low-level paper row reads and paper list raw fetches;
- extract single-paper lookup support used by `getPaperById`;
- extract low-level imported-paper row insertion;
- extract the `toggle_paper_star` RPC wrapper;
- keep `createImportedPaper` as a facade workflow;
- keep `attachSupplementaryPdfToPaper` as a facade workflow;
- keep `deletePaper` as a facade workflow, including disk cleanup and hard delete sequencing.

This preserves current supplementary/import behavior while reducing `supabasePaperRepository` ownership. Moving import, supplementary, or delete workflows requires a later explicit confirmation under D26.

## D29: Repository Facade Sunset Requires A Query Adapter Step

Date: 2026-05-15
Status: accepted (measurement slice completed)
Source: ADR 0005 measurement update; Claude Paper CRUD helper split review

After the Stage 4 mapper, highlights, notes, source-files, paperSignals, folders, and first papers helper splits, production query hooks still import the repository facade from exactly one place: `frontend/src/lib/queries.ts`.

Measured state:

- `supabasePaperRepository.ts`: 673 lines.
- Focused paper repository implementation modules: 1292 non-test lines.
- External facade import count: 1 production import.
- Direct focused-module production imports outside the facade: 0.
- `paperRepository.*` calls inside `queries.ts`: 38 occurrences, 37 unique method names.
- Frontend targeted repository/search coverage: 7 suites / 26 tests.

Decision:

Do not remove `supabasePaperRepository` immediately.

The facade still owns useful app-model and workflow composition:

- paper app-model reads compose paper rows with paper signals and sometimes folder scope;
- mutations that need `currentUserId` still rely on the facade-owned auth helper;
- import, supplementary, delete, and move workflows still coordinate multiple domains;
- extraction/search/reference read helpers have not all been split into focused modules yet.

The next code-changing migration, if approved, should be a small query-adapter tracer rather than a broad facade removal. Good candidates are read-only hooks with no facade workflow dependency, such as primary file, supplementary files, notes read queries, highlights-by-paper, or folders read queries.

Import, supplementary, delete, app-model-composition, and user-scoped mutation hooks require either a separate adapter design or another D26 confirmation before moving.

## D30: Stage 4 Mocked Unit Tests Close The Q13 Stop-Gap

Date: 2026-05-15
Status: accepted (Stage 4 closure)
Source: Q13 (`open-questions.md`); Claude Stage 4 measurement closure review

Stage 4 closes the Q13 stop-gap with the current mocked frontend unit-test strategy.

For the repository split cycle, Vitest `vi.mock` plus builder-style Supabase stubs were sufficient because the work moved persistence helpers behind the existing facade while preserving public query-hook behavior. The accepted evidence is:

- seven frontend repository/search suites;
- twenty-six targeted frontend tests;
- no production focused-module imports outside the facade;
- no runtime query-hook migration during Stage 4.

Do not introduce real Supabase fixture isolation merely to finish Stage 4.

Real fixture isolation should be reopened as a separate series when one of these triggers appears:

- a DB-heavy regression needs to validate real Supabase behavior;
- multi-paper auth/RLS behavior must be verified;
- an integration workflow such as `createImportedPaper` needs end-to-end database coverage;
- Stage 5 import/processing or another reliability-focused series needs fixture-backed tests.

Until then, focused mocked-unit coverage remains acceptable for small repository helper splits, while runtime workflows that cross import, supplementary, delete, auth, or RLS boundaries still require explicit planning before changing test strategy.

## D31: RAG Extraction Closes Q14 Abort Propagation

Date: 2026-05-17
Status: accepted (RAG infrastructure slice completed)
Source: Q14 and Q16 (`open-questions.md`); Claude Q16 review; RAG module extraction

The RAG infrastructure slice closes the deferred Q14 abort propagation decision.

`runMultiQueryRag` now lives in `apps/desktop/electron/rag/multi-query-rag.mjs` and accepts an optional `abortSignal` through its call options. It checks abort state:

- before starting query work;
- after query embedding generation;
- after Supabase RPC results resolve;
- before and after reranker availability/re-ranking work.

`runPaperScopedRecoverySearch` moved with the RAG module because it is a small paper-filtered wrapper over `runMultiQueryRag` and is used by Stage 3d recovery.

The first RAG slice intentionally does not move reranker worker internals. `reranker-worker.mjs` remains the reranker implementation boundary while the RAG module only calls it.

Accepted verification:

- `apps/desktop/electron/rag/multi-query-rag.mjs`: `node --check` passes.
- `apps/desktop/electron/main.mjs`: `node --check` passes.
- `apps/desktop/electron/chat/table-pipeline.mjs`: `node --check` passes.
- `apps/desktop`: `cmd /c node --test tests\multi-query-rag.test.mjs` passes: 1 suite / 5 tests.
- `apps/desktop`: `cmd /c npm run test` passes: 7 suites / 43 tests.
- `apps/desktop`: `cmd /c npm run build` passes.
- `git diff --check` passes with LF-to-CRLF warnings only.

## D33: Plan 12 Boundary Returns To V2 Scope

Date: 2026-05-20
Status: accepted (user-approved Option A-light)
Source: Claude strategic scope review; Codex scope-boundary response; user approval

Plan 12 uses the original v2 plan stages as its boundary again.

The RAG infrastructure extraction was an accepted out-of-plan exception because it closed Q14 abort propagation and was approved through Q16. It does not expand Plan 12 into an open-ended sequence of every possible extraction.

Plan 12 next work:

- complete or explicitly defer Stage 2B, the `PaperDetailView.tsx` mechanical split;
- after Stage 2B, ask the user whether Stage 5 import/processing extraction is still worth the runtime risk;
- stop Plan 12 after Stage 5 if Stage 5 proceeds.

Out of Plan 12:

- QA branch extraction;
- primary-file query adapter work;
- additional domain splits not named by the v2 plan.

Review protocol for remaining Plan 12 slices should be lightweight by default: blockers/P1/P2, D9 measurements, concrete risks, and go/stop. Longer cross-agent review is reserved for real design decisions or safety risk.

## D34: mattpocock Skill Role Split — Claude Plans/Analyzes/Reviews, Codex Writes Code

Date: 2026-05-21
Status: accepted (user-approved, keep current code-writing model)
Source: Post-Plan 12 roadmap; mattpocock skills installed in `.claude/skills/`; D10/D22

mattpocock 스킬이 `.claude/skills/`에 설치됨. code-writing agent는 **현행 유지 (Codex via codex:rescue).** D10/D22 그대로.

스킬 역할 분담:

- **Claude-side (계획/분석/리뷰 — D10 호환, 코드 안 씀):**
  - `/to-prd` (요구사항 문서화)
  - `/to-issues` (slice 분해)
  - `/grill-with-docs` (요구사항 명료화)
  - `/zoom-out` (컨텍스트)
  - `/improve-codebase-architecture` (설계 분석)
  - `/diagnose` (디버깅 방법론의 분석 단계)
  - `/triage` (우선순위)

- **Codex-side (코드 실행 — D10 mandate):**
  - 실제 test + production 코드 작성
  - Codex 자체 RED→GREEN 규율 (= `/tdd`의 본질, Plan 12 전체에서 검증됨)
  - Claude가 넘긴 slice spec + test intent 기반

- **Claude가 직접 실행하지 않는 code-writing 스킬:** `/tdd`, `/prototype` 등. 그 방법론(red-green)은 slice spec(Claude) + 실행(Codex)으로 분담.

워크플로우:
```
Claude: /to-issues 로 slice 분해 (test intent + assertion + 완료 기준)
   ↓ codex-claude file exchange
Codex: RED→GREEN 구현
   ↓
Claude: 경량 리뷰 (blocker/D9/risk/go-stop)
```

code-writing agent 변경 (Claude가 테스트 직접 작성)은 본 결정 범위 밖이며 별도 사용자 승인 필요.
