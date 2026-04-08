# CLAUDE.md

## Project Overview

Redou는 연구 논문 읽기 & 관리 데스크탑 앱이다. Electron이 React 프론트엔드를 호스팅하고, 로컬 Supabase(Docker)와 통신한다. PDF로 논문을 임포트하면 자동 처리(텍스트 추출, figure/table/equation 감지, 임베딩)를 거쳐 PDF 리더, 노트, 시맨틱 검색으로 제공한다.

## Development Workflow

### 새 기능 추가

```
/plan → (승인) → /develop → /test → /review → (PR merge)
```

### 수정 (버그, UI 조정, 타입 오류)

```
/plan → (planner가 규모 판단)
  ├─ 소규모 → /fix → /review → (PR merge)
  └─ 대규모 → (사용자 허가) → /develop → /test → /review → (PR merge)
```
모든 수정은 `/plan`을 먼저 거친다. planner가 `docs/features/fix/{이름}.md`를 작성하고 경로를 안내한다.

### 에이전트 구성

| 스킬 | 에이전트 | 모델 | 역할 |
|------|----------|------|------|
| `/plan` | planner | opus | 기능 분석 → `docs/features/new/` 또는 `docs/features/fix/` 계획서 작성 |
| `/develop` | developer | sonnet (기본), opus (복잡한 구현 시 사용자 허가 후) | 계획서 기반 코드 구현 |
| `/test` | tester | sonnet | 빌드/타입/린트/테스트 검증 + 자동 수정 |
| `/review` | reviewer | opus | Codex + Claude 이중 리뷰 → PR 생성 |
| `/fix` | fixer | opus | 소규모 수정: 원인 파악 → 수정 → 자체 검증 |

### 사용자 개입 지점
1. `/plan` 계획서 승인/수정
2. `/review` PR merge 판단

### 전체 흐름
```
Idea (리서치/토의) → backlog (할 일 등록) → /plan (계획서 작성) → /develop or /fix → /test → /review
```
사용자가 "이거 구현하자"라고 하기 전까지는 아이디어 토의 단계. 구현 결정 후 `/plan`부터 시작.

### 참조 문서
- 로드맵: `docs/ROADMAP.md`
- 아이디어/백로그: `docs/backlog/`
- 리서치/제안서: `docs/01-Idea/`
- 기능 계획서: `docs/features/new/`, 수정 계획서: `docs/features/fix/`
- 프로젝트 구조: `docs/PROJECT_STRUCTURE.md`
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

## 절대 규칙 (위반 금지)

- **메인 에이전트는 코드를 직접 수정하지 않는다.** 모든 코드 변경(Edit, Write)은 반드시 서브에이전트(`/plan`, `/develop`, `/fix`, `/test`, `/review`)를 통해서만 수행한다.
- **서브에이전트가 중단/실패해도 메인 에이전트가 대신 작업하지 않는다.** 새 서브에이전트를 띄워서 이어서 진행한다.
- **워크플로우 단계를 건너뛰지 않는다.** `/plan` 없이 `/develop` 금지, `/test` 없이 `/review` 금지.
- 메인 에이전트의 역할은 **오케스트레이션**(서브에이전트 호출, 사용자와 소통, 상태 확인)에 한정한다.

## Conventions

- Electron 모듈은 ESM (`.mjs`). `import`/`export` 사용, `require` 금지.
- Frontend 경로 별칭: `@/` → `frontend/src/`.
- IPC 채널은 `electron/types/ipc-channels.mjs`에서 중앙 관리.
- 추출 로직 변경 시 `CURRENT_EXTRACTION_VERSION` (main.mjs) 반드시 증가.
- DB 테이블 추가 시 `main.mjs`의 `DB_QUERY_TABLES`/`DB_MUTATE_TABLES` 화이트리스트 갱신.
- 모든 작업(기능/수정)은 `/plan`을 먼저 거쳐 `docs/features/new/` 또는 `docs/features/fix/`에 계획서 작성 후 진행.
- 사용자 언어: 한국어. 한국어로 응답할 것.
