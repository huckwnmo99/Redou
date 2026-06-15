# Redou 통합 전략 제안서 — feature/pipeline-v2-only ↔ origin/main

> 유형: strategy proposal | 작성일: 2026-04-28 | 작성자: planner
> 대상 의사결정자: 사용자 (huckwnmo99)
> 본 문서는 **실행 계획서가 아닙니다.** 큰 방향을 정하기 위한 옵션·트레이드오프 정리이며, 결정 후 별도 `/plan` → `/develop` or `/fix` 워크플로우로 진행합니다.

---

## 1. 현황 정리

### 1.1 두 브랜치의 분기 지점

`feature/pipeline-v2-only`(이하 **feat**)와 `origin/main`(이하 **main**)은 `f8dec9c`("Add OCR pipeline v2, ...")에서 갈라졌고, 그 이후 **양쪽이 독립적으로 진화**했다.

```
                      ┌── 6cefcc5 (feat: V2 단일화, -780줄)
                      │   73e9d7e (chore: skills + assets)
                      │   ef369db (fix: grobid xml:id)
                      │   e79b040 (chore: message_type 로드)
                      │   eefa1d2 (fix: 캡션 전달)
                      │   70ccfcd (feat #09: Agentic NULL Recovery, +800줄) ← feat HEAD
        ┌─────────────┤
1b0c891 ┤ (이전 공통 base)
        └─────────────┐
                      │   eb95224 (entity-graph, V1 brachable)
                      │   3799fd2 (PR #1 squash) ← origin/main HEAD
                      └──
```

- **feat 브랜치 6 commit, 미push 전부**: 73e9d7e만 push되어 있음.
- **main 브랜치 1 commit, 이미 push됨**: PR #1 squash가 origin/main에 반영되어 있음.

### 1.2 양쪽이 건드린 영역 비교

| 영역 | feat 브랜치 | origin/main (PR #1) |
|------|-------------|---------------------|
| **PDF 파이프라인** | V2 단일화, V1 휴리스틱 폴백 -780줄 (main.mjs / ocr-extraction.mjs / pdf-heuristics.mjs) | 무영향 |
| **엔티티 그래프** | 무영향 | 신규 추가 (entity-extractor.mjs / graph-search.mjs / entity_graph 마이그레이션 / Settings UI) |
| **Q&A 파이프라인** | 무영향 | `runMultiQueryRag` → `runGraphEnhancedRag` 교체 (main.mjs 일부) |
| **SRAG Agentic NULL Recovery** | 신규 추가 (Stage 3d, llm-orchestrator.mjs, frontend) | 무영향 |
| **GROBID** | xml:id off-by-one fix | 무영향 |
| **chat history** | message_type 로드 | 무영향 |
| **에이전트 스킬·문서·자산** | `.agents/skills/`, presentation_assets, AGENTS/CLAUDE 갱신 | 무영향 |
| **하네스** | v1.2 → V2-only로 일부 갱신, feat #09 미반영 | v1.2 → v1.3 → v1.4 (entity graph 두 번 갱신) |
| **Settings UI** | 무영향 | LLM 모델 선택 + 엔티티 모델 선택 추가 (140줄) |
| **chatQueries.ts** | 무영향 | 엔티티 백필 큐리 +72줄 |
| **IPC 채널** | preload +11줄, ipc-channels +5줄 (V2 관련) | preload +11줄, ipc-channels +5줄 (entity 관련) |

**핵심 통찰**: 두 브랜치가 다룬 **기능은 거의 직교**한다 (PDF V2 vs 엔티티 그래프 vs Agentic NULL). 실제 의미적 충돌은 적고, 충돌 22건 대부분은 **같은 파일을 다른 부분에서 수정**한 textual 충돌과 **하네스 add/add 의미적 정합성** 문제다.

### 1.3 실측 충돌 파일 (22개, `git merge-tree` 검증)

**코드 (8개)** — 둘 다 수정한 파일:
- `apps/desktop/electron/main.mjs` — V2 단일화로 -780줄 vs entity graph +369줄 + feat #09 +377줄. 큰 파일이라 영역만 다르면 자동 병합 가능성 있으나, 위치 겹침 가능.
- `apps/desktop/electron/llm-orchestrator.mjs` — feat #09 +102줄 vs PR #1 거의 무영향. **사실상 단방향**일 가능성.
- `apps/desktop/electron/ocr-extraction.mjs` — feat의 -780줄 dead code 제거 vs PR #1 무영향. **사실상 단방향**.
- `apps/desktop/electron/preload.mjs` — 양쪽이 다른 IPC 채널 추가.
- `apps/desktop/electron/types/ipc-channels.mjs` — 양쪽이 다른 채널 상수 추가.
- `frontend/src/features/chat/ChatPipelineStatus.tsx` — feat #09 stages 추가 vs PR #1 무영향.
- `frontend/src/features/settings/SettingsView.tsx` — feat 무영향 vs PR #1 +140줄.
- `frontend/src/lib/chatQueries.ts` — feat 무영향 vs PR #1 +72줄.
- `frontend/src/types/desktop.ts` — 양쪽이 다른 타입 추가.

**하네스 (13개)** — 양쪽이 v1.2 이후 다른 이유로 add/add:
- `docs/harness/VERSION.md` — feat 미갱신(v1.2 그대로) vs main v1.3+v1.4 추가.
- `docs/harness/main/feature-status.md`, `flows.md`, `overview.md` — 양쪽이 다른 항목 추가.
- `docs/harness/detail/electron/main-process.md`, `llm.md`, `pdf-pipeline.md`, `rag-pipeline.md` — 양쪽이 다른 섹션 갱신.
- `docs/harness/detail/database/rpc.md`, `schema.md` — feat 무영향 vs main entity 테이블 추가.
- `docs/harness/detail/frontend/stores-queries.md` — feat 무영향 vs main chatQueries 갱신.
- `docs/harness/detail/services/external.md` — feat V2-only로 갱신 vs main 일부 갱신.

**문서·설정 (1개)** — `CLAUDE.md` — feat 갱신 (skill 패스 변경 등) vs main 무영향.

**단방향 추가만 있는 파일 (충돌 없음)**:
- `.agents/skills/...` 23개, `docs/presentation_assets/...` 21개 — feat 단방향 add.
- `supabase/migrations/20260423010000_add_entity_graph.sql` — main 단방향 add.

### 1.4 검증·정합성 부채

본 통합 작업에 진입하기 전에 인지해야 할 부채:

| 부채 ID | 내용 | 출처 | 심각도 |
|---------|------|------|--------|
| **D-1** | feat #09 (70ccfcd) 코드만 들어가고 실제 동작 검증 없음 (Stage 3d 게이트 발화·30s timeout·gracfeul abort 미검증) | 사용자 보고 | High |
| **D-2** | feat 브랜치 VERSION.md에 v1.5 (feat #09) 엔트리 누락 | 사용자 보고, 직접 확인됨 | Medium |
| **D-3** | feat 브랜치 VERSION.md에 v1.3 (V2-only) 엔트리도 누락. v1.2 그대로 | planner 추가 발견 | Medium |
| **D-4** | feat 브랜치 flows.md에 Stage 3d "researching" 단계 미반영 | 사용자 보고, 직접 확인됨 (`grep researching = 0건`) | Medium |
| **D-5** | e79b040의 message_type을 history에 실어 LLM에 전달하기 시작했으나, llm-chat/llm-qa/llm-orchestrator가 그 값을 어떻게 활용하는지 미문서화 | 사용자 보고 | Low (소비처는 frontend만 명확) |
| **F-1** | PR #1 follow-up [P1]: `graph-search.mjs:35,51` 폴더 스코프 누수 | PR #1 본문 | High (정확도 영향) |
| **F-2** | PR #1 follow-up [P2]: `main.mjs:1892` 임베딩 후 entity 잡 중복 큐잉 | PR #1 본문 | Medium |
| **F-3** | PR #1 follow-up [P2]: `main.mjs:2046` empty-context version bump 영구 stuck + stale 엔티티 미삭제 | PR #1 본문 | Medium |
| **F-4** | PR #1 follow-up [P2]: graph chunk 비결정적 순서 (`.in()` 후 order 미지정) | PR #1 본문 | Medium |
| **F-5** | PR #1 follow-up [P2]: relation upsert 실패 silently swallow (`entity-extractor.mjs:548-550`) | PR #1 본문 | Medium |
| **F-6** | PR #1 follow-up [P3]: entity 모델 inheritance UI 복구 불가 (`SettingsView.tsx:344`) | PR #1 본문 | Low (UX) |

→ **D-** 부채는 통합 작업 자체의 품질에 직결. **F-** 부채는 PR #1 머지 후 별도 처리 약속분.

---

## 2. 의사결정 질문 6개

사용자가 결정해야 할 큰 그림은 다음 6개로 압축된다.

### Q1. 통합 방향
- (a) feat → main: feat을 main에 merge (forward integration)
- (b) main → feat: main을 feat에 merge한 뒤 PR을 올림 (back-merge first, then PR)
- (c) cherry-pick: 일부 commit만 main에 cherry-pick

### Q2. 충돌 해결 순서
- (a) 코드 먼저 → 하네스 나중
- (b) 하네스 먼저 → 코드 나중
- (c) 동시 (의미 단위로 묶어서)

### Q3. feat #09 검증 부족(D-1) 처리
- (a) 통합 전 검증 (안전 우선)
- (b) 통합 후 검증 (속도 우선)
- (c) 통합 작업 중 검증 (병행)

### Q4. PR #1 follow-up 6건 처리
- (a) 통합 작업과 함께 처리
- (b) 별도 fix 시리즈로 분리
- (c) 우선순위(P1/P2/P3)별로 다르게 처리

### Q5. 하네스 정합성 부채(D-2~D-5) 처리
- (a) 별도 fix로 분리 (워크플로우 엄격 준수)
- (b) 통합 작업에 묶음 (실용적)

### Q6. PR 분할 vs 단일 PR
- (a) 단일 PR (feat 6 commit + 통합 commit = 1 PR)
- (b) 의미 단위로 2~3개 PR

---

## 3. 옵션 비교

3개 옵션을 제시한다. 각 옵션은 위 6개 질문에 대한 **일관된 조합**이다.

### 옵션 A — 통합 우선, 병합 후 follow-up (속도 중심)

> Q1=a / Q2=c / Q3=b / Q4=b / Q5=b / Q6=a

**개요**: feat → main으로 한 번에 merge하고 단일 PR을 올린다. 충돌은 의미 단위로 묶어 동시 해결, 검증과 follow-up은 머지 후 별도 fix로.

**작업 흐름**:
1. feat 브랜치에서 `git merge origin/main` (또는 새 통합 브랜치)
2. 22개 충돌을 의미 단위로 해결 (코드 + 하네스 함께)
3. 빌드 성공 확인 (`tsc --noEmit`, `node --check`)
4. **검증 없이** 단일 PR 생성 (커밋 메시지에 "검증은 후속 fix로" 명시)
5. 머지 후:
   - fix-A: feat #09 동작 검증 + 발견 이슈 수정
   - fix-B: PR #1 follow-up [P1] (high)
   - fix-C: [P2~P3] 묶음
   - fix-D: 하네스 정합성 D-2~D-5

**장점**:
- 통합 자체는 **빠르게** 완료 (예상 1~2 세션).
- 두 브랜치가 평행 진화하는 상태를 빨리 종결.
- 후속 fix는 작은 단위라 `/fix` 워크플로우로 쉽게 처리.

**단점**:
- 미검증 코드(feat #09)가 main에 들어감. 사용자가 main을 베이스로 다른 작업을 시작하면 잠재 버그 노출 위험.
- 단일 PR이 큰 diff (수정 22파일 + 신규 44파일)라 리뷰 부담.
- D-2~D-5 하네스 부채를 통합 commit에 함께 넣으면 "통합 의도"와 "하네스 보강 의도"가 섞여 추적성 저하.

**예상 소요**: 통합 4~6h (충돌 해결 + 빌드 + 1차 PR), 후속 fix 4건 합계 6~10h.

---

### 옵션 B — 부채 청산 후 통합 (안전 중심)

> Q1=a / Q2=b / Q3=a / Q4=c / Q5=a / Q6=b

**개요**: 통합 전에 feat 브랜치에서 D-1~D-5 부채를 먼저 청산하고, P1 follow-up도 통합 전에 main에 별도 fix로 머지한다. 그런 다음 정돈된 두 브랜치를 통합.

**작업 흐름**:
1. **사전 작업** (feat 브랜치에서):
   - fix: feat #09 검증 + 발견 이슈 수정 (D-1)
   - chore: 하네스 정합성 보강 (D-2~D-5) — VERSION.md v1.3/v1.5 엔트리, flows.md researching 단계, message_type 소비처 문서화
2. **사전 작업** (main 브랜치에서):
   - fix: PR #1 follow-up [P1] 폴더 스코프 누수 (별도 PR, 머지)
3. **통합**:
   - 정돈된 feat → main merge
   - 충돌은 하네스 먼저 → 코드 나중 (작은 충돌부터 큰 충돌로)
   - 통합 PR 생성 (이때는 깨끗한 diff)
4. **사후 작업**: P2~P3 follow-up은 머지 후 묶음 fix.

**장점**:
- 통합 시점에 두 브랜치 모두 **이미 검증되고 정합한 상태**라 충돌 해결이 명확.
- main이 항상 양호한 상태 유지 (미검증 코드 유입 없음).
- PR 분할이 의미 단위와 일치 (사전 fix 2~3건 + 통합 PR + 사후 fix 1건).

**단점**:
- 작업 단계가 **많아짐**. PR 4~5개를 순차적으로 처리해야 함.
- D-1 검증(feat #09 Stage 3d 동작 확인)이 가장 큰 시간 변수 — 30초 timeout, gate 발화 모두 수동 시나리오 필요.
- main이 "fix 머지"로 계속 움직이면 feat과 또 vergence 가능성.

**예상 소요**: 사전 fix 6~10h, 통합 3~5h, 사후 fix 4~6h. **총 13~21h** (옵션 A 대비 길지만 안전).

---

### 옵션 C — 분할 통합 (cherry-pick 점진 통합)

> Q1=c / Q2=c / Q3=a / Q4=c / Q5=b / Q6=b

**개요**: feat의 6 commit을 의미별로 쪼개서 cherry-pick으로 main에 단계적 통합. 각 단계가 독립 PR.

**커밋 그룹화**:
- **Group 1 (저위험, 단방향에 가까움)**: 73e9d7e(skills+assets), ef369db(grobid xml:id), e79b040(message_type)
- **Group 2 (V2 단일화)**: 6cefcc5 — 큰 변경이지만 entity-graph와 영역 직교
- **Group 3 (Agentic NULL)**: eefa1d2 + 70ccfcd — feat #09 본체. **검증 필수**.

**작업 흐름**:
1. Group 1 cherry-pick → 충돌 미미 → PR 1 → 머지
2. Group 2 cherry-pick → main.mjs/ocr-extraction.mjs 충돌 해결 → 빌드 확인 → PR 2 → 머지
3. **feat #09 동작 검증** (D-1) → 검증 통과 후
4. Group 3 cherry-pick → llm-orchestrator/frontend 충돌 해결 + 하네스 보강(D-2/D-4) → PR 3 → 머지
5. PR #1 follow-up은 별도 fix 시리즈 (옵션 A와 동일)

**장점**:
- **각 PR이 작고 의미가 명확** — 리뷰·롤백 쉬움.
- 위험도 순으로 진행 (저위험 → 검증 후 고위험).
- PR 단위로 검증·롤백 가능.

**단점**:
- cherry-pick 과정에서 **컨텍스트 누락 위험** — 예컨대 feat #09가 V2-only 코드의 새 함수 시그니처에 의존하면 Group 2 없이 cherry-pick 불가.
- 실제로 그런 의존성이 있는지 사전 감사 필요 (현재 시점 미검증).
- 작업 횟수 증가 (PR 3+ 회).

**예상 소요**: 사전 의존성 감사 2~3h, Group 1 PR 1~2h, Group 2 PR 3~5h, 검증 4~6h, Group 3 PR 3~5h. **총 13~21h** (옵션 B와 비슷).

---

### 옵션 비교 표

| 항목 | 옵션 A (속도) | 옵션 B (안전) | 옵션 C (분할) |
|------|--------------|--------------|--------------|
| 통합 PR 수 | 1 | 1 | 3+ |
| 사전 작업 PR 수 | 0 | 3 | 0~1 |
| 사후 fix PR 수 | 4 | 1~2 | 4 |
| feat #09 검증 시점 | 머지 후 | 통합 전 | Group 3 직전 |
| main의 일시적 미검증 코드 노출 | 있음 | 없음 | Group 3 머지 시점에만 |
| 충돌 해결 난이도 | 중 (한 번에 22건) | 하 (정돈된 상태) | 중 (3회 분할) |
| 추적성 | 낮음 (단일 큰 PR) | 높음 | 매우 높음 |
| 총 소요 시간(추정) | 10~16h | 13~21h | 13~21h |
| **권장 시나리오** | 빠른 합류·릴리스 압박 | 정합성·검증 우선 | 리뷰 부담·롤백 가능성 우선 |

---

## 4. 권장 경로 — 옵션 B (안전 중심) 

### 4.1 권장 근거

1. **D-1 (feat #09 미검증)이 가장 큰 리스크**. 코드 800+줄 추가에 동작 검증이 전혀 없는 상태이며, Stage 3d는 게이트·타임아웃·abort 처리 등 런타임 동작이 핵심인 기능. main에 들어간 후 발견되면 hot-fix 부담이 크다.
2. **두 브랜치의 기능이 직교**해 사전 부채 청산이 통합 자체를 어렵게 만들지 않는다 (옵션 A 대비 한계 비용 작음).
3. **CLAUDE.md 규칙 — `/plan` 없이 코드 수정 금지**과 정합. 옵션 A는 "통합 PR에 검증을 묶지 않음"이라 사후 plan/fix 사이클이 필수인데, 옵션 B는 사전에 plan/fix를 끝내 통합 PR이 작아진다.
4. **본 프로젝트의 기존 워크플로우**(`/plan` → 계획서 → `/develop` or `/fix` → `/test` → `/review` → PR)와 가장 잘 맞는다. 옵션 A는 큰 통합 PR을 한 번에 만들어 워크플로우를 우회하는 경향.
5. **하네스를 단일 진실 원천으로 유지**해야 하는 프로젝트 정책(CLAUDE.md "하네스가 코드와 괴리되면 안 됨")과 정합. 통합 시점에 양쪽 하네스가 모두 정합한 상태여야 충돌 해결이 일관됨.

### 4.2 권장 실행 시퀀스 (의사결정 후 별도 `/plan`로 착수)

> 본 시퀀스는 "예시"이며, 각 단계는 **별도 `/plan` 계획서**를 거친 뒤 진행한다.

**Phase 1 — feat 브랜치 부채 청산** (3~5h)
1. `/plan` → fix 계획서: "feat #09 검증 + 발견 이슈 수정" (D-1)
   - Stage 3d 게이트 발화 시나리오, 30s timeout, abort 처리 검증
   - 발견 이슈가 있으면 fixer로 수정
2. `/plan` → fix 계획서: "feat 브랜치 하네스 정합성 보강" (D-2/D-3/D-4/D-5)
   - VERSION.md v1.3/v1.5 추가
   - flows.md researching 단계 반영
   - message_type 소비 동선 문서화

**Phase 2 — main 브랜치 follow-up 청산 (선택, 일부만)** (2~3h)
3. `/plan` → fix 계획서: "PR #1 follow-up [P1] 폴더 스코프 누수"
   - graph-search.mjs:35,51 수정
   - main에 직접 PR 머지

**Phase 3 — 통합** (3~5h)
4. `/plan` → integration 계획서: "feat → main merge 통합"
   - 충돌 22건을 영역별 그룹으로 묶어 해결 (코드 별도, 하네스 별도)
   - 하네스 VERSION.md는 v1.5 + v1.4 병합 → v1.6 신규 엔트리로 통합 기록
   - 빌드/타입체크 통과 후 PR 생성

**Phase 4 — 사후 정리** (4~6h)
5. `/plan` → fix 계획서: "PR #1 follow-up [P2/P3] 묶음"
   - F-2 ~ F-6 5건 일괄 수정

### 4.3 권장 시 트레이드오프 명시

- **단점 1: 시간 분산** — 옵션 A보다 3~5h 더 걸림. 사용자가 빠른 합류를 원한다면 옵션 A.
- **단점 2: PR 4~5개** — 작은 PR이지만 컨텍스트 스위칭 비용. 사용자가 단일 PR을 선호하면 옵션 A.
- **단점 3: feat 부채 청산 중 main이 또 변할 가능성** — 현재는 main이 잠잠하지만, 추가 PR이 들어오면 사전 작업 효과 일부 무효화. 본 시점에서는 main 활동이 적어 리스크 낮음.

---

## 5. 리스크 요약

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| **R-1**: feat #09 검증에서 critical 발견 | 중 | 높음 — Stage 3d 자체가 위험할 수 있음 (LLM 응답 신뢰성, 타임아웃 처리) | 옵션 B/C 채택 시 사전 발견 가능. 옵션 A 채택 시 hot-fix 시리즈 필요. |
| **R-2**: V2-only(6cefcc5)와 entity-graph 코드가 main.mjs 위치 겹침으로 비자명한 충돌 | 중 | 중 — main.mjs는 4000+줄이라 위치 겹침 가능 | 통합 전 `git merge --no-commit` 드라이런으로 사전 확인. 본 제안서는 사전 드라이런을 옵션 B 4단계에 포함. |
| **R-3**: cherry-pick(옵션 C)에서 commit 간 의존성 누락 | 중 | 중 — Group 2 없이 Group 3 cherry-pick 시 빌드 실패 가능 | 옵션 C 채택 시 사전 의존성 감사 필수. 옵션 B는 전체 merge라 무관. |
| **R-4**: 사전 fix 진행 중 main에 또 PR이 들어옴 | 낮 | 낮 — 본 시점 main 활동 적음 | 사전 fix는 1주 이내 완료 목표. |
| **R-5**: 하네스 v1.4 → 통합 v1.6 사이에 v1.5 누락 인상(VERSION.md 흐름 어색함) | 낮 | 낮 — 문서 가독성 | 통합 commit에서 v1.5(feat #09)와 v1.6(통합) 두 엔트리를 동시에 추가. |
| **R-6**: feat의 `.agents/skills/` 추가가 PR #1의 워크플로우 정의(CLAUDE.md)와 충돌 | 낮 | 중 | 통합 시 CLAUDE.md 양쪽 변경 사항 병합 (양쪽 다 워크플로우 강화 방향). 본 시점 대조 결과 직접 충돌은 없는 것으로 판단되나 통합 시점 재확인 필요. |

---

## 6. 결정 보류 사항 (사용자 확인 필요)

다음은 planner가 충분한 근거로 답할 수 없어 사용자 입력이 필요한 항목이다.

### B-1: feat #09 검증의 합격 기준
"검증 통과"의 정의가 필요. 후보:
- (a) 단일 논문 + 1개 NULL 컬럼 시나리오에서 `agenticRecovery.perPaper`가 정상 기록되면 통과
- (b) (a) + 다수 논문 + abort/timeout 시나리오까지 모두 정상이면 통과
- (c) 사용자가 직접 사용해서 체감상 문제 없으면 통과

→ planner 추천: (b). 코드 800+줄 추가 규모를 고려하면 abort/timeout 경로 포함이 안전.

### B-2: 통합 commit 메시지/PR 제목 규칙
PR #1은 "Fix #08:" 패턴, feat은 "feat #09:" 패턴. 통합 PR은:
- (a) "Integrate: feature/pipeline-v2-only with main (V2-only + Agentic NULL + Entity Graph)"
- (b) "Merge: feat#08+#09 ↔ fix#08 entity-graph"
- (c) 사용자 지정

### B-3: PR #1 follow-up [P1] 처리 시점
권장은 통합 **전**(옵션 B 3단계)이지만, 다음 가능성 있음:
- 통합과 동시 처리 → 통합 PR이 커지지만 round-trip 1회 절약
- 통합 후 처리 → 통합 PR은 깨끗하지만 main의 알려진 결함이 더 오래 노출

### B-4: e79b040의 message_type 변경 의도 확인 필요
변경은 `chat_messages.message_type`을 history 로딩에 포함하고 LLM에 전달하는 것이지만, 이 정보를 LLM 프롬프트에서 어떻게 활용하려는지(예: "이전 메시지가 table_report였으니 후속을 다르게 처리")가 코드에는 보이지 않음. 의도 파악되어야 D-5 문서화 방향이 정해진다.

### B-5: presentation_assets 처리 방향
feat 브랜치에 `docs/presentation_assets/redou-agent/...` 21개 파일이 신규 추가됨 (HTML, SVG). 이는 발표 자료로 보이는데:
- 통합과 함께 main에 합류시킬 것인가
- 별도 자산 저장소로 분리할 것인가
- 통합 보류 (별도 commit으로 관리)

→ 영향은 빌드·런타임에 없음. 단순 결정 사항.

### B-6: 작업 순서 우선
시간 압박이 있는가? 빠른 합류가 우선인지(→ A), 다음 기능 진입 전 정합성 확보가 우선인지(→ B/C) 사용자 의도 확인 필요.

---

## 7. 다음 단계 (사용자 결정 후)

1. 사용자가 옵션 A/B/C 중 1개 선택, B-1~B-6 답변.
2. planner가 선택된 옵션에 맞춰 **Phase 1 첫 작업의 `/plan` 계획서**를 작성 (예: 옵션 B면 D-1 검증 fix 계획서).
3. 본 제안서는 `docs/features/proposals/2026-04-28-integration-strategy.md`에 보존되어, 후속 모든 fix/feature 계획서가 본 문서를 참조한다.

---

## 부록 A — 작업 단위별 구체 파일 목록

### Phase 1-1 (D-1: feat #09 검증)
- 검증 대상: `apps/desktop/electron/main.mjs`(Stage 3d 함수들), `apps/desktop/electron/llm-orchestrator.mjs`(NULL_RECOVERY 프롬프트·extractor)
- 시나리오: 70ccfcd commit에서 추가된 함수들(`runAgenticNullRecovery`, `shouldTriggerAgenticRecovery`, `extractNullCellsFromPaper` 등) 발화 경로

### Phase 1-2 (D-2/3: VERSION.md)
- 수정 파일: `docs/harness/VERSION.md`
- 추가 엔트리: v1.3 (V2-only, 6cefcc5 시점), v1.5 (Agentic NULL, 70ccfcd 시점)

### Phase 1-3 (D-4: flows.md researching)
- 수정 파일: `docs/harness/main/flows.md`
- TABLE 채팅 흐름에 Stage 3d 단계 추가 (extracting → researching → assembling)

### Phase 1-4 (D-5: message_type 문서화)
- 수정 파일: `docs/harness/detail/electron/llm.md` 또는 `detail/database/schema.md`
- 추가 내용: chat_messages.message_type의 의미·전달 동선

### Phase 2 (P1: 폴더 스코프 누수)
- 수정 파일: `apps/desktop/electron/graph-search.mjs:35,51`
- 별도 fix 계획서로 처리

### Phase 3 (통합)
- merge 기준 파일: 22개 (위 1.3 참조)
- 신규 단방향 파일: 44개 (충돌 없음)

### Phase 4 (P2/P3 follow-up 묶음)
- 수정 파일:
  - `apps/desktop/electron/main.mjs:1892` (F-2)
  - `apps/desktop/electron/main.mjs:2046` (F-3)
  - graph chunk order (F-4) — 정확한 위치는 fix 계획 시 추적
  - `apps/desktop/electron/entity-extractor.mjs:548` (F-5)
  - `frontend/src/features/settings/SettingsView.tsx:344` (F-6)

---

## 부록 B — 본 제안서 작성 시 검증한 사실들

1. **충돌 22건 검증**: `git merge-tree feature/pipeline-v2-only origin/main`로 직접 확인 (사용자 보고 20건과 거의 일치, 차이는 CLAUDE.md 1건 + 카운트 방식).
2. **VERSION.md 누락 확인**: feat 브랜치 VERSION.md는 v1.2 마지막. v1.3, v1.5 엔트리 없음.
3. **flows.md researching 누락 확인**: `grep researching = 0건` (feat 브랜치).
4. **단방향 추가 파일 분리**: `.agents/skills/`(feat), presentation_assets(feat), entity_graph 마이그레이션(main)은 충돌 대상 아님.
5. **PR #1 follow-up 6건 출처**: `gh api repos/huckwnmo99/Redou/pulls/1`로 직접 확인.
6. **message_type 소비처**: `frontend/src/features/chat/ChatMessageList.tsx:78,135,137`에서 분기 사용 — 즉 frontend 활용은 명확. 그러나 history에 실어 LLM에 보내는 의도는 코드에서 즉시 식별 안 됨 (B-4 결정 보류 사유).

---

**문서 끝.**
