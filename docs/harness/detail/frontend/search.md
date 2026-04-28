# 시맨틱 검색
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
벡��� 임베딩 기반 시맨틱 검색 UI. ���리를 임��딩하여 논문, 청크, Figure, 하이라이트, 노트를 검색하고 결과를 카테고리별로 표시한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/features/search/SearchView.tsx` | 검색 결과 화면 | ~451 |
| `frontend/src/features/search/SearchSidebar.tsx` | 검색 필터 사이드바 | — |
| `frontend/src/features/search/searchModel.ts` | 검색 결과 타입 + 변환 모델 | — |

## 주요 컴포넌트

### SearchView
- TopBar의 검색 입력 → uiStore.searchQuery 변경
- 쿼리 임베���: IPC EMBEDDING_GENERATE_QUERY → vLLM
- Supabase RPC 호출 (프론트엔드 직접):
  - `match_chunks(query_embedding)` → 청크 검색
  - `match_papers(query_embedding)` → 논문 검색
  - `match_figures(query_embedding)` → Figure/Table/Equation 검색
  - `match_highlight_embeddings(query_embedding)` → 하이라이트 검색
- 결과 탭: 전체(all) / 논문(papers) / 청크(chunks) / 노트(notes) / 그림(figures)

### searchModel.ts
- 타입 정의: SearchChunkResult, SearchNoteResult, SearchFigureResult, SearchGroups
- 결과 변환 로직: RPC 응답 → UI 표시용 모델

### SearchSidebar
- 하이라이트 프리셋 필터 (searchPresetFilter)
- 결과 카테고리 필터 (searchResultKind)

## 데이터 흐름
```
사용자 입력 (TopBar)
  → uiStore.searchQuery 변경
  → SearchView useEffect 감지
  → IPC: EMBEDDING_GENERATE_QUERY(text) → 2048-dim 벡터
  → 병렬 RPC 호출 (match_chunks, match_papers, match_figures, match_highlight_embeddings)
  → 결과 → searchModel 변환 → 카테고리별 렌더링
  → 클릭 → setSelectedPaperId + openPaperDetail(tab)
```

## 의존성
- 사용: Electron IPC (embedding:generate-query), Supabase RPC (4개 match 함수), uiStore
- 사용됨: AppShell (activeNav === "search")

## 현재 상태
- 구현 완료: 벡터 검색 (4종), 결과 표시, 필터
- BM25 검색은 프론트엔드 검색에 아직 미적용 (채팅 RAG에만 사용됨)
