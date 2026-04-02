-- Add authors JSONB column to papers table.
-- Stores an array of { name: string, affiliation?: string } objects.
-- Simpler than a separate paper_authors table; authors are paper metadata.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS authors jsonb NOT NULL DEFAULT '[]'::jsonb;

-- GIN index for querying by author name: e.g. papers WHERE authors @> '[{"name":"Smith"}]'
CREATE INDEX IF NOT EXISTS idx_papers_authors ON papers USING gin (authors);
