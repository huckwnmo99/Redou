-- Performance indexes for common query patterns

-- highlights filtered by user_id (e.g. user-scoped highlight queries)
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON highlights(user_id);

-- paper_chunks filtered by paper_id (used by match_chunks RPC and chunk queries)
CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper_id ON paper_chunks(paper_id);
