# CLAUDE.md

## Project Overview

Redou는 연구 논문 읽기 & 관리 데스크탑 앱이다. Electron이 React 프론트엔드를 호스팅하고, 로컬 Supabase(Docker)와 통신한다. PDF로 논문을 임포트하면 자동 처리(텍스트 추출, figure/table/equation 감지, 임베딩)를 거쳐 PDF 리더, 노트, 시맨틱 검색으로 제공한다.

## Development Workflow

### 역할 구성

Redou의 모든 작업은 메인 Claude(오케스트레이터)가 전용 서브에이전트에 위임해 수행한다. 모든 에이전트는 Claude 기반이며 `.claude/agents/`에 정의되어 있다.

> **역할 분리 원칙**
> - **메인 Claude** = Orchestrator — 작업 분배, 단계 진행 관리, 검증 종합, 사용자 소통
> - **서브에이전트** = 실제 실행 — `planner`(설계) · `developer`/`fixer`(구현) · `tester`(검증) · `reviewer`(리뷰·PR)

### 새 기능 추가

```
/plan (planner 설계) → (승인) → /develop (developer 구현) → /test (tester 검증) → /review (reviewer 리뷰·PR) → (PR merge)
```

### 수정 (버그, UI 조정, 타입 오류)

```
/plan (planner 분석 → 규모 판단)
   ├─ 소규모 → /fix (fixer 수정 + 자체 검증)
   └─ 대규모 → /develop (developer 구현)
→ /test (tester) → /review (reviewer) → (PR merge)
```
planner가 규모를 판단해 `/fix`(소규모) 또는 `/develop`(대규모)로 안내한다. 6개 파일 이상이거나 DB 변경이 있으면 대규모다. **판단 축은 '파일 수'가 아니라 '동작이 바뀌나'다**: 로직·동작이 바뀌지 않는 사소한 수정(오타·디버그 로그·포맷·주석·미사용 import 등, 크기 무관)은 ledger·harness 없이 메인 Claude가 직접 처리하고 git 커밋만 남긴다. 동작이 바뀌는 수정은 아무리 작아도 ledger를 만든다.

### 에이전트 구성

| 스킬 | 에이전트 | 모델 | 역할 |
|------|---------|------|------|
| `/plan` | planner | opus | 코드 분석 → `docs/tasks/<work>/` ledger 계획서 작성 + 규모 판단(fix/develop 분기) |
| `/develop` | developer | opus | 계획서 기반 대규모 구현 (DB 마이그레이션 → Electron → IPC → Frontend 순) |
| `/fix` | fixer | opus | 계획서 기반 소규모 수정 + 자체 검증 |
| `/test` | tester | sonnet | 빌드/타입/린트/테스트 검증 + 명백한 오류 자동 수정 |
| `/review` | reviewer | opus | 코드 리뷰 → PR 생성 |

### 하네스 관리
모든 에이전트는 작업 완료 시 `docs/harness/`를 갱신할 책임이 있다.
하네스는 프로젝트의 단일 진실 원천(Single Source of Truth)이다.

### 사용자 개입 지점
1. `/plan` 계획서 승인/수정 (규모 판단이 애매하면 planner가 먼저 질의)
2. `/review` PR merge 판단

### 전체 흐름
```
Idea (리서치/토의)
    → backlog 등록
    → /plan (planner 설계·규모 판단)
    → /develop (developer) 또는 /fix (fixer) 구현
    → /test (tester 검증)
    → /review (reviewer 리뷰 + PR)
```
사용자가 "이거 구현하자"라고 하기 전까지는 아이디어 토의 단계. 구현 결정 후 `/plan`부터 시작한다.

### 참조 문서
- 기능 하네스 (최우선): `docs/harness/` — 전체 기능 명세, 현재 상태, 데이터 흐름
  - `main/` — 에이전트 필수 읽기 (overview, flows, feature-status)
  - `detail/` — 작업 대상 영역별 상세
- 아이디어/백로그: `docs/backlog/`
- 문서 진입점: `docs/README.md` (전체 지도)
- 작업 계획·추적: `docs/tasks/<work>/` ledger (운영 가이드: `docs/tasks/README.md`)
- 완료·레거시 보관: `docs/archive/` (구 `features/`·`01-Idea`·`ROADMAP` 등; 현행 상태는 `docs/harness/main/feature-status.md`)
- 에이전트 정의: `.claude/agents/`
- 스킬 정의: `.claude/skills/`

## Commands

### Frontend (`frontend/`)
```bash
npm run dev          # Vite dev server (HMR)
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm run test         # vitest
npm run test:ui      # vitest --ui
```

### Desktop / Electron (`apps/desktop/`)
```bash
npm run start:electron   # electron electron/main.mjs
npm run dev              # vite (renderer dev server)
npm run build            # tsc --noEmit && vite build
```

### Supabase
```bash
docker exec supabase_db_Supabase_Redou psql -U postgres
# Migrations: supabase/migrations/
```

### Electron 문법 체크
```bash
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/pdf-heuristics.mjs
node --check apps/desktop/electron/ocr-extraction.mjs
```

## Architecture

### 모노레포 레이아웃
```
frontend/          → React 19 + Vite 6 + TailwindCSS v4 + TanStack Query + Zustand
apps/desktop/      → Electron 35 main process (ESM .mjs)
apps/ocr-server/   → OCR microservice (Python, Docker)
supabase/          → Local Supabase config, migrations, seed
docs/              → 프로젝트 구조, 기능 계획서, 설계 문서
.claude/           → 스킬, 에이전트, 훅 설정
```

### Electron main process (`apps/desktop/electron/`)
- **main.mjs** — 앱 라이프사이클, IPC 핸들러, PDF 파이프라인 오케스트레이션, `CURRENT_EXTRACTION_VERSION` 관리
- **pdf-heuristics.mjs** — PDF 분석: figure/table/equation 감지, 캡션 파싱, 섹션 헤딩 추출
- **ocr-extraction.mjs** — GLM-OCR (table→HTML, equation→LaTeX) + UniMERNet (equation LaTeX)
- **mineru-client.mjs** — MinerU API: PDF→마크다운+구조화 JSON
- **grobid-client.mjs** — GROBID: PDF→TEI XML (메타데이터+참고문헌)
- **llm-chat.mjs** — Ollama LLM 스트리밍 채팅 + Granite Guardian 검증
- **llm-orchestrator.mjs** — 채팅 오케스트레이터: 의도 분석→RAG→테이블 생성
- **embedding-worker.mjs** — 임베딩 생성 (@xenova/transformers)
- **preload.mjs** — Context bridge (IPC → 렌더러)

### Frontend (`frontend/src/`)
- **features/** — 도메인 모듈: `paper/`, `search/`, `figures/`, `chat/`, `notes/`, `import/`, `processing/`, `settings/`
- **stores/** — Zustand: `uiStore.ts` (UI 상태), `chatStore.ts` (채팅 스트리밍)
- **lib/** — TanStack Query 훅 (`queries.ts`, `chatQueries.ts`), Supabase DAL (`supabasePaperRepository.ts`)
- **components/** — 공용 UI: IconButton, Tag, StatusBadge, ConfirmDialog, LatexText, Tooltip
- **styles/tokens.css** — CSS 디자인 토큰

### Processing Pipeline
1. PDF import → pdfjs 텍스트 추출 → 섹션 헤딩 감지
2. Figure/table/equation 휴리스틱 감지 (pdf-heuristics.mjs)
3. MinerU 구조화 파싱 / GROBID 메타데이터 추출
4. OCR 보강: GLM-OCR + UniMERNet
5. 임베딩 생성 (chunks + highlights) → pgvector

### Database
- Local Supabase + pgvector
- 핵심 테이블: `papers`, `paper_chunks`, `chunk_embeddings`, `figures` (item_type: figure/table/equation), `highlights`, `highlight_embeddings`, `notes`, `folders`, `chat_conversations`, `chat_messages`, `chat_generated_tables`

### 외부 서비스
| 서비스 | 포트 | 용도 |
|--------|------|------|
| Supabase | 55321 | PostgreSQL + pgvector |
| Ollama | 11434 | OCR, LLM 채팅, Guardian |
| MinerU | 8001 | PDF 구조화 변환 |
| UniMERNet | 8010 | 수식→LaTeX |
| GROBID | 8070 | 메타데이터+참고문헌 |

## 행동 원칙 (Karpathy Guidelines)

- **코딩 전 가정 명시**: 불확실하면 먼저 질문. 여러 해석이 있으면 제시하고 선택 요청.
- **단순성 우선**: 요청된 것만 최소 코드로 해결. 요청하지 않은 기능·추상화·유연성 추가 금지.
- **수술적 변경**: 요청된 부분만 수정. 관련 없는 코드·주석·포맷 건드리지 않음. 내 변경으로 생긴 dead code만 제거.
- **검증 기준 선정**: 작업 전 성공 기준 먼저 정의. 다단계 작업은 단계별 검증 포인트 명시.
- **데이터 기반 제안**: 개선 계획을 제안할 때는 이론이 아닌 실제 DB/로그/코드에서 확인된 근거를 먼저 제시한다. "이럴 것 같다"가 아닌 "이 데이터에서 이런 케이스가 X건 확인됨"처럼 수치나 증거를 포함해야 한다. 확인 전에는 "확인이 필요하다"고 명시한다.

## 절대 규칙 (위반 금지)

- **Codex를 사용하지 않는다.** 구현·검증·리뷰 전부 Claude 서브에이전트가 담당한다. `codex:rescue`·`codex-companion` 등을 호출하거나 "codex로 진행"이라고 안내하지 않는다. 구현 안내는 항상 `/fix`(소규모)·`/develop`(대규모).
- **구현은 전용 서브에이전트(`developer`/`fixer`)를 통한다.** 메인 Claude의 1차 역할은 오케스트레이션이며, 정말 사소한 단발 수정이 아니면 직접 구현하지 않고 `/develop`·`/fix`에 위임한다.
- **`/fix`·`/develop`는 ledger(계획서)가 선행해야 실행된다.** `planner`가 작성한 `docs/tasks/<work>/` 계획서 없이 구현 에이전트를 돌리지 않는다. 단, **로직·동작이 바뀌지 않는 사소한 수정(오타·로그·포맷·주석·미사용 import)**은 ledger 없이 메인 Claude가 직접 처리하고 git 커밋만 남긴다 — 동작이 바뀌면 작아도 ledger.
- **대규모 변경은 반드시 `/plan`이 선행해야 한다.** 계획서 없이 `/develop`에 대규모 구현을 위임하지 않는다.
- **워크플로우 단계를 건너뛰지 않는다.** `/plan` 없이 대규모 구현 금지, `/test` 없이 `/review` 금지.
- **에이전트가 중단/실패해도 워크플로우를 깨지 않는다.** 해당 스킬을 재호출하거나 사용자에게 보고한다.

## Conventions

- Electron 모듈은 ESM (`.mjs`). `import`/`export` 사용, `require` 금지.
- Frontend 경로 별칭: `@/` → `frontend/src/`.
- IPC 채널은 `electron/types/ipc-channels.mjs`에서 중앙 관리.
- 추출 로직 변경 시 `CURRENT_EXTRACTION_VERSION` (main.mjs) 반드시 증가.
- DB 테이블 추가 시 `main.mjs`의 `DB_QUERY_TABLES`/`DB_MUTATE_TABLES` 화이트리스트 갱신.
- 동작이 바뀌는 수정·기능은 `/plan`을 먼저 거쳐 `docs/tasks/<work>/` ledger에 계획서 작성 후 진행한다. 로직이 바뀌지 않는 사소한 수정(오타·로그·포맷·주석·미사용 import)은 예외로 git 커밋만 남긴다 (ledger 운영: `docs/tasks/README.md`).
- 기능 추가/수정 시 `docs/harness/` 관련 파일도 함께 갱신. 하네스가 코드와 괴리되면 안 됨.
- **파일 길이**: 문서는 한 파일 **~500줄 상한**(300줄 넘으면 분할 검토 → 인덱스+링크로 쪼갠다), 진입점·README류는 **~150줄**. `docs/harness/`는 **'현재 상태'만** 담고 작업 과정·이력(tracer bullet 류)은 ledger·git에 둔다(과정 로그 누적 금지). 코드 모듈 비대화는 ADR 0002(module ownership)를 따른다.
- 사용자 언어: 한국어. 한국어로 응답할 것.
