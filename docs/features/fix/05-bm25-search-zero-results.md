# Fix: BM25 검색 0건 반환 — websearch_to_tsquery AND 연산 과다

> 유형: fix | 작성일: 2026-04-10 | 수정 완료: 2026-04-10

## 문제

- **증상**: Hybrid Search에서 BM25 검색이 항상 0건 반환. 벡터 검색만 동작 중.
  ```
  [Chat/RAG] 5 queries → 122 vector + 0 BM25 chunks, 56 figures → RRF 40 → reranked 15 (mode=table)
  ```
- **원인**: `match_chunks_bm25()` 및 `match_figures_bm25()` RPC 함수가 `websearch_to_tsquery('english', query_text)`를 사용하여 **모든 검색어를 AND로 결합**. Orchestrator가 생성하는 쿼리(5~10단어) + `keyword_hints`(5~7단어)가 합쳐진 `bm25QueryText`가 10~20개 AND 조건이 되어, 단일 청크에 모든 단어가 존재하는 경우는 사실상 없음.
- **근거**:

  **1. DB 레벨 검증 — RPC 함수 자체는 정상**
  ```sql
  -- 짧은 쿼리: 정상 동작 (3건 반환)
  SELECT count(*) FROM match_chunks_bm25('adsorption CO2 zeolite', 60, NULL);  -- → 3

  -- Orchestrator 스타일 긴 쿼리: 0건
  SELECT count(*) FROM match_chunks_bm25(
    'What are the adsorption capacities and kinetic parameters for CO2 on zeolite 13X?',
    60, NULL);  -- → 0

  -- 4개 단어 AND만으로도 0건
  SELECT count(*) FROM paper_chunks
  WHERE fts @@ to_tsquery('english', 'adsorpt & capac & co2 & zeolit');  -- → 0

  -- 같은 단어를 OR로 바꾸면 256건
  SELECT count(*) FROM paper_chunks
  WHERE fts @@ to_tsquery('english', 'adsorpt | capac | co2 | zeolit');  -- → 256
  ```

  **2. main.mjs 호출 코드에서 쿼리가 비대해지는 과정**
  ```
  bm25QueryText = searchQuery.query + " " + keywordHints.join(" ")
  ```
  - `main.mjs:2836` — 검색 쿼리와 모든 키워드 힌트를 단순 문자열 결합
  - Orchestrator 예시: query = `"kinetic model fitting parameters alpha beta D/R² diffusivity zeolite"` (9단어)
  - keyword_hints = `["alpha", "beta", "d/r²", "diffusivity", "kinetic", "fitting", "parameter"]` (7단어)
  - 결과 bm25QueryText = 16단어 → websearch_to_tsquery로 16개 AND 조건 → 매칭 불가

  **3. PostgREST/Supabase 클라이언트 경로도 정상**
  - `curl -X POST .../rpc/match_chunks_bm25`로 service_role 키와 함께 호출 시 정상 반환 확인
  - 문제는 RLS나 인증이 아닌, **tsquery 자체의 AND 과다**

## 수정 방안

### 핵심 변경: RPC 함수에서 tsquery를 OR 기반으로 변경

| 파일 | 수정 내용 |
|------|-----------|
| `supabase/migrations/신규_마이그레이션.sql` | `match_chunks_bm25()` 함수를 OR 기반 tsquery로 재생성, `match_figures_bm25()`도 동일 수정 |
| `apps/desktop/electron/main.mjs:2829~2836` | `bm25QueryText` 구성 로직 변경 — keyword_hints를 쿼리에 합치지 않고 별도 처리하거나, 핵심 3~5개 단어만 선별 |

### 상세 수정 사항

#### A. RPC 함수 수정 (신규 마이그레이션)

두 RPC 함수 모두 `websearch_to_tsquery`를 **커스텀 OR-기반 tsquery 생성**으로 교체:

**방법**: 입력 텍스트를 단어별로 분리 → 각 단어를 stemming (`to_tsquery('english', word)`) → `||` (OR)로 결합. 랭킹은 `ts_rank_cd`가 자동으로 매칭 단어 수에 비례하여 점수를 부여하므로, 더 많은 키워드가 매칭되는 청크가 상위에 위치함.

```sql
-- match_chunks_bm25: websearch_to_tsquery → OR-based tsquery
CREATE OR REPLACE FUNCTION match_chunks_bm25(
  query_text text,
  match_count int DEFAULT 60,
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (...) -- 반환 타입 동일
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  tsq tsquery;
BEGIN
  -- 단어별 분리 → 영어 stemming → OR 결합
  SELECT ts_rewrite(
    plainto_tsquery('english', query_text),
    -- plainto_tsquery는 AND를 사용하지만, 이것을 OR로 변환
    'SELECT ...'  -- 이 방식보다 아래 방식이 더 깔끔
  ) INTO tsq;

  -- 더 깔끔한 방법: 단어를 OR로 직접 결합
  SELECT string_agg(lexeme, ' | ')
  FROM unnest(to_tsvector('english', query_text))
  INTO tsq_text;
  tsq := to_tsquery('english', tsq_text);  -- 이미 stemming 된 상태

  RETURN QUERY
  SELECT ... FROM paper_chunks pc
  WHERE pc.fts @@ tsq
    AND (filter_paper_ids IS NULL OR pc.paper_id = ANY(filter_paper_ids))
  ORDER BY ts_rank_cd(pc.fts, tsq) DESC
  LIMIT match_count;
END;
$$;
```

**실제 구현**: `unnest(tsvector)` 또는 `regexp_split_to_table` + `to_tsquery` 조합으로 OR tsquery를 구축. 정확한 SQL은 `/fix` 에이전트가 PostgreSQL 문법에 맞춰 구현한다. 핵심 아이디어:

```sql
-- 입력 텍스트의 단어를 영어 사전으로 stemming 후 OR 결합
SELECT array_to_string(
  array_agg(DISTINCT lexeme),
  ' | '
)
FROM ts_debug('english', query_text)
WHERE alias NOT IN ('blank', 'space')
  AND lexeme IS NOT NULL
  AND lexeme != '';
```

이 결과를 `to_tsquery()`에 넣어 OR tsquery를 만들면, 각 단어가 개별적으로 매칭되되 더 많은 단어가 매칭될수록 `ts_rank_cd` 점수가 높아짐.

#### B. main.mjs의 bm25QueryText 구성 최적화

현재 문제: 모든 keyword_hints를 쿼리에 합침 → 불필요한 단어 과다.

수정 방향:
```javascript
// 변경 전 (main.mjs:2829-2836)
const bm25HintSuffix = (keywordHints ?? []).join(" ");
const bm25QueryText = (sq.query + " " + bm25HintSuffix).trim();

// 변경 후: keyword_hints는 BM25 쿼리에 합치지 않고, 쿼리 자체만 사용
// (keyword_hints는 Orchestrator가 이미 search_queries에 반영했으므로 중복)
const bm25QueryText = sq.query;
```

keyword_hints는 원래 Orchestrator가 search_queries를 설계할 때 이미 반영한 핵심 용어이므로, BM25 쿼리에 다시 합칠 필요가 없음. 합치면 오히려 AND 조건이 과다해져 역효과.

**대안**: keyword_hints 중 일부만 선택적으로 사용하고 싶다면, RPC 함수가 OR 기반으로 변경된 후에는 합쳐도 문제 없음 (OR이므로 더 많은 단어 = 더 넓은 검색). 다만 랭킹 품질을 위해 쿼리만 사용하는 것이 간결.

## 영향 범위

- 수정 파일: **3개**
  1. `supabase/migrations/YYYYMMDDHHMMSS_fix_bm25_or_tsquery.sql` (신규 — RPC 함수 재정의)
  2. `apps/desktop/electron/main.mjs` (2829~2836줄 — bm25QueryText 구성)
  3. `docs/harness/detail/database/rpc.md` (BM25 설정 설명 업데이트)
- DB 변경: 있음 (기존 RPC 함수 `CREATE OR REPLACE` — 스키마 변경은 아님, 함수 로직만 변경)
- 새 IPC 채널: 없음
- 새 컴포넌트: 없음
- `CURRENT_EXTRACTION_VERSION` 범프: 불필요
- 사이드 이펙트: BM25 검색이 OR 기반으로 변경되면 더 많은 결과가 반환됨. 이는 RRF 퓨전에서 벡터 검색과 합쳐지므로 오히려 Hybrid Search 품질이 향상됨. `ts_rank_cd`가 매칭 단어 비율에 비례하여 점수를 매기므로, 적합한 청크가 상위에 랭킹됨.

## 검증 방법

1. **마이그레이션 적용 후 DB 직접 테스트**:
   ```sql
   -- 긴 쿼리에서도 결과 반환 확인
   SELECT count(*) FROM match_chunks_bm25(
     'adsorption capacity kinetic parameters CO2 N2 CH4 zeolite 13X activated carbon pressure temperature',
     60, NULL);
   -- 기대: > 0건 (기존: 0건)

   -- 짧은 쿼리에서도 여전히 동작 확인
   SELECT count(*) FROM match_chunks_bm25('adsorption CO2 zeolite', 60, NULL);
   -- 기대: ≥ 3건 (기존과 동일 또는 증가)
   ```

2. **Electron 앱에서 채팅 테스트**:
   ```
   [Chat/RAG] N queries → M vector + K BM25 chunks
   ```
   - K > 0 확인 (기존: K = 0)
   - RRF 퓨전 후 결과 품질 비교

3. **Electron 문법 체크**:
   ```bash
   node --check apps/desktop/electron/main.mjs
   ```
