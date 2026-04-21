# 기능 상태 매트릭스
> 하네스 버전: v1.1 | 최종 갱신: 2026-04-18

## 전체 기능 매트릭스

| 기능 | 상태 | 관련 detail | 비고 |
|------|------|------------|------|
| PDF 임포트 + 파일 관리 | ✅ 구현됨 | electron/pdf-pipeline.md | V2 단일 (MinerU+GROBID). MinerU 필수, GROBID 선택(degraded mode) |
| 텍스트 추출 + 섹션/청킹 | ✅ 구현됨 | electron/pdf-pipeline.md | MinerU |
| Figure/Table/Equation 감지 | ✅ 구현됨 | electron/pdf-pipeline.md | MinerU |
| 테이블 OCR (HTML) | ✅ 구현됨 | electron/pdf-pipeline.md | GLM-OCR (빈 테이블 보강용, V2 후속 스테이지) |
| 수식 OCR (LaTeX) | ✅ 구현됨 | electron/pdf-pipeline.md | MinerU 기본 LaTeX (UniMERNet/GLM-OCR 수식 보강 제거됨 — 옵션 A) |
| 메타데이터 추출 (GROBID) | ✅ 구현됨 | electron/pdf-pipeline.md | 제목, 저자, DOI, 참고문헌 |
| 시맨틱 임베딩 (2048-dim VL) | ✅ 구현됨 | electron/embedding.md | nvidia/llama-nemotron-embed-vl-1b-v2 |
| Contextual Chunking | ✅ 구현됨 | electron/embedding.md | `[Paper: X \| Section: Y]` 접두어 |
| 이미지 임베딩 (VL) | ✅ 구현됨 | electron/embedding.md | Figure 이미지 + 캡션 |
| 시맨틱 검색 (벡터) | ✅ 구현됨 | frontend/search.md | match_chunks, match_papers, match_figures |
| Hybrid Search (BM25+Vector) | ✅ 구현됨 | electron/rag-pipeline.md, database/rpc.md | RRF 퓨전, 모드별 가중치 |
| Cross-encoder Reranker | ✅ 구현됨 | electron/rag-pipeline.md | bge-reranker-base, top-15/10 |
| 테이블 우선 검색 | ✅ 구현됨 | electron/rag-pipeline.md | TABLE_BOOST + backfill |
| LLM 채팅 (스트리밍) | ✅ 구현됨 | electron/llm.md | Ollama NDJSON |
| LLM 모델 선택 | ✅ 구현됨 | electron/llm.md, electron/main-process.md | Settings UI + IPC |
| Orchestrator (의도 분석) | ✅ 구현됨 | electron/llm.md | clarify/generate_table/modify_table |
| Table Agent (데이터 추출) | ✅ 구현됨 | electron/llm.md | JSON 스키마 강제 |
| SRAG Per-paper Extraction | ✅ 구현됨 | electron/llm.md | 논문별 독립 추출 → 코드 병합 |
| Guardian 검증 | ✅ 구현됨 | electron/llm.md | 샘플링 50셀, 비동기 |
| Q&A 파이프라인 | ✅ 구현됨 | electron/llm.md | 별도 모드, 출처 귀속 |
| Table/Q&A 서비스 분리 | ✅ 구현됨 | electron/llm.md | conversation_type 컬럼 + llm-qa.mjs |
| CSV 내보내기 | ✅ 구현됨 | electron/main-process.md | BOM + References 섹션 |
| PDF 리더 (연속 스크롤) | ✅ 구현됨 | frontend/paper.md | pdfjs, IntersectionObserver |
| 하이라이트 | ✅ 구현됨 | frontend/paper.md | 색상 프리셋, 임베딩 |
| 폴더 관리 | ✅ 구현됨 | frontend/paper.md | 트리 구조, 드래그&드롭 |
| Figure/Table/Equation 갤러리 | ✅ 구현됨 | frontend/paper.md | FiguresView.tsx |
| 노트 워크스페이스 | ✅ 구현됨 | frontend/notes.md | 7가지 note_type |
| 프로세싱 모니터링 | ✅ 구현됨 | frontend/paper.md | ProcessingView.tsx |
| Google OAuth 인증 | ✅ 구현됨 | electron/main-process.md | oauth-callback-server.mjs |
| 백업/복원 | ✅ 구현됨 | electron/main-process.md | BACKUP_CREATE/RESTORE |
| 다국어 (한/영) | ✅ 구현됨 | frontend/stores-queries.md | locale.ts |

## ROADMAP 진행 상태

| 단계 | 항목 | 상태 |
|------|------|------|
| 버그수정 | chat Supabase null 처리 | 📋 계획됨 |
| 버그수정 | 채팅 UI 텍스트 선택 + optimistic update | 📋 계획됨 |
| 버그수정 | BM25 검색 0건 반환 (websearch_to_tsquery AND 과다) | ✅ 완료 (OR tsquery로 변경) |
| 버그수정 | SRAG 통합 이슈 3건 (Orchestrator clarify 과다 / 한글 인코딩 / Guardian 검증) | 📋 계획됨 |
| Step 1 | LLM 모델 선택 | ✅ 완료 (코드 확인) |
| Step 1 | Table/Q&A 서비스 분리 | ✅ 완료 (llm-qa.mjs + conversation_type) |
| Step 2 | Hybrid Search (BM25+Vector) | ✅ 완료 (BM25 RPC + RRF) |
| Step 2 | Reranker | ✅ 완료 (reranker-worker.mjs) |
| Step 2 | Contextual Chunking | ✅ 완료 (buildContextualText) |
| Step 3 | 테이블 우선 검색 | ✅ 완료 (TABLE_BOOST + backfill) |
| Step 3 | SRAG 2단계 추출 | ✅ 구현됨 (extractColumnsFromPaper + mergeExtractionResults) |
| Step 4 | Agentic 재검색 (NULL 셀) | 📋 계획됨 (nullSummary 데이터 수집 중) |
| Step 4 | CRAG 자가 검증 | 📋 계획됨 |
| Step 5 | Sentence Window Retrieval | 💡 아이디어 |
| Step 5 | HyDE | 💡 아이디어 |
| Step 6 | 인용 네트워크 / GraphRAG / 멀티홉 | 💡 아이디어 |
| Step 7 | Agentic RAG 통합 | 💡 아이디어 |
| 리팩토링 | PDF 파이프라인 V2 단일화 (V1 휴리스틱 폴백 제거) | ✅ 완료 (CURRENT_EXTRACTION_VERSION=25, MinerU 필수 throw, V1 코드 전체 삭제) |

## 최근 변경 (커밋 기준)

| 커밋 | 내용 |
|------|------|
| f8dec9c | OCR pipeline v2, chat/table generation, notes workspace, UI 개선 |
| 20b0e4f | 프론트엔드, PDF 추출 파이프라인, RAG 검색, figure/table/equation 지원 |
| ee9bc17 | 초기 프로젝트 구조 + 데스크탑 쉘 |

> ROADMAP 계획서 중 Step 1~3의 핵심 항목이 이미 코드에 구현되어 있으나, ROADMAP.md 자체는 아직 "완료" 섹션에 반영되지 않은 상태.
