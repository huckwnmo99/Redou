-- Redou Initial Schema
-- Based on: docs/database/database_schema_draft.md
-- 19 tables (17 core + 2 optional) + indexes + enums

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- Enums / Controlled Values
-- ============================================================
create type reading_status as enum ('unread', 'reading', 'read', 'archived');
create type file_kind      as enum ('main_pdf', 'supplementary_pdf', 'figure_asset');
create type note_scope     as enum ('paper', 'section', 'chunk', 'figure', 'highlight');
create type note_type      as enum ('summary_note', 'relevance_note', 'presentation_note', 'result_note', 'followup_note', 'figure_note', 'question_note', 'custom');
create type job_type       as enum ('import_pdf', 'run_ocr', 'extract_metadata', 'parse_sections', 'extract_figures', 'generate_embeddings', 'generate_summary', 'create_backup');
create type job_status     as enum ('queued', 'running', 'succeeded', 'failed');
create type backup_status  as enum ('created', 'failed', 'imported');

-- ============================================================
-- 1. app_users
-- ============================================================
create table app_users (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  email         text,
  auth_provider text,
  role          text not null default 'owner',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 2. papers
-- ============================================================
create table papers (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null references app_users(id) on delete cascade,
  title                text not null,
  normalized_title     text,
  publication_year     int,
  journal_name         text,
  doi                  text,
  abstract             text,
  language             text not null default 'en',
  reading_status       reading_status not null default 'unread',
  is_important         boolean not null default false,
  should_revisit       boolean not null default false,
  publication_type     text,
  metadata_confidence  numeric,
  trashed_at           timestamptz,
  trashed_by_user_id   uuid references app_users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_papers_owner_created  on papers (owner_user_id, created_at desc);
create index idx_papers_trashed        on papers (trashed_at);
create index idx_papers_doi            on papers (doi) where doi is not null;
create index idx_papers_norm_title     on papers (normalized_title) where normalized_title is not null;

-- ============================================================
-- 3. paper_files
-- ============================================================
create table paper_files (
  id               uuid primary key default gen_random_uuid(),
  paper_id         uuid not null references papers(id) on delete cascade,
  file_kind        file_kind not null,
  original_filename text not null,
  stored_filename  text not null,
  stored_path      text not null,
  checksum_sha256  text,
  file_size_bytes  bigint,
  mime_type        text,
  is_primary       boolean not null default false,
  created_at       timestamptz not null default now()
);

create index idx_paper_files_checksum on paper_files (checksum_sha256) where checksum_sha256 is not null;

-- ============================================================
-- 4. paper_sections
-- ============================================================
create table paper_sections (
  id                uuid primary key default gen_random_uuid(),
  paper_id          uuid not null references papers(id) on delete cascade,
  section_name      text not null,
  section_order     int not null,
  page_start        int,
  page_end          int,
  raw_text          text not null,
  parser_confidence numeric,
  created_at        timestamptz not null default now()
);

create index idx_sections_order on paper_sections (paper_id, section_order);

-- ============================================================
-- 5. paper_chunks
-- ============================================================
create table paper_chunks (
  id                uuid primary key default gen_random_uuid(),
  paper_id          uuid not null references papers(id) on delete cascade,
  section_id        uuid references paper_sections(id) on delete set null,
  chunk_order       int not null,
  page              int,
  text              text not null,
  token_count       int,
  start_char_offset int,
  end_char_offset   int,
  parser_confidence numeric,
  created_at        timestamptz not null default now()
);

create index idx_chunks_order on paper_chunks (paper_id, chunk_order);
create index idx_chunks_page  on paper_chunks (paper_id, page);

-- ============================================================
-- 6. chunk_embeddings
-- ============================================================
create table chunk_embeddings (
  chunk_id        uuid primary key references paper_chunks(id) on delete cascade,
  embedding       vector,
  embedding_model text not null,
  embedding_dim   int,
  created_at      timestamptz not null default now()
);

create index idx_embeddings_model on chunk_embeddings (embedding_model);

-- ============================================================
-- 7. paper_summaries
-- ============================================================
create table paper_summaries (
  id                 uuid primary key default gen_random_uuid(),
  paper_id           uuid not null references papers(id) on delete cascade,
  version_no         int not null default 1,
  source_type        text not null default 'system',
  is_current         boolean not null default true,
  one_line_summary   text,
  objective          text,
  method_summary     text,
  main_results       text,
  limitations        text,
  conditions_summary text,
  created_by_user_id uuid references app_users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============================================================
-- 8. figures
-- ============================================================
create table figures (
  id                         uuid primary key default gen_random_uuid(),
  paper_id                   uuid not null references papers(id) on delete cascade,
  source_file_id             uuid references paper_files(id) on delete set null,
  figure_no                  text not null,
  caption                    text,
  page                       int,
  image_path                 text,
  summary_text               text,
  is_key_figure              boolean not null default false,
  is_presentation_candidate  boolean not null default false,
  created_at                 timestamptz not null default now()
);

create index idx_figures_paper on figures (paper_id, figure_no);

-- ============================================================
-- 9. figure_chunk_links
-- ============================================================
create table figure_chunk_links (
  figure_id  uuid not null references figures(id) on delete cascade,
  chunk_id   uuid not null references paper_chunks(id) on delete cascade,
  link_type  text not null,
  created_at timestamptz not null default now(),
  primary key (figure_id, chunk_id)
);

-- ============================================================
-- 10. folders
-- ============================================================
create table folders (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references app_users(id) on delete cascade,
  parent_folder_id uuid references folders(id) on delete cascade,
  name             text not null,
  slug             text,
  color_hex        text,
  sort_order       int,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_folders_tree on folders (owner_user_id, parent_folder_id, sort_order);

-- ============================================================
-- 11. paper_folders
-- ============================================================
create table paper_folders (
  paper_id            uuid not null references papers(id) on delete cascade,
  folder_id           uuid not null references folders(id) on delete cascade,
  assigned_by_user_id uuid references app_users(id),
  created_at          timestamptz not null default now(),
  primary key (paper_id, folder_id)
);

-- ============================================================
-- 12. tags
-- ============================================================
create table tags (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid references app_users(id) on delete cascade,
  name          text not null,
  slug          text not null,
  tag_type      text,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 13. paper_tags
-- ============================================================
create table paper_tags (
  paper_id            uuid not null references papers(id) on delete cascade,
  tag_id              uuid not null references tags(id) on delete cascade,
  assigned_by_user_id uuid references app_users(id),
  created_at          timestamptz not null default now(),
  primary key (paper_id, tag_id)
);

-- ============================================================
-- 14. highlight_presets
-- ============================================================
create table highlight_presets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references app_users(id) on delete cascade,
  name              text not null,
  color_hex         text not null,
  description       text,
  is_system_default boolean not null default false,
  is_active         boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create index idx_presets_user on highlight_presets (user_id, sort_order);

-- ============================================================
-- 15. highlights
-- ============================================================
create table highlights (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid not null references papers(id) on delete cascade,
  user_id       uuid not null references app_users(id) on delete cascade,
  preset_id     uuid not null references highlight_presets(id) on delete cascade,
  section_id    uuid references paper_sections(id) on delete set null,
  chunk_id      uuid references paper_chunks(id) on delete set null,
  page          int,
  selected_text text not null,
  start_anchor  jsonb,
  end_anchor    jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_highlights_paper on highlights (paper_id, user_id, page);

-- ============================================================
-- 16. notes
-- ============================================================
create table notes (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid not null references papers(id) on delete cascade,
  user_id       uuid not null references app_users(id) on delete cascade,
  note_scope    note_scope not null default 'paper',
  section_id    uuid references paper_sections(id) on delete set null,
  chunk_id      uuid references paper_chunks(id) on delete set null,
  figure_id     uuid references figures(id) on delete set null,
  highlight_id  uuid references highlights(id) on delete set null,
  page          int,
  selected_text text,
  note_type     note_type not null default 'custom',
  title         text,
  note_text     text not null,
  is_pinned     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_notes_paper on notes (paper_id, created_at desc);

-- ============================================================
-- 17. processing_jobs
-- ============================================================
create table processing_jobs (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid references papers(id) on delete cascade,
  user_id       uuid references app_users(id),
  job_type      job_type not null,
  status        job_status not null default 'queued',
  source_path   text,
  started_at    timestamptz,
  finished_at   timestamptz,
  error_message text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 18. backup_snapshots
-- ============================================================
create table backup_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_users(id) on delete cascade,
  backup_path     text not null,
  backup_kind     text not null,
  checksum_sha256 text,
  file_size_bytes bigint,
  status          backup_status not null default 'created',
  created_at      timestamptz not null default now()
);

-- ============================================================
-- 19. user_workspace_preferences
-- ============================================================
create table user_workspace_preferences (
  user_id                uuid primary key references app_users(id) on delete cascade,
  layout_name            text,
  left_panel_visible     boolean not null default true,
  right_panel_visible    boolean not null default true,
  notes_panel_detached   boolean not null default false,
  pdf_panel_detached     boolean not null default false,
  figures_panel_detached boolean not null default false,
  last_selected_tab      text,
  layout_payload         jsonb,
  updated_at             timestamptz not null default now()
);
