# 시맨틱 검색
> 하네스 버전: v1.1 | 최종 갱신: 2026-05-31

## 개요
하이브리드(텍스트 매칭 + 벡터 임베딩) 검색 UI. 쿼리를 임베딩하여 논문/청크/Figure/하이라이트/노트를 동시에 검색하고, **paper-centric**으로 집계해 논문 1개 = 카드 1개로 표시한다. 디자인 킷 이식 완료(리디자인 4호 화면).

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/features/search/SearchView.tsx` | 검색 화면 (중앙 컬럼 820, 검색바·칩·결과 카드) | ~620 |
| `frontend/src/features/search/SearchSidebar.tsx` | 폴더 범위 + 하이라이트 프리셋 필터 (글로벌 LeftSidebar 소속) | — |
| `frontend/src/features/search/searchModel.ts` | 검색 결과 타입 + 텍스트 매칭 + paper-centric 퓨전 모델 | ~390 |

## 주요 컴포넌트

### SearchView
- 검색 입력 → `uiStore.searchQuery`. 카테고리 → `uiStore.searchResultKind`(7종). 폴더 범위 → `uiStore.activeFolderId`. 프리셋 → `uiStore.searchPresetFilter`.
- **하이브리드 검색**(쿼리 입력 시 텍스트+시맨틱 동시 실행 후 퓨전):
  - 텍스트 매칭: `buildSearchGroups`(papers/chunks/notes/figures 부분문자열 + `buildSnippet` 발췌).
  - 시맨틱 4훅(`@/lib/queries`, 각 `enabled: query>2`):
    - `useSemanticChunkSearch(query, filterIds)` → `match_chunks` (청크 pgvector)
    - `useSemanticPaperSearch(query, filterIds)` → `match_papers` (논문 제목/초록)
    - `useSemanticFigureSearch(query, ["figure","table","equation"], filterIds)` → `match_figures`
    - `useSearchHighlightEmbeddings(query, presetFilter, filterIds)` → 하이라이트 임베딩
  - 각 시맨틱 훅은 IPC `embedding.generateQuery`로 쿼리 임베딩 후 Supabase RPC 호출(threshold 0.35).
- **퓨전**: `buildUnifiedResults`가 텍스트+시맨틱을 **paper 단위로 집계** → `evidence[]`(소스 5종: title/content/highlight/note/figure) + score max로 정렬. `searchResultKind` scope로 소스 포함/제외 분기(카테고리 7종).
- 결과 클릭 `handleCardClick`: content/highlight/figure evidence에 page 있으면 PDF 페이지 점프, 아니면 overview. (`setActiveNav("library")` + `setSelectedPaperId` + `setReaderTargetAnchor`/`openPaperDetail`)

#### UI 구조 (킷 이식, 방향 A)
- 컨테이너: 중앙 컬럼(maxWidth 820, padding `32px 24px 80px`, overflow auto).
- 검색바: height 54 + 포커스 시 accent 글로우(`boxShadow 0 0 0 4px accent-subtle`) + ⌘K kbd(클릭 시 focus) + Esc로 clear + 결과 수(tabular-nums).
- **Hybrid 정보 칩**: 가짜 Semantic/Keyword 토글 대신 "Hybrid · 의미+키워드 동시" 정직 표시(검색은 항상 하이브리드).
- 카테고리 7칩: 전체/제목·초록/본문/하이라이트/노트/Figure/**테이블·수식**(equations). 각 칩 = 소스 아이콘(per-source color) + 카운트 뱃지. count=0이면 비활성(opacity + disabled).
- 결과 카드 `PaperResultCard`(3단): 좌측 소스 레일(대표 소스 아이콘 + p.N) / 본문(제목·스니펫 + 키워드 `<mark>` 강조) / 우측(매치% 색뱃지 `>70 success / >50 accent / else muted` + Open→). 하단에 다중 소스 뱃지(×N) 유지.
- 빈 상태: eyebrow 라벨 + Try 칩(도메인 일반 예시, 클릭→`setSearchQuery`) + 최근 논문(실데이터). **최근 검색 이력은 미구현**(킷 RECENT_SEARCHES 하드코딩 미채택).
- 결과 없음: search-x 아이콘 + 쿼리 인용 + 안내 2줄.

#### 표시용 헬퍼 (검색 로직 무관)
- `highlightSnippet(snippet, query)`: plain 스니펫에서 실 쿼리 토큰을 `<mark>`로 강조. **LaTeX 스니펫은 `LatexText`(KaTeX)로 렌더하고 mark 미적용**(`containsLatex` 분기).
- `chipCounts`(useMemo): 카테고리별 "매칭 evidence 있는 논문 수". `buildUnifiedResults`를 scope마다 재호출하지 않고 동일 검색 입력(groups + 시맨틱 결과)에서 직접 도출. figures vs equations는 `itemType`으로 분리. **표시용이며 검색 동작·정렬에 영향 없음**.
- `eyebrowStyle`(CSSProperties): 킷 `.eyebrow`(소문자 추적 라벨)를 인라인 style로 변환(SettingsView/FiguresView 선례).
- `sourceLabels`: 소스별 `{en, ko, icon, color}`. 킷 SOURCE_META의 per-source color(highlight `#f59e0b`/note `#a855f7`/figure `#22d3a0`/title accent/content secondary)를 레일·칩 아이콘 색으로 차용.

### searchModel.ts (읽기 전용 — 검색 로직, 무변경)
- 타입: `SearchChunkResult`/`SearchNoteResult`/`SearchFigureResult`/`SearchGroups`/`MatchEvidence`/`UnifiedPaperResult`.
- `applySearchScope(papers, folders, activeFolderId)` — 폴더/starred/recent 스코프.
- `buildSearchGroups` — 텍스트 매칭 + `buildSnippet`(쿼리 주변 발췌).
- `semanticResultsToChunks` — 시맨틱 결과 → 스니펫 매핑.
- `buildUnifiedResults` — paper별 집계 + evidence + score max + scope 분기(카테고리 7종).

### SearchSidebar (글로벌 LeftSidebar 소속, 킷엔 대응 없음 — 무변경)
- 폴더 범위(`activeFolderId`) + 하이라이트 프리셋 필터(`searchPresetFilter`).

## 데이터 흐름
```
사용자 입력 (SearchView 검색바) → uiStore.searchQuery
  ├─ 텍스트: buildSearchGroups(papers/chunks/notes/figures 부분문자열) → groups
  ├─ 시맨틱(4훅, query>2): IPC embedding.generateQuery → 2048-dim
  │   → match_chunks / match_papers / match_figures / match_highlight_embeddings (pgvector)
  ├─ 퓨전: buildUnifiedResults(groups + 시맨틱 + scope=searchResultKind)
  │   → paper-centric UnifiedPaperResult[] (evidence[] + score max, 정렬)
  ├─ chipCounts: 동일 입력에서 카테고리별 논문 수 도출(표시용)
  └─ 렌더: PaperResultCard[] (소스 레일 + 스니펫 mark + 매치% + 소스 뱃지)
      → 클릭 handleCardClick → PDF 페이지 점프 or overview
```

## 의존성
- 사용: Electron IPC(`embedding.generateQuery`), Supabase RPC(match_chunks/match_papers/match_figures/match_highlight_embeddings), `useUIStore`, `@/lib/queries`(데이터+시맨틱 훅), `@/components/LatexText`, `@/lib/locale`.
- 사용됨: AppShell (`activeNav === "search"`).

## 현재 상태
- 구현 완료: 하이브리드 검색(텍스트 + 벡터 4종), paper-centric 퓨전, 카테고리 7종 필터, 폴더/프리셋 스코프, 결과 클릭 PDF 점프, 디자인 킷 이식.
- BM25 검색은 프론트엔드 검색에 미적용(채팅 RAG에만 사용).
- 최근 검색 이력 영속화 미구현(향후 신규 기능 — 별도 스토어/DB 필요).
