-- Ontology-Based Entity Extraction + Graph-Enhanced Search
-- Adds entities / entity_relations tables, RLS, RPCs, and job_type enum value.

-- ============================================================
-- 0. job_type enum — add 'extract_entities'
-- ============================================================

ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'extract_entities';

-- ============================================================
-- 1. entities 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id       uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  chunk_id       uuid REFERENCES paper_chunks(id) ON DELETE SET NULL,
  entity_type    text NOT NULL CHECK (entity_type IN (
                   'substance','method','condition','metric','phenomenon','concept')),
  raw_name       text NOT NULL,
  canonical_name text NOT NULL,
  value          text,         -- 수치값 (조건/지표용)
  unit           text,         -- 단위
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  confidence_tag text NOT NULL DEFAULT 'EXTRACTED'
                   CHECK (confidence_tag IN ('EXTRACTED','INFERRED','AMBIGUOUS')),
  source_hint    text,
  embedding      vector(2048), -- 기존 패턴 동일 (chunk_embeddings와 같은 차원), 인덱스 없음
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entities_paper
  ON entities (paper_id);
CREATE INDEX IF NOT EXISTS idx_entities_canonical
  ON entities (canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_type
  ON entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_paper_canon
  ON entities (paper_id, canonical_name);

-- ============================================================
-- 2. entity_relations 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_relations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type     text NOT NULL CHECK (relation_type IN (
                      'affects','correlates_with','measures','uses',
                      'compared_to','outperforms','produces','same_as')),
  direction         text NOT NULL DEFAULT 'neutral'
                      CHECK (direction IN ('positive','negative','neutral','bidirectional')),
  source_paper_id   uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  evidence_chunk_id uuid REFERENCES paper_chunks(id) ON DELETE SET NULL,
  confidence        text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  confidence_tag    text NOT NULL DEFAULT 'EXTRACTED'
                      CHECK (confidence_tag IN ('EXTRACTED','INFERRED','AMBIGUOUS')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_entity_id, target_entity_id, relation_type, source_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_rel_source
  ON entity_relations (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target
  ON entity_relations (target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_paper
  ON entity_relations (source_paper_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_type
  ON entity_relations (relation_type);

-- ============================================================
-- 3. 기존 테이블 확장
-- ============================================================

-- papers: 엔티티 추출 버저닝 (extraction_version과 독립)
ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS entity_extraction_version int DEFAULT 0;

-- user_workspace_preferences: 엔티티 추출 전용 모델 (llm_model 옆)
ALTER TABLE user_workspace_preferences
  ADD COLUMN IF NOT EXISTS entity_extraction_model text;

COMMENT ON COLUMN user_workspace_preferences.entity_extraction_model
  IS '엔티티 추출 전용 LLM 모델. NULL이면 llm_model(채팅 모델)을 사용';

-- ============================================================
-- 4. RLS 정책 (paper_references 패턴 — 논문 소유자만 접근)
-- ============================================================

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entities_via_paper" ON entities;
CREATE POLICY "entities_via_paper" ON entities
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = entities.paper_id
        AND papers.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = entities.paper_id
        AND papers.owner_user_id = auth.uid()
    )
  );

ALTER TABLE entity_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_relations_via_paper" ON entity_relations;
CREATE POLICY "entity_relations_via_paper" ON entity_relations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = entity_relations.source_paper_id
        AND papers.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM papers
      WHERE papers.id = entity_relations.source_paper_id
        AND papers.owner_user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. RPC 함수 4개
-- ============================================================

-- (1) match_entities — 의미 기반 엔티티 검색 (2048-dim embedding)
CREATE OR REPLACE FUNCTION match_entities(
  query_embedding vector(2048),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 20,
  filter_paper_ids uuid[] DEFAULT NULL,
  filter_types text[] DEFAULT NULL
)
RETURNS TABLE (
  entity_id uuid,
  paper_id uuid,
  chunk_id uuid,
  entity_type text,
  canonical_name text,
  value text,
  unit text,
  confidence text,
  confidence_tag text,
  similarity float
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS entity_id,
    e.paper_id,
    e.chunk_id,
    e.entity_type,
    e.canonical_name,
    e.value,
    e.unit,
    e.confidence,
    e.confidence_tag,
    (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM entities e
  WHERE e.embedding IS NOT NULL
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
    AND (filter_paper_ids IS NULL OR e.paper_id = ANY(filter_paper_ids))
    AND (filter_types IS NULL OR e.entity_type = ANY(filter_types))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- (2) resolve_same_as — same_as 재귀 확장 (쿼리 시점 union)
CREATE OR REPLACE FUNCTION resolve_same_as(seed_entity_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result uuid[];
BEGIN
  IF seed_entity_ids IS NULL OR array_length(seed_entity_ids, 1) IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  WITH RECURSIVE expand(id) AS (
    SELECT unnest(seed_entity_ids)
    UNION
    SELECT CASE WHEN er.source_entity_id = expand.id
                THEN er.target_entity_id
                ELSE er.source_entity_id END
    FROM expand
    JOIN entity_relations er
      ON (er.source_entity_id = expand.id OR er.target_entity_id = expand.id)
    WHERE er.relation_type = 'same_as'
  )
  SELECT array_agg(DISTINCT id) INTO result FROM expand;

  RETURN COALESCE(result, ARRAY[]::uuid[]);
END;
$$;

-- (3) graph_traverse_1hop — 1-hop 이웃 순회 → chunk_ids (필터 無, 전체 순회)
CREATE OR REPLACE FUNCTION graph_traverse_1hop(
  seed_entity_ids uuid[],
  max_results int DEFAULT 50
)
RETURNS TABLE (
  chunk_id uuid,
  paper_id uuid,
  neighbor_entity_id uuid,
  neighbor_canonical_name text,
  relation_type text,
  direction text,
  hop int
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF seed_entity_ids IS NULL OR array_length(seed_entity_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH neighbors AS (
    SELECT
      er.target_entity_id AS neighbor_entity_id,
      er.source_paper_id  AS paper_id,
      er.evidence_chunk_id AS chunk_id,
      er.relation_type,
      er.direction
    FROM entity_relations er
    WHERE er.source_entity_id = ANY(seed_entity_ids)
      AND er.relation_type != 'same_as'
    UNION ALL
    SELECT
      er.source_entity_id,
      er.source_paper_id,
      er.evidence_chunk_id,
      er.relation_type,
      er.direction
    FROM entity_relations er
    WHERE er.target_entity_id = ANY(seed_entity_ids)
      AND er.relation_type != 'same_as'
  )
  SELECT
    n.chunk_id,
    n.paper_id,
    n.neighbor_entity_id,
    e.canonical_name,
    n.relation_type,
    n.direction,
    1 AS hop
  FROM neighbors n
  JOIN entities e ON e.id = n.neighbor_entity_id
  WHERE n.chunk_id IS NOT NULL
  LIMIT max_results;
END;
$$;

-- (4) god_nodes — 여러 논문에 등장한 중심 엔티티 top-N
CREATE OR REPLACE FUNCTION god_nodes(
  min_paper_count int DEFAULT 3,
  max_results int DEFAULT 20
)
RETURNS TABLE (
  entity_id uuid,
  canonical_name text,
  entity_type text,
  paper_count bigint,
  relation_count bigint
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS entity_id,
    e.canonical_name,
    e.entity_type,
    COUNT(DISTINCT e.paper_id) AS paper_count,
    COUNT(DISTINCT er.id) AS relation_count
  FROM entities e
  LEFT JOIN entity_relations er
    ON (er.source_entity_id = e.id OR er.target_entity_id = e.id)
  GROUP BY e.id, e.canonical_name, e.entity_type
  HAVING COUNT(DISTINCT e.paper_id) >= min_paper_count
  ORDER BY COUNT(DISTINCT e.paper_id) DESC, COUNT(DISTINCT er.id) DESC
  LIMIT max_results;
END;
$$;
