-- Add entity graph opt-in flag to user_workspace_preferences
alter table public.user_workspace_preferences
  add column if not exists entity_graph_enabled boolean not null default false;

comment on column public.user_workspace_preferences.entity_graph_enabled is
  '엔티티 그래프 기능 opt-in 플래그. false(기본): import 시 자동 추출 안 함, QA는 plain RAG. true: 자동 추출 큐잉 + QA graph 경로.';
