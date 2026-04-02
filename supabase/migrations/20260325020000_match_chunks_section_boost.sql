-- Section boosting: match_chunks에 섹션명 반환 + 부스트 파라미터 추가
-- 쿼리 의도에 맞는 섹션(예: Method, Experimental)의 청크에 유사도 점수 부스트 적용

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL,
  boost_section_names text[] DEFAULT NULL,
  section_boost float DEFAULT 0.08
)
RETURNS TABLE (
  chunk_id uuid,
  paper_id uuid,
  section_id uuid,
  section_name text,
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
    ps.section_name,
    pc.chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    LEAST(
      (1 - (ce.embedding <=> query_embedding))::float
      + CASE
          WHEN boost_section_names IS NOT NULL
               AND ps.section_name IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM unnest(boost_section_names) AS bn
                 WHERE lower(ps.section_name) LIKE '%' || lower(bn) || '%'
               )
          THEN section_boost
          ELSE 0.0
        END,
      1.0  -- cap at 1.0
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
