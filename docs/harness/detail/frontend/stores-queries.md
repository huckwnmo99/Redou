# 스토어 & 쿼리 계층
> 하네스 버전: v1.4 | 최종 갱신: 2026-05-27

## 개요
Zustand로 UI ���태를, TanStack Query로 서버 상태를 관리한다. Supabase DAL(supabasePaperRepository)이 DB 접근을 추상화하고, desktop.ts가 Electron IPC를 래핑한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/stores/uiStore.ts` | UI 전역 상태 (Zustand) | ~139 |
| `frontend/src/stores/chatStore.ts` | 채팅 스트리밍 상태 (Zustand) | ~100 |
| `frontend/src/lib/queries.ts` | TanStack Query 훅 (DB 조회/뮤테이션) | ~569 |
| `frontend/src/lib/chatQueries.ts` | 채팅 관련 Query ��� | ~337 |
| `frontend/src/lib/supabasePaperRepository.ts` | Supabase DAL | ~1488 |
| `frontend/src/lib/desktop.ts` | Electron IPC 브릿지 훅 | ~347 |
| `frontend/src/lib/supabase.ts` | Supabase 클라이언트 초기화 | — |
| `frontend/src/lib/auth.ts` | 인증 세션 관리 | — |
| `frontend/src/lib/locale.ts` | 다��어 (한/영) 유틸 | — |
| `frontend/src/lib/queryClient.ts` | TanStack Query 클라이언트 설정 | — |

## uiStore 상태

| 상태 | 타입 | 설명 |
|------|------|------|
| `locale` | AppLocale | 한/영 |
| `activeNav` | NavItem | 현재 네비게이션 |
| `activeFolderId` | string \| null | 선택된 폴더 |
| `selectedPaperId` | string \| null | 선택된 논문 |
| `selectedNoteId` | string \| null | 선택된 노트 |
| `paperDetailOpen` | boolean | 상세 뷰 열림 |
| `paperDetailTab` | PaperDetailTab | 상세 탭 |
| `searchQuery` | string | 검색어 |
| `searchResultKind` | SearchResultKind | 검색 결과 유형 필터 |
| `sortKey` | SortKey | 정렬 기준 |
| `viewMode` | ViewMode | grid / list |
| `pendingDropPaths` | string[] \| null | 드래그 파일 경로 |

## TanStack Query 키 구조 (queries.ts)

| 키 | 패턴 | 설명 |
|------|------|------|
| `paperKeys.all` | ["papers"] | 전체 논문 |
| `paperKeys.one(id)` | ["papers", id] | 단일 논문 |
| `noteKeys.all` | ["notes"] | 전체 노트 |
| `noteKeys.byPaper(id)` | ["notes", "paper", id] | 논문별 노트 |
| `highlightKeys.byPaper(id)` | ["highlights", id] | 논문별 하이라이트 |
| `folderKeys.all` | ["folders"] | 전체 폴더 |
| `figureKeys.byPaper(id)` | ["figures", id] | 논문별 Figure |

## 주요 Query ��� (queries.ts)

| 훅 | 역할 |
|------|------|
| `useAllPapers()` | 전체 논문 목록 |
| `usePaper(id)` | 단일 논문 상세 |
| `useAllNotes()` / `useNotesByPaper(id)` | 노트 조회 |
| `useCreateNote()` / `useUpdateNote()` | 노트 CRUD |
| `useHighlightsByPaper(id)` | 하이라이트 조회 |
| `useFolders()` | 폴더 트리 |
| `useProcessingJobs()` | 작업 큐 |
| `useImportPdf()` | PDF 임포트 뮤테이션 |

## 채팅 Query 훅 (chatQueries.ts)

| 훅 | 역할 |
|------|------|
| `useConversations()` | 대화 목록 |
| `useConversationMessages(id)` | 대화 메시지 |
| `useGeneratedTable(tableId)` | 생성 테이블 조회 |
| `useSendMessage()` | 메시지 전송 뮤테이션 |
| `useChatEvents()` | IPC 이벤트 수신 + chatStore 갱신 |

### 엔티티/모델 훅 (chatQueries.ts)

| 훅 | 쿼리 키 | 역할 |
|------|---------|------|
| `useActiveEntityModel()` / `useSetEntityModel()` | `entityKeys.activeModel` | 엔티티 추출 모델 조회/변경 |
| `useEntityBackfillStatus()` / `useStartEntityBackfill()` | `entityKeys.backfillStatus` | 수동 백필 상태/시작 (토글과 무관하게 동작) |
| `useEntityGraphEnabled()` / `useSetEntityGraphEnabled()` | `entityKeys.graphEnabled` | 엔티티 그래프 opt-in 토글 조회/변경(기본 OFF). `entity.getGraphEnabled/setGraphEnabled` IPC 래핑. `useEntityGraphEnabled`는 `boolean` 반환 (fix 16) |

## Supabase DAL (supabasePaperRepository.ts, ~1488줄)
- 모든 테이블에 대한 CRUD 함수 정의
- 프론트엔드 직접 호출 또는 Electron IPC(DB_QUERY/DB_MUTATE) 경유
- 시맨틱 검색 RPC 호출 (match_chunks, match_papers, match_figures, match_highlight_embeddings)

## 라이브러리 카드 처리 상태 계산 (paperSignals.ts)
- `papers` 테이블에는 `processing_status` 컬럼이 없다. 라이브러리 카드의 "Complete/처리 중/실패" 표시는 `frontend/src/lib/paperRepository/paperSignals.ts`의 `fetchPaperSignals()`가 `processing_jobs`에서 **실시간 계산**한 값(`Paper.processingStatus`)이다.
- **core 파이프라인 = `import_pdf` + `generate_embeddings`** 두 job을 모두 로드해 paper별로 합성한다 (`CORE_JOB_TYPES`).
  - 우선순위: `failed` > `running` > `queued` > `succeeded`. 하나라도 failed면 failed, 하나라도 running이면 running.
  - **두 core job이 모두 succeeded일 때만 `succeeded`("Complete")**. embedding job이 아직 큐잉 전이면(import 직후) `queued`로 취급해 "Complete"로 위장되지 않게 한다.
  - primary source(`paper_files.is_primary`) 필터를 유지해 보조 파일 job은 제외한다.
- **`extract_entities`(엔티티 추출)는 core 판정에서 제외**한다 (graceful-degradation 부가 기능 — 실패해도 논문 읽기/검색/노트/채팅은 정상이므로 core "Complete"를 뒤집지 않는다). entity 진행/실패는 ProcessingView(처리 파이프라인 탭)에서만 노출된다.
- 소비처: `PaperCard`, `PaperListItem`, `PaperDetailView`, `RightInspector`, `ProcessingBadge`(`succeeded`→"Complete").

## desktop.ts (Electron IPC 브릿지)
- `useDesktopStatus()`: Electron 가용 여부, 플랫폼, 버전
- `useDesktopFilePath(storedPath)`: 파일 경로 해석
- `useDesktopJobFeed()`: JOB_PROGRESS/COMPLETED/FAILED 이벤트 수신
- `useImportPdf()`: PDF 임포트 뮤테이션
- `getDesktopApi()`: `window.redouDesktop` 래퍼

## 의존성
- 사용: @supabase/supabase-js, @tanstack/react-query, zustand, Electron preload API
- 사용됨: 모든 feature 컴포넌트

## 현재 상태
- 구현 완료: 전체 상태 관리, DB 조회/뮤테이션, IPC 브릿지
