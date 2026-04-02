-- ============================================================
-- Enable RLS on all tables + per-table policies
-- Pattern: authenticated users access only their own data
-- ============================================================

-- ============================================================
-- 1. app_users — user can manage own profile
-- ============================================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_users_select_own" ON app_users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "app_users_insert_own" ON app_users
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "app_users_update_own" ON app_users
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ============================================================
-- 2. papers — owner access
-- ============================================================
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "papers_all_own" ON papers
  FOR ALL USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ============================================================
-- 3. paper_files — via paper ownership
-- ============================================================
ALTER TABLE paper_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_files_all_via_paper" ON paper_files
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_files.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_files.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 4. paper_sections — via paper ownership
-- ============================================================
ALTER TABLE paper_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_sections_all_via_paper" ON paper_sections
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_sections.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_sections.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 5. paper_chunks — via paper ownership
-- ============================================================
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_chunks_all_via_paper" ON paper_chunks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_chunks.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_chunks.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 6. chunk_embeddings — via paper_chunks → papers
-- ============================================================
ALTER TABLE chunk_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chunk_embeddings_all_via_paper" ON chunk_embeddings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM paper_chunks
      JOIN papers ON papers.id = paper_chunks.paper_id
      WHERE paper_chunks.id = chunk_embeddings.chunk_id
        AND papers.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM paper_chunks
      JOIN papers ON papers.id = paper_chunks.paper_id
      WHERE paper_chunks.id = chunk_embeddings.chunk_id
        AND papers.owner_user_id = auth.uid()
    )
  );

-- ============================================================
-- 7. paper_summaries — via paper ownership
-- ============================================================
ALTER TABLE paper_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_summaries_all_via_paper" ON paper_summaries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_summaries.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_summaries.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 8. figures — via paper ownership
-- ============================================================
ALTER TABLE figures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "figures_all_via_paper" ON figures
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = figures.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = figures.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 9. figure_chunk_links — via figures → papers
-- ============================================================
ALTER TABLE figure_chunk_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "figure_chunk_links_all_via_paper" ON figure_chunk_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM figures
      JOIN papers ON papers.id = figures.paper_id
      WHERE figures.id = figure_chunk_links.figure_id
        AND papers.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM figures
      JOIN papers ON papers.id = figures.paper_id
      WHERE figures.id = figure_chunk_links.figure_id
        AND papers.owner_user_id = auth.uid()
    )
  );

-- ============================================================
-- 10. folders — owner access
-- ============================================================
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_all_own" ON folders
  FOR ALL USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ============================================================
-- 11. paper_folders — via paper ownership
-- ============================================================
ALTER TABLE paper_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_folders_all_via_paper" ON paper_folders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_folders.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_folders.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 12. tags — owner access
-- ============================================================
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_all_own" ON tags
  FOR ALL USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ============================================================
-- 13. paper_tags — via paper ownership
-- ============================================================
ALTER TABLE paper_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_tags_all_via_paper" ON paper_tags
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_tags.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_tags.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 14. highlight_presets — user access
-- ============================================================
ALTER TABLE highlight_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "highlight_presets_all_own" ON highlight_presets
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 15. highlights — user access
-- ============================================================
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "highlights_all_own" ON highlights
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 16. notes — user access
-- ============================================================
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_all_own" ON notes
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 17. processing_jobs — user access (user_id nullable, also allow own papers)
-- ============================================================
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "processing_jobs_all_own" ON processing_jobs
  FOR ALL USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM papers WHERE papers.id = processing_jobs.paper_id AND papers.owner_user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM papers WHERE papers.id = processing_jobs.paper_id AND papers.owner_user_id = auth.uid())
  );

-- ============================================================
-- 18. backup_snapshots — user access
-- ============================================================
ALTER TABLE backup_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backup_snapshots_all_own" ON backup_snapshots
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 19. user_workspace_preferences — user access
-- ============================================================
ALTER TABLE user_workspace_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_workspace_preferences_all_own" ON user_workspace_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
