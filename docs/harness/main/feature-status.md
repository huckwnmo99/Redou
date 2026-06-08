# 기능 상태 매트릭스
> 하네스 버전: v1.8 | 최종 갱신: 2026-05-31

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
| Agentic NULL Recovery | ✅ 구현됨 | electron/llm.md, electron/rag-pipeline.md | Stage 3d, 새 컨텍스트 Gate 1 + high-confidence Gate 2 |
| Guardian 검증 | ✅ 구현됨 | electron/llm.md | 샘플링 50셀, 비동기 |
| Q&A 파이프라인 | ✅ 구현됨 | electron/llm.md | 별도 모드, 출처 귀속 |
| Table/Q&A 서비스 분리 | ✅ 구현됨 | electron/llm.md | conversation_type 컬럼 + llm-qa.mjs |
| CSV 내보내기 | ✅ 구현됨 | electron/main-process.md | BOM + References 섹션 |
| PDF 리더 (연속 스크롤) | ✅ 구현됨 | frontend/paper.md | pdfjs, IntersectionObserver |
| 하이라이트 | ✅ 구현됨 | frontend/paper.md | 색상 프리셋, 임베딩 |
| 폴더 관리 | ✅ 구현됨 | frontend/paper.md | 트리 구조, 드래그&드롭 |
| Figure/Table/Equation 갤러리 | ✅ 구현됨 | frontend/paper.md | FiguresView.tsx — 디자인 킷 이식 완료(1-pane 전역 갤러리: 필터칩+검색+라이트박스, paperId별 PDF doc 캐시) |
| 노트 워크스페이스 | ✅ 구현됨 | frontend/notes.md | NoteKind 6종(summary/insight/question/quote/action/memo). NotesView.tsx — 디자인 킷 이식 완료(3-pane: 좌 리스트[검색+종류칩+논문·정렬 select]+드래그 리사이즈+우 캄 에디터). controlled draft 편집/저장·소스이동·하이라이트 연결 보존 |
| 프로세싱 모니터링 | ✅ 구현됨 | frontend/paper.md | ProcessingView.tsx (import_pdf / generate_embeddings / extract_entities 라벨 구분 표시) |
| 라이브러리 카드 처리 상태 | ✅ 구현됨 | frontend/stores-queries.md | `paperSignals.ts`가 core(import_pdf+generate_embeddings) job 합성으로 계산. 둘 다 succeeded일 때만 "Complete". entity는 제외 |
| 엔티티 추출 (graph) | ✅ 구현됨 (opt-in, 기본 OFF) | — | `entity-extractor.mjs`. **opt-in**: 자동 큐잉/QA graph 경로를 `user_workspace_preferences.entity_graph_enabled`(기본 OFF)로 게이트(fix 16). OFF: import 시 `extract_entities` 자동 큐잉 안 함 + QA는 plain `runMultiQueryRag`. ON: embedding 후 비차단 큐잉 + QA는 `runGraphEnhancedRag`. **수동 백필 버튼은 토글과 무관하게 항상 동작**. 부가 기능(실패 시 core 영향 없음). `codex/rag-infra-extraction` |
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
| Step 4 | Agentic 재검색 (NULL 셀) | ✅ 구현됨 (Stage 3d Agentic NULL Recovery) |
| Step 4 | CRAG 자가 검증 | 📋 계획됨 |
| Step 5 | Sentence Window Retrieval | 💡 아이디어 |
| Step 5 | HyDE | 💡 아이디어 |
| Step 6 | 인용 네트워크 / GraphRAG / 멀티홉 | 💡 아이디어 |
| 브랜치통합 | 엔티티 그래프(PR #1)를 Plan 12 본선에 통합 (entity-extractor + Graph-Enhanced RAG) | ✅ 구현됨 (`codex/rag-infra-extraction` 브랜치 통합·동작. embedding 후 `extract_entities` 큐잉, dev DB에 실행 이력. graceful-degradation 부가 기능 — core "Complete" 판정에서 제외) |
| 정책변경 | Entity Graph opt-in 전환 (자동 큐잉/QA graph를 `entity_graph_enabled` 플래그로 게이트, 기본 OFF) | ✅ 구현됨 (fix 16. `enqueueEntityExtractionIfNeeded` 진입부 게이트 + `handleQaPipeline` graph/plain 분기 + GET/SET IPC + Settings 토글. 마이그레이션 `20260527073618_add_entity_graph_enabled.sql`. 근거: extract_entities 편당 ~104초=처리의 ~60%, QA graph 가치 미검증) |
| 버그수정 | `getEntityGraphEnabled` DB 조회 에러 시 graceful degrade (graph OFF) | 📋 계획됨 (fix 17. #16 리뷰 중 발견한 P2. `main.mjs:495` throw → console.warn+false. `entity_graph_enabled` 컬럼 미적용 환경에서 QA 전체가 깨지는 문제 hardening. GROBID degraded-mode 패턴과 일관) |
| 버그수정 | 테이블 생성 타임아웃 (single-call fallback DOMException TimeoutError) | 🟡 부분 구현 — **P0-A + P0-B 완료** (P1/P2 미구현) (fix 18. `docs/features/fix/18-table-generation-timeout.md`. 3결함 연쇄: ①`assembleRagContext` 118KB(OCR 70K+matrix 35K+chunk) 컨텍스트가 `ollamaSignal` 300초 상한 초과 `chat/table-extraction.mjs`+`llm-chat.mjs:5` ②`runStage3cMergeFallback`가 `generateTableFromSpec`를 try/catch 없이 호출해 fallback throw가 전체 파이프라인 죽임+per-paper 부분성공분 폐기 ③per-paper `chunks 0 chars`+실제 데이터 부재+60초 timeout. **구현(P0-A)**: `chat/table-pipeline.mjs` `runStage3cMergeFallback`의 단일호출 fallback을 try/catch로 감쌈 — 사용자 abort는 `throwIfChatAborted` 재throw, timeout/일반 에러는 병합 부분결과(`mergedTableJson`, 있으면) 또는 빈 테이블(`rows:[]`+notes) 반환 → 에러 화면 대신 결과. **구현(P0-B)**: `chat/table-extraction.mjs`에 `FALLBACK_RAG_BUDGET`(OCR 30K/MATRIX 20K/TOTAL 60K) export + `assembleRagContext`에 옵셔널 `budget` 5번째 인자(미지정 시 기존 70K/35K/120K) → Stage 3c fallback만 ~60K 전달. **미구현**: P1(per-paper chunks 쏠림 완화), P2(timeout 증가, 비권장). DB/IPC/컴포넌트·`CURRENT_EXTRACTION_VERSION` 무변경. node --check 2파일 + 데스크탑 단위 테스트 57건 회귀 통과. 커밋은 사용자) |
| Step 7 | Agentic RAG 통합 | 💡 아이디어 |
| 리팩토링 | PDF 파이프라인 V2 단일화 (V1 휴리스틱 폴백 제거) | ✅ 완료 (CURRENT_EXTRACTION_VERSION=25, MinerU 필수 throw, V1 코드 전체 삭제) |
| 리디자인 | FiguresView 디자인 킷 이식 (리디자인 1호 시범 화면) | ✅ 구현됨 (`docs/features/new/12-figuresview-redesign-kit-port.md`. **방향 A(1-pane 전역 갤러리)** + 썸네일 **A-1(paperId별 PDF doc 캐시)** 채택. 필터칩(All/Figure/Table/Equation+카운트)+캡션·제목 검색+카드 그리드+라이트박스(키보드 ←/→/Esc) 시각 이식. 데이터 훅·IPC·실제 썸네일 로직·`LatexText`·i18n 100% 보존, 킷 가짜 placeholder/CDN Icon 미채택. `tokens.css`에 `--shadow-xs`/`--font-mono` + `.fig-card` hover 규칙 추가. 2-pane 폴더 동선 제거. 빌드(tsc -b+vite) 통과. 커밋/비주얼 검증은 리뷰 단계) |
| 리디자인 | ChatView 디자인 킷 이식 (리디자인 3호 화면) | 📋 계획됨 (`docs/features/new/14-chatview-redesign-kit-port.md`. 킷 `ChatView.jsx`(단일 시안)의 시각을 현재 6컴포넌트 chat 중 **ChatMessageList/ChatTableReport/ChatPipelineStatus/ChatView/ChatInput**에 이식. ChatSidebar(글로벌 LeftSidebar 소속)·데이터/IPC/스토어/타입/백엔드/DB 무변경. **보존**: 실시간 스트리밍(`useChatStreamBridge`/`streamingContent`)·실 파이프라인 stage(table 7/QA 3, `CHAT_STATUS`)·테이블 생성(`useChatTable`)·검증(`verification[]`)·인용(`source_refs`)·CSV·abort·모드잠금·마크다운. **가짜→실제 연결**: 킷 무조건-초록 Verified 배지→실 verification 종합, 행인덱스 `[N]` 첨자 미채택, 모델칩→`useActiveLlmModel` 실값, setTimeout 파이프라인 미채택. 메시지 중앙컬럼(880)+assistant R헤더 채택, 검증 셀색은 zebra보다 우선 유지. `tokens.css` 무변경 전망(Figures/Settings에서 선보강 완료). **미결**: 파이프라인 방향1(현 stepper 유지)vs2(킷 가로 4단계 압축) 등 가정 7건 승인 필요. develop 대상이나 고위험(실시간/파이프라인/테이블) — 시각 레이어 한정) |
| 리디자인 | SearchView 디자인 킷 이식 (리디자인 4호 화면) | ✅ 구현됨 (`docs/features/new/15-searchview-redesign-kit-port.md`. 킷 `SearchView.jsx`(단일 목업 시안)의 시각을 `SearchView.tsx` 단일 파일에 이식. **방향 A**(paper-centric 집계 유지) 채택. 이식: **중앙 컬럼(maxWidth 820, padding 32/24/80)** + 검색바(**height 54 + 포커스 글로우 `0 0 0 4px accent-subtle` + ⌘K kbd**(focus 핸들러)+ Esc clear) + **Hybrid 정보 칩**(가짜 Semantic/Keyword 토글 대체) + 카테고리 **7칩**(소스 아이콘+카운트, count=0 disabled) + 결과 카드 **3단**(좌측 소스 레일[대표 소스+p.N] / 본문[제목·스니펫+키워드 `<mark>`] / 우측[매치% 색뱃지+Open→]) + **하단 다중 소스 뱃지(×N)** 유지 + 빈상태(eyebrow + Try칩[도메인 일반 예시] + 최근 논문[실데이터]) + 결과없음(search-x + 2줄). 신규 헬퍼: `highlightSnippet`(실 쿼리 토큰 `<mark>`, LaTeX 스니펫 제외), `chipCounts`(scope별 매칭 논문 수 — 동일 검색 입력에서 도출, 표시용·로직 무관), `eyebrowStyle`, `sourceLabels`에 per-source `color` 필드 추가. **보존**: 하이브리드 4훅(`useSemanticChunk/Paper/FigureSearch`+`useSearchHighlightEmbeddings`)·`buildUnifiedResults`/`buildSearchGroups`/`semanticResultsToChunks` 퓨전·evidence 집계·매치%(실 pgvector cosine)·`handleCardClick` PDF점프·카테고리 7종(equations 포함)·`LatexText` KaTeX·타입(any 0)·i18n `t()`. **미채택(가짜)**: RECENT_SEARCHES 하드코딩, all-MiniLM 오모델명 캡션, "전체 라이브러리" 버튼(SearchSidebar 중복), 키보드 힌트 푸터, 킷 수동 `**` 파싱, kit 화학-특정 Try 예시. `SearchSidebar.tsx`·`searchModel.ts`·`types/paper.ts`·`queries.ts`·`uiStore.ts`·`tokens.css`·Electron·DB 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건(searchModel 포함) 회귀 통과. ESLint 미설정(eslint.config 없음·미설치). 커밋/비주얼 검증은 리뷰 단계) |
| 리디자인 | NotesView 디자인 킷 이식 (리디자인 5호 화면) | ✅ 구현됨 (`docs/features/new/16-notesview-redesign-kit-port.md`. 킷 `NotesView.jsx`(단일 시안+목업 7건)의 시각을 `NotesView.tsx` 단일 파일에 이식. **IA 전면 전환**: 전체폭 2-grid(논문별 그룹 리스트 / 에디터) → 킷 **3-pane**(좌 리스트 패널[제목+카운트+New / 검색 / 종류칩 / 논문·정렬 CompactSelect / flat 리스트] + 드래그 `ResizeHandle` + 우 캄 에디터, `display:flex; height:100%; overflow:hidden` 외곽 패딩 제거). **신규 인터랙션 4종**(전부 로컬 useState): 노트 검색(`matchesSearch` 제목·본문)+정렬(`sort` updated/created/title/kind 실 필드, pinned 우선)+**종류별 필터칩**(`kindFilter`, `NOTE_KIND_KEYS` 순회)+**리스트↔에디터 드래그 리사이즈**(`listWidth` 280~560px lazy init, `localStorage["redou.notes.listWidth"]`, `dragCleanupRef`+unmount cleanup). **방향 A 채택**(종류/검색/정렬=로컬 신규, **논문 필터는 글로벌 `selectedPaperId` 유지**[리더·소스이동 동선 보존], `groupedNotes` 그룹 헤더 제거→flat 리스트+카드 푸터 논문명·p.N). **보존**: controlled `draft`+`isDraftDirty`/`handleSave`(`useUpdateNote`, `anchorLabel: linkedSelectionNote ? undefined` 분기)·`handleCreateNote`(`useCreateNote`)·`openNoteSource`/`openPaperNotes`(`setReaderTargetAnchor`+`openPaperDetail`)·`linkedSelectionNote` 하이라이트 연결+`activeQuote` 인용 배너·앵커 input linked 잠금·`useAllNotes`/`useAllPapers`·`noteKindMeta`/`formatNoteDate`·타입(any 0)·i18n `t()`·노트 전환 시 `useEffect` draft 동기. **미채택(가짜)**: 킷 발명 종류 `idea`/`comparison`/`todo` **폐기**(실 6종만, DB `KIND_TO_DB` 일치), 킷 `defaultValue`+`key` 입력 트릭(controlled 유지), 무조건 "저장됨" 배지→실 dirty, `onNew` 빈함수→`handleCreateNote`, "소스로 이동"/핀 무동작→실 액션, **삭제(trash) 버튼 미이식**(삭제 기능 없음·가짜 노출 금지), **⌘S/⌘⏎ kbd 힌트 미이식**(키 바인딩 없음·워드/문자 카운트는 실 계산 유지). 종류칩 색 점만([가정 A]), 영문 라벨([가정 B]), 종류 변경=킷 NoteKindChip 시각+투명 native select 오버레이([미결 2]). `.scroll-y`→인라인 `overflowY:auto`(Figures/Settings 선례). `tokens.css`·타입·데이터·IPC·스토어·DB·Electron 무변경, `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. ESLint 미설정(eslint.config 없음). 커밋/비주얼 검증은 리뷰 단계) |
| 리디자인 | SettingsView 디자인 킷 이식 (리디자인 2호 화면) | ✅ 구현됨 (`docs/features/new/13-settingsview-redesign-kit-port.md`. 킷 **2-pane 섹션 레이아웃**(좌측 Account/Workspace/Models/Desktop/About 네비 + 우측 Row 패널)으로 `SettingsView.tsx` 전면 재구성. **기본 진입 섹션=account**. 프리미티브 TS 포팅: `SectionHeader`/`RowGroup`/`Row`/`Select`/`SegmentedControl`/`Button`(icon=lucide 컴포넌트)/`Toast`(2.5초 자동 소멸, z-index 100). entity 토글·LLM/entity 모델 선택을 **Models 섹션**에 매핑 보존(Chat & table + Knowledge graph RowGroup). 백엔드 없는 킷 목업(Streaming/Guardian/Theme)은 **비활성 "준비 중" placeholder**(`ComingSoonPill`)로 자리만 표시 — 동작 로직 미연결. Library 뷰·Password·Active sessions·**Delete account(danger zone)**·Diagnostics·서비스 health StatusPill은 **완전 미이식**(가짜 버튼/상태 노출 금지). About은 데스크탑 버전·런타임만 실제값. 보존: 4 entity 훅(`useEntityGraphEnabled`/`useSetEntityGraphEnabled`/`useActiveEntityModel`/`useSetEntityModel`/`useEntityBackfillStatus`/`useStartEntityBackfill`)·LLM 훅·`@/lib/desktop` IPC·`useAuthSession`/`useSignOut`·`useUIStore.locale/setLocale`·전체 핸들러·타입(any 0). 킷 한국어 하드코딩 전부 `t()`로 래핑, `.eyebrow`/`.scroll-y`→인라인 style(FiguresView 선례). 데이터·IPC·스토어·DB·Electron·`tokens.css` 무변경, `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. 커밋/비주얼 검증은 리뷰 단계) |

## 최근 변경 (커밋 기준)

| 커밋 | 내용 |
|------|------|
| f8dec9c | OCR pipeline v2, chat/table generation, notes workspace, UI 개선 |
| 20b0e4f | 프론트엔드, PDF 추출 파이프라인, RAG 검색, figure/table/equation 지원 |
| ee9bc17 | 초기 프로젝트 구조 + 데스크탑 쉘 |

> ROADMAP 계획서 중 Step 1~3의 핵심 항목이 이미 코드에 구현되어 있으나, ROADMAP.md 자체는 아직 "완료" 섹션에 반영되지 않은 상태.
