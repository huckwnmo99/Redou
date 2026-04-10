-- Hybrid Search: Add BM25 full-text search capability to figures
-- Adds tsvector GENERATED STORED column + GIN index + BM25 RPC function

-- ============================================================
-- 1. Add fts tsvector column (auto-generated from plain_text + caption)
-- ============================================================
ALTER TABLE figures
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(plain_text, '') || ' ' || coalesce(caption, ''))
  ) STORED;

COMMENT ON COLUMN figures.fts IS 'BM25 full-text search tsvector (english config, auto-generated from plain_text + caption)';

-- ============================================================
-- 2. Create GIN index for fast full-text search
-- ============================================================
CREATE INDEX idx_figures_fts ON figures USING GIN (fts);

-- ============================================================
-- 3. BM25 search RPC function for figures
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
BEGIN
  RETURN QUERY
  SELECT
    f.id AS figure_id,
    f.paper_id,
    f.figure_no,
    f.caption,
    f.item_type::text,
    f.summary_text,
    f.page,
    ts_rank_cd(f.fts, websearch_to_tsquery('english', query_text))::float AS bm25_rank
  FROM figures f
  WHERE f.fts @@ websearch_to_tsquery('english', query_text)
    AND f.item_type = ANY(filter_item_types)
    AND (filter_paper_ids IS NULL OR f.paper_id = ANY(filter_paper_ids))
  ORDER BY bm25_rank DESC
  LIMIT match_count;
END;
$$;
