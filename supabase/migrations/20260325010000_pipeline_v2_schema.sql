-- Pipeline V2: OpenDataLoader + GROBID 마이그레이션 스키마
-- paper_references 신규 테이블, papers/figures 임베딩 컬럼, RPC 함수

-- ============================================================
-- 1. paper_references 테이블 (GROBID 참고문헌)
-- ============================================================

CREATE TABLE IF NOT EXISTS paper_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  ref_order integer NOT NULL,
  ref_title text,
  ref_authors jsonb DEFAULT '[]'::jsonb,
  ref_year integer,
  ref_journal text,
  ref_doi text,
  ref_volume text,
  ref_pages text,
  ref_raw_text text,
  linked_paper_id uuid REFERENCES papers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_refs_paper
  ON paper_references(paper_id, ref_order);
CREATE INDEX IF NOT EXISTS idx_paper_refs_doi
  ON paper_references(ref_doi) WHERE ref_doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paper_refs_linked
  ON paper_references(linked_paper_id) WHERE linked_paper_id IS NOT NULL;

-- RLS
ALTER TABLE paper_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_references_all_via_paper" ON paper_references
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = paper_references.paper_id
        AND papers.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = paper_references.paper_id
        AND papers.owner_user_id = auth.uid()
    )
  );

-- ============================================================
-- 2. papers 테이블 변경
-- ============================================================

-- 추출 소스 컬럼
ALTER TABLE papers ADD COLUMN IF NOT EXISTS extraction_source text;

-- 논문 단위 임베딩 (title + abstract → vector)
ALTER TABLE papers ADD COLUMN IF NOT EXISTS embedding vector(384);

-- HNSW 인덱스 (논문 시맨틱 검색)
CREATE INDEX IF NOT EXISTS idx_papers_embedding
  ON papers USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 3. figures 테이블 변경
-- ============================================================

-- 검색용 평탄화 텍스트
ALTER TABLE figures ADD COLUMN IF NOT EXISTS plain_text text;

-- 테이블/수식 임베딩
ALTER TABLE figures ADD COLUMN IF NOT EXISTS embedding vector(384);

-- HNSW 인덱스 (테이블/수식 시맨틱 검색)
CREATE INDEX IF NOT EXISTS idx_figures_embedding
  ON figures USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 4. match_papers() RPC — 논문 단위 시맨틱 검색
-- ============================================================

CREATE OR REPLACE FUNCTION match_papers(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  paper_id uuid,
  title text,
  authors jsonb,
  publication_year integer,
  abstract text,
  journal_name text,
  doi text,
  similarity float
)
LANGUAGE plpgsql AS $$
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
-- 5. match_figures() RPC — 테이블/수식 시맨틱 검색
-- ============================================================

CREATE OR REPLACE FUNCTION match_figures(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20,
  filter_item_types text[] DEFAULT ARRAY['table', 'equation'],
  filter_paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  figure_id uuid,
  paper_id uuid,
  figure_no text,
  caption text,
  item_type text,
  summary_text text,
  page integer,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id AS figure_id,
    f.paper_id,
    f.figure_no,
    f.caption,
    f.item_type,
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
