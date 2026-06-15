# Fix: 하네스/워크플로우 정합성 정리

> 유형: fix | 작성일: 2026-05-05

## 문제

V3 본체는 새 워크플로우(`/plan → codex:rescue → /test → /review`)로 전환했으나, 다음 3가지가 정합성을 깨뜨리고 있음.

### 1. 워크플로우 불일치
- **증상**: `CLAUDE.md`(새 워크플로우)와 실제 파일 시스템(옛 워크플로우 잔재)이 불일치.
- **원인**: 새 워크플로우 도입 시 옛 에이전트/스킬 정의를 정리하지 않음.
- **근거**:
  - `CLAUDE.md:9-34` — Claude+Codex 분리, `codex:rescue`만 코드 작성. `/develop`, `/fix` 미언급.
  - `.claude/skills/develop/SKILL.md:1-21` — 옛 워크플로우 (`agent: developer`, `developer.md` 호출).
  - `.claude/skills/fix/SKILL.md:1-21` — 옛 워크플로우 (`agent: fixer`, `fixer.md` 호출).
  - `.claude/agents/developer.md` — 옛 에이전트 정의 (현재 어디서도 호출되지 않음).
  - `.claude/agents/fixer.md` — 옛 에이전트 정의 (현재 어디서도 호출되지 않음).
  - `.claude/agents/tester.md:11,156` — 본문에 "/develop" 잔재 표현.
  - `.claude/agents/reviewer.md:166` — 본문에 "/develop" 잔재 표현.
  - `.claude/agents/planner.md:17-19,118,168,191` — planner가 "fix → /fix", "feature → /develop"로 안내. 새 워크플로우와 불일치.
  - `docs/ROADMAP.md:13` — 상태 범례에 "/develop 또는 /fix" 표기.
  - `docs/ONBOARDING.md:30` — 워크플로우 한 줄에 `/develop` 잔재 (다른 곳은 codex:rescue로 갱신됨, 1줄만 누락).

### 2. 하네스 stale (한 달 정체)
- **증상**: `docs/harness/`가 2026-04-10~04-22 기준이며, 그 후 약 6개의 commit이 반영되지 않음.
- **근거**:
  - `docs/harness/VERSION.md` 헤더: v1.2 (2026-04-10).
  - `docs/harness/main/overview.md:2`: v1.0 (2026-04-10).
  - `docs/harness/main/feature-status.md:2`: v1.1 (2026-04-22).
  - `docs/harness/main/flows.md:2`: v1.0 (2026-04-10).
  - `docs/harness/detail/database/schema.md:2`: v1.0 (2026-04-10), 마이그레이션 20개로 표기됐으나 실제는 23개 (`20260503010000_secure_chat_tables.sql`, `20260504010000_add_supplementary_source_tracking.sql`, `20260506010000_add_rag_source_file_metadata.sql` 누락).
  - `docs/harness/detail/electron/llm.md:2`: v1.0 (2026-04-22).
  - 누락 commit:
    - `eefa1d2` — Orchestrator 테이블 캡션 (fix #09)
    - `70ccfcd` — Agentic NULL Recovery (Stage 3d, feat #09)
    - `6cefcc5` — V2 단일 파이프라인 (EXTRACTION_VERSION 24→25, V1 휴리스틱 제거)
    - `ef369db` — GROBID 중첩 listBibl + xml:id off-by-one
    - `e79b040` — chat history message_type 로드
    - `73e9d7e` — agent skills + presentation assets
    - `76401b1` — supplementary source labels (RAG 출처 라벨)
    - `206bb3f`, `36051cf`, `2a516d0`, `ce91d2c`, `673ae5a`, `9071e29`, `d1347dd`, `c6ba158`, `c2f2c3d`, `1637751` — Stage 3d 검증, 통합 전략, supplementary 관련

### 3. 분기 상태 미반영
- **증상**: V3 본체 = `feature/pipeline-v2-only` 브랜치, origin/main 대비 12 commit ahead. origin/main에는 PR #1 (엔티티 그래프 #08, commit `3799fd2`)이 들어갔으나 V3 브랜치에는 부재. 하네스에 분기 정보 없음.
- **근거**:
  - `git log feature/pipeline-v2-only ^origin/main` → 12 commit (76401b1 ~ 6cefcc5).
  - `git log origin/main` → `3799fd2 Fix #08: 엔티티 그래프 critical 이슈 + 문서 정합성 보강 (#1)` 존재.
  - `git log feature/pipeline-v2-only --grep="엔티티"` → 매칭 없음.
  - 하네스 `feature-status.md`에 분기/PR/엔티티 그래프 관련 정보 부재.

### 추가 조사 결과 (사용자 요청 사항 정정)
- **Working tree clean**: 사용자 요청에 적힌 "11 modified + 24 untracked"는 V3 본체에서 확인되지 않음. `git status` → working tree clean. 모든 변경이 이미 12 commit ahead로 커밋됨. 따라서 미커밋 작업 처리는 별도 작업 불요.
- **`.agents/skills/` 정체성 확인**: `docs/exports/Skills/README.md` 분석 결과, 사용자 본인 GitHub repo `huckwnmo99/Skills`를 export한 mirror이며, `.agents/skills/`는 그 sync 대상. **Codex 전용 스킬 시스템**이며 Claude `.claude/skills/`와 별개 시스템 — 충돌 아님. 보존 정책만 명시하면 됨.
- **`AGENTS.md`**: Codex가 사용하는 별도 작업 로그 문서. 옛 Claude 워크플로우(`/develop`, `/fix`)를 가리키지 않음. 정합성 작업 대상 아님.

## 수정 방안

### 작업 1: 워크플로우 통일 (옛 워크플로우 잔재 제거)

| 파일 | 수정 내용 |
|------|-----------|
| `.claude/skills/develop/SKILL.md` | **삭제**. `CLAUDE.md`가 `/develop`을 명시하지 않으며 호출 경로 없음. |
| `.claude/skills/fix/SKILL.md` | **삭제**. 동일 이유. |
| `.claude/agents/developer.md` | **삭제**. 호출하는 스킬이 사라짐. |
| `.claude/agents/fixer.md` | **삭제**. 호출하는 스킬이 사라짐. |
| `.claude/agents/planner.md:17-19` | "소규모 수정 → /fix", "대규모 → /develop" → "소규모 수정 → `codex:rescue` 직행", "대규모 → `codex:rescue` (계획서 기반 위임)"로 수정 |
| `.claude/agents/planner.md:38-39` | 사용자에게 묻는 메시지 "소규모(`/fix`)/전체(`/develop`)" → "소규모(`codex:rescue` 직행)/대규모(`codex:rescue` 계획서 기반)"로 수정 |
| `.claude/agents/planner.md:118` | "보고 시: '소규모 수정입니다. `/fix`로 진행할까요?'" → "보고 시: '소규모 수정입니다. `codex:rescue`로 진행할까요?'" |
| `.claude/agents/planner.md:168` | "구현 순서대로 나열한다. `/develop` 에이전트가 이 순서대로 실행한다." → "구현 순서대로 나열한다. `codex:rescue`가 이 순서대로 실행한다." |
| `.claude/agents/planner.md:191` | "보고 시: '이 방향으로 `/develop` 진행할까요?'" → "보고 시: '이 방향으로 `codex:rescue` 진행할까요?'" |
| `.claude/agents/tester.md:11` | "/develop로 구현된 코드가" → "codex:rescue로 구현된 코드가" |
| `.claude/agents/tester.md:156` | "수정이 필요하면 /develop로 돌아가주세요." → "수정이 필요하면 codex:rescue로 돌아가주세요." |
| `.claude/agents/reviewer.md:166` | "`/develop`로 돌아가기" → "`codex:rescue`로 돌아가기" |
| `docs/ROADMAP.md:13` | "🔧 진행 중 / `/develop` 또는 `/fix` 진행 중" → "🔧 진행 중 / `codex:rescue` 진행 중" |
| `docs/ONBOARDING.md:30` | "워크플로우(`/plan` → `/develop` → `/test` → `/review`)" → "워크플로우(`/plan` → `codex:rescue` → `/test` → `/review`)" |
| `.claude/skills/plan/SKILL.md` | 변경 없음. 새 워크플로우와 호환 (Plan은 양쪽 워크플로우에서 그대로). |
| `.claude/skills/test/SKILL.md:3` (description) | "`/develop` 완료 후" → "`codex:rescue` 완료 후" |
| `.claude/skills/review/SKILL.md` | 변경 없음. |
| `.claude/skills/skill-creator/` | 변경 없음. 외부 출처(Anthropic skill-creator) 보존. |
| `.agents/skills/**` | 변경 없음. Codex 전용 외부 스킬 시스템. 단, 이 결정을 `CLAUDE.md`에 짧게 명시 (아래 참조). |
| `CLAUDE.md` (절대 규칙 섹션 끝) | 한 줄 추가: "`.agents/skills/`는 Codex 전용 외부 스킬(huckwnmo99/Skills) 미러로 보존한다. Claude는 사용하지 않으며, 본 워크플로우와 별개." |

### 작업 2: 하네스 버전 동기화

신규 버전 결정: **v1.3** (변경 규칙: minor=내용 갱신, major=구조 변경. 6+ commit 모두 내용 갱신이라 v1.3 자연스러움. v2.0은 구조 재편 시 사용.)

| 파일 | 수정 내용 |
|------|-----------|
| `docs/harness/VERSION.md` | 최상단에 새 섹션 추가:<br>```<br>## v1.3 — 2026-05-05<br>- feat #09 Stage 3d Agentic NULL Recovery 반영 (commit 70ccfcd)<br>- fix #09 Orchestrator 테이블 캡션 반영 (commit eefa1d2)<br>- V2 단일 파이프라인, EXTRACTION_VERSION 24→25 (commit 6cefcc5)<br>- GROBID 중첩 listBibl 수정 (commit ef369db)<br>- chat history message_type 로드 (commit e79b040)<br>- supplementary source labels (commit 76401b1)<br>- 마이그레이션 20→23개 (3개 신규)<br>- 워크플로우 정합성 정리 (`/develop`, `/fix` 잔재 제거)<br>- 분기 상태 섹션 추가 (feature-status.md)<br>``` |
| `docs/harness/main/overview.md:2` | "v1.0 \| 최종 갱신: 2026-04-10" → "v1.3 \| 최종 갱신: 2026-05-05" |
| `docs/harness/main/overview.md` | "External 의존성" 표 변경 없음. "핵심 개념 용어집"에 한 줄 보완: `\| Supplementary Source \| RAG 출처 라벨용 source_kind 메타데이터 (primary_pdf / supplementary)\|` (commit 76401b1 반영) |
| `docs/harness/main/overview.md` | `CURRENT_EXTRACTION_VERSION` 줄에 "현재 25" 명시 (이미 25로 표기됐는지 확인 후 유지). |
| `docs/harness/main/feature-status.md:2` | "v1.1 \| 최종 갱신: 2026-04-22" → "v1.3 \| 최종 갱신: 2026-05-05" |
| `docs/harness/main/feature-status.md` ("최근 변경" 표) | 6개 commit 추가 행: eefa1d2, 70ccfcd, 6cefcc5, ef369db, e79b040, 73e9d7e, 76401b1 (Stage 3d 검증/관련 작은 commit은 별도 행으로 묶음 처리 가능) |
| `docs/harness/main/feature-status.md` (전체 매트릭스) | 신규 행 추가:<br>- "Supplementary 파일 source 추적 \| ✅ 구현됨 \| (관련 detail 없음 - new) \| commit 76401b1, 마이그레이션 `20260504_add_supplementary_source_tracking`"<br>- "RAG 출처 파일 라벨 \| ✅ 구현됨 \| 마이그레이션 `20260506_add_rag_source_file_metadata`" |
| `docs/harness/main/flows.md:2` | "v1.0 \| 최종 갱신: 2026-04-10" → "v1.3 \| 최종 갱신: 2026-05-05" |
| `docs/harness/main/flows.md` (PDF 임포트 섹션) | V1 휴리스틱 폴백 제거 후 "MinerU 미가용 시 throw" 명시 ([단일 파이프라인] 섹션 line 18~25에 이미 부분 반영됐으나 V1 휴리스틱 잔재 표현 점검) |
| `docs/harness/main/flows.md` (테이블 생성 섹션) | Stage 3d Agentic NULL Recovery 추가 (현재 Stage 1~3c, Stage 4 Guardian만 있음). Stage 3c 이후 Stage 3d 흐름:<br>```<br>├─ Stage 3d: Agentic NULL Recovery [llm-orchestrator.mjs:extractNullCellsFromPaper]<br>│   ├─ NULL 셀 → 논문별 그룹핑<br>│   ├─ Gate 1: 새로운 chunk/figure 컨텍스트 발견 시만 LLM 호출<br>│   ├─ Gate 2: confidence === "high" 만 적용<br>│   └─ 결과 → 셀 업데이트 + metadata.recovery 로깅<br>``` |
| `docs/harness/detail/database/schema.md:2` | "v1.0 \| 최종 갱신: 2026-04-10" → "v1.3 \| 최종 갱신: 2026-05-05" |
| `docs/harness/detail/database/schema.md` (마이그레이션 표) | 행 21~23 추가:<br>- 21: `20260503010000_secure_chat_tables.sql` — chat 테이블 RLS + 정책<br>- 22: `20260504010000_add_supplementary_source_tracking.sql` — supplementary 추적 컬럼<br>- 23: `20260506010000_add_rag_source_file_metadata.sql` — RAG 출처 메타데이터 |
| `docs/harness/detail/database/schema.md` ("핵심 테이블" 섹션) | `paper_files` 행에 `source_kind`(text) 컬럼 추가 (commit 76401b1 후속). `chat_messages` / `chat_conversations` / `chat_generated_tables`에 RLS 활성화 여부 추가 (마이그레이션 20260503 반영) |
| `docs/harness/detail/electron/llm.md:2` | "v1.0 \| 최종 갱신: 2026-04-22" → "v1.3 \| 최종 갱신: 2026-05-05" |
| `docs/harness/detail/electron/llm.md` (orchestrator 함수 표) | `extractNullCellsFromPaper` 행 추가: "NULL 셀 한정 추출 (Gate 1 새 컨텍스트 / Gate 2 high confidence)" |
| `docs/harness/detail/electron/pdf-pipeline.md`(존재 여부 확인 후) | V1 휴리스틱 제거 반영, EXTRACTION_VERSION=25 명시. GROBID nested listBibl 처리 메모 추가 (commit ef369db). |
| `docs/harness/detail/electron/rag-pipeline.md`(존재 여부 확인 후) | Stage 3d NULL Recovery 라인 추가, source_kind 라벨 적용 흐름 메모 |
| `docs/harness/detail/frontend/chat.md`(존재 여부 확인 후) | message_type 로드 반영 (commit e79b040), supplementary source label UI 메모 |

### 작업 3: 분기 상태 + 누락 PR 반영

선택 안: **(a) feature-status.md에 "분기 상태" 섹션 추가** (가장 가볍고 정보 집중도 높음). 신규 파일 생성보다 단일 파일 갱신이 정합성 유지에 유리.

| 파일 | 수정 내용 |
|------|-----------|
| `docs/harness/main/feature-status.md` (문서 끝) | 새 섹션 "## 분기 상태" 추가:<br>```<br>## 분기 상태<br><br>현재 V3 본체: `feature/pipeline-v2-only` 브랜치<br>origin/main 대비: 12 commit ahead<br><br>### origin/main에 있고 feature 브랜치에 없는 작업<br>- PR #1 (commit 3799fd2): "Fix #08: 엔티티 그래프 critical 이슈 + 문서 정합성 보강"<br>  - feature 브랜치 통합 필요. 통합 전략은 `docs/features/proposals/2026-05-05-integration-strategy-update.md` 참조.<br><br>### feature 브랜치 미반영 항목<br>- 엔티티 그래프 (#08) 관련 기능은 본 브랜치에 미적용. RAG/Q&A 기능에는 영향 없음 (별도 모듈).<br>``` |
| `docs/harness/VERSION.md` (v1.3 항목 안) | "분기 상태 섹션 추가 (feature-status.md)" 한 줄 추가 (작업 2와 함께 묶음) |

## 영향 범위

- **수정 파일**: 약 15개 (워크플로우 8 + 하네스 7 + ONBOARDING/ROADMAP 2 = 17 영역, 일부 동일 파일 중복 편집).
- **삭제 파일**: 4개 (`.claude/skills/develop/SKILL.md`, `.claude/skills/fix/SKILL.md`, `.claude/agents/developer.md`, `.claude/agents/fixer.md`).
- **신규 파일**: 0개.
- **DB 변경**: 없음.
- **새 IPC**: 없음.
- **사이드 이펙트**:
  - 옛 `/develop`, `/fix` 슬래시 명령은 **사용 불가** 상태가 됨 (사실상 이미 호출 경로 없으므로 실질적 변화는 없음).
  - 옛 워크플로우로 회귀 시 git revert 필요.
  - `.claude/skills/`에 남는 스킬: `plan`, `test`, `review`, `skill-creator` (4개).

## 검증 방법

작업 완료 후 다음 명령으로 일관성 확인:

```bash
# 1. 옛 워크플로우 잔재 grep (결과 0건이어야 함)
grep -rn "/develop\|/fix\|developer.md\|fixer.md" \
  C:/Users/admin/Desktop/Server/Redou/V3/.claude \
  C:/Users/admin/Desktop/Server/Redou/V3/CLAUDE.md \
  C:/Users/admin/Desktop/Server/Redou/V3/AGENTS.md \
  C:/Users/admin/Desktop/Server/Redou/V3/docs/ROADMAP.md \
  C:/Users/admin/Desktop/Server/Redou/V3/docs/ONBOARDING.md \
  --exclude-dir=worktrees \
  --include="*.md"
# 단, docs/features/fix/*.md, docs/features/new/*.md, docs/features/proposals/*.md, docs/exports/Skills/**, .agents/skills/** 는 사후 정리 대상 아님 (히스토리/외부)

# 2. 하네스 버전 일관성 (모두 v1.3이어야 함)
grep -E "하네스 버전:" C:/Users/admin/Desktop/Server/Redou/V3/docs/harness/main/*.md \
  C:/Users/admin/Desktop/Server/Redou/V3/docs/harness/detail/*/*.md

# 3. 마이그레이션 카운트 일치 확인
ls C:/Users/admin/Desktop/Server/Redou/V3/supabase/migrations | wc -l  # 23
grep -c "^| [0-9]" C:/Users/admin/Desktop/Server/Redou/V3/docs/harness/detail/database/schema.md  # 23

# 4. 삭제 파일 확인
test ! -f C:/Users/admin/Desktop/Server/Redou/V3/.claude/agents/developer.md
test ! -f C:/Users/admin/Desktop/Server/Redou/V3/.claude/agents/fixer.md
test ! -d C:/Users/admin/Desktop/Server/Redou/V3/.claude/skills/develop
test ! -d C:/Users/admin/Desktop/Server/Redou/V3/.claude/skills/fix

# 5. node 문법 체크 불필요 (코드 변경 없음)
```

## 리스크

1. **옛 워크플로우 회귀 불가**: developer/fixer를 삭제하면 `codex:rescue`(Codex CLI)에 의존. Codex CLI 미설치/장애 시 코드 수정 경로 없음.
   - **완화**: 사용자가 Codex 환경을 이미 사용 중(`docs/exports/Skills/`, `.agents/skills/` 존재). 보존을 원할 시 `archive/` 폴더로 이동하는 옵션 가능 (아래 결정 보류 사항 참조).
2. **하네스 갱신 누락**: 16+ 파일 중 일부를 빠뜨리면 정합성이 깨짐. 검증 grep 명령으로 사후 확인 필수.
3. **워크트리 동기화**: 본 작업은 V3 본체에서 수행. 워크트리(`.claude/worktrees/bold-hofstadter-a85d9f/`)는 별도 main 브랜치 checkout이라 영향 없음. 워크트리 동기화는 워크트리 작업자가 별도로 rebase/merge 수행.
4. **PR #1 통합**: 분기 상태 섹션은 정보 표기만. 실제 코드 통합은 본 작업 범위 밖 (`docs/features/proposals/2026-05-05-integration-strategy-update.md` 참조).

## 결정 보류 사항

다음 항목은 사용자 답변 필요:

1. **삭제 vs archive**: `.claude/agents/developer.md`, `.claude/agents/fixer.md`, `.claude/skills/develop/`, `.claude/skills/fix/`를 git에서 **완전히 삭제**할지, `.claude/agents/_archive/`나 `.claude/skills/_archive/`로 **이동 보존**할지.
   - **권장**: 삭제. git 히스토리에 남으므로 archive 폴더는 잡음 증가.
   - **보존 선택 시**: `.claude/skills/_archive/develop/SKILL.md`, `.claude/agents/_archive/developer.md` 형태로 이동 + 각 파일 상단에 "ARCHIVED: 2026-05-05, 옛 워크플로우. 새 워크플로우는 codex:rescue 사용." 헤더 추가.

2. **하네스 버전 정책**: v1.3 (minor)으로 충분한지, v2.0 (major - 워크플로우 잔재 제거+분기 섹션 신설은 구조 변경으로 볼 수도 있음)이 적절한지.
   - **권장**: v1.3. 파일 추가/삭제는 없고, 기존 파일 내용만 확장. VERSION.md 규칙상 minor.

3. **`docs/exports/Skills/skills/develop/SKILL.md`, `docs/exports/Skills/skills/fix/SKILL.md`**: 외부 mirror라 그대로 유지하는 것이 맞으나, 사용자 본인 repo이므로 향후 origin (`huckwnmo99/Skills`)에서 같이 정리할지 결정.
   - **권장**: 본 작업 범위 밖. 외부 repo 정합성은 별도 작업.

4. **실행 경로 권장**:
   - 본 작업은 **거의 모두 문서 + 설정 파일 삭제 + 마크다운 갱신**. 코드 로직 변경 0건.
   - V3 `CLAUDE.md` 절대 규칙은 "**Claude는 코드를 직접 수정하지 않는다**"이며, **코드의 정의는 명시적이지 않음** (`.md` 파일도 포함되는지 불분명).
   - **권장 경로**: `codex:rescue` (안전한 선택). 이유:
     - V3 CLAUDE.md `행동 원칙` "수술적 변경"과 정합.
     - 코드/문서 구분이 모호하면 일괄 Codex 위임이 일관됨.
     - 검증 grep이 다중 파일이라 자동화에 유리.
   - **대안 1**: `/fix` 직행 (옛 워크플로우 — 본 fix가 그것을 제거하는 작업이라 self-referential 문제 발생).
   - **대안 2**: 메인 Claude 직접 수행 (CLAUDE.md 절대 규칙 해석에 따라 위반 가능).
   - **결정 보류**: 사용자가 `codex:rescue` / 메인 직접 / 분할(삭제는 메인 직접, 마크다운 갱신은 Codex) 중 선택.

5. **분기 상태 표기 위치**:
   - 후보 (a) feature-status.md 추가 (권장, 위 작업 3에 반영)
   - 후보 (b) VERSION.md 부록
   - 후보 (c) `docs/harness/main/branch-state.md` 신규
   - 후보 (d) feature-status.md 비고에 메모만
   - **권장**: (a). 기존 feature-status.md가 "현재 상태" 단일 진실 원천 역할이라 자연스러움.

## 작업 순서 (선택 시)

`codex:rescue` 위임 시 권장 순서:

1. 워크플로우 잔재 제거: `.claude/agents/developer.md` `.claude/agents/fixer.md` `.claude/skills/develop/` `.claude/skills/fix/` 삭제 (또는 archive 이동).
2. 마크다운 갱신: `.claude/agents/planner.md`, `.claude/agents/tester.md`, `.claude/agents/reviewer.md`, `.claude/skills/test/SKILL.md`, `docs/ROADMAP.md`, `docs/ONBOARDING.md`, `CLAUDE.md` (한 줄 추가).
3. 하네스 버전 + 변경 이력 갱신: `VERSION.md`, `main/overview.md`, `main/feature-status.md`, `main/flows.md`, `detail/database/schema.md`, `detail/electron/llm.md`, 그 외 detail 파일.
4. 분기 상태 섹션 추가: `main/feature-status.md`.
5. 검증: 위 "검증 방법"의 grep/test 명령 실행.

## 가정 사항

- `[가정]` `.agents/skills/`는 Codex 전용이며 Claude 워크플로우와 무관. (근거: `docs/exports/Skills/README.md:36-44`)
- `[가정]` `.claude/skills/skill-creator/`는 외부 출처(Anthropic 또는 smithery.ai)라 보존. (근거: `skills-lock.json`에 `source: smithery.ai` 표기)
- `[가정]` 워크트리(`bold-hofstadter-a85d9f`)는 별도 git checkout이라 본 작업 범위 밖. 워크트리 작업자가 별도 rebase/merge 처리.
- `[가정]` 사용자 요청에 적힌 "11 modified + 24 untracked"는 부정확한 스냅샷이며, 실제 V3 working tree는 clean. 미커밋 파일 처리 작업은 본 fix에 포함하지 않음.
- `[가정]` 누락 commit 중 Stage 3d 검증/통합 전략 관련(commit `673ae5a`, `9071e29`, `d1347dd`, `c6ba158`, `c2f2c3d`, `1637751`)은 **검증 메모**라 하네스 갱신 대상 아님 (해당 정보는 `docs/features/fix/10-stage-3d-runtime-verification.md`, `docs/features/proposals/`에 이미 존재).
