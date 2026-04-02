-- Atomic toggle for paper star (is_important) to avoid read-modify-write race condition
CREATE OR REPLACE FUNCTION toggle_paper_star(paper_id uuid)
RETURNS boolean
LANGUAGE sql
AS $$
  UPDATE papers
  SET is_important = NOT is_important
  WHERE id = paper_id
  RETURNING is_important;
$$;
