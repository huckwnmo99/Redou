-- Fix: BM25 검색 0건 반환 — websearch_to_tsquery AND 과다 → OR 기반 tsquery로 변경
-- websearch_to_tsquery는 모든 단어를 AND로 결합하여, 5+ 단어 쿼리에서 매칭이 불가능해짐.
-- 해결: 입력 텍스트를 영어 사전으로 stemming 후 OR(|)로 결합.
-- ts_rank_cd가 매칭 단어 수에 비례하여 점수를 부여하므로, 적합한 청크가 상위에 랭킹됨.

-- ============================================================
-- 1. Helper: 텍스트 → OR-based tsquery 변환 함수
-- ============================================================
CREATE OR REPLACE FUNCTION build_or_tsquery(input_text text)
RETURNS tsquery
LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
DECLARE
  agg text;
BEGIN
  SELECT string_agg(lex, ' | ')
  INTO agg
  FROM (
    SELECT DISTINCT unnest(lexemes) AS lex
    FROM ts_debug('english', input_text)
    WHERE alias NOT IN ('blank', 'space')
      AND lexemes IS NOT NULL
      AND array_length(lexemes, 1) > 0
  ) sub
  WHERE lex IS NOT NULL AND lex != '';

  IF agg IS NULL OR agg = '' THEN
    RETURN NULL;
  END IF;

  RETURN to_tsquery('english', agg);
END;
$$;

COMMENT ON FUNCTION build_or_tsquery(text) IS 'Converts input text to an OR-based tsquery using English stemming. Each word is stemmed independently and joined with OR (|).';

-- ============================================================
-- 2. match_chunks_bm25: websearch_to_tsquery → build_or_tsquery
-- ============================================================
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
DECLARE
  tsq tsquery;
BEGIN
  tsq := build_or_tsquery(query_text);

  -- 빈 tsquery면 빈 결과 반환
  IF tsq IS NULL THEN
    RETURN;
  END IF;

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
    ts_rank_cd(pc.fts, tsq)::float AS bm25_rank
  FROM paper_chunks pc
  LEFT JOIN paper_sections ps ON ps.id = pc.section_id
  WHERE pc.fts @@ tsq
    AND (filter_paper_ids IS NULL OR pc.paper_id = ANY(filter_paper_ids))
  ORDER BY bm25_rank DESC
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 3. match_figures_bm25: websearch_to_tsquery → build_or_tsquery
-- ============================================================
CREATE OR REPLACE FUNCTION match_figures_bm25(
  query_text text,
  match_count int DEFAULT 30,
  filter_item_types text[] DEFAULT ARRAY['table'],
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  figure_id    uuid,
  paper_id     uuid,
  figure_no    text,
  caption      text,
  item_type    text,
  summary_text text,
  page         int,
  bm25_rank    float
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  tsq tsquery;
BEGIN
  tsq := build_or_tsquery(query_text);

  -- 빈 tsquery면 빈 결과 반환
  IF tsq IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id AS figure_id,
    f.paper_id,
    f.figure_no,
    f.caption,
    f.item_type::text,
    f.summary_text,
    f.page,
    ts_rank_cd(f.fts, tsq)::float AS bm25_rank
  FROM figures f
  WHERE f.fts @@ tsq
    AND f.item_type = ANY(filter_item_types)
    AND (filter_paper_ids IS NULL OR f.paper_id = ANY(filter_paper_ids))
  ORDER BY bm25_rank DESC
  LIMIT match_count;
END;
$$;
