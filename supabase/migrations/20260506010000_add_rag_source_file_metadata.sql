-- Add source-file metadata to RAG retrieval RPCs so retrieved evidence can be
-- labeled as main PDF or supplementary material in answers and table refs.

drop function if exists public.match_chunks(vector, double precision, integer, uuid[], text[], double precision);
drop function if exists public.match_figures(vector, double precision, integer, text[], uuid[]);
drop function if exists public.match_chunks_bm25(text, integer, uuid[]);
drop function if exists public.match_figures_bm25(text, integer, text[], uuid[]);

create or replace function public.match_chunks(
  query_embedding vector(2048),
  match_threshold float default 0.35,
  match_count int default 20,
  filter_paper_ids uuid[] default null,
  boost_section_names text[] default null,
  section_boost float default 0.08
)
returns table (
  chunk_id uuid,
  paper_id uuid,
  section_id uuid,
  section_name text,
  chunk_order int,
  page int,
  text text,
  token_count int,
  similarity float,
  source_file_id uuid,
  source_file_kind text,
  source_filename text
)
language plpgsql stable
as $$
begin
  return query
  select
    ce.chunk_id,
    pc.paper_id,
    pc.section_id,
    ps.section_name as section_name,
    pc.chunk_order as chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    least(
      (1 - (ce.embedding <=> query_embedding))::float
      + case
          when boost_section_names is not null
               and ps.section_name is not null
               and ps.section_name ilike any(
                 select '%' || unnest || '%' from unnest(boost_section_names)
               )
          then section_boost
          else 0
        end,
      1.0
    )::float as similarity,
    pc.source_file_id,
    pf.file_kind::text as source_file_kind,
    coalesce(pf.original_filename, pf.stored_filename) as source_filename
  from chunk_embeddings ce
  join paper_chunks pc on pc.id = ce.chunk_id
  left join paper_sections ps on ps.id = pc.section_id
  left join paper_files pf on pf.id = pc.source_file_id
  where (1 - (ce.embedding <=> query_embedding)) > match_threshold
    and (filter_paper_ids is null or pc.paper_id = any(filter_paper_ids))
  order by similarity desc
  limit match_count;
end;
$$;

create or replace function public.match_figures(
  query_embedding vector(2048),
  match_threshold float default 0.3,
  match_count int default 20,
  filter_item_types text[] default array['figure', 'table', 'equation'],
  filter_paper_ids uuid[] default null
)
returns table (
  figure_id uuid,
  paper_id uuid,
  figure_no text,
  caption text,
  item_type text,
  summary_text text,
  page int,
  similarity float,
  source_file_id uuid,
  source_file_kind text,
  source_filename text
)
language plpgsql stable
as $$
begin
  return query
  select
    f.id as figure_id,
    f.paper_id,
    f.figure_no,
    f.caption,
    f.item_type::text,
    f.summary_text,
    f.page,
    1 - (f.embedding <=> query_embedding) as similarity,
    f.source_file_id,
    pf.file_kind::text as source_file_kind,
    coalesce(pf.original_filename, pf.stored_filename) as source_filename
  from figures f
  left join paper_files pf on pf.id = f.source_file_id
  where f.embedding is not null
    and f.item_type = any(filter_item_types)
    and 1 - (f.embedding <=> query_embedding) > match_threshold
    and (filter_paper_ids is null or f.paper_id = any(filter_paper_ids))
  order by f.embedding <=> query_embedding
  limit match_count;
end;
$$;

create or replace function public.match_chunks_bm25(
  query_text text,
  match_count int default 60,
  filter_paper_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  paper_id uuid,
  section_id uuid,
  section_name text,
  chunk_order int,
  page int,
  text text,
  token_count int,
  bm25_rank float,
  source_file_id uuid,
  source_file_kind text,
  source_filename text
)
language plpgsql stable
as $$
declare
  tsq tsquery;
begin
  tsq := build_or_tsquery(query_text);

  if tsq is null then
    return;
  end if;

  return query
  select
    pc.id as chunk_id,
    pc.paper_id,
    pc.section_id,
    ps.section_name,
    pc.chunk_order,
    pc.page,
    pc.text,
    pc.token_count,
    ts_rank_cd(pc.fts, tsq)::float as bm25_rank,
    pc.source_file_id,
    pf.file_kind::text as source_file_kind,
    coalesce(pf.original_filename, pf.stored_filename) as source_filename
  from paper_chunks pc
  left join paper_sections ps on ps.id = pc.section_id
  left join paper_files pf on pf.id = pc.source_file_id
  where pc.fts @@ tsq
    and (filter_paper_ids is null or pc.paper_id = any(filter_paper_ids))
  order by bm25_rank desc
  limit match_count;
end;
$$;

create or replace function public.match_figures_bm25(
  query_text text,
  match_count int default 30,
  filter_item_types text[] default array['table'],
  filter_paper_ids uuid[] default null
)
returns table (
  figure_id uuid,
  paper_id uuid,
  figure_no text,
  caption text,
  item_type text,
  summary_text text,
  page int,
  bm25_rank float,
  source_file_id uuid,
  source_file_kind text,
  source_filename text
)
language plpgsql stable
as $$
declare
  tsq tsquery;
begin
  tsq := build_or_tsquery(query_text);

  if tsq is null then
    return;
  end if;

  return query
  select
    f.id as figure_id,
    f.paper_id,
    f.figure_no,
    f.caption,
    f.item_type::text,
    f.summary_text,
    f.page,
    ts_rank_cd(f.fts, tsq)::float as bm25_rank,
    f.source_file_id,
    pf.file_kind::text as source_file_kind,
    coalesce(pf.original_filename, pf.stored_filename) as source_filename
  from figures f
  left join paper_files pf on pf.id = f.source_file_id
  where f.fts @@ tsq
    and f.item_type = any(filter_item_types)
    and (filter_paper_ids is null or f.paper_id = any(filter_paper_ids))
  order by bm25_rank desc
  limit match_count;
end;
$$;
