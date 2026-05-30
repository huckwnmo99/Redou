# 기능 상태 매트릭스
> 하네스 버전: v1.6 | 최종 갱신: 2026-05-30

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
| 노트 워크스페이스 | ✅ 구현됨 | frontend/notes.md | 7가지 note_type |
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
| Step 7 | Agentic RAG 통합 | 💡 아이디어 |
| 리팩토링 | PDF 파이프라인 V2 단일화 (V1 휴리스틱 폴백 제거) | ✅ 완료 (CURRENT_EXTRACTION_VERSION=25, MinerU 필수 throw, V1 코드 전체 삭제) |
| 리디자인 | FiguresView 디자인 킷 이식 (리디자인 1호 시범 화면) | ✅ 구현됨 (`docs/features/new/12-figuresview-redesign-kit-port.md`. **방향 A(1-pane 전역 갤러리)** + 썸네일 **A-1(paperId별 PDF doc 캐시)** 채택. 필터칩(All/Figure/Table/Equation+카운트)+캡션·제목 검색+카드 그리드+라이트박스(키보드 ←/→/Esc) 시각 이식. 데이터 훅·IPC·실제 썸네일 로직·`LatexText`·i18n 100% 보존, 킷 가짜 placeholder/CDN Icon 미채택. `tokens.css`에 `--shadow-xs`/`--font-mono` + `.fig-card` hover 규칙 추가. 2-pane 폴더 동선 제거. 빌드(tsc -b+vite) 통과. 커밋/비주얼 검증은 리뷰 단계) |
| 리디자인 | ChatView 디자인 킷 이식 (리디자인 3호 화면) | 📋 계획됨 (`docs/features/new/14-chatview-redesign-kit-port.md`. 킷 `ChatView.jsx`(단일 시안)의 시각을 현재 6컴포넌트 chat 중 **ChatMessageList/ChatTableReport/ChatPipelineStatus/ChatView/ChatInput**에 이식. ChatSidebar(글로벌 LeftSidebar 소속)·데이터/IPC/스토어/타입/백엔드/DB 무변경. **보존**: 실시간 스트리밍(`useChatStreamBridge`/`streamingContent`)·실 파이프라인 stage(table 7/QA 3, `CHAT_STATUS`)·테이블 생성(`useChatTable`)·검증(`verification[]`)·인용(`source_refs`)·CSV·abort·모드잠금·마크다운. **가짜→실제 연결**: 킷 무조건-초록 Verified 배지→실 verification 종합, 행인덱스 `[N]` 첨자 미채택, 모델칩→`useActiveLlmModel` 실값, setTimeout 파이프라인 미채택. 메시지 중앙컬럼(880)+assistant R헤더 채택, 검증 셀색은 zebra보다 우선 유지. `tokens.css` 무변경 전망(Figures/Settings에서 선보강 완료). **미결**: 파이프라인 방향1(현 stepper 유지)vs2(킷 가로 4단계 압축) 등 가정 7건 승인 필요. develop 대상이나 고위험(실시간/파이프라인/테이블) — 시각 레이어 한정) |
| 리디자인 | SettingsView 디자인 킷 이식 (리디자인 2호 화면) | ✅ 구현됨 (`docs/features/new/13-settingsview-redesign-kit-port.md`. 킷 **2-pane 섹션 레이아웃**(좌측 Account/Workspace/Models/Desktop/About 네비 + 우측 Row 패널)으로 `SettingsView.tsx` 전면 재구성. **기본 진입 섹션=account**. 프리미티브 TS 포팅: `SectionHeader`/`RowGroup`/`Row`/`Select`/`SegmentedControl`/`Button`(icon=lucide 컴포넌트)/`Toast`(2.5초 자동 소멸, z-index 100). entity 토글·LLM/entity 모델 선택을 **Models 섹션**에 매핑 보존(Chat & table + Knowledge graph RowGroup). 백엔드 없는 킷 목업(Streaming/Guardian/Theme)은 **비활성 "준비 중" placeholder**(`ComingSoonPill`)로 자리만 표시 — 동작 로직 미연결. Library 뷰·Password·Active sessions·**Delete account(danger zone)**·Diagnostics·서비스 health StatusPill은 **완전 미이식**(가짜 버튼/상태 노출 금지). About은 데스크탑 버전·런타임만 실제값. 보존: 4 entity 훅(`useEntityGraphEnabled`/`useSetEntityGraphEnabled`/`useActiveEntityModel`/`useSetEntityModel`/`useEntityBackfillStatus`/`useStartEntityBackfill`)·LLM 훅·`@/lib/desktop` IPC·`useAuthSession`/`useSignOut`·`useUIStore.locale/setLocale`·전체 핸들러·타입(any 0). 킷 한국어 하드코딩 전부 `t()`로 래핑, `.eyebrow`/`.scroll-y`→인라인 style(FiguresView 선례). 데이터·IPC·스토어·DB·Electron·`tokens.css` 무변경, `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. 커밋/비주얼 검증은 리뷰 단계) |

## 최근 변경 (커밋 기준)

| 커밋 | 내용 |
|------|------|
| f8dec9c | OCR pipeline v2, chat/table generation, notes workspace, UI 개선 |
| 20b0e4f | 프론트엔드, PDF 추출 파이프라인, RAG 검색, figure/table/equation 지원 |
| ee9bc17 | 초기 프로젝트 구조 + 데스크탑 쉘 |

> ROADMAP 계획서 중 Step 1~3의 핵심 항목이 이미 코드에 구현되어 있으나, ROADMAP.md 자체는 아직 "완료" 섹션에 반영되지 않은 상태.
