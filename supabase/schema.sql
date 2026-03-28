-- ═══════════════════════════════════════════════════════════════
-- OPEN BRAIN — Nicole's Schema
-- Designed around actual workflow patterns:
--   Sessions (2-3/day), Decisions (architectural), Feedback (lessons),
--   References, Insights, Project State, People Notes
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Enable pgvector
create extension if not exists vector;

-- ═══════════════════════════════════════════════════════════════
-- CORE TABLE: thoughts
-- Single semantic store. Everything goes here.
-- The metadata JSONB is where Nicole's workflow lives.
-- ═══════════════════════════════════════════════════════════════

create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- HNSW index for fast similarity search (cosine distance)
create index thoughts_embedding_idx on thoughts using hnsw (embedding vector_cosine_ops);
-- GIN index for JSONB metadata filtering (type, project, topics, status)
create index thoughts_metadata_idx on thoughts using gin (metadata);
-- BTREE for chronological queries
create index thoughts_created_at_idx on thoughts (created_at desc);
-- Partial index for open action items
create index thoughts_open_actions_idx on thoughts using gin (metadata)
  where metadata ? 'action_items';

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- SEMANTIC SEARCH FUNCTION
-- Supports metadata filtering alongside vector similarity
-- ═══════════════════════════════════════════════════════════════

create or replace function match_thoughts(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    t.id,
    t.content,
    t.metadata,
    1 - (t.embedding <=> query_embedding) as similarity,
    t.created_at
  from thoughts t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
  and (filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- NICOLE-SPECIFIC VIEWS
-- Pre-built queries for common access patterns
-- ═══════════════════════════════════════════════════════════════

-- All unresolved items across all projects
create or replace view open_items as
select
  id,
  content,
  metadata->>'type' as thought_type,
  metadata->>'project' as project,
  metadata->>'status' as status,
  metadata->'action_items' as actions,
  created_at
from thoughts
where metadata->>'status' in ('uncommitted', 'active', 'blocked')
  or jsonb_array_length(coalesce(metadata->'action_items', '[]'::jsonb)) > 0
order by created_at desc;

-- All decisions, searchable
create or replace view decisions as
select
  id,
  content,
  metadata->>'project' as project,
  metadata->'topics' as topics,
  metadata->>'commit' as commit_sha,
  metadata->>'source_session' as source_session,
  created_at
from thoughts
where metadata->>'type' = 'decision'
order by created_at desc;

-- All skills/capabilities
create or replace view skills as
select
  id,
  content,
  metadata->'topics' as domains,
  metadata->>'project' as project,
  created_at
from thoughts
where metadata->>'type' = 'skill'
order by created_at desc;

-- All agent configurations/teams/workflows
create or replace view agents as
select
  id,
  content,
  metadata->'topics' as domains,
  metadata->>'project' as project,
  created_at
from thoughts
where metadata->>'type' = 'agent'
order by created_at desc;

-- All feedback/lessons
create or replace view lessons as
select
  id,
  content,
  metadata->'topics' as domains,
  metadata->>'project' as project,
  created_at
from thoughts
where metadata->>'type' = 'feedback'
order by created_at desc;

-- Weekly activity summary
create or replace view this_week as
select
  metadata->>'type' as thought_type,
  metadata->>'project' as project,
  count(*) as count,
  min(created_at) as earliest,
  max(created_at) as latest
from thoughts
where created_at > now() - interval '7 days'
group by metadata->>'type', metadata->>'project'
order by count desc;

-- Stale items (>14 days, still active)
create or replace view stale_items as
select
  id,
  content,
  metadata->>'type' as thought_type,
  metadata->>'project' as project,
  metadata->>'status' as status,
  created_at,
  now() - created_at as age
from thoughts
where metadata->>'status' in ('active', 'in_progress', 'uncommitted')
  and created_at < now() - interval '14 days'
order by created_at asc;

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Service role (Edge Function) gets full access
-- ═══════════════════════════════════════════════════════════════

alter table thoughts enable row level security;

create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');
