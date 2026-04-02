-- highlight_embeddings table + match RPC
-- Previously only created manually in the live DB.

CREATE TABLE IF NOT EXISTS highlight_embeddings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id    uuid NOT NULL UNIQUE REFERENCES highlights(id) ON DELETE CASCADE,
  preset_id       uuid NOT NULL REFERENCES highlight_presets(id) ON DELETE CASCADE,
  paper_id        uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  text_content    text NOT NULL,
  note_text       text,
  embedding       vector(384),
  embedding_model text NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_highlight_embeddings_highlight ON highlight_embeddings (highlight_id);
CREATE INDEX IF NOT EXISTS idx_highlight_embeddings_paper ON highlight_embeddings (paper_id);
CREATE INDEX IF NOT EXISTS idx_highlight_embeddings_preset ON highlight_embeddings (preset_id);
CREATE INDEX IF NOT EXISTS idx_highlight_embeddings_hnsw ON highlight_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- RLS
ALTER TABLE highlight_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "highlight_embeddings_all_own" ON highlight_embeddings
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Semantic search RPC
CREATE OR REPLACE FUNCTION match_highlight_embeddings(
  query_embedding vector,
  filter_preset_ids uuid[] DEFAULT NULL,
  filter_paper_ids uuid[] DEFAULT NULL,
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  highlight_id uuid,
  preset_id uuid,
  paper_id uuid,
  text_content text,
  note_text text,
  similarity float
)
LANGUAGE plpgsql
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
