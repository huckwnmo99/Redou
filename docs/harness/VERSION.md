# Harness Version

## v1.6 — 2026-05-30
- SettingsView 디자인 킷 이식 (리디자인 2호 화면). 킷 **2-pane 섹션 레이아웃**(좌측 Account/Workspace/Models/Desktop/About 네비 + 우측 Row 패널)으로 `SettingsView.tsx` 전면 재구성. 기본 진입 섹션=account
- 프리미티브 TS 포팅: `SectionHeader`/`RowGroup`/`Row`/`Select`(네이티브 select 래퍼)/`SegmentedControl`/`Button`(icon=lucide 컴포넌트, primary/secondary/danger)/`Toast`(중앙 하단 z-index 100, 2.5초)/`ComingSoonPill`("준비 중" 비활성 칩). `.eyebrow`→인라인 `eyebrowStyle`, `.scroll-y`→인라인 overflow (FiguresView 선례)
- 섹션 컴포넌트: `AccountSection`(auth+identity strip, session null 가드)/`WorkspaceSection`(locale SegmentedControl)/`ModelsSection`(LLM Select + entity 토글·모델·백필·프로그레스 바 통합 — 회귀 핵심)/`DesktopSection`(Runtime card + File/Backup/Pipeline + 선택 PDF·최근 백업 로컬 상태)/`AboutSection`(desktop.version·런타임 실제값)
- 보존: LLM 4훅 + entity 6훅(`useEntityGraphEnabled`/`useSetEntityGraphEnabled`/`useActiveEntityModel`/`useSetEntityModel`/`useEntityBackfillStatus`/`useStartEntityBackfill`) + 데스크톱 4훅 + auth 2훅 + `useUIStore.locale/setLocale` + 전체 핸들러 + 타입(any 0) + i18n(킷 한국어 하드코딩 전부 `t()`). 백필은 토글과 무관·`desktopReady` 가드 유지
- 미이식(백엔드 없음): Streaming/Guardian/Theme = 비활성 "준비 중" placeholder로 자리만 표시(동작 로직 미연결). Library 뷰·정렬·Password·Active sessions·**Delete account(danger zone)**·Diagnostics·서비스 health StatusPill = 완전 미이식(가짜 버튼/상태 노출 금지)
- 데이터 계층/IPC/스토어/DB/Electron/`tokens.css` 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과. 커밋/비주얼 검증은 리뷰 단계
- feature-status.md: SettingsView 리디자인 행 ✅ 구현됨 처리. paper.md(v1.2): SettingsView 섹션 2-pane IA로 전면 갱신 + 파일 줄 수 보정

## v1.5 — 2026-05-30
- FiguresView 디자인 킷 이식 (리디자인 1호 시범 화면). 방향 A(1-pane 전역 갤러리) + 썸네일 A-1(paperId별 PDF doc 캐시) 채택
- `FiguresView.tsx` 전면 재구성: 2-pane(논문선택→그림) 폴더 동선 제거 → 필터칩(All/Figure/Table/Equation + 카운트) + 캡션·제목 검색 + 카드 그리드 + 라이트박스(키보드 ←/→/Esc)
- 실제 썸네일 로직 보존: `PageThumbnail`/`FigureImage`/`TableCropThumbnailCard`/`FigureCropThumbnailCard`/`usePaperPdfDoc`. 킷 가짜 placeholder 미채택
- 신규 `PaperDocCacheProvider`/`PaperDocLoader`/`usePaperDoc`(context): 전역 그리드에서 paperId별 PDF doc를 1개씩 공유 로드(imagePath 있는 그림은 doc 불필요)
- 신규 `FigureThumb`(실제 렌더 분기), `FigureCard`(킷 스타일+출처 라벨), `FigureGallery`, `FigureLightbox`(큰 미리보기=실제 렌더, "논문 열기"=`jumpToPage`)
- 보존: `useAllFigures`/`useAllPapers`/`usePrimaryPaperFile` 훅, `@/lib/desktop` IPC(`toDesktopFileUrl`/`useResolvedDesktopFilePath`/`useDesktopRuntime`), `useUIStore` PDF 점프 동선, `PaperFigure`/`Paper` 타입, `LatexText`(KaTeX 캡션), i18n `localeText`. 킷 한국어 하드코딩 전부 `t(en, ko)`로 래핑. `useFolders` import만 제거(Direction A에서 미사용)
- `tokens.css`: `--shadow-xs`, `--font-mono` 추가 + `.fig-card`/`.fig-zoom` hover 규칙(인라인 style로 :hover 불가)
- 데이터 계층/IPC/스토어/DB/Electron 무변경. `CURRENT_EXTRACTION_VERSION` 범프 불필요. 커밋/비주얼 검증은 리뷰 단계에서
- feature-status.md: FiguresView 리디자인 행 ✅ 구현됨 처리. paper.md: FiguresView 섹션 갱신(1-pane 갤러리). flows.md: Figure 갤러리 탐색 흐름 추가

## v1.4 — 2026-05-27
- Entity Graph opt-in 전환 (fix 16). `user_workspace_preferences.entity_graph_enabled` boolean(기본 false) 플래그로 자동 큐잉/QA graph 경로를 게이트
- 마이그레이션 `20260527073618_add_entity_graph_enabled.sql` 추가
- main.mjs: `getEntityGraphEnabled(userId)` 헬퍼, `enqueueEntityExtractionIfNeeded` 진입부 게이트, `handleQaPipeline` graph/plain 분기, `ENTITY_GET_GRAPH_ENABLED`/`ENTITY_SET_GRAPH_ENABLED` IPC 2개
- ipc-channels.mjs/preload.mjs: 채널 2개 + 브리지 2개. desktop.ts: `EntityGraphEnabledInfo` 타입 + entity 메서드 2개
- chatQueries.ts: `entityKeys.graphEnabled` + `useEntityGraphEnabled`/`useSetEntityGraphEnabled`. SettingsView.tsx: Entity Graph 패널에 opt-in 토글(수동 백필은 독립 유지, D1=나)
- feature-status.md: 엔티티 추출 행을 "✅ 구현됨 (opt-in, 기본 OFF)"로 갱신. flows.md: 임포트 흐름 opt-in 조건 + Q&A graph/plain 분기 정정. rag-pipeline.md: Q&A opt-in 섹션 추가. stores-queries.md: 엔티티/모델 훅 표 추가
- #15 미커밋분(paperSignals import+embedding 합성, ProcessingView 라벨, paperSignals.test.ts) 유지 — opt-in과 독립적으로 옳은 버그 수정. opt-in 전환으로 자동 entity job이 사라져 #15가 잡던 불일치는 신규 import에서 미발생(맥락만 하네스에 보정)

## v1.3 — 2026-05-27
- 라이브러리 "Complete" 상태와 실제 처리 상태 불일치 수정 (fix 15, 옵션 A1)
- `paperSignals.ts`가 core 파이프라인(import_pdf + generate_embeddings) 합성으로 카드 상태 계산 — 둘 다 succeeded일 때만 "Complete". entity는 제외(graceful-degradation)
- flows.md: PDF 임포트 흐름에 embedding 후 `extract_entities` 큐잉/처리 단계 추가
- feature-status.md: 엔티티 그래프 ✅ 구현됨 처리 + 라이브러리 카드 상태/엔티티 추출 항목 추가
- stores-queries.md: 라이브러리 카드 처리 상태 계산 섹션 추가

## v1.2 — 2026-04-10
- SRAG 통합 이슈 3건 수정 (Orchestrator clarify 과다 / 한글 인코딩 깨짐 / Guardian 검증 실패)
- llm.md 알려진 이슈 2~4번 수정 완료 처리

## v1.1 — 2026-04-10
- BM25 검색 0건 반환 버그 수정: `websearch_to_tsquery` → `build_or_tsquery` (OR 기반)
- database/rpc.md BM25 설정 섹션 갱신
- feature-status.md BM25 버그 상태 완료 처리

## v1.0 — 2026-04-10
- 초기 하네스 구축
- main/ 3개, detail/ 12개 파일 작성
- 코드베이스 실사 기반 (추측 없음)

## 변경 규칙
- major (v2.0): 하네스 구조 변경 (파일 추가/삭제/재편)
- minor (v1.1): 기존 파일 내용 갱신
- 모든 기능 추가/수정 커밋 ��� 관련 하네스 파일도 함께 갱신
