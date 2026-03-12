-- Embedding search: fix vector dimension, add HNSW index, add match_chunks function

-- 1. Fix embedding column to explicit 384 dimensions (required for HNSW index)
ALTER TABLE chunk_embeddings
  ALTER COLUMN embedding TYPE vector(384);

-- 2. Create HNSW index for cosine similarity search
CREATE INDEX idx_embeddings_hnsw ON chunk_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. Semantic search function: returns ranked chunks by cosine similarity
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  paper_id uuid,
  section_id uuid,
  chunk_order int,
  page int,
  text text,
  token_count int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id AS chunk_id,
    pc.paper_id,
    pc.section_id,
    pc.chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    (1 - (ce.embedding <=> query_embedding))::float AS similarity
  FROM chunk_embeddings ce
  JOIN paper_chunks pc ON pc.id = ce.chunk_id
  WHERE (1 - (ce.embedding <=> query_embedding)) > match_threshold
    AND (filter_paper_ids IS NULL OR pc.paper_id = ANY(filter_paper_ids))
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
