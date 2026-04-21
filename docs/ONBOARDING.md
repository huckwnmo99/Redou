# Redou 온보딩 가이드

새로 합류한 개발자가 **어느 문서를, 어떤 순서로 읽으면** Redou를 가장 빠르게 이해할 수 있는지 안내하는 내비게이션 문서입니다. 각 문서의 내용을 요약하지 않고 "어디에 뭐가 있는지"만 가리킵니다.

---

## 1단계 — 앱이 뭐하는 것인지 이해 (30분)

읽는 순서:

1. **`README.md`** (프로젝트 루트)
   - 한 문단 개요, 실행 방법, 환경변수
   - 이것만 읽어도 "뭘 하는 앱인지"는 파악됨

2. **`docs/harness/main/overview.md`** ⭐ 하네스 1/3
   - 기술 스택 전체, 외부 서비스(포트별), 핵심 개념 용어집
   - `CURRENT_EXTRACTION_VERSION`, Pipeline V1/V2 같은 프로젝트 내부 용어는 여기서만 정의됨

3. **`docs/harness/main/flows.md`** ⭐ 하네스 2/3
   - PDF 임포트 → 처리 → 임베딩 → 검색 → 채팅까지 데이터가 어떻게 흐르는지
   - 함수/파일/라인 번호까지 찍혀 있어서 코드 추적 가능

이 단계를 끝내면 "PDF 올리면 무슨 일이 벌어지는지"를 말할 수 있어야 합니다.

---

## 2단계 — 워크플로우와 규칙 파악 (20분)

1. **`CLAUDE.md`** (프로젝트 루트) ⭐ 필독
   - 워크플로우(`/plan` → `/develop` → `/test` → `/review`)
   - **절대 규칙** (메인 에이전트 직접 코드 수정 금지, 하네스 갱신 의무 등)
   - 에이전트 구성표, 주요 명령어(`npm run dev`, `node --check` 등)

2. **`docs/harness/main/feature-status.md`** ⭐ 하네스 3/3
   - 전체 기능 매트릭스 (✅/⏳/🚧)
   - 지금 "뭐가 되어있고 뭐가 미완성인지" 한눈에
   - 각 기능별로 어느 detail 문서를 보면 되는지 포인터 있음

3. **`docs/harness/VERSION.md`**
   - 하네스 변경 이력. 최근 어떤 이슈/리팩터가 있었는지 확인

이 단계를 끝내면 "뭘 고치고 싶으면 어떤 절차를 따라야 하는지"가 명확해집니다.

---

## 3단계 — 작업 대상 영역 딥다이브 (필요할 때)

`docs/harness/detail/` 아래에서 **작업할 영역만 골라서** 읽으세요. 전부 읽지 않아도 됩니다.

### Electron / 백엔드 로직 만지는 경우
- `detail/electron/main-process.md` — IPC 채널, 앱 라이프사이클
- `detail/electron/pdf-pipeline.md` — PDF 추출 파이프라인 (V1 휴리스틱 + V2 MinerU/GROBID)
- `detail/electron/embedding.md` — 임베딩 생성 (VL 모델, Contextual Chunking)
- `detail/electron/llm.md` — Orchestrator, Table Agent, SRAG, Guardian
- `detail/electron/rag-pipeline.md` — Hybrid Search, Reranker, 테이블 우선 검색

### 프론트엔드 만지는 경우
- `detail/frontend/paper.md` — PDF 리더, 하이라이트
- `detail/frontend/chat.md` — 채팅 UI, 스트리밍, 테이블 리포트
- `detail/frontend/search.md` — 시맨틱 검색 UI
- `detail/frontend/notes.md` — 노트 워크스페이스
- `detail/frontend/stores-queries.md` — Zustand + TanStack Query 레이어

### DB 스키마 만지는 경우
- `detail/database/schema.md` — 테이블 구조, 관계
- `detail/database/rpc.md` — PostgreSQL RPC 함수 (`match_chunks`, `build_or_tsquery` 등)

### 외부 서비스 관련
- `detail/services/external.md` — Ollama, MinerU, GROBID, UniMERNet, vLLM 의존성

**읽는 법**: 먼저 해당 파일의 "현재 상태"와 "알려진 이슈" 섹션을 확인하세요. 내가 만지려는 것이 이미 알려진 이슈일 수 있습니다.

---

## 4단계 — 계획서와 아이디어 문서 (작업 시작 전)

1. **`docs/features/new/`** — 승인된 기능 구현 계획서
   - `01-table-qa-separation.md` ~ `07-srag-extraction.md`
   - 최근 구현된 큰 기능들의 설계 의도를 보려면 여기

2. **`docs/features/fix/`** — 승인된 수정 계획서
   - `01-v2-empty-table-ocr-fallback.md` ~ `07-review-critical-fixes.md`
   - 최근에 어떤 버그들을 고쳤는지 확인 가능
   - 본인이 수정 작업을 시작한다면 `/plan`이 여기에 계획서를 만듦

3. **`docs/backlog/`** — 아직 구현 전인 아이디어 목록
   - 번호가 붙은 할 일 리스트. `/plan` 대상 후보

4. **`docs/01-Idea/`** — 리서치/제안 리포트 (RAG 설계 등)
   - 왜 이런 아키텍처를 택했는지 배경 이해

---

## 5단계 — 서브에이전트 시스템 이해 (기여하기 전에)

Redou는 **Claude(오케스트레이터) + Codex(개발자)** 구조로 개발됩니다.

> **역할 분리**: Claude는 설계·계획·검증·리뷰를 담당하고, **Codex가 모든 실제 코드를 작성**합니다.

### 워크플로우 전체 그림

```
아이디어 토의
    │
    ▼ (구현 결정)
    ├─ 소규모 수정 ──────────────────────────────→ codex:rescue (Codex가 직접 수정)
    │
    └─ 신기능/대규모 → /plan (Claude가 설계·계획서 작성)
                              │ (사용자 승인)
                              ▼
                         codex:rescue  →  Codex가 계획서대로 구현
                              │
                              ▼
                         /test  →  Claude tester가 빌드/타입/린트 검증
                              │
                              ▼
                         /review  →  Claude reviewer가 코드 리뷰 + PR 생성
```

### 도구별 역할

| 도구 | 주체 | 역할 한 줄 요약 |
|------|------|----------------|
| `codex:rescue` | **Codex CLI** | **모든 코드 구현/수정** — 계획서 기반 구현 or 소규모 직접 수정 |
| `/plan` | Claude (planner) | 코드 읽기 전용 → `docs/features/` 계획서 작성 |
| `/test` | Claude (tester) | 빌드·타입·린트·테스트 검증, 오류 분석 |
| `/review` | Claude (reviewer) | 코드 리뷰 + PR 생성 |

에이전트 정의 파일(`.claude/agents/*.md`) 안에는 해당 에이전트의 실행 절차, 사용 가능한 도구, 하네스 읽기 순서까지 명시되어 있습니다. 에이전트 동작을 바꾸고 싶으면 해당 파일을 수정합니다.

### 스킬 정의 파일

`.claude/skills/*.md` — 각 슬래시 커맨드가 어떤 에이전트를 어떻게 호출하는지 정의합니다. 커스터마이징이 필요한 경우에만 확인하면 됩니다.

### 핵심 규칙 (절대 예외 없음)

1. **Claude는 코드를 직접 작성하지 않는다** — 모든 코드 변경은 `codex:rescue`(Codex)가 담당
2. **소규모 수정**은 `codex:rescue` 직행 — 계획서 불필요
3. **대규모 변경**은 반드시 `/plan` 먼저 — 계획서 없이 Codex에 대규모 구현 위임 금지
4. 기능 추가/수정 후 하네스(`docs/harness/`) 갱신 의무

---

## 6단계 — 참고만 할 문서

- **`docs/ROADMAP.md`** — 전체 로드맵. **⚠ 자동 갱신되지 않음**, 참고용
- **`docs/PROJECT_STRUCTURE.md`** — 레거시. `harness/main/overview.md`가 최신
- **`docs/04-planning/`** — 초기 설계 문서 (어노테이션 계획 등). 히스토리용
- **`AGENTS.md`** — Codex 에이전트 활동 로그. 어떤 작업이 언제 있었는지 확인할 때
- **`.claude/agents/`**, **`.claude/skills/`** — 에이전트/스킬 정의. 워크플로우 커스터마이징 시만

---

## 빠른 참조 — 상황별 "어디 보지?"

| 상황 | 먼저 볼 곳 |
|------|-----------|
| "이 앱이 뭐하는 건지 5분 설명" | `README.md` |
| "PDF 올리면 내부에서 뭐가 돌아가지?" | `harness/main/flows.md` |
| "기능 X가 완성됐나?" | `harness/main/feature-status.md` |
| "코드를 고치고 싶다 (소규모)" | `codex:rescue` 직접 사용 |
| "코드를 고치고 싶다 (대규모)" | `CLAUDE.md` (워크플로우) → `/plan` |
| "에이전트 동작을 바꾸고 싶다" | `.claude/agents/{에이전트명}.md` |
| "Orchestrator/SRAG가 뭐지?" | `harness/detail/electron/llm.md` |
| "최근 어떤 버그가 있었지?" | `docs/features/fix/` + `harness/VERSION.md` |
| "앞으로 뭘 할 예정이지?" | `docs/backlog/` + `docs/ROADMAP.md` |
| "DB 테이블 구조는?" | `harness/detail/database/schema.md` |
| "어떤 포트에서 뭐가 돌지?" | `harness/main/overview.md` (외부 서비스 표) |

---

## 중요한 마인드셋

- **하네스(`docs/harness/`)가 단일 진실 원천(Single Source of Truth)**. 코드와 하네스가 다르면 하네스를 믿지 말고 코드를 확인한 뒤 하네스를 갱신하세요 (`CLAUDE.md` 규칙).
- **ROADMAP은 자동 갱신되지 않으므로** 현재 상태 확인은 반드시 `feature-status.md`로.
- **코드 변경은 `/plan` 먼저**. 소규모 수정도 예외 없습니다 (`CLAUDE.md` 절대 규칙).
- **하네스 갱신 의무**: 기능 추가/수정 후 관련 `detail/*.md` 갱신 + `VERSION.md` 버전 범프.

---

## 추천 첫 작업

문서만 읽지 말고 실제로 돌려보는 것이 이해에 가장 빠릅니다:

1. `README.md`의 "실행 방법"대로 Supabase/프론트엔드/Electron 실행
2. PDF 한 편 임포트 (equation/table 있는 논문 권장)
3. 처리 완료 후 시맨틱 검색 + AI 채팅으로 테이블 생성 시도
4. Electron 개발자 도구(`Ctrl+Shift+I`)와 터미널 로그를 양쪽 열어두고 어떤 IPC가 오가는지 관찰

이 사이클을 한 번 돌리면 `flows.md`의 내용이 머리에 들어옵니다.
