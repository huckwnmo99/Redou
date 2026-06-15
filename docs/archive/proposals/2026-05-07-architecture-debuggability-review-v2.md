# Redou Architecture And Debuggability Review V2

Status: proposal v2
Date: 2026-05-07
Owners: Codex + Claude file-exchange workflow
Supersedes for execution: `docs/features/proposals/2026-05-07-architecture-debuggability-review.md`

## 목적

이 문서는 Redou 구조/디버깅 리뷰 v1과 Claude annotation을 합쳐, 실제 실행 가능한 v2 계획으로 정리한다.

v1의 큰 진단은 유지한다. 다만 v1은 현재 branch 상태, 테스트 인프라 부재, mutable state 추출 위험, PaperDetailView에서 진행 중인 supplementary 작업을 충분히 반영하지 못했다. v2는 그 누락을 보강한다.

## 현재 사실

- 현재 branch: `feature/pipeline-v2-only`
- 현재 branch는 `origin/feature/pipeline-v2-only`보다 4 commits ahead 상태다.
- `HEAD`와 `origin/main`을 `merge-tree`로 비교하면 예상 conflict 파일은 24개다. v1 annotation의 22개는 방향은 맞지만 현재 숫자로는 24개가 더 정확하다.
- conflict 예상 핵심 파일은 `apps/desktop/electron/main.mjs`, `llm-orchestrator.mjs`, `llm-qa.mjs`, `ocr-extraction.mjs`, `preload.mjs`, `ipc-channels.mjs`, `frontend/src/features/chat/ChatPipelineStatus.tsx`, `frontend/src/features/settings/SettingsView.tsx`, `frontend/src/lib/chatQueries.ts`, `frontend/src/types/chat.ts`, `frontend/src/types/desktop.ts`, 그리고 `docs/harness/**` 다수다.
- repo scan 기준으로 `*.test.*`, `*.spec.*`, `*.test.mjs`, `*.spec.mjs` 테스트 파일은 아직 없다.
- `main.mjs`는 계속 커지고 있으며, `origin/main..HEAD` 기준으로 `main.mjs`는 큰 폭의 차이가 있다. 즉 대형 refactor 전에 branch hygiene 판단이 필요하다.

## v1에서 유지하는 진단

### 1. `main.mjs`가 가장 큰 디버깅 병목이다

`apps/desktop/electron/main.mjs`는 Electron lifecycle, IPC, file import, DB proxy, backup, OAuth, extraction processing, embedding processing, RAG, chat, table generation, Stage 3d recovery, CSV export, LLM model setting을 동시에 들고 있다.

이 진단은 합당하다. Redou가 엉망이라는 뜻은 아니고, 너무 많은 runtime responsibility가 한 Module에 모였다는 뜻이다.

### 2. Chat/RAG/Table pipeline은 별도 Module로 깊어져야 한다

현재 `CHAT_SEND_MESSAGE` 흐름은 conversation persistence, orchestrator, RAG, table OCR backfill, per-paper extraction, merge, Stage 3d recovery, generated table persistence, status streaming, abort handling을 한 흐름에서 처리한다.

이 진단도 합당하다. 단, v2에서는 바로 코드를 옮기기 전에 state/order/abort 계약을 먼저 기록한다.

### 3. `PaperDetailView.tsx`와 `supabasePaperRepository.ts`도 커졌다

`frontend/src/features/paper/PaperDetailView.tsx`는 overview, PDF tab, supplementary attach, highlights, notes, figures/tables/equations, references, metadata를 모두 가진다.

`frontend/src/lib/supabasePaperRepository.ts`는 papers, folders, files, supplementary files, chunks, sections, figures, notes, highlights, presets, imports, cleanup을 모두 가진다.

두 진단 모두 맞다. 다만 UI split은 backend refactor와 독립적이므로 너무 뒤로 미룰 필요는 없다.

## Claude annotation 중 채택하는 보강

### A. Stage -1: branch hygiene를 추가한다

코드 refactor 전에 `origin/main`과의 통합 전략을 확인한다.

이유:

- conflict 예상 파일이 24개다.
- `main.mjs`, chat types, preload, IPC channel, harness docs가 모두 conflict 권역이다.
- 이 상태에서 구조 분리를 시작하면 conflict가 늘어날 가능성이 높다.

단, 문서 정리나 glossary 작성은 branch integration 전에 진행 가능하다.

### B. Stage 0.5: 테스트 인프라 부트스트랩을 추가한다

v1의 "테스트 추가"는 너무 추상적이었다. v2에서는 테스트 인프라 자체를 별도 stage로 둔다.

필요한 결정:

- Desktop `.mjs` ESM 테스트를 Vitest로 어떻게 실행할지
- Electron import/IPC를 어떻게 mock할지
- LLM/Ollama/VLLM 호출을 어떻게 mock할지
- Supabase fixture는 local DB, mock adapter, seed SQL 중 무엇을 쓸지
- `window.redouDesktop` preload contract를 어떻게 검증할지

### C. State/order/abort audit를 Stage 1 전에 둔다

`main.mjs`에서 코드를 떼기 전에 다음을 문서화한다.

- pipeline state: `conversationId`, `paperRefMap`, `ragResults`, `abortController`, `tableSpec`, `nullSummary`, `agenticRecovery`
- job ordering: import -> extraction -> embedding -> entity/graph jobs
- abort propagation: orchestrator, RAG, table extraction, Stage 3d recovery, QA answer
- status event contract: `stage`, `message`, `detail`, `conversationId`

그냥 함수만 이동하면 hidden global dependency가 생길 수 있다.

### D. `runMultiQueryRag`는 별도 RAG Module 후보로 둔다

Chat table pipeline, QA pipeline, Stage 3d recovery가 모두 RAG를 사용한다. 따라서 `electron/rag/multi-query-rag.mjs`는 자연스러운 후보 Module이다.

단, 이 분리는 chat extraction 이후에 하거나, chat extraction과 같은 stage 안에서 아주 작게 진행한다.

### E. Paper UI split은 backend refactor와 병렬 가능하다

`PaperDetailView.tsx`는 supplementary work가 계속 붙고 있으므로 너무 오래 기다리면 더 커진다.

권장:

- backend chat/table split과 frontend PaperDetail split은 서로 다른 파일군이므로 병렬 가능하다.
- 다만 한 agent가 둘을 동시에 만지지 않는다.
- UI split은 behavior-preserving mechanical extraction이어야 한다.

## v1에서 조정하는 부분

### 1. "Immediate next slice = Stage 0"은 조건부로 조정한다

문서/glossary만 한다면 Stage 0부터 해도 된다.

하지만 runtime refactor를 시작한다면 Stage -1이 먼저다.

정리:

- 문서 정리: Stage 0 가능
- 코드 refactor: Stage -1 -> Stage 0.5 -> Stage 1 순서

### 2. KPI는 hard gate가 아니라 soft target으로 둔다

예시 target:

- `main.mjs`를 장기적으로 1,500줄 안팎까지 줄인다.
- `main.mjs`의 직접 IPC handler 등록을 10개 안팎으로 줄인다.
- chat/table pipeline 관련 순수 helper는 테스트 가능한 Module로 분리한다.

이 숫자는 방향성이지, 한 PR에서 반드시 달성해야 하는 gate가 아니다.

### 3. `CONTEXT.md`와 `docs/harness`는 경쟁시키지 않는다

권장 구조:

- `CONTEXT.md`: agent가 가장 먼저 읽는 얇은 domain entrypoint
- `docs/harness/main/glossary.md`: 자세한 canonical glossary
- `docs/harness/decisions/`: architecture decision records

즉 `CONTEXT.md`는 사라지지 않고, harness 문서를 가리키는 index 역할을 한다.

## 최종 Stage 순서

### Stage -1: Branch Hygiene And Integration Decision

목표:

- `origin/main`과의 예상 conflict 24개를 기준으로 통합/보류/별도 branch 전략을 결정한다.
- PR #1 entity graph 관련 변경이 architecture refactor 전에 들어와야 하는지 결정한다.

작업:

- `merge-tree` 결과를 문서화한다.
- conflict 파일을 runtime, frontend, docs, migrations로 나눈다.
- 보존해야 할 Redou-side 변경과 origin/main-side 변경을 나눈다.
- 실제 merge 실행 여부는 별도 승인 후 진행한다.

완료 기준:

- refactor가 어느 branch 위에서 진행될지 결정되어 있다.
- conflict 권역 파일을 건드리는 refactor freeze 규칙이 정해져 있다.

### Stage 0: Domain Context And Decision Records

목표:

- agent들이 같은 용어로 Redou를 이해하게 한다.

작업:

- `CONTEXT.md` 생성 또는 정비
- `docs/harness/main/glossary.md` 생성 또는 정비
- `docs/harness/decisions/0001-debuggable-module-split.md` 작성
- Codex-Claude file exchange workflow를 사용해 Claude/Codex 의견을 분리 기록한다.

완료 기준:

- main PDF, supplementary PDF, source file, evidence location, generated table, Stage 3d, source_file_id, source_kind, RAG context, processing job이 정의되어 있다.

### Stage 0.5: Test Infrastructure Bootstrap

목표:

- refactor 전에 최소한의 자동 회귀 감지 표면을 만든다.

작업:

- Desktop `.mjs` pure helper test 방식 결정
- `html-table-parser.mjs` 또는 `searchModel.ts` 첫 characterization test
- Electron preload contract test 후보 정의
- LLM mock 전략 문서화
- Supabase fixture 전략 문서화

완료 기준:

- 하나 이상의 테스트가 실제로 실행된다.
- 다음 refactor stage에서 테스트가 깨지면 의미 있는 신호가 된다.

### Stage 1: Chat/Table Pipeline State Audit

목표:

- code movement 전에 state, ordering, abort, status event contract를 고정한다.

작업:

- `CHAT_SEND_MESSAGE` 흐름을 단계별로 맵핑한다.
- Stage별 입력/출력/side effect를 적는다.
- `emitStatus` event shape를 타입 수준으로 고정할 계획을 만든다.
- fallback paths: per-paper, single-call fallback, no-data, clarify, abort를 분리해 기록한다.

완료 기준:

- 어떤 state가 pipeline context에 들어가고, 어떤 것은 Module-local인지 결정되어 있다.

### Stage 2A: Chat/Table Pipeline Extraction

목표:

- `main.mjs`에서 table chat orchestration을 behavior-preserving 방식으로 분리한다.

후보 Module:

- `apps/desktop/electron/chat/table-pipeline.mjs`
- `apps/desktop/electron/chat/qa-pipeline.mjs`
- `apps/desktop/electron/chat/status-events.mjs`

완료 기준:

- IPC channel name은 유지된다.
- frontend behavior는 바뀌지 않는다.
- per-paper table, single-call fallback, clarify, no-data, abort 흐름이 보존된다.

### Stage 2B: Paper Detail UI Mechanical Split

목표:

- `PaperDetailView.tsx`를 leaf tab Modules로 나눈다.

후보 Module:

- `PaperOverviewTab.tsx`
- `PaperPdfTab.tsx`
- `PaperSupplementaryFilesPanel.tsx`
- `PaperFiguresTab.tsx`
- `PaperReferencesTab.tsx`
- `PaperMetadataTab.tsx`

완료 기준:

- UI behavior와 copy는 유지된다.
- supplementary attach, highlight/note creation, page jump가 유지된다.
- `PaperDetailView`는 coordinator가 된다.

### Stage 3: Source Evidence And Stage 3d Pure Helpers

목표:

- source evidence labeling과 Stage 3d recovery helper를 테스트 가능한 Module로 분리한다.

후보 Module:

- `apps/desktop/electron/chat/source-evidence.mjs`
- `apps/desktop/electron/chat/agentic-null-recovery.mjs`

필수 테스트 후보:

- main PDF evidence label
- supplementary PDF evidence label
- null source_file_id fallback
- high confidence recovery applies
- medium/low confidence recovery does not apply
- abort during recovery fails soft

### Stage 4: Repository Implementation Split

목표:

- `supabasePaperRepository` facade는 유지하되 Implementation을 domain Modules로 나눈다.

후보 Module:

- `paperRepository/papers.ts`
- `paperRepository/source-files.ts`
- `paperRepository/extraction.ts`
- `paperRepository/highlights.ts`
- `paperRepository/notes.ts`
- `paperRepository/folders.ts`
- `paperRepository/mappers.ts`

완료 기준:

- query hooks는 먼저 유지된다.
- facade sunset은 ADR에 기록한다.
- source-file/supplementary rules는 `source-files.ts`에 모인다.

### Stage 5: Import/Processing Pipeline Extraction

목표:

- import/extraction/embedding job processing을 `main.mjs`에서 분리한다.

이 stage를 뒤로 둔 이유:

- job ordering이 fragile하다.
- source_file_id persistence와 embedding queue가 연결되어 있다.
- chat split보다 더 runtime-sensitive하다.

후보 Module:

- `apps/desktop/electron/pipeline/import-processing.mjs`
- `apps/desktop/electron/pipeline/embedding-processing.mjs`
- `apps/desktop/electron/pipeline/job-coordinator.mjs`

완료 기준:

- main PDF와 supplementary PDF import/extraction이 둘 다 유지된다.
- `paper_sections`, `paper_chunks`, `figures`, `processing_jobs`의 `source_file_id` behavior가 유지된다.

## Refactor Freeze Rule

각 refactor stage 동안 같은 conflict 권역 파일에 새 기능을 동시에 넣지 않는다.

예:

- Stage 2A 동안 `main.mjs`, `llm-orchestrator.mjs`, `llm-qa.mjs`, `types/ipc-channels.mjs`에 unrelated feature를 넣지 않는다.
- Stage 2B 동안 `PaperDetailView.tsx`에 new UI feature를 넣지 않는다.
- 긴급 fix는 별도 branch 또는 별도 작은 patch로 먼저 처리한다.

## Rollback Rule

각 stage는 한 commit 또는 소수의 작은 commits로 닫는다.

Rollback 기준:

- build가 깨지고 당일 내 복구가 어렵다.
- runtime walkthrough에서 기존 import/chat/PDF reader behavior가 깨진다.
- test infra가 의미 없는 mock만 검증하고 실제 regression을 잡지 못한다.

Rollback 방식:

- behavior-preserving extraction commit만 되돌릴 수 있게 유지한다.
- docs-only stage는 되돌리지 않고 수정 ADR로 supersede한다.

## Codex-Claude Collaboration

이 workstream은 `docs/agents/codex-claude/` file exchange protocol을 사용한다.

규칙:

- Codex는 구현/정리 결과와 Claude에게 검토받을 질문을 `codex-to-claude.md`에 남긴다.
- Claude는 review, critique, orchestration decision을 `claude-to-codex.md`에 남긴다.
- 확정 결정은 `decisions.md`에만 승격한다.
- 미해결 질문은 `open-questions.md`에 남긴다.
- architecture v2 문서는 `decisions.md`에 승격된 내용만 반영한다.

## Immediate Next Slice

권장 next slice는 둘로 나뉜다.

문서-only로 계속 간다면:

1. `CONTEXT.md` entrypoint 작성
2. `docs/harness/main/glossary.md` 작성
3. `docs/harness/decisions/0001-debuggable-module-split.md` 작성

코드 refactor로 들어간다면:

1. Stage -1 branch hygiene 문서 작성
2. Stage 0.5 test infra bootstrap plan 작성
3. 첫 pure helper test를 추가한 뒤 Stage 1 audit로 이동

## 결론

Redou의 핵심 문제는 구조가 무너진 것이 아니라, 기능 성장 속도에 비해 몇몇 Module의 Interface가 너무 넓어진 것이다.

v2의 실행 원칙은 단순하다:

1. branch 상태를 먼저 인정한다.
2. 테스트 인프라를 먼저 만든다.
3. state/order/abort 계약을 먼저 적는다.
4. 그 다음 behavior-preserving extraction만 작게 진행한다.
5. Codex와 Claude 의견은 파일 exchange로 분리하고, 확정된 결정만 실행 문서에 반영한다.
