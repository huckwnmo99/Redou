-- Upgrade embedding dimensions: 384 → 1024
-- Model: nvidia/llama-nemotron-embed-1b-v2 (Matryoshka, truncated to 1024)
-- All existing embeddings are cleared because they are incompatible.

-- ============================================================
-- 1. Drop existing HNSW indexes (they reference the old dimension)
-- ============================================================
DROP INDEX IF EXISTS idx_embeddings_hnsw;
DROP INDEX IF EXISTS idx_highlight_embeddings_hnsw;
DROP INDEX IF EXISTS idx_papers_embedding;
DROP INDEX IF EXISTS idx_figures_embedding;

-- ============================================================
-- 2. Clear existing embeddings (384-dim, incompatible with 1024-dim)
-- ============================================================
UPDATE chunk_embeddings SET embedding = NULL;
UPDATE highlight_embeddings SET embedding = NULL;
UPDATE papers SET embedding = NULL;
UPDATE figures SET embedding = NULL;

-- ============================================================
-- 3. Alter columns to vector(1024)
-- ============================================================
ALTER TABLE chunk_embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE highlight_embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE papers ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE figures ALTER COLUMN embedding TYPE vector(1024);

-- ============================================================
-- 4. Recreate HNSW indexes
-- ============================================================
CREATE INDEX idx_embeddings_hnsw ON chunk_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_highlight_embeddings_hnsw ON highlight_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_papers_embedding ON papers
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_figures_embedding ON figures
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 5. Recreate match_chunks() with vector(1024)
-- ============================================================
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL,
  boost_section_names text[] DEFAULT NULL,
  section_boost float DEFAULT 0.08
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
  similarity   float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.chunk_id,
    pc.paper_id,
    pc.section_id,
    ps.name AS section_name,
    pc."order" AS chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    LEAST(
      (1 - (ce.embedding <=> query_embedding))::float
      + CASE
          WHEN boost_section_names IS NOT NULL
               AND ps.name IS NOT NULL
               AND ps.name ILIKE ANY(
                 SELECT '%' || unnest || '%' FROM unnest(boost_section_names)
               )
          THEN section_boost
          ELSE 0
        END,
      1.0
    )::float AS similarity
  FROM chunk_embeddings ce
  JOIN paper_chunks pc ON pc.id = ce.chunk_id
  LEFT JOIN paper_sections ps ON ps.id = pc.section_id
  WHERE (1 - (ce.embedding <=> query_embedding)) > match_threshold
    AND (filter_paper_ids IS NULL OR pc.paper_id = ANY(filter_paper_ids))
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 6. Recreate match_highlight_embeddings() with vector(1024)
-- ============================================================
CREATE OR REPLACE FUNCTION match_highlight_embeddings(
  query_embedding vector(1024),
  filter_preset_ids uuid[] DEFAULT NULL,
  filter_paper_ids uuid[] DEFAULT NULL,
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  highlight_id uuid,
  preset_id    uuid,
  paper_id     uuid,
  text_content text,
  note_text    text,
  similarity   float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    he.id,
    he.highlight_id,
    he.preset_id,
    he.paper_id,
    he.text_content,
    he.note_text,
    (1 - (he.embedding <=> query_embedding))::float AS similarity
  FROM highlight_embeddings he
  WHERE (1 - (he.embedding <=> query_embedding)) > match_threshold
    AND (filter_preset_ids IS NULL OR he.preset_id = ANY(filter_preset_ids))
    AND (filter_paper_ids IS NULL OR he.paper_id = ANY(filter_paper_ids))
  ORDER BY he.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 7. Recreate match_papers() with vector(1024)
-- ============================================================
CREATE OR REPLACE FUNCTION match_papers(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  paper_id         uuid,
  title            text,
  authors          jsonb,
  publication_year int,
  abstract         text,
  journal_name     text,
  doi              text,
  similarity       float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS paper_id,
    p.title,
    p.authors,
    p.publication_year,
    p.abstract,
    p.journal_name,
    p.doi,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM papers p
  WHERE p.embedding IS NOT NULL
    AND p.trashed_at IS NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
    AND (filter_paper_ids IS NULL OR p.id = ANY(filter_paper_ids))
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 8. Recreate match_figures() with vector(1024)
-- ============================================================
CREATE OR REPLACE FUNCTION match_figures(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20,
  filter_item_types text[] DEFAULT ARRAY['table', 'equation'],
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
  similarity   float
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
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM figures f
  WHERE f.embedding IS NOT NULL
    AND f.item_type = ANY(filter_item_types)
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
    AND (filter_paper_ids IS NULL OR f.paper_id = ANY(filter_paper_ids))
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- 9. Update embedding_model metadata in existing rows
-- ============================================================
UPDATE chunk_embeddings SET embedding_model = 'nvidia/llama-nemotron-embed-1b-v2', embedding_dim = 1024;
UPDATE highlight_embeddings SET embedding_model = 'nvidia/llama-nemotron-embed-1b-v2';
