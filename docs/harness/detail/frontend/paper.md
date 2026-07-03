# 논문 관리 & 리더
> 하네스 버전: v1.3 | 최종 갱신: 2026-07-03

## 개요
논문 라이브러리 관리(그리드/리스트 뷰, 폴더, 태그), PDF 리더(연속 스크롤, 하이라이트, 줌), 논문 상세 뷰(overview/pdf/notes/figures), Figure 갤러리, 프로세싱 모니터링을 담당한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/features/library/LibraryView.tsx` | 라이브러리 메인 (그리드/리스트 분기) | ~130 |
| `frontend/src/features/library/PaperCard.tsx` | 그리드 카드 | — |
| `frontend/src/features/library/PaperListItem.tsx` | 리스트 아이템 | — |
| `frontend/src/features/library/CategoryTree.tsx` | 폴더 트리 | — |
| `frontend/src/features/library/drag.ts` | 드래그&드롭 유틸 | — |
| `frontend/src/features/paper/PaperDetailView.tsx` | 상세 뷰 (탭 컨테이너) | ~1903 |
| `frontend/src/features/paper/PdfReaderWorkspace.tsx` | PDF 리더 | ~966 |
| `frontend/src/features/figures/FiguresView.tsx` | Figure/Table/Equation 갤러리 (1-pane 전역, 디자인 킷 이식) | ~720 |
| `frontend/src/features/import/ImportPdfDialog.tsx` | PDF 임포트 다이얼로그 | ~694 |
| `frontend/src/features/processing/ProcessingView.tsx` | 프로세싱 작업 큐 모니터링 | ~257 |
| `frontend/src/features/settings/SettingsView.tsx` | 설정 — 디자인 킷 이식(2-pane 섹션 레이아웃, 모델 선택 포함) | ~960 |

## 주요 컴포넌트

### LibraryView
- 뷰 모드: grid / list (uiStore.viewMode)
- 정렬: addedAt / title / year (uiStore.sortKey)
- 폴더 필터: activeFolderId → paper_folders 조인

### PaperDetailView
- 탭: overview, pdf, notes, figures, references, settings
- overview: 메타데이터 표시, 요약 (paper_summaries), 태그, 상태
- pdf: PdfReaderWorkspace
- figures: Figure/Table/Equation 목록 (논문별)

### PdfReaderWorkspace
- pdfjs-dist 5.5 사용, Chromium 134 폴리필
- 연속 스크롤 + IntersectionObserver 레이지 렌더링
- 줌: Ctrl+마우스휠 / Ctrl+/-
- z-index 레이어: canvas(0) → highlight(1) → text(2) → memo(3)
- 하이라이트: 색상 프리셋, 텍스트 선택 → DB 저장

### ImportPdfDialog
- 파일 선택 (drag & drop 또는 dialog)
- 메타데이터 미리보기 (inspectPdfMetadata)
- 임포트 실행 → IPC FILE_IMPORT_PDF

### FiguresView (디자인 킷 이식 — 리디자인 1호)
- **1-pane 전역 갤러리**: 라이브러리 전체 Figure/Table/Equation을 한 그리드에 표시 (논문선택 2-pane 동선 제거)
- 컨트롤: 필터칩(All/Figure/Table/Equation + 실시간 카운트) + 캡션·논문 제목 검색 박스
- 정렬: item_type(figure→table→equation) → figureNo 숫자 → 논문 제목
- **실제 썸네일** 유지(킷 가짜 placeholder 미채택):
  - `imagePath` 있으면 `FigureImage`(추출 이미지)
  - 없으면 paperId별 PDF doc로 `TableCropThumbnailCard`/`FigureCropThumbnailCard`/`PageThumbnail` 크롭 렌더
  - doc도 없으면 type 아이콘 폴백
- **paperId별 PDF doc 캐시**(`PaperDocCacheProvider`/`PaperDocLoader`/`usePaperDoc` context): 전역 그리드에서 논문당 doc 1개만 로드해 같은 논문 카드들이 공유. crop이 필요한(=`imagePath` 없고 `page` 있는) 논문만 lazy 로드
- 카드(`.fig-card`, 킷 스타일): 타입 배지(`color-mix`)+hover-zoom(`Maximize2`)+캡션 2줄 클램프(`LatexText` KaTeX)+출처(논문 제목·p.N). hover 효과는 `tokens.css`의 `.fig-card`/`.fig-zoom` 규칙(인라인 :hover 불가)
- 라이트박스(`FigureLightbox`): `position:absolute inset 0` z-index 70(AppShell 콘텐츠 컨테이너가 `position:relative`라 안전, 인스펙터 z=20·토스트 z=40 위), 키보드 ←/→/Esc, 큰 미리보기=실제 렌더, "논문 열기"=`jumpToPage`(스토어 PDF 점프 동선 보존)
- 보존 자산: 데이터 훅(`useAllFigures`/`useAllPapers`/`usePrimaryPaperFile`), IPC(`@/lib/desktop`: `toDesktopFileUrl`/`useResolvedDesktopFilePath`/`useDesktopRuntime`), 스토어(`useUIStore` jump), 타입(`PaperFigure`/`Paper`), i18n(`localeText`/`t()`)
- lucide named import: `Maximize2`/`Search`/`ImageOff`/`X`/`ChevronLeft`/`ChevronRight`/`FileText`/`ExternalLink`/`Images`/`Sigma`/`Table2` (킷 CDN Icon 방식 미도입)

### ProcessingView
- processing_jobs 테이블 실시간 표시
- 상태별: queued, running, succeeded, failed
- IPC 이벤트 JOB_PROGRESS/COMPLETED/FAILED 수신
- **succeeded 경고 배너(A-R6, 슬라이스 06)**: `JobCard`가 `status==="succeeded" && error_message`이면 경고 배너를 렌더. chunkCount0(스캔본/빈 PDF) job은 succeeded로 끝나지만 `main.mjs`가 `error_message`에 경고를 기록하는데, 기존엔 `status==="failed"`일 때만 렌더해 조용한 실패였음 → 조건 확장으로 가시화. failed의 danger(`--color-danger` #dc2626)와 구분되는 `--color-warning`(#c0841a) caution 톤. 정상 succeeded는 `error_message: null`이라 이 배너 미표시

### SettingsView (디자인 킷 이식 — 리디자인 2호)
- **2-pane 섹션 레이아웃**: 좌측 `<aside>` 224px 섹션 레일(Account/Workspace/Models/Desktop/About + lucide 아이콘, active=`--color-accent-subtle`) + 우측 스크롤 패널(maxWidth 720). `section` 상태로 전환, 기본 진입=`account` (이전 1-pane 카드 그리드 동선 제거)
- **프리미티브**(킷 → TS, props 타입 명시, `any` 0): `SectionHeader`(h1 24px) / `RowGroup`(소제목=인라인 `eyebrowStyle`) / `Row`(label+description+control) / `Select`(네이티브 `<select>` 래퍼, a11y 유지) / `SegmentedControl` / `Button`(`icon`=lucide 컴포넌트, primary/secondary/danger variant) / `Toast`(`position:fixed` 중앙 하단, z-index 100, 2.5초 자동 소멸 — 인라인 `feedbackStyle` 박스 대체) / `ComingSoonPill`("준비 중" 비활성 칩)
- **섹션 → 기능 매핑**(현재 기능 전부 보존):
  - **Account**: `useAuthSession`/`useSignOut`. Identity strip(아바타=`session.user.name` 첫 글자, email·workspace·plan, Sign out 버튼). `session` null 가드(미로그인 안내). 킷 Security/Danger zone(Password/Sessions/**Delete account**) 완전 미이식
  - **Workspace**: `useUIStore.locale/setLocale` → `SegmentedControl`(English/한국어). Theme는 "준비 중" placeholder. Library 뷰·정렬 설정 미이식
  - **Models**(회귀 핵심): Status strip(Ollama 연결/에러 + `useLlmModels` 카운트 + `refetchModels`). RowGroup "Chat & table"(`useActiveLlmModel`/`useSetLlmModel` Select + `source` 표시, Streaming/Guardian은 "준비 중"). RowGroup "Knowledge graph"(`useEntityGraphEnabled`/`useSetEntityGraphEnabled` On/Off SegmentedControl + 상세 경고문 / `useActiveEntityModel`/`useSetEntityModel` Select with `inherit`=채팅 모델 사용, `source==="llm"`↔inherit 매핑 / `useEntityBackfillStatus`+`useStartEntityBackfill` 백필 Row + 프로그레스 바 `processedPapers/totalPapers`). **백필은 토글과 무관·`desktopReady` 가드 보존**
  - **Desktop**: Runtime card(2×2 KV: `desktop.{version,platform,libraryPath,available}` 실제 바인딩, `desktopLoading`/`desktopReady` 가드). RowGroup File actions(`useDesktopPdfSelection`/`useRevealInExplorer`)·Backup(`useCreateDesktopBackup`+최근 백업 reveal)·Pipeline(`pipeline.requeueAll`). 선택 PDF 목록·최근 백업 경로 로컬 상태 유지(섹션 컴포넌트 내부로 이동). 모든 데스크톱 액션 `desktopReady` 비활성 가드 보존
  - **About**: `useDesktopRuntime.version`·런타임만 실제값 + 정적 프론트엔드 스택 메타. 킷 서비스 health StatusPill·Diagnostics(health-check IPC 없음)는 미이식(가짜 상태 금지)
- 보존: LLM 4훅 + entity 6훅 + 데스크톱 4훅 + auth 2훅 + `useUIStore` locale + 모든 핸들러(`handleEntityBackfill`/`handleRequeueAll` 등)·타입(`LlmModelInfo`/`EntityModelInfo`/`EntityBackfillStatus`/`OllamaModel`/`AuthSession`/`DesktopSnapshot`)·i18n(`localeText`/`t()`)
- lucide named import: `UserRound`/`Globe2`/`BrainCircuit`/`LaptopMinimal`/`Info`/`LogOut`/`RefreshCw`/`CheckCircle2`/`FolderOpen`/`ExternalLink`/`HardDriveDownload` (킷 CDN Icon 방식 미도입). `.eyebrow`/`.scroll-y`→인라인 style(FiguresView 선례). `tokens.css`·데이터·IPC·DB·Electron 무변경

## 네비게이션 (NavItem)
```
library → LibraryView / PaperDetailView
search  → SearchView
figures → FiguresView
chat    → ChatView
notes   → NotesView
processing → ProcessingView
settings → SettingsView
```

## 의존성
- 사용: Supabase (papers, figures, highlights, folders), Electron IPC (file 관련), pdfjs-dist, uiStore
- 사용됨: AppShell.tsx (MainContent switch)

## 현재 상태
- 구현 완료: 라이브러리 뷰, PDF 리더, 하이라이트, 폴더, 임포트, 프로세싱 뷰, 설정
