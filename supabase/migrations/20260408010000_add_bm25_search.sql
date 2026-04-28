-- Hybrid Search: Add BM25 full-text search capability to paper_chunks
-- Adds tsvector GENERATED STORED column + GIN index + BM25 RPC function

-- ============================================================
-- 1. Add fts tsvector column (auto-generated from text column)
-- ============================================================
ALTER TABLE paper_chunks
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(text, ''))
  ) STORED;

COMMENT ON COLUMN paper_chunks.fts IS 'BM25 full-text search tsvector (english config, auto-generated from text column)';

-- ============================================================
-- 2. Create GIN index for fast full-text search
-- ============================================================
CREATE INDEX idx_paper_chunks_fts ON paper_chunks USING GIN (fts);

-- ============================================================
-- 3. BM25 search RPC function
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
