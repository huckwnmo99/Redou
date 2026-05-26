alter type job_type add value if not exists 'extract_entities';

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  chunk_id uuid references public.paper_chunks(id) on delete set null,
  entity_type text not null check (entity_type in (
    'substance',
    'method',
    'condition',
    'metric',
    'phenomenon',
    'concept'
  )),
  raw_name text not null,
  canonical_name text not null,
  value text,
  unit text,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  confidence_tag text not null default 'EXTRACTED' check (confidence_tag in ('EXTRACTED', 'INFERRED', 'AMBIGUOUS')),
  source_hint text,
  embedding vector(2048),
  created_at timestamptz not null default now()
);

create index if not exists idx_entities_paper on public.entities (paper_id);
create index if not exists idx_entities_canonical on public.entities (canonical_name);
create index if not exists idx_entities_type on public.entities (entity_type);
create index if not exists idx_entities_paper_canon on public.entities (paper_id, canonical_name);

create table if not exists public.entity_relations (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references public.entities(id) on delete cascade,
  target_entity_id uuid not null references public.entities(id) on delete cascade,
  relation_type text not null check (relation_type in (
    'affects',
    'correlates_with',
    'measures',
    'uses',
    'compared_to',
    'outperforms',
    'produces',
    'same_as'
  )),
  direction text not null default 'neutral' check (direction in ('positive', 'negative', 'neutral', 'bidirectional')),
  source_paper_id uuid not null references public.papers(id) on delete cascade,
  evidence_chunk_id uuid references public.paper_chunks(id) on delete set null,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  confidence_tag text not null default 'EXTRACTED' check (confidence_tag in ('EXTRACTED', 'INFERRED', 'AMBIGUOUS')),
  created_at timestamptz not null default now(),
  unique (source_entity_id, target_entity_id, relation_type, source_paper_id)
);

create index if not exists idx_entity_rel_source on public.entity_relations (source_entity_id);
create index if not exists idx_entity_rel_target on public.entity_relations (target_entity_id);
create index if not exists idx_entity_rel_paper on public.entity_relations (source_paper_id);
create index if not exists idx_entity_rel_type on public.entity_relations (relation_type);

alter table public.papers
  add column if not exists entity_extraction_version int default 0;

alter table public.user_workspace_preferences
  add column if not exists entity_extraction_model text;

alter table public.entities enable row level security;
drop policy if exists "entities_via_paper" on public.entities;
create policy "entities_via_paper" on public.entities
  for all
  using (
    exists (
      select 1
      from public.papers
      where papers.id = entities.paper_id
        and papers.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.papers
      where papers.id = entities.paper_id
        and papers.owner_user_id = auth.uid()
    )
  );

alter table public.entity_relations enable row level security;
drop policy if exists "entity_relations_via_paper" on public.entity_relations;
create policy "entity_relations_via_paper" on public.entity_relations
  for all
  using (
    exists (
      select 1
      from public.papers
      where papers.id = entity_relations.source_paper_id
        and papers.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.papers
      where papers.id = entity_relations.source_paper_id
        and papers.owner_user_id = auth.uid()
    )
  );

create or replace function public.match_entities(
  query_embedding vector(2048),
  match_threshold float default 0.35,
  match_count int default 20,
  filter_paper_ids uuid[] default null,
  filter_types text[] default null
)
returns table (
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
language plpgsql stable as $$
begin
  return query
  select
    e.id as entity_id,
    e.paper_id,
    e.chunk_id,
    e.entity_type,
    e.canonical_name,
    e.value,
    e.unit,
    e.confidence,
    e.confidence_tag,
    (1 - (e.embedding <=> query_embedding))::float as similarity
  from public.entities e
  where e.embedding is not null
    and (filter_paper_ids is null or e.paper_id = any(filter_paper_ids))
    and (filter_types is null or e.entity_type = any(filter_types))
    and (1 - (e.embedding <=> query_embedding)) >= match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;

create or replace function public.resolve_same_as(seed_entity_ids uuid[])
returns uuid[]
language plpgsql stable as $$
declare
  result uuid[];
begin
  if seed_entity_ids is null or array_length(seed_entity_ids, 1) is null then
    return array[]::uuid[];
  end if;

  with recursive expand(id) as (
    select unnest(seed_entity_ids)
    union
    select case
      when er.source_entity_id = expand.id then er.target_entity_id
      else er.source_entity_id
    end
    from expand
    join public.entity_relations er
      on er.source_entity_id = expand.id
      or er.target_entity_id = expand.id
    where er.relation_type = 'same_as'
  )
  select array_agg(distinct id) into result from expand;

  return coalesce(result, array[]::uuid[]);
end;
$$;

create or replace function public.graph_traverse_1hop(
  seed_entity_ids uuid[],
  max_results int default 50
)
returns table (
  chunk_id uuid,
  paper_id uuid,
  neighbor_entity_id uuid,
  neighbor_canonical_name text,
  relation_type text,
  direction text,
  hop int
)
language plpgsql stable as $$
begin
  if seed_entity_ids is null or array_length(seed_entity_ids, 1) is null then
    return;
  end if;

  return query
  select distinct
    coalesce(er.evidence_chunk_id, neighbor.chunk_id) as chunk_id,
    neighbor.paper_id,
    neighbor.id as neighbor_entity_id,
    neighbor.canonical_name as neighbor_canonical_name,
    er.relation_type,
    er.direction,
    1 as hop
  from public.entity_relations er
  join public.entities neighbor
    on neighbor.id = case
      when er.source_entity_id = any(seed_entity_ids) then er.target_entity_id
      else er.source_entity_id
    end
  where er.source_entity_id = any(seed_entity_ids)
     or er.target_entity_id = any(seed_entity_ids)
  limit max_results;
end;
$$;
