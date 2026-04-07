# Redou

논문 수집, 읽기, 주석, 시맨틱 검색, AI 기반 데이터 테이블 생성까지 하나의 데스크톱 앱에서 처리하는 연구자용 논문 관리 도구.

## Overview

Redou는 Electron 데스크톱 앱으로, PDF 논문을 임포트하면 텍스트/표/수식/그림을 자동 추출하고, 벡터 임베딩으로 시맨틱 검색을 지원하며, LLM 채팅을 통해 여러 논문의 데이터를 비교 테이블로 정리해줍니다.

### 핵심 기능

- **PDF 리더** — 연속 스크롤, 줌, 텍스트 선택, 하이라이트 프리셋
- **자동 추출 파이프라인** — PDF에서 텍스트, 표(HTML), 수식(LaTeX), 그림 자동 추출
- **시맨틱 검색** — pgvector 기반 벡터 유사도 검색 (논문, 청크, 하이라이트, 그림)
- **AI 채팅 & 테이블 생성** — 자연어로 요청하면 RAG + LLM이 여러 논문에서 비교 테이블 자동 생성
- **노트 워크스페이스** — 논문별 노트 작성, PDF 위치 연결, 편집기

## 전체 흐름

```
PDF 임포트
    │
    ▼
텍스트 추출 (pdfjs-dist)
    │
    ├─▶ 청크 분할 + 임베딩 생성 (all-MiniLM-L6-v2)
    │       → pgvector 저장 → 시맨틱 검색
    │
    ├─▶ 그림/표/수식 감지 (pdf-heuristics.mjs)
    │       → OCR 보강: GLM-OCR (표→HTML, 수식→LaTeX)
    │       → UniMERNet (수식→LaTeX)
    │       → MineRU (전체 PDF 파싱)
    │
    └─▶ GROBID (메타데이터 + 참고문헌 추출)

사용자 질문 ("zeolite kinetic 비교해줘")
    │
    ▼
Orchestrator (의도 분석 + 테이블 스펙 생성)
    │
    ▼
RAG 검색 (match_chunks + match_figures)
    │
    ▼
Table Agent (파싱된 매트릭스 + OCR HTML + 텍스트 → 테이블 생성)
    │
    ▼
Guardian 검증 (Granite Guardian — 셀별 근거 확인)
    │
    ▼
비교 테이블 + 참조 출력
```

## 프로젝트 구조

```
Redou/
├── frontend/                    # React 프론트엔드 (Vite + TailwindCSS v4)
│   ├── public/                  # 정적 파일 (파비콘 등)
│   └── src/
│       ├── app/                 # 앱 셸 (AppShell, LeftSidebar, TopBar, RightInspector)
│       ├── components/          # 공용 컴포넌트 (ConfirmDialog, LatexText, ProcessingBadge 등)
│       ├── features/
│       │   ├── auth/            # 인증 화면
│       │   ├── chat/            # AI 채팅 (ChatView, ChatInput, ChatPipelineStatus, ChatTableReport)
│       │   ├── figures/         # 그림/표/수식 갤러리
│       │   ├── import/          # PDF 임포트 다이얼로그
│       │   ├── library/         # 논문 라이브러리 (카드/리스트 뷰, 카테고리 트리)
│       │   ├── notes/           # 노트 워크스페이스
│       │   ├── paper/           # 논문 상세 + PDF 리더 (PdfReaderWorkspace)
│       │   ├── processing/      # 처리 작업 대시보드
│       │   ├── search/          # 시맨틱 검색 (SearchView, SearchSidebar)
│       │   └── settings/        # 설정
│       ├── lib/                 # 데이터 레이어 (queries.ts, supabasePaperRepository.ts, chatQueries.ts)
│       ├── stores/              # Zustand 스토어 (uiStore, chatStore)
│       ├── styles/              # CSS 디자인 토큰
│       └── types/               # TypeScript 타입 정의
│
├── apps/
│   ├── desktop/                 # Electron 메인 프로세스
│   │   └── electron/
│   │       ├── main.mjs             # 앱 라이프사이클, IPC, 추출 파이프라인, 채팅 파이프라인
│   │       ├── pdf-heuristics.mjs   # PDF 그림/표/수식 감지 (pdfjs operator list)
│   │       ├── ocr-extraction.mjs   # GLM-OCR + UniMERNet OCR 보강
│   │       ├── mineru-client.mjs    # MineRU PDF 파싱 클라이언트
│   │       ├── grobid-client.mjs    # GROBID 메타데이터/참고문헌 추출
│   │       ├── embedding-worker.mjs # all-MiniLM-L6-v2 임베딩 생성
│   │       ├── llm-orchestrator.mjs # LLM 에이전트 (Orchestrator, Table Agent)
│   │       ├── llm-chat.mjs         # Ollama 스트리밍 채팅 + Guardian 검증
│   │       ├── html-table-parser.mjs# OCR HTML 테이블 파서
│   │       ├── preload.mjs          # Context bridge (IPC 채널)
│   │       └── oauth-callback-server.mjs
│   │
│   └── ocr-server/              # OCR 마이크로서비스 (Docker)
│       ├── server.py            # UniMERNet API 서버
│       ├── Dockerfile           # GLM-OCR 컨테이너
│       ├── Dockerfile.mineru    # MineRU 컨테이너
│       └── docker-compose.yml
│
├── supabase/                    # 로컬 Supabase 설정
│   ├── config.toml
│   ├── seed.sql
│   └── migrations/              # DB 마이그레이션 (pgvector, RLS 등)
│
├── docs/                        # 설계 문서
├── plans/                       # 구현 계획 및 감사 보고서
└── prototypes/                  # HTML 디자인 프로토타입
```

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 데스크톱 | Electron 35 (ESM `.mjs`) |
| 프론트엔드 | React + Vite + TailwindCSS v4 + TanStack Query + Zustand |
| 데이터베이스 | Supabase (PostgreSQL + pgvector) — 로컬 Docker |
| PDF | pdfjs-dist 5.5 |
| 임베딩 | all-MiniLM-L6-v2 (@xenova/transformers) |
| LLM | Ollama — gpt-oss:120b (채팅/테이블), Granite Guardian 3.3 8b (검증) |
| OCR | GLM-OCR (Ollama), UniMERNet, MineRU |
| 메타데이터 | GROBID (참고문헌/저자 추출) |

## 실행 방법

### 1. Supabase 시작

```bash
supabase start
supabase status
```

### 2. 프론트엔드 빌드

```bash
cd frontend
npm install
npm run build
```

### 3. Electron 실행

```bash
cd apps/desktop
npm install
npm run start:electron
```

### 개발 모드 (HMR)

```bash
# 터미널 1: 프론트엔드 dev 서버
cd frontend
npm run dev -- --host 127.0.0.1 --port 4173

# 터미널 2: Electron
cd apps/desktop
npm run start:electron
```

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `REDOU_SUPABASE_URL` | `http://127.0.0.1:55321` | Supabase API URL |
| `REDOU_SUPABASE_SERVICE_KEY` | (필수) | Supabase service_role 키 |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API URL |
| `REDOU_LLM_MODEL` | `gpt-oss:120b` | 채팅/테이블 생성 모델 |
| `REDOU_GUARDIAN_MODEL` | `granite3-guardian:8b` | 검증 모델 |
