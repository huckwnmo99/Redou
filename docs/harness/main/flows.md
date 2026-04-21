# 주요 데이터 흐름
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 1. PDF 임포트 → 처리 파이프라인

```
사용자: PDF 파일 선택 (ImportPdfDialog.tsx)
  │
  ├─ IPC: FILE_IMPORT_PDF → main.mjs ipcMain.handle
  │   ├─ PDF 복사 → ~/Documents/Redou/Library/{paper-uuid}/original.pdf
  │   ├─ papers, paper_files 레코드 생성 (Supabase)
  │   ├─ processing_jobs 큐 등록 (job_type: import_pdf)
  │   └─ 반환: { paperId, fileId }
  │
  ├─ 폴링 루프 (2.5초 간격, processNextQueuedJob)
  │   └─ processImportPdfJob(job) [main.mjs]
  │       │
  │       ├─ [단일 파이프라인] MinerU 필수 / GROBID 선택(degraded mode)
  │       │   ├─ MinerU 미가용 시 → throw (사용자 친화적 에러 메시지)
  │       │   ├─ GROBID 미가용 시 → 경고 로그 후 진행 (메타데이터 일부 누락)
  │       │   ├─ MinerU parsePdf → 구조화 JSON+마크다운+이미지
  │       │   ├─ GROBID extractMetadataAndReferences → 메타데이터+참고문헌
  │       │   ├─ persistV2Results → DB 저장 (sections, chunks, figures, tables, equations, references)
  │       │   ├─ 빈 테이블 OCR 보강 (enhanceEmptyTablesWithOcr via GLM-OCR)
  │       │   └─ embedding 큐 등록 후 종료
  │       │
  │       └─ embedding 큐 등록 (job_type: generate_embeddings)
  │
  ├─ processEmbeddingJob(job) [main.mjs:1592]
  │   ├─ 청크 텍스트에 contextual prefix 추가 (buildContextualText)
  │   ├─ vLLM 임베딩 생성 (generateEmbeddings, 2048-dim)
  │   ├─ chunk_embeddings 배치 upsert
  │   ├─ 논문 단위 임베딩 (title + abstract)
  │   └─ Figure/Table/Equation 임베딩 (이미지: VL 모델, 텍스트: text 모델)
  │       └─ 참조 청크 컨텍스트 보강 (buildReferencePattern)
  │
  └─ IPC Events → 프론트엔드
      ├─ JOB_PROGRESS (진행률, 메시지)
      ├─ JOB_COMPLETED (결과 요약)
      └─ JOB_FAILED (에러)
```

**관련 파일**: `main.mjs` (오케스트레이션), `pdf-heuristics.mjs` (inspectPdfMetadata + extractFigureImagesFromPdf), `mineru-client.mjs` (PDF 파싱), `grobid-client.mjs` (메타데이터), `ocr-extraction.mjs` (빈 테이블 GLM-OCR), `embedding-worker.mjs` (임베딩)

## 2. 시맨틱 검색

```
사용자: 검색어 입력 (SearchView.tsx → TopBar.tsx)
  │
  ├─ IPC: EMBEDDING_GENERATE_QUERY → generateEmbedding(text, "query")
  │   └─ vLLM 2048-dim 쿼리 임베딩
  │
  ├─ 프론트엔드 직접 Supabase RPC 호출 (supabasePaperRepository.ts)
  │   ├─ match_chunks(query_embedding) → 벡터 유사도 검색
  │   ├─ match_papers(query_embedding) → 논문 단위 검색
  │   ├─ match_figures(query_embedding) → 그림/테이블/수식 검색
  │   └─ match_highlight_embeddings(query_embedding) → 하이라이트 검색
  │
  └─ 결과 표시 (SearchView.tsx)
      ├─ 탭별: 전체/논문/청크/노트/그림
      └─ 클릭 → 논문 상세 이동 + 페이지 앵커
```

**관련 파일**: `frontend/src/features/search/`, `frontend/src/lib/supabasePaperRepository.ts`, `embedding-worker.mjs`

## 3. 채팅 — 테이블 생성 파이프라인

```
사용자: 메시지 입력 (ChatInput.tsx, mode="table")
  │
  ├─ IPC: CHAT_SEND_MESSAGE → main.mjs [line 3315]
  │   ├─ 대화 생성/로드 (chat_conversations)
  │   ├─ 사용자 메시지 저장 (chat_messages)
  │   └─ 대화 히스토리 로드
  │
  ├─ Stage 1: Orchestrator [llm-orchestrator.mjs]
  │   ├─ generateOrchestratorPlan(history, paperList, previousTable)
  │   ├─ action = "clarify" → 명확화 질문 스트리밍 → 종료
  │   └─ action = "generate_table" / "modify_table" → Stage 2로
  │       └─ 출력: search_queries[], table_spec, keyword_hints[]
  │
  ├─ Stage 2: Multi-query RAG [main.mjs:2823]
  │   ├─ 각 search_query에 대해:
  │   │   ├─ generateEmbedding(query, "query") → 벡터
  │   │   ├─ match_chunks(vector) + match_chunks_bm25(text)
  │   │   ├─ match_figures(vector) + match_figures_bm25(text) [table 모드]
  │   │   └─ 결과 누적 (최고 유사도 유지)
  │   ├─ rrfFusion(vector, bm25) → 가중 RRF 병합 (table: BM25 60%, vector 40%)
  │   ├─ rrfFusionFigures + TABLE_BOOST (item_type='table' 우대)
  │   ├─ rerankChunksIfAvailable → cross-encoder 재정렬 (top-15)
  │   └─ 테이블 backfill: 관련 논문의 모든 item_type='table' figures 추가
  │
  ├─ Stage 3a: Parse [main.mjs:3493]
  │   ├─ OCR HTML 테이블 파싱 (parseAllHtmlTables → 코드 파서 우선)
  │   └─ 코드 실패 시 extractMatrixFromHtml (LLM 폴백)
  │
  ├─ Stage 3b: Per-paper Extraction (SRAG) [main.mjs:3583]
  │   ├─ 논문별 assemblePerPaperContext (파싱 TSV + OCR HTML + 텍스트 청크)
  │   ├─ extractColumnsFromPaper(tableSpec, context, title) [llm-orchestrator.mjs]
  │   └─ 순차 실행, 논문당 60초 타임아웃, 1회 재시도
  │
  ├─ Stage 3c: Merge [main.mjs:3686]
  │   ├─ mergeExtractionResults → 코드 병합 (no LLM)
  │   │   ├─ column key fuzzy matching (normalizeColumnKey)
  │   │   ├─ 참조번호 자동 부여 [refNo]
  │   │   ├─ N/A 비율 > 50% 행 폐기
  │   │   └─ references: 실제 사용 논문만 포함
  │   ├─ 병합 실패 시 → generateTableFromSpec (single-call fallback)
  │   └─ cleanCellValue (LLM 포맷 아티팩트 수정)
  │
  ├─ DB 저장: chat_messages (table_report) + chat_generated_tables
  │
  ├─ Stage 4: Guardian Verification (비동기, 백그라운드) [main.mjs:3796]
  │   ├─ 수치 셀 수집 → 최대 50개 샘플링
  │   ├─ checkGroundedness(sourceText, claim) [llm-chat.mjs]
  │   └─ verification 결과 chat_generated_tables.verification에 저장
  │
  └─ IPC Events → 프론트엔드
      ├─ CHAT_STATUS (stage: orchestrating/searching/parsing/extracting/assembling/verifying)
      ├─ CHAT_TOKEN (스트리밍 토큰)
      ├─ CHAT_COMPLETE (messageId, tableId)
      └─ CHAT_VERIFICATION_DONE (검증 결과)
```

**관련 파일**: `main.mjs` (파이프라인 오케스트레이션), `llm-orchestrator.mjs` (Orchestrator + Table Agent + Extraction Agent), `llm-chat.mjs` (streamChat, Guardian), `html-table-parser.mjs`, `reranker-worker.mjs`

## 4. Q&A 파이프라인

```
사용자: 메시지 입력 (ChatInput.tsx, mode="qa")
  │
  ├─ IPC: CHAT_SEND_MESSAGE (mode="qa") → handleQaPipeline [main.mjs:3227]
  │   ├─ 사용자 메시지를 직접 검색 쿼리로 사용
  │   ├─ extractKeyTerms(message) → 키워드 힌트 추출
  │   ├─ runMultiQueryRag(queries, hints, filterIds, "qa")
  │   │   └─ RRF 가중: vector 70%, BM25 30% (Q&A 모드)
  │   ├─ assembleRagContext (텍스트 위주, 파싱 매트릭스 없음)
  │   ├─ generateQaResponse (llm-qa.mjs) → 스트리밍
  │   └─ formatSourceAttribution → [1], [2] 참조번호 매핑
  │
  └─ DB 저장: chat_messages (text, metadata.referenced_paper_ids)
```

**관련 파일**: `main.mjs` (handleQaPipeline), `llm-qa.mjs` (Q&A 프롬프트 + 스트리밍), `llm-chat.mjs` (streamChat)

## 5. 노트 작성

```
사용자: 노트 작성 (NotesView.tsx)
  │
  ├─ 노트 목록 조회: useAllNotes → supabasePaperRepository.ts → notes 테이블
  ├─ 새 노트 생성: useCreateNote → DB insert (notes)
  ├─ 노트 수정: useUpdateNote → DB update (notes)
  └─ 노트 scope: paper / section / chunk / figure / highlight
      └─ 각 scope에 맞는 FK 연결 (section_id, chunk_id, figure_id, highlight_id)
```

**관련 파일**: `frontend/src/features/notes/NotesView.tsx`, `frontend/src/lib/queries.ts`, `frontend/src/lib/supabasePaperRepository.ts`
