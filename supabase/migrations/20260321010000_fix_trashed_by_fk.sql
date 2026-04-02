-- Fix trashed_by_user_id FK to add ON DELETE SET NULL
-- Without this, deleting an app_user who trashed a paper would fail with FK violation.

ALTER TABLE papers
  DROP CONSTRAINT IF EXISTS papers_trashed_by_user_id_fkey;

ALTER TABLE papers
  ADD CONSTRAINT papers_trashed_by_user_id_fkey
  FOREIGN KEY (trashed_by_user_id)
  REFERENCES app_users(id)
  ON DELETE SET NULL;
