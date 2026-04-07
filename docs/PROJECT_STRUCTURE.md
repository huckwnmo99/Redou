# Redou V2 — 프로젝트 구조 가이드

> 이 문서는 프로젝트를 처음 접하거나 기능을 추가/수정할 때 빠르게 참조하기 위한 구조 맵입니다.  
> 최종 갱신: 2026-04-05

---

## 1. 전체 모노레포 레이아웃

```
V2/
├── frontend/              # React SPA (Vite + TailwindCSS v4)
├── apps/
│   ├── desktop/           # Electron 35 메인 프로세스 + 데스크탑 렌더러 (ESM .mjs)
│   └── ocr-server/        # OCR 마이크로서비스 (Python, Docker)
├── supabase/              # 로컬 Supabase 설정 + DB 마이그레이션
├── docs/                  # 설계 문서, DB 스키마 초안, 기획 문서
├── plans/                 # 기능 구현 계획서 (chat-feature, pipeline-audit 등)
├── prototypes/            # UI 프로토타입/디자인 옵션
├── CLAUDE.md              # AI 개발 에이전트 지침
├── AGENTS.md              # 에이전트 상세 가이드
└── README.md              # 프로젝트 소개
```

---

## 2. Frontend (`frontend/`)

### 기술 스택
| 영역 | 기술 |
|------|------|
| UI 프레임워크 | React 19, TypeScript 5.7 |
| 빌드 | Vite 6, `@tailwindcss/vite` |
| 스타일링 | TailwindCSS v4, CSS custom properties (`tokens.css`) |
| 상태관리 | Zustand 5 (UI), TanStack Query 5 (서버 상태) |
| PDF 렌더링 | pdfjs-dist 5.5 |
| 수식 렌더링 | KaTeX 0.16 |
| 마크다운 | react-markdown + remark-gfm |
| 폼 | react-hook-form + zod |
| 아이콘 | lucide-react |
| DB 클라이언트 | @supabase/supabase-js |

### 디렉토리 구조

```
frontend/src/
├── App.tsx                    # 루트: 인증 분기 (AuthView ↔ AppShell)
├── main.tsx                   # React 엔트리포인트
├── polyfills.ts               # pdfjs Chromium 134 폴리필
├── pdf-worker.ts              # PDF.js 웹 워커
│
├── app/                       # 앱 레이아웃 쉘
│   ├── AppShell.tsx           #   메인 레이아웃 (사이드바 + 콘텐츠 + 인스펙터)
│   ├── LeftSidebar.tsx        #   좌측 네비게이션 사이드바
│   ├── TopBar.tsx             #   상단 바 (검색, 뷰 전환)
│   └── RightInspector.tsx     #   하단 인스펙터 패널
│
├── features/                  # 도메인별 기능 모듈
│   ├── auth/                  #   Google OAuth 인증
│   │   └── AuthView.tsx
│   ├── library/               #   논문 라이브러리 (그리드/리스트 뷰)
│   │   ├── LibraryView.tsx    #     메인 라이브러리 화면
│   │   ├── PaperCard.tsx      #     그리드 카드
│   │   ├── PaperListItem.tsx  #     리스트 아이템
│   │   ├── CategoryTree.tsx   #     폴더 트리
│   │   └── drag.ts            #     드래그&드롭 유틸
│   ├── paper/                 #   논문 상세 뷰
│   │   ├── PaperDetailView.tsx#     상세 탭 (overview/pdf/notes/figures/...)
│   │   └── PdfReaderWorkspace.tsx # PDF 리더 (연속 스크롤, 하이라이트, 줌)
│   ├── search/                #   시맨틱 검색
│   │   ├── SearchView.tsx     #     검색 결과 화면
│   │   ├── SearchSidebar.tsx  #     검색 필터 사이드바
│   │   └── searchModel.ts    #     검색 로직/모델
│   ├── figures/               #   Figure/Table/Equation 갤러리
│   │   └── FiguresView.tsx
│   ├── chat/                  #   LLM 채팅 (연구 데이터 비교 테이블 생성)
│   │   ├── ChatView.tsx       #     채팅 메인 화면
│   │   ├── ChatInput.tsx      #     메시지 입력
│   │   ├── ChatMessageList.tsx#     메시지 목록
│   │   ├── ChatSidebar.tsx    #     대화 목록 사이드바
│   │   ├── ChatTableReport.tsx#     생성된 테이블 렌더링
│   │   └── ChatPipelineStatus.tsx # 파이프라인 상태 표시
│   ├── notes/                 #   노트 워크스페이스
│   │   ├── NotesView.tsx
│   │   └── notePresentation.ts
│   ├── import/                #   PDF 임포트 다이얼로그
│   │   └── ImportPdfDialog.tsx
│   ├── processing/            #   프로세싱 작업 모니터링
│   │   └── ProcessingView.tsx
│   └── settings/              #   설정
│       └── SettingsView.tsx
│
├── components/                # 공용 UI 컴포넌트
│   ├── ConfirmDialog.tsx      #   비동기 Promise 기반 확인 다이얼로그
│   ├── ErrorBoundary.tsx      #   에러 바운더리
│   ├── IconButton.tsx         #   아이콘 버튼
│   ├── LatexText.tsx          #   KaTeX 수식 렌더링
│   ├── ProcessingBadge.tsx    #   프로세싱 상태 뱃지
│   ├── StatusBadge.tsx        #   읽기 상태 뱃지
│   ├── Tag.tsx                #   태그
│   └── Tooltip.tsx            #   툴팁
│
├── stores/                    # Zustand 상태 저장소
│   ├── uiStore.ts             #   UI 전역 상태 (선택된 논문, 네비게이션, 필터 등)
│   └── chatStore.ts           #   채팅 스트리밍 상태
│
├── lib/                       # 유틸/인프라 계층
│   ├── queries.ts             #   TanStack Query 훅 (모든 DB 조회/뮤테이션)
│   ├── chatQueries.ts         #   채팅 관련 쿼리 훅
│   ├── supabasePaperRepository.ts # Supabase 데이터 접근 계층
│   ├── supabaseAuthRepository.ts  # 인증 데이터 접근
│   ├── supabase.ts            #   Supabase 클라이언트 초기화
│   ├── auth.ts                #   인증 세션 관리
│   ├── desktop.ts             #   Electron IPC 브릿지
│   ├── locale.ts              #   다국어(한/영) 유틸
│   └── queryClient.ts         #   TanStack Query 클라이언트 설정
│
├── types/                     # TypeScript 타입 정의
│   ├── paper.ts               #   Paper, Figure, Note, Highlight 등 핵심 도메인 타입
│   ├── chat.ts                #   ChatConversation, ChatMessage, ChatGeneratedTable
│   ├── auth.ts                #   인증 관련 타입
│   └── desktop.ts             #   Electron API 타입
│
├── mock/                      # 목 데이터 (개발용)
│   ├── papers.ts, folders.ts, notes.ts
│   └── repository/            #   목 리포지토리
│
└── styles/
    └── tokens.css             # 디자인 토큰 (CSS 커스텀 프로퍼티)
```

### 화면 네비게이션 구조 (NavItem)

```
library   → LibraryView / PaperDetailView (상세 열림 시)
search    → SearchView (시맨틱 검색)
figures   → FiguresView (Figure/Table/Equation 갤러리)
chat      → ChatView (LLM 연구 비교 테이블)
notes     → NotesView (노트 워크스페이스)
processing→ ProcessingView (처리 작업 큐)
settings  → SettingsView
```

---

## 3. Electron Main Process (`apps/desktop/electron/`)

### 모듈 구성

| 파일 | 역할 |
|------|------|
| `main.mjs` | 앱 라이프사이클, IPC 핸들러, PDF 임포트 파이프라인 오케스트레이션, 추출 버전 관리 (`CURRENT_EXTRACTION_VERSION = 23`) |
| `pdf-heuristics.mjs` | PDF 분석: figure/table/equation 감지 (pdfjs operator list), 캡션 파싱, 페이지 크롭, 섹션 헤딩 추출. 전략: `extractViaPageCrop`(기본) / `extractViaJpegScan`(JPEG 폴백) |
| `ocr-extraction.mjs` | GLM-OCR (Ollama:11434) table→HTML, equation→LaTeX; UniMERNet(:8010) equation LaTeX |
| `mineru-client.mjs` | MinerU API(:8001) — PDF→마크다운+구조화 JSON+이미지 변환 |
| `grobid-client.mjs` | GROBID(:8070) — PDF→TEI XML→메타데이터+참고문헌 구조화 |
| `llm-chat.mjs` | Ollama LLM (gpt-oss:120b) 스트리밍 채팅, JSON 테이블 생성, Granite Guardian 검증 |
| `llm-orchestrator.mjs` | 채팅 오케스트레이터: 의도 분석 → RAG 쿼리 생성 → 테이블 스펙 정의 → 데이터 추출 |
| `html-table-parser.mjs` | HTML 테이블 파서 |
| `embedding-worker.mjs` | all-MiniLM-L6-v2 (384-dim) → 업그레이드 2048-dim via @xenova/transformers |
| `oauth-callback-server.mjs` | Google OAuth 콜백 서버 |
| `preload.mjs` | Context bridge (IPC 채널 → 렌더러 노출) |
| `types/ipc-channels.mjs` | IPC 채널 이름 정의 (CHANNELS: renderer→main, EVENTS: main→renderer) |

### PDF 처리 파이프라인 흐름

```
PDF Import
  ├── 1. pdfjs 텍스트 추출 + 섹션 헤딩 감지
  ├── 2. 휴리스틱 Figure/Table/Equation 감지 (pdf-heuristics.mjs)
  ├── 3. MinerU 구조화 파싱 (가능 시) OR GROBID 메타데이터 추출
  ├── 4. OCR 보강: GLM-OCR (table HTML, equation LaTeX) + UniMERNet (equation LaTeX from crops)
  ├── 5. 임베딩 생성 (chunks + highlights) → pgvector
  └── 6. GROBID 참고문헌 → 기존 논문 링크
```

### IPC 통신 구조

```
Renderer → Main (ipcRenderer.invoke → ipcMain.handle)
  DB_QUERY, DB_MUTATE, FILE_IMPORT_PDF, EMBEDDING_GENERATE_QUERY,
  CHAT_SEND_MESSAGE, CHAT_ABORT, CHAT_EXPORT_CSV, ...

Main → Renderer (webContents.send)
  JOB_PROGRESS, JOB_COMPLETED, JOB_FAILED,
  CHAT_TOKEN, CHAT_COMPLETE, CHAT_ERROR, ...
```

---

## 4. 외부 서비스 의존성

| 서비스 | 포트 | 용도 |
|--------|------|------|
| Supabase (Docker) | 55321 | PostgreSQL + pgvector, Auth, Storage |
| Ollama | 11434 | GLM-OCR (table/equation), LLM 채팅 (gpt-oss:120b), Guardian (granite3-guardian:8b) |
| MinerU | 8001 | PDF→구조화 데이터 변환 |
| UniMERNet | 8010 | 수식 이미지→LaTeX 변환 |
| GROBID | 8070 | PDF→TEI XML (메타데이터+참고문헌) |
| OCR Server (앱 내장) | — | Python OCR 마이크로서비스 (Docker) |

---

## 5. Database (Supabase + pgvector)

### 핵심 테이블

| 테이블 | 설명 |
|--------|------|
| `app_users` | 사용자 계정 |
| `papers` | 논문 메타데이터 (title, year, doi, abstract, reading_status, ...) |
| `paper_files` | PDF 파일 저장 정보 (경로, 체크섬, 사이즈) |
| `paper_sections` | 논문 섹션 (heading, page range, raw text) |
| `paper_chunks` | 텍스트 청크 (임베딩 단위) |
| `chunk_embeddings` | 청크 임베딩 벡터 (pgvector) |
| `figures` | Figure/Table/Equation (`item_type` 구분) |
| `figure_chunk_links` | Figure↔Chunk 연결 |
| `folders` | 사용자 폴더 (트리 구조) |
| `paper_folders` | 논문↔폴더 N:M 매핑 |
| `tags` / `paper_tags` | 태그 시스템 |
| `highlight_presets` | 하이라이트 색상 프리셋 |
| `highlights` | PDF 하이라이트 |
| `highlight_embeddings` | 하이라이트 임베딩 |
| `notes` | 연구 노트 (scope: paper/section/chunk/figure/highlight) |
| `paper_summaries` | 논문 자동 요약 |
| `paper_references` | 참고문헌 (GROBID 추출) |
| `processing_jobs` | PDF 처리 작업 큐 |
| `backup_snapshots` | DB 백업 스냅샷 |
| `user_workspace_preferences` | 사용자 레이아웃 설정 |
| `chat_conversations` | 채팅 대화 |
| `chat_messages` | 채팅 메시지 |
| `chat_generated_tables` | LLM 생성 비교 테이블 |

### 마이그레이션 히스토리

```
supabase/migrations/
├── 20260309050635_initial_schema.sql          # 초기 19개 테이블
├── 20260311010000_add_embedding_search.sql     # 임베딩 검색 RPC
├── 20260312010000_add_figure_item_type.sql     # figures에 item_type 추가
├── 20260312020000_add_extraction_version.sql   # extraction_version 컬럼
├── 20260321010000_fix_trashed_by_fk.sql        # FK 수정
├── 20260321020000_add_toggle_star_rpc.sql      # 즐겨찾기 토글 RPC
├── 20260321030000_add_performance_indexes.sql  # 성능 인덱스
├── 20260321040000_enable_rls_all_tables.sql    # RLS 전체 활성화
├── 20260321050000_add_highlight_embeddings.sql # 하이라이트 임베딩
├── 20260324010000_add_authors_column.sql       # authors JSONB 컬럼
├── 20260325010000_pipeline_v2_schema.sql       # 파이프라인 v2
├── 20260325020000_match_chunks_section_boost.sql # 섹션 부스트 검색
├── 20260326010000_upgrade_embeddings_1024.sql  # 1024-dim 업그레이드
├── 20260327010000_upgrade_embeddings_vl_2048.sql # 2048-dim 업그레이드
└── 20260328010000_add_chat_tables.sql          # 채팅 기능 테이블
```

---

## 6. 주요 개발 패턴 & 컨벤션

### 파일 & 모듈
- Electron 모듈: ESM (`.mjs`), `import`/`export` 사용 (require 금지)
- Frontend 경로 별칭: `@/` → `frontend/src/`
- IPC 채널 이름: `types/ipc-channels.mjs`에서 중앙 관리

### 상태 관리
- **UI 상태** → Zustand (`uiStore.ts`, `chatStore.ts`)
- **서버 상태** → TanStack Query (`queries.ts`, `chatQueries.ts`)
- **쿼리 키** → `paperKeys`, `noteKeys`, `highlightKeys` 등으로 구조화

### 데이터 접근
- 프론트엔드: `supabasePaperRepository.ts` (DAL) → TanStack Query 훅으로 감싸서 사용
- Electron: `supabase` 클라이언트 (service_role key, RLS bypass)
- DB 직접 쿼리는 IPC `DB_QUERY`/`DB_MUTATE` 채널 경유

### PDF 리더
- pdfjs-dist 5.5, Chromium 134 폴리필
- 연속 스크롤 + IntersectionObserver 레이지 렌더링
- z-index: canvas(0) → highlight(1) → text(2) → memo(3)
- Ctrl+마우스휠 / Ctrl+±: 줌

### 버전 관리
- `CURRENT_EXTRACTION_VERSION` (main.mjs): 추출 로직 변경 시 증가 → 기존 논문 자동 재처리

---

## 7. 기능을 추가/수정할 때의 체크리스트

### 새 기능 (Feature) 추가 시
1. `frontend/src/features/{feature-name}/` 디렉토리 생성
2. 뷰 컴포넌트 작성 → `AppShell.tsx`의 `MainContent` switch에 등록
3. `NavItem` 타입에 추가 (`types/paper.ts`)
4. `LeftSidebar.tsx`에 네비게이션 아이템 추가
5. 필요 시 Zustand store 확장 또는 새 store 생성
6. DB 필요 시 마이그레이션 SQL 작성 (`supabase/migrations/`)
7. IPC 채널 필요 시 `ipc-channels.mjs`에 정의 + `main.mjs`에 핸들러 등록

### DB 스키마 변경 시
1. `supabase/migrations/` 에 타임스탬프 기반 SQL 파일 추가
2. `main.mjs`의 `DB_QUERY_TABLES` / `DB_MUTATE_TABLES` 화이트리스트 갱신
3. 프론트엔드 타입 (`types/`) 갱신

### PDF 추출 로직 변경 시
1. `pdf-heuristics.mjs` 또는 `ocr-extraction.mjs` 수정
2. `CURRENT_EXTRACTION_VERSION` 증가 (main.mjs)
3. 기존 논문은 앱 시작 시 자동 재처리됨

### IPC 채널 추가 시
1. `types/ipc-channels.mjs`에 채널 이름 정의
2. `main.mjs`에 `ipcMain.handle()` 핸들러 등록
3. `preload.mjs`에 context bridge 노출
4. 프론트엔드 `lib/desktop.ts`에 호출 래퍼 추가

---

## 8. 실행 환경 구성

### 필수 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `REDOU_SUPABASE_URL` | `http://127.0.0.1:55321` | Supabase URL |
| `REDOU_SUPABASE_SERVICE_KEY` | — | Service role key (Electron main) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API |
| `REDOU_LLM_MODEL` | `gpt-oss:120b` | 채팅 LLM 모델 |
| `REDOU_GUARDIAN_MODEL` | `granite3-guardian:8b` | 검증 모델 |
| `REDOU_MINERU_URL` | `http://localhost:8001` | MinerU API |
| `REDOU_GROBID_URL` | `http://localhost:8070` | GROBID API |
| `REDOU_RENDERER_URL` | `http://127.0.0.1:4173` | 프론트엔드 URL |

### 개발 서버 시작

```bash
# 1. Supabase (Docker)
supabase start

# 2. 프론트엔드 (HMR)
cd frontend && npm run dev

# 3. Electron
cd apps/desktop && npm run start:electron
```

---

## 9. 파일 저장 구조

```
~/Documents/Redou/Library/
├── {paper-uuid}/
│   ├── original.pdf          # 원본 PDF
│   ├── figures/              # 추출된 이미지
│   │   ├── fig-1.png
│   │   ├── table-2.png
│   │   └── eq-3.png
│   └── mineru/               # MinerU 파싱 결과 (해당 시)
```
