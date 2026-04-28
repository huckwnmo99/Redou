# 논문 관리 & 리더
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

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
| `frontend/src/features/figures/FiguresView.tsx` | Figure/Table/Equation 갤러리 | ~683 |
| `frontend/src/features/import/ImportPdfDialog.tsx` | PDF 임포트 다이얼로그 | ~694 |
| `frontend/src/features/processing/ProcessingView.tsx` | 프로세싱 작업 큐 모니터링 | ~257 |
| `frontend/src/features/settings/SettingsView.tsx` | 설정 (모델 선택 포함) | ~487 |

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

### FiguresView
- 전체 라이브러리의 Figure/Table/Equation 브라우징
- item_type 필터 (figure/table/equation)
- 이미지 썸네일 + 캡션

### ProcessingView
- processing_jobs 테이블 실시간 표시
- 상태별: queued, running, succeeded, failed
- IPC 이벤트 JOB_PROGRESS/COMPLETED/FAILED 수신

### SettingsView
- LLM 모델 선택 (Ollama 모델 목록 + 현재 선택)
- 외부 서비스 상태 표시
- 라이브러리 경로 표시

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
