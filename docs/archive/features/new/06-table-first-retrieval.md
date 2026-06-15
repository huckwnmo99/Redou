# 테이블 우선 검색 (Table-first Retrieval) 구현

> 유형: feature | 상태: 계획 | 작성일: 2026-04-08

## 개요
- **목적**: 테이블 생성 시 논문 원본 테이블(figures item_type='table')을 우선 검색하여 정확한 수치 활용
- **범위**: figures BM25 검색 추가, figure RRF 퓨전, assembleRagContext 관련성 기반 정렬
- **제외**: Q&A 파이프라인 변경, Frontend 변경

## 현재 문제점

1. figures에 BM25 검색이 없음 — 벡터 유사도만 사용, 수치/키워드 매칭 불가
2. figures에 RRF/Reranker 파이프라인이 없음 — figureMap에 단순 누적
3. Backfill이 무차별적 — 스코프 내 모든 테이블을 similarity:0으로 추가
4. assembleRagContext OCR 섹션이 관련성 무시 — summary_text 길이순 정렬

## 설계: 3-레이어 개선

### 1. DB: figures BM25 검색

```sql
ALTER TABLE figures
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(plain_text, '') || ' ' || coalesce(caption, ''))
  ) STORED;

CREATE INDEX idx_figures_fts ON figures USING GIN (fts);

-- match_figures_bm25() RPC: 기본 item_types=['table']
```

`plain_text`(셀 값 평탄화) + `caption`(테이블 제목) 결합.

### 2. 검색: figure RRF + 테이블 부스트

```
변경 전: match_figures(vector) → figureMap 누적
변경 후: match_figures(vector) + match_figures_bm25 → rrfFusionFigures()
```

`rrfFusionFigures()`:
- BM25 0.6, Vector 0.4 (테이블 모드)
- `TABLE_BOOST = 0.005`: item_type='table'에 가산점 (3~5 랭크 상승 효과)

### 3. 조립: 관련성 기반 정렬

`assembleRagContext()` OCR 섹션:
- 정렬: summary_text 길이순 → **`_rrfScore` 관련성순**
- 예산: OCR 60K→70K, Matrix 30K→35K (테이블 데이터에 더 많은 예산)
- 텍스트 청크 헤더: "보조" → "테이블에 없는 보충 데이터"

## 작업 분해

1. [ ] DB 마이그레이션 — figures.fts + GIN 인덱스 + match_figures_bm25 RPC
2. [ ] `rrfFusionFigures()` 함수 추가
3. [ ] `runMultiQueryRag()` 수정 — match_figures_bm25 병렬 호출 + rrfFusionFigures
4. [ ] Backfill 로직 수정 — `_rrfScore: 0` 추가
5. [ ] `assembleRagContext()` 수정 — 관련성순 정렬 + 예산 조정

## 영향 범위
- 수정: `apps/desktop/electron/main.mjs` (1개 파일)
- 신규: `supabase/migrations/20260409010000_add_figures_bm25_search.sql`
- CURRENT_EXTRACTION_VERSION 범프: 불필요
- Frontend 변경: 없음

## 리스크 & 대안
- plain_text NULL인 figures → coalesce 처리 완료, caption만으로 BM25 매칭 가능
- 쿼리당 DB RPC 3→4개 → Promise.all 병렬이므로 레이턴시 미미
- TABLE_BOOST 과다 → 0.005는 보수적, 상수로 튜닝 용이
- Q&A 파이프라인에는 미적용 (테이블 우선 불필요)
