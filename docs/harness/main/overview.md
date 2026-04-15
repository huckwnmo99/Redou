# Redou 전체 개요
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 앱 정체성

Redou(Research Document Understanding)는 연구 논문 관리 + AI 분석 데스크탑 앱이다. PDF 임포트 시 자동으로 텍스트/테이블/수식/그림을 추출하고, 시맨틱 검색과 LLM 기반 비교 테이블 생성/Q&A를 제공한다. 모든 데이터는 로컬(Docker Supabase + pgvector)에 저장된다.

## 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | React 19, TypeScript 5.7, Vite 6, TailwindCSS v4, TanStack Query 5, Zustand 5 |
| 데스크탑 | Electron 35 (ESM .mjs) |
| 데이터베이스 | PostgreSQL + pgvector (Supabase Docker, port 55321) |
| 임베딩 | nvidia/llama-nemotron-embed-vl-1b-v2 (2048-dim, vLLM port 8100) |
| LLM | Ollama (user-selectable model, default gpt-oss:120b, port 11434) |
| 검증 | Granite Guardian 3.3 8B (groundedness check) |
| Reranker | Xenova/bge-reranker-base (ONNX, CPU, @xenova/transformers) |
| PDF 파싱 | pdfjs-dist 5.5, MinerU (port 8001), GROBID (port 8070) |
| OCR | GLM-OCR (Ollama), UniMERNet (port 8010) |

## 모노레포 레이아웃

```
V2/
├── frontend/              # React SPA
├── apps/
│   ├── desktop/electron/  # Electron main process (12개 .mjs 모듈)
│   └── ocr-server/        # Python OCR 마이크로서비스 (Docker)
├── supabase/migrations/   # 20개 마이그레이션 SQL
└── docs/                  # 설계 문서, 계획서, 하네스
```

## 외부 서비스 의존성

| 서비스 | 포트 | 용도 | health check |
|--------|------|------|-------------|
| Supabase | 55321 | PostgreSQL + pgvector, Auth | `psql` 접속 |
| vLLM | 8100 | 임베딩 생성 (VL 모델) | `GET /health` |
| Ollama | 11434 | LLM 채팅, GLM-OCR, Guardian | `GET /api/tags` |
| MinerU | 8001 | PDF 구조화 변환 | `GET /predict` (with timeout) |
| UniMERNet | 8010 | 수식 이미지 → LaTeX | `POST /predict` |
| GROBID | 8070 | PDF → TEI XML (메타데이터+참고문헌) | `GET /api/isalive` |

## 핵심 개념 용어집

| 용어 | 설명 |
|------|------|
| `CURRENT_EXTRACTION_VERSION` | main.mjs 상수 (현재 24). 추출 로직 변경 시 증가 → 기존 논문 자동 재처리 |
| Pipeline V1 | pdfjs 휴리스틱 + GLM-OCR + UniMERNet |
| Pipeline V2 | MinerU + GROBID (가용 시) + OCR 폴백 |
| RAG | Retrieval-Augmented Generation. 벡터+BM25 하이브리드 검색 → LLM 컨텍스트 |
| RRF | Reciprocal Rank Fusion. 벡터/BM25 결과를 가중합으로 병합 |
| SRAG | Structured RAG. 논문별 독립 추출 → 코드 병합 (per-paper extraction) |
| Contextual Chunking | 청크 임베딩 시 `[Paper: X | Section: Y]` 접두어 추가 |
| Reranker | Cross-encoder(bge-reranker-base)로 RRF 결과 재정렬 |
| Guardian | Granite Guardian. 생성 테이블 수치의 groundedness 검증 |
| Table Agent | LLM이 RAG 컨텍스트에서 비교 테이블을 JSON으로 생성 |
| Orchestrator | 사용자 의도 분석 → 검색 쿼리/테이블 사양 설계 |
| Extraction Agent | 단일 논문 컨텍스트에서 column_definitions에 맞는 데이터 추출 |
