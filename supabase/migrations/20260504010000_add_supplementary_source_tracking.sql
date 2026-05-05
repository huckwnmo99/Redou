-- Supplementary source tracking
-- Adds source-file ownership so main PDFs and supplementary PDFs can be processed independently.

alter table paper_sections
  add column if not exists source_file_id uuid references paper_files(id) on delete set null;

alter table paper_chunks
  add column if not exists source_file_id uuid references paper_files(id) on delete set null;

alter table processing_jobs
  add column if not exists source_file_id uuid references paper_files(id) on delete set null;

create index if not exists idx_sections_source_order
  on paper_sections (paper_id, source_file_id, section_order);

create index if not exists idx_chunks_source_order
  on paper_chunks (paper_id, source_file_id, chunk_order);

create index if not exists idx_processing_jobs_source_status
  on processing_jobs (paper_id, source_file_id, status, created_at desc);

with chosen_file as (
  select distinct on (paper_id)
    paper_id,
    id
  from paper_files
  order by
    paper_id,
    case
      when is_primary and file_kind = 'main_pdf' then 0
      when is_primary then 1
      when file_kind = 'main_pdf' then 2
      else 3
    end,
    created_at desc
)
update paper_sections ps
set source_file_id = cf.id
from chosen_file cf
where ps.paper_id = cf.paper_id
  and ps.source_file_id is null;

with chosen_file as (
  select distinct on (paper_id)
    paper_id,
    id
  from paper_files
  order by
    paper_id,
    case
      when is_primary and file_kind = 'main_pdf' then 0
      when is_primary then 1
      when file_kind = 'main_pdf' then 2
      else 3
    end,
    created_at desc
)
update paper_chunks pc
set source_file_id = cf.id
from chosen_file cf
where pc.paper_id = cf.paper_id
  and pc.source_file_id is null;

with chosen_file as (
  select distinct on (paper_id)
    paper_id,
    id
  from paper_files
  order by
    paper_id,
    case
      when is_primary and file_kind = 'main_pdf' then 0
      when is_primary then 1
      when file_kind = 'main_pdf' then 2
      else 3
    end,
    created_at desc
)
update figures f
set source_file_id = cf.id
from chosen_file cf
where f.paper_id = cf.paper_id
  and f.source_file_id is null;

update processing_jobs pj
set source_file_id = pf.id
from paper_files pf
where pj.source_file_id is null
  and pj.paper_id = pf.paper_id
  and pj.source_path = pf.stored_path;

with chosen_file as (
  select distinct on (paper_id)
    paper_id,
    id
  from paper_files
  order by
    paper_id,
    case
      when is_primary and file_kind = 'main_pdf' then 0
      when is_primary then 1
      when file_kind = 'main_pdf' then 2
      else 3
    end,
    created_at desc
)
update processing_jobs pj
set source_file_id = cf.id
from chosen_file cf
where pj.paper_id = cf.paper_id
  and pj.source_file_id is null;

