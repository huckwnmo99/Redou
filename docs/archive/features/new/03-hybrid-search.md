# Hybrid Search (BM25 + Vector) 구현

> 유형: feature | 상태: 계획 | 작성일: 2026-04-07

## 개요
- **목적**: 현재 pgvector 벡터 검색만 사용하는 RAG 파이프라인에 PostgreSQL tsvector 기반 BM25 키워드 검색을 추가하고, RRF(Reciprocal Rank Fusion)로 결과를 통합하여 검색 정밀도 향상
- **범위**: DB 스키마 확장 (tsvector 컬럼 + GIN 인덱스 + BM25 RPC), Electron 백엔드 하이브리드 검색 모듈, RRF 퓨전 로직, 기존 청크 백필
- **제외**: Reranker 추가 (별도 backlog/03), Frontend UI 변경 (검색 로직은 백엔드 내부), 외부 검색 서비스 도입

## 설계

### DB 변경

#### 1. `paper_chunks` 테이블에 `fts` 컬럼 추가

```sql
ALTER TABLE paper_chunks
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(text, ''))
  ) STORED;

COMMENT ON COLUMN paper_chunks.fts IS 'BM25 전문 검색용 tsvector (english config, text 컬럼 기반 자동 생성)';
```

**`GENERATED ALWAYS AS ... STORED` 선택 이유:**
- `text` 컬럼이 변경될 때 자동으로 `fts`가 갱신됨 — 별도 트리거 불필요
- 기존 데이터에 대해서도 ALTER 시점에 자동 계산됨 — 별도 백필 불필요
- PostgreSQL 12+ 지원, Supabase 로컬 PostgreSQL 15에서 완전 호환

**`english` 텍스트 검색 설정 선택 이유:**
- 논문 텍스트가 영어 기반이므로 영어 stemmer/stopword 사용
- 과학 용어("adsorption", "zeolite", "CO2")는 stemmer에 의해 정규화됨
- 숫자/화학식("5A", "99.99%", "3.5 g/cm³")은 tsvector에 그대로 토큰으로 포함

#### 2. GIN 인덱스 생성

```sql
CREATE INDEX idx_paper_chunks_fts ON paper_chunks USING GIN (fts);
```

#### 3. BM25 검색 RPC 함수

```sql
CREATE OR REPLACE FUNCTION match_chunks_bm25(
  query_text text,
  match_count int DEFAULT 60,
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id     uuid,
  paper_id     uuid,
  section_id   uuid,
  section_name text,
  chunk_order  int,
  page         int,
  text         text,
  token_count  int,
  bm25_rank    float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id AS chunk_id,
    pc.paper_id,
    pc.section_id,
    ps.section_name,
    pc.chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    ts_rank_cd(pc.fts, websearch_to_tsquery('english', query_text))::float AS bm25_rank
  FROM paper_chunks pc
  LEFT JOIN paper_sections ps ON ps.id = pc.section_id
  WHERE pc.fts @@ websearch_to_tsquery('english', query_text)
    AND (filter_paper_ids IS NULL OR pc.paper_id = ANY(filter_paper_ids))
  ORDER BY bm25_rank DESC
  LIMIT match_count;
END;
$$;
```

**`websearch_to_tsquery` 선택 이유:**
- `plainto_tsquery`와 달리 `OR`, `-` (NOT), `"구문 검색"` 지원
- 사용자 쿼리가 자연스럽게 AND로 처리됨

**`ts_rank_cd` 선택 이유:**
- cover density 기반이라 문맥상 가까운 키워드에 높은 점수
- BM25의 term proximity 효과를 근사

#### 4. 하이브리드 검색 RPC 함수 (불필요)

서버사이드 RRF를 하지 않는 이유: RRF 가중치를 `conversation_type`에 따라 동적으로 변경해야 하므로, Electron 코드에서 BM25 + Vector 결과를 각각 받아 클라이언트 사이드에서 RRF를 수행하는 것이 더 유연함.

마이그레이션 파일: `supabase/migrations/20260408010000_add_bm25_search.sql`

### Electron (Backend)

#### 핵심 변경: `runMultiQueryRag()` 함수 리팩토링

**변경 전 (현재 구조):**
```
runMultiQueryRag(searchQueries, keywordHints, filterPaperIds)
  └── for each query:
        ├── generateEmbedding(query) → match_chunks(vector)
        └── match_figures(vector)
  └── rerankChunksByKeywords(allChunks, keyTerms) ← JS 단 키워드 재랭킹
```

**변경 후 (하이브리드):**
```
runMultiQueryRag(searchQueries, keywordHints, filterPaperIds, mode)
  └── for each query:
        ├── generateEmbedding(query) → match_chunks(vector)    ← 기존 유지
        ├── match_chunks_bm25(query_text)                      ← 신규 BM25
        └── match_figures(vector)                               ← 기존 유지
  └── rrfFusion(vectorResults, bm25Results, mode)              ← 신규 RRF
      (rerankChunksByKeywords 대체)
```

#### 신규 함수: `rrfFusion(vectorChunks, bm25Chunks, mode, k = 60)`

```
RRF 공식: score(d) = Σ 1 / (k + rank_i(d))

mode에 따른 가중치:
  - "table": wBM25 = 0.6, wVector = 0.4
  - "qa":    wBM25 = 0.3, wVector = 0.7

알고리즘:
  1. vectorChunks에서 chunk_id별 vector_rank 매핑 생성
  2. bm25Chunks에서 chunk_id별 bm25_rank 매핑 생성
  3. 합집합의 모든 chunk_id에 대해:
     rrf_score = wVector * (1/(k + vector_rank)) + wBM25 * (1/(k + bm25_rank))
     (해당 리스트에 없는 청크는 rank = 1000으로 처리)
  4. rrf_score 내림차순 정렬 → top N 반환
```

RRF 상수 k = 60: 표준 RRF 논문(Cormack et al. 2009) 권장값.

#### `runMultiQueryRag()` 수정 상세

1. `mode` 파라미터 추가 (기본값: `"table"`)
2. 각 검색 쿼리에 대해 벡터 검색과 BM25 검색을 `Promise.all`로 병렬 실행
3. 벡터 결과와 BM25 결과를 각각 Map에 누적 (기존 chunkMap 패턴 유지)
4. 누적된 전체 벡터/BM25 결과에 대해 `rrfFusion()` 호출
5. 기존 `rerankChunksByKeywords()` 호출 제거 (RRF가 대체)

#### BM25 쿼리 텍스트 구성

```
BM25 쿼리 = sq.query + " " + keywordHints.join(" ")
```

`keywordHints`는 Orchestrator가 이미 생성하는 `keyword_hints` 배열.

#### 호출 체인 영향

`runMultiQueryRag()` 호출 지점 2곳:
1. **Table 파이프라인** (`main.mjs` ~2990행): `mode = "table"`
2. **Q&A 파이프라인** (`main.mjs` ~2805행, `handleQaPipeline()`): `mode = "qa"`

### 백필 전략

`GENERATED ALWAYS AS ... STORED` 사용으로 **별도 백필 불필요**. 마이그레이션 실행 시 기존 모든 행에 대해 자동 계산.

**CURRENT_EXTRACTION_VERSION 범프:** 불필요

### Frontend 변경

변경 불필요. 백엔드 내부 검색 전략 변경이며, IPC 인터페이스 동일 유지.

## 작업 분해

1. [ ] DB 마이그레이션 작성 — `supabase/migrations/20260408010000_add_bm25_search.sql`
   - `paper_chunks.fts` GENERATED STORED 컬럼 + GIN 인덱스 + `match_chunks_bm25()` RPC
2. [ ] `main.mjs`에 `rrfFusion()` 함수 추가
3. [ ] `runMultiQueryRag()` 리팩토링 — BM25 병렬 검색 + `rrfFusion()` + `mode` 파라미터
4. [ ] Table/Q&A 파이프라인 호출 지점에 `mode` 인자 추가
5. [ ] `rerankChunksByKeywords()` 호출 제거 (RRF가 대체)

## 영향 범위
- 수정: `apps/desktop/electron/main.mjs` (1개 파일)
- 신규: `supabase/migrations/20260408010000_add_bm25_search.sql` (1개 파일)
- CURRENT_EXTRACTION_VERSION 범프: 불필요
- IPC 추가: 없음
- Frontend 변경: 없음

## 리스크 & 대안
- `websearch_to_tsquery`가 특수문자 과학 용어("CO₂")를 못 파싱할 수 있음 → keywordHints가 ASCII 패턴으로 보완
- RRF 가중치(table: 0.6/0.4, qa: 0.3/0.7)가 최적이 아닐 수 있음 → 상수로 정의하여 쉽게 튜닝
- BM25 결과가 0건일 경우 → 벡터 결과만으로 순위 산출 (자연 fallback)

## 가정 사항
- [가정] PostgreSQL `tsvector` + GIN 인덱스가 데스크톱 규모에서 충분한 성능 제공
- [가정] `GENERATED ALWAYS AS ... STORED`는 Supabase 로컬 PostgreSQL 15에서 지원됨
- [가정] `match_figures`는 벡터 검색만 유지 (figures에는 BM25 미적용)
- [가정] `extractKeyTerms()` 함수는 유지하되, BM25 쿼리 텍스트 구성에만 활용
